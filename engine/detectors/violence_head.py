"""Lightweight trained Temporal SigLIP Head for Bus/CCTV Violence Detection.

Loads ``engine/weights/violence_siglip_head.pt`` (~1-2 MB) and operates directly
on L2-normalized 768-D visual embeddings from the already-loaded GPU SigLIP
encoder (0 MB extra backbone VRAM, <1 ms inference).
"""

import logging
import os
from pathlib import Path
from typing import Optional, Tuple

import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    torch = None
    nn = None
    F = None
    TORCH_AVAILABLE = False

log = logging.getLogger("trans-guard-engine")

DEFAULT_VIOLENCE_HEAD_PATH = str(
    Path(__file__).resolve().parent.parent / "weights" / "violence_siglip_head.pt"
)


def sequence_to_temporal_features(seq: np.ndarray) -> np.ndarray:
    """Convert (..., T, 768) L2-normalized SigLIP sequence into (..., 3072) temporal vector."""
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


if TORCH_AVAILABLE:
    class _LinearTemporalHead(nn.Module):
        def __init__(self, in_dim: int = 768 * 4):
            super().__init__()
            self.m = nn.Sequential(nn.LayerNorm(in_dim), nn.Dropout(0.35), nn.Linear(in_dim, 1))

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            return self.m(x).squeeze(-1)

    class TemporalMLPHead(nn.Module):
        def __init__(self, in_dim: int = 768 * 4, hidden: int = 256, dropout: float = 0.45):
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
        def __init__(self, embed_dim: int = 768, hidden: int = 192, dropout: float = 0.40):
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
            x = self.drop(F.gelu(self.proj(self.in_norm(seq))))
            c = self.conv1(x.transpose(1, 2)).transpose(1, 2)
            h = self.conv_norm(x + F.gelu(c))
            w = torch.softmax(self.attn(h), dim=1)
            attn_pool = (h * w).sum(dim=1)
            if h.shape[1] >= 2:
                motion_pool = torch.abs(h[:, 1:, :] - h[:, :-1, :]).max(dim=1).values
            else:
                motion_pool = torch.zeros_like(attn_pool)
            fused = torch.cat([attn_pool, motion_pool], dim=-1)
            return self.head(self.drop(fused)).squeeze(-1)


class TrainedViolenceHead:
    """Inference wrapper for the bus-violence fine-tuned SigLIP classification head."""

    def __init__(self, weights_path: Optional[str] = None, device=None):
        self.available: bool = False
        self.arch: str = ""
        self.input_type: str = ""
        self.threshold: float = 0.50
        self.single_frame_threshold: float = 0.50
        self._model = None
        self._sf_model = None
        self._device = device

        if not TORCH_AVAILABLE:
            return
        path = (weights_path or os.getenv("VIOLENCE_HEAD_WEIGHTS", DEFAULT_VIOLENCE_HEAD_PATH)).strip()
        if not path or not os.path.exists(path):
            return
        try:
            ckpt = torch.load(path, map_location="cpu", weights_only=False)
            arch = str(ckpt.get("arch", ""))
            embed_dim = int(ckpt.get("embed_dim", 768))
            if arch == "temporal_conv_attn":
                model = TemporalConvAttnHead(embed_dim=embed_dim)
            elif arch == "temporal_mlp":
                model = TemporalMLPHead(in_dim=embed_dim * 4)
            elif arch == "linear_temporal":
                model = _LinearTemporalHead(in_dim=embed_dim * 4)
            else:
                log.warning("Unknown violence head arch '%s' in %s", arch, path)
                return

            model.load_state_dict(ckpt["state_dict"])
            target_dev = device if device is not None else torch.device("cpu")
            model.to(target_dev).eval()
            self._model = model
            self._device = target_dev
            self.arch = arch
            self.input_type = str(ckpt.get("input_type", "temporal_vec"))
            ckpt_thr = float(ckpt.get("threshold", 0.50))
            env_thr = os.getenv("VIOLENCE_HEAD_THRESHOLD", "").strip()
            self.threshold = float(env_thr) if env_thr else ckpt_thr

            if "single_frame_state_dict" in ckpt:
                sf = TemporalMLPHead(in_dim=embed_dim, hidden=192, dropout=0.40)
                sf.load_state_dict(ckpt["single_frame_state_dict"])
                sf.to(target_dev).eval()
                self._sf_model = sf
                self.single_frame_threshold = float(ckpt.get("single_frame_threshold", 0.50))

            self.available = True
            test_f1 = ckpt.get("metrics", {}).get("selected_test", {}).get("f1")
            f1_str = f", test_F1={test_f1 * 100:.1f}%" if isinstance(test_f1, (int, float)) else ""
            log.info(
                "Loaded fine-tuned Bus-Violence SigLIP head '%s' (%s, thr=%.2f%s)",
                arch,
                os.path.basename(path),
                self.threshold,
                f1_str,
            )
        except Exception as exc:
            log.warning("Could not load trained violence head '%s': %s", path, exc)
            self.available = False

    def predict_sequence(self, embeds_seq: np.ndarray) -> Tuple[bool, float]:
        """Score a (T, 768) L2-normalized SigLIP embedding sequence.

        Returns ``(is_violent, probability)``.
        """
        if not self.available or embeds_seq is None or len(embeds_seq) == 0:
            return (False, 0.0)
        seq = np.asarray(embeds_seq, dtype=np.float32)
        if seq.ndim == 1:
            seq = seq[None, :]

        with torch.inference_mode():
            if seq.shape[0] == 1 and self._sf_model is not None:
                x = torch.from_numpy(seq).to(self._device)
                prob = float(torch.sigmoid(self._sf_model(x)).item())
                return (prob >= self.single_frame_threshold, prob)

            if self.input_type == "sequence":
                x = torch.from_numpy(seq[None, :, :]).to(self._device)
            else:
                vec = sequence_to_temporal_features(seq)[None, :]
                x = torch.from_numpy(vec).to(self._device)
            prob = float(torch.sigmoid(self._model(x)).item())
            return (prob >= self.threshold, prob)
