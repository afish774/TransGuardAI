import time
import queue
import math
import cv2
import numpy as np
import random
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field

from engine.config import (
    EngineConfig, CLS_PERSON, BAGGAGE_CLASSES, INCIDENT_COOLDOWN_S,
    POSE_MAX_PERSONS_PER_FRAME, WEAPON_CLASS_KEYWORDS,
    FACE_RESCAN_INTERVAL_S,
    WORKER_HEARTBEAT_SECONDS
)
from engine.utils.geometry import bbox_center, boxes_intersect_with_radius, dist, extract_face_box_from_landmarks, crop_bbox, bbox_iou
from engine.utils.queues import put_latest, publish_health
from engine.utils.logging import configure_worker_logging, log

from engine.detectors.pose import PoseEngine
from engine.detectors.weapon import WeaponDetector
from engine.detectors.watchlist import Watchlist
from engine.detectors.violence import ViolenceDetector
from engine.detectors.crowd import CrowdDetector
from engine.detectors.baggage import BaggageDetector

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

# Incident priority levels (lower number = higher priority)
INCIDENT_PRIORITY = {
    "CRIME_WEAPON_DETECTED": 1,
    "ARMED_VIOLENCE": 1,
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
        self.model = YOLO(cfg.yolo_model)
        self.pose = PoseEngine()
        self.fall = self.pose
        self.weapons = WeaponDetector(cfg.weapon_model, cfg.weapon_conf)
        self.violence = ViolenceDetector()
        self.crowd = CrowdDetector(cfg.crowd_threshold, cfg.crowd_frames)
        self.watchlist = Watchlist(cfg.face_tolerance)
        self.baggage = BaggageDetector()
        self.incident_cache: Dict[str, float] = {}
        self.identity_cache: Dict[int, str] = {}
        self.face_scan_times: Dict[int, float] = {}
        self._last_frame_face_scan: float = 0.0
        # Cross-pillar correlation state
        self._recent_violence: Dict[Tuple[int, int], float] = {}  # (id_a, id_b) -> timestamp
        self._recent_weapons: Dict[int, float] = {}  # track_id -> timestamp
        self._recent_falls: Dict[int, float] = {}  # track_id -> timestamp

    def close(self) -> None:
        self.pose.close()

    def apply_control(self, control: Dict[str, object]) -> None:
        message_type = control.get("type")
        if message_type == "watchlist":
            targets = control.get("targets", [])
            if isinstance(targets, list):
                self.watchlist.replace_from_images(targets)

    def _snapshot_jpeg(self, frame: np.ndarray) -> bytes:
        ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        return buffer.tobytes() if ok else b""

    def emit(self, incident_type: str, frame: np.ndarray, extra: dict,
             cache_key: Optional[str] = None, confidence: float = 95.0,
             now: Optional[float] = None) -> None:
        ts = time.time() if now is None else now
        if cache_key:
            if ts - self.incident_cache.get(cache_key, 0.0) < INCIDENT_COOLDOWN_S:
                return
            self.incident_cache[cache_key] = ts
        gps_lat = round(self.cfg.lat + random.uniform(-0.0003, 0.0003), 6)
        gps_lon = round(self.cfg.lon + random.uniform(-0.0003, 0.0003), 6)
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
            log.info("INCIDENT [P%d] %s", priority, incident_type)
        except queue.Full:
            log.warning("Incident outbox full, dropping %s", incident_type)

    def _correlate_events(self, frame: np.ndarray, now: float) -> None:
        """Cross-pillar event correlation for compound incidents."""
        # Clean expired correlation entries
        for key in list(self._recent_violence):
            if now - self._recent_violence[key] > _CORRELATION_WINDOW_S:
                del self._recent_violence[key]
        for key in list(self._recent_weapons):
            if now - self._recent_weapons[key] > _CORRELATION_WINDOW_S:
                del self._recent_weapons[key]
        for key in list(self._recent_falls):
            if now - self._recent_falls[key] > _CORRELATION_WINDOW_S:
                del self._recent_falls[key]

        # VIOLENT_ASSAULT_COLLAPSE: Fall within window of Violence involving same person
        for fall_id, fall_time in list(self._recent_falls.items()):
            for (va, vb), violence_time in self._recent_violence.items():
                if fall_id in (va, vb) and abs(fall_time - violence_time) < _CORRELATION_WINDOW_S:
                    self.emit(
                        "VIOLENT_ASSAULT_COLLAPSE", frame,
                        {"victimTrackId": fall_id, "attackerTrackIds": [va, vb],
                         "fallTime": round(fall_time, 2),
                         "violenceTime": round(violence_time, 2)},
                        cache_key=f"assault_collapse_{fall_id}",
                        confidence=96.0,
                    )
                    # Consume the events
                    self._recent_falls.pop(fall_id, None)
                    break

        # ARMED_VIOLENCE: Weapon + Violence involving the same person
        for weapon_id, weapon_time in list(self._recent_weapons.items()):
            for (va, vb), violence_time in self._recent_violence.items():
                if weapon_id in (va, vb) and abs(weapon_time - violence_time) < _CORRELATION_WINDOW_S:
                    self.emit(
                        "ARMED_VIOLENCE", frame,
                        {"armedTrackId": weapon_id,
                         "involvedTrackIds": [va, vb],
                         "weaponTime": round(weapon_time, 2),
                         "violenceTime": round(violence_time, 2)},
                        cache_key=f"armed_violence_{weapon_id}",
                        confidence=98.0,
                    )
                    self._recent_weapons.pop(weapon_id, None)
                    break

    def process_frame(self, frame: np.ndarray) -> None:
        now = time.time()
        results = self.model.track(frame, persist=True, tracker="bytetrack.yaml", verbose=False, conf=self.cfg.conf)[0]
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
                    persons.append((track_id, bbox))
                    x1, y1, x2, y2 = bbox
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    label = f"Person #{track_id}" if track_id > 0 else "Person"
                    cv2.putText(frame, label, (x1, max(20, y1 - 6)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                elif class_id in BAGGAGE_CLASSES:
                    bag_name = BAGGAGE_CLASSES[class_id]
                    bags.append((track_id, bag_name, bbox))
                    x1, y1, x2, y2 = bbox
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 165, 0), 2)
                    label = f"{bag_name} #{track_id}" if track_id > 0 else bag_name
                    cv2.putText(frame, label, (x1, max(20, y1 - 6)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 165, 0), 2)
                elif any(kw in class_name for kw in WEAPON_CLASS_KEYWORDS):
                    direct_weapons.append((track_id, class_name, confidence, bbox))

        active_person_ids = {track_id for track_id, _ in persons}

        # Pillar 1: Crowd (now with spatial density)
        crowd_peak = self.crowd.update(len(persons), persons=persons)
        if crowd_peak is not None:
            crowd_conf = min(99.0, 70.0 + (crowd_peak / max(1, self.crowd.threshold)) * 20.0)
            self.emit(
                "OVERCROWD_DETECTED", frame,
                {"personCount": len(persons), "peakCount": crowd_peak,
                 "threshold": self.crowd.threshold,
                 "spatialDensity": round(self.crowd.last_density, 2)},
                cache_key="overcrowd",
                confidence=crowd_conf,
            )
        if self.crowd.active:
            cv2.putText(frame, f"OVERCROWDING: {len(persons)} PERSONS", (30, 75),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        cv2.putText(frame, f"Persons: {len(persons)}", (30, frame.shape[0] - 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        # Pose pass
        pose_targets = sorted(
            persons, key=lambda item: -(item[1][2] - item[1][0]) * (item[1][3] - item[1][1])
        )[:POSE_MAX_PERSONS_PER_FRAME]
        landmarks_by_id: Dict[int, object] = {}
        wrist_speeds: Dict[int, float] = {}
        if self.pose.available:
            for track_id, person_bbox in pose_targets:
                crop, offset = crop_bbox(frame, person_bbox)
                if crop is None:
                    continue
                points = self.pose.landmarks(crop, offset)
                if points is None:
                    continue
                landmarks_by_id[track_id] = points
                wrist_speeds[track_id] = self.violence.wrist_speed(track_id, points, now)

        # Pillar 3: Fall
        for track_id, person_bbox in persons:
            if self.pose.is_fall(track_id, person_bbox, landmarks_by_id.get(track_id), now=now):
                x1, y1, x2, y2 = person_bbox
                fall_conf = 92.0 if self.pose.available else 78.0
                self.emit(
                    "FALL_DETECTED", frame,
                    {"trackId": track_id, "persons": len(persons),
                     "bbox": [x1, y1, x2, y2]},
                    cache_key=f"fall_{track_id}",
                    confidence=fall_conf,
                )
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
                cv2.putText(frame, f"FALL DETECTED #{track_id}", (x1, max(20, y1 - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                # Record for cross-pillar correlation
                self._recent_falls[track_id] = now
        self.pose.forget(active_person_ids)

        # Pillar 4: Weapons
        secondary_weapons = self.weapons.scan(frame, persons, landmarks_by_id=landmarks_by_id)
        all_weapons = direct_weapons + secondary_weapons
        seen_weapon_boxes: List[Tuple[int, int, int, int]] = []
        for track_id, weapon_name, weapon_conf, weapon_bbox in all_weapons:
            wx1, wy1, wx2, wy2 = weapon_bbox
            if any(bbox_iou(weapon_bbox, prev_box) > 0.4 for prev_box in seen_weapon_boxes):
                continue
            seen_weapon_boxes.append(weapon_bbox)
            self.emit(
                "CRIME_WEAPON_DETECTED", frame,
                {"trackId": track_id, "weapon": weapon_name,
                 "bbox": [wx1, wy1, wx2, wy2]},
                cache_key=f"weapon_{weapon_name}_{track_id}",
                confidence=round(weapon_conf * 100.0, 1),
            )
            cv2.rectangle(frame, (wx1, wy1), (wx2, wy2), (0, 0, 255), 3)
            cv2.putText(frame, f"WEAPON: {weapon_name.upper()} {weapon_conf:.2f}",
                        (wx1, max(20, wy1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            log.info("CRIME_WEAPON_DETECTED: %s (conf=%.2f) at [%d,%d,%d,%d]",
                     weapon_name, weapon_conf, wx1, wy1, wx2, wy2)
            # Record for cross-pillar correlation
            self._recent_weapons[track_id] = now

        # Pillar 5: Violence
        for id_a, id_b, iou, peak_speed in self.violence.evaluate(persons, wrist_speeds, now):
            violence_conf = min(99.0, 75.0 + iou * 25.0)
            self.emit(
                "CRIME_VIOLENCE_DETECTED", frame,
                {"trackIds": [id_a, id_b], "iou": round(iou, 3),
                 "wristSpeedPxPerSec": round(peak_speed, 1)},
                cache_key=f"violence_{id_a}_{id_b}",
                confidence=violence_conf,
            )
            cv2.putText(frame, f"VIOLENCE #{id_a} vs #{id_b}", (30, 110),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
            # Record for cross-pillar correlation
            self._recent_violence[(min(id_a, id_b), max(id_a, id_b))] = now

        # Pillar 2: Baggage (new modular detector with owner tracking)
        baggage_alerts = self.baggage.update(bags, persons, now)
        for alert in baggage_alerts:
            x1, y1, x2, y2 = alert["bbox"]
            self.emit(
                "UNATTENDED_BAGGAGE", frame,
                {"objectClass": alert["cls_name"], "trackId": alert["track_id"],
                 "stationarySeconds": alert["stationary_s"],
                 "unattendedSeconds": alert["unattended_s"]},
                cache_key=f"bag_{alert['track_id']}",
            )
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
            cv2.putText(frame, f"UNATTENDED ({alert['unattended_s']}s)", (x1, y2 + 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)

        # Clean up identity / face caches for disappeared tracks
        for track_id in list(self.identity_cache):
            if track_id not in active_person_ids:
                del self.identity_cache[track_id]
        for track_id in list(self.face_scan_times):
            if track_id not in active_person_ids:
                del self.face_scan_times[track_id]
        self.watchlist.forget_tracks(active_person_ids)

        # Pillar 6: Watchlist (with per-track cache + landmark-guided extraction)
        from engine.detectors.watchlist import FACE_BACKEND
        if FACE_BACKEND and self.watchlist.encodings:
            matched_in_person = False
            for track_id, (x1, y1, x2, y2) in persons:
                # Check per-track cache first (instant)
                if self.watchlist.is_cached(track_id):
                    cached_name = self.watchlist.cache_hit(track_id)
                    if cached_name is not None:
                        # Already matched – just draw the overlay
                        cv2.putText(frame, f"MATCH: {cached_name.upper()}", (x1, max(20, y1 - 6)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
                        matched_in_person = True
                    continue  # Already scanned (match or no-match), skip

                if track_id in self.identity_cache:
                    name = self.identity_cache[track_id]
                    cv2.putText(frame, f"MATCH: {name.upper()}", (x1, max(20, y1 - 6)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
                    matched_in_person = True
                    continue

                last_scan = self.face_scan_times.get(track_id, 0.0)
                if now - last_scan < FACE_RESCAN_INTERVAL_S:
                    continue
                self.face_scan_times[track_id] = now

                pw, ph = x2 - x1, y2 - y1
                if ph > 350:
                    head_h = max(1, int(ph * 0.65))
                    margin_x = int(pw * 0.15)
                    head_crop = frame[max(y1, 0): min(frame.shape[0], y1 + head_h),
                                      max(0, x1 - margin_x): min(frame.shape[1], x2 + margin_x)]
                    crop_offset = (max(0, x1 - margin_x), max(0, y1))
                else:
                    head_crop = frame[max(y1, 0): min(frame.shape[0], y2),
                                      max(0, x1): min(frame.shape[1], x2)]
                    crop_offset = (max(x1, 0), max(y1, 0))

                if head_crop.size == 0:
                    continue

                # Try landmark-guided face extraction first
                hint_locs = None
                if landmarks_by_id.get(track_id):
                    f_box = extract_face_box_from_landmarks(
                        landmarks_by_id[track_id], head_crop.shape[1], head_crop.shape[0], offset=crop_offset
                    )
                    if f_box:
                        hint_locs = [f_box]

                match_result = self.watchlist.match(
                    head_crop, hint_locations=hint_locs, track_id=track_id
                )

                # Fallback: try full-frame landmarks if crop failed
                if match_result is None and landmarks_by_id.get(track_id) and hint_locs is None:
                    f_box = extract_face_box_from_landmarks(
                        landmarks_by_id[track_id], frame.shape[1], frame.shape[0]
                    )
                    if f_box:
                        match_result = self.watchlist.match(
                            frame, hint_locations=[f_box], track_id=track_id
                        )
                        if match_result is not None:
                            crop_offset = (0, 0)

                if match_result is not None:
                    name, conf, (fl, ft, fr, fb) = match_result
                    self.identity_cache[track_id] = name
                    matched_in_person = True
                    fx1, fy1 = fl + crop_offset[0], ft + crop_offset[1]
                    fx2, fy2 = fr + crop_offset[0], fb + crop_offset[1]
                    self.emit(
                        "WATCHLIST_MATCH", frame,
                        {"identity": name, "trackId": track_id, "bbox": [fx1, fy1, fx2, fy2]},
                        cache_key=f"watchlist_{name}",
                        confidence=conf,
                    )
                    cv2.rectangle(frame, (fx1, fy1), (fx2, fy2), (0, 0, 255), 3)
                    cv2.putText(frame, f"MATCH: {name.upper()} ({conf}%)",
                                (fx1, max(20, fy1 - 6)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                    log.info("WATCHLIST_MATCH on track #%d: '%s' (conf=%.1f%%)", track_id, name, conf)

            if not matched_in_person:
                last_frame_face_scan = getattr(self, "_last_frame_face_scan", 0.0)
                if now - last_frame_face_scan >= 0.5:
                    self._last_frame_face_scan = now
                    match_result = self.watchlist.match(frame)
                    if match_result is not None:
                        name, conf, (fx1, fy1, fx2, fy2) = match_result
                        self.emit(
                            "WATCHLIST_MATCH", frame,
                            {"identity": name, "bbox": [fx1, fy1, fx2, fy2]},
                            cache_key=f"watchlist_{name}",
                            confidence=conf,
                        )
                        cv2.rectangle(frame, (fx1, fy1), (fx2, fy2), (0, 0, 255), 3)
                        cv2.putText(frame, f"MATCH: {name.upper()} ({conf}%)",
                                    (fx1, max(20, fy1 - 6)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                        log.info("WATCHLIST_MATCH on camera feed: '%s' (conf=%.1f%%)", name, conf)

        # Cross-pillar event correlation
        self._correlate_events(frame, now)

def inference_worker(
    cfg: EngineConfig, frame_queue, incident_queue, control_queue,
    stop_event, health_queue, inference_fps, publish_queue,
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
            processor.process_frame(frame)
            if publish_queue is not None:
                put_latest(publish_queue, frame)
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
