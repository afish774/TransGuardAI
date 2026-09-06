"""
Trans Guard AI - multiprocessing edge engine.

Workers:
  capture   FFmpeg/RTSP -> bounded latest-frame multiprocessing.Queue
  inference YOLO/ByteTrack + Pose + face matching -> incident & publish queues
  publisher MediaMTX FFmpeg rawvideo BGR pipe -> RTSP stream for WebRTC/HLS
  telemetry zone/watchlist polling, heartbeat and incident HTTP delivery

The queues are intentionally bounded. When inference cannot keep up, capture
drops stale frames instead of increasing end-to-end detection latency.
"""

import argparse
import importlib
import json
import logging
import math
import multiprocessing as mp_process
import os
import queue
import random
import signal
import subprocess
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, List, Optional, Tuple

import cv2
import numpy as np
import requests

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

# mediapipe is intentionally NOT imported here at module level. See
# FallDetector.__init__ for why (lazy import, explicit submodule path,
# and a hard version constraint that the rest of this file cannot see).

FACE_BACKEND = None
try:
    face_recognition = importlib.import_module("face_recognition")
    FACE_BACKEND = "face_recognition"
except ModuleNotFoundError:
    FACE_BACKEND = None

LOG_FORMAT = "[%(asctime)s] [%(processName)s] [%(levelname)s] %(message)s"
logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt="%H:%M:%S")
log = logging.getLogger("trans-guard-engine")

CLS_PERSON = 0
CLS_BACKPACK = 24
CLS_HANDBAG = 26
CLS_SUITCASE = 28
BAGGAGE_CLASSES = {
    CLS_BACKPACK: "backpack",
    CLS_HANDBAG: "handbag",
    CLS_SUITCASE: "suitcase",
}

FALL_VISIBILITY_THRESHOLD = 0.5
FALL_ANGLE_THRESHOLD_DEG = 45.0
FALL_CONFIRM_FRAMES = 5
BAGGAGE_STATIONARY_SECONDS = 30.0
BAGGAGE_STATIONARY_PIXEL_TOL = 25.0
BAGGAGE_PROXIMITY_RADIUS_PX = 120.0
FACE_MATCH_TOLERANCE = 0.5
INCIDENT_COOLDOWN_S = 60.0

FRAME_QUEUE_SIZE = 2
INCIDENT_QUEUE_SIZE = 128
CONTROL_QUEUE_SIZE = 4
WORKER_HEARTBEAT_SECONDS = 2.0
EDGE_HEARTBEAT_SECONDS = 10.0
ZONE_POLL_SECONDS = 5.0
WATCHLIST_SYNC_SECONDS = 300.0
HTTP_TIMEOUT_SECONDS = 5.0
MAX_PENDING_INCIDENTS = 256


@dataclass
class TrackedObject:
    track_id: int
    cls_name: str
    bbox: Tuple[int, int, int, int]
    centroid: Tuple[float, float]
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    last_move_time: float = field(default_factory=time.time)
    ref_centroid: Tuple[float, float] = (0.0, 0.0)


@dataclass
class EngineConfig:
    rtsp_url: str = "rtsp://127.0.0.1:8554/cam0"
    backend_url: str = "http://127.0.0.1:5000"
    camera_id: str = "cam0"
    api_key: str = "transguard-edge-secret-key-9042"
    width: int = 1280
    height: int = 720
    fps: int = 25
    yolo_model: str = "yolov8n.pt"
    ffmpeg_bin: str = "ffmpeg"
    conf: float = 0.45
    mediamtx_rtsp_url: str = "rtsp://127.0.0.1:8554"


def configure_worker_logging() -> None:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt="%H:%M:%S", force=True)


def bbox_center(b: Tuple[int, int, int, int]) -> Tuple[float, float]:
    x1, y1, x2, y2 = b
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def dist(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def point_in_polygon(point: Tuple[float, float], polygon: List[List[float]]) -> bool:
    if len(polygon) < 3:
        return False
    x, y = point
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def boxes_intersect_with_radius(bag_bbox, person_bbox, radius) -> bool:
    bx1, by1, bx2, by2 = bag_bbox
    px1, py1, px2, py2 = person_bbox
    ex1, ey1, ex2, ey2 = bx1 - radius, by1 - radius, bx2 + radius, by2 + radius
    return not (px2 < ex1 or px1 > ex2 or py2 < ey1 or py1 > ey2)


def put_latest(destination, item) -> None:
    """Publish without allowing stale work to accumulate."""
    try:
        destination.put_nowait(item)
        return
    except queue.Full:
        pass
    try:
        destination.get_nowait()
    except queue.Empty:
        pass
    try:
        destination.put_nowait(item)
    except queue.Full:
        pass


def publish_health(health_queue, worker: str, state: str, detail: str = "") -> None:
    put_latest(health_queue, {
        "worker": worker,
        "state": state,
        "detail": detail,
        "timestamp": time.time(),
    })


class FFmpegSource:
    """Blocking FFmpeg raw-frame reader, isolated in the capture process."""

    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        self.proc: Optional[subprocess.Popen] = None
        self.frame_size = cfg.width * cfg.height * 3

    def start(self) -> None:
        self.stop()
        command = [
            self.cfg.ffmpeg_bin,
            "-hide_banner",
            "-loglevel", "warning",
            "-rtsp_transport", "tcp",
            "-i", self.cfg.rtsp_url,
            "-an",
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{self.cfg.width}x{self.cfg.height}",
            "-r", str(self.cfg.fps),
            "pipe:1",
        ]
        self.proc = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=10 ** 8,
        )

    def read_frame(self) -> Optional[np.ndarray]:
        if self.proc is None or self.proc.stdout is None:
            return None
        raw = self.proc.stdout.read(self.frame_size)
        if len(raw) != self.frame_size:
            return None
        return np.frombuffer(raw, np.uint8).reshape((self.cfg.height, self.cfg.width, 3))

    def stop(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None


class MediaMTXPublisher:
    """Publishes annotated frames to MediaMTX over RTSP via an FFmpeg pipe."""

    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        self.rtsp_out = f"{cfg.mediamtx_rtsp_url}/cam/{cfg.camera_id}"
        self.proc: Optional[subprocess.Popen] = None
        self.frame_size = cfg.width * cfg.height * 3

    def start(self) -> None:
        self.stop()
        command = [
            self.cfg.ffmpeg_bin,
            "-hide_banner",
            "-loglevel", "warning",
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{self.cfg.width}x{self.cfg.height}",
            "-r", str(self.cfg.fps),
            "-i", "pipe:0",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-pix_fmt", "yuv420p",
            "-f", "rtsp",
            "-rtsp_transport", "tcp",
            self.rtsp_out,
        ]
        self.proc = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            bufsize=10 ** 7,
        )
        log.info("MediaMTXPublisher started -> %s", self.rtsp_out)

    def write_frame(self, frame: np.ndarray) -> bool:
        if self.proc is None or self.proc.stdin is None or self.proc.poll() is not None:
            return False
        try:
            if frame.shape[1] != self.cfg.width or frame.shape[0] != self.cfg.height:
                frame = cv2.resize(frame, (self.cfg.width, self.cfg.height))
            self.proc.stdin.write(frame.tobytes())
            return True
        except (BrokenPipeError, OSError):
            return False

    def stop(self) -> None:
        if self.proc is not None:
            if self.proc.stdin is not None:
                try:
                    self.proc.stdin.close()
                except Exception:
                    pass
            if self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
        self.proc = None


class Watchlist:
    """In-memory embeddings; HTTP retrieval is intentionally done by telemetry."""

    def __init__(self):
        self.encodings: List[np.ndarray] = []
        self.names: List[str] = []

    def replace_from_images(self, targets: List[Dict[str, object]]) -> None:
        if FACE_BACKEND != "face_recognition":
            return
        new_encodings: List[np.ndarray] = []
        new_names: List[str] = []
        for target in targets:
            name = str(target.get("name", "unknown"))
            image_bytes = target.get("image")
            if not isinstance(image_bytes, bytes):
                continue
            try:
                image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
                if image is None:
                    continue
                encodings = face_recognition.face_encodings(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
                if encodings:
                    new_encodings.append(encodings[0])
                    new_names.append(name)
            except Exception as exc:
                log.warning("Failed to encode watchlist target %s: %s", name, exc)
        self.encodings = new_encodings
        self.names = new_names
        log.info("Watchlist synced: %d identities cached", len(self.names))

    def match(self, face_bgr: np.ndarray) -> Optional[str]:
        if FACE_BACKEND != "face_recognition" or not self.encodings:
            return None
        try:
            encodings = face_recognition.face_encodings(cv2.cvtColor(face_bgr, cv2.COLOR_BGR2RGB))
            if not encodings:
                return None
            distances = face_recognition.face_distance(self.encodings, encodings[0])
            best = int(np.argmin(distances))
            if distances[best] <= FACE_MATCH_TOLERANCE:
                return self.names[best]
        except Exception as exc:
            log.debug("Face match error: %s", exc)
        return None


class FallDetector:
    # NOTE ON MEDIAPIPE VERSION: mp.solutions (the legacy Pose/Hands/FaceMesh
    # API used below) was removed from the mediapipe package entirely in
    # mediapipe>=0.10.30 -- on those versions even the explicit submodule
    # import below fails with ModuleNotFoundError, not just AttributeError,
    # because the whole `mediapipe.python` subpackage is gone. Pin
    # mediapipe<=0.10.21 (confirmed working; 0.10.30+ confirmed broken) in
    # requirements.txt/pip install for this class to do anything. Migrating
    # to the newer mediapipe.tasks PoseLandmarker API is possible but is a
    # separate, larger change (different result shape, no PoseLandmark enum,
    # and it needs a downloaded .task model file) -- out of scope here.
    #
    # The import itself is done HERE (inside __init__), not at module level,
    # and via the explicit mediapipe.python.solutions.pose path rather than
    # `import mediapipe as mp` + `mp.solutions.pose`, for two reasons:
    #   1. Only the inference worker needs pose detection. capture_worker
    #      and telemetry_worker never touch mediapipe, so on a version where
    #      it imports (and drags in tensorflow) at all, they should not pay
    #      for that import at all.
    #   2. On Windows, each worker is a freshly spawned process that re-runs
    #      this module from scratch, and some mediapipe builds do not
    #      reliably re-populate the `mediapipe.solutions` attribute on the
    #      top-level package inside that spawned process. Importing the
    #      real submodule by its own dotted path sidesteps that attribute
    #      entirely.
    def __init__(self):
        self.pose = None
        self._pose_landmark = None
        try:
            import mediapipe.python.solutions.pose as mp_pose
        except ImportError as exc:
            mp_pose = None
            log.warning(
                "Pose detection unavailable, fall detection disabled: %s", exc
            )
        if mp_pose is not None:
            self.pose = mp_pose.Pose(
                static_image_mode=False,
                model_complexity=0,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self._pose_landmark = mp_pose.PoseLandmark
        self.fall_streak = 0

    def close(self) -> None:
        if self.pose is not None:
            self.pose.close()

    def process(self, frame_bgr: np.ndarray) -> bool:
        if self.pose is None:
            return False
        result = self.pose.process(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
        if not result.pose_landmarks:
            self.fall_streak = 0
            return False

        landmarks = result.pose_landmarks.landmark
        pose_landmark = self._pose_landmark
        required = [
            pose_landmark.LEFT_HIP,
            pose_landmark.RIGHT_HIP,
            pose_landmark.LEFT_ANKLE,
            pose_landmark.RIGHT_ANKLE,
        ]
        if any(landmarks[index.value].visibility < FALL_VISIBILITY_THRESHOLD for index in required):
            self.fall_streak = 0
            return False

        height, width = frame_bgr.shape[:2]

        def point(index):
            return np.array([landmarks[index.value].x * width, landmarks[index.value].y * height])

        hip_mid = (point(pose_landmark.LEFT_HIP) + point(pose_landmark.RIGHT_HIP)) / 2.0
        ankle_mid = (point(pose_landmark.LEFT_ANKLE) + point(pose_landmark.RIGHT_ANKLE)) / 2.0
        torso = hip_mid - ankle_mid
        norm = np.linalg.norm(torso)
        if norm < 1e-6:
            self.fall_streak = 0
            return False

        cosang = float(np.dot(torso / norm, np.array([0.0, -1.0])))
        angle_deg = math.degrees(math.acos(max(-1.0, min(1.0, cosang))))
        self.fall_streak = self.fall_streak + 1 if angle_deg > FALL_ANGLE_THRESHOLD_DEG else 0
        if self.fall_streak >= FALL_CONFIRM_FRAMES:
            self.fall_streak = 0
            return True
        return False


class IncidentProcessor:
    """All model and tracker state stays in the one inference process."""

    def __init__(self, cfg: EngineConfig, incident_queue):
        if YOLO is None:
            raise RuntimeError("ultralytics is not installed; cannot load YOLO model")
        self.cfg = cfg
        self.incident_queue = incident_queue
        self.model = YOLO(cfg.yolo_model)
        self.fall = FallDetector()
        self.watchlist = Watchlist()
        self.zone_polygon: List[List[float]] = []
        self.incident_cache: Dict[str, float] = {}
        self.identity_cache: Dict[int, str] = {}
        self.baggage_cache: Dict[int, TrackedObject] = {}

    def close(self) -> None:
        self.fall.close()

    def apply_control(self, control: Dict[str, object]) -> None:
        message_type = control.get("type")
        if message_type == "zone":
            polygon = control.get("polygon", [])
            if isinstance(polygon, list):
                self.zone_polygon = polygon
        elif message_type == "watchlist":
            targets = control.get("targets", [])
            if isinstance(targets, list):
                self.watchlist.replace_from_images(targets)

    def _snapshot_jpeg(self, frame: np.ndarray) -> bytes:
        ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        return buffer.tobytes() if ok else b""

    def emit(self, incident_type: str, frame: np.ndarray, extra: dict, cache_key: Optional[str] = None) -> None:
        if cache_key:
            now = time.time()
            if now - self.incident_cache.get(cache_key, 0.0) < INCIDENT_COOLDOWN_S:
                return
            self.incident_cache[cache_key] = now
        payload = {
            "incident_type": incident_type,
            "camera_id": self.cfg.camera_id,
            "confidence": 99.0,
            "evidence_jpeg": self._snapshot_jpeg(frame),
            **extra,
        }
        try:
            self.incident_queue.put_nowait(payload)
            log.info("INCIDENT %s", incident_type)
        except queue.Full:
            log.warning("Incident outbox full, dropping %s", incident_type)

    def process_frame(self, frame: np.ndarray) -> None:
        now = time.time()
        results = self.model.track(frame, persist=True, verbose=False, conf=self.cfg.conf)[0]
        persons: List[Tuple[int, Tuple[int, int, int, int]]] = []
        bags: List[Tuple[int, str, Tuple[int, int, int, int]]] = []

        if results.boxes is not None and results.boxes.id is not None:
            for box, track_id_tensor in zip(results.boxes, results.boxes.id):
                class_id = int(box.cls[0])
                track_id = int(track_id_tensor.item())
                bbox = tuple(int(value) for value in box.xyxy[0].tolist())
                if class_id == CLS_PERSON:
                    persons.append((track_id, bbox))
                    # Draw Person bounding box
                    x1, y1, x2, y2 = bbox
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(frame, f"Person #{track_id}", (x1, max(20, y1 - 6)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                elif class_id in BAGGAGE_CLASSES:
                    bags.append((track_id, BAGGAGE_CLASSES[class_id], bbox))
                    # Draw Baggage bounding box
                    x1, y1, x2, y2 = bbox
                    class_name = BAGGAGE_CLASSES[class_id]
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 165, 0), 2)
                    cv2.putText(frame, f"{class_name} #{track_id}", (x1, max(20, y1 - 6)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 165, 0), 2)

        if persons and self.fall.process(frame):
            self.emit("FALL_DETECTED", frame, {"persons": len(persons)}, cache_key="fall_general")
            cv2.putText(frame, "INCIDENT: FALL DETECTED", (30, 45),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)

        for track_id, class_name, bbox in bags:
            centroid = bbox_center(bbox)
            if track_id not in self.baggage_cache:
                self.baggage_cache[track_id] = TrackedObject(
                    track_id=track_id, cls_name=class_name, bbox=bbox,
                    centroid=centroid, ref_centroid=centroid,
                )
            else:
                obj = self.baggage_cache[track_id]
                obj.bbox = bbox
                obj.centroid = centroid
                obj.last_seen = now
                if dist(centroid, obj.ref_centroid) > BAGGAGE_STATIONARY_PIXEL_TOL:
                    obj.ref_centroid = centroid
                    obj.last_move_time = now

            obj = self.baggage_cache[track_id]
            stationary_for = now - obj.last_move_time
            if stationary_for > BAGGAGE_STATIONARY_SECONDS:
                attended = any(
                    boxes_intersect_with_radius(obj.bbox, person_bbox, BAGGAGE_PROXIMITY_RADIUS_PX)
                    for _, person_bbox in persons
                )
                if not attended:
                    self.emit(
                        "UNATTENDED_BAGGAGE", frame,
                        {"objectClass": obj.cls_name, "trackId": obj.track_id,
                         "stationarySeconds": round(stationary_for, 1)},
                        cache_key=f"bag_{track_id}",
                    )
                    x1, y1, x2, y2 = obj.bbox
                    cv2.putText(frame, f"UNATTENDED ({round(stationary_for)}s)", (x1, y2 + 20),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)

        for track_id in list(self.baggage_cache):
            if now - self.baggage_cache[track_id].last_seen > 5.0:
                del self.baggage_cache[track_id]

        if len(self.zone_polygon) >= 3:
            pixel_zone = [[x * self.cfg.width, y * self.cfg.height] for x, y in self.zone_polygon]
            for track_id, person_bbox in persons:
                x1, y1, x2, y2 = person_bbox
                # Track feet: bottom-center of person bounding box ((x1 + x2) / 2, y2)
                feet_x = (x1 + x2) / 2.0
                feet_y = float(y2)
                if point_in_polygon((feet_x, feet_y), pixel_zone):
                    self.emit(
                        "ZONE_INTRUSION", frame,
                        {"trackId": track_id, "point": [round(feet_x, 1), round(feet_y, 1)]},
                        cache_key=f"zone_{track_id}",
                    )
                    cv2.circle(frame, (int(feet_x), int(feet_y)), 6, (0, 0, 255), -1)
                    cv2.putText(frame, f"ZONE INTRUSION #{track_id}", (x1, max(20, y1 - 25)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
            cv2.polylines(frame, [np.array(pixel_zone, np.int32)], True, (0, 0, 255), 2)

        if FACE_BACKEND:
            for track_id, (x1, y1, x2, y2) in persons:
                if track_id in self.identity_cache:
                    name = self.identity_cache[track_id]
                    if name != "UNKNOWN":
                        cv2.putText(frame, f"MATCH: {name}", (x1, y2 + 18),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
                    continue
                head = frame[max(y1, 0): y1 + max(1, (y2 - y1) // 3), x1:x2]
                if head.size == 0:
                    continue
                name = self.watchlist.match(head)
                if name:
                    self.identity_cache[track_id] = name
                    self.emit(
                        "WATCHLIST_MATCH", frame,
                        {"identity": name, "trackId": track_id},
                        cache_key=f"watchlist_{name}",
                    )
                    cv2.putText(frame, f"MATCH: {name}", (x1, y2 + 18),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
                else:
                    self.identity_cache[track_id] = "UNKNOWN"


def capture_worker(cfg: EngineConfig, frame_queue, stop_event, health_queue, capture_fps, last_capture_time) -> None:
    configure_worker_logging()
    source = FFmpegSource(cfg)
    backoff = 1.0
    frame_count = 0
    rate_window = time.monotonic()
    last_health = 0.0
    try:
        while not stop_event.is_set():
            try:
                publish_health(health_queue, "capture", "CONNECTING")
                source.start()
                backoff = 1.0
                publish_health(health_queue, "capture", "ONLINE")
                while not stop_event.is_set():
                    frame = source.read_frame()
                    if frame is None:
                        raise RuntimeError("FFmpeg returned an incomplete frame")
                    captured_at = time.time()
                    put_latest(frame_queue, (captured_at, frame))
                    last_capture_time.value = captured_at
                    frame_count += 1
                    now = time.monotonic()
                    if now - rate_window >= 1.0:
                        capture_fps.value = frame_count / (now - rate_window)
                        frame_count = 0
                        rate_window = now
                    if now - last_health >= WORKER_HEARTBEAT_SECONDS:
                        publish_health(health_queue, "capture", "ONLINE")
                        last_health = now
            except Exception as exc:
                source.stop()
                publish_health(health_queue, "capture", "DEGRADED", str(exc))
                wait_seconds = min(backoff, 30.0) * random.uniform(0.8, 1.2)
                log.warning("Capture failed: %s; retrying in %.1fs", exc, wait_seconds)
                stop_event.wait(wait_seconds)
                backoff = min(backoff * 2.0, 30.0)
    finally:
        source.stop()
        capture_fps.value = 0.0
        publish_health(health_queue, "capture", "STOPPED")


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
    except Exception as exc:
        publish_health(health_queue, "inference", "FAILED", str(exc))
        log.exception("Inference worker failed")
        raise
    finally:
        inference_fps.value = 0.0
        if processor is not None:
            processor.close()
        publish_health(health_queue, "inference", "STOPPED")


def publisher_worker(cfg: EngineConfig, publish_queue, stop_event, health_queue) -> None:
    """Isolated worker pushing annotated frames to MediaMTX over RTSP."""
    configure_worker_logging()
    publisher = MediaMTXPublisher(cfg)
    backoff = 1.0
    last_health = 0.0
    try:
        while not stop_event.is_set():
            try:
                publish_health(health_queue, "publisher", "CONNECTING")
                publisher.start()
                backoff = 1.0
                publish_health(health_queue, "publisher", "ONLINE")
                while not stop_event.is_set():
                    try:
                        frame = publish_queue.get(timeout=1.0)
                    except queue.Empty:
                        continue
                    if not publisher.write_frame(frame):
                        raise RuntimeError("Failed writing frame to MediaMTX FFmpeg pipe")
                    now = time.monotonic()
                    if now - last_health >= WORKER_HEARTBEAT_SECONDS:
                        publish_health(health_queue, "publisher", "ONLINE")
                        last_health = now
            except Exception as exc:
                publisher.stop()
                publish_health(health_queue, "publisher", "DEGRADED", str(exc))
                wait_seconds = min(backoff, 10.0) * random.uniform(0.8, 1.2)
                log.warning("Publisher failed: %s; retrying in %.1fs", exc, wait_seconds)
                stop_event.wait(wait_seconds)
                backoff = min(backoff * 2.0, 10.0)
    finally:
        publisher.stop()
        publish_health(health_queue, "publisher", "STOPPED")


def fetch_watchlist(session: requests.Session, cfg: EngineConfig) -> List[Dict[str, object]]:
    response = session.get(
        f"{cfg.backend_url}/api/watchlist",
        headers={"x-edge-api-key": cfg.api_key},
        timeout=HTTP_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    targets: List[Dict[str, object]] = []
    for target in response.json():
        image_response = session.get(str(target["url"]), timeout=HTTP_TIMEOUT_SECONDS)
        image_response.raise_for_status()
        targets.append({"name": target["name"], "image": image_response.content})
    return targets


def incident_to_multipart(payload: Dict[str, object]) -> Tuple[Dict[str, str], Dict[str, Tuple[str, bytes, str]]]:
    """Convert an inference event into the server's multipart alert contract."""
    fields: Dict[str, str] = {}
    evidence = payload.get("evidence_jpeg", b"")
    for key, value in payload.items():
        if key == "evidence_jpeg" or value is None:
            continue
        if isinstance(value, (dict, list)):
            fields[key] = json.dumps(value, separators=(",", ":"))
        elif isinstance(value, bool):
            fields[key] = "true" if value else "false"
        else:
            fields[key] = str(value)
    files: Dict[str, Tuple[str, bytes, str]] = {}
    if isinstance(evidence, bytes) and evidence:
        files["evidence"] = ("evidence.jpg", evidence, "image/jpeg")
    return fields, files


def telemetry_worker(
    cfg: EngineConfig, incident_queue, control_queue, stop_event, health_queue,
    capture_fps, inference_fps, last_capture_time,
) -> None:
    configure_worker_logging()
    session = requests.Session()
    headers = {"x-edge-api-key": cfg.api_key}
    pending: Deque[Dict[str, object]] = deque(maxlen=MAX_PENDING_INCIDENTS)
    next_zone_poll = 0.0
    next_watchlist_sync = 0.0
    next_edge_heartbeat = 0.0
    next_incident_attempt = 0.0
    incident_backoff = 1.0
    last_health = 0.0
    try:
        while not stop_event.is_set():
            now = time.monotonic()
            while True:
                try:
                    pending.append(incident_queue.get_nowait())
                except queue.Empty:
                    break

            if now >= next_zone_poll:
                try:
                    response = session.get(
                        f"{cfg.backend_url}/api/edge/zone/{cfg.camera_id}",
                        headers=headers, timeout=HTTP_TIMEOUT_SECONDS,
                    )
                    response.raise_for_status()
                    put_latest(control_queue, {"type": "zone", "polygon": response.json().get("polygon", [])})
                except Exception as exc:
                    log.warning("Zone poll failed: %s", exc)
                next_zone_poll = now + ZONE_POLL_SECONDS

            if now >= next_watchlist_sync:
                if FACE_BACKEND == "face_recognition":
                    try:
                        put_latest(control_queue, {"type": "watchlist", "targets": fetch_watchlist(session, cfg)})
                    except Exception as exc:
                        log.warning("Watchlist sync failed: %s", exc)
                next_watchlist_sync = now + WATCHLIST_SYNC_SECONDS

            if now >= next_edge_heartbeat:
                try:
                    age = time.time() - last_capture_time.value if last_capture_time.value else float("inf")
                    status = "ONLINE" if age < EDGE_HEARTBEAT_SECONDS * 2 else "OFFLINE"
                    response = session.post(
                        f"{cfg.backend_url}/api/edge/heartbeat",
                        headers=headers,
                        json={
                            "camera_id": cfg.camera_id, "status": status,
                            "fps": round(inference_fps.value, 2),
                            "capture_fps": round(capture_fps.value, 2),
                            "inference_fps": round(inference_fps.value, 2),
                        },
                        timeout=HTTP_TIMEOUT_SECONDS,
                    )
                    response.raise_for_status()
                except Exception as exc:
                    log.warning("Heartbeat failed: %s", exc)
                next_edge_heartbeat = now + EDGE_HEARTBEAT_SECONDS

            if pending and now >= next_incident_attempt:
                try:
                    fields, files = incident_to_multipart(pending[0])
                    response = session.post(
                        f"{cfg.backend_url}/api/alerts", headers=headers,
                        data=fields, files=files, timeout=HTTP_TIMEOUT_SECONDS,
                    )
                    response.raise_for_status()
                    pending.popleft()
                    incident_backoff = 1.0
                    next_incident_attempt = now
                except Exception as exc:
                    wait_seconds = min(incident_backoff, 30.0) * random.uniform(0.8, 1.2)
                    next_incident_attempt = now + wait_seconds
                    incident_backoff = min(incident_backoff * 2.0, 30.0)
                    log.warning("Incident delivery failed; retrying in %.1fs: %s", wait_seconds, exc)

            if now - last_health >= WORKER_HEARTBEAT_SECONDS:
                publish_health(health_queue, "telemetry", "ONLINE", f"pending_incidents={len(pending)}")
                last_health = now
            stop_event.wait(0.05)
    except Exception as exc:
        publish_health(health_queue, "telemetry", "FAILED", str(exc))
        log.exception("Telemetry worker failed")
        raise
    finally:
        session.close()
        publish_health(health_queue, "telemetry", "STOPPED")


class TransGuardEngine:
    """Supervises isolated workers and restarts a worker that exits unexpectedly."""

    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        self.context = mp_process.get_context("spawn")
        self.stop_event = self.context.Event()
        self.frame_queue = self.context.Queue(maxsize=FRAME_QUEUE_SIZE)
        self.publish_queue = self.context.Queue(maxsize=FRAME_QUEUE_SIZE)
        self.incident_queue = self.context.Queue(maxsize=INCIDENT_QUEUE_SIZE)
        self.control_queue = self.context.Queue(maxsize=CONTROL_QUEUE_SIZE)
        self.health_queue = self.context.Queue(maxsize=16)
        self.capture_fps = self.context.Value("d", 0.0)
        self.inference_fps = self.context.Value("d", 0.0)
        self.last_capture_time = self.context.Value("d", 0.0)
        self.workers: Dict[str, mp_process.Process] = {}

    def _worker_spec(self, name: str):
        if name == "capture":
            return capture_worker, (
                self.cfg, self.frame_queue, self.stop_event, self.health_queue,
                self.capture_fps, self.last_capture_time,
            )
        if name == "inference":
            return inference_worker, (
                self.cfg, self.frame_queue, self.incident_queue, self.control_queue,
                self.stop_event, self.health_queue, self.inference_fps, self.publish_queue,
            )
        if name == "publisher":
            return publisher_worker, (
                self.cfg, self.publish_queue, self.stop_event, self.health_queue,
            )
        return telemetry_worker, (
            self.cfg, self.incident_queue, self.control_queue, self.stop_event, self.health_queue,
            self.capture_fps, self.inference_fps, self.last_capture_time,
        )

    def _start_worker(self, name: str) -> None:
        target, args = self._worker_spec(name)
        process = self.context.Process(name=f"transguard-{name}", target=target, args=args)
        process.start()
        self.workers[name] = process
        log.info("Started %s worker (pid=%s)", name, process.pid)

    def stop(self) -> None:
        self.stop_event.set()

    def run(self) -> None:
        if YOLO is None:
            raise RuntimeError("ultralytics is not installed; install it before starting the engine")
        for name in ("capture", "inference", "publisher", "telemetry"):
            self._start_worker(name)
        log.info("Engine running. Camera=%s", self.cfg.camera_id)
        try:
            while not self.stop_event.is_set():
                while True:
                    try:
                        health = self.health_queue.get_nowait()
                        if health["state"] in ("DEGRADED", "FAILED"):
                            log.warning("%s worker is %s: %s", health["worker"], health["state"], health["detail"])
                    except queue.Empty:
                        break
                for name, process in list(self.workers.items()):
                    if not process.is_alive() and not self.stop_event.is_set():
                        exit_code = process.exitcode
                        process.join(timeout=0)
                        log.error("%s worker exited with code %s; restarting", name, exit_code)
                        self._start_worker(name)
                self.stop_event.wait(1.0)
        finally:
            self.stop_event.set()
            for process in self.workers.values():
                process.join(timeout=5)
            for process in self.workers.values():
                if process.is_alive():
                    log.warning("Force-terminating worker pid=%s", process.pid)
                    process.terminate()
                    process.join(timeout=3)
            for resource in (self.frame_queue, self.publish_queue, self.incident_queue, self.control_queue, self.health_queue):
                resource.close()
                resource.join_thread()


def parse_args() -> EngineConfig:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rtsp", default=os.getenv("RTSP_URL", "rtsp://127.0.0.1:8554/cam0"))
    parser.add_argument("--url", default=None, help="Backward-compatible alias for --rtsp")
    parser.add_argument("--camera", default=os.getenv("CAMERA_ID", "cam0"))
    parser.add_argument("--backend-url", default=os.getenv("BACKEND_URL", "http://127.0.0.1:5000"))
    parser.add_argument("--api-key", default=os.getenv("EDGE_API_KEY", "transguard-edge-secret-key-9042"))
    parser.add_argument("--width", type=int, default=int(os.getenv("FRAME_WIDTH", "1280")))
    parser.add_argument("--height", type=int, default=int(os.getenv("FRAME_HEIGHT", "720")))
    parser.add_argument("--fps", type=int, default=int(os.getenv("FRAME_FPS", "25")))
    parser.add_argument("--model", default=os.getenv("YOLO_MODEL", "yolov8n.pt"))
    parser.add_argument("--ffmpeg", default=os.getenv("FFMPEG_BIN", "ffmpeg"))
    parser.add_argument("--conf", type=float, default=float(os.getenv("YOLO_CONF", "0.45")))
    parser.add_argument("--headless", action="store_true", help="Retained for compatibility; the engine is always headless")
    parser.add_argument("--mediamtx-rtsp", default=os.getenv("MEDIAMTX_RTSP_URL", "rtsp://127.0.0.1:8554"))
    args = parser.parse_args()
    return EngineConfig(
        rtsp_url=args.url or args.rtsp,
        backend_url=args.backend_url.rstrip("/"),
        camera_id=args.camera,
        api_key=args.api_key,
        width=args.width,
        height=args.height,
        fps=args.fps,
        yolo_model=args.model,
        ffmpeg_bin=args.ffmpeg,
        conf=args.conf,
        mediamtx_rtsp_url=args.mediamtx_rtsp.rstrip("/"),
    )


def main() -> int:
    cfg = parse_args()
    engine = TransGuardEngine(cfg)

    def handle_signal(_signal_number, _frame) -> None:
        log.info("Shutdown signal received")
        engine.stop()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    try:
        engine.run()
        return 0
    except KeyboardInterrupt:
        engine.stop()
        return 0
    except Exception as exc:
        log.exception("Engine failed to start: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())