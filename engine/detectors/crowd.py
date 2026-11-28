"""Pillar 1 – Crowd / Overcrowding Detection with Resolution-Calibrated Spatial Density.

Accuracy upgrades:
  1. Resolution-Calibrated Spatial Density Index – computes persons per
     resolution-scaled 10,000 px² block so 480p, 720p, and 1080p streams
     yield consistent density metrics.
  2. Minimum Cluster Gate (>= 4 persons) & Higher Threshold (2.0) – prevents
     3–4 normally seated bus passengers from triggering false aisle jams,
     while catching genuine doorway/aisle crush bottlenecks.
  3. Hysteresis Latch & Release – prevents alarm flapping around the threshold.
"""

from typing import Optional, List, Tuple

from engine.config import CROWD_PERSON_THRESHOLD, CROWD_CONSENSUS_FRAMES, CROWD_RELEASE_FRAMES

# Density: persons per 10,000 px² at 720p (100x100 px block).
# 2.0 ≈ 1 person per 70x70 px — genuine shoulder-to-shoulder crowding,
# not normal seated bus spacing (~0.5–1.2).
_DENSITY_ALARM_THRESHOLD = 2.0
_DENSITY_UNIT_AREA = 10_000.0
_MIN_DENSITY_PERSONS = 4


class CrowdDetector:
    def __init__(self, threshold: int = CROWD_PERSON_THRESHOLD,
                 confirm_frames: int = CROWD_CONSENSUS_FRAMES):
        self.threshold = threshold
        self.confirm_frames = confirm_frames
        self.over_streak = 0
        self.under_streak = 0
        self.active = False
        self.peak = 0
        self.density_streak = 0
        self.last_density = 0.0
        self._scale: float = 1.0

    def calibrate(self, frame_h: int, ref_h: int = 720) -> None:
        """Scale spatial density unit area quadratically for frame resolution."""
        self._scale = max(0.25, frame_h / float(ref_h))

    @staticmethod
    def compute_density(
        persons: List[Tuple[int, Tuple[int, int, int, int]]],
        scale: float = 1.0,
    ) -> float:
        """Compute spatial density: persons per resolution-scaled 10,000 px².

        Uses the bounding rectangle of all person centroids to measure occupied
        area, normalised by ``scale ** 2`` for resolution independence.
        """
        if len(persons) < 2:
            return 0.0
        xs = []
        ys = []
        for _, (x1, y1, x2, y2) in persons:
            xs.append((x1 + x2) / 2.0)
            ys.append((y1 + y2) / 2.0)
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        # Floor each axis to at least one human body footprint (~60px at 720p)
        # so passengers seated in a single horizontal row or spaced far apart
        # down a straight vertical bus aisle do not collapse area -> 0.
        min_span = max(1.0, 60.0 * scale)
        span_x = max(min_span, max_x - min_x)
        span_y = max(min_span, max_y - min_y)
        unit_area = _DENSITY_UNIT_AREA * (scale ** 2)
        area = span_x * span_y
        return len(persons) / (area / unit_area)

    def update(self, person_count: int,
               persons: Optional[List[Tuple[int, Tuple[int, int, int, int]]]] = None,
               ) -> Optional[int]:
        """Update with a new frame's person count.

        *persons* is the optional full list of (track_id, bbox) pairs used
        for spatial density computation.

        Returns the peak count on first alarm, or None.
        """
        # --- Compute resolution-calibrated spatial density ---
        density = 0.0
        has_cluster = persons is not None and len(persons) >= _MIN_DENSITY_PERSONS
        if has_cluster:
            density = self.compute_density(persons, scale=self._scale)
            self.last_density = density
        else:
            self.last_density = 0.0

        is_dense = has_cluster and (density >= _DENSITY_ALARM_THRESHOLD)
        is_over_headcount = person_count > self.threshold
        is_crowded = is_over_headcount or is_dense

        if is_dense:
            self.density_streak += 1
        else:
            self.density_streak = max(0, self.density_streak - 1)

        if is_crowded:
            self.over_streak += 1
            self.under_streak = 0
            self.peak = max(self.peak, person_count)
        else:
            self.under_streak += 1
            self.over_streak = 0
            if self.active and self.under_streak >= CROWD_RELEASE_FRAMES:
                self.active = False
                self.peak = 0

        if (not self.active) and (
            self.over_streak >= self.confirm_frames
            or self.density_streak >= self.confirm_frames
        ):
            self.active = True
            self.peak = max(self.peak, person_count)
            return self.peak

        return None
