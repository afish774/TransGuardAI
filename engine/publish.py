import subprocess
import time
import random
import queue
import numpy as np
import cv2
from typing import Optional

from engine.config import EngineConfig, WORKER_HEARTBEAT_SECONDS
from engine.utils.queues import publish_health
from engine.utils.logging import configure_worker_logging, log

class MediaMTXPublisher:
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

def publisher_worker(cfg: EngineConfig, publish_queue, stop_event, health_queue) -> None:
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
                if stop_event.is_set():
                    break
                publisher.stop()
                publish_health(health_queue, "publisher", "DEGRADED", str(exc))
                wait_seconds = min(backoff, 10.0) * random.uniform(0.8, 1.2)
                log.warning("Publisher failed: %s; retrying in %.1fs", exc, wait_seconds)
                stop_event.wait(wait_seconds)
                backoff = min(backoff * 2.0, 10.0)
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        log.exception("Publisher worker failed")
    finally:
        publisher.stop()
        publish_health(health_queue, "publisher", "STOPPED")
