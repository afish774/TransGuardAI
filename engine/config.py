import os
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

ENGINE_DEVICE = os.getenv("ENGINE_DEVICE", "auto").strip().lower()


def resolve_compute_device() -> Tuple[str, bool, str]:
    """Return ``(device_str, use_half, label)`` for PyTorch / Ultralytics / CLIP.

    Automatically enables ``cuda:0`` when an NVIDIA CUDA GPU is detected, and
    only enables YOLO FP16 on GPUs with hardware Tensor Cores (Ampere+ ``sm_80+``
    or Volta/Turing RTX/T4/V100). Non-Tensor-Core Turing GPUs (Quadro T1000/T2000,
    GTX 16xx) run YOLO ~20% faster and with higher precision in native FP32.
    Override via ``ENGINE_DEVICE=cpu`` or ``ENGINE_DEVICE=cuda:0``.
    """
    requested = os.getenv("ENGINE_DEVICE", ENGINE_DEVICE).strip().lower()
    if requested == "cpu":
        return ("cpu", False, "CPU (forced)")
    try:
        import torch
        if torch.cuda.is_available():
            dev = requested if requested.startswith("cuda") else "cuda:0"
            idx = int(dev.split(":")[1]) if ":" in dev and dev.split(":")[1].isdigit() else 0
            props = torch.cuda.get_device_properties(idx)
            vram_gb = props.total_memory / (1024 ** 3)
            name_lower = props.name.lower()
            has_tensor_cores = props.major >= 8 or (
                props.major == 7
                and any(tag in name_lower for tag in ("rtx", "t4", "v100", "titan v", "gv100"))
            )
            prec = "FP16" if has_tensor_cores else "FP32"
            return (dev, has_tensor_cores, f"{props.name} ({vram_gb:.1f} GB VRAM, {prec})")
    except Exception:
        pass
    return ("cpu", False, "CPU")


def default_models_for_device() -> Tuple[str, str]:
    """Select optimal (yolo_model, pose_model) for the active hardware.

    - NVIDIA CUDA GPU (Quadro T2000, RTX 3060, etc.): upgrades to ``yolo11s.pt``
      + single-pass ``yolo11s-pose.pt`` (~1.5 GB total VRAM in FP16).
    - CPU-only edge host: stays on lightweight ``yolov8n.pt`` + MediaPipe Pose.
    """
    dev, _, _ = resolve_compute_device()
    if dev.startswith("cuda"):
        return ("yolo11s.pt", "yolo11s-pose.pt")
    return ("yolov8n.pt", "")

_ULTRALYTICS_HAS_QUANTIZE: Optional[bool] = None

def yolo_precision_kwargs(use_half: bool) -> Dict[str, object]:
    """Return FP16 kwargs compatible with Ultralytics >=8.4 (`quantize`) and older (`half`),
    or an empty dict in FP32 mode so zero per-call quantization overhead occurs."""
    if not use_half:
        return {}
    global _ULTRALYTICS_HAS_QUANTIZE
    if _ULTRALYTICS_HAS_QUANTIZE is None:
        try:
            from ultralytics.cfg import DEFAULT_CFG_DICT
            _ULTRALYTICS_HAS_QUANTIZE = "quantize" in DEFAULT_CFG_DICT
        except Exception:
            _ULTRALYTICS_HAS_QUANTIZE = False
    if _ULTRALYTICS_HAS_QUANTIZE:
        return {"quantize": "fp16"}
    return {"half": True}

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
CROWD_CONSENSUS_FRAMES = 20
CROWD_RELEASE_FRAMES = 15
YOLO_CONF_THRESHOLD = float(os.getenv("YOLO_CONF", "0.45"))

# --- Pillar 2: unattended baggage ---
BAGGAGE_STATIONARY_SECONDS = 15.0
BAGGAGE_STATIONARY_PIXEL_TOL = 14.0
BAGGAGE_PROXIMITY_RADIUS_PX = 140.0

# Baggage detection confidence floor — YOLOv8n has weaker recall for
# handbags/backpacks than for persons.  Detections above this floor but below
# the main model `conf` are rescued and fed to the tracker so that
# intermittent low-confidence hits accumulate into stable tracks instead of
# flickering and being lost.
BAGGAGE_CONF_FLOOR = float(os.getenv("BAGGAGE_CONF_FLOOR", "0.22"))

# Minimum number of frames a bag must be seen before it can trigger an alert.
# This eliminates single-frame false positives from the lower confidence floor.
BAGGAGE_MIN_FRAMES = int(os.getenv("BAGGAGE_MIN_FRAMES", "8"))

# If a bag track disappears for fewer than this many seconds and a new
# detection appears nearby, we re-link it to the old track so the
# unattended timer is not reset.
BAGGAGE_RELINK_TTL_S = 5.0
BAGGAGE_RELINK_DIST_PX = 60.0

# --- Pillar 3: fall detection ---
FALL_VISIBILITY_THRESHOLD = 0.5
FALL_ANGLE_THRESHOLD_DEG = 45.0
FALL_CONFIRM_FRAMES = 8
FALL_ASPECT_RATIO = 1.2

# --- Pillar 4: weapon detection ---
WEAPON_CLASS_KEYWORDS = ("gun", "pistol", "handgun", "revolver", "rifle",
                         "weapon", "knife", "blade", "firearm",
                         "grenade", "explosive", "explosion")
WEAPON_CONF_THRESHOLD = float(os.getenv("WEAPON_CONF", "0.42"))
WEAPON_CONFIRM_FRAMES = int(os.getenv("WEAPON_CONFIRM_FRAMES", "4"))
WEAPON_CROP_PADDING = 0.30
WEAPON_MAX_CROPS_PER_FRAME = 6
WEAPON_RELINK_DIST_PX = 100.0
WEAPON_RELINK_TTL_S = 3.0

# Shared Vision-Language Verifier (powers BOTH Pillar 4 Weapon & Pillar 5 Violence
# using a single GPU FP16 model instance). Defaults to SigLIP patch16 (4x finer
# spatial detail than CLIP patch32) with automatic CLIP fallbacks.
VLM_VERIFIER_MODEL = os.getenv("VLM_VERIFIER_MODEL", "google/siglip-base-patch16-224").strip()
VLM_FALLBACK_MODELS = (
    "google/siglip-base-patch16-224",
    "openai/clip-vit-base-patch16",
    "openai/clip-vit-base-patch32",
)
# Enable Stage-2 visual violence confirmation via the shared VLM (0 extra VRAM)
VIOLENCE_VLM_VERIFY = os.getenv("VIOLENCE_VLM_VERIFY", "1").strip().lower() not in ("0", "false", "no")

# --- Pillar 5: violence detection ---
VIOLENCE_IOU_THRESHOLD = float(os.getenv("VIOLENCE_IOU_THRESHOLD", "0.08"))
VIOLENCE_PROXIMITY_PX = float(os.getenv("VIOLENCE_PROXIMITY_PX", "140.0"))
VIOLENCE_WRIST_SPEED_PX_S = float(os.getenv("VIOLENCE_WRIST_SPEED_PX_S", "300.0"))
VIOLENCE_BODY_SPEED_PX_S = float(os.getenv("VIOLENCE_BODY_SPEED_PX_S", "240.0"))
VIOLENCE_CONFIRM_FRAMES = int(os.getenv("VIOLENCE_CONFIRM_FRAMES", "3"))
VIOLENCE_PAIR_TTL_S = 3.0

# --- Pillar 6: biometric watchlist ---
FACE_MATCH_TOLERANCE = float(os.getenv("FACE_MATCH_TOLERANCE", "0.50"))
# InsightFace ArcFace 512-D cosine similarity threshold (0.36 tuned for 720p CCTV + buffalo_sc/buffalo_l with 2-frame consensus)
FACE_COSINE_THRESHOLD = float(os.getenv("FACE_COSINE_THRESHOLD", "0.36"))
# Face backend preference: 'auto' (prefers InsightFace SCRFD+ArcFace, falls back to dlib)
FACE_BACKEND_PREF = os.getenv("FACE_BACKEND", "auto").strip().lower()
# InsightFace pack: 'auto' picks buffalo_l on >=6GB GPU (RTX 3060) or buffalo_sc on 4GB/CPU
INSIGHTFACE_MODEL = os.getenv("INSIGHTFACE_MODEL", "auto").strip()
FACE_RESCAN_INTERVAL_S = float(os.getenv("FACE_RESCAN_INTERVAL_S", "0.65"))
# Faster rescan while a track has an unconfirmed (1-of-2) watchlist hit
FACE_PENDING_RESCAN_S = float(os.getenv("FACE_PENDING_RESCAN_S", "0.25"))
# Non-match backoff duration (s) before rescanning the same person track
FACE_NON_MATCH_BACKOFF_S = float(os.getenv("FACE_NON_MATCH_BACKOFF_S", "2.5"))
# Minimum face box side (px). 34px allows mid-range 720p bus faces (3-6m) without garbage crops.
FACE_MIN_SIZE = int(os.getenv("FACE_MIN_SIZE", "34"))
# Minimum Laplacian variance (sharpness) of the face crop before encoding (H.264 CCTV-friendly)
FACE_MIN_SHARPNESS = float(os.getenv("FACE_MIN_SHARPNESS", "14.0"))
# A watchlist identity must be matched this many times within the window
FACE_CONSENSUS_HITS = int(os.getenv("FACE_CONSENSUS_HITS", "2"))
FACE_CONSENSUS_WINDOW_S = float(os.getenv("FACE_CONSENSUS_WINDOW_S", "6.0"))
# Full-frame face fallback scan interval
FACE_FULL_FRAME_INTERVAL_S = 3.0

# --- Scene pre-processing / gating ---
# Optional interior Region-Of-Interest polygon in normalised coords
# "x1,y1;x2,y2;x3,y3;..." (0..1). Persons/bags whose ground point lies
# outside are ignored (e.g. pedestrians seen through the windows).
DETECTION_ROI = os.getenv("DETECTION_ROI", "").strip()
# Optional '|'-separated seat-zone polygons in normalised coords where seated
# slouching/leaning is excluded from fall detection.
SEAT_ZONES_ROI = os.getenv("SEAT_ZONES_ROI", "").strip()
_DEFAULT_YOLO_MODEL, _DEFAULT_POSE_MODEL = default_models_for_device()
# Optional YOLO-pose model path (e.g. yolo11s-pose.pt) to replace MediaPipe
# with single-pass multi-person pose inference. Auto-enabled on CUDA GPUs.
DEFAULT_YOLO_MODEL = os.getenv("YOLO_MODEL", _DEFAULT_YOLO_MODEL).strip() or _DEFAULT_YOLO_MODEL
POSE_MODEL = os.getenv("POSE_MODEL", _DEFAULT_POSE_MODEL).strip()
# Transit-tuned tracker config: BoT-SORT (with Sparse Optical-Flow GMC) on GPU
# or when TRACKER_TYPE=botsort; ByteTrack on CPU (override with TRACKER_CONFIG).
_TRACKER_TYPE = os.getenv("TRACKER_TYPE", "auto").strip().lower()
_ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
_BOTSORT_CFG = os.path.join(_ENGINE_DIR, "transguard_botsort.yaml")
_BYTETRACK_CFG = os.path.join(_ENGINE_DIR, "transguard_bytetrack.yaml")
_FINE_TUNED_WEAPON_MODEL = os.path.join(_ENGINE_DIR, "weights", "yolo11s-weapons.pt")
DEFAULT_WEAPON_MODEL = os.getenv(
    "WEAPON_MODEL",
    _FINE_TUNED_WEAPON_MODEL if os.path.exists(_FINE_TUNED_WEAPON_MODEL) else "yolov8n-weapons.pt",
).strip() or "yolov8n-weapons.pt"
_DEV_STR, _, _ = resolve_compute_device()
if _TRACKER_TYPE == "botsort" or (_TRACKER_TYPE == "auto" and _DEV_STR.startswith("cuda")):
    _DEFAULT_TRACKER = _BOTSORT_CFG if os.path.exists(_BOTSORT_CFG) else _BYTETRACK_CFG
else:
    _DEFAULT_TRACKER = _BYTETRACK_CFG if os.path.exists(_BYTETRACK_CFG) else "bytetrack.yaml"
TRACKER_CONFIG = os.getenv("TRACKER_CONFIG", _DEFAULT_TRACKER)
# Apply CLAHE contrast enhancement when mean luminance falls below this
LOW_LIGHT_LUMA = float(os.getenv("LOW_LIGHT_LUMA", "65"))
# Skip AI on frames that are corrupted / blank (grey/green H.264 glitch)
CORRUPT_FRAME_MIN_STD = 4.0
# Person detection confidence (bags use BAGGAGE_CONF_FLOOR in the same pass)
PERSON_CONF = float(os.getenv("PERSON_CONF", "0.35"))

# --- Vehicle motion compensation ---
# Common-mode passenger motion above this (px/s @720p) = bus jolt/braking
JOLT_COMMON_MODE_PX_S = 140.0
# Background (camera-shake) flow above this (px/s @720p) = vibration jolt
JOLT_CAMERA_SHAKE_PX_S = 90.0
# Suppression window after a jolt is detected (seconds)
JOLT_HOLD_S = 1.5

INCIDENT_COOLDOWN_S = float(os.getenv("INCIDENT_COOLDOWN_S", "30.0"))
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
    yolo_model: str = DEFAULT_YOLO_MODEL
    pose_model: str = POSE_MODEL
    ffmpeg_bin: str = "ffmpeg"
    conf: float = YOLO_CONF_THRESHOLD
    mediamtx_rtsp_url: str = "rtsp://127.0.0.1:8554"
    weapon_model: str = DEFAULT_WEAPON_MODEL
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

        for name, value in (("conf", self.conf), ("weapon_conf", self.weapon_conf)):
            if not 0.0 < value <= 1.0:
                raise ValueError(f"{name} must be greater than 0 and at most 1")
        if not 0.0 <= self.face_tolerance <= 1.0:
            raise ValueError("face_tolerance must be between 0 and 1")
        if self.width < 1 or self.height < 1 or self.fps < 1:
            raise ValueError("width, height, and fps must be positive integers")
        if self.crowd_threshold < 1 or self.crowd_frames < 1:
            raise ValueError("crowd_threshold and crowd_frames must be positive integers")
