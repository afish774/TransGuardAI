"""Offline Accuracy, Latency & False-Alarms-Per-Hour (FAPH) Benchmark Harness.

Runs the full TransGuard AI IncidentProcessor against recorded video clips so
every threshold, model, or detector change is measured objectively instead of
guessed.

Examples:
  # Measure False Alarms Per Hour on normal bus footage:
  python scripts/eval_accuracy.py --video path/to/normal_ride.mp4 --mode negative

  # Measure Recall & Time-to-Alert on a staged weapon/fall/fight clip:
  python scripts/eval_accuracy.py --video path/to/staged_fall.mp4 --mode positive --expected FALL_DETECTED

  # Evaluate a folder of negative clips and save JSON report:
  python scripts/eval_accuracy.py --video-dir clips/normal --mode negative --output-json eval_report.json
"""

import argparse
import json
import os
import queue
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional

import cv2

# Ensure project root is importable
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.config import EngineConfig  # noqa: E402
from engine.inference import IncidentProcessor  # noqa: E402


def evaluate_video(
    video_path: Path,
    cfg: EngineConfig,
    max_frames: Optional[int] = None,
) -> Dict[str, object]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    src_fps = cap.get(cv2.CAP_PROP_FPS) or float(cfg.fps)
    incident_q: queue.Queue = queue.Queue(maxsize=1024)
    processor = IncidentProcessor(cfg, incident_q)

    events: List[Dict[str, object]] = []
    frame_idx = 0
    t_start = time.perf_counter()

    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            if frame.shape[1] != cfg.width or frame.shape[0] != cfg.height:
                frame = cv2.resize(frame, (cfg.width, cfg.height))

            processor.process_frame(frame)
            frame_idx += 1

            while True:
                try:
                    ev = incident_q.get_nowait()
                    events.append({
                        "incident_type": ev["incident_type"],
                        "confidence": ev.get("confidence"),
                        "frame": frame_idx,
                        "video_sec": round(frame_idx / max(1.0, src_fps), 2),
                    })
                except queue.Empty:
                    break

            if max_frames and frame_idx >= max_frames:
                break
    finally:
        cap.release()
        processor.close()

    elapsed_s = max(1e-6, time.perf_counter() - t_start)
    video_duration_s = frame_idx / max(1.0, src_fps)
    counts = Counter(e["incident_type"] for e in events)
    faph = (len(events) / max(1e-6, video_duration_s)) * 3600.0

    return {
        "video": str(video_path),
        "frames_processed": frame_idx,
        "video_duration_s": round(video_duration_s, 2),
        "processing_elapsed_s": round(elapsed_s, 2),
        "avg_fps": round(frame_idx / elapsed_s, 2),
        "avg_ms_per_frame": round((elapsed_s / max(1, frame_idx)) * 1000.0, 1),
        "total_alerts": len(events),
        "alerts_by_type": dict(counts),
        "false_alarms_per_hour": round(faph, 2),
        "events": events,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="TransGuard AI offline accuracy & FAPH evaluator")
    parser.add_argument("--video", type=str, default=None, help="Path to a single video file")
    parser.add_argument("--video-dir", type=str, default=None, help="Directory of video files to benchmark")
    parser.add_argument("--mode", choices=("negative", "positive"), default="negative")
    parser.add_argument("--expected", type=str, default=None, help="Expected incident_type for positive mode")
    parser.add_argument("--max-frames", type=int, default=None, help="Optional frame cap per clip")
    parser.add_argument("--model", type=str, default="yolov8n.pt")
    parser.add_argument("--weapon-model", type=str, default="yolov8n-weapons.pt")
    parser.add_argument("--output-json", type=str, default=None, help="Save structured report JSON")
    args = parser.parse_args()

    videos: List[Path] = []
    if args.video:
        videos.append(Path(args.video))
    if args.video_dir:
        for ext in ("*.mp4", "*.avi", "*.mov", "*.mkv"):
            videos.extend(sorted(Path(args.video_dir).glob(ext)))

    if not videos:
        parser.error("Provide --video or --video-dir containing at least one video file.")

    cfg = EngineConfig(
        yolo_model=args.model,
        weapon_model=args.weapon_model,
    )

    reports = []
    for vp in videos:
        print(f"\nEvaluating {vp} ...")
        rep = evaluate_video(vp, cfg, max_frames=args.max_frames)
        reports.append(rep)
        print(
            f"  Frames: {rep['frames_processed']} ({rep['video_duration_s']}s) | "
            f"Speed: {rep['avg_fps']} FPS ({rep['avg_ms_per_frame']} ms/f) | "
            f"Alerts: {rep['total_alerts']} {rep['alerts_by_type']}"
        )
        if args.mode == "negative":
            print(f"  False Alarms Per Hour (FAPH): {rep['false_alarms_per_hour']}")
        elif args.mode == "positive" and args.expected:
            matched = [e for e in rep["events"] if e["incident_type"] == args.expected]
            recalled = len(matched) > 0
            tta = matched[0]["video_sec"] if recalled else None
            print(f"  Expected '{args.expected}': {'DETECTED' if recalled else 'MISSED'} (time_to_alert={tta}s)")

    summary = {
        "mode": args.mode,
        "expected": args.expected,
        "clips_evaluated": len(reports),
        "total_video_seconds": round(sum(r["video_duration_s"] for r in reports), 2),
        "total_alerts": sum(r["total_alerts"] for r in reports),
        "reports": reports,
    }
    if args.mode == "negative" and summary["total_video_seconds"] > 0:
        summary["aggregate_faph"] = round(
            (summary["total_alerts"] / summary["total_video_seconds"]) * 3600.0, 2
        )
        print(f"\nAggregate FAPH across {len(reports)} clips: {summary['aggregate_faph']}")

    if args.output_json:
        out_path = Path(args.output_json)
        out_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(f"Saved report -> {out_path}")


if __name__ == "__main__":
    main()
