"""Pillar 1 – Crowd / Overcrowding Detection with Spatial Density Index.

Accuracy upgrades:
  1. Spatial Density Index – computes the ratio of people to the area they
     occupy (persons per 10,000 px²).  Catches localized aisle jams even
     when the total headcount is below the global threshold.
  2. Density-based alarm – a secondary alarm fires when the density index
     exceeds a threshold, catching bottleneck clusters.
"""

from typing import Optional, List, Tuple

from engine.config import CROWD_PERSON_THRESHOLD, CROWD_CONSENSUS_FRAMES, CROWD_RELEASE_FRAMES

# Density: persons per 10,000 px² (roughly 100x100 area)
_DENSITY_ALARM_THRESHOLD = 0.8  # ≈ 1 person per 125x100 px block
_DENSITY_UNIT_AREA = 10_000.0


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

    @staticmethod
    def compute_density(
        persons: List[Tuple[int, Tuple[int, int, int, int]]],
    ) -> float:
        """Compute spatial density: persons per _DENSITY_UNIT_AREA px².

        Uses the convex hull area of all person centroids (approximated by
        the bounding rectangle of all centroids) to measure the occupied area.
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
        span_x = max(1.0, max_x - min_x)
        span_y = max(1.0, max_y - min_y)
        area = span_x * span_y
        density = len(persons) / (area / _DENSITY_UNIT_AREA)
        return density

    def update(self, person_count: int,
               persons: Optional[List[Tuple[int, Tuple[int, int, int, int]]]] = None,
               ) -> Optional[int]:
        """Update with a new frame's person count.

        *persons* is the optional full list of (track_id, bbox) pairs used
        for spatial density computation.

        Returns the peak count on first alarm, or None.
        """
        # --- Compute spatial density ---
        density = 0.0
        if persons is not None and len(persons) >= 3:
            density = self.compute_density(persons)
            self.last_density = density

        is_dense = density >= _DENSITY_ALARM_THRESHOLD if (persons is not None and len(persons) >= 3) else False
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

        if (not self.active) and (self.over_streak >= self.confirm_frames or self.density_streak >= self.confirm_frames):
            self.active = True
            self.peak = max(self.peak, person_count)
            return self.peak

        return None
