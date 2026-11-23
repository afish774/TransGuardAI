"""Pillar 4 – Weapon Detection with Batched Crops, Margin-Based Async CLIP Verification,
and Once-Per-Frame Spatial Streak Persistence.

Accuracy & CPU Performance Upgrades:
  1. Async Background CLIP Executor + Spatial Verdict Cache – never stalls the
     main tracking loop for ~300 ms on CPU while verifying candidate weapons.
  2. Margin-Based Contrastive CLIP Scoring – weapon must be Top-1, score >= 0.28,
     AND lead the strongest negative class by >= 0.08 using a 1.25x contextual
     crop (showing hand/grip context) across 10 transit negative categories.
  3. Batched YOLO Weapon Inference + Wrist Deduplication – predicts all valid
     person/wrist crops in a single model call instead of up to 18 separate passes.
  4. Tiered Multi-Frame Confirmation – never alerts on 1 frame; requires 2 frames
     for >= 0.65 conf, 3 frames for >= 0.50 conf, and WEAPON_CONFIRM_FRAMES (4)
     below 0.50. Once-per-frame deduplication prevents a single object seen in
     multiple crops from counting twice in one frame.
  5. Bounded Person Coupling – full-frame hits far from any passenger require
     much higher confidence (>= 0.62) and full streak confirmation.
"""

import os
import time
import logging
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Tuple, Dict, List, Optional

import cv2
import numpy as np

try:
    from ultralytics import YOLO
except Exception:
    YOLO = None

try:
    from transformers import pipeline
    from PIL import Image
    CLIP_AVAILABLE = True
except ImportError:
    CLIP_AVAILABLE = False

from engine.config import (
    WEAPON_CONF_THRESHOLD,
    WEAPON_CLASS_KEYWORDS,
    WEAPON_CROP_PADDING,
    WEAPON_MAX_CROPS_PER_FRAME,
    WEAPON_CONFIRM_FRAMES,
    WEAPON_RELINK_DIST_PX,
    WEAPON_RELINK_TTL_S,
    resolve_compute_device,
)
from engine.detectors.vlm_verifier import (
    WEAPON_NEGATIVE_PROMPTS,
    VisionLanguageVerifier,
    evaluate_weapon_scores,
)
from engine.utils.geometry import crop_bbox, bbox_center, boxes_intersect_with_radius, dist

log = logging.getLogger("trans-guard-engine")

# Realistic operational thresholds for edge transit surveillance
CLASS_THRESHOLDS = {
    "grenade": 0.58,
    "explosive": 0.55,
    "explosion": 0.55,
    "gun": 0.42,
    "pistol": 0.42,
    "handgun": 0.42,
    "firearm": 0.42,
    "revolver": 0.42,
    "rifle": 0.45,
    "weapon": 0.42,
    "knife": 0.40,
    "blade": 0.40,
}

# Run full-frame weapon scan every 4 frames to reduce false positive surface area
_FULL_FRAME_INTERVAL = 4
# Even a very high-confidence detection must persist into at least 2 frames
_MIN_CONFIRM_FRAMES = 2
# Contrastive CLIP thresholds
_CLIP_MIN_SCORE = 0.28
_CLIP_MIN_MARGIN = 0.08
# Cache CLIP verdicts per spatial object so CPU isn't hammered every frame
_CLIP_PASS_CACHE_S = 0.85
_CLIP_REJECT_CACHE_S = 1.10
# Max distance (px @ 720p) to couple a full-frame weapon hit to a passenger
_PERSON_COUPLING_MAX_PX = 220.0
# Minimum confidence for an uncoupled floating background weapon hit
_UNCOUPLED_MIN_CONF = 0.62


class WeaponDetector:
    def __init__(
        self,
        weights_path: str,
        conf: float = WEAPON_CONF_THRESHOLD,
        vlm: Optional[VisionLanguageVerifier] = None,
    ):
        self.model = None
        self.conf = conf
        self.names: Dict[int, str] = {}
        # Track-based streaks: {track_id: streak_count}
        self.streaks: Dict[int, int] = {}
        self.streak_last_seen: Dict[int, float] = {}
        # Spatial persistent tracks to survive ByteTrack ID switches
        self._spatial_streaks: List[Dict] = []
        self._scan_count: int = 0
        self._frame_index: int = 0
        self._scale: float = 1.0
        self._device, self._use_half, self._device_label = resolve_compute_device()
        self._vlm: Optional[VisionLanguageVerifier] = None
        self._owns_vlm: bool = False
        self.clip = None
        self._clip_executor: Optional[ThreadPoolExecutor] = None

        if not weights_path:
            return
        if YOLO is None:
            log.warning("ultralytics missing; weapon detection disabled")
            return
        if not os.path.exists(weights_path):
            log.warning(
                "Weapon weights '%s' not found; weapon detection disabled. "
                "Set WEAPON_MODEL / --weapon-model to a fine-tuned .pt file.",
                weights_path,
            )
            return
        try:
            self.model = YOLO(weights_path)
            self.names = dict(getattr(self.model, "names", {}) or {})
            log.info("Weapon model loaded from %s (classes: %s)",
                     weights_path, list(self.names.values()))
        except Exception as exc:
            log.warning("Failed to load weapon model %s: %s", weights_path, exc)
            self.model = None

        # Reuse shared GPU SigLIP/CLIP verifier when supplied by IncidentProcessor
        if vlm is not None:
            self._vlm = vlm
            self._owns_vlm = False
        elif CLIP_AVAILABLE:
            self._vlm = VisionLanguageVerifier()
            self._owns_vlm = True

        if self._vlm is not None and self._vlm.available:
            self.clip = self._vlm.pipe
            self._clip_executor = getattr(self._vlm, "_executor", None)

    def close(self) -> None:
        if getattr(self, "_owns_vlm", False) and getattr(self, "_vlm", None) is not None:
            self._vlm.close()
            self._vlm = None
            self._clip_executor = None
            return
        executor = getattr(self, "_clip_executor", None)
        if executor is not None and getattr(self, "_vlm", None) is None:
            executor.shutdown(wait=False, cancel_futures=True)
            self._clip_executor = None

    def calibrate(self, frame_h: int, ref_h: int = 720) -> None:
        """Set resolution scale factor for pixel-based thresholds."""
        self._scale = frame_h / ref_h

    @property
    def available(self) -> bool:
        return self.model is not None

    def _is_weapon(self, class_name: str) -> bool:
        lowered = class_name.lower()
        return any(keyword in lowered for keyword in WEAPON_CLASS_KEYWORDS)

    @staticmethod
    def _required_streak(confidence: float, coupled: bool = True) -> int:
        if not coupled:
            return max(WEAPON_CONFIRM_FRAMES, 3)
        if confidence >= 0.65:
            return max(_MIN_CONFIRM_FRAMES, 2)
        if confidence >= 0.50:
            return max(_MIN_CONFIRM_FRAMES, min(WEAPON_CONFIRM_FRAMES, 3))
        return max(_MIN_CONFIRM_FRAMES, WEAPON_CONFIRM_FRAMES)

    def _context_crop(self, frame: np.ndarray, abs_box: Tuple[int, int, int, int]) -> np.ndarray:
        """Extract a 1.25x padded crop around the candidate so CLIP sees hand/grip context."""
        crop, _ = crop_bbox(frame, abs_box, padding=0.25)
        if crop is not None and crop.size > 0:
            return crop
        bx1, by1, bx2, by2 = abs_box
        return frame[max(0, by1):min(frame.shape[0], by2),
                     max(0, bx1):min(frame.shape[1], bx2)]

    def _verify_with_clip(self, crop_bgr: np.ndarray, predicted_class: str) -> bool:
        """Zero-shot verification via shared SigLIP patch16 (or CLIP fallback)."""
        vlm = getattr(self, "_vlm", None)
        if vlm is not None and vlm.available and self.clip is vlm.pipe:
            return vlm.verify_weapon(crop_bgr, predicted_class)

        if self.clip is None or crop_bgr is None or crop_bgr.size == 0:
            return True
        try:
            rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(rgb)
            weapon_prompt = f"a photo of a real {predicted_class} weapon being held"
            candidate_labels = [weapon_prompt, *WEAPON_NEGATIVE_PROMPTS]
            result = self.clip(pil_img, candidate_labels=candidate_labels)
            passed, weapon_score, best_neg_score, margin = evaluate_weapon_scores(
                result, weapon_prompt, predicted_class, is_siglip=False
            )
            if not passed:
                top = result[0] if result else {}
                log.debug(
                    "CLIP rejected '%s'. weapon=%.3f neg=%.3f margin=%.3f (top: '%s' %.3f)",
                    predicted_class, weapon_score, best_neg_score, margin,
                    top.get("label", ""), float(top.get("score", 0.0)),
                )
            return passed
        except Exception as e:
            log.warning("CLIP verification failed; rejecting '%s' candidate: %s", predicted_class, e)
            return False

    def _find_or_update_spatial(
        self,
        assigned_id: int,
        class_name: str,
        confidence: float,
        abs_box: Tuple[int, int, int, int],
        now: float,
    ) -> Dict:
        """Find or create a spatial weapon streak entry and increment once per frame."""
        cx, cy = bbox_center(abs_box)
        relink_dist = WEAPON_RELINK_DIST_PX * self._scale

        best_match = None
        best_d = float("inf")
        for item in self._spatial_streaks:
            if now - item["last_seen"] > WEAPON_RELINK_TTL_S:
                continue
            if item.get("class_name") != class_name:
                continue
            d = dist((cx, cy), item["centroid"])
            if d < relink_dist and d < best_d:
                best_d = d
                best_match = item

        if best_match is not None:
            # Count once per frame (or when verify_candidate is invoked directly
            # in standalone tests with advancing timestamps without scan()).
            is_new_obs = (
                best_match.get("last_frame") != self._frame_index
                or (self._frame_index == 0 and now > best_match["last_seen"])
            )
            if is_new_obs:
                if now - best_match["last_seen"] > 0.75:
                    best_match["streak"] = 0
                best_match["streak"] += 1
                best_match["last_frame"] = self._frame_index
            best_match["last_seen"] = now
            best_match["centroid"] = (cx, cy)
            best_match["bbox"] = abs_box
            best_match["conf"] = max(best_match["conf"], confidence)
            best_match["assigned_id"] = assigned_id
            entry = best_match
        else:
            entry = {
                "assigned_id": assigned_id,
                "centroid": (cx, cy),
                "streak": 1,
                "last_seen": now,
                "last_frame": self._frame_index,
                "class_name": class_name,
                "conf": confidence,
                "bbox": abs_box,
                "clip_status": "PASS" if self.clip is None else "NONE",
                "clip_ts": 0.0,
                "clip_future": None,
            }
            self._spatial_streaks.append(entry)

        self.streaks[assigned_id] = entry["streak"]
        self.streak_last_seen[assigned_id] = now
        return entry

    def _update_spatial_streak(
        self,
        assigned_id: int,
        class_name: str,
        confidence: float,
        abs_box: Tuple[int, int, int, int],
        now: float,
    ) -> int:
        """Backward-compatible wrapper returning updated streak count."""
        return int(self._find_or_update_spatial(assigned_id, class_name, confidence, abs_box, now)["streak"])

    def _evaluate_clip_for_entry(
        self,
        entry: Dict,
        crop_bgr: np.ndarray,
        class_name: str,
        now: float,
        sync: bool = False,
    ) -> str:
        """Check or schedule CLIP verification for a spatial track entry.

        Returns one of ``"PASS"``, ``"REJECT"``, or ``"PENDING"``.
        """
        if self.clip is None:
            entry["clip_status"] = "PASS"
            return "PASS"

        # 1. Harvest completed async future if one is in flight
        fut: Optional[Future] = entry.get("clip_future")
        if fut is not None:
            if fut.done():
                entry["clip_future"] = None
                try:
                    passed = bool(fut.result())
                except Exception:
                    passed = False
                entry["clip_status"] = "PASS" if passed else "REJECT"
                entry["clip_ts"] = now
            else:
                return "PENDING"

        status = entry.get("clip_status", "NONE")
        age = now - float(entry.get("clip_ts", 0.0))

        # 2. Honor cached verdict within TTL so CPU isn't stalled every frame
        if status == "PASS" and age < _CLIP_PASS_CACHE_S:
            return "PASS"
        if status == "REJECT" and age < _CLIP_REJECT_CACHE_S:
            return "REJECT"

        # 3. Synchronous path (used by direct tests or when executor unavailable)
        executor = getattr(self, "_clip_executor", None)
        if sync or executor is None:
            passed = self._verify_with_clip(crop_bgr, class_name)
            entry["clip_status"] = "PASS" if passed else "REJECT"
            entry["clip_ts"] = now
            return entry["clip_status"]

        # 4. Submit asynchronously without blocking main tracking FPS
        crop_copy = crop_bgr.copy()
        entry["clip_future"] = executor.submit(self._verify_with_clip, crop_copy, class_name)
        entry["clip_status"] = "PENDING"
        return "PENDING"

    def _check_geometry(self, class_name: str, ww: int, wh: int) -> bool:
        min_side = 22 * self._scale
        if ww < min_side or wh < min_side:
            return False
        if "grenade" in class_name and (ww > 300 * self._scale or wh > 300 * self._scale):
            return False
        return True

    def scan(
        self,
        frame: np.ndarray,
        persons: List[Tuple[int, Tuple[int, int, int, int]]],
        landmarks_by_id: Optional[Dict[int, object]] = None,
    ) -> List[Tuple[int, str, float, Tuple[int, int, int, int]]]:
        self._frame_index += 1
        if self.model is None:
            return []

        now = time.time()
        hits: List[Tuple[int, str, float, Tuple[int, int, int, int]]] = []
        seen_ids = set()

        # Clean expired spatial streaks
        self._spatial_streaks = [
            item for item in self._spatial_streaks
            if now - item["last_seen"] <= WEAPON_RELINK_TTL_S
        ]

        # Build deduplicated crop batch (person crops + high-confidence wrist crops)
        crop_items: List[Tuple[int, np.ndarray, Tuple[int, int]]] = []
        if persons:
            wrist_r = int(140 * self._scale)
            min_wrist_sep = 110.0 * self._scale
            for track_id, person_bbox in persons[:WEAPON_MAX_CROPS_PER_FRAME]:
                seen_ids.add(track_id)
                crop, offset = crop_bbox(frame, person_bbox, WEAPON_CROP_PADDING)
                if crop is not None and crop.size > 0:
                    crop_items.append((track_id, crop, offset))

                # Add wrist-directed crops only when wrists are clearly visible
                # and separated enough to warrant extra zoom
                if landmarks_by_id and track_id in landmarks_by_id:
                    pts = landmarks_by_id[track_id]
                    if pts:
                        added_wrists: List[Tuple[int, int]] = []
                        for wrist_name in ("LEFT_WRIST", "RIGHT_WRIST"):
                            lm = pts.get(wrist_name)
                            if not lm or lm[2] < 0.45:
                                continue
                            wx, wy = int(lm[0]), int(lm[1])
                            if any(dist((wx, wy), aw) < min_wrist_sep for aw in added_wrists):
                                continue
                            x1 = max(0, wx - wrist_r)
                            y1 = max(0, wy - wrist_r)
                            x2 = min(frame.shape[1], wx + wrist_r)
                            y2 = min(frame.shape[0], wy + wrist_r)
                            if x2 - x1 > 40 and y2 - y1 > 40:
                                wcrop = frame[y1:y2, x1:x2]
                                if wcrop.size > 0:
                                    crop_items.append((track_id, wcrop, (x1, y1)))
                                    added_wrists.append((wx, wy))
        else:
            seen_ids.add(-1)
            crop_items.append((-1, frame, (0, 0)))

        # Batched YOLO weapon inference across all collected crops
        batch_results = []
        if crop_items:
            try:
                images = [item[1] for item in crop_items]
                batch_results = self.model.predict(
                    images,
                    conf=self.conf,
                    device=getattr(self, "_device", "cpu"),
                    half=getattr(self, "_use_half", False),
                    verbose=False,
                )
            except Exception as exc:
                log.debug("Weapon batch inference error: %s", exc)
                batch_results = []

        for (track_id, _crop, offset), result in zip(crop_items, batch_results):
            best = None
            if result.boxes is not None:
                for box in result.boxes:
                    class_id = int(box.cls[0])
                    class_name = str(self.names.get(class_id, class_id)).lower()
                    if not self._is_weapon(class_name):
                        continue
                    confidence = float(box.conf[0])
                    min_conf = CLASS_THRESHOLDS.get(class_name, self.conf)
                    if confidence < min_conf:
                        continue

                    wx1, wy1, wx2, wy2 = (int(v) for v in box.xyxy[0].tolist())
                    ww, wh = wx2 - wx1, wy2 - wy1
                    if not self._check_geometry(class_name, ww, wh):
                        continue

                    absolute = (wx1 + offset[0], wy1 + offset[1],
                                wx2 + offset[0], wy2 + offset[1])
                    if best is None or confidence > best[1]:
                        best = (class_name, confidence, absolute)

            if best is None:
                continue

            class_name, confidence, absolute = best
            entry = self._find_or_update_spatial(track_id, class_name, confidence, absolute, now)
            ctx_crop = self._context_crop(frame, absolute)
            clip_state = self._evaluate_clip_for_entry(entry, ctx_crop, class_name, now, sync=False)
            if clip_state != "PASS":
                continue

            req_streak = self._required_streak(confidence, coupled=(track_id != -1))
            if entry["streak"] >= req_streak:
                hits.append((track_id, class_name, confidence, absolute))

        # Full-frame fallback scan (every _FULL_FRAME_INTERVAL)
        self._scan_count += 1
        if not hits and self._scan_count % _FULL_FRAME_INTERVAL == 0:
            try:
                full_res = self.model.predict(
                    frame,
                    conf=self.conf,
                    device=getattr(self, "_device", "cpu"),
                    half=getattr(self, "_use_half", False),
                    verbose=False,
                )[0]
                if full_res.boxes is not None:
                    max_couple_px = _PERSON_COUPLING_MAX_PX * self._scale
                    expand_px = 100.0 * self._scale
                    for box in full_res.boxes:
                        class_id = int(box.cls[0])
                        class_name = str(self.names.get(class_id, class_id)).lower()
                        if not self._is_weapon(class_name):
                            continue
                        confidence = float(box.conf[0])
                        min_conf = CLASS_THRESHOLDS.get(class_name, self.conf)
                        if confidence < min_conf:
                            continue

                        abs_box = tuple(int(v) for v in box.xyxy[0].tolist())
                        bx1, by1, bx2, by2 = abs_box
                        if not self._check_geometry(class_name, bx2 - bx1, by2 - by1):
                            continue

                        # Bounded person coupling: only attach to a person actually near the object
                        assigned_id = -1
                        bcx, bcy = bbox_center(abs_box)
                        min_d = float("inf")
                        for pid, pbox in persons:
                            pcx, pcy = bbox_center(pbox)
                            d = dist((bcx, bcy), (pcx, pcy))
                            if d < min_d and (
                                d <= max_couple_px
                                or boxes_intersect_with_radius(abs_box, pbox, expand_px)
                            ):
                                min_d = d
                                assigned_id = pid

                        coupled = assigned_id != -1
                        # Floating uncoupled background detections need much stronger evidence
                        if not coupled and confidence < _UNCOUPLED_MIN_CONF:
                            continue

                        entry = self._find_or_update_spatial(assigned_id, class_name, confidence, abs_box, now)
                        ctx_crop = self._context_crop(frame, abs_box)
                        clip_state = self._evaluate_clip_for_entry(entry, ctx_crop, class_name, now, sync=False)
                        if clip_state != "PASS":
                            continue

                        req_streak = self._required_streak(confidence, coupled=coupled)
                        if entry["streak"] >= req_streak:
                            hits.append((assigned_id, class_name, confidence, abs_box))
            except Exception as exc:
                log.debug("Weapon full-frame inference error: %s", exc)

        # Soft decay for tracks not seen recently
        for tid in list(self.streaks):
            if tid not in seen_ids and tid != -1:
                if now - self.streak_last_seen.get(tid, 0.0) > 2.0:
                    del self.streaks[tid]
                    self.streak_last_seen.pop(tid, None)

        return hits

    def verify_candidate(
        self,
        track_id: int,
        class_name: str,
        confidence: float,
        bbox: Tuple[int, int, int, int],
        frame: np.ndarray,
        now: Optional[float] = None,
        sync_clip: bool = True,
    ) -> Optional[Tuple[int, str, float, Tuple[int, int, int, int]]]:
        """Verify an external weapon detection (e.g. from primary model) using CLIP and streak history."""
        ts = time.time() if now is None else now
        cl_name = class_name.lower()
        if not self._is_weapon(cl_name):
            return None

        min_conf = CLASS_THRESHOLDS.get(cl_name, self.conf)
        if confidence < min_conf:
            return None

        bx1, by1, bx2, by2 = bbox
        if not self._check_geometry(cl_name, bx2 - bx1, by2 - by1):
            return None

        ctx_crop = self._context_crop(frame, bbox)
        if ctx_crop.size == 0:
            return None

        entry = self._find_or_update_spatial(track_id, cl_name, confidence, bbox, ts)
        clip_state = self._evaluate_clip_for_entry(entry, ctx_crop, cl_name, ts, sync=sync_clip)
        if clip_state != "PASS":
            return None

        req_streak = self._required_streak(confidence, coupled=(track_id != -1))
        if entry["streak"] >= req_streak:
            return (track_id, cl_name, confidence, bbox)
        return None
