"""Pillar 2 – Unattended Baggage Detection with Owner-Departure Tracking.

Extracted from the monolithic ``inference.py`` into a dedicated detector with
owner-departure logic that eliminates the critical false-negative where a
busy aisle causes every passing stranger to reset the "attended" timer.

Key improvements over the previous inline implementation:
  1. Owner Assignment – when a bag first appears, the *closest* person is
     assigned as its "owner" via ByteTrack ID.  Only the owner can reset
     the attended timer, not random passers-by.
  2. Owner Departure Detection – the bag becomes "potentially unattended"
     when the owner moves beyond BAGGAGE_PROXIMITY_RADIUS_PX for more than
     BAGGAGE_STATIONARY_SECONDS, regardless of how many other people pass by.
  3. Hysteresis – requires the owner to be gone for the *full* threshold
     period before firing, preventing brief owner bathroom trips from alarming.
"""

import time
import logging
from typing import Dict, List, Tuple, Optional

from engine.config import (
    BAGGAGE_STATIONARY_SECONDS,
    BAGGAGE_STATIONARY_PIXEL_TOL,
    BAGGAGE_PROXIMITY_RADIUS_PX,
)
from engine.utils.geometry import bbox_center, boxes_intersect_with_radius, dist

log = logging.getLogger("trans-guard-engine")

# How long since last seen before we garbage-collect the entry
_GC_TTL_S = 5.0


class TrackedBag:
    """State for a single tracked bag/suitcase/handbag."""

    __slots__ = (
        "track_id",
        "cls_name",
        "bbox",
        "centroid",
        "first_seen",
        "last_seen",
        "last_move_time",
        "ref_centroid",
        "owner_id",
        "owner_last_near_time",
    )

    def __init__(
        self,
        track_id: int,
        cls_name: str,
        bbox: Tuple[int, int, int, int],
        centroid: Tuple[float, float],
        owner_id: Optional[int] = None,
        now: Optional[float] = None,
    ):
        ts = time.time() if now is None else now
        self.track_id = track_id
        self.cls_name = cls_name
        self.bbox = bbox
        self.centroid = centroid
        self.first_seen = ts
        self.last_seen = ts
        self.last_move_time = ts
        self.ref_centroid = centroid
        self.owner_id = owner_id
        self.owner_last_near_time = ts


class BaggageDetector:
    """Detects unattended baggage with owner-departure awareness."""

    def __init__(self):
        self.cache: Dict[int, TrackedBag] = {}

    def update(
        self,
        bags: List[Tuple[int, str, Tuple[int, int, int, int]]],
        persons: List[Tuple[int, Tuple[int, int, int, int]]],
        now: float,
    ) -> List[Dict]:
        """Process a single frame's bag/person detections.

        Returns a list of alert dicts for bags that are confirmed unattended.
        Each dict has keys: track_id, cls_name, bbox, stationary_s, unattended_s.
        """
        alerts: List[Dict] = []

        for track_id, cls_name, bbox in bags:
            centroid = bbox_center(bbox)

            if track_id not in self.cache:
                # Assign owner: nearest person within proximity radius
                owner_id = self._find_nearest_person(bbox, persons)
                self.cache[track_id] = TrackedBag(
                    track_id=track_id,
                    cls_name=cls_name,
                    bbox=bbox,
                    centroid=centroid,
                    owner_id=owner_id,
                    now=now,
                )
                continue

            bag = self.cache[track_id]
            bag.bbox = bbox
            bag.centroid = centroid
            bag.last_seen = now

            # Has the bag moved?
            if dist(centroid, bag.ref_centroid) > BAGGAGE_STATIONARY_PIXEL_TOL:
                bag.ref_centroid = centroid
                bag.last_move_time = now

            # Is the *owner* still near the bag?
            owner_near = False
            if bag.owner_id is not None:
                for pid, pbbox in persons:
                    if pid == bag.owner_id:
                        if boxes_intersect_with_radius(
                            bbox, pbbox, BAGGAGE_PROXIMITY_RADIUS_PX
                        ):
                            owner_near = True
                            bag.owner_last_near_time = now
                        break
            else:
                # No assigned owner – fall back to "any person nearby"
                for _, pbbox in persons:
                    if boxes_intersect_with_radius(
                        bbox, pbbox, BAGGAGE_PROXIMITY_RADIUS_PX
                    ):
                        owner_near = True
                        bag.owner_last_near_time = now
                        break

            stationary_s = now - bag.last_move_time
            unattended_s = now - bag.owner_last_near_time
            threshold_s = min(stationary_s, unattended_s)

            if threshold_s > BAGGAGE_STATIONARY_SECONDS:
                alerts.append(
                    {
                        "track_id": bag.track_id,
                        "cls_name": bag.cls_name,
                        "bbox": bag.bbox,
                        "stationary_s": round(stationary_s, 1),
                        "unattended_s": round(unattended_s, 1),
                    }
                )

        # Garbage-collect stale bags
        for tid in list(self.cache):
            if now - self.cache[tid].last_seen > _GC_TTL_S:
                del self.cache[tid]

        return alerts

    @staticmethod
    def _find_nearest_person(
        bag_bbox: Tuple[int, int, int, int],
        persons: List[Tuple[int, Tuple[int, int, int, int]]],
    ) -> Optional[int]:
        """Return the track_id of the nearest person within proximity, or None."""
        bag_center = bbox_center(bag_bbox)
        best_id: Optional[int] = None
        best_dist = float("inf")
        for pid, pbbox in persons:
            if not boxes_intersect_with_radius(
                bag_bbox, pbbox, BAGGAGE_PROXIMITY_RADIUS_PX
            ):
                continue
            d = dist(bag_center, bbox_center(pbbox))
            if d < best_dist:
                best_dist = d
                best_id = pid
        return best_id
