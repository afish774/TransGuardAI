#!/bin/sh
# ==========================================
# Trans Guard AI — Edge Engine Entrypoint
# ==========================================
# Starts MediaMTX (RTSP/WebRTC server) in the background,
# then launches the Python edge engine in the foreground.
# Handles SIGTERM/SIGINT for graceful container shutdown.

set -e

echo "============================================"
echo " Trans Guard AI — Edge Engine Container"
echo "============================================"
echo " Camera ID : ${CAMERA_ID}"
echo " RTSP URL  : ${RTSP_URL}"
echo " Backend   : ${BACKEND_URL}"
echo " Resolution: ${FRAME_WIDTH}x${FRAME_HEIGHT}@${FRAME_FPS}fps"
echo " YOLO Model: ${YOLO_MODEL}"
echo "============================================"

# --- Start MediaMTX in the background ---
# MediaMTX provides RTSP → WebRTC/HLS transcoding so the
# dashboard can view the annotated video stream in-browser.
if command -v mediamtx > /dev/null 2>&1; then
    echo "[entrypoint] Starting MediaMTX RTSP server..."
    mediamtx &
    MEDIAMTX_PID=$!
    # Give it a moment to bind ports
    sleep 1
    echo "[entrypoint] MediaMTX started (pid=${MEDIAMTX_PID})"
else
    echo "[entrypoint] WARNING: MediaMTX not found, skipping RTSP re-publish"
    MEDIAMTX_PID=""
fi

# --- Graceful shutdown handler ---
cleanup() {
    echo "[entrypoint] Shutting down..."
    # The Python engine catches SIGTERM and shuts down workers
    if [ -n "${ENGINE_PID}" ]; then
        kill -TERM "${ENGINE_PID}" 2>/dev/null || true
        wait "${ENGINE_PID}" 2>/dev/null || true
    fi
    if [ -n "${MEDIAMTX_PID}" ]; then
        kill -TERM "${MEDIAMTX_PID}" 2>/dev/null || true
        wait "${MEDIAMTX_PID}" 2>/dev/null || true
    fi
    echo "[entrypoint] Cleanup complete"
    exit 0
}

trap cleanup TERM INT

# --- Launch the edge engine ---
echo "[entrypoint] Starting Trans Guard AI engine..."
python trans_guard_engine.py \
    --rtsp "${RTSP_URL}" \
    --camera "${CAMERA_ID}" \
    --backend-url "${BACKEND_URL}" \
    --api-key "${EDGE_API_KEY}" \
    --width "${FRAME_WIDTH}" \
    --height "${FRAME_HEIGHT}" \
    --fps "${FRAME_FPS}" \
    --model "${YOLO_MODEL}" \
    --conf "${YOLO_CONF}" \
    --weapon-model "${WEAPON_MODEL}" \
    --mediamtx-rtsp "${MEDIAMTX_RTSP_URL}" \
    --headless \
    "$@" &

ENGINE_PID=$!
echo "[entrypoint] Engine started (pid=${ENGINE_PID})"

# Wait for the engine process — if it exits, the container exits
wait "${ENGINE_PID}"
EXIT_CODE=$?

# Cleanup MediaMTX on engine exit
if [ -n "${MEDIAMTX_PID}" ]; then
    kill -TERM "${MEDIAMTX_PID}" 2>/dev/null || true
fi

exit ${EXIT_CODE}
