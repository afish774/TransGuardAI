"""Lightweight overlay primitives for decoupled full-FPS live video publishing.

Allows ``capture_worker`` to stream raw 15-30 FPS frames directly to
``MediaMTXPublisher`` while ``inference_worker`` pushes tiny (<1 KB) detection
overlay packets asynchronously — keeping browser WebRTC playback silky-smooth
without reducing AI model accuracy.
"""

from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np


class OverlayRecorder:
    """Draws OpenCV overlays onto a display frame while recording lightweight primitives."""

    __slots__ = ("items",)

    def __init__(self) -> None:
        self.items: List[Tuple] = []

    def rect(
        self,
        frame: np.ndarray,
        p1: Tuple[int, int],
        p2: Tuple[int, int],
        color: Tuple[int, int, int],
        thickness: int = 2,
    ) -> None:
        x1, y1 = int(p1[0]), int(p1[1])
        x2, y2 = int(p2[0]), int(p2[1])
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)
        self.items.append(("r", x1, y1, x2, y2, int(color[0]), int(color[1]), int(color[2]), int(thickness)))

    def text(
        self,
        frame: np.ndarray,
        label: str,
        org: Tuple[int, int],
        scale: float,
        color: Tuple[int, int, int],
        thickness: int = 2,
    ) -> None:
        x, y = int(org[0]), int(org[1])
        cv2.putText(frame, label, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness)
        self.items.append(("t", str(label), x, y, float(scale), int(color[0]), int(color[1]), int(color[2]), int(thickness)))

    def packet(self, ts: float, width: int, height: int) -> Dict[str, object]:
        return {"ts": float(ts), "w": int(width), "h": int(height), "items": self.items}


def render_overlays(
    frame: np.ndarray,
    overlay_packet: Optional[Dict[str, object]],
    now: float,
    max_age_s: float = 1.5,
) -> np.ndarray:
    """Stamp the latest AI overlay packet onto a live raw frame in <0.4 ms."""
    if overlay_packet is None:
        return frame
    ts = float(overlay_packet.get("ts", 0.0))
    if (now - ts) > max_age_s:
        return frame
    items = overlay_packet.get("items")
    if not items:
        return frame

    fh, fw = frame.shape[:2]
    src_w = int(overlay_packet.get("w", fw) or fw)
    src_h = int(overlay_packet.get("h", fh) or fh)
    sx = fw / float(src_w) if src_w > 0 else 1.0
    sy = fh / float(src_h) if src_h > 0 else 1.0

    for item in items:
        kind = item[0]
        if kind == "r":
            _, x1, y1, x2, y2, b, g, r, thickness = item
            cv2.rectangle(
                frame,
                (int(x1 * sx), int(y1 * sy)),
                (int(x2 * sx), int(y2 * sy)),
                (b, g, r),
                thickness,
            )
        elif kind == "t":
            _, label, x, y, scale, b, g, r, thickness = item
            cv2.putText(
                frame,
                label,
                (int(x * sx), int(y * sy)),
                cv2.FONT_HERSHEY_SIMPLEX,
                scale,
                (b, g, r),
                thickness,
            )
    return frame
