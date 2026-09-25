import time
import json
import hashlib
import hmac
import random
import queue
import requests
from collections import deque
from typing import Dict, List, Tuple

from engine.config import EngineConfig, MAX_PENDING_INCIDENTS, WATCHLIST_SYNC_SECONDS, EDGE_HEARTBEAT_SECONDS, HTTP_TIMEOUT_SECONDS, WORKER_HEARTBEAT_SECONDS
from engine.utils.queues import put_latest, publish_health
from engine.utils.logging import configure_worker_logging, log

def fetch_watchlist(session: requests.Session, cfg: EngineConfig) -> List[Dict[str, object]]:
    response = session.get(
        f"{cfg.backend_url}/api/watchlist",
        headers={"x-edge-api-key": cfg.api_key},
        timeout=HTTP_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    targets: List[Dict[str, object]] = []
    for target in response.json():
        url = target.get("url") or target.get("reference_image_url")
        if not url:
            continue
        if not url.startswith("http://") and not url.startswith("https://"):
            url = f"{cfg.backend_url.rstrip('/')}/{str(url).lstrip('/')}"
        try:
            image_response = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
            image_response.raise_for_status()
            targets.append({"name": target["name"], "image": image_response.content})
        except Exception as exc:
            log.warning("Failed to fetch image for watchlist target %s: %s", target.get("name"), exc)
    return targets

def sign_request_headers(api_key: str, body_str: str = "") -> Dict[str, str]:
    timestamp = str(int(time.time()))
    signature = hmac.new(
        api_key.encode(), f"{timestamp}{body_str}".encode(), hashlib.sha256
    ).hexdigest()
    return {"x-edge-timestamp": timestamp, "x-edge-signature": signature}

def incident_to_multipart(payload: Dict[str, object]) -> Tuple[Dict[str, str], Dict[str, Tuple[str, bytes, str]]]:
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
    base_headers = {"x-edge-api-key": cfg.api_key}
    pending: deque = deque(maxlen=MAX_PENDING_INCIDENTS)
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

            if now >= next_watchlist_sync:
                from engine.detectors.watchlist import FACE_BACKEND
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
                    hb_body = json.dumps({
                        "camera_id": cfg.camera_id, "status": status,
                        "fps": round(inference_fps.value, 2),
                        "capture_fps": round(capture_fps.value, 2),
                        "inference_fps": round(inference_fps.value, 2),
                    }, separators=(",", ":"))
                    hb_headers = {
                        **base_headers,
                        "Content-Type": "application/json",
                        **sign_request_headers(cfg.api_key, hb_body),
                    }
                    response = session.post(
                        f"{cfg.backend_url}/api/edge/heartbeat",
                        headers=hb_headers, data=hb_body,
                        timeout=HTTP_TIMEOUT_SECONDS,
                    )
                    response.raise_for_status()
                except Exception as exc:
                    log.warning("Heartbeat failed: %s", exc)
                next_edge_heartbeat = now + EDGE_HEARTBEAT_SECONDS

            if pending and now >= next_incident_attempt:
                try:
                    fields, files = incident_to_multipart(pending[0])
                    alert_headers = {**base_headers, **sign_request_headers(cfg.api_key)}
                    response = session.post(
                        f"{cfg.backend_url}/api/alerts", headers=alert_headers,
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
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        publish_health(health_queue, "telemetry", "FAILED", str(exc))
        log.exception("Telemetry worker failed")
        raise
    finally:
        session.close()
        publish_health(health_queue, "telemetry", "STOPPED")
