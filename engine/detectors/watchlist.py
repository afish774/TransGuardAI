"""Pillar 6 – Biometric Watchlist (InsightFace SCRFD + ArcFace 512-D / dlib ResNet-34).

Key accuracy & CPU/GPU-efficiency upgrades:
  1. Dual-Backend Engine (InsightFace ONNX -> dlib Fallback) – automatically
     uses InsightFace SCRFD + ArcFace 512-D embeddings on GPU/CPU when
     ``insightface`` is installed (selecting ``buffalo_l`` on >= 6 GB RTX 3060
     GPUs or ``buffalo_sc`` on 4 GB Quadro T2000 / CPU), and seamlessly falls
     back to ``face_recognition`` (dlib ResNet-34) otherwise.
  2. Multi-Photo Enrollment & Centroid Embeddings – supports uploading multiple
     reference angles/lighting photos under the same suspect name, matching
     against both individual shots and the L2-normalized identity centroid.
  3. 3-Gate Face Quality Filter – enforces FACE_MIN_SIZE, Laplacian sharpness
     (rejecting motion blur), and 5-point frontal pose symmetry (InsightFace).
  4. Multi-Frame Temporal Consensus (2-of-N within 4s) – eliminates 1-frame
     false matches while rescanning pending hits rapidly (0.35s).
  5. Quality-Aware Non-Match Backoff – skips redundant re-encoding of clear
     non-matches for 4s unless a noticeably sharper/closer view arrives.
"""

import logging
import time
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from engine.config import (
    FACE_BACKEND_PREF,
    FACE_CONSENSUS_HITS,
    FACE_CONSENSUS_WINDOW_S,
    FACE_COSINE_THRESHOLD,
    FACE_MATCH_TOLERANCE,
    FACE_MIN_SHARPNESS,
    FACE_MIN_SIZE,
    FACE_NON_MATCH_BACKOFF_S,
    FACE_PENDING_RESCAN_S,
    FACE_RESCAN_INTERVAL_S,
    INSIGHTFACE_MODEL,
    resolve_compute_device,
)

log = logging.getLogger("trans-guard-engine")

# ---------------------------------------------------------------------------
# Backend detection (InsightFace preferred, dlib face_recognition fallback)
# ---------------------------------------------------------------------------
FACE_BACKEND: Optional[str] = None
_insightface_app_cls = None
_face_recognition = None

if FACE_BACKEND_PREF in ("auto", "insightface"):
    try:
        from insightface.app import FaceAnalysis as _FaceAnalysis
        # Future-proof insightface.utils.face_align against scikit-image >=0.26
        # deprecating (and 2.2 removing) SimilarityTransform.estimate()
        try:
            from insightface.utils import face_align as _face_align
            from skimage import transform as _sk_trans

            if hasattr(_sk_trans.SimilarityTransform, "from_estimate"):
                def _estimate_norm_compat(lmk, image_size=112, mode="arcface"):
                    assert lmk.shape == (5, 2)
                    assert image_size % 112 == 0 or image_size % 128 == 0
                    if image_size % 112 == 0:
                        ratio = float(image_size) / 112.0
                        diff_x = 0.0
                    else:
                        ratio = float(image_size) / 128.0
                        diff_x = 8.0 * ratio
                    dst = _face_align.arcface_dst * ratio
                    dst[:, 0] += diff_x
                    tform = _sk_trans.SimilarityTransform.from_estimate(lmk, dst)
                    return tform.params[0:2, :]

                _face_align.estimate_norm = _estimate_norm_compat
        except Exception:
            pass
        _insightface_app_cls = _FaceAnalysis
        FACE_BACKEND = "insightface"
    except Exception:
        _insightface_app_cls = None

if FACE_BACKEND is None or FACE_BACKEND_PREF == "dlib":
    try:
        import face_recognition as _fr
        _face_recognition = _fr
        if FACE_BACKEND is None or FACE_BACKEND_PREF == "dlib":
            FACE_BACKEND = "face_recognition"
    except ModuleNotFoundError:
        if FACE_BACKEND is None:
            log.warning("Neither insightface nor face_recognition installed; watchlist pillar disabled")


def compute_sharpness(bgr_img: Optional[np.ndarray]) -> float:
    """Return Laplacian variance (sharpness metric) of a BGR image crop."""
    if bgr_img is None or bgr_img.size == 0:
        return 0.0
    if bgr_img.ndim == 3:
        gray = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)
    else:
        gray = bgr_img
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def is_frontal_5pt(kps: Optional[np.ndarray]) -> bool:
    """Verify rough frontal symmetry from InsightFace 5-point facial landmarks.

    ``kps`` shape is (5, 2): [left_eye, right_eye, nose, mouth_left, mouth_right].
    Rejects severe side-profiles where nose lies far outside the inter-ocular x-span.
    """
    if kps is None:
        return True
    arr = np.asarray(kps, dtype=np.float32)
    if arr.shape != (5, 2):
        return True
    le_x, re_x = float(arr[0, 0]), float(arr[1, 0])
    nose_x = float(arr[2, 0])
    min_eye = min(le_x, re_x)
    max_eye = max(le_x, re_x)
    eye_span = max_eye - min_eye
    if eye_span < 5.0:
        return False
    margin = eye_span * 0.42
    return (min_eye - margin) <= nose_x <= (max_eye + margin)


def _select_insightface_pack() -> Tuple[str, List[str], int]:
    """Select InsightFace model pack + ONNX Runtime providers for active hardware."""
    dev, _, _ = resolve_compute_device()
    vram_gb = 0.0
    if dev.startswith("cuda"):
        try:
            import torch
            vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
        except Exception:
            vram_gb = 0.0

    # Check whether onnxruntime-gpu CUDAExecutionProvider is actually available
    providers = ["CPUExecutionProvider"]
    ctx_id = -1
    if dev.startswith("cuda"):
        try:
            import onnxruntime as ort
            if "CUDAExecutionProvider" in ort.get_available_providers():
                providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
                ctx_id = 0
        except Exception:
            pass

    if INSIGHTFACE_MODEL and INSIGHTFACE_MODEL.lower() != "auto":
        pack = INSIGHTFACE_MODEL
    elif ctx_id == 0 and vram_gb >= 5.5:
        # RTX 3060 (6 GB) or higher -> full-accuracy ResNet50 ArcFace pack
        pack = "buffalo_l"
    else:
        # Quadro T2000 (4 GB) or CPU -> compact fast SCRFD + MobileFaceNet pack
        pack = "buffalo_sc"
    return pack, providers, ctx_id


class Watchlist:
    """Biometric watchlist supporting InsightFace (SCRFD+ArcFace) and dlib ResNet-34."""

    def __init__(
        self,
        tolerance: float = FACE_MATCH_TOLERANCE,
        cosine_threshold: float = FACE_COSINE_THRESHOLD,
        backend: Optional[str] = None,
    ):
        self.encodings: List[np.ndarray] = []
        self.names: List[str] = []
        self._encoding_frontal: List[bool] = []
        # Multi-photo normalized centroid per identity (built when >= 2 photos share a name)
        self._identity_centroids: Dict[str, np.ndarray] = {}
        self.tolerance = tolerance
        self.cosine_threshold = cosine_threshold
        self.backend = backend or FACE_BACKEND
        self._insight_app = None

        # Confirmed positive matches only: track_id -> matched name
        self._track_cache: Dict[int, Optional[str]] = {}
        # Pending consensus hits: key -> list of timestamps
        self._pending_hits: Dict[str, List[float]] = {}
        # Non-match backoff metadata: track_id -> (best_quality_score, timestamp)
        self._non_match_meta: Dict[int, Tuple[float, float]] = {}

        if self.backend == "insightface" and _insightface_app_cls is not None:
            try:
                pack, providers, ctx_id = _select_insightface_pack()
                app = _insightface_app_cls(name=pack, providers=providers)
                app.prepare(ctx_id=ctx_id, det_size=(640, 640))
                self._insight_app = app
                log.info(
                    "Watchlist initialized with InsightFace '%s' (providers=%s, cosine_thresh=%.2f)",
                    pack,
                    providers,
                    self.cosine_threshold,
                )
            except Exception as exc:
                log.warning(
                    "InsightFace initialization failed (%s); falling back to dlib face_recognition.",
                    exc,
                )
                self._insight_app = None
                self.backend = "face_recognition" if _face_recognition is not None else None

    # ------------------------------------------------------------------
    # Multi-photo centroid builder
    # ------------------------------------------------------------------
    def _rebuild_centroids(self) -> None:
        """Build per-identity mean embedding, preferring frontal shots so extreme 90° profiles
        don't dilute the frontal centroid while remaining active in ``self.encodings``."""
        all_grouped: Dict[str, List[np.ndarray]] = defaultdict(list)
        frontal_grouped: Dict[str, List[np.ndarray]] = defaultdict(list)
        flags = getattr(self, "_encoding_frontal", None) or [True] * len(self.encodings)
        if len(flags) < len(self.encodings):
            flags = list(flags) + [True] * (len(self.encodings) - len(flags))

        for name, enc, is_front in zip(self.names, self.encodings, flags):
            vec = np.asarray(enc, dtype=np.float32)
            all_grouped[name].append(vec)
            if is_front:
                frontal_grouped[name].append(vec)

        centroids: Dict[str, np.ndarray] = {}
        for name, all_vecs in all_grouped.items():
            if len(all_vecs) < 2:
                continue
            vecs = frontal_grouped[name] if len(frontal_grouped[name]) >= 2 else all_vecs
            mean_vec = np.mean(np.stack(vecs, axis=0), axis=0)
            if self.backend == "insightface":
                norm = float(np.linalg.norm(mean_vec))
                if norm > 1e-6:
                    mean_vec = mean_vec / norm
            centroids[name] = mean_vec
        self._identity_centroids = centroids

    # ------------------------------------------------------------------
    # Watchlist sync (from backend / control message)
    # ------------------------------------------------------------------
    def _encode_reference_insightface(self, image_bgr: np.ndarray) -> Tuple[Optional[np.ndarray], bool]:
        if self._insight_app is None:
            return (None, False)
        faces = self._insight_app.get(image_bgr)
        if not faces:
            return (None, False)
        # Pick largest face in reference photo
        best = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        frontal = is_frontal_5pt(getattr(best, "kps", None))
        emb = getattr(best, "normed_embedding", None)
        if emb is None:
            raw = getattr(best, "embedding", None)
            if raw is None:
                return (None, False)
            norm = float(np.linalg.norm(raw))
            emb = raw / norm if norm > 1e-6 else None
        return (np.asarray(emb, dtype=np.float32) if emb is not None else None, frontal)

    def _encode_reference_dlib(self, image_bgr: np.ndarray) -> Optional[np.ndarray]:
        if _face_recognition is None:
            return None
        rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        locs = _face_recognition.face_locations(rgb, number_of_times_to_upsample=1, model="hog")
        if not locs:
            locs = _face_recognition.face_locations(rgb, number_of_times_to_upsample=2, model="hog")
        if not locs:
            return None
        encs = _face_recognition.face_encodings(rgb, known_face_locations=locs)
        return encs[0] if encs else None

    def replace_from_images(self, targets: List[Dict[str, object]]) -> None:
        """Re-encode every reference image and rebuild gallery + multi-photo centroids."""
        if self.backend is None:
            return
        new_encodings: List[np.ndarray] = []
        new_names: List[str] = []
        new_frontal: List[bool] = []

        for target in targets:
            if not isinstance(target, dict):
                continue
            name = str(target.get("name", "unknown"))
            image_bytes = target.get("image")
            if not isinstance(image_bytes, bytes):
                continue
            try:
                image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
                if image is None:
                    continue
                is_front = True
                if self.backend == "insightface" and self._insight_app is not None:
                    enc, is_front = self._encode_reference_insightface(image)
                else:
                    enc = self._encode_reference_dlib(image)
                if enc is None:
                    log.warning("No face found in reference image for %s", name)
                    continue
                new_encodings.append(enc)
                new_names.append(name)
                new_frontal.append(is_front)
                log.info(
                    "Watchlist (%s) encoded %s face for '%s'",
                    self.backend,
                    "frontal" if is_front else "angled/profile",
                    name,
                )
            except Exception as exc:
                log.warning("Failed to encode %s: %s", name, exc)

        self.encodings = new_encodings
        self.names = new_names
        self._encoding_frontal = new_frontal
        self._rebuild_centroids()
        # Invalidate caches when the watchlist changes
        self._track_cache.clear()
        self._pending_hits.clear()
        self._non_match_meta.clear()
        unique_names = sorted(set(self.names))
        log.info(
            "Watchlist synced (%s): %d reference photo(s) across %d identity(ies) (%s)",
            self.backend,
            len(self.names),
            len(unique_names),
            ", ".join(unique_names) if unique_names else "none",
        )

    # ------------------------------------------------------------------
    # Per-track cache & consensus helpers
    # ------------------------------------------------------------------
    def cache_hit(self, track_id: int) -> Optional[str]:
        """Return cached name if this track was already positively confirmed, else None."""
        return self._track_cache.get(track_id)

    def is_cached(self, track_id: int) -> bool:
        """Return True ONLY if this track was already positively confirmed."""
        return self._track_cache.get(track_id) is not None

    def has_pending_hit(self, track_id: int, now: float) -> bool:
        """Return True if *track_id* has an unconfirmed watchlist hit awaiting 2nd frame."""
        prefix = f"t{track_id}:"
        for key, timestamps in list(self._pending_hits.items()):
            if not key.startswith(prefix):
                continue
            fresh = [ts for ts in timestamps if now - ts <= FACE_CONSENSUS_WINDOW_S]
            if fresh:
                self._pending_hits[key] = fresh
                return True
            del self._pending_hits[key]
        return False

    def should_skip_scan(
        self,
        track_id: int,
        crop_quality: float,
        last_scan_ts: float,
        now: float,
    ) -> bool:
        """Decide whether to skip encoding *track_id* on this frame for efficiency.

        - Pending hits rescan fast (FACE_PENDING_RESCAN_S = 0.35s) for rapid confirmation.
        - Confirmed clear non-matches back off for 4.0s UNLESS a much sharper/larger
          view appears (quality > 1.35x previous best).
        """
        if self.has_pending_hit(track_id, now):
            return (now - last_scan_ts) < FACE_PENDING_RESCAN_S

        if (now - last_scan_ts) < FACE_RESCAN_INTERVAL_S:
            return True

        meta = self._non_match_meta.get(track_id)
        if meta is not None:
            best_q, scanned_at = meta
            if (now - scanned_at) < FACE_NON_MATCH_BACKOFF_S and crop_quality <= best_q * 1.25:
                return True
        return False

    def _record_consensus(
        self,
        name: str,
        track_id: Optional[int],
        now: float,
    ) -> bool:
        """Record a positive frame hit and return True once FACE_CONSENSUS_HITS is reached."""
        key = f"t{track_id}:{name}" if track_id is not None else f"frame:{name}"
        recent = [
            ts for ts in self._pending_hits.get(key, [])
            if now - ts <= FACE_CONSENSUS_WINDOW_S
        ]
        recent.append(now)
        self._pending_hits[key] = recent
        if len(recent) >= max(1, FACE_CONSENSUS_HITS):
            self._pending_hits.pop(key, None)
            return True
        return False

    def forget_tracks(self, active_ids: set) -> None:
        """Remove entries for tracks that are no longer visible."""
        for tid in list(self._track_cache):
            if tid not in active_ids:
                del self._track_cache[tid]
        for tid in list(self._non_match_meta):
            if tid not in active_ids:
                del self._non_match_meta[tid]
        for key in list(self._pending_hits):
            if key.startswith("t"):
                tid_str = key[1:].split(":", 1)[0]
                if tid_str.lstrip("-").isdigit() and int(tid_str) not in active_ids:
                    del self._pending_hits[key]

    # ------------------------------------------------------------------
    # Quality & similarity helpers
    # ------------------------------------------------------------------
    def _filter_quality_locs(
        self,
        bgr_img: np.ndarray,
        locs: List[Tuple[int, int, int, int]],
    ) -> List[Tuple[Tuple[int, int, int, int], float]]:
        """Filter face boxes by FACE_MIN_SIZE and Laplacian sharpness."""
        h, w = bgr_img.shape[:2]
        valid: List[Tuple[Tuple[int, int, int, int], float]] = []
        for loc in locs:
            top, right, bottom, left = loc
            t = max(0, int(top))
            b = min(h, int(bottom))
            l = max(0, int(left))
            r = min(w, int(right))
            fw, fh = r - l, b - t
            if fw < FACE_MIN_SIZE or fh < FACE_MIN_SIZE:
                continue
            face_patch = bgr_img[t:b, l:r]
            sharp = compute_sharpness(face_patch)
            if sharp < FACE_MIN_SHARPNESS:
                continue
            quality = float(min(fw, fh)) * (sharp ** 0.5)
            valid.append(((t, r, b, l), quality))
        return valid

    def _best_cosine_match(self, query_emb: np.ndarray) -> Tuple[Optional[str], float]:
        """Return ``(best_name, best_cosine_sim)`` across gallery photos + identity centroids."""
        q = np.asarray(query_emb, dtype=np.float32)
        q_norm = float(np.linalg.norm(q))
        if q_norm < 1e-6:
            return (None, 0.0)
        q = q / q_norm

        best_name: Optional[str] = None
        best_sim = -1.0

        for name, ref in zip(self.names, self.encodings):
            r = np.asarray(ref, dtype=np.float32)
            r_norm = float(np.linalg.norm(r))
            if r_norm < 1e-6:
                continue
            sim = float(np.dot(q, r / r_norm))
            if sim > best_sim:
                best_sim = sim
                best_name = name

        for name, centroid in self._identity_centroids.items():
            c_norm = float(np.linalg.norm(centroid))
            if c_norm < 1e-6:
                continue
            sim = float(np.dot(q, centroid / c_norm))
            if sim > best_sim:
                best_sim = sim
                best_name = name

        return (best_name, best_sim)

    def _finalize_match(
        self,
        name: str,
        conf: float,
        best_loc: Tuple[int, int, int, int],
        track_id: Optional[int],
        require_consensus: bool,
        ts: float,
        metric_label: str,
    ) -> Optional[Tuple[str, float, Tuple[int, int, int, int]]]:
        if require_consensus and not self._record_consensus(name, track_id, ts):
            log.debug(
                "Watchlist pending consensus for '%s' on track #%s (%s)",
                name, track_id, metric_label,
            )
            return None
        if track_id is not None:
            self._track_cache[track_id] = name
            self._non_match_meta.pop(track_id, None)
        log.info(
            "Watchlist (%s) target '%s' matched (%s, conf=%.1f%%)",
            self.backend, name, metric_label, conf,
        )
        return (name, conf, best_loc)

    # ------------------------------------------------------------------
    # Core matching
    # ------------------------------------------------------------------
    def _match_insightface(
        self,
        face_bgr: np.ndarray,
        track_id: Optional[int],
        require_consensus: bool,
        ts: float,
    ) -> Optional[Tuple[str, float, Tuple[int, int, int, int]]]:
        h, w = face_bgr.shape[:2]
        faces = self._insight_app.get(face_bgr)
        if not faces:
            return None

        best_name: Optional[str] = None
        best_sim = -1.0
        best_eff_thresh = self.cosine_threshold
        best_loc: Tuple[int, int, int, int] = (0, 0, 0, 0)
        best_crop_quality = 0.0
        scanned_any_clear = False

        for face in faces:
            x1, y1, x2, y2 = (int(v) for v in face.bbox)
            l, t = max(0, x1), max(0, y1)
            r, b = min(w, x2), min(h, y2)
            fw, fh = r - l, b - t
            if fw < FACE_MIN_SIZE or fh < FACE_MIN_SIZE:
                continue
            frontal = is_frontal_5pt(getattr(face, "kps", None))
            det_score = float(getattr(face, "det_score", 1.0))
            # Allow confident angled/top-down CCTV faces (det_score >= 0.65) to match
            # multi-angle reference photos with a +0.03 margin instead of dropping them
            if not frontal and det_score < 0.65:
                continue
            sharp = compute_sharpness(face_bgr[t:b, l:r])
            if sharp < FACE_MIN_SHARPNESS:
                continue

            scanned_any_clear = True
            quality = float(min(fw, fh)) * (sharp ** 0.5)
            best_crop_quality = max(best_crop_quality, quality)

            emb = getattr(face, "normed_embedding", None)
            if emb is None:
                emb = getattr(face, "embedding", None)
            if emb is None:
                continue

            cand_name, cand_sim = self._best_cosine_match(emb)
            eff_thresh = self.cosine_threshold if frontal else (self.cosine_threshold + 0.03)
            if cand_name is not None and (cand_sim - eff_thresh) > (best_sim - best_eff_thresh):
                best_sim = cand_sim
                best_eff_thresh = eff_thresh
                best_name = cand_name
                best_loc = (l, t, r, b)

        if best_name is not None and best_sim >= best_eff_thresh:
            # Map cosine similarity [best_eff_thresh..0.85] -> [65..99]%
            span = max(0.05, 0.85 - best_eff_thresh)
            conf = round(max(60.0, min(99.0, 65.0 + ((best_sim - best_eff_thresh) / span) * 34.0)), 1)
            return self._finalize_match(
                best_name, conf, best_loc, track_id, require_consensus, ts, f"sim={best_sim:.3f}"
            )

        if scanned_any_clear and track_id is not None:
            prev_meta = self._non_match_meta.get(track_id)
            prev_q = prev_meta[0] if prev_meta is not None else 0.0
            self._non_match_meta[track_id] = (max(prev_q, best_crop_quality), ts)
        return None

    def _match_dlib(
        self,
        face_bgr: np.ndarray,
        hint_locations: Optional[List[Tuple[int, int, int, int]]],
        track_id: Optional[int],
        require_consensus: bool,
        ts: float,
    ) -> Optional[Tuple[str, float, Tuple[int, int, int, int]]]:
        if _face_recognition is None:
            return None
        rgb = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB)
        if hint_locations:
            raw_locs = hint_locations
        else:
            raw_locs = _face_recognition.face_locations(
                rgb, number_of_times_to_upsample=1, model="hog"
            )
        if not raw_locs:
            return None

        quality_locs = self._filter_quality_locs(face_bgr, raw_locs)
        if not quality_locs:
            return None

        locs = [item[0] for item in quality_locs]
        best_crop_quality = max(item[1] for item in quality_locs)
        encs = _face_recognition.face_encodings(rgb, known_face_locations=locs)
        if not encs:
            return None

        # Compare against both individual shots and multi-photo centroids
        all_refs = list(self.encodings) + list(self._identity_centroids.values())
        all_names = list(self.names) + list(self._identity_centroids.keys())

        best_name: Optional[str] = None
        best_dist = float("inf")
        best_loc: Tuple[int, int, int, int] = (0, 0, 0, 0)

        for enc, loc in zip(encs, locs):
            distances = _face_recognition.face_distance(all_refs, enc)
            if len(distances) == 0:
                continue
            min_idx = int(np.argmin(distances))
            min_dist = float(distances[min_idx])
            if min_dist < best_dist:
                best_dist = min_dist
                best_name = all_names[min_idx]
                top, right, bottom, left = loc
                best_loc = (left, top, right, bottom)

        if best_name is not None and best_dist <= self.tolerance:
            conf = round(max(50.0, min(99.0, (1.0 - best_dist / self.tolerance) * 100.0)), 1)
            return self._finalize_match(
                best_name, conf, best_loc, track_id, require_consensus, ts, f"dist={best_dist:.3f}"
            )

        if track_id is not None:
            prev_meta = self._non_match_meta.get(track_id)
            prev_q = prev_meta[0] if prev_meta is not None else 0.0
            self._non_match_meta[track_id] = (max(prev_q, best_crop_quality), ts)
        return None

    def match(
        self,
        face_bgr: np.ndarray,
        hint_locations: Optional[List[Tuple[int, int, int, int]]] = None,
        track_id: Optional[int] = None,
        require_consensus: bool = False,
        now: Optional[float] = None,
    ) -> Optional[Tuple[str, float, Tuple[int, int, int, int]]]:
        """Compare a BGR image against the watchlist with quality gating & consensus."""
        if not self.encodings or face_bgr is None or face_bgr.size == 0:
            return None

        ts = time.time() if now is None else now
        try:
            if self.backend == "insightface" and self._insight_app is not None:
                return self._match_insightface(face_bgr, track_id, require_consensus, ts)
            return self._match_dlib(face_bgr, hint_locations, track_id, require_consensus, ts)
        except Exception as exc:
            log.debug("Watchlist match error (%s): %s", self.backend, exc)
            return None
