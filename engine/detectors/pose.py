"""Pillar 3 – Fall Detection with Biomechanical Torso Vector Analysis.

Accuracy upgrades over the previous version:
  1. Torso Inclination Angle – calculates the vector from mid-shoulder to
     mid-hip; when this vector approaches horizontal (< 35° to the ground)
     it strongly indicates a supine or prone posture, catching cases where
     the old ``nose_y >= hip_y`` heuristic failed (e.g. lying flat).
  2. Rapid Downward Centroid Velocity – tracks the person bounding-box
     centroid over consecutive frames; a sudden downward spike (> threshold
     px/s) indicates the "falling" phase before floor contact.
  3. Floor Stillness Confirmation – after the fall criteria fire, the person
     must remain mostly still (low centroid velocity) for FALL_CONFIRM_FRAMES
     consecutive frames to eliminate false alarms from bending or ducking.
"""

import cv2
import math
import logging
import time
import numpy as np
from typing import Tuple, Dict, Optional

from engine.config import FALL_ASPECT_RATIO, FALL_CONFIRM_FRAMES, FALL_VISIBILITY_THRESHOLD

log = logging.getLogger("trans-guard-engine")

# Torso angle below this (degrees from vertical) = near-horizontal = fallen
_TORSO_HORIZONTAL_DEG = 55.0
# Downward centroid velocity above this (px/s) suggests active fall
_FALL_VELOCITY_PX_S = 200.0
# Stillness threshold – centroid speed below this = "on the floor"
_STILL_PX_S = 40.0


class PoseEngine:
    def __init__(self):
        self.pose = None
        self._pose_landmark = None
        try:
            import mediapipe.python.solutions.pose as mp_pose
        except ImportError as exc:
            mp_pose = None
            log.warning(
                "Pose detection unavailable, fall/violence analysis disabled: %s", exc
            )
        if mp_pose is not None:
            self.pose = mp_pose.Pose(
                static_image_mode=False,
                model_complexity=0,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self._pose_landmark = mp_pose.PoseLandmark
        self.fall_streaks: Dict[int, int] = {}
        # Centroid trajectory history: track_id -> (centroid, timestamp)
        self._prev_centroid: Dict[int, Tuple[Tuple[float, float], float]] = {}
        # Track whether we saw a velocity spike recently: track_id -> True
        self._velocity_spike: Dict[int, bool] = {}

    @property
    def available(self) -> bool:
        return self.pose is not None

    def close(self) -> None:
        if self.pose is not None:
            self.pose.close()

    def landmarks(self, crop_bgr: np.ndarray, offset: Tuple[int, int]):
        if self.pose is None or crop_bgr is None or crop_bgr.size == 0:
            return None
        result = self.pose.process(cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB))
        if not result.pose_landmarks:
            return None
        crop_h, crop_w = crop_bgr.shape[:2]
        off_x, off_y = offset
        landmark_enum = self._pose_landmark
        points: Dict[str, Tuple[float, float, float]] = {}
        for landmark in landmark_enum:
            item = result.pose_landmarks.landmark[landmark.value]
            points[landmark.name] = (
                item.x * crop_w + off_x,
                item.y * crop_h + off_y,
                float(item.visibility),
            )
        return points

    def _torso_angle_deg(self, points) -> Optional[float]:
        """Compute the angle (degrees from vertical) of the torso vector.

        Uses mid-shoulder → mid-hip.  0° = standing upright, 90° = lying flat.
        Returns None if landmarks are not visible enough.
        """
        if not points:
            return None
        ls = points.get("LEFT_SHOULDER")
        rs = points.get("RIGHT_SHOULDER")
        lh = points.get("LEFT_HIP")
        rh = points.get("RIGHT_HIP")
        if not all([ls, rs, lh, rh]):
            return None
        vis = min(ls[2], rs[2], lh[2], rh[2])
        if vis < FALL_VISIBILITY_THRESHOLD:
            return None
        mid_sx = (ls[0] + rs[0]) / 2.0
        mid_sy = (ls[1] + rs[1]) / 2.0
        mid_hx = (lh[0] + rh[0]) / 2.0
        mid_hy = (lh[1] + rh[1]) / 2.0
        dx = mid_hx - mid_sx
        dy = mid_hy - mid_sy
        # Angle from the downward vertical (0°=standing, 90°=horizontal)
        angle_rad = math.atan2(abs(dx), abs(dy))
        return math.degrees(angle_rad)

    def _centroid_velocity(
        self, track_id: int, bbox: Tuple[int, int, int, int], now: float
    ) -> Tuple[float, float]:
        """Return (total_speed_px_s, vertical_speed_px_s) of centroid."""
        cx = (bbox[0] + bbox[2]) / 2.0
        cy = (bbox[1] + bbox[3]) / 2.0
        prev = self._prev_centroid.get(track_id)
        self._prev_centroid[track_id] = ((cx, cy), now)
        if prev is None:
            return (0.0, 0.0)
        (pcx, pcy), pt = prev
        dt = now - pt
        if dt < 1e-3:
            return (0.0, 0.0)
        dx = cx - pcx
        dy = cy - pcy
        total = math.hypot(dx, dy) / dt
        vy = dy / dt  # positive = downward in image coords
        return (total, vy)

    def is_fall(
        self,
        track_id: int,
        bbox: Tuple[int, int, int, int],
        points,
        now: Optional[float] = None,
    ) -> bool:
        ts = time.time() if now is None else now
        x1, y1, x2, y2 = bbox
        box_w, box_h = max(1, x2 - x1), max(1, y2 - y1)
        horizontal = (box_w / box_h) > FALL_ASPECT_RATIO

        # ---- Signal 1: Head below hips (original) ----
        head_below_hips = False
        if points:
            nose = points.get("NOSE")
            left_hip = points.get("LEFT_HIP")
            right_hip = points.get("RIGHT_HIP")
            if nose and left_hip and right_hip:
                visible = (
                    nose[2] >= FALL_VISIBILITY_THRESHOLD
                    and left_hip[2] >= FALL_VISIBILITY_THRESHOLD
                    and right_hip[2] >= FALL_VISIBILITY_THRESHOLD
                )
                if visible:
                    hip_y = (left_hip[1] + right_hip[1]) / 2.0
                    head_below_hips = nose[1] >= hip_y

        # ---- Signal 2: Torso angle near horizontal ----
        torso_horizontal = False
        torso_angle = self._torso_angle_deg(points)
        if torso_angle is not None and torso_angle >= _TORSO_HORIZONTAL_DEG:
            torso_horizontal = True

        # ---- Signal 3: Rapid downward centroid velocity ----
        total_speed, vy = self._centroid_velocity(track_id, bbox, ts)
        if vy > _FALL_VELOCITY_PX_S:
            self._velocity_spike[track_id] = True

        had_velocity_spike = self._velocity_spike.get(track_id, False)

        # ---- Combined decision ----
        # A "fall" frame requires a horizontal bounding box AND at least one of:
        #   - head below hips (original criterion)
        #   - torso vector near horizontal (new – catches flat lying)
        #   - recent velocity spike (active falling phase)
        #   - no skeleton available (fallback to geometry only)
        skeleton_signal = head_below_hips or torso_horizontal or had_velocity_spike
        fallen = horizontal and (skeleton_signal or not self.available)

        # Floor stillness: once fallen, require low speed to confirm
        if fallen and total_speed > _STILL_PX_S * 3:
            # Still moving fast – probably not a fall, could be rolling or getting up
            fallen = False

        streak = self.fall_streaks.get(track_id, 0) + 1 if fallen else 0
        self.fall_streaks[track_id] = streak
        if streak >= FALL_CONFIRM_FRAMES:
            self.fall_streaks[track_id] = 0
            self._velocity_spike.pop(track_id, None)
            return True

        # Decay velocity spike if not reinforced
        if not fallen and track_id in self._velocity_spike:
            del self._velocity_spike[track_id]

        return False

    def forget(self, active_ids) -> None:
        for track_id in list(self.fall_streaks):
            if track_id not in active_ids:
                del self.fall_streaks[track_id]
        for track_id in list(self._prev_centroid):
            if track_id not in active_ids:
                del self._prev_centroid[track_id]
        for track_id in list(self._velocity_spike):
            if track_id not in active_ids:
                del self._velocity_spike[track_id]

FallDetector = PoseEngine
