import logging

LOG_FORMAT = "[%(asctime)s] [%(processName)s] [%(levelname)s] %(message)s"

def configure_worker_logging() -> None:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt="%H:%M:%S", force=True)

logging.basicConfig(level=logging.INFO, format=LOG_FORMAT, datefmt="%H:%M:%S")
log = logging.getLogger("trans-guard-engine")
