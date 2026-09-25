import os
import math
import logging
import cv2
import numpy as np
from typing import Tuple, Dict, List, Optional

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

try:
    from transformers import pipeline
    from PIL import Image
    CLIP_AVAILABLE = True
except ImportError:
    CLIP_AVAILABLE = False

from engine.config import WEAPON_CONF_THRESHOLD, WEAPON_CLASS_KEYWORDS, WEAPON_CROP_PADDING, WEAPON_MAX_CROPS_PER_FRAME, WEAPON_CONFIRM_FRAMES
from engine.utils.geometry import crop_bbox

log = logging.getLogger("trans-guard-engine")

# Minimum confidence per class to avoid false positives (overrides default)
CLASS_THRESHOLDS = {
    "grenade": 0.65,
    "gun": 0.50,
    "pistol": 0.50,
    "handgun": 0.50,
    "firearm": 0.50,
    "knife": 0.45,
    "explosion": 0.50
}

class WeaponDetector:
    def __init__(self, weights_path: str, conf: float = WEAPON_CONF_THRESHOLD):
        self.model = None
        self.conf = conf
        self.names: Dict[int, str] = {}
        self.streaks: Dict[int, int] = {}
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

        self.clip = None
        if CLIP_AVAILABLE:
            try:
                log.info("Loading CLIP Zero-Shot classifier for weapon verification...")
                self.clip = pipeline("zero-shot-image-classification", model="openai/clip-vit-base-patch32")
                log.info("CLIP Zero-Shot classifier loaded.")
            except Exception as e:
                log.warning("Failed to load CLIP classifier: %s", e)

    @property
    def available(self) -> bool:
        return self.model is not None

    def _is_weapon(self, class_name: str) -> bool:
        lowered = class_name.lower()
        return any(keyword in lowered for keyword in WEAPON_CLASS_KEYWORDS)

    def _verify_with_clip(self, crop_bgr: np.ndarray, predicted_class: str) -> bool:
        if self.clip is None or crop_bgr.size == 0:
            return True
        try:
            rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(rgb)
            
            candidate_labels = [
                f"a photo of a {predicted_class} weapon",
                "a photo of a human hand",
                "a photo of a smartphone or phone",
                "a photo of clothing or fabric",
                "a photo of an empty background"
            ]
            
            result = self.clip(pil_img, candidate_labels=candidate_labels)
            top_label = result[0]['label']
            
            if predicted_class in top_label:
                return True
                
            log.debug("CLIP rejected '%s'. Top guess: '%s' (score: %.2f)", 
                      predicted_class, top_label, result[0]['score'])
            return False
        except Exception as e:
            log.debug("CLIP verification error: %s", e)
            return True

    def scan(
        self,
        frame: np.ndarray,
        persons: List[Tuple[int, Tuple[int, int, int, int]]],
        landmarks_by_id: Optional[Dict[int, object]] = None,
    ) -> List[Tuple[int, str, float, Tuple[int, int, int, int]]]:
        if self.model is None:
            return []
        hits: List[Tuple[int, str, float, Tuple[int, int, int, int]]] = []
        seen_ids = set()

        scan_regions: List[Tuple[int, Optional[Tuple[int, int, int, int]], float, bool]] = []
        if persons:
            for track_id, person_bbox in persons[:WEAPON_MAX_CROPS_PER_FRAME]:
                seen_ids.add(track_id)
                scan_regions.append((track_id, person_bbox, WEAPON_CROP_PADDING, False))
                if landmarks_by_id and track_id in landmarks_by_id:
                    pts = landmarks_by_id[track_id]
                    if pts:
                        for wrist_name in ("LEFT_WRIST", "RIGHT_WRIST"):
                            lm = pts.get(wrist_name)
                            if lm and lm[2] >= 0.30:
                                wx, wy = int(lm[0]), int(lm[1])
                                r = 150
                                x1 = max(0, wx - r)
                                y1 = max(0, wy - r)
                                x2 = min(frame.shape[1], wx + r)
                                y2 = min(frame.shape[0], wy + r)
                                if x2 - x1 > 40 and y2 - y1 > 40:
                                    scan_regions.append((track_id, (x1, y1, x2, y2), 0.0, True))
        else:
            seen_ids.add(-1)
            scan_regions.append((-1, None, 0.0, False))

        for track_id, crop_box, padding, is_wrist in scan_regions:
            if crop_box is not None and padding > 0.0:
                crop, offset = crop_bbox(frame, crop_box, padding)
            elif crop_box is not None:
                x1, y1, x2, y2 = crop_box
                crop, offset = frame[y1:y2, x1:x2], (x1, y1)
            else:
                crop, offset = frame, (0, 0)
            
            if crop is None or crop.size == 0:
                continue
            
            try:
                result = self.model.predict(crop, conf=self.conf, verbose=False)[0]
            except Exception as exc:
                log.debug("Weapon inference error: %s", exc)
                continue
                
            best = None
            if result.boxes is not None:
                for box in result.boxes:
                    class_id = int(box.cls[0])
                    class_name = str(self.names.get(class_id, class_id)).lower()
                    if not self._is_weapon(class_name):
                        continue
                    confidence = float(box.conf[0])
                    
                    # Apply class-specific thresholds
                    min_conf = CLASS_THRESHOLDS.get(class_name, self.conf)
                    if confidence < min_conf:
                        continue
                        
                    wx1, wy1, wx2, wy2 = (int(v) for v in box.xyxy[0].tolist())
                    
                    # Geometric filtering: grenades shouldn't be huge
                    ww, wh = wx2 - wx1, wy2 - wy1
                    if "grenade" in class_name and (ww > 300 or wh > 300):
                        continue
                        
                    absolute = (wx1 + offset[0], wy1 + offset[1],
                                wx2 + offset[0], wy2 + offset[1])
                    if best is None or confidence > best[1]:
                        # Extract the exact bbox crop for CLIP to verify
                        obj_crop = crop[wy1:wy2, wx1:wx2]
                        if obj_crop.size > 0:
                            best = (class_name, confidence, absolute, obj_crop)
                        
            if best is None:
                if not is_wrist:
                    self.streaks[track_id] = max(0, self.streaks.get(track_id, 0) - 1)
                continue
                
            # Run CLIP verification if we found a potential weapon
            if not self._verify_with_clip(best[3], best[0]):
                self.streaks[track_id] = max(0, self.streaks.get(track_id, 0) - 1)
                continue
                
            streak = self.streaks.get(track_id, 0) + 1
            self.streaks[track_id] = streak
            
            # Require temporal consensus (streak) for ALL weapons to prevent single-frame hallucination flashes
            if streak >= WEAPON_CONFIRM_FRAMES:
                hits.append((track_id, best[0], best[1], best[2]))

        if not hits and persons:
            try:
                full_res = self.model.predict(frame, conf=self.conf, verbose=False)[0]
                if full_res.boxes is not None:
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
                        ww, wh = bx2 - bx1, by2 - by1
                        if "grenade" in class_name and (ww > 300 or wh > 300):
                            continue
                            
                        assigned_id = -1
                        bx1, by1, bx2, by2 = abs_box
                        bcx, bcy = (bx1 + bx2) / 2.0, (by1 + by2) / 2.0
                        min_d = float("inf")
                        for pid, pbox in persons:
                            px1, py1, px2, py2 = pbox
                            pcx, pcy = (px1 + px2) / 2.0, (py1 + py2) / 2.0
                            d = math.hypot(bcx - pcx, bcy - pcy)
                            if d < min_d:
                                min_d = d
                                assigned_id = pid
                        if not self._verify_with_clip(frame[by1:by2, bx1:bx2], class_name):
                            continue
                            
                        streak = self.streaks.get(assigned_id, 0) + 1
                        self.streaks[assigned_id] = streak
                        
                        # Require temporal consensus
                        if streak >= WEAPON_CONFIRM_FRAMES:
                            hits.append((assigned_id, class_name, confidence, abs_box))
            except Exception as exc:
                log.debug("Weapon full-frame inference error: %s", exc)

        for track_id in list(self.streaks):
            if track_id not in seen_ids and track_id != -1:
                del self.streaks[track_id]
        return hits
