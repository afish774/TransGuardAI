"""Comprehensive regression & accuracy test suite for TransGuard AI upgrades.

Covers:
  - Scene pre-processing (corrupt frame gate, adaptive CLAHE, ROI polygon,
    VehicleMotionEstimator jolt detection, HSV appearance Re-ID)
  - Baggage Zero-Trust appearance-verified owner recovery & shape filtering
  - Pose signed torso inclination, standing height reference, jolt & seat-zone gating
  - Weapon margin-based CLIP verification, multi-frame minimum, same-frame dedup
  - Violence global bus-motion subtraction, jolt freeze, parallel-walk rejection
  - Watchlist size/sharpness quality gate, 2-frame consensus, non-match backoff
  - Inference raw_frame immutability (display overlays never contaminate AI models)
"""

import os
import queue
import sys
import unittest
from unittest.mock import MagicMock

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.config import (  # noqa: E402
    BAGGAGE_STATIONARY_SECONDS,
    FACE_MIN_SIZE,
    FALL_CONFIRM_FRAMES,
    EngineConfig,
)
from engine.detectors.baggage import BaggageDetector  # noqa: E402
from engine.detectors.crowd import CrowdDetector  # noqa: E402
from engine.detectors.pose import PoseEngine  # noqa: E402
from engine.detectors.violence import ViolenceDetector  # noqa: E402
from engine.detectors.watchlist import Watchlist, compute_sharpness  # noqa: E402
from engine.detectors.weapon import WeaponDetector  # noqa: E402
from engine.utils.scene import (  # noqa: E402
    VehicleMotionEstimator,
    enhance_low_light,
    extract_appearance_hist,
    hist_similarity,
    is_corrupt_frame,
    parse_roi_polygon,
    point_in_roi,
)


def _make_textured_frame(h=360, w=640, base_val=120):
    rng = np.random.default_rng(42)
    img = rng.integers(max(0, base_val - 30), min(255, base_val + 30), size=(h, w, 3), dtype=np.uint8)
    cv2.rectangle(img, (50, 50), (200, 250), (20, 180, 220), -1)
    cv2.line(img, (0, 0), (w - 1, h - 1), (255, 255, 255), 2)
    return img


class TestScenePreprocessing(unittest.TestCase):
    def test_corrupt_frame_gate(self):
        blank = np.full((360, 640, 3), 128, dtype=np.uint8)
        self.assertTrue(is_corrupt_frame(blank))
        self.assertTrue(is_corrupt_frame(None))
        good = _make_textured_frame()
        self.assertFalse(is_corrupt_frame(good))

    def test_adaptive_low_light_clahe(self):
        bright = _make_textured_frame(base_val=140)
        out_bright = enhance_low_light(bright)
        self.assertIs(out_bright, bright, "Daylight frame must be returned without copying")

        dark = _make_textured_frame(base_val=25)
        out_dark = enhance_low_light(dark)
        self.assertIsNot(out_dark, dark)
        self.assertGreater(float(out_dark.mean()), float(dark.mean()))

    def test_roi_polygon_filtering(self):
        poly = parse_roi_polygon("0.1,0.2;0.9,0.2;0.9,0.9;0.1,0.9", 1000, 1000)
        self.assertIsNotNone(poly)
        self.assertTrue(point_in_roi((500, 500), poly))
        self.assertFalse(point_in_roi((50, 500), poly))   # outside left window
        self.assertFalse(point_in_roi((500, 100), poly))  # above interior ceiling

    def test_vehicle_motion_detects_braking_jolt(self):
        est = VehicleMotionEstimator()
        est.calibrate(720)
        # 3 passengers all shifting right by 40px in 0.1s = 400 px/s (> 140 threshold)
        p_t0 = [(1, (100, 100, 160, 300)), (2, (250, 100, 310, 300)), (3, (400, 100, 460, 300))]
        p_t1 = [(1, (140, 100, 200, 300)), (2, (290, 100, 350, 300)), (3, (440, 100, 500, 300))]
        _, jolt0 = est.update(None, p_t0, 1.0)
        self.assertFalse(jolt0)
        gvel, jolt1 = est.update(None, p_t1, 1.1)
        self.assertTrue(jolt1, "Collective passenger sway must trigger jolt damping")
        self.assertGreater(gvel[0], 300.0)

    def test_appearance_histogram_discriminates_clothing(self):
        frame = np.zeros((400, 600, 3), dtype=np.uint8)
        # Person A: bright red shirt + blue jeans
        cv2.rectangle(frame, (50, 50), (150, 175), (20, 20, 220), -1)
        cv2.rectangle(frame, (50, 175), (150, 300), (220, 40, 20), -1)
        # Person A copy (slightly shifted): same outfit
        cv2.rectangle(frame, (200, 55), (300, 180), (25, 25, 215), -1)
        cv2.rectangle(frame, (200, 180), (300, 305), (215, 45, 25), -1)
        # Person B: bright green outfit
        cv2.rectangle(frame, (380, 50), (480, 300), (30, 220, 30), -1)

        h_a1 = extract_appearance_hist(frame, (50, 50, 150, 300))
        h_a2 = extract_appearance_hist(frame, (200, 55, 300, 305))
        h_b = extract_appearance_hist(frame, (380, 50, 480, 300))
        self.assertGreater(hist_similarity(h_a1, h_a2), 0.90)
        self.assertLess(hist_similarity(h_a1, h_b), 0.25)


class TestBaggageAppearanceZeroTrust(unittest.TestCase):
    def test_different_person_cannot_hijack_custody_even_with_frame(self):
        frame_owner = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.rectangle(frame_owner, (90, 50), (200, 250), (20, 20, 220), -1)  # Red outfit

        frame_stranger = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.rectangle(frame_stranger, (90, 50), (200, 250), (20, 220, 20), -1)  # Green outfit

        det = BaggageDetector()
        bags = [(10, "backpack", (100, 100, 150, 150))]
        t = 1000.0
        det.update(bags, [(1, (90, 50, 200, 250))], t, frame=frame_owner)

        alerts = []
        for i in range(1, int(BAGGAGE_STATIONARY_SECONDS) + 4):
            alerts = det.update(bags, [(2, (90, 50, 200, 250))], t + i, frame=frame_stranger)
        self.assertTrue(alerts, "Different-looking stranger must NOT reset unattended timer")

    def test_same_owner_recovers_custody_across_tracker_glitch(self):
        frame_owner = np.zeros((400, 400, 3), dtype=np.uint8)
        cv2.rectangle(frame_owner, (90, 50), (200, 250), (20, 20, 220), -1)  # Red outfit

        det = BaggageDetector()
        bags = [(10, "backpack", (100, 100, 150, 150))]
        t = 1000.0
        det.update(bags, [(1, (90, 50, 200, 250))], t, frame=frame_owner)

        # Tracker changes owner ID 1 -> 99 in-place with identical clothing
        for i in range(1, int(BAGGAGE_STATIONARY_SECONDS) + 4):
            alerts = det.update(bags, [(99, (92, 50, 202, 250))], t + i, frame=frame_owner)
            self.assertEqual(alerts, [], "Visual Re-ID should recover legitimate owner across ID drop")

    def test_rejects_thin_sliver_handrail_artifact(self):
        det = BaggageDetector()
        sliver = [(5, "handbag", (100, 100, 300, 130))]  # aspect 6.67 > 4.5
        det.update(sliver, [], 1000.0)
        self.assertNotIn(5, det.cache)


class TestPoseUpgrades(unittest.TestCase):
    def _make_engine(self):
        eng = PoseEngine.__new__(PoseEngine)
        eng.pose = object()
        eng._pose_landmark = None
        eng._yolo_pose = None
        eng.fall_streaks = {}
        eng._prev_centroid = {}
        eng._velocity_spike = {}
        eng._standing_height = {}
        eng._scale = 1.0
        return eng

    def test_signed_torso_angle_distinguishes_upright_flat_inverted(self):
        eng = self._make_engine()
        upright = {
            "LEFT_SHOULDER": (40, 50, 0.9), "RIGHT_SHOULDER": (60, 50, 0.9),
            "LEFT_HIP": (40, 150, 0.9), "RIGHT_HIP": (60, 150, 0.9),
        }
        flat = {
            "LEFT_SHOULDER": (40, 100, 0.9), "RIGHT_SHOULDER": (40, 110, 0.9),
            "LEFT_HIP": (140, 100, 0.9), "RIGHT_HIP": (140, 110, 0.9),
        }
        inverted = {
            "LEFT_SHOULDER": (40, 150, 0.9), "RIGHT_SHOULDER": (60, 150, 0.9),
            "LEFT_HIP": (40, 50, 0.9), "RIGHT_HIP": (60, 50, 0.9),
        }
        self.assertLess(eng._torso_angle_deg(upright), 5.0)
        self.assertAlmostEqual(eng._torso_angle_deg(flat), 90.0, delta=1.0)
        self.assertGreater(eng._torso_angle_deg(inverted), 170.0)

    def test_jolt_suppresses_occluded_velocity_spike_fall(self):
        eng = self._make_engine()
        # Simulate sudden downward bbox shift during bus pothole jolt with no skeleton
        eng.is_fall(1, (100, 100, 260, 180), None, now=1.0, is_jolt=True)
        for i in range(1, FALL_CONFIRM_FRAMES + 5):
            y_shift = 200 if i == 1 else 200
            fired = eng.is_fall(1, (100, y_shift, 260, y_shift + 80), None, now=1.0 + i * 0.1, is_jolt=(i == 1))
            self.assertFalse(fired, "Jolt-induced velocity spike must not trigger occluded fall")

    def test_standing_height_reference_blocks_uncollapsed_wide_box(self):
        eng = self._make_engine()
        upright_pts = {
            "NOSE": (50, 20, 0.9),
            "LEFT_SHOULDER": (40, 50, 0.9), "RIGHT_SHOULDER": (60, 50, 0.9),
            "LEFT_HIP": (40, 150, 0.9), "RIGHT_HIP": (60, 150, 0.9),
        }
        # Establish standing height H_0 = 200
        eng.is_fall(1, (100, 50, 180, 250), upright_pts, now=1.0)
        # Wide box (arms/bag outstretched) STILL at height 170 (> 0.75 * 200 = 150)
        flat_pts = {
            "NOSE": (50, 100, 0.9),
            "LEFT_SHOULDER": (40, 100, 0.9), "RIGHT_SHOULDER": (60, 100, 0.9),
            "LEFT_HIP": (140, 100, 0.9), "RIGHT_HIP": (160, 100, 0.9),
        }
        for i in range(FALL_CONFIRM_FRAMES + 5):
            self.assertFalse(eng.is_fall(1, (100, 50, 350, 220), flat_pts, now=2.0 + i * 0.1))


class TestWeaponUpgrades(unittest.TestCase):
    def _make_detector(self, clip_fn=None):
        det = WeaponDetector.__new__(WeaponDetector)
        det.model = None
        det.conf = 0.42
        det.names = {}
        det.streaks = {}
        det.streak_last_seen = {}
        det._spatial_streaks = []
        det._scan_count = 0
        det._frame_index = 0
        det._scale = 1.0
        det.clip = clip_fn
        det._clip_executor = None
        return det

    def test_clip_margin_rejects_ambiguous_tie_and_accepts_clear_win(self):
        crop = _make_textured_frame(60, 60)

        # Ambiguous tie: weapon 0.30 vs phone 0.27 (margin 0.03 < 0.08) -> REJECT
        det_tie = self._make_detector(
            clip_fn=lambda _img, candidate_labels: [
                {"label": candidate_labels[0], "score": 0.30},
                {"label": candidate_labels[2], "score": 0.27},
            ]
        )
        self.assertFalse(det_tie._verify_with_clip(crop, "gun"))

        # Clear win: weapon 0.48 vs phone 0.18 (margin 0.30 >= 0.08) -> PASS
        det_win = self._make_detector(
            clip_fn=lambda _img, candidate_labels: [
                {"label": candidate_labels[0], "score": 0.48},
                {"label": candidate_labels[2], "score": 0.18},
            ]
        )
        self.assertTrue(det_win._verify_with_clip(crop, "gun"))

    def test_clip_exception_fails_closed(self):
        def boom(_img, candidate_labels):
            raise RuntimeError("CLIP OOM")

        det = self._make_detector(clip_fn=boom)
        self.assertFalse(det._verify_with_clip(_make_textured_frame(60, 60), "knife"))

    def test_high_conf_never_fires_on_single_frame(self):
        det = self._make_detector(clip_fn=None)
        frame = _make_textured_frame(360, 640)
        # Frame 1 with 0.95 conf must NOT fire immediately
        det._frame_index = 1
        hit1 = det.verify_candidate(1, "gun", 0.95, (100, 100, 180, 180), frame, now=1.0, sync_clip=True)
        self.assertIsNone(hit1, "Even 0.95 confidence must not fire on a single frame")
        # Duplicate observation in the SAME frame must still not fire
        hit1_dup = det.verify_candidate(1, "gun", 0.95, (102, 100, 182, 180), frame, now=1.01, sync_clip=True)
        self.assertIsNone(hit1_dup, "Same-frame duplicate crop must not double-count streak")
        # Frame 2 confirms
        det._frame_index = 2
        hit2 = det.verify_candidate(1, "gun", 0.95, (102, 100, 182, 180), frame, now=1.05, sync_clip=True)
        self.assertIsNotNone(hit2)


class TestViolenceMotionCompensation(unittest.TestCase):
    def test_global_bus_sway_subtracted_from_wrist_and_body(self):
        det = ViolenceDetector()
        # Two passengers standing close, both shifted 50px right every 0.1s (=500 px/s)
        # because the bus is turning/braking; global_vel = (500, 0).
        for i in range(15):
            dx = i * 50
            persons = [
                (1, (100 + dx, 100, 200 + dx, 300)),
                (2, (150 + dx, 100, 250 + dx, 300)),
            ]
            pts1 = {"LEFT_WRIST": (150.0 + dx, 180.0, 0.9), "RIGHT_WRIST": (160.0 + dx, 180.0, 0.9)}
            spd1 = det.wrist_speed(1, pts1, i * 0.1, global_vel=(500.0, 0.0))
            self.assertAlmostEqual(spd1, 0.0, delta=1e-3)
            events = det.evaluate(persons, {1: spd1, 2: 0.0}, i * 0.1, global_vel=(500.0, 0.0), is_jolt=False)
            self.assertEqual(events, [])

    def test_jolt_flag_freezes_violence_alerts(self):
        det = ViolenceDetector()
        persons = [(1, (0, 0, 100, 200)), (2, (50, 0, 150, 200))]
        det._kinetic_ema[1] = 1000.0
        for i in range(15):
            events = det.evaluate(persons, {1: 1000.0, 2: 0.0}, i * 0.1, is_jolt=True)
            self.assertEqual(events, [], "Vehicle jolt must freeze violence streak")


class TestWatchlistQualityAndConsensus(unittest.TestCase):
    def test_sharpness_and_size_quality_filter(self):
        wl = Watchlist(0.50)
        blurry = np.full((200, 200, 3), 120, dtype=np.uint8)
        self.assertLess(compute_sharpness(blurry), 1.0)
        self.assertEqual(wl._filter_quality_locs(blurry, [(10, 150, 150, 10)]), [])

        sharp = _make_textured_frame(200, 200)
        # Too small (< FACE_MIN_SIZE) -> rejected
        tiny = FACE_MIN_SIZE - 10
        self.assertEqual(wl._filter_quality_locs(sharp, [(10, 10 + tiny, 10 + tiny, 10)]), [])
        # Large + sharp -> accepted
        valid = wl._filter_quality_locs(sharp, [(10, 140, 140, 10)])
        self.assertEqual(len(valid), 1)

    def test_two_frame_consensus_and_backoff(self):
        wl = Watchlist(0.50)
        self.assertFalse(wl._record_consensus("Suspect_X", track_id=7, now=10.0))
        self.assertTrue(wl.has_pending_hit(7, now=10.5))
        # Pending hit rescans rapidly (0.35s)
        self.assertFalse(wl.should_skip_scan(7, crop_quality=500.0, last_scan_ts=10.0, now=10.4))
        # 2nd hit confirms
        self.assertTrue(wl._record_consensus("Suspect_X", track_id=7, now=10.5))

        # Non-match backoff skips re-encoding for 4s unless quality improves > 1.35x
        wl._non_match_meta[8] = (500.0, 20.0)
        self.assertTrue(wl.should_skip_scan(8, crop_quality=550.0, last_scan_ts=20.0, now=22.0))
        self.assertFalse(wl.should_skip_scan(8, crop_quality=800.0, last_scan_ts=20.0, now=22.0))


class TestRawFrameImmutability(unittest.TestCase):
    def test_process_frame_does_not_mutate_input_raw_frame(self):
        from engine.inference import IncidentProcessor

        proc = IncidentProcessor.__new__(IncidentProcessor)
        proc.cfg = EngineConfig()
        proc.incident_queue = queue.Queue(maxsize=16)

        # Mock YOLO result with one person box
        mock_box = MagicMock()
        mock_box.cls = [0]
        mock_box.conf = [0.90]
        mock_box.xyxy = [MagicMock(tolist=lambda: [100, 100, 220, 340])]

        mock_boxes = MagicMock()
        mock_boxes.__len__.return_value = 1
        mock_boxes.__iter__.return_value = iter([mock_box])
        mock_boxes.id = MagicMock(tolist=lambda: [1])

        mock_res = MagicMock()
        mock_res.boxes = mock_boxes

        proc.model = MagicMock()
        proc.model.names = {0: "person"}
        proc.model.track.return_value = [mock_res]

        proc.pose = PoseEngine.__new__(PoseEngine)
        proc.pose.pose = None
        proc.pose._yolo_pose = None
        proc.pose._pose_landmark = None
        proc.pose.fall_streaks = {}
        proc.pose._prev_centroid = {}
        proc.pose._velocity_spike = {}
        proc.pose._standing_height = {}
        proc.pose._scale = 1.0
        proc.fall = proc.pose

        proc.weapons = WeaponDetector.__new__(WeaponDetector)
        proc.weapons.model = None
        proc.weapons.clip = None
        proc.weapons._clip_executor = None
        proc.weapons._spatial_streaks = []
        proc.weapons.streaks = {}
        proc.weapons.streak_last_seen = {}
        proc.weapons._scan_count = 0
        proc.weapons._frame_index = 0
        proc.weapons._scale = 1.0

        proc.violence = ViolenceDetector()
        proc.crowd = CrowdDetector()
        proc.watchlist = Watchlist()
        proc.baggage = BaggageDetector()
        proc.motion = VehicleMotionEstimator()
        proc.incident_cache = {}
        proc.identity_cache = {}
        proc.face_scan_times = {}
        proc._last_frame_face_scan = 0.0
        proc._face_executor = None
        proc._pending_face_jobs = {}
        proc._pending_full_face_job = None
        proc._recent_violence = {}
        proc._recent_weapons = {}
        proc._recent_falls = {}
        proc._calibrated = False
        proc._roi_polygon = None
        proc._seat_polygons = []

        raw = _make_textured_frame(360, 640)
        original_bytes = raw.tobytes()

        display = proc.process_frame(raw)

        # Input raw_frame must be 100% untouched (zero OpenCV overlays leaked into it)
        self.assertEqual(raw.tobytes(), original_bytes, "raw_frame was mutated in-place!")
        # Returned display_frame MUST differ because overlays were drawn onto it
        self.assertNotEqual(display.tobytes(), original_bytes, "display_frame should contain overlays")


class TestSigLIPAndStage2ViolenceVLM(unittest.TestCase):
    def test_siglip_weapon_sigmoid_scoring_passes_clear_and_rejects_weak(self):
        from engine.detectors.vlm_verifier import VisionLanguageVerifier

        crop = _make_textured_frame(80, 80)
        # SigLIP real CCTV knife: modest sigmoid 0.22 vs tiny phone 0.005 -> PASS
        vlm_pass = VisionLanguageVerifier(
            preferred_model="google/siglip-base-patch16-224",
            pipe_override=lambda _img, candidate_labels: [
                {"label": candidate_labels[0], "score": 0.22},
                {"label": candidate_labels[2], "score": 0.005},
            ],
            is_siglip_override=True,
        )
        self.assertTrue(vlm_pass.verify_weapon(crop, "knife"))

        # SigLIP false positive smartphone: phone 0.65 vs knife 0.02 -> REJECT
        vlm_reject = VisionLanguageVerifier(
            preferred_model="google/siglip-base-patch16-224",
            pipe_override=lambda _img, candidate_labels: [
                {"label": candidate_labels[2], "score": 0.65},
                {"label": candidate_labels[0], "score": 0.02},
            ],
            is_siglip_override=True,
        )
        self.assertFalse(vlm_reject.verify_weapon(crop, "knife"))

        # SigLIP ambiguous tie: knife 0.14 vs phone 0.11 (ratio < 1.5, margin < 0.06) -> REJECT
        vlm_tie = VisionLanguageVerifier(
            preferred_model="google/siglip-base-patch16-224",
            pipe_override=lambda _img, candidate_labels: [
                {"label": candidate_labels[0], "score": 0.14},
                {"label": candidate_labels[2], "score": 0.11},
            ],
            is_siglip_override=True,
        )
        self.assertFalse(vlm_tie.verify_weapon(crop, "knife"))

    def test_stage2_vlm_suppresses_hugging_and_confirms_real_fight(self):
        from engine.detectors.vlm_verifier import (
            VIOLENCE_NEGATIVE_PROMPTS,
            VIOLENCE_POSITIVE_PROMPTS,
            VisionLanguageVerifier,
        )

        frame = _make_textured_frame(360, 640)
        persons = [(1, (100, 80, 200, 300)), (2, (150, 80, 250, 300))]

        # 1. VLM sees hugging / calm conversation -> MUST suppress kinematic alert
        vlm_calm = VisionLanguageVerifier(
            preferred_model="google/siglip-base-patch16-224",
            pipe_override=lambda _img, candidate_labels: [
                {"label": VIOLENCE_NEGATIVE_PROMPTS[2], "score": 0.72},
                {"label": VIOLENCE_POSITIVE_PROMPTS[0], "score": 0.03},
            ],
            is_siglip_override=True,
        )
        det_calm = ViolenceDetector(vlm=vlm_calm)
        det_calm._kinetic_ema[1] = 1000.0
        for i in range(12):
            events = det_calm.evaluate(
                persons, {1: 1000.0, 2: 0.0}, i * 0.1, frame=frame, sync_vlm=True
            )
            self.assertEqual(events, [], "Stage-2 VLM must suppress hugging/calm false violence")

        # 2. VLM sees real fight/punching -> MUST confirm violence
        vlm_fight = VisionLanguageVerifier(
            preferred_model="google/siglip-base-patch16-224",
            pipe_override=lambda _img, candidate_labels: [
                {"label": VIOLENCE_POSITIVE_PROMPTS[0], "score": 0.42},
                {"label": VIOLENCE_NEGATIVE_PROMPTS[0], "score": 0.04},
            ],
            is_siglip_override=True,
        )
        det_fight = ViolenceDetector(vlm=vlm_fight)
        det_fight._kinetic_ema[1] = 1000.0
        confirmed = []
        for i in range(10):
            confirmed.extend(
                det_fight.evaluate(
                    persons, {1: 1000.0, 2: 0.0}, i * 0.1, frame=frame, sync_vlm=True
                )
            )
        self.assertTrue(confirmed, "Stage-2 VLM should confirm genuine visual fighting")


class TestInsightFaceAndMultiPhotoWatchlist(unittest.TestCase):
    def test_frontal_5pt_filter_rejects_extreme_profile(self):
        from engine.detectors.watchlist import is_frontal_5pt

        # Frontal face: eyes at x=40, 80, nose centered at x=60
        frontal = np.array([[40, 40], [80, 40], [60, 60], [45, 80], [75, 80]], dtype=np.float32)
        self.assertTrue(is_frontal_5pt(frontal))

        # Severe side profile: eyes close together at x=40, 50, nose far out at x=75
        profile = np.array([[40, 40], [50, 40], [75, 60], [45, 80], [55, 80]], dtype=np.float32)
        self.assertFalse(is_frontal_5pt(profile))

    def test_multi_photo_centroid_and_insightface_cosine_consensus(self):
        wl = Watchlist(tolerance=0.50, cosine_threshold=0.45, backend="insightface")
        # Build two 512-D reference angles for 'ibachu'
        v1 = np.zeros(512, dtype=np.float32)
        v1[0] = 0.9
        v1[1] = 0.43589
        v2 = np.zeros(512, dtype=np.float32)
        v2[0] = 0.9
        v2[1] = -0.43589
        wl.encodings = [v1, v2]
        wl.names = ["ibachu", "ibachu"]
        wl.backend = "insightface"
        wl._rebuild_centroids()
        self.assertIn("ibachu", wl._identity_centroids)

        # Query halfway between v1 and v2 matches the centroid cleanly (sim ~1.0)
        q = np.zeros(512, dtype=np.float32)
        q[0] = 1.0
        name, sim = wl._best_cosine_match(q)
        self.assertEqual(name, "ibachu")
        self.assertGreater(sim, 0.98)

        # Mock InsightFace FaceAnalysis app
        fake_face = MagicMock()
        fake_face.bbox = [10, 10, 140, 140]
        fake_face.kps = np.array([[45, 45], [95, 45], [70, 75], [50, 105], [90, 105]], dtype=np.float32)
        fake_face.normed_embedding = q
        wl._insight_app = MagicMock()
        wl._insight_app.get.return_value = [fake_face]

        sharp_img = _make_textured_frame(200, 200)
        # 1st hit -> pending consensus (returns None)
        self.assertIsNone(wl.match(sharp_img, track_id=5, require_consensus=True, now=10.0))
        self.assertTrue(wl.has_pending_hit(5, now=10.2))
        # 2nd hit -> confirmed!
        hit = wl.match(sharp_img, track_id=5, require_consensus=True, now=10.4)
        self.assertIsNotNone(hit)
        self.assertEqual(hit[0], "ibachu")
        self.assertTrue(wl.is_cached(5))

    def test_telemetry_manifest_expands_1_to_3_photos_per_target(self):
        from engine.telemetry import fetch_watchlist_manifest

        fake_session = MagicMock()
        fake_resp = MagicMock()
        fake_resp.json.return_value = [
            {
                "id": "t1",
                "name": "single_photo_person",
                "url": "http://localhost:5000/uploads/watchlist/p1.jpg",
            },
            {
                "id": "t2",
                "name": "three_angle_person",
                "urls": [
                    "/uploads/watchlist/a1.jpg",
                    "/uploads/watchlist/a2.jpg",
                    "/uploads/watchlist/a3.jpg",
                ],
            },
        ]
        fake_session.get.return_value = fake_resp
        manifest = fetch_watchlist_manifest(fake_session, EngineConfig())
        self.assertEqual(len(manifest), 4)
        three_angle_entries = [m for m in manifest if m["name"] == "three_angle_person"]
        self.assertEqual(len(three_angle_entries), 3)


class TestTrackerAndFinetunePipeline(unittest.TestCase):
    def test_botsort_transit_config_valid(self):
        cfg_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "engine",
            "transguard_botsort.yaml",
        )
        self.assertTrue(os.path.exists(cfg_path))
        with open(cfg_path, encoding="utf-8") as f:
            content = f.read()
        self.assertIn("tracker_type: botsort", content)
        self.assertIn("gmc_method: sparseOptFlow", content)
        self.assertIn("track_buffer: 60", content)

    def test_weapon_finetune_exporter_generates_hard_negatives_and_positives(self):
        import json
        import shutil
        import tempfile
        from pathlib import Path
        from scripts.prepare_weapon_finetune import export_dataset

        tmp = Path(tempfile.mkdtemp(prefix="tg-ft-"))
        try:
            fp_dir = tmp / "feedback" / "false_positives" / "CRIME_WEAPON_DETECTED"
            tp_dir = tmp / "feedback" / "true_positives" / "CRIME_WEAPON_DETECTED"
            fp_dir.mkdir(parents=True)
            tp_dir.mkdir(parents=True)

            sample_img = _make_textured_frame(200, 300)
            cv2.imwrite(str(fp_dir / "fp1.jpg"), sample_img)
            (fp_dir / "fp1.json").write_text(
                json.dumps({"evidence_file": "fp1.jpg", "metadata": {"weapon": "knife"}}),
                encoding="utf-8",
            )
            cv2.imwrite(str(tp_dir / "tp1.jpg"), sample_img)
            (tp_dir / "tp1.json").write_text(
                json.dumps({"evidence_file": "tp1.jpg", "metadata": {"weapon": "knife", "bbox": [30, 40, 90, 100]}}),
                encoding="utf-8",
            )

            out_dir = tmp / "dataset"
            counts = export_dataset(tmp / "feedback", out_dir, val_ratio=0.0)
            self.assertEqual(counts["hard_negative"], 1)
            self.assertEqual(counts["positive"], 1)
            self.assertTrue((out_dir / "data.yaml").exists())

            lbl_files = list((out_dir / "labels" / "train").glob("*.txt"))
            self.assertEqual(len(lbl_files), 2)
            contents = sorted(f.read_text(encoding="utf-8").strip() for f in lbl_files)
            self.assertEqual(contents[0], "")              # Hard negative = empty label file!
            self.assertTrue(contents[1].startswith("3 "))  # class 3 = knife!
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
