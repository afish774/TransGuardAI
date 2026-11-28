"""Pillar 5 – Violence Detection with Kinetic Moving Average, Body Kinetic Fallback,
and Spatial Interaction Persistence.

v2 Accuracy and Resilience Upgrades:
  1. Kinetic Energy EMA – Sustained striking motions build up EMA; isolated gestures decay.
  2. Spatial Pair Relinking – When ByteTrack swaps or drops person IDs during rapid
     grappling/scuffles, the violent interaction history at that location is preserved.
  3. Body Kinetic Velocity Fallback – When MediaPipe pose misses wrist landmarks due to
     blur or speed, person centroid speed and bounding-box volatility provide a reliable
     kinetic proxy.
  4. Proximity & Close-Contact Coupling – Detects fights occurring at arm's length or
     side-by-side (IoU >= 0.08 OR center distance <= VIOLENCE_PROXIMITY_PX).
  5. Mutual Convergence & Oscillating Striking – Rapid approach dynamics and directional
     flailing patterns confirm active aggression.
"""

import time
import math
from collections import deque
from concurrent.futures import Future
from typing import Deque, Dict, Tuple, List, Optional

import numpy as np

from engine.config import (
    FALL_VISIBILITY_THRESHOLD,
    VIOLENCE_IOU_THRESHOLD,
    VIOLENCE_PROXIMITY_PX,
    VIOLENCE_WRIST_SPEED_PX_S,
    VIOLENCE_BODY_SPEED_PX_S,
    VIOLENCE_CONFIRM_FRAMES,
    VIOLENCE_PAIR_TTL_S,
)
from engine.utils.geometry import (
    dist,
    bbox_iou,
    bbox_center,
    boxes_intersect_with_radius,
    crop_bbox,
)


# EMA time constant in seconds (replaces fixed alpha for FPS independence)
_KINETIC_EMA_TAU_S = 0.20
# Minimum mutual convergence speed (px/s at 720p) to count as "approaching"
_CONVERGENCE_PX_S = 80.0
# Wrist direction-change threshold (px/s at 720p) to count as "oscillation"
_OSCILLATION_SPEED_THRESHOLD = 200.0
# Spatial relink radius for fighting pairs when tracker IDs flicker
_SPATIAL_PAIR_RELINK_PX = 120.0
# Stage-2 visual VLM cache windows per pair (seconds)
_VLM_PASS_CACHE_S = 1.2
_VLM_REJECT_CACHE_S = 1.5


class ViolenceDetector:
    def __init__(self, vlm=None):
        # Track-based pair states: (id_a, id_b) -> {"streak": float, "last": float, "peak": float, "midpoint": (x, y)}
        self.pairs: Dict[Tuple[int, int], Dict[str, object]] = {}
        # Spatial graveyard of recent violent interactions for relinking across ID switches:
        # list of {"midpoint": (x, y), "streak": float, "peak": float, "last": float}
        self._spatial_history: List[Dict[str, object]] = []
        self.previous_wrists: Dict[int, Tuple[Dict[str, Tuple[float, float]], float]] = {}
        # Centroid history for convergence and body velocity: id -> ((x, y), timestamp)
        self._prev_centroid: Dict[int, Tuple[Tuple[float, float], float]] = {}
        # Wrist kinetic EMA per track
        self._kinetic_ema: Dict[int, float] = {}
        # Body centroid kinetic EMA per track (pose-free fallback)
        self._body_ema: Dict[int, float] = {}
        # Previous wrist horizontal & vertical velocity per track (for 2D oscillation)
        self._prev_wrist_vx: Dict[int, float] = {}
        self._prev_wrist_vy: Dict[int, float] = {}
        # Oscillation counter per track
        self._oscillation_count: Dict[int, int] = {}
        # Shared Stage-2 GPU Vision-Language Verifier (optional; 0 extra VRAM)
        self.vlm = vlm
        # Per-pair async VLM state: key -> {"status": str, "ts": float, "future": Optional[Future]}
        self._vlm_cache: Dict[Tuple[int, int], Dict[str, object]] = {}
        # Incremental 768-D SigLIP embedding ring buffer per pair (encodes 1 frame/check instead of 4x!)
        self._pair_embeds: Dict[Tuple[int, int], Deque[np.ndarray]] = {}
        # Resolution scale factor (1.0 = 720p reference)
        self._scale: float = 1.0

    def calibrate(self, frame_h: int, ref_h: int = 720) -> None:
        """Set resolution scale factor for pixel-based thresholds."""
        self._scale = frame_h / ref_h

    @staticmethod
    def _wrists(points) -> Dict[str, Tuple[float, float]]:
        wrists: Dict[str, Tuple[float, float]] = {}
        if not points:
            return wrists
        for name in ("LEFT_WRIST", "RIGHT_WRIST"):
            landmark = points.get(name)
            if landmark and landmark[2] >= FALL_VISIBILITY_THRESHOLD:
                wrists[name] = (landmark[0], landmark[1])
        return wrists

    def wrist_speed(
        self,
        track_id: int,
        points,
        now: float,
        global_vel: Tuple[float, float] = (0.0, 0.0),
    ) -> float:
        wrists = self._wrists(points)
        previous = self.previous_wrists.get(track_id)
        self.previous_wrists[track_id] = (wrists, now)
        if not previous or not wrists:
            return 0.0
        old_wrists, old_time = previous
        elapsed = now - old_time
        if elapsed <= 1e-3:
            return 0.0
        gvx, gvy = global_vel
        speeds = []
        vx_values = []
        vy_values = []
        for name, position in wrists.items():
            if name in old_wrists:
                vx = (position[0] - old_wrists[name][0]) / elapsed - gvx
                vy = (position[1] - old_wrists[name][1]) / elapsed - gvy
                speeds.append(math.hypot(vx, vy))
                vx_values.append(vx)
                vy_values.append(vy)

        if not speeds:
            return 0.0

        peak = max(speeds)

        # Update kinetic EMA with FPS-adaptive alpha
        alpha = 1.0 - math.exp(-elapsed / _KINETIC_EMA_TAU_S) if elapsed > 1e-6 else 0.0
        prev_ema = self._kinetic_ema.get(track_id, 0.0)
        self._kinetic_ema[track_id] = (
            alpha * peak + (1 - alpha) * prev_ema
        )

        # Track 2D oscillation (horizontal jabs/shoves OR vertical strikes)
        if vx_values or vy_values:
            avg_vx = sum(vx_values) / len(vx_values) if vx_values else 0.0
            avg_vy = sum(vy_values) / len(vy_values) if vy_values else 0.0
            prev_vx = self._prev_wrist_vx.get(track_id, 0.0)
            prev_vy = self._prev_wrist_vy.get(track_id, 0.0)
            self._prev_wrist_vx[track_id] = avg_vx
            self._prev_wrist_vy[track_id] = avg_vy
            osc_thresh = _OSCILLATION_SPEED_THRESHOLD * self._scale
            horiz_rev = (prev_vx * avg_vx < 0) and (abs(avg_vx) > osc_thresh)
            vert_rev = (prev_vy * avg_vy < 0) and (abs(avg_vy) > osc_thresh)
            if horiz_rev or vert_rev:
                self._oscillation_count[track_id] = (
                    self._oscillation_count.get(track_id, 0) + 1
                )
            else:
                osc = self._oscillation_count.get(track_id, 0)
                if osc > 0:
                    self._oscillation_count[track_id] = max(0, osc - 1)

        return peak

    def _body_velocity(
        self,
        pid: int,
        center: Tuple[float, float],
        now: float,
        global_vel: Tuple[float, float] = (0.0, 0.0),
    ) -> Tuple[float, Tuple[float, float]]:
        """Compute motion-compensated whole-body centroid speed & vector and update EMA."""
        prev = self._prev_centroid.get(pid)
        if prev is None:
            return 0.0, (0.0, 0.0)
        elapsed = now - prev[1]
        if elapsed <= 1e-3 or elapsed > 0.6:
            return 0.0, (0.0, 0.0)
        vx = (center[0] - prev[0][0]) / elapsed - global_vel[0]
        vy = (center[1] - prev[0][1]) / elapsed - global_vel[1]
        speed = math.hypot(vx, vy)

        alpha = 1.0 - math.exp(-elapsed / _KINETIC_EMA_TAU_S)
        prev_body_ema = self._body_ema.get(pid, 0.0)
        self._body_ema[pid] = alpha * speed + (1.0 - alpha) * prev_body_ema
        return speed, (vx, vy)

    def _body_speed(
        self,
        pid: int,
        center: Tuple[float, float],
        now: float,
        global_vel: Tuple[float, float] = (0.0, 0.0),
    ) -> float:
        speed, _ = self._body_velocity(pid, center, now, global_vel=global_vel)
        return speed

    def _convergence_speed(
        self, id_a: int, ca: Tuple[float, float],
        id_b: int, cb: Tuple[float, float],
        now: float,
    ) -> float:
        """Return rate of distance decrease between two people (px/s). Positive = closing in."""
        current_dist = dist(ca, cb)
        prev_a = self._prev_centroid.get(id_a)
        prev_b = self._prev_centroid.get(id_b)

        if prev_a is None or prev_b is None:
            return 0.0

        if (now - prev_a[1]) > 0.5 or (now - prev_b[1]) > 0.5:
            return 0.0

        prev_dist = dist(prev_a[0], prev_b[0])
        dt = (now - prev_a[1] + now - prev_b[1]) / 2.0
        if dt < 1e-3:
            return 0.0

        return (prev_dist - current_dist) / dt

    def _check_vlm_pair(
        self,
        key: Tuple[int, int],
        box_a: Tuple[int, int, int, int],
        box_b: Tuple[int, int, int, int],
        frame: Optional[np.ndarray],
        now: float,
        sync: bool = False,
    ) -> str:
        """Stage-2 visual verification of a kinematic violence candidate pair.

        Returns ``"PASS"``, ``"REJECT"``, or ``"PENDING"``.
        Passes straight through if no VLM or frame is provided.
        """
        if self.vlm is None or not self.vlm.available or frame is None or frame.size == 0:
            return "PASS"

        state = self._vlm_cache.get(key)
        if state is None:
            state = {"status": "NONE", "ts": 0.0, "future": None}
            self._vlm_cache[key] = state

        # 1. Harvest finished async GPU job
        fut: Optional[Future] = state.get("future")
        if fut is not None:
            if fut.done():
                state["future"] = None
                new_emb = None
                try:
                    res = fut.result()
                    if isinstance(res, tuple) and len(res) == 2:
                        passed = bool(res[0])
                        new_emb = res[1]
                    else:
                        passed = bool(res)
                except Exception:
                    passed = False
                if new_emb is not None:
                    ebuf = self._pair_embeds.get(key)
                    if ebuf is None:
                        ebuf = deque(maxlen=4)
                        self._pair_embeds[key] = ebuf
                    ebuf.append(new_emb)
                state["status"] = "PASS" if passed else "REJECT"
                state["ts"] = now
            else:
                return "PENDING"

        status = str(state.get("status", "NONE"))
        age = now - float(state.get("ts", 0.0))
        ebuf_len = len(self._pair_embeds.get(key, ()))
        if 1 <= ebuf_len < 4:
            pass_ttl = 0.30
            reject_ttl = 0.30
        else:
            pass_ttl = _VLM_PASS_CACHE_S
            reject_ttl = _VLM_REJECT_CACHE_S
        if status == "PASS" and age < pass_ttl:
            return "PASS"
        if status == "REJECT" and age < reject_ttl:
            return "REJECT"

        # 2. Extract 1.15x union crop covering both interacting persons
        union_box = (
            min(box_a[0], box_b[0]),
            min(box_a[1], box_b[1]),
            max(box_a[2], box_b[2]),
            max(box_a[3], box_b[3]),
        )
        pair_crop, _ = crop_bbox(frame, union_box, padding=0.15)
        if pair_crop is None or pair_crop.size == 0:
            return "REJECT"

        prev_embeds = list(self._pair_embeds.get(key, ()))

        # 3. Synchronous path (tests / no executor) vs non-blocking incremental GPU job
        if sync or getattr(self.vlm, "_executor", None) is None:
            if hasattr(self.vlm, "verify_violence_step"):
                passed, new_emb = self.vlm.verify_violence_step(pair_crop, prev_embeds, max_len=4)
                if new_emb is not None:
                    ebuf = self._pair_embeds.get(key)
                    if ebuf is None:
                        ebuf = deque(maxlen=4)
                        self._pair_embeds[key] = ebuf
                    ebuf.append(new_emb)
            else:
                passed = bool(self.vlm.verify_violence(pair_crop))
            state["status"] = "PASS" if passed else "REJECT"
            state["ts"] = now
            return str(state["status"])

        if hasattr(self.vlm, "submit_violence_step"):
            state["future"] = self.vlm.submit_violence_step(pair_crop, prev_embeds, max_len=4)
        else:
            state["future"] = self.vlm.submit_violence(pair_crop)
        state["status"] = "PENDING"
        return "PENDING"

    def evaluate(
        self,
        persons: List[Tuple[int, Tuple[int, int, int, int]]],
        speeds: Dict[int, float],
        now: float,
        global_vel: Tuple[float, float] = (0.0, 0.0),
        is_jolt: bool = False,
        frame: Optional[np.ndarray] = None,
        sync_vlm: bool = False,
    ):
        confirmed = []
        centers = {pid: bbox_center(pbox) for pid, pbox in persons}
        scaled_wrist = VIOLENCE_WRIST_SPEED_PX_S * self._scale
        scaled_body = VIOLENCE_BODY_SPEED_PX_S * self._scale
        scaled_conv = _CONVERGENCE_PX_S * self._scale
        scaled_proximity = VIOLENCE_PROXIMITY_PX * self._scale

        # Clean expired spatial history
        self._spatial_history = [
            item for item in self._spatial_history
            if now - float(item["last"]) <= VIOLENCE_PAIR_TTL_S
        ]

        # Calculate motion-compensated whole-body speeds & velocity vectors
        body_speeds: Dict[int, float] = {}
        body_vecs: Dict[int, Tuple[float, float]] = {}
        for pid, pt in centers.items():
            spd, vec = self._body_velocity(pid, pt, now, global_vel=global_vel)
            body_speeds[pid] = spd
            body_vecs[pid] = vec

        for index, (id_a, box_a) in enumerate(persons):
            for id_b, box_b in persons[index + 1:]:
                iou = bbox_iou(box_a, box_b)
                ca = centers[id_a]
                cb = centers[id_b]
                center_d = dist(ca, cb)

                # Scale-adaptive arm's-length contact check: two foreground people
                # (~200px wide) standing chest-to-chest have center_d >= 200px even
                # when actively trading punches, so check box edge distance too.
                avg_w = 0.5 * ((box_a[2] - box_a[0]) + (box_b[2] - box_b[0]))
                arm_reach_px = max(55.0 * self._scale, min(140.0 * self._scale, avg_w * 0.45))
                is_contact = (
                    (iou >= VIOLENCE_IOU_THRESHOLD)
                    or (center_d <= scaled_proximity)
                    or boxes_intersect_with_radius(box_a, box_b, arm_reach_px)
                )
                if not is_contact:
                    continue

                key = (min(id_a, id_b), max(id_a, id_b))
                midpoint = ((ca[0] + cb[0]) / 2.0, (ca[1] + cb[1]) / 2.0)

                # Kinetic indicators: wrists (from pose) and bodies (pose-free fallback)
                wrist_peak = max(speeds.get(id_a, 0.0), speeds.get(id_b, 0.0))
                wrist_ema = max(self._kinetic_ema.get(id_a, 0.0), self._kinetic_ema.get(id_b, 0.0))
                body_peak = max(body_speeds.get(id_a, 0.0), body_speeds.get(id_b, 0.0))
                body_ema = max(self._body_ema.get(id_a, 0.0), self._body_ema.get(id_b, 0.0))

                va = body_vecs.get(id_a, (0.0, 0.0))
                vb = body_vecs.get(id_b, (0.0, 0.0))
                rel_body_speed = math.hypot(va[0] - vb[0], va[1] - vb[1])

                conv = self._convergence_speed(id_a, ca, id_b, cb, now)
                max_osc = max(self._oscillation_count.get(id_a, 0), self._oscillation_count.get(id_b, 0))

                effective_peak = max(wrist_peak, body_peak)

                # Retrieve existing pair entry, or check spatial history if tracker swapped IDs
                entry = self.pairs.get(key)
                if entry is None:
                    # Check spatial history within relink distance
                    best_match = None
                    best_d = float("inf")
                    for hist in self._spatial_history:
                        d = dist(midpoint, hist["midpoint"])
                        if d < _SPATIAL_PAIR_RELINK_PX * self._scale and d < best_d:
                            best_d = d
                            best_match = hist

                    if best_match is not None:
                        entry = {
                            "streak": float(best_match["streak"]),
                            "last": now,
                            "peak": float(best_match["peak"]),
                            "midpoint": midpoint,
                            "first_contact": float(best_match.get("first_contact", now)),
                        }
                    else:
                        entry = {"streak": 0.0, "last": now, "peak": 0.0, "midpoint": midpoint, "first_contact": now}
                    self.pairs[key] = entry
                else:
                    entry["last"] = now
                    entry["midpoint"] = midpoint

                # During a sudden vehicle jolt (emergency braking / pothole),
                # freeze violence accumulation so collective swaying doesn't false-alarm.
                if is_jolt:
                    entry["streak"] = max(0.0, float(entry["streak"]) - 0.2)
                    continue

                # Multi-modal Violence Detection logic (calibrated for 6-25 FPS CCTV):
                # 1. High sustained wrist kinetic energy (pose strikes)
                # 2. Fast toe-to-toe punch/slap peak (catches strikes without needing charge-in)
                # 3. Repeated oscillating strikes (horizontal/vertical punching/flailing)
                # 4. Whole-body rapid scuffling or close-overlap grappling/shoving with
                #    differential inter-person motion (rejects parallel walking & calm standing)
                is_violent_frame = False
                streak_gain = 1.0
                if wrist_ema >= scaled_wrist * 0.72:
                    is_violent_frame = True
                elif wrist_peak >= scaled_wrist * 0.90:
                    is_violent_frame = True
                elif wrist_peak >= scaled_wrist * 0.75 and conv > scaled_conv * 0.75:
                    is_violent_frame = True
                elif max_osc >= 2 and wrist_ema >= scaled_wrist * 0.55:
                    is_violent_frame = True
                elif (
                    body_ema >= scaled_body * 0.70
                    and rel_body_speed >= scaled_body * 0.35
                    and is_contact
                    and (conv > scaled_conv * 0.4 or max_osc >= 1 or iou >= 0.14)
                ):
                    is_violent_frame = True
                elif (
                    body_peak >= scaled_body * 0.90
                    and rel_body_speed >= scaled_body * 0.40
                    and (conv > scaled_conv * 0.6 or iou >= 0.14)
                ):
                    is_violent_frame = True
                elif (
                    iou >= 0.15
                    and (
                        rel_body_speed >= scaled_body * 0.35
                        or (body_peak >= scaled_body * 0.55 and rel_body_speed >= scaled_body * 0.25)
                    )
                ):
                    # Close-overlap grappling/wrestling fallback when wrists are occluded
                    is_violent_frame = True
                    streak_gain = 0.85

                if is_violent_frame:
                    entry["streak"] += streak_gain
                    entry["peak"] = max(float(entry["peak"]), effective_peak)
                    # Update spatial history so ID switches retain streak
                    self._spatial_history.append({
                        "midpoint": midpoint,
                        "streak": entry["streak"],
                        "peak": entry["peak"],
                        "last": now,
                        "first_contact": entry.get("first_contact", now),
                    })
                else:
                    # Soft recoil decay so brief 150ms pauses between punches don't erase a fight
                    entry["streak"] = max(0.0, float(entry["streak"]) - 0.35)

                contact_duration = now - float(entry.get("first_contact", now))
                # Pre-warm Stage-2 async GPU VLM as soon as streak >= 1.0 so verdict is ready immediately
                vlm_state = "PASS"
                if (
                    frame is not None
                    and self.vlm is not None
                    and self.vlm.available
                    and entry["streak"] >= 1.0
                ):
                    vlm_state = self._check_vlm_pair(
                        key, box_a, box_b, frame, now, sync=sync_vlm
                    )

                if entry["streak"] >= VIOLENCE_CONFIRM_FRAMES and contact_duration >= 0.35:
                    if vlm_state == "PASS":
                        confirmed.append((key[0], key[1], max(iou, 0.10), float(entry["peak"])))
                        # Controlled decay so sustained fights maintain status without flooding duplicate bursts
                        entry["streak"] = max(0.0, float(entry["streak"]) - 2.0)
                        self._oscillation_count.pop(id_a, None)
                        self._oscillation_count.pop(id_b, None)
                    elif vlm_state == "REJECT":
                        # Visually confirmed non-violent (talking/hugging/crowded standing)
                        entry["streak"] = max(0.0, float(entry["streak"]) - 1.5)

        # Update centroids for convergence in subsequent frames
        for pid, pt in centers.items():
            self._prev_centroid[pid] = (pt, now)

        # Clean stale pair and tracking states
        for key in list(self.pairs):
            if now - float(self.pairs[key]["last"]) > VIOLENCE_PAIR_TTL_S:
                del self.pairs[key]
                self._vlm_cache.pop(key, None)
                self._pair_embeds.pop(key, None)

        active_ids = {track_id for track_id, _ in persons}
        for track_id in list(self.previous_wrists):
            if track_id not in active_ids:
                del self.previous_wrists[track_id]
        for track_id in list(self._kinetic_ema):
            if track_id not in active_ids:
                del self._kinetic_ema[track_id]
        for track_id in list(self._body_ema):
            if track_id not in active_ids:
                del self._body_ema[track_id]
        for track_id in list(self._prev_centroid):
            if track_id not in active_ids:
                del self._prev_centroid[track_id]
        for track_id in list(self._prev_wrist_vx):
            if track_id not in active_ids:
                del self._prev_wrist_vx[track_id]
        for track_id in list(self._prev_wrist_vy):
            if track_id not in active_ids:
                del self._prev_wrist_vy[track_id]
        for track_id in list(self._oscillation_count):
            if track_id not in active_ids:
                del self._oscillation_count[track_id]

        return confirmed
