"""Prepare SOHAS + Bus Hard-Negative dataset, fine-tune YOLO11s-weapons, and
benchmark strictly head-to-head against current yolov8n-weapons.pt.

Zero-Regression Policy:
  - Does NOT overwrite yolov8n-weapons.pt or modify engine/config.py.
  - Saves candidate weights to `engine/weights/yolo11s-weapons.pt`.
  - Evaluates BOTH baseline (`yolov8n-weapons.pt`) and fine-tuned candidate on:
      1. Official SOHAS held-out test split (857 images: pistols, knives, phones/wallets/cards)
      2. Unseen Bus CCTV empty-background frames (100 NoViolence frames from bus-violence/test.txt)
      3. User's real indoor CCTV butcher-knife (full frame + person crop) & empty-hand snapshots
      4. Steady-state GPU latency on 2-crop 480px batches (matching live WeaponDetector.scan)
"""

import argparse
import collections
import gc
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Dict, List

import cv2
import numpy as np
import torch
from ultralytics import YOLO

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

SOHAS_CLASSES = ["pistol", "smartphone", "knife", "monedero", "billete", "tarjeta"]
DISTRACTOR_CLASS_IDS = {1, 3, 4, 5}


def _link_or_copy(src: Path, dst: Path) -> None:
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def _primary_class(label_path: Path) -> int:
    if not label_path.exists():
        return -1
    lines = [l.strip() for l in label_path.read_text(encoding="utf-8", errors="ignore").splitlines() if l.strip()]
    if not lines:
        return -1
    ids = [int(l.split()[0]) for l in lines]
    for cid in (2, 0):
        if cid in ids:
            return cid
    return ids[0]


def _validate_yolo_label(label_path: Path) -> List[str]:
    """Return cleaned valid YOLO box lines (clamped to [0, 1], valid class 0..5)."""
    valid: List[str] = []
    if not label_path.exists():
        return valid
    for line in label_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        parts = line.strip().split()
        if len(parts) != 5:
            continue
        try:
            cid = int(parts[0])
            cx, cy, w, h = (float(v) for v in parts[1:])
        except ValueError:
            continue
        if cid < 0 or cid >= len(SOHAS_CLASSES):
            continue
        if w <= 1e-4 or h <= 1e-4:
            continue
        cx = min(max(cx, 0.0), 1.0)
        cy = min(max(cy, 0.0), 1.0)
        w = min(max(w, 1e-4), 1.0)
        h = min(max(h, 1e-4), 1.0)
        valid.append(f"{cid} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    return valid


def build_dataset(
    sohas_dir: Path,
    bus_dir: Path,
    out_dir: Path,
    max_bus_train: int = 450,
    max_bus_val: int = 50,
    max_bus_test: int = 100,
) -> Path:
    """Build clean train/val/test YOLO dataset combining SOHAS + Bus NoViolence hard negatives."""
    yaml_path = out_dir / "data.yaml"
    if (out_dir / ".ready.json").exists() and yaml_path.exists():
        print(f"[Dataset] Reusing prepared dataset at {out_dir}")
        return yaml_path

    if out_dir.exists():
        shutil.rmtree(out_dir)

    for split in ("train", "val", "test"):
        (out_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (out_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    obj_root = sohas_dir / "obj_train_data"
    tr_imgs = sorted([p for p in (obj_root / "images" / "train").iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png")])
    te_imgs = sorted([p for p in (obj_root / "images" / "test").iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png")])

    # Stratified 90/10 train/val split from SOHAS train (never touches official test!)
    by_cls: Dict[int, List[Path]] = collections.defaultdict(list)
    for img_p in tr_imgs:
        lbl_p = obj_root / "labels" / "train" / f"{img_p.stem}.txt"
        by_cls[_primary_class(lbl_p)].append(img_p)

    rng = np.random.default_rng(42)
    train_list: List[Path] = []
    val_list: List[Path] = []
    for _cid, plist in sorted(by_cls.items()):
        arr = list(plist)
        rng.shuffle(arr)
        n_val = max(1, int(round(len(arr) * 0.10)))
        val_list.extend(arr[:n_val])
        train_list.extend(arr[n_val:])

    stats = collections.Counter()

    def _copy_sohas_split(img_list: List[Path], src_split: str, dst_split: str) -> None:
        for img_p in img_list:
            lbl_src = obj_root / "labels" / src_split / f"{img_p.stem}.txt"
            lines = _validate_yolo_label(lbl_src)
            _link_or_copy(img_p, out_dir / "images" / dst_split / img_p.name)
            (out_dir / "labels" / dst_split / f"{img_p.stem}.txt").write_text(
                "\n".join(lines) + ("\n" if lines else ""), encoding="utf-8"
            )
            stats[f"{dst_split}_sohas"] += 1

    _copy_sohas_split(train_list, "train", "train")
    _copy_sohas_split(val_list, "train", "val")
    _copy_sohas_split(te_imgs, "test", "test")

    # Mix in clean overhead Bus CCTV hard-negative frames (empty label = 0 weapons!)
    if bus_dir.exists():
        nv_dir = bus_dir / "NoViolence"
        bus_train_txt = bus_dir / "train.txt"
        bus_test_txt = bus_dir / "test.txt"

        def _extract_bus_bg(video_names: List[str], dst_split: str, limit: int) -> None:
            added = 0
            for vname in video_names:
                if added >= limit:
                    break
                vp = nv_dir / vname
                if not vp.exists():
                    continue
                cap = cv2.VideoCapture(str(vp))
                if not cap.isOpened():
                    continue
                total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, total // 2))
                ok, frame = cap.read()
                cap.release()
                if not ok or frame is None or frame.size == 0:
                    continue
                stem = f"busbg_{vp.stem}"
                out_img = out_dir / "images" / dst_split / f"{stem}.jpg"
                out_lbl = out_dir / "labels" / dst_split / f"{stem}.txt"
                cv2.imwrite(str(out_img), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
                out_lbl.write_text("", encoding="utf-8")
                added += 1
                stats[f"{dst_split}_busbg"] += 1

        if bus_train_txt.exists():
            tr_nv = [l.strip() for l in bus_train_txt.read_text(encoding="utf-8").splitlines() if l.strip().startswith("NONVIOLENCE")]
            rng.shuffle(tr_nv)
            _extract_bus_bg(tr_nv[:max_bus_train], "train", max_bus_train)
            _extract_bus_bg(tr_nv[max_bus_train:max_bus_train + max_bus_val], "val", max_bus_val)
        if bus_test_txt.exists():
            te_nv = [l.strip() for l in bus_test_txt.read_text(encoding="utf-8").splitlines() if l.strip().startswith("NONVIOLENCE")]
            rng.shuffle(te_nv)
            _extract_bus_bg(te_nv[:max_bus_test], "test", max_bus_test)

    yaml_text = (
        f"path: {out_dir.as_posix()}\n"
        "train: images/train\n"
        "val: images/val\n"
        "test: images/test\n\n"
        f"nc: {len(SOHAS_CLASSES)}\n"
        f"names: {SOHAS_CLASSES}\n"
    )
    yaml_path.write_text(yaml_text, encoding="utf-8")
    (out_dir / ".ready.json").write_text(json.dumps(dict(stats), indent=2), encoding="utf-8")
    print(f"[Dataset] Prepared at {out_dir}: {dict(stats)}")
    return yaml_path


def _box_iou_xyxy(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    if inter <= 0.0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    return inter / max(1e-6, area_a + area_b - inter)


def _canonical_weapon(name: str) -> str:
    n = name.lower().strip()
    if any(k in n for k in ("gun", "pistol", "handgun", "revolver", "firearm", "rifle")):
        return "gun"
    if any(k in n for k in ("knife", "blade")):
        return "knife"
    return "other"


def _extract_person_crops(img: np.ndarray, person_model: YOLO, device: str) -> List[np.ndarray]:
    res = person_model.predict(img, conf=0.45, verbose=False, device=device)[0]
    crops: List[np.ndarray] = []
    if res.boxes is not None:
        fh, fw = img.shape[:2]
        for box in res.boxes:
            if int(box.cls[0]) != 0:
                continue
            x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
            pad_x = int((x2 - x1) * 0.20)
            pad_y = int((y2 - y1) * 0.15)
            cx1, cy1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
            cx2, cy2 = min(fw, x2 + pad_x), min(fh, y2 + pad_y)
            if cx2 - cx1 > 20 and cy2 - cy1 > 20:
                crops.append(img[cy1:cy2, cx1:cx2])
    return crops


def evaluate_model_head_to_head(
    weights_path: str,
    dataset_dir: Path,
    person_model: YOLO,
    conf: float = 0.40,
    imgsz: int = 512,
) -> Dict[str, object]:
    """Evaluate ANY weapon YOLO model on the exact same held-out test set + 2-crop 480px latency."""
    model = YOLO(weights_path)
    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    test_imgs = sorted((dataset_dir / "images" / "test").glob("*.*"))

    tp = {"gun": 0, "knife": 0}
    fp = {"gun": 0, "knife": 0}
    fn = {"gun": 0, "knife": 0}
    distractor_imgs = 0
    distractor_fp_imgs = 0
    busbg_imgs = 0
    busbg_fp_imgs = 0

    t0 = time.perf_counter()
    for img_p in test_imgs:
        lbl_p = dataset_dir / "labels" / "test" / f"{img_p.stem}.txt"
        img = cv2.imread(str(img_p))
        if img is None:
            continue
        h, w = img.shape[:2]

        gt_boxes = {"gun": [], "knife": []}
        has_distractor = False
        if lbl_p.exists():
            for line in lbl_p.read_text(encoding="utf-8").splitlines():
                parts = line.strip().split()
                if len(parts) != 5:
                    continue
                cid = int(parts[0])
                cx, cy, bw, bh = (float(v) for v in parts[1:])
                x1, y1 = (cx - bw / 2) * w, (cy - bh / 2) * h
                x2, y2 = (cx + bw / 2) * w, (cy + bh / 2) * h
                if cid == 0:
                    gt_boxes["gun"].append((x1, y1, x2, y2))
                elif cid == 2:
                    gt_boxes["knife"].append((x1, y1, x2, y2))
                elif cid in DISTRACTOR_CLASS_IDS:
                    has_distractor = True

        is_busbg = img_p.stem.startswith("busbg_")
        is_pure_distractor = has_distractor and (not gt_boxes["gun"]) and (not gt_boxes["knife"])
        if is_busbg:
            busbg_imgs += 1
        if is_pure_distractor:
            distractor_imgs += 1

        res = model.predict(img, conf=conf, imgsz=imgsz, device=device, verbose=False)[0]
        preds = {"gun": [], "knife": []}
        if res.boxes is not None:
            for b in res.boxes:
                cname = _canonical_weapon(str(model.names[int(b.cls[0])]))
                if cname in ("gun", "knife"):
                    preds[cname].append((float(b.conf[0]), tuple(float(v) for v in b.xyxy[0].tolist())))

        any_weapon_pred = bool(preds["gun"] or preds["knife"])
        if is_busbg and any_weapon_pred:
            busbg_fp_imgs += 1
        if is_pure_distractor and any_weapon_pred:
            distractor_fp_imgs += 1

        for cls in ("gun", "knife"):
            matched_gt = set()
            for _c, pbox in sorted(preds[cls], key=lambda x: -x[0]):
                best_i, best_iou = -1, 0.45
                for gi, gbox in enumerate(gt_boxes[cls]):
                    if gi in matched_gt:
                        continue
                    iou = _box_iou_xyxy(pbox, gbox)
                    if iou >= best_iou:
                        best_iou = iou
                        best_i = gi
                if best_i >= 0:
                    matched_gt.add(best_i)
                    tp[cls] += 1
                else:
                    fp[cls] += 1
            fn[cls] += len(gt_boxes[cls]) - len(matched_gt)

    if torch.cuda.is_available():
        torch.cuda.synchronize()
    elapsed = time.perf_counter() - t0
    ms_per_img = (elapsed / max(1, len(test_imgs))) * 1000.0

    # Measure steady-state 2-crop 480px batch GPU latency matching live WeaponDetector.scan()
    dummy_crop_a = np.full((380, 180, 3), 120, dtype=np.uint8)
    dummy_crop_b = np.full((380, 180, 3), 90, dtype=np.uint8)
    batch_2 = [dummy_crop_a, dummy_crop_b]
    for _ in range(3):
        model.predict(batch_2, conf=conf, imgsz=480, device=device, verbose=False)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    t_lat = time.perf_counter()
    for _ in range(20):
        model.predict(batch_2, conf=conf, imgsz=480, device=device, verbose=False)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    batch2_480_ms = (time.perf_counter() - t_lat) * 1000.0 / 20.0

    def _prf(c: str) -> Dict[str, float]:
        p = tp[c] / max(1, tp[c] + fp[c])
        r = tp[c] / max(1, tp[c] + fn[c])
        f1 = 2 * p * r / max(1e-8, p + r)
        return {"precision": p, "recall": r, "f1": f1, "tp": tp[c], "fp": fp[c], "fn": fn[c]}

    tot_tp = tp["gun"] + tp["knife"]
    tot_fp = fp["gun"] + fp["knife"]
    tot_fn = fn["gun"] + fn["knife"]
    tot_p = tot_tp / max(1, tot_tp + tot_fp)
    tot_r = tot_tp / max(1, tot_tp + tot_fn)
    tot_f1 = 2 * tot_p * tot_r / max(1e-8, tot_p + tot_r)

    # Real user CCTV image checks (both full frame & person crop at conf=0.40)
    real_checks: Dict[str, object] = {}
    real_targets = [
        (Path(p.strip()).stem, p.strip())
        for p in os.getenv("REAL_EVAL_IMAGES", "").split(",")
        if p.strip()
    ]
    for tag, path in real_targets:
        if not os.path.exists(path):
            continue
        im = cv2.imread(path)
        r_full = model.predict(im, conf=conf, imgsz=imgsz, device=device, verbose=False)[0]
        full_hits = [
            (_canonical_weapon(str(model.names[int(b.cls[0])])), round(float(b.conf[0]), 3))
            for b in r_full.boxes
            if _canonical_weapon(str(model.names[int(b.cls[0])])) in ("gun", "knife")
        ] if r_full.boxes is not None else []

        crop_hits = []
        for pc in _extract_person_crops(im, person_model, device):
            r_crop = model.predict(pc, conf=conf, imgsz=480, device=device, verbose=False)[0]
            if r_crop.boxes is not None:
                for b in r_crop.boxes:
                    cn = _canonical_weapon(str(model.names[int(b.cls[0])]))
                    if cn in ("gun", "knife"):
                        crop_hits.append((cn, round(float(b.conf[0]), 3)))
        real_checks[tag] = {"full_frame": full_hits, "person_crop": crop_hits}

    del model
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return {
        "weights": os.path.basename(weights_path),
        "conf": conf,
        "imgsz": imgsz,
        "ms_per_img": round(ms_per_img, 1),
        "batch2_480_ms": round(batch2_480_ms, 1),
        "gun": _prf("gun"),
        "knife": _prf("knife"),
        "overall": {"precision": tot_p, "recall": tot_r, "f1": tot_f1, "tp": tot_tp, "fp": tot_fp, "fn": tot_fn},
        "distractor_fp_rate": distractor_fp_imgs / max(1, distractor_imgs),
        "distractor_fp_str": f"{distractor_fp_imgs}/{distractor_imgs}",
        "busbg_fp_rate": busbg_fp_imgs / max(1, busbg_imgs),
        "busbg_fp_str": f"{busbg_fp_imgs}/{busbg_imgs}",
        "real_checks": real_checks,
    }


def _print_report(label: str, m: Dict[str, object]) -> None:
    ov, g, k = m["overall"], m["gun"], m["knife"]
    print(f"\n=== {label} ({m['weights']} @ conf={m['conf']}, imgsz={m['imgsz']}) ===")
    print(f"  OVERALL : Prec={ov['precision']*100:.2f}% | Rec={ov['recall']*100:.2f}% | F1={ov['f1']*100:.2f}% (TP={ov['tp']} FP={ov['fp']} FN={ov['fn']})")
    print(f"  GUN     : Prec={g['precision']*100:.2f}% | Rec={g['recall']*100:.2f}% | F1={g['f1']*100:.2f}% (TP={g['tp']} FP={g['fp']} FN={g['fn']})")
    print(f"  KNIFE   : Prec={k['precision']*100:.2f}% | Rec={k['recall']*100:.2f}% | F1={k['f1']*100:.2f}% (TP={k['tp']} FP={k['fp']} FN={k['fn']})")
    print(f"  Phone/Wallet/Card FP Rate : {m['distractor_fp_rate']*100:.2f}% ({m['distractor_fp_str']})")
    print(f"  Empty Bus CCTV FP Rate    : {m['busbg_fp_rate']*100:.2f}% ({m['busbg_fp_str']})")
    print(f"  GPU Speed (test/img, 2x480): {m['ms_per_img']:.1f} ms/img | {m['batch2_480_ms']:.1f} ms per 2-crop batch")
    print(f"  Real User Photo Checks    : {m['real_checks']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--sohas",
        default=os.getenv("SOHAS_DATASET", "datasets/sohas-weapon-detection"),
    )
    parser.add_argument("--bus-dir", default=os.getenv("BUS_VIOLENCE_DATASET", "datasets/bus-violence"))
    parser.add_argument("--work-dir", default=str(ROOT_DIR / "engine" / "weights" / "sohas_yolo_dataset"))
    parser.add_argument("--base-model", default=str(ROOT_DIR / "yolo11s.pt"))
    parser.add_argument("--baseline-model", default=str(ROOT_DIR / "yolov8n-weapons.pt"))
    parser.add_argument("--out-weights", default=str(ROOT_DIR / "engine" / "weights" / "yolo11s-weapons.pt"))
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--imgsz", type=int, default=480)
    parser.add_argument("--batch", type=int, default=4)
    args = parser.parse_args()

    work_dir = Path(args.work_dir)
    yaml_path = build_dataset(Path(args.sohas), Path(args.bus_dir), work_dir)
    person_model = YOLO(args.base_model)

    # 1. Measure current baseline BEFORE training
    print("\n[Step 1/3] Benchmarking current baseline yolov8n-weapons.pt on held-out test set...")
    base_metrics = evaluate_model_head_to_head(args.baseline_model, work_dir, person_model, conf=0.40, imgsz=512)
    _print_report("BASELINE (CURRENT)", base_metrics)

    # Free ALL inference models from 4GB GPU before training to prevent Windows WDDM shared-RAM thrashing
    del person_model
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    # 2. Fine-tune YOLO11s on Quadro T2000 (amp=False avoids TU117 NaN overflow bug!)
    device = 0 if torch.cuda.is_available() else "cpu"
    run_project = ROOT_DIR / "engine" / "weights" / "runs"

    def _run_train(batch_sz: int, train_imgsz: int):
        model = YOLO(args.base_model)
        return model.train(
            data=str(yaml_path),
            epochs=args.epochs,
            imgsz=train_imgsz,
            batch=batch_sz,
            device=device,
            workers=0,          # Faster zero-IPC overhead & lower RAM on Windows
            amp=False,          # TU117 Quadro T2000 FP32 safety (zero NaN loss!)
            patience=6,
            optimizer="AdamW",
            lr0=1.2e-3,
            lrf=0.05,
            weight_decay=5e-4,
            warmup_epochs=2.0,
            mosaic=0.8,
            close_mosaic=4,
            hsv_v=0.45,
            hsv_s=0.5,
            degrees=10.0,
            scale=0.5,
            fliplr=0.5,
            erasing=0.2,
            project=str(run_project),
            name="yolo11s_sohas_weapons",
            exist_ok=True,
            verbose=True,
        )

    print(f"\n[Step 2/3] Fine-tuning {os.path.basename(args.base_model)} for {args.epochs} epochs (imgsz={args.imgsz}, batch={args.batch})...")
    try:
        results = _run_train(args.batch, args.imgsz)
    except RuntimeError as exc:
        if "out of memory" in str(exc).lower() and args.batch > 2:
            print(f"[OOM Recovery] Retrying training with batch=2 after CUDA OOM: {exc}")
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            results = _run_train(2, args.imgsz)
        else:
            raise

    best_pt = Path(results.save_dir) / "weights" / "best.pt"
    out_pt = Path(args.out_weights)
    out_pt.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best_pt, out_pt)
    print(f"\n[Saved] Candidate weights copied to {out_pt} ({out_pt.stat().st_size / 1e6:.2f} MB)")

    # 3. Head-to-head evaluation on the exact same held-out test set!
    print("\n[Step 3/3] Benchmarking fine-tuned yolo11s-weapons.pt head-to-head against baseline...")
    person_model_eval = YOLO(args.base_model)
    new_metrics = evaluate_model_head_to_head(str(out_pt), work_dir, person_model_eval, conf=0.40, imgsz=512)
    _print_report("FINE-TUNED CANDIDATE", new_metrics)

    summary = {"baseline": base_metrics, "candidate": new_metrics}
    report_path = out_pt.parent / "weapon_benchmark_report.json"
    report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n[Report] Saved comparison JSON to {report_path}")

    f1_delta = (new_metrics["overall"]["f1"] - base_metrics["overall"]["f1"]) * 100.0
    knife_delta = (new_metrics["knife"]["f1"] - base_metrics["knife"]["f1"]) * 100.0
    gun_delta = (new_metrics["gun"]["f1"] - base_metrics["gun"]["f1"]) * 100.0
    lat_delta = new_metrics["batch2_480_ms"] - base_metrics["batch2_480_ms"]
    print(
        f"[VERDICT SUMMARY] Overall F1: {f1_delta:+.2f} pts | "
        f"Knife F1: {knife_delta:+.2f} pts | Gun F1: {gun_delta:+.2f} pts | "
        f"2-Crop Latency Delta: {lat_delta:+.1f} ms"
    )


if __name__ == "__main__":
    main()
