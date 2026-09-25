import sys
import time
import random
import subprocess
import threading
from collections import deque
from typing import Optional, Deque
import cv2
import numpy as np

from engine.config import EngineConfig, WORKER_HEARTBEAT_SECONDS
from engine.utils.queues import put_latest, publish_health
from engine.utils.logging import configure_worker_logging, log

class OpenCVWebcamSource:
    """Direct OpenCV VideoCapture for local USB/integrated webcams."""
    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        self.device_index = int(cfg.rtsp_url.strip())
        self.cap: Optional[cv2.VideoCapture] = None

    def start(self) -> None:
        self.stop()
        backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
        self.cap = cv2.VideoCapture(self.device_index, backend)
        if not self.cap.isOpened():
            self.cap = cv2.VideoCapture(self.device_index)
        if not self.cap.isOpened():
            raise RuntimeError(f"Could not open webcam device index {self.device_index}")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.cfg.width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.cfg.height)
        self.cap.set(cv2.CAP_PROP_FPS, self.cfg.fps)

    def read_frame(self) -> Optional[np.ndarray]:
        if self.cap is None or not self.cap.isOpened():
            return None
        ok, frame = self.cap.read()
        if not ok or frame is None:
            return None
        if frame.shape[1] != self.cfg.width or frame.shape[0] != self.cfg.height:
            frame = cv2.resize(frame, (self.cfg.width, self.cfg.height))
        return frame

    def get_last_error(self) -> str:
        return f"Webcam device {self.device_index} read error"

    def stop(self) -> None:
        if self.cap is not None:
            self.cap.release()
            self.cap = None

class FFmpegSource:
    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        self.proc: Optional[subprocess.Popen] = None
        self.frame_size = cfg.width * cfg.height * 3
        self.stderr_lines: Deque[str] = deque(maxlen=10)
        self.drain_thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self.stop()
        self.stderr_lines.clear()
        command = [
            self.cfg.ffmpeg_bin,
            "-hide_banner",
            "-loglevel", "warning",
        ]
        if self.cfg.rtsp_url.startswith("rtsp://") or self.cfg.rtsp_url.startswith("rtsps://"):
            command.extend([
                "-rtsp_transport", "tcp",
                "-timeout", "5000000",
            ])
        command.extend([
            "-i", self.cfg.rtsp_url,
            "-an",
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{self.cfg.width}x{self.cfg.height}",
            "-r", str(self.cfg.fps),
            "pipe:1",
        ])
        self.proc = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=10 ** 8,
        )

        def _drain_stderr():
            if self.proc and self.proc.stderr:
                try:
                    for line in iter(self.proc.stderr.readline, b""):
                        if line:
                            decoded = line.decode("utf-8", errors="replace").strip()
                            if decoded:
                                self.stderr_lines.append(decoded)
                except Exception:
                    pass

        self.drain_thread = threading.Thread(target=_drain_stderr, daemon=True)
        self.drain_thread.start()

    def get_last_error(self) -> str:
        if self.stderr_lines:
            return "; ".join(list(self.stderr_lines)[-3:])
        if self.proc and self.proc.poll() is not None:
            return f"FFmpeg process exited (code {self.proc.returncode})"
        return ""

    def read_frame(self) -> Optional[np.ndarray]:
        if self.proc is None or self.proc.stdout is None:
            return None
        chunks = []
        bytes_read = 0
        while bytes_read < self.frame_size:
            chunk = self.proc.stdout.read(self.frame_size - bytes_read)
            if not chunk:
                break
            chunks.append(chunk)
            bytes_read += len(chunk)

        raw = b"".join(chunks)
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
        self.drain_thread = None

def capture_worker(cfg: EngineConfig, frame_queue, stop_event, health_queue, capture_fps, last_capture_time) -> None:
    configure_worker_logging()
    source = OpenCVWebcamSource(cfg) if cfg.rtsp_url.strip().isdigit() else FFmpegSource(cfg)
    backoff = 2.0
    frame_count = 0
    rate_window = time.monotonic()
    last_health = 0.0
    first_frame_logged = False
    
    # Graceful shutdown flag logic to prevent traceback
    try:
        while not stop_event.is_set():
            try:
                publish_health(health_queue, "capture", "CONNECTING")
                source.start()
                is_online = False
                while not stop_event.is_set():
                    frame = source.read_frame()
                    if frame is None:
                        err_detail = source.get_last_error()
                        if err_detail:
                            raise RuntimeError(f"FFmpeg error: {err_detail}")
                        raise RuntimeError("FFmpeg stream ended or camera unreachable")

                    if not is_online:
                        is_online = True
                        backoff = 2.0
                        publish_health(health_queue, "capture", "ONLINE")
                        if not first_frame_logged:
                            log.info("Capture online: receiving %dx%d frames from %s", cfg.width, cfg.height, cfg.rtsp_url)
                            first_frame_logged = True

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
                if stop_event.is_set():
                    break
                source.stop()
                publish_health(health_queue, "capture", "DEGRADED", str(exc))
                wait_seconds = min(backoff, 30.0) * random.uniform(0.9, 1.1)
                log.warning("Capture unavailable: %s; retrying in %.1fs", exc, wait_seconds)
                stop_event.wait(wait_seconds)
                backoff = min(backoff * 1.5, 30.0)
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        log.exception("Capture worker failed")
    finally:
        source.stop()
        capture_fps.value = 0.0
        publish_health(health_queue, "capture", "STOPPED")
