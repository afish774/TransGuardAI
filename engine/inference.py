import time
import queue
import math
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Dict, List, Tuple, Optional

import cv2
import numpy as np

from engine.config import (
    EngineConfig,
    CLS_PERSON,
    BAGGAGE_CLASSES,
    INCIDENT_COOLDOWN_S,
    POSE_MAX_PERSONS_PER_FRAME,
    WEAPON_CLASS_KEYWORDS,
    WEAPON_CONF_THRESHOLD,
    FACE_FULL_FRAME_INTERVAL_S,
    WORKER_HEARTBEAT_SECONDS,
    BAGGAGE_CONF_FLOOR,
    DETECTION_ROI,
    SEAT_ZONES_ROI,
    TRACKER_CONFIG,
    VIOLENCE_VLM_VERIFY,
    resolve_compute_device,
    yolo_precision_kwargs,
)
from engine.utils.geometry import (
    bbox_center,
    dist,
    extract_face_box_from_landmarks,
    crop_bbox,
    bbox_iou,
)
from engine.utils.scene import (
    VehicleMotionEstimator,
    enhance_low_light,
    is_corrupt_frame,
    parse_roi_polygon,
    parse_roi_polygons,
    point_in_roi,
)
from engine.utils.queues import put_latest, publish_health
from engine.utils.overlays import OverlayRecorder
from engine.utils.logging import configure_worker_logging, log

from engine.detectors.pose import PoseEngine
from engine.detectors.vlm_verifier import VisionLanguageVerifier
from engine.detectors.weapon import WeaponDetector
from engine.detectors.watchlist import Watchlist, FACE_BACKEND, compute_sharpness
from engine.detectors.violence import ViolenceDetector
from engine.detectors.crowd import CrowdDetector
from engine.detectors.baggage import BaggageDetector

try:
    from ultralytics import YOLO
except Exception:
    YOLO = None

# Incident priority levels (lower number = higher priority)
INCIDENT_PRIORITY = {
    "CRIME_WEAPON_DETECTED": 1,
    "ARMED_VIOLENCE": 1,
    "BAGGAGE_THEFT_SUSPECTED": 1,
    "CRIME_VIOLENCE_DETECTED": 2,
    "VIOLENT_ASSAULT_COLLAPSE": 2,
    "FALL_DETECTED": 3,
    "WATCHLIST_MATCH": 4,
    "UNATTENDED_BAGGAGE": 5,
    "OVERCROWD_DETECTED": 6,
}

# Cross-pillar correlation windows (seconds)
_CORRELATION_WINDOW_S = 5.0


class IncidentProcessor:
    def __init__(self, cfg: EngineConfig, incident_queue):
        if YOLO is None:
            raise RuntimeError("ultralytics is not installed; cannot load YOLO model")
        self.cfg = cfg
        self.incident_queue = incident_queue
        self._device, self._use_half, self._device_label = resolve_compute_device()
        log.info("AI Inference compute device: %s (%s)", self._device, self._device_label)
        try:
            self.model = YOLO(cfg.yolo_model)
            log.info("Primary YOLO model loaded: %s", cfg.yolo_model)
        except Exception as exc:
            if cfg.yolo_model != "yolov8n.pt":
                log.warning(
                    "Could not load '%s' (%s); falling back to local yolov8n.pt",
                    cfg.yolo_model,
                    exc,
                )
                self.model = YOLO("yolov8n.pt")
            else:
                raise
        self.pose = PoseEngine(cfg.pose_model)
        self.fall = self.pose
        # Single shared GPU FP16 SigLIP/CLIP model powers BOTH Weapon & Violence verification
        self.vlm = VisionLanguageVerifier()
        self.weapons = WeaponDetector(cfg.weapon_model, cfg.weapon_conf, vlm=self.vlm)
        self.violence = ViolenceDetector(vlm=self.vlm if VIOLENCE_VLM_VERIFY else None)
        self.crowd = CrowdDetector(cfg.crowd_threshold, cfg.crowd_frames)
        self.watchlist = Watchlist(cfg.face_tolerance)
        self.baggage = BaggageDetector()
        self.motion = VehicleMotionEstimator()

        self.incident_cache: Dict[str, float] = {}
        self.identity_cache: Dict[int, str] = {}
        self.face_scan_times: Dict[int, float] = {}
        self._last_frame_face_scan: float = 0.0

        # Non-blocking background executor for dlib face recognition
        self._face_executor: Optional[ThreadPoolExecutor] = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="face-rec"
        )
        self._pending_face_jobs: Dict[int, Tuple[Future, Tuple[int, int]]] = {}
        self._pending_full_face_job: Optional[Future] = None

        # Cross-pillar correlation state: {id: (timestamp, (cx, cy))}
        self._recent_violence: Dict[Tuple[int, int], Tuple[float, Tuple[float, float]]] = {}
        self._recent_weapons: Dict[int, Tuple[float, Tuple[float, float]]] = {}
        self._recent_falls: Dict[int, Tuple[float, Tuple[float, float]]] = {}

        # Resolution & ROI state (initialized on first valid frame)
        self._calibrated: bool = False
        self._roi_polygon: Optional[np.ndarray] = None
        self._seat_polygons: List[np.ndarray] = []
        self.last_overlays: Optional[Dict[str, object]] = None

    def close(self) -> None:
        self.pose.close()
        self.weapons.close()
        if getattr(self, "vlm", None) is not None:
            self.vlm.close()
        if self._face_executor is not None:
            self._face_executor.shutdown(wait=False, cancel_futures=True)
            self._face_executor = None
        if getattr(self, "_device", "cpu").startswith("cuda"):
            try:
                import torch
                torch.cuda.empty_cache()
            except Exception:
                pass

    def apply_control(self, control: Dict[str, object]) -> None:
        message_type = control.get("type")
        if message_type == "watchlist":
            targets = control.get("targets", [])
            if isinstance(targets, list):
                self.watchlist.replace_from_images(targets)
                self.identity_cache.clear()

    def _snapshot_jpeg(self, frame: np.ndarray) -> bytes:
        ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        return buffer.tobytes() if ok else b""

    def emit(
        self,
        incident_type: str,
        frame: np.ndarray,
        extra: dict,
        cache_key: Optional[str] = None,
        confidence: float = 95.0,
        now: Optional[float] = None,
    ) -> None:
        ts = time.time() if now is None else now
        if cache_key:
            if ts - self.incident_cache.get(cache_key, 0.0) < INCIDENT_COOLDOWN_S:
                return
            self.incident_cache[cache_key] = ts
        gps_lat = round(float(self.cfg.lat), 6)
        gps_lon = round(float(self.cfg.lon), 6)
        priority = INCIDENT_PRIORITY.get(incident_type, 99)
        payload = {
            "incident_type": incident_type,
            "camera_id": self.cfg.camera_id,
            "confidence": round(confidence, 1),
            "priority": priority,
            "evidence_jpeg": self._snapshot_jpeg(frame),
            "gps": {"lat": gps_lat, "lon": gps_lon},
            "vehicle_id": self.cfg.vehicle_id,
            **extra,
        }
        try:
            self.incident_queue.put_nowait(payload)
            log.info("INCIDENT [P%d] %s (conf=%.1f%%)", priority, incident_type, confidence)
        except queue.Full:
            log.warning("Incident outbox full, dropping %s", incident_type)

    def _correlate_events(self, display_frame: np.ndarray, now: float) -> None:
        """Cross-pillar event correlation for compound incidents with spatial resilience."""
        for key in list(self._recent_violence):
            if now - self._recent_violence[key][0] > _CORRELATION_WINDOW_S:
                del self._recent_violence[key]
        for key in list(self._recent_weapons):
            if now - self._recent_weapons[key][0] > _CORRELATION_WINDOW_S:
                del self._recent_weapons[key]
        for key in list(self._recent_falls):
            if now - self._recent_falls[key][0] > _CORRELATION_WINDOW_S:
                del self._recent_falls[key]

        scaled_corr_dist = 280.0 * getattr(self.weapons, "_scale", 1.0)

        # VIOLENT_ASSAULT_COLLAPSE: Fall within window of Violence involving same person OR location
        for fall_id, (fall_time, fall_center) in list(self._recent_falls.items()):
            for (va, vb), (violence_time, violence_center) in list(self._recent_violence.items()):
                same_person = fall_id in (va, vb)
                same_location = dist(fall_center, violence_center) <= scaled_corr_dist
                if (same_person or same_location) and abs(fall_time - violence_time) < _CORRELATION_WINDOW_S:
                    self.emit(
                        "VIOLENT_ASSAULT_COLLAPSE",
                        display_frame,
                        {
                            "victimTrackId": fall_id,
                            "attackerTrackIds": [va, vb],
                            "fallTime": round(fall_time, 2),
                            "violenceTime": round(violence_time, 2),
                        },
                        cache_key=f"assault_collapse_{fall_id}",
                        confidence=96.0,
                        now=now,
                    )
                    self._recent_falls.pop(fall_id, None)
                    break

        # ARMED_VIOLENCE: Weapon + Violence involving same person OR location
        for weapon_id, (weapon_time, weapon_center) in list(self._recent_weapons.items()):
            for (va, vb), (violence_time, violence_center) in list(self._recent_violence.items()):
                same_person = weapon_id in (va, vb)
                same_location = dist(weapon_center, violence_center) <= scaled_corr_dist
                if (same_person or same_location) and abs(weapon_time - violence_time) < _CORRELATION_WINDOW_S:
                    self.emit(
                        "ARMED_VIOLENCE",
                        display_frame,
                        {
                            "armedTrackId": weapon_id,
                            "involvedTrackIds": [va, vb],
                            "weaponTime": round(weapon_time, 2),
                            "violenceTime": round(violence_time, 2),
                        },
                        cache_key=f"armed_violence_{weapon_id}",
                        confidence=98.0,
                        now=now,
                    )
                    self._recent_weapons.pop(weapon_id, None)
                    break

    def _in_seat_zone(self, bbox: Tuple[int, int, int, int]) -> bool:
        if not self._seat_polygons:
            return False
        center = bbox_center(bbox)
        return any(point_in_roi(center, poly) for poly in self._seat_polygons)

    def _harvest_face_jobs(
        self,
        display_frame: np.ndarray,
        now: float,
        ov: Optional[OverlayRecorder] = None,
    ) -> bool:
        """Collect finished async watchlist futures without blocking main FPS."""
        matched_any = False
        for track_id in list(self._pending_face_jobs):
            fut, crop_offset = self._pending_face_jobs[track_id]
            if not fut.done():
                continue
            del self._pending_face_jobs[track_id]
            try:
                match_result = fut.result()
            except Exception:
                match_result = None
            if match_result is not None:
                name, conf, (fl, ft, fr, fb) = match_result
                self.identity_cache[track_id] = name
                matched_any = True
                fx1, fy1 = fl + crop_offset[0], ft + crop_offset[1]
                fx2, fy2 = fr + crop_offset[0], fb + crop_offset[1]
                if ov is not None:
                    ov.rect(display_frame, (fx1, fy1), (fx2, fy2), (0, 0, 255), 3)
                    ov.text(display_frame, f"MATCH: {name.upper()} ({conf}%)", (fx1, max(20, fy1 - 6)), 0.7, (0, 0, 255), 2)
                else:
                    cv2.rectangle(display_frame, (fx1, fy1), (fx2, fy2), (0, 0, 255), 3)
                    cv2.putText(
                        display_frame,
                        f"MATCH: {name.upper()} ({conf}%)",
                        (fx1, max(20, fy1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7,
                        (0, 0, 255),
                        2,
                    )
                self.emit(
                    "WATCHLIST_MATCH",
                    display_frame,
                    {"identity": name, "trackId": track_id, "bbox": [fx1, fy1, fx2, fy2]},
                    cache_key=f"watchlist_{name}",
                    confidence=conf,
                    now=now,
                )
                log.info("WATCHLIST_MATCH on track #%d: '%s' (conf=%.1f%%)", track_id, name, conf)

        if self._pending_full_face_job is not None and self._pending_full_face_job.done():
            fut = self._pending_full_face_job
            self._pending_full_face_job = None
            try:
                match_result = fut.result()
            except Exception:
                match_result = None
            if match_result is not None:
                name, conf, (fx1, fy1, fx2, fy2) = match_result
                matched_any = True
                if ov is not None:
                    ov.rect(display_frame, (fx1, fy1), (fx2, fy2), (0, 0, 255), 3)
                    ov.text(display_frame, f"MATCH: {name.upper()} ({conf}%)", (fx1, max(20, fy1 - 6)), 0.7, (0, 0, 255), 2)
                else:
                    cv2.rectangle(display_frame, (fx1, fy1), (fx2, fy2), (0, 0, 255), 3)
                    cv2.putText(
                        display_frame,
                        f"MATCH: {name.upper()} ({conf}%)",
                        (fx1, max(20, fy1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7,
                        (0, 0, 255),
                        2,
                    )
                self.emit(
                    "WATCHLIST_MATCH",
                    display_frame,
                    {"identity": name, "bbox": [fx1, fy1, fx2, fy2]},
                    cache_key=f"watchlist_{name}",
                    confidence=conf,
                    now=now,
                )
                log.info("WATCHLIST_MATCH on camera feed: '%s' (conf=%.1f%%)", name, conf)

        return matched_any

    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        """Process one camera frame and return the annotated display frame.

        CRITICAL HYGIENE: ``raw_frame`` / ``infer_frame`` is NEVER mutated with
        OpenCV overlays. All downstream AI models (Pose, Weapon YOLO, CLIP,
        Baggage Appearance Re-ID, Face Recognition) inspect clean pixels only.
        """
        now = time.time()

        # Skip blank / corrupted H.264 decoder glitch frames
        if is_corrupt_frame(frame):
            return frame

        raw_frame = frame
        display_frame = frame.copy()
        ov = OverlayRecorder()
        frame_h, frame_w = raw_frame.shape[:2]

        # Calibrate resolution-dependent thresholds & ROI polygons on first valid frame
        if not self._calibrated:
            self.pose.calibrate(frame_h)
            self.violence.calibrate(frame_h)
            self.baggage.calibrate(frame_h)
            self.weapons.calibrate(frame_h)
            self.crowd.calibrate(frame_h)
            self.motion.calibrate(frame_h)
            self._roi_polygon = parse_roi_polygon(DETECTION_ROI, frame_w, frame_h)
            self._seat_polygons = parse_roi_polygons(SEAT_ZONES_ROI, frame_w, frame_h)
            self._calibrated = True
            log.info(
                "Detectors calibrated for %dx%d (scale=%.2f, roi=%s, seat_zones=%d, tracker=%s)",
                frame_w,
                frame_h,
                frame_h / 720.0,
                "active" if self._roi_polygon is not None else "full-frame",
                len(self._seat_polygons),
                TRACKER_CONFIG,
            )

        # Adaptive low-light LAB CLAHE only when scene is dark (zero cost in daylight)
        infer_frame = enhance_low_light(raw_frame)

        # Single-pass YOLO tracking at min(cfg.conf, BAGGAGE_CONF_FLOOR) so bags
        # get real persistent ByteTrack IDs without running a redundant 2nd YOLO pass.
        track_conf = min(self.cfg.conf, BAGGAGE_CONF_FLOOR)
        results = self.model.track(
            infer_frame,
            persist=True,
            tracker=TRACKER_CONFIG,
            device=getattr(self, "_device", "cpu"),
            verbose=False,
            conf=track_conf,
            **yolo_precision_kwargs(getattr(self, "_use_half", False)),
        )[0]

        persons: List[Tuple[int, Tuple[int, int, int, int]]] = []
        bags: List[Tuple[int, str, Tuple[int, int, int, int]]] = []
        direct_weapons: List[Tuple[int, str, float, Tuple[int, int, int, int]]] = []

        if results.boxes is not None and len(results.boxes) > 0:
            box_ids = (
                results.boxes.id.tolist()
                if getattr(results.boxes, "id", None) is not None
                else [-(i + 1) for i in range(len(results.boxes))]
            )
            for box, track_id in zip(results.boxes, box_ids):
                track_id = int(track_id)
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                bbox = tuple(int(value) for value in box.xyxy[0].tolist())
                class_name = str(self.model.names.get(class_id, class_id)).lower()

                if class_id == CLS_PERSON:
                    if confidence < self.cfg.conf:
                        continue
                    x1, y1, x2, y2 = bbox
                    # Reject persons standing outside the interior bus ROI polygon (e.g. through windows)
                    if not point_in_roi(((x1 + x2) / 2.0, float(y2)), self._roi_polygon):
                        continue
                    persons.append((track_id, bbox))
                    ov.rect(display_frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    label = f"Person #{track_id}" if track_id > 0 else "Person"
                    ov.text(display_frame, label, (x1, max(20, y1 - 6)), 0.5, (0, 255, 0), 2)
                elif class_id in BAGGAGE_CLASSES:
                    if confidence < BAGGAGE_CONF_FLOOR:
                        continue
                    x1, y1, x2, y2 = bbox
                    if not point_in_roi(bbox_center(bbox), self._roi_polygon):
                        continue
                    bag_name = BAGGAGE_CLASSES[class_id]
                    bags.append((track_id, bag_name, bbox))
                    color = (255, 165, 0) if confidence >= self.cfg.conf else (200, 140, 0)
                    ov.rect(display_frame, (x1, y1), (x2, y2), color, 2)
                    label = f"{bag_name} #{track_id}" if track_id > 0 else bag_name
                    ov.text(display_frame, label, (x1, max(20, y1 - 6)), 0.5, color, 2)
                elif confidence >= WEAPON_CONF_THRESHOLD and any(
                    kw in class_name for kw in WEAPON_CLASS_KEYWORDS
                ):
                    direct_weapons.append((track_id, class_name, confidence, bbox))

        active_person_ids = {track_id for track_id, _ in persons}

        # Global bus camera-shake & common-mode braking sway estimation
        global_vel, is_jolt = self.motion.update(raw_frame, persons, now)
        if is_jolt:
            ov.text(display_frame, "MOTION JOLT DAMPED", (frame_w - 240, 30), 0.55, (0, 215, 255), 2)

        # Pillar 1: Crowd (resolution-calibrated spatial density)
        crowd_peak = self.crowd.update(len(persons), persons=persons)
        if self.crowd.active or crowd_peak is not None:
            ov.text(display_frame, f"OVERCROWDING: {len(persons)} PERSONS", (30, 75), 0.8, (0, 0, 255), 2)
        if crowd_peak is not None:
            crowd_conf = min(99.0, 70.0 + (crowd_peak / max(1, self.crowd.threshold)) * 20.0)
            self.emit(
                "OVERCROWD_DETECTED",
                display_frame,
                {
                    "personCount": len(persons),
                    "peakCount": crowd_peak,
                    "threshold": self.crowd.threshold,
                    "spatialDensity": round(self.crowd.last_density, 2),
                },
                cache_key="overcrowd",
                confidence=crowd_conf,
                now=now,
            )
        ov.text(display_frame, f"Persons: {len(persons)}", (30, frame_h - 15), 0.6, (255, 255, 255), 2)

        # Pose pass (on clean unannotated infer_frame!)
        landmarks_by_id: Dict[int, object] = {}
        wrist_speeds: Dict[int, float] = {}
        if self.pose.available:
            if self.pose.uses_yolo_pose:
                landmarks_by_id = self.pose.extract_frame_poses(infer_frame, persons)
                for track_id, points in landmarks_by_id.items():
                    wrist_speeds[track_id] = self.violence.wrist_speed(
                        track_id, points, now, global_vel=global_vel
                    )
            else:
                pose_targets = sorted(
                    persons,
                    key=lambda item: -(item[1][2] - item[1][0]) * (item[1][3] - item[1][1]),
                )[:POSE_MAX_PERSONS_PER_FRAME]
                for track_id, person_bbox in pose_targets:
                    crop, offset = crop_bbox(infer_frame, person_bbox)
                    if crop is None:
                        continue
                    points = self.pose.landmarks(crop, offset)
                    if points is None:
                        continue
                    landmarks_by_id[track_id] = points
                    wrist_speeds[track_id] = self.violence.wrist_speed(
                        track_id, points, now, global_vel=global_vel
                    )

        # Pillar 3: Fall (motion-compensated + standing height reference + seat-zone aware)
        for track_id, person_bbox in persons:
            if self.pose.is_fall(
                track_id,
                person_bbox,
                landmarks_by_id.get(track_id),
                now=now,
                global_vel=global_vel,
                is_jolt=is_jolt,
                in_seat_zone=self._in_seat_zone(person_bbox),
            ):
                x1, y1, x2, y2 = person_bbox
                fall_conf = 92.0 if self.pose.available else 78.0
                ov.rect(display_frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
                ov.text(display_frame, f"FALL DETECTED #{track_id}", (x1, max(20, y1 - 6)), 0.6, (0, 0, 255), 2)
                self.emit(
                    "FALL_DETECTED",
                    display_frame,
                    {"trackId": track_id, "persons": len(persons), "bbox": [x1, y1, x2, y2]},
                    cache_key=f"fall_{track_id}",
                    confidence=fall_conf,
                    now=now,
                )
                self._recent_falls[track_id] = (now, bbox_center(person_bbox))
        self.pose.forget(active_person_ids)

        # Pillar 4: Weapons (on clean unannotated infer_frame with async margin-CLIP!)
        secondary_weapons = self.weapons.scan(
            infer_frame, persons, landmarks_by_id=landmarks_by_id
        )
        verified_direct_weapons: List[Tuple[int, str, float, Tuple[int, int, int, int]]] = []
        for track_id, class_name, confidence, bbox in direct_weapons:
            verified = self.weapons.verify_candidate(
                track_id, class_name, confidence, bbox, infer_frame, now, sync_clip=False
            )
            if verified is not None:
                verified_direct_weapons.append(verified)

        all_weapons = verified_direct_weapons + secondary_weapons
        seen_weapon_boxes: List[Tuple[int, int, int, int]] = []
        for track_id, weapon_name, weapon_conf, weapon_bbox in all_weapons:
            wx1, wy1, wx2, wy2 = weapon_bbox
            if any(bbox_iou(weapon_bbox, prev_box) > 0.4 for prev_box in seen_weapon_boxes):
                continue
            seen_weapon_boxes.append(weapon_bbox)
            ov.rect(display_frame, (wx1, wy1), (wx2, wy2), (0, 0, 255), 3)
            ov.text(display_frame, f"WEAPON: {weapon_name.upper()} {weapon_conf:.2f}", (wx1, max(20, wy1 - 6)), 0.7, (0, 0, 255), 2)
            self.emit(
                "CRIME_WEAPON_DETECTED",
                display_frame,
                {"trackId": track_id, "weapon": weapon_name, "bbox": [wx1, wy1, wx2, wy2]},
                cache_key=f"weapon_{weapon_name}_{track_id}",
                confidence=round(weapon_conf * 100.0, 1),
                now=now,
            )
            log.info(
                "CRIME_WEAPON_DETECTED: %s (conf=%.2f) at [%d,%d,%d,%d]",
                weapon_name,
                weapon_conf,
                wx1,
                wy1,
                wx2,
                wy2,
            )
            self._recent_weapons[track_id] = (now, bbox_center(weapon_bbox))

        # Pillar 5: Violence (motion-compensated + parallel-walk rejected + jolt damped + Stage-2 GPU VLM)
        vlm_active = bool(getattr(self.violence, "vlm", None) and self.violence.vlm.available)
        for id_a, id_b, iou, peak_speed in self.violence.evaluate(
            persons,
            wrist_speeds,
            now,
            global_vel=global_vel,
            is_jolt=is_jolt,
            frame=infer_frame,
        ):
            violence_conf = min(99.0, (82.0 if vlm_active else 75.0) + iou * 20.0)
            p1_box = next((b for pid, b in persons if pid == id_a), None)
            p2_box = next((b for pid, b in persons if pid == id_b), None)
            if p1_box and p2_box:
                ux1 = min(p1_box[0], p2_box[0])
                uy1 = min(p1_box[1], p2_box[1])
                ux2 = max(p1_box[2], p2_box[2])
                uy2 = max(p1_box[3], p2_box[3])
                ov.rect(display_frame, (ux1, uy1), (ux2, uy2), (0, 0, 255), 3)
                union_bbox = [ux1, uy1, ux2, uy2]
            else:
                union_bbox = None
            ov.text(display_frame, f"VIOLENCE #{id_a} vs #{id_b}", (30, 110), 0.8, (0, 0, 255), 2)
            extra_v = {
                "trackIds": [id_a, id_b],
                "iou": round(iou, 3),
                "wristSpeedPxPerSec": round(peak_speed, 1),
                "vlmVerified": vlm_active,
            }
            if union_bbox is not None:
                extra_v["bbox"] = union_bbox
            self.emit(
                "CRIME_VIOLENCE_DETECTED",
                display_frame,
                extra_v,
                cache_key=f"violence_{id_a}_{id_b}",
                confidence=violence_conf,
                now=now,
            )
            if p1_box and p2_box:
                c1 = bbox_center(p1_box)
                c2 = bbox_center(p2_box)
                v_center = ((c1[0] + c2[0]) / 2.0, (c1[1] + c2[1]) / 2.0)
            elif p1_box:
                v_center = bbox_center(p1_box)
            else:
                v_center = (frame_w / 2.0, frame_h / 2.0)
            self._recent_violence[(min(id_a, id_b), max(id_a, id_b))] = (now, v_center)

        # Pillar 2: Baggage (Zero-Trust custody + appearance-verified owner Re-ID)
        baggage_alerts = self.baggage.update(bags, persons, now, frame=raw_frame)
        for alert in baggage_alerts:
            x1, y1, x2, y2 = alert["bbox"]
            alert_conf = alert.get("confidence", 85.0)
            alert_type = alert.get("alert_type", "UNATTENDED_BAGGAGE")

            if alert_type == "BAGGAGE_THEFT_SUSPECTED":
                ov.rect(display_frame, (x1, y1), (x2, y2), (0, 0, 255), 4)
                suspect_str = (
                    f"SUSPECT #{alert.get('suspect_id')}"
                    if alert.get("suspect_id")
                    else "UNAUTHORIZED PICKUP"
                )
                ov.text(display_frame, f"THEFT: {suspect_str}", (x1, max(25, y1 - 10)), 0.65, (0, 0, 255), 2)
                self.emit(
                    "BAGGAGE_THEFT_SUSPECTED",
                    display_frame,
                    {
                        "objectClass": alert["cls_name"],
                        "trackId": alert["track_id"],
                        "originalOwnerId": alert.get("original_owner_id"),
                        "suspectTrackId": alert.get("suspect_id"),
                        "unattendedSeconds": alert.get("unattended_s", 0.0),
                        "theftType": alert.get("theft_type", "UNAUTHORIZED_PICKUP"),
                        "displacementPx": alert.get("displacement_px", 0.0),
                        "bbox": [x1, y1, x2, y2],
                    },
                    cache_key=f"theft_{alert['track_id']}",
                    confidence=alert_conf,
                    now=now,
                )
            else:
                ov.rect(display_frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
                label_txt = f"UNATTENDED ({alert['unattended_s']}s)"
                if alert.get("stranger_loitering"):
                    label_txt += f" ! STRANGER #{alert.get('suspect_id')} HOVERING"
                ov.text(display_frame, label_txt, (x1, min(frame_h - 10, y2 + 20)), 0.5, (0, 0, 255), 2)
                extra_payload = {
                    "objectClass": alert["cls_name"],
                    "trackId": alert["track_id"],
                    "stationarySeconds": alert["stationary_s"],
                    "unattendedSeconds": alert["unattended_s"],
                    "bbox": [x1, y1, x2, y2],
                }
                if alert.get("suspect_id") is not None:
                    extra_payload["strangerProximityId"] = alert["suspect_id"]
                    extra_payload["strangerLoitering"] = alert.get("stranger_loitering", False)
                self.emit(
                    "UNATTENDED_BAGGAGE",
                    display_frame,
                    extra_payload,
                    cache_key=f"bag_{alert['track_id']}",
                    confidence=alert_conf,
                    now=now,
                )

        # Clean up identity / face caches for disappeared tracks
        for track_id in list(self.identity_cache):
            if track_id not in active_person_ids:
                del self.identity_cache[track_id]
        for track_id in list(self.face_scan_times):
            if track_id not in active_person_ids:
                del self.face_scan_times[track_id]
        self.watchlist.forget_tracks(active_person_ids)

        # Pillar 6: Watchlist (non-blocking async quality-gated 2-frame consensus on CLAHE-enhanced infer_frame!)
        if FACE_BACKEND and self.watchlist.encodings:
            matched_in_person = self._harvest_face_jobs(display_frame, now, ov=ov)
            submitted_this_frame = False

            # Fair round-robin scan order: prioritize unconfirmed pending hits, then oldest-scanned tracks
            ordered_persons = sorted(
                persons,
                key=lambda item: (
                    0 if self.watchlist.has_pending_hit(item[0], now) else 1,
                    self.face_scan_times.get(item[0], 0.0),
                ),
            )

            for track_id, (x1, y1, x2, y2) in ordered_persons:
                if self.watchlist.is_cached(track_id):
                    cached_name = self.watchlist.cache_hit(track_id)
                    if cached_name is not None:
                        ov.text(display_frame, f"MATCH: {cached_name.upper()}", (x1, max(20, y1 - 6)), 0.7, (0, 0, 255), 2)
                        ov.rect(display_frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
                        matched_in_person = True
                    continue

                if track_id in self.identity_cache:
                    name = self.identity_cache[track_id]
                    ov.text(display_frame, f"MATCH: {name.upper()}", (x1, max(20, y1 - 6)), 0.7, (0, 0, 255), 2)
                    ov.rect(display_frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
                    matched_in_person = True
                    continue

                if submitted_this_frame or track_id in self._pending_face_jobs:
                    continue

                pw, ph = x2 - x1, y2 - y1
                if ph > 350:
                    head_h = max(1, int(ph * 0.65))
                    margin_x = int(pw * 0.15)
                    hx1 = max(0, x1 - margin_x)
                    hy1 = max(0, y1)
                    hx2 = min(frame_w, x2 + margin_x)
                    hy2 = min(frame_h, y1 + head_h)
                else:
                    hx1 = max(0, x1)
                    hy1 = max(0, y1)
                    hx2 = min(frame_w, x2)
                    hy2 = min(frame_h, y2)

                head_crop = infer_frame[hy1:hy2, hx1:hx2]
                crop_offset = (hx1, hy1)
                if head_crop.size == 0:
                    continue

                # Cheap pre-check before submitting to async face encoder
                est_sharp = compute_sharpness(head_crop)
                est_quality = float(min(head_crop.shape[0], head_crop.shape[1])) * (est_sharp ** 0.5)
                last_scan = self.face_scan_times.get(track_id, 0.0)
                if self.watchlist.should_skip_scan(track_id, est_quality, last_scan, now):
                    continue

                self.face_scan_times[track_id] = now
                hint_locs = None
                if landmarks_by_id.get(track_id):
                    f_box = extract_face_box_from_landmarks(
                        landmarks_by_id[track_id],
                        head_crop.shape[1],
                        head_crop.shape[0],
                        offset=crop_offset,
                    )
                    if f_box:
                        hint_locs = [f_box]

                if self._face_executor is not None:
                    fut = self._face_executor.submit(
                        self.watchlist.match,
                        head_crop.copy(),
                        hint_locs,
                        track_id,
                        True,
                        now,
                    )
                    self._pending_face_jobs[track_id] = (fut, crop_offset)
                    submitted_this_frame = True

            # Throttled async full-frame HOG fallback (every 3.0s instead of blocking every 0.5s)
            if (
                not matched_in_person
                and not submitted_this_frame
                and self._pending_full_face_job is None
                and self._face_executor is not None
                and (now - self._last_frame_face_scan) >= FACE_FULL_FRAME_INTERVAL_S
            ):
                self._last_frame_face_scan = now
                self._pending_full_face_job = self._face_executor.submit(
                    self.watchlist.match,
                    infer_frame.copy(),
                    None,
                    None,
                    True,
                    now,
                )

        # Cross-pillar event correlation
        self._correlate_events(display_frame, now)
        self.last_overlays = ov.packet(now, frame_w, frame_h)
        return display_frame


def inference_worker(
    cfg: EngineConfig,
    frame_queue,
    incident_queue,
    control_queue,
    stop_event,
    health_queue,
    inference_fps,
    publish_queue,
    overlay_queue=None,
) -> None:
    configure_worker_logging()
    processor: Optional[IncidentProcessor] = None
    frame_count = 0
    rate_window = time.monotonic()
    last_health = 0.0
    try:
        processor = IncidentProcessor(cfg, incident_queue)
        publish_health(health_queue, "inference", "ONLINE")
        while not stop_event.is_set():
            while True:
                try:
                    processor.apply_control(control_queue.get_nowait())
                except queue.Empty:
                    break
            try:
                _, frame = frame_queue.get(timeout=1.0)
            except queue.Empty:
                continue
            annotated = processor.process_frame(frame)
            if overlay_queue is not None and processor.last_overlays is not None:
                put_latest(overlay_queue, processor.last_overlays)
            if publish_queue is not None:
                put_latest(publish_queue, annotated)
            frame_count += 1
            now = time.monotonic()
            if now - rate_window >= 1.0:
                inference_fps.value = frame_count / (now - rate_window)
                frame_count = 0
                rate_window = now
            if now - last_health >= WORKER_HEARTBEAT_SECONDS:
                publish_health(health_queue, "inference", "ONLINE")
                last_health = now
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        publish_health(health_queue, "inference", "FAILED", str(exc))
        log.exception("Inference worker failed")
        raise
    finally:
        inference_fps.value = 0.0
        if processor is not None:
            processor.close()
        publish_health(health_queue, "inference", "STOPPED")
