"""Pillar 2 – Unattended Baggage Detection & Anti-Theft Zero-Trust Custody.

Zero-Trust Custody & Anti-Theft Model:
  1. Immutable / Non-Transferable Ownership – Once a bag is assigned to an
     original owner, strangers can NEVER silently inherit ownership. Passing
     or hovering strangers will NOT reset the unattended timer.
  2. Appearance-Verified Owner Recovery – If ByteTrack momentarily drops the
     legitimate owner's track ID while they remain in-place, custody is ONLY
     re-associated if a live video frame confirms the returning subject's
     upper+lower torso HSV clothing histogram matches the original owner
     (cosine similarity >= 0.80). Without visual proof, Zero-Trust holds.
  3. Active Baggage Theft Detection ('BAGGAGE_THEFT_SUSPECTED') – If an owner
     leaves a bag unattended and a stranger picks it up or displaces it across
     consecutive frames, the system immediately fires a critical theft alarm.
  4. Shape & Noise Filtering – Rejects sub-28px artifacts and extreme aspect
     slivers (handrails, window pillars, seat trim).
  5. Track Relinking via Graveyard – Survives momentary bag detection dropouts
     without resetting the unattended or theft-monitoring clocks.
"""

import time
import logging
from typing import Dict, List, Tuple, Optional

import numpy as np

from engine.config import (
    BAGGAGE_STATIONARY_SECONDS,
    BAGGAGE_STATIONARY_PIXEL_TOL,
    BAGGAGE_PROXIMITY_RADIUS_PX,
    BAGGAGE_MIN_FRAMES,
    BAGGAGE_RELINK_TTL_S,
    BAGGAGE_RELINK_DIST_PX,
)
from engine.utils.geometry import bbox_center, boxes_intersect_with_radius, dist
from engine.utils.scene import extract_appearance_hist, hist_similarity

log = logging.getLogger("trans-guard-engine")

_GC_TTL_S = 10.0
# Minimum seconds a bag must be abandoned before a stranger's pickup triggers theft alarm
_THEFT_ARM_SECONDS = 3.0
# Minimum displacement (px at 720p) by a stranger to confirm theft movement
_THEFT_DISPLACEMENT_PX = 24.0
# Cooldown between repeated theft alarms for the same bag
_THEFT_COOLDOWN_S = 6.0
# Minimum HSV cosine similarity to re-associate an owner across a tracker ID glitch
_OWNER_REID_SIM_THRESHOLD = 0.80


class TrackedBag:
    """State for a tracked bag under zero-trust custody."""

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
        "owner_last_pos",
        "owner_hist",
        "frame_count",
        "stranger_id",
        "stranger_near_time",
        "last_theft_alarm_time",
        "displaced_streak",
    )

    def __init__(
        self,
        track_id: int,
        cls_name: str,
        bbox: Tuple[int, int, int, int],
        centroid: Tuple[float, float],
        owner_id: Optional[int] = None,
        owner_pos: Optional[Tuple[float, float]] = None,
        owner_hist: Optional[np.ndarray] = None,
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
        self.owner_last_pos = owner_pos
        self.owner_hist = owner_hist
        self.frame_count = 1
        self.stranger_id = None
        self.stranger_near_time = 0.0
        self.last_theft_alarm_time = 0.0
        self.displaced_streak = 0


class BaggageDetector:
    """Detects unattended baggage and actively prevents baggage theft."""

    def __init__(self):
        self.cache: Dict[int, TrackedBag] = {}
        self._graveyard: Dict[int, TrackedBag] = {}
        self._scale: float = 1.0
        self._proximity: float = BAGGAGE_PROXIMITY_RADIUS_PX
        self._stationary_tol: float = BAGGAGE_STATIONARY_PIXEL_TOL
        self._relink_dist: float = BAGGAGE_RELINK_DIST_PX
        self._theft_disp: float = _THEFT_DISPLACEMENT_PX

    def calibrate(self, frame_h: int, ref_h: int = 720) -> None:
        """Set resolution scale factor for pixel-based thresholds."""
        self._scale = frame_h / ref_h
        self._proximity = BAGGAGE_PROXIMITY_RADIUS_PX * self._scale
        self._stationary_tol = BAGGAGE_STATIONARY_PIXEL_TOL * self._scale
        self._relink_dist = BAGGAGE_RELINK_DIST_PX * self._scale
        self._theft_disp = _THEFT_DISPLACEMENT_PX * self._scale

    @staticmethod
    def _blend_hist(old: Optional[np.ndarray], new: Optional[np.ndarray]) -> Optional[np.ndarray]:
        if new is None:
            return old
        if old is None:
            return new
        blended = 0.85 * old + 0.15 * new
        norm = float(np.linalg.norm(blended))
        return blended / norm if norm > 1e-6 else old

    def update(
        self,
        bags: List[Tuple[int, str, Tuple[int, int, int, int]]],
        persons: List[Tuple[int, Tuple[int, int, int, int]]],
        now: float,
        frame: Optional[np.ndarray] = None,
    ) -> List[Dict]:
        """Process bag and person detections with Zero-Trust Anti-Theft logic."""
        alerts: List[Dict] = []
        person_centers = {pid: bbox_center(pbox) for pid, pbox in persons}
        person_boxes = {pid: pbox for pid, pbox in persons}
        # Lazily computed appearance descriptors per person in this frame
        person_hists: Dict[int, Optional[np.ndarray]] = {}

        def _get_hist(pid: int) -> Optional[np.ndarray]:
            if frame is None:
                return None
            if pid not in person_hists:
                pbox = person_boxes.get(pid)
                person_hists[pid] = extract_appearance_hist(frame, pbox) if pbox is not None else None
            return person_hists[pid]

        for track_id, cls_name, bbox in bags:
            # Noise & shape filter: reject tiny artifacts and thin pole/trim slivers
            bw = bbox[2] - bbox[0]
            bh = bbox[3] - bbox[1]
            if (
                bw < 28 * self._scale
                or bh < 28 * self._scale
                or (bw * bh) < 900 * (self._scale ** 2)
            ):
                continue
            aspect = bw / max(1.0, float(bh))
            if aspect > 4.5 or aspect < 0.22:
                continue

            centroid = bbox_center(bbox)

            if track_id not in self.cache:
                # Attempt relink from graveyard
                relinked = self._try_relink(track_id, cls_name, bbox, centroid, now)
                if not relinked:
                    # New bag: assign nearest person as legitimate owner
                    owner_id = self._find_nearest_person(bbox, persons)
                    owner_pos = person_centers.get(owner_id) if owner_id is not None else None
                    owner_hist = _get_hist(owner_id) if owner_id is not None else None
                    self.cache[track_id] = TrackedBag(
                        track_id=track_id,
                        cls_name=cls_name,
                        bbox=bbox,
                        centroid=centroid,
                        owner_id=owner_id,
                        owner_pos=owner_pos,
                        owner_hist=owner_hist,
                        now=now,
                    )
                continue

            bag = self.cache[track_id]
            bag.bbox = bbox
            bag.centroid = centroid
            bag.last_seen = now
            bag.frame_count += 1

            # Check displacement from reference stationary position
            displacement = dist(centroid, bag.ref_centroid)
            is_displaced = displacement > self._theft_disp
            is_moving = displacement > self._stationary_tol

            if is_moving:
                bag.last_move_time = now

            # -------------------------------------------------------------
            # ZERO-TRUST OWNER VERIFICATION
            # -------------------------------------------------------------
            owner_present = False
            stranger_near_id: Optional[int] = None
            stranger_near_dist = float("inf")

            for pid, pbbox in persons:
                is_near = boxes_intersect_with_radius(bbox, pbbox, self._proximity)
                if not is_near:
                    continue

                if bag.owner_id is not None and pid == bag.owner_id:
                    owner_present = True
                    bag.owner_last_near_time = now
                    bag.owner_last_pos = person_centers.get(pid)
                    bag.owner_hist = self._blend_hist(bag.owner_hist, _get_hist(pid))
                    bag.stranger_near_time = 0.0
                    bag.stranger_id = None
                else:
                    # Non-owner in proximity (potential stranger or thief)
                    d = dist(centroid, person_centers[pid])
                    if d < stranger_near_dist:
                        stranger_near_dist = d
                        stranger_near_id = pid

            # Appearance-Verified owner recovery (ONLY when visual Re-ID proves
            # it is the SAME person after a ByteTrack ID glitch — never on
            # proximity alone, preserving strict Zero-Trust against strangers).
            if (
                not owner_present
                and bag.owner_id is not None
                and bag.owner_last_pos is not None
                and bag.owner_hist is not None
                and frame is not None
                and (now - bag.owner_last_near_time) < 6.0
            ):
                best_pid: Optional[int] = None
                best_sim = _OWNER_REID_SIM_THRESHOLD
                for pid, pt in person_centers.items():
                    if dist(pt, bag.owner_last_pos) >= 80.0 * self._scale:
                        continue
                    if not boxes_intersect_with_radius(bbox, person_boxes[pid], self._proximity):
                        continue
                    sim = hist_similarity(bag.owner_hist, _get_hist(pid))
                    if sim >= best_sim:
                        best_sim = sim
                        best_pid = pid
                if best_pid is not None:
                    bag.owner_id = best_pid
                    bag.owner_last_near_time = now
                    bag.owner_last_pos = person_centers[best_pid]
                    bag.owner_hist = self._blend_hist(bag.owner_hist, _get_hist(best_pid))
                    bag.stranger_near_time = 0.0
                    bag.stranger_id = None
                    owner_present = True

            # If no original owner was ever recorded, nearest person is adopted
            if bag.owner_id is None and stranger_near_id is not None:
                bag.owner_id = stranger_near_id
                bag.owner_last_near_time = now
                bag.owner_last_pos = person_centers.get(stranger_near_id)
                bag.owner_hist = _get_hist(stranger_near_id)
                owner_present = True

            # If stranger is near while owner is absent:
            if not owner_present and stranger_near_id is not None:
                bag.stranger_id = stranger_near_id
                if bag.stranger_near_time == 0.0:
                    bag.stranger_near_time = now
            elif owner_present:
                bag.stranger_near_time = 0.0
                bag.stranger_id = None

            # Frame gating
            if bag.frame_count < BAGGAGE_MIN_FRAMES:
                continue

            unattended_s = now - bag.owner_last_near_time

            # -------------------------------------------------------------
            # 1. ACTIVE THEFT DETECTION: STRANGER DISPLACING UNATTENDED BAG
            # -------------------------------------------------------------
            if is_displaced and not owner_present:
                bag.displaced_streak += 1
            else:
                bag.displaced_streak = 0

            # Require either >= 2 displaced frames or large (>1.5x) clear pickup
            # displacement so single-frame bbox edge jitter does not false-alarm
            confirmed_displacement = (
                bag.displaced_streak >= 2
                or displacement > self._theft_disp * 1.5
            )

            if (
                unattended_s >= _THEFT_ARM_SECONDS
                and is_displaced
                and confirmed_displacement
                and not owner_present
                and (now - bag.last_theft_alarm_time) > _THEFT_COOLDOWN_S
            ):
                bag.last_theft_alarm_time = now
                bag.displaced_streak = 0
                theft_type = (
                    "UNAUTHORIZED_PICKUP"
                    if stranger_near_id is not None
                    else "UNATTENDED_BAG_DISPLACED"
                )
                log.warning(
                    "THEFT ALERT on bag #%d (%s): Moved by stranger #%s (unattended for %.1fs, displaced %.1fpx)",
                    bag.track_id, bag.cls_name, stranger_near_id, unattended_s, displacement,
                )
                alerts.append({
                    "alert_type": "BAGGAGE_THEFT_SUSPECTED",
                    "track_id": bag.track_id,
                    "cls_name": bag.cls_name,
                    "bbox": bag.bbox,
                    "confidence": 96.0,
                    "original_owner_id": bag.owner_id,
                    "suspect_id": stranger_near_id,
                    "unattended_s": round(unattended_s, 1),
                    "displacement_px": round(displacement, 1),
                    "theft_type": theft_type,
                })
                # Reset reference centroid to new location so subsequent movement continues tracking
                bag.ref_centroid = centroid
                continue

            # Update reference centroid if bag moved with its true owner
            if is_moving and owner_present:
                bag.ref_centroid = centroid

            # -------------------------------------------------------------
            # 2. UNATTENDED BAGGAGE DETECTION (ZERO-TRUST: STRANGERS CANNOT RESET)
            # -------------------------------------------------------------
            stationary_s = now - bag.last_move_time
            threshold_s = min(stationary_s, unattended_s)

            if threshold_s > BAGGAGE_STATIONARY_SECONDS:
                ratio = min(threshold_s / BAGGAGE_STATIONARY_SECONDS, 3.0)
                confidence = min(98.0, 72.0 + ratio * 8.6)
                stranger_loitering = (
                    bag.stranger_near_time > 0.0
                    and (now - bag.stranger_near_time) >= 2.5
                )

                alerts.append({
                    "alert_type": "UNATTENDED_BAGGAGE",
                    "track_id": bag.track_id,
                    "cls_name": bag.cls_name,
                    "bbox": bag.bbox,
                    "stationary_s": round(stationary_s, 1),
                    "unattended_s": round(unattended_s, 1),
                    "confidence": round(confidence, 1),
                    "suspect_id": bag.stranger_id,
                    "stranger_loitering": stranger_loitering,
                })

        # Move expired tracks to graveyard
        for tid in list(self.cache):
            if now - self.cache[tid].last_seen > 1.5:
                self._graveyard[tid] = self.cache.pop(tid)

        # Purge stale graveyard
        for tid in list(self._graveyard):
            if now - self._graveyard[tid].last_seen > _GC_TTL_S:
                del self._graveyard[tid]

        return alerts

    def _try_relink(
        self,
        new_track_id: int,
        cls_name: str,
        bbox: Tuple[int, int, int, int],
        centroid: Tuple[float, float],
        now: float,
    ) -> bool:
        best_tid: Optional[int] = None
        best_dist = float("inf")

        for tid, old_bag in self._graveyard.items():
            if now - old_bag.last_seen > BAGGAGE_RELINK_TTL_S:
                continue
            if old_bag.cls_name != cls_name:
                continue
            d = dist(centroid, old_bag.centroid)
            if d < self._relink_dist and d < best_dist:
                best_dist = d
                best_tid = tid

        if best_tid is None:
            return False

        old_bag = self._graveyard.pop(best_tid)
        old_bag.track_id = new_track_id
        old_bag.bbox = bbox
        old_bag.centroid = centroid
        old_bag.last_seen = now
        old_bag.frame_count += 1
        self.cache[new_track_id] = old_bag
        return True

    def _find_nearest_person(
        self,
        bag_bbox: Tuple[int, int, int, int],
        persons: List[Tuple[int, Tuple[int, int, int, int]]],
    ) -> Optional[int]:
        bag_center = bbox_center(bag_bbox)
        best_id: Optional[int] = None
        best_dist = float("inf")
        for pid, pbbox in persons:
            if not boxes_intersect_with_radius(bag_bbox, pbbox, self._proximity):
                continue
            d = dist(bag_center, bbox_center(pbbox))
            if d < best_dist:
                best_dist = d
                best_id = pid
        return best_id
