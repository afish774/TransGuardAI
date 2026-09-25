import argparse
import multiprocessing as mp_process
import os
import queue
import signal
import sys
from typing import Dict

from engine.config import EngineConfig, FRAME_QUEUE_SIZE, INCIDENT_QUEUE_SIZE, CONTROL_QUEUE_SIZE
from engine.utils.logging import log

from engine.capture import capture_worker
from engine.publish import publisher_worker
from engine.telemetry import telemetry_worker
from engine.inference import inference_worker

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

class TransGuardEngine:
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
        
        # Handle graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

    def _signal_handler(self, sig, frame):
        log.info("Shutdown signal received. Shutting down gracefully...")
        self.stop()

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
        except KeyboardInterrupt:
            self.stop()
        finally:
            log.info("Cleaning up processes...")
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
            log.info("Engine shutdown complete.")

def parse_args() -> EngineConfig:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rtsp", default=os.getenv("RTSP_URL", "rtsp://127.0.0.1:8554/cam0"))
    parser.add_argument("--url", default=None, help="Backward-compatible alias for --rtsp")
    parser.add_argument("--camera", default=os.getenv("CAMERA_ID", "cam0"))
    parser.add_argument("--backend-url", "--backend", dest="backend_url", default=os.getenv("BACKEND_URL", "http://127.0.0.1:5000"))
    parser.add_argument("--api-key", default=os.getenv("EDGE_API_KEY", "transguard-edge-secret-key-9042"))
    parser.add_argument("--width", type=int, default=int(os.getenv("FRAME_WIDTH", "1280")))
    parser.add_argument("--height", type=int, default=int(os.getenv("FRAME_HEIGHT", "720")))
    parser.add_argument("--fps", type=int, default=int(os.getenv("FRAME_FPS", "25")))
    parser.add_argument("--model", default=os.getenv("YOLO_MODEL", "yolov8n.pt"))
    parser.add_argument("--ffmpeg", default=os.getenv("FFMPEG_BIN", "ffmpeg"))
    parser.add_argument("--conf", type=float, default=float(os.getenv("YOLO_CONF", "0.30")))
    parser.add_argument("--headless", action="store_true", help="Retained for compatibility; the engine is always headless")
    parser.add_argument("--weapon-model", default=os.getenv("WEAPON_MODEL", "yolov8n-weapons.pt"))
    parser.add_argument("--weapon-conf", type=float, default=float(os.getenv("WEAPON_CONF", "0.20")))
    parser.add_argument("--face-tolerance", type=float, default=float(os.getenv("FACE_MATCH_TOLERANCE", "0.60")))
    parser.add_argument("--vehicle-id", default=os.getenv("VEHICLE_ID", "BUS_001"))
    parser.add_argument("--mediamtx-rtsp", default=os.getenv("MEDIAMTX_RTSP_URL", "rtsp://127.0.0.1:8554"))
    parser.add_argument("--crowd-threshold", type=int, default=int(os.getenv("CROWD_THRESHOLD", "8")))
    parser.add_argument("--crowd-frames", type=int, default=int(os.getenv("CROWD_FRAMES", "15")))
    parser.add_argument("--lat", type=float, default=float(os.getenv("FALLBACK_LAT", "10.5898")))
    parser.add_argument("--lon", type=float, default=float(os.getenv("FALLBACK_LON", "76.0116")))
    
    args = parser.parse_args()
    return EngineConfig(
        rtsp_url=args.url if args.url else args.rtsp,
        backend_url=args.backend_url,
        camera_id=args.camera,
        api_key=args.api_key,
        width=args.width,
        height=args.height,
        fps=args.fps,
        yolo_model=args.model,
        ffmpeg_bin=args.ffmpeg,
        conf=args.conf,
        mediamtx_rtsp_url=args.mediamtx_rtsp,
        weapon_model=args.weapon_model,
        weapon_conf=args.weapon_conf,
        face_tolerance=args.face_tolerance,
        crowd_threshold=args.crowd_threshold,
        crowd_frames=args.crowd_frames,
        lat=args.lat,
        lon=args.lon,
        vehicle_id=args.vehicle_id,
    )

def main():
    cfg = parse_args()
    engine = TransGuardEngine(cfg)
    engine.run()

if __name__ == "__main__":
    main()
