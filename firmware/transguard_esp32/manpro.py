import os
import cv2

# Force TCP transport so Wi-Fi packet drops do not cause 'No Signal'
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

IP = "192.168.18.45"
APP_PASSWORD = "YOUR_MANOMAYPRO_LOGIN_PASSWORD"  # If you set one in the app, put it here

# Tested candidates for XM / Manomay chipset (/ch0_0.264)
candidate_urls = [
    f"rtsp://{IP}:554/ch0_0.264",                          # No auth (Main stream)
    f"rtsp://admin:@{IP}:554/ch0_0.264",                   # Blank password (XM default)
    f"rtsp://admin:admin@{IP}:554/ch0_0.264",              # Default admin/admin
    f"rtsp://admin:123456@{IP}:554/ch0_0.264",             # Default admin/123456
    f"rtsp://admin:{APP_PASSWORD}@{IP}:554/ch0_0.264",     # App password
    f"rtsp://{IP}:554/ch0_1.264",                          # Sub stream (low latency)
    f"rtsp://admin:@{IP}:554/ch0_1.264",                   # Sub stream blank password
    f"rtsp://admin:{APP_PASSWORD}@{IP}:554/ch0_1.264",     # Sub stream with app password
]

working_url = None
cap = None

print(f"Connecting to Manomay M1078S at {IP}...")
for url in candidate_urls:
    print(f"Testing: {url}")
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    if cap.isOpened():
        ret, frame = cap.read()
        if ret and frame is not None:
            working_url = url
            print("\n" + "=" * 60)
            print(f"✅ [SUCCESS] STREAM ACTIVE & VERIFIED!")
            print(f"Exact Working URL: {working_url}")
            print(f"Resolution: {frame.shape[1]}x{frame.shape[0]}")
            print("=" * 60 + "\n")
            break
    cap.release()

if not working_url:
    print("\n❌ Could not connect automatically.")
    print("If you set a password in the ManomayPro app under PC View/ONVIF, update APP_PASSWORD on line 8.")
    exit(1)

print("Streaming live video. Press 'q' on the video window to exit.")
while True:
    ret, frame = cap.read()
    if not ret or frame is None:
        continue
    cv2.imshow("Manomay M1078S Live Stream (/ch0_0.264)", frame)
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()