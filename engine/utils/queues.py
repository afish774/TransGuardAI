import queue
import time

def put_latest(destination, item) -> None:
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
