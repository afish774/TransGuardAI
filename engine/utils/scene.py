"""Scene pre-processing, ROI gating, vehicle motion compensation, and lightweight
appearance descriptors for transit surveillance edge inference.

All routines are designed to run in < 1.5 ms on CPU-only edge hardware.
"""

import math
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from engine.config import (
    CORRUPT_FRAME_MIN_STD,
    JOLT_CAMERA_SHAKE_PX_S,
    JOLT_COMMON_MODE_PX_S,
    JOLT_HOLD_S,
    LOW_LIGHT_LUMA,
)

# Reusable CLAHE instance (created lazily per worker)
_CLAHE = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))


def is_corrupt_frame(frame: Optional[np.ndarray], min_std: float = CORRUPT_FRAME_MIN_STD) -> bool:
    """Return True if *frame* is blank, monochrome, or an H.264 decoder glitch."""
    if frame is None or frame.size == 0:
        return True
    # Subsample 8x8 for ~0.05 ms check
    small = frame[::8, ::8]
    return float(small.std()) < min_std


def enhance_low_light(frame: np.ndarray, luma_threshold: float = LOW_LIGHT_LUMA) -> np.ndarray:
    """Apply LAB L-channel CLAHE only when the scene is dark (night/tunnel).

    Returns a new enhanced BGR array when dark, or the original *frame*
    reference untouched in normal daylight (zero allocation cost).
    """
    if frame is None or frame.size == 0:
        return frame
    # Fast luma estimate on subsampled grayscale
    gray_small = cv2.cvtColor(frame[::8, ::8], cv2.COLOR_BGR2GRAY)
    mean_luma = float(gray_small.mean())
    if mean_luma >= luma_threshold:
        return frame
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    l_eq = _CLAHE.apply(l_ch)
    merged = cv2.merge((l_eq, a_ch, b_ch))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def parse_roi_polygon(roi_spec: str, frame_w: int, frame_h: int) -> Optional[np.ndarray]:
    """Parse normalized polygon string 'x1,y1;x2,y2;x3,y3;...' into pixel vertices.

    Returns an int32 array of shape (N, 1, 2) suitable for cv2.pointPolygonTest,
    or None if *roi_spec* is empty or invalid.
    """
    if not roi_spec or not roi_spec.strip():
        return None
    pts: List[Tuple[int, int]] = []
    for token in roi_spec.strip().split(";"):
        token = token.strip()
        if not token:
            continue
        parts = token.split(",")
        if len(parts) != 2:
            continue
        try:
            nx = float(parts[0].strip())
            ny = float(parts[1].strip())
        except ValueError:
            continue
        # Support either normalised (0..1) or direct pixel coords (> 1)
        px = int(round(nx * frame_w)) if 0.0 <= nx <= 1.0 else int(round(nx))
        py = int(round(ny * frame_h)) if 0.0 <= ny <= 1.0 else int(round(ny))
        pts.append((max(0, min(frame_w - 1, px)), max(0, min(frame_h - 1, py))))
    if len(pts) < 3:
        return None
    return np.array(pts, dtype=np.int32).reshape((-1, 1, 2))


def parse_roi_polygons(multi_spec: str, frame_w: int, frame_h: int) -> List[np.ndarray]:
    """Parse multiple '|'-separated ROI polygons (e.g. seat zones)."""
    if not multi_spec or not multi_spec.strip():
        return []
    polys: List[np.ndarray] = []
    for chunk in multi_spec.split("|"):
        poly = parse_roi_polygon(chunk, frame_w, frame_h)
        if poly is not None:
            polys.append(poly)
    return polys


def point_in_roi(point: Tuple[float, float], polygon: Optional[np.ndarray]) -> bool:
    """Return True if *point* lies inside or on *polygon* (or if polygon is None)."""
    if polygon is None:
        return True
    return cv2.pointPolygonTest(polygon, (float(point[0]), float(point[1])), False) >= 0.0


def extract_appearance_hist(
    frame: Optional[np.ndarray],
    bbox: Tuple[int, int, int, int],
) -> Optional[np.ndarray]:
    """Extract a compact 2-zone (upper + lower torso) HSV color histogram.

    Used by BaggageDetector for Zero-Trust owner re-identification across
    ByteTrack ID drops without relying on coordinates alone.
    """
    if frame is None or frame.size == 0:
        return None
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    x1 = max(0, min(w - 1, int(x1)))
    y1 = max(0, min(h - 1, int(y1)))
    x2 = max(0, min(w, int(x2)))
    y2 = max(0, min(h, int(y2)))
    bw, bh = x2 - x1, y2 - y1
    if bw < 16 or bh < 24:
        return None

    # Focus on central 60% width and 15%-85% height (torso & clothing, less background)
    mx = int(bw * 0.20)
    ty1 = y1 + int(bh * 0.15)
    ty2 = y1 + int(bh * 0.85)
    tx1 = x1 + mx
    tx2 = x2 - mx
    if tx2 - tx1 < 6 or ty2 - ty1 < 12:
        return None

    crop = frame[ty1:ty2, tx1:tx2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    mid = hsv.shape[0] // 2
    upper = hsv[:mid, :]
    lower = hsv[mid:, :]

    hist_u = cv2.calcHist([upper], [0, 1], None, [12, 8], [0, 180, 0, 256]).flatten()
    hist_l = cv2.calcHist([lower], [0, 1], None, [12, 8], [0, 180, 0, 256]).flatten()
    vec = np.concatenate([hist_u, hist_l]).astype(np.float32)
    norm = float(np.linalg.norm(vec))
    if norm < 1e-6:
        return None
    return vec / norm


def hist_similarity(h1: Optional[np.ndarray], h2: Optional[np.ndarray]) -> float:
    """Cosine similarity in [0, 1] between two L2-normalized appearance histograms."""
    if h1 is None or h2 is None or h1.shape != h2.shape:
        return 0.0
    sim = float(np.dot(h1, h2))
    return max(0.0, min(1.0, sim))


class VehicleMotionEstimator:
    """Estimates global bus camera-shake and common-mode passenger sway.

    Combines:
      1. Fast downscaled grayscale phase correlation (~0.5 ms on CPU) to measure
         global frame vibration / camera shake.
      2. Median velocity across tracked passengers (>= 2 persons) to measure
         collective swaying during sudden bus braking or sharp turns.

    Returns ``(global_vx, global_vy, is_jolt)`` in pixels/second at the frame's
    native resolution so ViolenceDetector and PoseEngine can subtract bus motion
    and suppress braking-induced false alarms.
    """

    def __init__(self, downscale_w: int = 160, downscale_h: int = 90):
        self._dw = downscale_w
        self._dh = downscale_h
        self._prev_gray: Optional[np.ndarray] = None
        self._prev_ts: float = 0.0
        self._prev_centers: Dict[int, Tuple[Tuple[float, float], float]] = {}
        self._jolt_until: float = 0.0
        self._scale: float = 1.0
        self._hann: Optional[np.ndarray] = None

    def calibrate(self, frame_h: int, ref_h: int = 720) -> None:
        self._scale = frame_h / ref_h

    def update(
        self,
        frame: Optional[np.ndarray],
        persons: List[Tuple[int, Tuple[int, int, int, int]]],
        now: float,
    ) -> Tuple[Tuple[float, float], bool]:
        """Compute ``((global_vx, global_vy), is_jolt)`` for the current frame."""
        bg_vx, bg_vy = 0.0, 0.0

        # 1. Global background translation via phase correlation
        if frame is not None and frame.size > 0:
            fh, fw = frame.shape[:2]
            gray = cv2.cvtColor(
                cv2.resize(frame, (self._dw, self._dh), interpolation=cv2.INTER_AREA),
                cv2.COLOR_BGR2GRAY,
            ).astype(np.float32)

            if self._hann is None or self._hann.shape != gray.shape:
                self._hann = cv2.createHanningWindow((self._dw, self._dh), cv2.CV_32F)

            if self._prev_gray is not None and self._prev_gray.shape == gray.shape:
                dt = now - self._prev_ts
                if 1e-3 < dt <= 0.6:
                    (shift_x, shift_y), response = cv2.phaseCorrelate(
                        self._prev_gray, gray, self._hann
                    )
                    # Only trust phase correlation when peak response is meaningful
                    if response >= 0.15:
                        sx = shift_x * (fw / float(self._dw))
                        sy = shift_y * (fh / float(self._dh))
                        bg_vx = sx / dt
                        bg_vy = sy / dt

            self._prev_gray = gray
            self._prev_ts = now

        # 2. Common-mode (median) velocity across tracked passengers
        vxs: List[float] = []
        vys: List[float] = []
        curr_centers: Dict[int, Tuple[float, float]] = {}
        for pid, (x1, y1, x2, y2) in persons:
            cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
            curr_centers[pid] = (cx, cy)
            prev = self._prev_centers.get(pid)
            if prev is not None:
                (pcx, pcy), pts = prev
                dt = now - pts
                if 1e-3 < dt <= 0.5:
                    vxs.append((cx - pcx) / dt)
                    vys.append((cy - pcy) / dt)

        # Refresh passenger centroid memory
        self._prev_centers = {pid: (pt, now) for pid, pt in curr_centers.items()}

        cm_vx, cm_vy = 0.0, 0.0
        if len(vxs) >= 3:
            # Median of >= 3 people isolates shared vehicle acceleration/braking
            # while remaining immune to a single running person or fighting pair
            vxs.sort()
            vys.sort()
            mid = len(vxs) // 2
            cm_vx = vxs[mid]
            cm_vy = vys[mid]

        bg_speed = math.hypot(bg_vx, bg_vy)
        cm_speed = math.hypot(cm_vx, cm_vy)

        if (
            bg_speed >= JOLT_CAMERA_SHAKE_PX_S * self._scale
            or cm_speed >= JOLT_COMMON_MODE_PX_S * self._scale
        ):
            self._jolt_until = max(self._jolt_until, now + JOLT_HOLD_S)

        # Use the stronger of background camera shift or common-mode passenger sway
        if cm_speed > bg_speed:
            global_vel = (cm_vx, cm_vy)
        else:
            global_vel = (bg_vx, bg_vy)

        is_jolt = now < self._jolt_until
        return global_vel, is_jolt
