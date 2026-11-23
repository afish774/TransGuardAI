"""Closed-Loop Active Learning Dataset Exporter & YOLO11 Weapon Fine-Tuner.

Converts operator-reviewed alerts archived in ``uploads/feedback/`` into an
Ultralytics YOLO11 dataset so real camera false positives (smartphones,
umbrellas, bottles, handrails) become hard-negative training examples:

  - ``uploads/feedback/false_positives/CRIME_WEAPON_DETECTED/*.{jpg,json}``
      -> copied as background hard-negative images with empty ``.txt`` labels.
  - ``uploads/feedback/true_positives/CRIME_WEAPON_DETECTED/*.{jpg,json}``
      -> copied with YOLO-format normalized bounding-box labels from ``metadata.bbox``.

Examples:
  # 1. Export dataset only (inspect before training):
  python scripts/prepare_weapon_finetune.py

  # 2. Export AND fine-tune yolo11s on your Quadro T2000 / RTX 3060 GPU:
  python scripts/prepare_weapon_finetune.py --train --epochs 40 --base-model yolo11s.pt
"""

import argparse
import json
import random
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2

ROOT = Path(__file__).resolve().parent.parent

# Canonical weapon class map matching yolov8n-weapons.pt
CLASS_MAP: Dict[str, int] = {
    "gun": 0,
    "pistol": 0,
    "handgun": 0,
    "revolver": 0,
    "rifle": 0,
    "firearm": 0,
    "weapon": 0,
    "explosion": 1,
    "explosive": 1,
    "grenade": 2,
    "knife": 3,
    "blade": 3,
}
CLASS_NAMES = ["Gun", "explosion", "grenade", "knife"]


def _resolve_class_id(meta: Dict) -> int:
    weapon_str = str(meta.get("weapon") or meta.get("objectClass") or "gun").lower()
    for kw, cid in CLASS_MAP.items():
        if kw in weapon_str:
            return cid
    return 0


def _bbox_to_yolo_line(bbox: List[float], img_w: int, img_h: int, class_id: int) -> Optional[str]:
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        return None
    x1, y1, x2, y2 = (float(v) for v in bbox)
    x1 = max(0.0, min(float(img_w), x1))
    y1 = max(0.0, min(float(img_h), y1))
    x2 = max(0.0, min(float(img_w), x2))
    y2 = max(0.0, min(float(img_h), y2))
    bw = x2 - x1
    bh = y2 - y1
    if bw < 4.0 or bh < 4.0 or img_w <= 0 or img_h <= 0:
        return None
    cx = (x1 + x2) / 2.0 / img_w
    cy = (y1 + y2) / 2.0 / img_h
    nw = bw / img_w
    nh = bh / img_h
    return f"{class_id} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}"


def collect_samples(feedback_root: Path) -> List[Tuple[Path, str, str]]:
    """Collect ``(image_path, label_text, split_tag)`` from feedback buckets."""
    samples: List[Tuple[Path, str, str]] = []

    # 1. Hard negatives (DISMISSED alerts -> empty label file tells YOLO: 0 weapons here!)
    fp_dir = feedback_root / "false_positives" / "CRIME_WEAPON_DETECTED"
    if fp_dir.exists():
        for json_path in sorted(fp_dir.glob("*.json")):
            try:
                data = json.loads(json_path.read_text(encoding="utf-8"))
                ev = data.get("evidence_file")
                if not ev:
                    continue
                img_path = fp_dir / ev
                if img_path.exists():
                    samples.append((img_path, "", "hard_negative"))
            except Exception:
                continue

    # 2. Confirmed positives (REVIEWED alerts with bbox -> labeled YOLO box)
    tp_dir = feedback_root / "true_positives" / "CRIME_WEAPON_DETECTED"
    if tp_dir.exists():
        for json_path in sorted(tp_dir.glob("*.json")):
            try:
                data = json.loads(json_path.read_text(encoding="utf-8"))
                ev = data.get("evidence_file")
                if not ev:
                    continue
                img_path = tp_dir / ev
                if not img_path.exists():
                    continue
                img = cv2.imread(str(img_path))
                if img is None:
                    continue
                ih, iw = img.shape[:2]
                meta = data.get("metadata") or {}
                line = _bbox_to_yolo_line(meta.get("bbox"), iw, ih, _resolve_class_id(meta))
                if line:
                    samples.append((img_path, line + "\n", "positive"))
            except Exception:
                continue

    return samples


def export_dataset(
    feedback_root: Path,
    out_dir: Path,
    val_ratio: float = 0.2,
    seed: int = 42,
) -> Dict[str, int]:
    samples = collect_samples(feedback_root)
    rng = random.Random(seed)
    rng.shuffle(samples)

    for split in ("train", "val"):
        (out_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (out_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

    n_val = max(1, int(round(len(samples) * val_ratio))) if len(samples) >= 5 else 0
    counts = {"train": 0, "val": 0, "hard_negative": 0, "positive": 0}

    for idx, (img_path, label_text, tag) in enumerate(samples):
        split = "val" if idx < n_val else "train"
        stem = f"{tag}_{idx:05d}_{img_path.stem}"
        dest_img = out_dir / "images" / split / f"{stem}{img_path.suffix}"
        dest_lbl = out_dir / "labels" / split / f"{stem}.txt"
        shutil.copy2(img_path, dest_img)
        dest_lbl.write_text(label_text, encoding="utf-8")
        counts[split] += 1
        counts[tag] += 1

    yaml_text = (
        f"path: {out_dir.resolve().as_posix()}\n"
        f"train: images/train\n"
        f"val: images/{'val' if counts['val'] > 0 else 'train'}\n"
        f"names:\n"
        + "".join(f"  {i}: {name}\n" for i, name in enumerate(CLASS_NAMES))
    )
    (out_dir / "data.yaml").write_text(yaml_text, encoding="utf-8")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Export HITL feedback to YOLO11 weapon fine-tuning dataset")
    parser.add_argument("--feedback-dir", type=str, default=str(ROOT / "uploads" / "feedback"))
    parser.add_argument("--out-dir", type=str, default=str(ROOT / "dataset" / "weapon_finetune"))
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--train", action="store_true", help="Immediately launch YOLO11 GPU fine-tuning")
    parser.add_argument("--base-model", type=str, default="yolov8n-weapons.pt")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--imgsz", type=int, default=640)
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    counts = export_dataset(Path(args.feedback_dir), out_dir, val_ratio=args.val_ratio)
    print(f"Exported dataset -> {out_dir}")
    print(f"  Train: {counts['train']} | Val: {counts['val']} | Positives: {counts['positive']} | Hard Negatives: {counts['hard_negative']}")
    print(f"  YAML:  {out_dir / 'data.yaml'}")

    if args.train:
        if counts["train"] == 0:
            print("No feedback samples available yet. Dismiss/Approve alerts in the dashboard first!")
            sys.exit(1)
        from ultralytics import YOLO
        import torch

        device = 0 if torch.cuda.is_available() else "cpu"
        model = YOLO(args.base_model)
        model.train(
            data=str(out_dir / "data.yaml"),
            epochs=args.epochs,
            imgsz=args.imgsz,
            batch=args.batch,
            device=device,
            project=str(ROOT / "runs" / "weapon_finetune"),
            name="transguard_v2",
            exist_ok=True,
        )
        print("Training complete! Copy runs/weapon_finetune/transguard_v2/weights/best.pt -> yolo11s-weapons.pt")


if __name__ == "__main__":
    main()
