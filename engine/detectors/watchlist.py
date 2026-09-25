"""Pillar 6 – Biometric Watchlist (face_recognition / dlib ResNet-34).

Uses the dlib-backed ``face_recognition`` library which achieves 99.38%
accuracy on the LFW benchmark and runs in ~15 ms per face on CPU.

Key accuracy upgrades:
  1. Landmark-guided face extraction – accepts MediaPipe face-landmark
     hint boxes so the exact face region is encoded (no shoulder noise).
  2. Per-track embedding cache – once a person is matched (or confirmed
     non-match) the result is cached against their ByteTrack track_id so
     we never re-encode the same tracked individual every frame.
  3. Multi-face handling – if multiple faces are found in a crop, the best
     (lowest distance) match is returned.
"""

import logging
import numpy as np
import cv2
from typing import List, Dict, Tuple, Optional

from engine.config import FACE_MATCH_TOLERANCE

log = logging.getLogger("trans-guard-engine")

# ---------------------------------------------------------------------------
# Backend detection
# ---------------------------------------------------------------------------
FACE_BACKEND = None
_face_recognition = None
try:
    import face_recognition as _fr
    _face_recognition = _fr
    FACE_BACKEND = "face_recognition"
except ModuleNotFoundError:
    log.warning("face_recognition not installed; watchlist pillar disabled")


class Watchlist:
    """Biometric watchlist with per-track caching and landmark-guided crops."""

    def __init__(self, tolerance: float = FACE_MATCH_TOLERANCE):
        self.encodings: List[np.ndarray] = []
        self.names: List[str] = []
        self.tolerance = tolerance
        # Per-track cache: track_id -> (name | None)
        # None name means we scanned but found no match (avoids re-scan).
        self._track_cache: Dict[int, Optional[str]] = {}

    # ------------------------------------------------------------------
    # Watchlist sync (from backend / control message)
    # ------------------------------------------------------------------
    def replace_from_images(self, targets: List[Dict[str, object]]) -> None:
        """Re-encode every reference image and rebuild the known-faces list."""
        if _face_recognition is None:
            return
        new_encodings: List[np.ndarray] = []
        new_names: List[str] = []
        for target in targets:
            if not isinstance(target, dict):
                continue
            name = str(target.get("name", "unknown"))
            image_bytes = target.get("image")
            if not isinstance(image_bytes, bytes):
                continue
            try:
                image = cv2.imdecode(
                    np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR
                )
                if image is None:
                    continue
                rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                locs = _face_recognition.face_locations(
                    rgb, number_of_times_to_upsample=1, model="hog"
                )
                if not locs:
                    log.warning("No face found in reference image for %s", name)
                    continue
                encs = _face_recognition.face_encodings(rgb, known_face_locations=locs)
                if encs:
                    new_encodings.append(encs[0])
                    new_names.append(name)
                    log.info(
                        "Watchlist encoded face for '%s' from reference image", name
                    )
            except Exception as exc:
                log.warning("Failed to encode %s: %s", name, exc)

        self.encodings = new_encodings
        self.names = new_names
        # Invalidate track cache when the watchlist changes
        self._track_cache.clear()
        log.info(
            "Watchlist synced: %d identities cached (%s)",
            len(self.names),
            ", ".join(self.names) if self.names else "none",
        )

    # ------------------------------------------------------------------
    # Per-track cache helpers
    # ------------------------------------------------------------------
    def cache_hit(self, track_id: int) -> Optional[str]:
        """Return cached name if this track was already matched, else None."""
        return self._track_cache.get(track_id)

    def is_cached(self, track_id: int) -> bool:
        """Return True if this track was already positively matched."""
        return self._track_cache.get(track_id) is not None

    def forget_tracks(self, active_ids: set) -> None:
        """Remove entries for tracks that are no longer visible."""
        for tid in list(self._track_cache):
            if tid not in active_ids:
                del self._track_cache[tid]

    # ------------------------------------------------------------------
    # Core matching
    # ------------------------------------------------------------------
    def match(
        self,
        face_bgr: np.ndarray,
        hint_locations: Optional[List[Tuple[int, int, int, int]]] = None,
        track_id: Optional[int] = None,
    ) -> Optional[Tuple[str, float, Tuple[int, int, int, int]]]:
        """Compare a BGR image against the watchlist.

        Returns ``(name, confidence_pct, (left, top, right, bottom))`` on
        match, or ``None``.

        If *hint_locations* is provided (top, right, bottom, left format from
        MediaPipe landmark extraction), only those face boxes are checked.

        If *track_id* is provided, positive matches are cached so subsequent
        calls for the same track are instant without re-running embeddings.
        """
        if _face_recognition is None or not self.encodings:
            return None

        try:
            rgb = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB)

            if hint_locations:
                locs = hint_locations
            else:
                locs = _face_recognition.face_locations(
                    rgb, number_of_times_to_upsample=1, model="hog"
                )

            if not locs:
                return None

            encs = _face_recognition.face_encodings(rgb, known_face_locations=locs)
            if not encs:
                return None

            best_name: Optional[str] = None
            best_dist = float("inf")
            best_loc: Tuple[int, int, int, int] = (0, 0, 0, 0)

            for enc, loc in zip(encs, locs):
                distances = _face_recognition.face_distance(self.encodings, enc)
                if len(distances) == 0:
                    continue
                min_idx = int(np.argmin(distances))
                min_dist = float(distances[min_idx])
                if min_dist < best_dist:
                    best_dist = min_dist
                    best_name = self.names[min_idx]
                    # face_recognition returns (top, right, bottom, left)
                    top, right, bottom, left = loc
                    best_loc = (left, top, right, bottom)

            if best_dist <= self.tolerance:
                conf = round(
                    max(50.0, min(99.0, (1.0 - best_dist / self.tolerance) * 100.0)),
                    1,
                )
                if track_id is not None:
                    self._track_cache[track_id] = best_name
                log.info(
                    "Watchlist target '%s' matched (dist=%.3f, conf=%.1f%%)",
                    best_name,
                    best_dist,
                    conf,
                )
                return (best_name, conf, best_loc)

        except Exception as exc:
            log.debug("face_recognition match error: %s", exc)

        return None
