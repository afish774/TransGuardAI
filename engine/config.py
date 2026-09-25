import os
from dataclasses import dataclass, field
from typing import Tuple

CLS_PERSON = 0
CLS_BACKPACK = 24
CLS_HANDBAG = 26
CLS_SUITCASE = 28
BAGGAGE_CLASSES = {
    CLS_BACKPACK: "backpack",
    CLS_HANDBAG: "handbag",
    CLS_SUITCASE: "suitcase",
}

# --- Pillar 1: over-crowd detection ---
CROWD_PERSON_THRESHOLD = 8
CROWD_CONSENSUS_FRAMES = 15
CROWD_RELEASE_FRAMES = 15

# --- Pillar 2: unattended baggage ---
BAGGAGE_STATIONARY_SECONDS = 10.0
BAGGAGE_STATIONARY_PIXEL_TOL = 10.0
BAGGAGE_PROXIMITY_RADIUS_PX = 120.0

# --- Pillar 3: fall detection ---
FALL_VISIBILITY_THRESHOLD = 0.5
FALL_ANGLE_THRESHOLD_DEG = 45.0
FALL_CONFIRM_FRAMES = 5
FALL_ASPECT_RATIO = 1.0

# --- Pillar 4: weapon detection ---
WEAPON_CLASS_KEYWORDS = ("gun", "pistol", "handgun", "revolver", "rifle",
                         "weapon", "knife", "blade", "bat", "firearm", "scissors",
                         "grenade", "explosive", "explosion")
WEAPON_CONF_THRESHOLD = float(os.getenv("WEAPON_CONF", "0.20"))
WEAPON_CONFIRM_FRAMES = 5
WEAPON_CROP_PADDING = 0.30
WEAPON_MAX_CROPS_PER_FRAME = 6

# --- Pillar 5: violence detection ---
VIOLENCE_IOU_THRESHOLD = 0.15
VIOLENCE_WRIST_SPEED_PX_S = 320.0
VIOLENCE_CONFIRM_FRAMES = 6
VIOLENCE_PAIR_TTL_S = 3.0

# --- Pillar 6: biometric watchlist ---
FACE_MATCH_TOLERANCE = float(os.getenv("FACE_MATCH_TOLERANCE", "0.60"))
FACE_RESCAN_INTERVAL_S = 1.0
FACE_MIN_SIZE = 120

INCIDENT_COOLDOWN_S = float(os.getenv("INCIDENT_COOLDOWN_S", "15.0"))
POSE_MAX_PERSONS_PER_FRAME = 4

FRAME_QUEUE_SIZE = 2
INCIDENT_QUEUE_SIZE = 128
CONTROL_QUEUE_SIZE = 4
WORKER_HEARTBEAT_SECONDS = 2.0
EDGE_HEARTBEAT_SECONDS = 10.0
WATCHLIST_SYNC_SECONDS = 30.0
HTTP_TIMEOUT_SECONDS = 5.0
MAX_PENDING_INCIDENTS = 256


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
    conf: float = 0.30
    mediamtx_rtsp_url: str = "rtsp://127.0.0.1:8554"
    weapon_model: str = "yolov8n-weapons.pt"
    weapon_conf: float = WEAPON_CONF_THRESHOLD
    face_tolerance: float = FACE_MATCH_TOLERANCE
    crowd_threshold: int = CROWD_PERSON_THRESHOLD
    crowd_frames: int = CROWD_CONSENSUS_FRAMES
    lat: float = float(os.getenv("FALLBACK_LAT", "10.5898"))
    lon: float = float(os.getenv("FALLBACK_LON", "76.0116"))
    vehicle_id: str = os.getenv("VEHICLE_ID", "BUS_001")

    def __post_init__(self) -> None:
        if self.rtsp_url:
            cleaned = self.rtsp_url.strip()
            if cleaned.lower().startswith("rstp://"):
                cleaned = "rtsp://" + cleaned[7:]
            self.rtsp_url = cleaned
