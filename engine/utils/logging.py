import logging
import os

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

LOG_FORMAT = "[%(asctime)s] [%(processName)s] [%(levelname)s] %(message)s"

def configure_worker_logging() -> None:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt="%H:%M:%S", force=True)
    # Silence verbose third-party HTTPX/HuggingFace request chatter
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt="%H:%M:%S")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
log = logging.getLogger("trans-guard-engine")
