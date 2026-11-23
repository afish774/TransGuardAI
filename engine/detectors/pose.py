"""Pillar 3 – Fall Detection with Biomechanical Torso Vector Analysis & Standing Height Ref.

Accuracy & Stability Upgrades:
  1. Stateless Multi-Person MediaPipe (static_image_mode=True) – prevents
     internal MediaPipe tracking state from bleeding across different passengers
     processed in the same frame loop. Also supports optional single-pass
     YOLO-pose models via POSE_MODEL env var.
  2. Signed Torso Inclination Angle (0°=upright, 90°=flat, 180°=inverted) –
     fixes abs(dy) folding where upside-down / head-below-hips collapses looked
     like 0° upright.
  3. Personal Standing Height Reference (H_0) – tracks each passenger's upright
     height to reject wide-bbox standing postures while adapting automatically
     to camera perspective depth.
  4. Vehicle Motion Compensation & Jolt Dampening – subtracts global bus sway
     and suppresses downward velocity spikes during sudden braking / potholes.
  5. Floor Stillness + Seizure Soft-Gate – confirms immobile collapses rapidly
     while still catching convulsive/struggling falls at a reduced streak rate.
"""

import cv2
import math
import logging
import os
import time
import numpy as np
from typing import Tuple, Dict, List, Optional

from engine.config import (
    FALL_ASPECT_RATIO,
    FALL_CONFIRM_FRAMES,
    FALL_VISIBILITY_THRESHOLD,
    POSE_MODEL,
    resolve_compute_device,
)
from engine.utils.geometry import bbox_iou

log = logging.getLogger("trans-guard-engine")

# Torso angle above this (degrees from vertical) = near-horizontal = fallen
_TORSO_HORIZONTAL_DEG = 65.0
# Downward centroid velocity above this (px/s at 720p) suggests active fall
_FALL_VELOCITY_PX_S = 320.0
# Stillness threshold – centroid speed below this (px/s at 720p) = "on the floor"
_STILL_PX_S = 25.0

# COCO 17-keypoint index -> MediaPipe-compatible landmark name mapping
_COCO_KP_NAMES = {
    0: "NOSE",
    1: "LEFT_EYE",
    2: "RIGHT_EYE",
    3: "LEFT_EAR",
    4: "RIGHT_EAR",
    5: "LEFT_SHOULDER",
    6: "RIGHT_SHOULDER",
    7: "LEFT_ELBOW",
    8: "RIGHT_ELBOW",
    9: "LEFT_WRIST",
    10: "RIGHT_WRIST",
    11: "LEFT_HIP",
    12: "RIGHT_HIP",
    13: "LEFT_KNEE",
    14: "RIGHT_KNEE",
    15: "LEFT_ANKLE",
    16: "RIGHT_ANKLE",
}


class PoseEngine:
    def __init__(self, pose_model_path: str = POSE_MODEL):
        self.pose = None
        self._pose_landmark = None
        self._yolo_pose = None
        self._device, self._use_half, self._device_label = resolve_compute_device()

        # Single-pass multi-person YOLO-pose upgrade (auto-downloads standard
        # Ultralytics hub models like yolo11s-pose.pt on first GPU run, or loads local .pt)
        if pose_model_path:
            try:
                from ultralytics import YOLO
                self._yolo_pose = YOLO(pose_model_path)
                log.info(
                    "Loaded single-pass YOLO-pose model '%s' on %s",
                    pose_model_path,
                    self._device_label,
                )
            except Exception as exc:
                log.warning(
                    "Failed to load YOLO-pose '%s', falling back to MediaPipe Pose: %s",
                    pose_model_path,
                    exc,
                )
                self._yolo_pose = None

        if self._yolo_pose is None:
            try:
                import mediapipe.python.solutions.pose as mp_pose
            except ImportError as exc:
                mp_pose = None
                log.warning(
                    "Pose detection unavailable, fall/violence analysis disabled: %s", exc
                )
            if mp_pose is not None:
                # CRITICAL: static_image_mode=True because this single instance
                # processes independent crops of multiple different passengers per frame.
                # static_image_mode=False corrupts internal tracking priors across people!
                self.pose = mp_pose.Pose(
                    static_image_mode=True,
                    model_complexity=0,
                    min_detection_confidence=0.5,
                )
                self._pose_landmark = mp_pose.PoseLandmark

        self.fall_streaks: Dict[int, float] = {}
        # Centroid trajectory history: track_id -> (centroid, timestamp)
        self._prev_centroid: Dict[int, Tuple[Tuple[float, float], float]] = {}
        # Track downward velocity spike timestamps: track_id -> timestamp
        self._velocity_spike: Dict[int, float] = {}
        # Observed upright standing height per track for perspective-invariant collapse checks
        self._standing_height: Dict[int, float] = {}
        # Resolution scale factor (1.0 = 720p reference)
        self._scale: float = 1.0

    def calibrate(self, frame_h: int, ref_h: int = 720) -> None:
        """Set resolution scale factor for pixel-based thresholds."""
        self._scale = frame_h / ref_h

    @property
    def available(self) -> bool:
        return self.pose is not None or getattr(self, "_yolo_pose", None) is not None

    @property
    def uses_yolo_pose(self) -> bool:
        return getattr(self, "_yolo_pose", None) is not None

    def close(self) -> None:
        if self.pose is not None:
            self.pose.close()

    def extract_frame_poses(
        self,
        frame_bgr: np.ndarray,
        persons: List[Tuple[int, Tuple[int, int, int, int]]],
    ) -> Dict[int, Dict[str, Tuple[float, float, float]]]:
        """Single-pass multi-person pose estimation when YOLO-pose is configured."""
        yolo_pose = getattr(self, "_yolo_pose", None)
        if yolo_pose is None or not persons or frame_bgr is None or frame_bgr.size == 0:
            return {}
        try:
            res = yolo_pose.predict(
                frame_bgr,
                verbose=False,
                conf=0.35,
                device=getattr(self, "_device", "cpu"),
                half=getattr(self, "_use_half", False),
            )[0]
        except Exception as exc:
            log.debug("YOLO-pose inference error: %s", exc)
            return {}
        if res.boxes is None or res.keypoints is None or len(res.boxes) == 0:
            return {}

        pose_boxes = [tuple(int(v) for v in b.tolist()) for b in res.boxes.xyxy]
        kps_xy = res.keypoints.xy.cpu().numpy()
        kps_conf = res.keypoints.conf.cpu().numpy() if res.keypoints.conf is not None else None

        landmarks_by_id: Dict[int, Dict[str, Tuple[float, float, float]]] = {}
        used_pose_idx = set()
        for track_id, pbox in persons:
            best_idx = -1
            best_iou = 0.25
            for idx, kbox in enumerate(pose_boxes):
                if idx in used_pose_idx:
                    continue
                iou = bbox_iou(pbox, kbox)
                if iou > best_iou:
                    best_iou = iou
                    best_idx = idx
            if best_idx < 0:
                continue
            used_pose_idx.add(best_idx)
            pts: Dict[str, Tuple[float, float, float]] = {}
            for kp_i, kp_name in _COCO_KP_NAMES.items():
                if kp_i < kps_xy.shape[1]:
                    x, y = float(kps_xy[best_idx, kp_i, 0]), float(kps_xy[best_idx, kp_i, 1])
                    c = float(kps_conf[best_idx, kp_i]) if kps_conf is not None else 0.9
                    if x > 0.0 or y > 0.0:
                        pts[kp_name] = (x, y, c)
            if pts:
                landmarks_by_id[track_id] = pts
        return landmarks_by_id

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
        """Compute signed torso inclination angle (degrees from upright vertical).

        Uses mid-shoulder -> mid-hip in image coordinates (+y is downward):
          -   0° = standing straight upright (shoulders directly above hips)
          -  90° = lying flat horizontal (shoulders and hips at same y)
          - 180° = inverted / head-below-hips (shoulders below hips)
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
        # Shoulders and hips at the exact same vertical level (flat/foreshortened)
        if abs(dx) < 1e-3 and abs(dy) < 1e-3:
            return 90.0
        # Signed dy: positive = upright, 0 = flat, negative = inverted (>90°)
        angle_rad = math.atan2(abs(dx), dy)
        return math.degrees(angle_rad)

    def _centroid_velocity(
        self,
        track_id: int,
        bbox: Tuple[int, int, int, int],
        now: float,
        global_vel: Tuple[float, float] = (0.0, 0.0),
    ) -> Tuple[float, float]:
        """Return motion-compensated (total_speed_px_s, vertical_speed_px_s) of centroid."""
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
        vx = (cx - pcx) / dt - global_vel[0]
        vy = (cy - pcy) / dt - global_vel[1]  # positive = downward in image coords
        total = math.hypot(vx, vy)
        return (total, vy)

    def is_fall(
        self,
        track_id: int,
        bbox: Tuple[int, int, int, int],
        points,
        now: Optional[float] = None,
        global_vel: Tuple[float, float] = (0.0, 0.0),
        is_jolt: bool = False,
        in_seat_zone: bool = False,
    ) -> bool:
        ts = time.time() if now is None else now
        x1, y1, x2, y2 = bbox
        box_w, box_h = max(1, x2 - x1), max(1, y2 - y1)
        horizontal = (box_w / box_h) > FALL_ASPECT_RATIO

        standing_heights = getattr(self, "_standing_height", None)
        if standing_heights is None:
            standing_heights = {}
            self._standing_height = standing_heights

        # ---- Signal 1: Head below hips ----
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

        # ---- Signal 2: Signed torso inclination angle ----
        torso_horizontal = False
        torso_angle = self._torso_angle_deg(points)
        if torso_angle is not None and torso_angle >= _TORSO_HORIZONTAL_DEG:
            torso_horizontal = True

        # ---- Signal 3: Motion-compensated downward centroid velocity ----
        total_speed, vy = self._centroid_velocity(track_id, bbox, ts, global_vel=global_vel)
        scaled_fall_vel = _FALL_VELOCITY_PX_S * self._scale
        scaled_still = _STILL_PX_S * self._scale
        # Suppress braking/pothole-induced velocity spikes during vehicle jolts
        if not is_jolt and vy > scaled_fall_vel:
            self._velocity_spike[track_id] = ts

        spike_val = self._velocity_spike.get(track_id, 0.0)
        # Backward-compatible handling if a test writes boolean True into _velocity_spike
        if isinstance(spike_val, bool):
            had_velocity_spike = spike_val
        else:
            had_velocity_spike = (ts - float(spike_val)) <= 1.5 if spike_val > 0.0 else False

        # Upright posture hard veto: shoulders clearly above hips & head not below hips
        if torso_angle is not None and torso_angle < 45.0 and not head_below_hips:
            if not horizontal:
                prev_h = standing_heights.get(track_id, 0.0)
                standing_heights[track_id] = max(prev_h, float(box_h))
            self.fall_streaks[track_id] = 0.0
            self._velocity_spike.pop(track_id, None)
            return False

        # Standing-height sanity check: if we previously saw this person upright
        # at height H_0 and their current box height is still > 75% of H_0, they
        # are standing with wide arms/bag, not collapsed on the floor.
        ref_h = standing_heights.get(track_id)
        height_collapsed = True if ref_h is None else (box_h <= ref_h * 0.75)

        # ---- Combined decision ----
        if points and (head_below_hips or torso_horizontal):
            fall_posture = horizontal and height_collapsed
        elif not points or not self.available:
            # Occluded skeleton fallback: require horizontal bbox + recent drop + collapse
            fall_posture = horizontal and had_velocity_spike and height_collapsed
        else:
            fall_posture = False

        # Determine streak increment based on post-fall stillness
        if fall_posture:
            if total_speed > scaled_still * 2.5:
                # High post-fall movement (possible seizure/convulsion or rolling):
                # build streak slowly so brief bends/rolls don't false-alarm while
                # sustained medical emergencies still trigger.
                streak = self.fall_streaks.get(track_id, 0.0) + 0.35
            else:
                # Still on the floor
                streak = self.fall_streaks.get(track_id, 0.0) + 1.0
        else:
            streak = max(0.0, self.fall_streaks.get(track_id, 0.0) - 1.0)

        self.fall_streaks[track_id] = streak
        # Require extra persistence inside designated seat zones (reduces sleeping false alarms)
        required = FALL_CONFIRM_FRAMES * 1.5 if in_seat_zone else float(FALL_CONFIRM_FRAMES)
        if streak >= required:
            self.fall_streaks[track_id] = 0.0
            self._velocity_spike.pop(track_id, None)
            return True

        # Expire stale velocity spikes
        if track_id in self._velocity_spike and not isinstance(self._velocity_spike[track_id], bool):
            if (ts - float(self._velocity_spike[track_id])) > 2.0:
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
        standing_heights = getattr(self, "_standing_height", None)
        if standing_heights is not None:
            for track_id in list(standing_heights):
                if track_id not in active_ids:
                    del standing_heights[track_id]


FallDetector = PoseEngine
