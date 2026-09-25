import math
from typing import Tuple, Dict, Optional
import numpy as np

def bbox_center(b: Tuple[int, int, int, int]) -> Tuple[float, float]:
    x1, y1, x2, y2 = b
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

def dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])

def boxes_intersect_with_radius(bag_bbox, person_bbox, radius) -> bool:
    bx1, by1, bx2, by2 = bag_bbox
    px1, py1, px2, py2 = person_bbox
    ex1, ey1, ex2, ey2 = bx1 - radius, by1 - radius, bx2 + radius, by2 + radius
    return not (px2 < ex1 or px1 > ex2 or py2 < ey1 or py1 > ey2)

def bbox_iou(a: Tuple[int, int, int, int], b: Tuple[int, int, int, int]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    intersection = float(iw * ih)
    if intersection <= 0.0:
        return 0.0
    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    union = float(area_a + area_b - intersection)
    return intersection / union if union > 0 else 0.0

def crop_bbox(frame: np.ndarray, bbox: Tuple[int, int, int, int], padding: float = 0.0):
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    if padding > 0.0:
        pad_x = int((x2 - x1) * padding)
        pad_y = int((y2 - y1) * padding)
        x1, y1, x2, y2 = x1 - pad_x, y1 - pad_y, x2 + pad_x, y2 + pad_y
    x1 = max(0, min(width - 1, x1))
    y1 = max(0, min(height - 1, y1))
    x2 = max(0, min(width, x2))
    y2 = max(0, min(height, y2))
    if x2 - x1 < 8 or y2 - y1 < 8:
        return None, (0, 0)
    return frame[y1:y2, x1:x2], (x1, y1)

def extract_face_box_from_landmarks(
    points: Dict[str, Tuple[float, float, float]],
    frame_w: int,
    frame_h: int,
    offset: Tuple[int, int] = (0, 0),
) -> Optional[Tuple[int, int, int, int]]:
    if not points:
        return None
    nose = points.get("NOSE")
    if not nose or nose[2] < 0.35:
        return None

    face_keys = ("NOSE", "LEFT_EYE", "RIGHT_EYE", "LEFT_EAR", "RIGHT_EAR",
                 "LEFT_EYE_INNER", "RIGHT_EYE_INNER", "LEFT_EYE_OUTER", "RIGHT_EYE_OUTER",
                 "MOUTH_LEFT", "MOUTH_RIGHT")
    face_pts = [points[k] for k in face_keys if k in points and points[k][2] >= 0.35]
    if len(face_pts) < 2:
        return None

    off_x, off_y = offset
    xs = [p[0] - off_x for p in face_pts]
    ys = [p[1] - off_y for p in face_pts]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    span_x = max(30.0, max_x - min_x)
    span_y = max(30.0, max_y - min_y)

    pad_x = span_x * 0.60
    pad_y_top = span_y * 0.90
    pad_y_bot = span_y * 0.70

    left = int(max(0, min_x - pad_x))
    right = int(min(frame_w, max_x + pad_x))
    top = int(max(0, min_y - pad_y_top))
    bottom = int(min(frame_h, max_y + pad_y_bot))

    if bottom - top < 25 or right - left < 25:
        return None
    return (top, right, bottom, left)
