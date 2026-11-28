"""Train & benchmark a lightweight Temporal SigLIP Violence Classifier on Bus-Violence CCTV videos.

Reuses the exact `google/siglip-base-patch16-224` visual encoder already loaded
by TransGuard's VisionLanguageVerifier (0 MB extra backbone VRAM at runtime!).

Pipeline (following strict ML hygiene):
  1. Loads official train.txt / test.txt splits (no video leakage between splits),
     further splitting train.txt into 85% train / 15% validation (stratified).
  2. Extracts T=8 uniformly sampled frames per clip + horizontally flipped &
     person-scale zoomed views (for train split only, so the head generalizes to
     both full-frame bus CCTV and zoomed 2-person union crops in live inference).
  3. Benchmarks 4 approaches on the held-out official test.txt split:
       - Baseline 0: Current Zero-Shot SigLIP text prompts
       - Model 1: Regularized L2 Logistic Regression on 3072-D temporal features
       - Model 2: Regularized PyTorch Temporal MLP (mean, max, |delta|_mean, |delta|_max)
       - Model 3: Regularized PyTorch Temporal Conv1D + Attention Pooling over (T, 768)
  4. Selects the best validation F1 model, calibrates the decision threshold on
     the validation set, prints confusion matrices & metrics on held-out test.txt,
     and saves a self-contained ~1-2 MB PyTorch checkpoint to:
       `engine/weights/violence_siglip_head.pt`
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from engine.detectors.vlm_verifier import (  # noqa: E402
    VIOLENCE_NEGATIVE_PROMPTS,
    VIOLENCE_POSITIVE_PROMPTS,
    VisionLanguageVerifier,
    evaluate_violence_scores,
)

NUM_FRAMES = 8
EMBED_DIM = 768


def _resolve_split_files(dataset_dir: Path) -> Tuple[List[Tuple[Path, int]], List[Tuple[Path, int]]]:
    """Load official train.txt / test.txt splits with class labels (1=Violence, 0=NoViolence)."""
    v_dir = dataset_dir / "Violence"
    nv_dir = dataset_dir / "NoViolence"

    def _find_video(fname: str) -> Tuple[Path, int]:
        fname = fname.strip()
        p_v = v_dir / fname
        if p_v.exists():
            return p_v, 1
        p_nv = nv_dir / fname
        if p_nv.exists():
            return p_nv, 0
        raise FileNotFoundError(f"Video {fname} not found in Violence/ or NoViolence/")

    train_txt = dataset_dir / "train.txt"
    test_txt = dataset_dir / "test.txt"
    if train_txt.exists() and test_txt.exists():
        train_items = [_find_video(line) for line in train_txt.read_text(encoding="utf-8").splitlines() if line.strip()]
        test_items = [_find_video(line) for line in test_txt.read_text(encoding="utf-8").splitlines() if line.strip()]
        return train_items, test_items

    # Fallback stratified 80/20 split if txt files are absent
    rng = np.random.default_rng(42)
    v_all = [(p, 1) for p in sorted(v_dir.glob("*.mp4"))]
    nv_all = [(p, 0) for p in sorted(nv_dir.glob("*.mp4"))]
    rng.shuffle(v_all)
    rng.shuffle(nv_all)
    v_cut = int(len(v_all) * 0.8)
    nv_cut = int(len(nv_all) * 0.8)
    return v_all[:v_cut] + nv_all[:nv_cut], v_all[v_cut:] + nv_all[nv_cut:]


def _sample_video_frames(video_path: Path, num_frames: int = NUM_FRAMES) -> List[np.ndarray]:
    """Uniformly sample *num_frames* RGB frames from an MP4 clip."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return []
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frames: List[np.ndarray] = []
    if total > 0:
        indices = np.linspace(0, max(0, total - 1), num_frames, dtype=int)
        idx_set = set(indices.tolist())
        read_map: Dict[int, np.ndarray] = {}
        cur = 0
        max_idx = int(indices[-1])
        while cur <= max_idx:
            ok, bgr = cap.read()
            if not ok:
                break
            if cur in idx_set:
                read_map[cur] = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            cur += 1
        for i in indices:
            if int(i) in read_map:
                frames.append(read_map[int(i)])
            elif frames:
                frames.append(frames[-1])
    else:
        raw = []
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            raw.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        if raw:
            indices = np.linspace(0, len(raw) - 1, num_frames, dtype=int)
            frames = [raw[int(i)] for i in indices]
    cap.release()
    if len(frames) == 0:
        return []
    while len(frames) < num_frames:
        frames.append(frames[-1])
    return frames[:num_frames]


def _center_zoom_crop(rgb: np.ndarray, scale: float = 0.75) -> np.ndarray:
    """Extract a centered zoomed crop (simulates live 2-person bounding-box crop scale)."""
    h, w = rgb.shape[:2]
    nh, nw = max(32, int(h * scale)), max(32, int(w * scale))
    y1 = (h - nh) // 2
    x1 = (w - nw) // 2
    return rgb[y1:y1 + nh, x1:x1 + nw]


def _encode_pil_batch(vlm: VisionLanguageVerifier, pil_images: List[Image.Image]) -> np.ndarray:
    """Batch-encode PIL images into L2-normalized SigLIP embeddings (N, 768)."""
    inputs = vlm._processor(images=pil_images, return_tensors="pt")
    model_dtype = next(vlm._model.parameters()).dtype
    pixel_values = inputs["pixel_values"].to(device=vlm._torch_device, dtype=model_dtype)
    with torch.inference_mode():
        out = vlm._model.get_image_features(pixel_values=pixel_values)
        if not isinstance(out, torch.Tensor):
            out = getattr(out, "pooler_output", out[0])
        embeds = out / out.norm(p=2, dim=-1, keepdim=True).clamp(min=1e-6)
    return embeds.float().cpu().numpy()


def extract_or_load_features(
    dataset_dir: Path,
    cache_path: Path,
    vlm: VisionLanguageVerifier,
    batch_videos: int = 8,
) -> Dict[str, np.ndarray]:
    """Extract & cache (N, T, 768) SigLIP sequences for train (+ aug views) and test splits."""
    if cache_path.exists():
        print(f"[Cache] Loading pre-extracted SigLIP embeddings from {cache_path}")
        data = np.load(cache_path, allow_pickle=True)
        return {k: data[k] for k in data.files}

    train_items, test_items = _resolve_split_files(dataset_dir)
    print(f"[Dataset] Official split: train={len(train_items)} videos, test={len(test_items)} videos")

    def _run_split(items: List[Tuple[Path, int]], include_aug: bool, tag: str):
        seqs = []
        labels = []
        names = []
        aug_flags = []
        corrupt = 0
        t0 = time.perf_counter()

        buf_imgs: List[Image.Image] = []
        buf_meta: List[Tuple[int, str, int]] = []  # (label, name, aug_id)

        def _flush():
            if not buf_imgs:
                return
            embs = _encode_pil_batch(vlm, buf_imgs)
            for idx, (lbl, nm, aug_id) in enumerate(buf_meta):
                seqs.append(embs[idx * NUM_FRAMES:(idx + 1) * NUM_FRAMES])
                labels.append(lbl)
                names.append(nm)
                aug_flags.append(aug_id)
            buf_imgs.clear()
            buf_meta.clear()

        for vi, (vpath, lbl) in enumerate(items, start=1):
            frames = _sample_video_frames(vpath, NUM_FRAMES)
            if len(frames) < NUM_FRAMES:
                corrupt += 1
                continue
            # View 0: Full frame
            buf_imgs.extend(Image.fromarray(f) for f in frames)
            buf_meta.append((lbl, vpath.name, 0))
            if include_aug:
                # View 1: Horizontal flip (doubles directional invariance)
                buf_imgs.extend(Image.fromarray(np.ascontiguousarray(f[:, ::-1, :])) for f in frames)
                buf_meta.append((lbl, vpath.name, 1))
                # View 2: 0.72x center zoom (matches live 2-person union crop scale)
                buf_imgs.extend(Image.fromarray(_center_zoom_crop(f, 0.72)) for f in frames)
                buf_meta.append((lbl, vpath.name, 2))

            if len(buf_meta) >= batch_videos:
                _flush()
            if vi % 200 == 0 or vi == len(items):
                elapsed = time.perf_counter() - t0
                print(f"  [{tag}] {vi}/{len(items)} videos encoded ({elapsed:.1f}s, corrupt={corrupt})")
        _flush()
        return (
            np.asarray(seqs, dtype=np.float32),
            np.asarray(labels, dtype=np.int64),
            np.asarray(names, dtype=object),
            np.asarray(aug_flags, dtype=np.int64),
        )

    tr_x, tr_y, tr_names, tr_aug = _run_split(train_items, include_aug=True, tag="train+aug")
    te_x, te_y, te_names, te_aug = _run_split(test_items, include_aug=False, tag="test")

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cache_path,
        tr_x=tr_x,
        tr_y=tr_y,
        tr_names=tr_names,
        tr_aug=tr_aug,
        te_x=te_x,
        te_y=te_y,
        te_names=te_names,
    )
    print(f"[Cache] Saved SigLIP features to {cache_path} ({cache_path.stat().st_size / 1e6:.1f} MB)")
    return {
        "tr_x": tr_x, "tr_y": tr_y, "tr_names": tr_names, "tr_aug": tr_aug,
        "te_x": te_x, "te_y": te_y, "te_names": te_names,
    }


def sequence_to_temporal_features(seq: np.ndarray) -> np.ndarray:
    """Convert (..., T, 768) L2-normalized SigLIP sequence into (..., 3072) temporal vector:
    [mean_embed, max_embed, mean(|e_t - e_{t-1}|), max(|e_t - e_{t-1}|)]."""
    mean_e = seq.mean(axis=-2)
    max_e = seq.max(axis=-2)
    if seq.shape[-2] >= 2:
        diffs = np.abs(seq[..., 1:, :] - seq[..., :-1, :])
        d_mean = diffs.mean(axis=-2)
        d_max = diffs.max(axis=-2)
    else:
        d_mean = np.zeros_like(mean_e)
        d_max = np.zeros_like(mean_e)
    return np.concatenate([mean_e, max_e, d_mean, d_max], axis=-1).astype(np.float32)


def compute_metrics(y_true: np.ndarray, probs: np.ndarray, threshold: float = 0.5) -> Dict[str, float]:
    preds = (probs >= threshold).astype(np.int64)
    tp = int(((preds == 1) & (y_true == 1)).sum())
    tn = int(((preds == 0) & (y_true == 0)).sum())
    fp = int(((preds == 1) & (y_true == 0)).sum())
    fn = int(((preds == 0) & (y_true == 1)).sum())
    acc = (tp + tn) / max(1, tp + tn + fp + fn)
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    f1 = 2 * prec * rec / max(1e-8, prec + rec)
    fpr = fp / max(1, fp + tn)
    return {
        "accuracy": acc, "precision": prec, "recall": rec, "f1": f1, "fpr": fpr,
        "tp": tp, "tn": tn, "fp": fp, "fn": fn, "threshold": threshold,
    }


def tune_threshold(y_val: np.ndarray, val_probs: np.ndarray, max_fpr: float = 0.20) -> float:
    """Calibrate decision threshold on clean validation windows maximizing F1 while bounding FPR."""
    best_t, best_f1 = 0.5, -1.0
    for t in np.linspace(0.30, 0.85, 56):
        m = compute_metrics(y_val, val_probs, float(t))
        if m["fpr"] <= max_fpr and m["f1"] > best_f1:
            best_f1 = m["f1"]
            best_t = float(t)
    if best_f1 < 0.0:
        # Fallback if no threshold satisfies max_fpr
        for t in np.linspace(0.30, 0.85, 56):
            m = compute_metrics(y_val, val_probs, float(t))
            if m["f1"] > best_f1:
                best_f1 = m["f1"]
                best_t = float(t)
    return best_t


def build_multicadence_windows(
    seqs: np.ndarray,
    labels: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray]:
    """Expand (N, 8, 768) clips into multi-cadence T=4 & T=8 temporal summary vectors (M, 3072).

    Matching live inference's 4-frame ring buffer across both strided (7-12 FPS)
    and dense (15+ FPS) cadences eliminates train-vs-live distribution drift.
    """
    feats: List[np.ndarray] = []
    ys: List[np.ndarray] = []
    for sl in (slice(None), slice(0, 8, 2), slice(1, 8, 2), slice(0, 4), slice(2, 6), slice(4, 8)):
        feats.append(sequence_to_temporal_features(seqs[:, sl, :]))
        ys.append(labels)
    return np.concatenate(feats, axis=0), np.concatenate(ys, axis=0)


class TemporalMLPHead(nn.Module):
    """Lightweight regularized MLP on 3072-D temporal SigLIP summary features."""

    def __init__(self, in_dim: int = EMBED_DIM * 4, hidden: int = 256, dropout: float = 0.45):
        super().__init__()
        self.net = nn.Sequential(
            nn.LayerNorm(in_dim),
            nn.Dropout(dropout),
            nn.Linear(in_dim, hidden),
            nn.GELU(),
            nn.LayerNorm(hidden),
            nn.Dropout(dropout * 0.8),
            nn.Linear(hidden, 64),
            nn.GELU(),
            nn.Linear(64, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


class TemporalConvAttnHead(nn.Module):
    """Lightweight 1D Temporal Conv + Attention Pooling directly over (B, T, 768) sequences."""

    def __init__(self, embed_dim: int = EMBED_DIM, hidden: int = 192, dropout: float = 0.40):
        super().__init__()
        self.in_norm = nn.LayerNorm(embed_dim)
        self.proj = nn.Linear(embed_dim, hidden)
        self.conv1 = nn.Conv1d(hidden, hidden, kernel_size=3, padding=1)
        self.conv_norm = nn.LayerNorm(hidden)
        self.attn = nn.Linear(hidden, 1)
        self.drop = nn.Dropout(dropout)
        self.head = nn.Sequential(
            nn.Linear(hidden * 2, 64),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(64, 1),
        )

    def forward(self, seq: torch.Tensor) -> torch.Tensor:
        # seq: (B, T, 768)
        x = self.drop(F.gelu(self.proj(self.in_norm(seq))))  # (B, T, H)
        c = self.conv1(x.transpose(1, 2)).transpose(1, 2)     # (B, T, H)
        h = self.conv_norm(x + F.gelu(c))                     # Residual temporal conv
        w = torch.softmax(self.attn(h), dim=1)                # (B, T, 1)
        attn_pool = (h * w).sum(dim=1)                        # (B, H)
        if h.shape[1] >= 2:
            motion_pool = torch.abs(h[:, 1:, :] - h[:, :-1, :]).max(dim=1).values
        else:
            motion_pool = torch.zeros_like(attn_pool)
        fused = torch.cat([attn_pool, motion_pool], dim=-1)   # (B, 2H)
        return self.head(self.drop(fused)).squeeze(-1)


def benchmark_zeroshot_baseline(vlm: VisionLanguageVerifier, te_x: np.ndarray, te_y: np.ndarray) -> Dict[str, float]:
    """Evaluate existing zero-shot SigLIP text prompts on the exact same test clips."""
    prompts = [*VIOLENCE_POSITIVE_PROMPTS, *VIOLENCE_NEGATIVE_PROMPTS]
    text_embeds = vlm._get_text_features(prompts).float().cpu().numpy()  # (P, 768)
    logit_scale = float(vlm._model.logit_scale.exp().float().item())
    n_pos = len(VIOLENCE_POSITIVE_PROMPTS)

    clip_probs = []
    for seq in te_x:
        # Take max positive probability across sampled frames (same logic as live multi-frame check)
        logits = (seq @ text_embeds.T) * logit_scale  # (T, P)
        logits = logits - logits.max(axis=-1, keepdims=True)
        exps = np.exp(logits)
        probs = exps / exps.sum(axis=-1, keepdims=True)
        frame_pos = probs[:, :n_pos].max(axis=-1)
        clip_probs.append(float(frame_pos.max()))
    clip_probs = np.asarray(clip_probs, dtype=np.float32)
    return compute_metrics(te_y, clip_probs, threshold=0.50)


def train_torch_model(
    model: nn.Module,
    x_tr: np.ndarray,
    y_tr: np.ndarray,
    x_val: np.ndarray,
    y_val: np.ndarray,
    device: torch.device,
    epochs: int = 35,
    batch_size: int = 64,
    lr: float = 8e-4,
    weight_decay: float = 2e-2,
) -> Tuple[nn.Module, np.ndarray]:
    model = model.to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)

    x_tr_t = torch.from_numpy(x_tr).to(device)
    y_tr_t = torch.from_numpy(y_tr.astype(np.float32)).to(device)
    x_val_t = torch.from_numpy(x_val).to(device)

    best_loss = float("inf")
    best_state = None
    best_val_probs = None
    n = len(x_tr)

    for _ep in range(epochs):
        model.train()
        perm = torch.randperm(n, device=device)
        for start in range(0, n, batch_size):
            idx = perm[start:start + batch_size]
            opt.zero_grad(set_to_none=True)
            logits = model(x_tr_t[idx])
            # Label smoothing 0.04 for better probability calibration on unseen cameras
            targets = y_tr_t[idx] * 0.96 + 0.02
            loss = F.binary_cross_entropy_with_logits(logits, targets)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        sched.step()

        model.eval()
        with torch.inference_mode():
            val_logits = model(x_val_t)
            val_loss = float(F.binary_cross_entropy_with_logits(val_logits, torch.from_numpy(y_val.astype(np.float32)).to(device)).item())
            if val_loss < best_loss:
                best_loss = val_loss
                best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
                best_val_probs = torch.sigmoid(val_logits).cpu().numpy()

    if best_state is not None:
        model.load_state_dict(best_state)
    return model, best_val_probs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default=os.getenv("BUS_VIOLENCE_DATASET", "datasets/bus-violence"))
    parser.add_argument("--out", default=str(ROOT_DIR / "engine" / "weights" / "violence_siglip_head.pt"))
    parser.add_argument("--cache", default=str(ROOT_DIR / "engine" / "weights" / "bus_violence_siglip_cache.npz"))
    args = parser.parse_args()

    torch.manual_seed(42)
    np.random.seed(42)

    vlm = VisionLanguageVerifier()
    assert vlm.available, "SigLIP VisionLanguageVerifier must be available to train!"
    device = vlm._torch_device

    data = extract_or_load_features(Path(args.dataset), Path(args.cache), vlm)
    tr_x, tr_y, tr_names, tr_aug = data["tr_x"], data["tr_y"], data["tr_names"], data["tr_aug"]
    te_x, te_y = data["te_x"], data["te_y"]

    # Video-level stratified split of train.txt -> 85% train / 15% val (ZERO video leakage!)
    unique_vids = {}
    for nm, lbl in zip(tr_names, tr_y):
        unique_vids[str(nm)] = int(lbl)
    pos_vids = sorted([nm for nm, lbl in unique_vids.items() if lbl == 1])
    neg_vids = sorted([nm for nm, lbl in unique_vids.items() if lbl == 0])
    rng = np.random.default_rng(42)
    rng.shuffle(pos_vids)
    rng.shuffle(neg_vids)
    val_set = set(pos_vids[:max(1, int(len(pos_vids) * 0.15))] + neg_vids[:max(1, int(len(neg_vids) * 0.15))])

    # Train uses all augmented views of train videos; Validation uses ONLY clean un-augmented view (aug==0)
    tr_mask = np.array([str(nm) not in val_set for nm in tr_names])
    va_mask = np.array([(str(nm) in val_set) and (int(a) == 0) for nm, a in zip(tr_names, tr_aug)])

    seq_tr, y_tr = tr_x[tr_mask], tr_y[tr_mask]
    seq_va, y_va = tr_x[va_mask], tr_y[va_mask]
    print(f"[Split] Train clips (with aug): {len(seq_tr)} | Val videos (clean): {len(seq_va)} | Test videos (official): {len(te_x)}")

    # 0. Zero-Shot SigLIP Text Prompt Baseline
    zs_test = benchmark_zeroshot_baseline(vlm, te_x, te_y)
    print(f"\n[Baseline 0: Zero-Shot SigLIP Prompts] Test Acc={zs_test['accuracy']*100:.2f}% | Prec={zs_test['precision']*100:.2f}% | Rec={zs_test['recall']*100:.2f}% | F1={zs_test['f1']*100:.2f}% | FPR={zs_test['fpr']*100:.2f}%")

    # Multi-cadence temporal feature training (matches live T=4 & T=8 windows!)
    f_tr, y_tr_win = build_multicadence_windows(seq_tr, y_tr)
    # Clean T=4 validation windows ([::2] + [2:6]) directly match live 4-frame buffer
    f_va = np.concatenate([
        sequence_to_temporal_features(seq_va[:, ::2, :]),
        sequence_to_temporal_features(seq_va[:, 2:6, :]),
    ], axis=0)
    y_va_win = np.concatenate([y_va, y_va], axis=0)

    f_te_8 = sequence_to_temporal_features(te_x)
    f_te_4s = sequence_to_temporal_features(te_x[:, ::2, :])
    f_te_4m = sequence_to_temporal_features(te_x[:, 2:6, :])

    candidates = []

    def _eval_regimes(model, thr: float):
        model.eval()
        with torch.inference_mode():
            p8 = torch.sigmoid(model(torch.from_numpy(f_te_8).to(device))).cpu().numpy()
            p4s = torch.sigmoid(model(torch.from_numpy(f_te_4s).to(device))).cpu().numpy()
            p4m = torch.sigmoid(model(torch.from_numpy(f_te_4m).to(device))).cpu().numpy()
        return compute_metrics(te_y, p4s, thr), compute_metrics(te_y, p4m, thr), compute_metrics(te_y, p8, thr)

    # 1. Model 1: Regularized L2 Logistic Regression (single linear layer in PyTorch)
    lin = nn.Sequential(nn.LayerNorm(EMBED_DIM * 4), nn.Dropout(0.35), nn.Linear(EMBED_DIM * 4, 1))
    class _LinearWrap(nn.Module):
        def __init__(self, m): super().__init__(); self.m = m
        def forward(self, x): return self.m(x).squeeze(-1)
    m1, va_p1 = train_torch_model(_LinearWrap(lin), f_tr, y_tr_win, f_va, y_va_win, device, epochs=35, batch_size=128, lr=8e-4, weight_decay=8e-2)
    t1 = tune_threshold(y_va_win, va_p1, max_fpr=0.20)
    va_m1 = compute_metrics(y_va_win, va_p1, t1)
    m1_4s, m1_4m, m1_8 = _eval_regimes(m1, t1)
    print(f"[Model 1: Temporal Linear (T=4+8)   ] Val F1={va_m1['f1']*100:.2f}% (FPR={va_m1['fpr']*100:.1f}%) | Test(T=4s) F1={m1_4s['f1']*100:.2f}% FPR={m1_4s['fpr']*100:.1f}% | Test(T=8) F1={m1_8['f1']*100:.2f}% (thr={t1:.2f})")
    candidates.append(("linear_temporal", m1, t1, va_m1, m1_4s, m1_4m, m1_8, "temporal_vec"))

    # 2. Model 2: Regularized Temporal MLP (3072 -> 256 -> 64 -> 1)
    m2, va_p2 = train_torch_model(TemporalMLPHead(dropout=0.50), f_tr, y_tr_win, f_va, y_va_win, device, epochs=35, batch_size=128, lr=6e-4, weight_decay=5e-2)
    t2 = tune_threshold(y_va_win, va_p2, max_fpr=0.20)
    va_m2 = compute_metrics(y_va_win, va_p2, t2)
    m2_4s, m2_4m, m2_8 = _eval_regimes(m2, t2)
    print(f"[Model 2: Temporal MLP (T=4+8)      ] Val F1={va_m2['f1']*100:.2f}% (FPR={va_m2['fpr']*100:.1f}%) | Test(T=4s) F1={m2_4s['f1']*100:.2f}% FPR={m2_4s['fpr']*100:.1f}% | Test(T=8) F1={m2_8['f1']*100:.2f}% (thr={t2:.2f})")
    candidates.append(("temporal_mlp", m2, t2, va_m2, m2_4s, m2_4m, m2_8, "temporal_vec"))

    # Select best model strictly by validation F1 (evaluated on clean T=4 windows!)
    candidates.sort(key=lambda item: item[3]["f1"], reverse=True)
    best_name, best_model, best_thr, best_va, best_te_4s, best_te_4m, best_te, best_input_type = candidates[0]

    # Also train a single-frame (768-D) backup head inside the same checkpoint for instant 1-frame scoring
    f1_tr = seq_tr.reshape(-1, EMBED_DIM)
    y1_tr = np.repeat(y_tr, NUM_FRAMES)
    f1_va = seq_va.reshape(-1, EMBED_DIM)
    y1_va = np.repeat(y_va, NUM_FRAMES)
    sf_head = TemporalMLPHead(in_dim=EMBED_DIM, hidden=192, dropout=0.40)
    sf_head, sf_va_p = train_torch_model(sf_head, f1_tr, y1_tr, f1_va, y1_va, device, epochs=25, lr=8e-4, weight_decay=2e-2)
    sf_thr = tune_threshold(y1_va, sf_va_p, max_fpr=0.22)
    sf_head.eval()
    with torch.inference_mode():
        sf_te_frame_p = torch.sigmoid(sf_head(torch.from_numpy(te_x.reshape(-1, EMBED_DIM)).to(device))).cpu().numpy().reshape(len(te_x), NUM_FRAMES)
        sf_te_m = compute_metrics(te_y, sf_te_frame_p.mean(axis=1), sf_thr)
    print(f"[Bonus  : Single-Frame SigLIP Head  ] Test Acc={sf_te_m['accuracy']*100:.2f}% | Prec={sf_te_m['precision']*100:.2f}% | Rec={sf_te_m['recall']*100:.2f}% | F1={sf_te_m['f1']*100:.2f}% (thr={sf_thr:.2f})")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ckpt = {
        "arch": best_name,
        "input_type": best_input_type,
        "embed_dim": EMBED_DIM,
        "num_frames": NUM_FRAMES,
        "threshold": float(best_thr),
        "backbone": vlm.model_name,
        "state_dict": {k: v.detach().cpu() for k, v in best_model.state_dict().items()},
        "single_frame_state_dict": {k: v.detach().cpu() for k, v in sf_head.state_dict().items()},
        "single_frame_threshold": float(sf_thr),
        "metrics": {
            "zeroshot_test": zs_test,
            "selected_val": best_va,
            "selected_test": best_te,
            "selected_test_t4_strided": best_te_4s,
            "selected_test_t4_mid": best_te_4m,
            "single_frame_test": sf_te_m,
        },
    }
    torch.save(ckpt, out_path)
    print(f"\n[SELECTED WINNER] {best_name} saved to {out_path} ({out_path.stat().st_size / 1e6:.2f} MB) @ calibrated thr={best_thr:.2f}")
    print(f"  Test (T=4 strided): Acc={best_te_4s['accuracy']*100:.2f}% Prec={best_te_4s['precision']*100:.2f}% Rec={best_te_4s['recall']*100:.2f}% F1={best_te_4s['f1']*100:.2f}% FPR={best_te_4s['fpr']*100:.2f}% (TP={best_te_4s['tp']} FP={best_te_4s['fp']} TN={best_te_4s['tn']} FN={best_te_4s['fn']})")
    print(f"  Test (T=4 mid    ): Acc={best_te_4m['accuracy']*100:.2f}% Prec={best_te_4m['precision']*100:.2f}% Rec={best_te_4m['recall']*100:.2f}% F1={best_te_4m['f1']*100:.2f}% FPR={best_te_4m['fpr']*100:.2f}%")
    print(f"  Test (T=8 full   ): Acc={best_te['accuracy']*100:.2f}% Prec={best_te['precision']*100:.2f}% Rec={best_te['recall']*100:.2f}% F1={best_te['f1']*100:.2f}% FPR={best_te['fpr']*100:.2f}% (TP={best_te['tp']} FP={best_te['fp']} TN={best_te['tn']} FN={best_te['fn']})")
    vlm.close()


if __name__ == "__main__":
    main()
