"""Pillar 5 – Violence Detection with Kinetic Moving Average.

Accuracy upgrades over the previous version:
  1. Kinetic Energy EMA – instead of a single-frame wrist speed spike,
     tracks an exponential moving average of kinetic energy.  Sustained
     striking motions build up the EMA; isolated gestures decay quickly.
  2. Mutual Convergence Velocity – measures how fast two people are
     approaching each other (centroid distance shrinking).  A fight
     involves rapid convergence; parallel walking does not.
  3. Oscillation Counter – counts rapid direction changes in wrist
     movement (up-down-up striking pattern) rather than raw speed.
"""

import time
import math
from typing import Dict, Tuple, List

from engine.config import (
    FALL_VISIBILITY_THRESHOLD,
    VIOLENCE_IOU_THRESHOLD,
    VIOLENCE_WRIST_SPEED_PX_S,
    VIOLENCE_CONFIRM_FRAMES,
    VIOLENCE_PAIR_TTL_S,
)
from engine.utils.geometry import dist, bbox_iou, bbox_center


# EMA smoothing factor for kinetic energy (0..1, lower = smoother)
_KINETIC_EMA_ALPHA = 0.35
# Minimum mutual convergence speed (px/s) to count as "approaching"
_CONVERGENCE_PX_S = 50.0
# Wrist direction-change threshold to count as "oscillation"
_OSCILLATION_SPEED_THRESHOLD = 150.0


class ViolenceDetector:
    def __init__(self):
        self.pairs: Dict[Tuple[int, int], Dict[str, float]] = {}
        self.previous_wrists: Dict[int, Tuple[Dict[str, Tuple[float, float]], float]] = {}
        # Centroid history for convergence velocity
        self._prev_centroid: Dict[int, Tuple[Tuple[float, float], float]] = {}
        # Wrist kinetic EMA per track
        self._kinetic_ema: Dict[int, float] = {}
        # Previous wrist vertical direction per track (for oscillation)
        self._prev_wrist_vy: Dict[int, float] = {}
        # Oscillation counter per track
        self._oscillation_count: Dict[int, int] = {}

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

    def wrist_speed(self, track_id: int, points, now: float) -> float:
        wrists = self._wrists(points)
        previous = self.previous_wrists.get(track_id)
        self.previous_wrists[track_id] = (wrists, now)
        if not previous or not wrists:
            return 0.0
        old_wrists, old_time = previous
        elapsed = now - old_time
        if elapsed <= 1e-3:
            return 0.0
        speeds = []
        vy_values = []
        for name, position in wrists.items():
            if name in old_wrists:
                s = dist(position, old_wrists[name]) / elapsed
                speeds.append(s)
                # Track vertical component for oscillation
                vy = (position[1] - old_wrists[name][1]) / elapsed
                vy_values.append(vy)

        if not speeds:
            return 0.0

        peak = max(speeds)

        # Update kinetic EMA
        prev_ema = self._kinetic_ema.get(track_id, 0.0)
        self._kinetic_ema[track_id] = (
            _KINETIC_EMA_ALPHA * peak + (1 - _KINETIC_EMA_ALPHA) * prev_ema
        )

        # Track oscillation (direction changes in wrist movement)
        if vy_values:
            avg_vy = sum(vy_values) / len(vy_values)
            prev_vy = self._prev_wrist_vy.get(track_id, 0.0)
            self._prev_wrist_vy[track_id] = avg_vy
            # Direction reversal with significant speed
            if (
                prev_vy * avg_vy < 0  # sign change
                and abs(avg_vy) > _OSCILLATION_SPEED_THRESHOLD
            ):
                self._oscillation_count[track_id] = (
                    self._oscillation_count.get(track_id, 0) + 1
                )
            else:
                # Slowly decay oscillation count
                osc = self._oscillation_count.get(track_id, 0)
                if osc > 0:
                    self._oscillation_count[track_id] = max(0, osc - 1)

        return peak

    def _convergence_speed(
        self, id_a: int, ca: Tuple[float, float],
        id_b: int, cb: Tuple[float, float],
        now: float,
    ) -> float:
        """Return rate of distance decrease between two people (px/s).

        Positive = approaching.  Negative = moving apart.
        """
        current_dist = dist(ca, cb)
        prev_a = self._prev_centroid.get(id_a)
        prev_b = self._prev_centroid.get(id_b)

        if prev_a is None or prev_b is None:
            return 0.0

        # Discard stale centroids from tracks recovering from occlusions
        if (now - prev_a[1]) > 0.5 or (now - prev_b[1]) > 0.5:
            return 0.0

        prev_dist = dist(prev_a[0], prev_b[0])
        dt = (now - prev_a[1] + now - prev_b[1]) / 2.0
        if dt < 1e-3:
            return 0.0

        # Positive = closing in
        return (prev_dist - current_dist) / dt

    def evaluate(self, persons, speeds: Dict[int, float], now: float):
        confirmed = []
        active_pairs = set()
        centers = {pid: bbox_center(pbox) for pid, pbox in persons}

        for index, (id_a, box_a) in enumerate(persons):
            for id_b, box_b in persons[index + 1:]:
                iou = bbox_iou(box_a, box_b)
                if iou < VIOLENCE_IOU_THRESHOLD:
                    continue
                key = (min(id_a, id_b), max(id_a, id_b))
                active_pairs.add(key)

                peak = max(speeds.get(id_a, 0.0), speeds.get(id_b, 0.0))

                # Get kinetic EMA for both individuals
                ema_a = self._kinetic_ema.get(id_a, 0.0)
                ema_b = self._kinetic_ema.get(id_b, 0.0)
                peak_ema = max(ema_a, ema_b)

                # Get convergence speed without mutating intra-frame centroids
                conv = self._convergence_speed(id_a, centers[id_a], id_b, centers[id_b], now)

                # Get oscillation count
                osc_a = self._oscillation_count.get(id_a, 0)
                osc_b = self._oscillation_count.get(id_b, 0)
                max_osc = max(osc_a, osc_b)

                entry = self.pairs.setdefault(
                    key, {"streak": 0.0, "last": now, "peak": 0.0}
                )
                entry["last"] = now

                # Violence requires EITHER:
                #   1. Sustained high kinetic EMA (not just a spike) with overlap
                #   2. High instantaneous speed + mutual convergence
                #   3. Oscillating wrist motion (repeated striking) with overlap
                is_violent_frame = False
                if peak_ema >= VIOLENCE_WRIST_SPEED_PX_S * 0.7:
                    # Sustained high energy
                    is_violent_frame = True
                elif peak >= VIOLENCE_WRIST_SPEED_PX_S and conv > _CONVERGENCE_PX_S:
                    # Fast wrists + approaching each other
                    is_violent_frame = True
                elif max_osc >= 3 and peak_ema >= VIOLENCE_WRIST_SPEED_PX_S * 0.4:
                    # Oscillating striking pattern
                    is_violent_frame = True

                if is_violent_frame:
                    entry["streak"] += 1
                    entry["peak"] = max(entry["peak"], peak)
                else:
                    entry["streak"] = max(0.0, entry["streak"] - 0.5)

                if entry["streak"] >= VIOLENCE_CONFIRM_FRAMES:
                    confirmed.append((key[0], key[1], iou, entry["peak"]))
                    entry["streak"] = 0.0
                    entry["peak"] = 0.0
                    # Reset oscillation counters after confirmed event
                    self._oscillation_count.pop(id_a, None)
                    self._oscillation_count.pop(id_b, None)

        # Record current centroids for next frame convergence analysis
        for pid, pt in centers.items():
            self._prev_centroid[pid] = (pt, now)

        for key in list(self.pairs):
            if now - self.pairs[key]["last"] > VIOLENCE_PAIR_TTL_S:
                del self.pairs[key]
        active_ids = {track_id for track_id, _ in persons}
        for track_id in list(self.previous_wrists):
            if track_id not in active_ids:
                del self.previous_wrists[track_id]
        for track_id in list(self._kinetic_ema):
            if track_id not in active_ids:
                del self._kinetic_ema[track_id]
        for track_id in list(self._prev_centroid):
            if track_id not in active_ids:
                del self._prev_centroid[track_id]
        for track_id in list(self._prev_wrist_vy):
            if track_id not in active_ids:
                del self._prev_wrist_vy[track_id]
        for track_id in list(self._oscillation_count):
            if track_id not in active_ids:
                del self._oscillation_count[track_id]
        return confirmed
