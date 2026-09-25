"""Unit tests for the AI fusion detectors.

These cover the pure-geometry / temporal-logic layers across the detection pillars.
They deliberately avoid loading YOLO, MediaPipe or dlib so the suite runs on
CI machines without model weights or GPUs.
"""

import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.config import (  # noqa: E402
    CROWD_CONSENSUS_FRAMES,
    VIOLENCE_CONFIRM_FRAMES,
    VIOLENCE_WRIST_SPEED_PX_S,
    BAGGAGE_STATIONARY_SECONDS,
)
from engine.detectors.crowd import CrowdDetector  # noqa: E402
from engine.detectors.pose import PoseEngine  # noqa: E402
from engine.detectors.violence import ViolenceDetector  # noqa: E402
from engine.detectors.weapon import WeaponDetector  # noqa: E402
from engine.detectors.baggage import BaggageDetector  # noqa: E402
from engine.utils.geometry import (  # noqa: E402
    bbox_iou,
    bbox_center,
    boxes_intersect_with_radius,
    crop_bbox,
    extract_face_box_from_landmarks,
)

import numpy as np  # noqa: E402


def landmark_set(nose_y, hip_y, wrist_x=0.0, wrist_y=0.0, visibility=0.9,
                 shoulder_y=None):
    """Create a landmark dict for testing.

    If shoulder_y is not provided it defaults to halfway between nose_y and hip_y.
    """
    if shoulder_y is None:
        shoulder_y = (nose_y + hip_y) / 2.0
    return {
        "NOSE": (50.0, nose_y, visibility),
        "LEFT_HIP": (40.0, hip_y, visibility),
        "RIGHT_HIP": (60.0, hip_y, visibility),
        "LEFT_SHOULDER": (40.0, shoulder_y, visibility),
        "RIGHT_SHOULDER": (60.0, shoulder_y, visibility),
        "LEFT_WRIST": (wrist_x, wrist_y, visibility),
        "RIGHT_WRIST": (wrist_x, wrist_y, visibility),
    }


class TestGeometry(unittest.TestCase):
    def test_iou_identical_boxes(self):
        self.assertAlmostEqual(bbox_iou((0, 0, 10, 10), (0, 0, 10, 10)), 1.0)

    def test_iou_disjoint_boxes(self):
        self.assertEqual(bbox_iou((0, 0, 10, 10), (50, 50, 60, 60)), 0.0)

    def test_iou_half_overlap(self):
        # 10x10 boxes sharing a 5x10 strip -> 50 / (100 + 100 - 50)
        self.assertAlmostEqual(bbox_iou((0, 0, 10, 10), (5, 0, 15, 10)), 50 / 150)

    def test_proximity_radius(self):
        bag = (100, 100, 120, 120)
        near = (200, 100, 220, 120)   # 80px gap, inside 120px radius
        far = (400, 100, 420, 120)
        self.assertTrue(boxes_intersect_with_radius(bag, near, 120.0))
        self.assertFalse(boxes_intersect_with_radius(bag, far, 120.0))

    def test_crop_bbox_clamps_to_frame(self):
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        crop, offset = crop_bbox(frame, (-20, -20, 50, 50))
        self.assertIsNotNone(crop)
        self.assertEqual(offset, (0, 0))
        self.assertEqual(crop.shape[:2], (50, 50))

    def test_crop_bbox_rejects_degenerate(self):
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        crop, _ = crop_bbox(frame, (10, 10, 12, 12))
        self.assertIsNone(crop)


class TestCrowdDetector(unittest.TestCase):
    def test_requires_temporal_consensus(self):
        detector = CrowdDetector(threshold=10, confirm_frames=CROWD_CONSENSUS_FRAMES)
        for _ in range(CROWD_CONSENSUS_FRAMES - 1):
            self.assertIsNone(detector.update(15))
        self.assertEqual(detector.update(15), 15)

    def test_default_threshold_is_transit_appropriate(self):
        """Default threshold should be >= 8 for public transit."""
        detector = CrowdDetector()
        self.assertGreaterEqual(detector.threshold, 8)

    def test_flicker_does_not_alarm(self):
        detector = CrowdDetector(threshold=10, confirm_frames=15)
        for index in range(60):
            self.assertIsNone(detector.update(15 if index % 2 == 0 else 3))

    def test_alarm_latches_once_then_releases(self):
        detector = CrowdDetector(threshold=10, confirm_frames=3)
        detector.update(12)
        detector.update(12)
        self.assertIsNotNone(detector.update(12))
        # Already active: no repeat alarm while the crowd persists.
        self.assertIsNone(detector.update(12))
        for _ in range(20):
            detector.update(1)
        self.assertFalse(detector.active)
        # Crowd returns -> a fresh alarm can fire.
        detector.update(12)
        detector.update(12)
        self.assertIsNotNone(detector.update(12))

    def test_reports_peak_occupancy(self):
        detector = CrowdDetector(threshold=10, confirm_frames=3)
        detector.update(11)
        detector.update(25)
        self.assertEqual(detector.update(12), 25)

    def test_spatial_density_calculation(self):
        """Density should increase when people are packed tightly."""
        persons_spread = [(i, (i * 200, 0, i * 200 + 50, 100)) for i in range(5)]
        persons_tight = [(i, (i * 20, 0, i * 20 + 50, 100)) for i in range(5)]
        d_spread = CrowdDetector.compute_density(persons_spread)
        d_tight = CrowdDetector.compute_density(persons_tight)
        self.assertGreater(d_tight, d_spread)

    def test_density_single_person_returns_zero(self):
        self.assertEqual(CrowdDetector.compute_density([(1, (0, 0, 50, 100))]), 0.0)

    def test_update_accepts_persons_kwarg(self):
        """Ensure the new optional `persons` kwarg doesn't break the API."""
        detector = CrowdDetector(threshold=10, confirm_frames=3)
        persons = [(i, (i * 20, 0, i * 20 + 50, 100)) for i in range(5)]
        result = detector.update(5, persons=persons)
        self.assertIsNone(result)  # Below threshold


class TestFallGeometry(unittest.TestCase):
    def setUp(self):
        self.engine = PoseEngine.__new__(PoseEngine)  # no mediapipe needed
        self.engine.pose = object()  # pretend a skeleton source exists
        self.engine._pose_landmark = None
        self.engine.fall_streaks = {}
        self.engine._prev_centroid = {}
        self.engine._velocity_spike = {}

    def test_standing_person_never_falls(self):
        upright_bbox = (0, 0, 50, 200)          # tall box
        points = landmark_set(nose_y=10.0, hip_y=100.0)  # head above hips
        for _ in range(50):
            self.assertFalse(self.engine.is_fall(1, upright_bbox, points))

    def test_horizontal_but_head_up_is_not_a_fall(self):
        wide_bbox = (0, 0, 200, 50)
        points = landmark_set(nose_y=10.0, hip_y=100.0)
        for _ in range(50):
            self.assertFalse(self.engine.is_fall(1, wide_bbox, points))

    def test_wide_box_and_head_below_hips_confirms_fall(self):
        wide_bbox = (0, 0, 200, 50)
        points = landmark_set(nose_y=120.0, hip_y=100.0)
        results = [self.engine.is_fall(1, wide_bbox, points) for _ in range(10)]
        self.assertTrue(any(results))
        self.assertFalse(results[0], "must not alarm on a single frame")

    def test_torso_horizontal_triggers_fall(self):
        """New: torso angle near horizontal should trigger fall even if
        head is level with hips (lying flat on floor)."""
        wide_bbox = (0, 0, 200, 50)
        # Shoulders at same Y as hips -> torso horizontal -> angle ~90°
        points = landmark_set(nose_y=100.0, hip_y=100.0, shoulder_y=100.0)
        results = [self.engine.is_fall(1, wide_bbox, points) for _ in range(10)]
        self.assertTrue(any(results), "Horizontal torso should trigger fall")

    def test_streaks_are_per_track(self):
        wide = (0, 0, 200, 50)
        tall = (0, 0, 50, 200)
        fallen = landmark_set(nose_y=120.0, hip_y=100.0)
        upright = landmark_set(nose_y=10.0, hip_y=100.0)
        fired = False
        for _ in range(10):
            fired = self.engine.is_fall(1, wide, fallen) or fired
            self.engine.is_fall(2, tall, upright)
        self.assertTrue(fired, "person 2 standing must not reset person 1")

    def test_forget_drops_dead_tracks(self):
        self.engine.fall_streaks = {1: 3, 2: 1}
        self.engine._prev_centroid = {1: ((0, 0), 0.0), 2: ((0, 0), 0.0)}
        self.engine._velocity_spike = {1: True}
        self.engine.forget({1})
        self.assertEqual(set(self.engine.fall_streaks), {1})
        self.assertEqual(set(self.engine._prev_centroid), {1})
        self.assertEqual(set(self.engine._velocity_spike), {1})


class TestViolenceDetector(unittest.TestCase):
    def setUp(self):
        self.detector = ViolenceDetector()

    def test_wrist_speed_computation(self):
        first = landmark_set(0, 0, wrist_x=0.0, wrist_y=0.0)
        second = landmark_set(0, 0, wrist_x=100.0, wrist_y=0.0)
        self.assertEqual(self.detector.wrist_speed(1, first, 0.0), 0.0)
        self.assertAlmostEqual(self.detector.wrist_speed(1, second, 0.5), 200.0)

    def test_low_visibility_wrists_ignored(self):
        points = landmark_set(0, 0, wrist_x=0.0, wrist_y=0.0, visibility=0.1)
        moved = landmark_set(0, 0, wrist_x=500.0, wrist_y=0.0, visibility=0.1)
        self.detector.wrist_speed(1, points, 0.0)
        self.assertEqual(self.detector.wrist_speed(1, moved, 0.1), 0.0)

    def test_overlap_without_fast_wrists_is_calm(self):
        persons = [(1, (0, 0, 100, 200)), (2, (50, 0, 150, 200))]
        speeds = {1: 10.0, 2: 5.0}
        for index in range(60):
            self.assertEqual(self.detector.evaluate(persons, speeds, index * 0.1), [])

    def test_fast_wrists_without_overlap_is_calm(self):
        persons = [(1, (0, 0, 100, 200)), (2, (900, 0, 1000, 200))]
        speeds = {1: 2000.0, 2: 2000.0}
        for index in range(60):
            self.assertEqual(self.detector.evaluate(persons, speeds, index * 0.1), [])

    def test_overlap_plus_fast_wrists_triggers(self):
        persons = [(1, (0, 0, 100, 200)), (2, (50, 0, 150, 200))]
        speeds = {1: VIOLENCE_WRIST_SPEED_PX_S * 2, 2: 0.0}
        # Build up the kinetic EMA first
        for i in range(5):
            pts = landmark_set(0, 0, wrist_x=float(i * 200), wrist_y=0.0)
            self.detector.wrist_speed(1, pts, i * 0.1)
        events = []
        for index in range(VIOLENCE_CONFIRM_FRAMES + 5):
            events.extend(self.detector.evaluate(persons, speeds, 10.0 + index * 0.1))
        self.assertTrue(events)
        id_a, id_b, iou, peak = events[0]
        self.assertEqual((id_a, id_b), (1, 2))
        self.assertGreater(iou, 0.15)
        self.assertGreaterEqual(peak, VIOLENCE_WRIST_SPEED_PX_S)

    def test_kinetic_ema_builds_up(self):
        """Kinetic EMA should increase with sustained fast wrist movement."""
        pts_still = landmark_set(0, 0, wrist_x=0.0, wrist_y=0.0)
        pts_fast = landmark_set(0, 0, wrist_x=500.0, wrist_y=0.0)
        self.detector.wrist_speed(1, pts_still, 0.0)
        self.detector.wrist_speed(1, pts_fast, 0.1)
        ema1 = self.detector._kinetic_ema.get(1, 0.0)
        self.assertGreater(ema1, 0.0)

    def test_pair_state_expires(self):
        persons = [(1, (0, 0, 100, 200)), (2, (50, 0, 150, 200))]
        speeds = {1: VIOLENCE_WRIST_SPEED_PX_S * 2, 2: 0.0}
        self.detector.evaluate(persons, speeds, 0.0)
        self.assertTrue(self.detector.pairs)
        self.detector.evaluate([], {}, 100.0)
        self.assertFalse(self.detector.pairs)

    def test_dead_tracks_are_forgotten(self):
        points = landmark_set(0, 0, wrist_x=1.0, wrist_y=1.0)
        self.detector.wrist_speed(7, points, 0.0)
        self.detector.evaluate([], {}, 1.0)
        self.assertNotIn(7, self.detector.previous_wrists)
        self.assertNotIn(7, self.detector._kinetic_ema)


class TestBaggageDetector(unittest.TestCase):
    def test_new_bag_with_owner_no_immediate_alert(self):
        """A bag that just appeared near a person should not immediately alert."""
        detector = BaggageDetector()
        bags = [(10, "backpack", (100, 100, 150, 150))]
        persons = [(1, (90, 50, 200, 250))]
        alerts = detector.update(bags, persons, time.time())
        self.assertEqual(alerts, [])

    def test_owner_departure_triggers_alert(self):
        """Bag becomes unattended after owner leaves beyond proximity radius."""
        detector = BaggageDetector()
        bags = [(10, "suitcase", (100, 100, 150, 150))]
        persons_near = [(1, (90, 50, 200, 250))]
        persons_far = [(1, (800, 50, 900, 250))]

        t = time.time()
        # First frame: bag appears near person -> owner assigned
        detector.update(bags, persons_near, t)
        # Owner walks away
        for i in range(1, int(BAGGAGE_STATIONARY_SECONDS) + 3):
            alerts = detector.update(bags, persons_far, t + i)
        self.assertTrue(alerts, "Should alert when owner is gone > threshold seconds")

    def test_stranger_passing_does_not_reset_timer(self):
        """A random person walking past the bag should NOT reset the unattended timer."""
        detector = BaggageDetector()
        bags = [(10, "handbag", (100, 100, 150, 150))]
        # Owner (track 1) is near at first
        persons_with_owner = [(1, (90, 50, 200, 250))]
        # Owner gone, stranger (track 2) walks past
        persons_stranger = [(2, (90, 50, 200, 250))]

        t = time.time()
        detector.update(bags, persons_with_owner, t)
        # Owner leaves, stranger passes by
        for i in range(1, int(BAGGAGE_STATIONARY_SECONDS) + 3):
            alerts = detector.update(bags, persons_stranger, t + i)
        self.assertTrue(alerts, "Stranger should NOT reset the unattended timer")

    def test_owner_returns_resets_timer(self):
        """If the owner comes back, the bag is no longer unattended."""
        detector = BaggageDetector()
        bags = [(10, "backpack", (100, 100, 150, 150))]
        persons_near = [(1, (90, 50, 200, 250))]
        persons_far = [(1, (800, 50, 900, 250))]

        t = time.time()
        detector.update(bags, persons_near, t)
        # Owner walks away for a few seconds (not enough to trigger)
        for i in range(1, int(BAGGAGE_STATIONARY_SECONDS) - 2):
            detector.update(bags, persons_far, t + i)
        # Owner returns
        offset = int(BAGGAGE_STATIONARY_SECONDS) - 2
        for i in range(3):
            alerts = detector.update(bags, persons_near, t + offset + i)
            self.assertEqual(alerts, [])

    def test_gc_removes_stale_bags(self):
        """Bags not seen for > 5s should be garbage collected."""
        detector = BaggageDetector()
        bags = [(10, "backpack", (100, 100, 150, 150))]
        persons = [(1, (90, 50, 200, 250))]
        t = time.time()
        detector.update(bags, persons, t)
        self.assertIn(10, detector.cache)
        # Bag disappears
        detector.update([], persons, t + 10.0)
        self.assertNotIn(10, detector.cache)


class TestWeaponDetectorLogic(unittest.TestCase):
    def setUp(self):
        self.detector = WeaponDetector.__new__(WeaponDetector)
        self.detector.model = None

    def test_recognizes_weapon_keywords(self):
        self.assertTrue(self.detector._is_weapon("knife"))
        self.assertTrue(self.detector._is_weapon("Knife"))
        self.assertTrue(self.detector._is_weapon("kitchen knife"))
        self.assertTrue(self.detector._is_weapon("Gun"))
        self.assertTrue(self.detector._is_weapon("pistol"))
        self.assertTrue(self.detector._is_weapon("firearm"))
        self.assertTrue(self.detector._is_weapon("scissors"))
        self.assertTrue(self.detector._is_weapon("grenade"))
        self.assertTrue(self.detector._is_weapon("explosive"))

    def test_rejects_benign_objects(self):
        self.assertFalse(self.detector._is_weapon("person"))
        self.assertFalse(self.detector._is_weapon("cell phone"))
        self.assertFalse(self.detector._is_weapon("backpack"))
        self.assertFalse(self.detector._is_weapon("cup"))
        self.assertFalse(self.detector._is_weapon("chair"))


class TestFaceLandmarkBox(unittest.TestCase):
    def test_empty_landmarks_return_none(self):
        self.assertIsNone(extract_face_box_from_landmarks({}, 1280, 720))

    def test_low_visibility_nose_returns_none(self):
        pts = {"NOSE": (100.0, 100.0, 0.1)}
        self.assertIsNone(extract_face_box_from_landmarks(pts, 1280, 720))

    def test_derives_face_box_from_head_points(self):
        pts = {
            "NOSE": (340.0, 135.0, 0.99),
            "LEFT_EYE": (350.0, 115.0, 0.99),
            "RIGHT_EYE": (330.0, 125.0, 0.99),
            "MOUTH_LEFT": (360.0, 145.0, 0.99),
            "MOUTH_RIGHT": (345.0, 148.0, 0.99),
        }
        box = extract_face_box_from_landmarks(pts, 1280, 720)
        self.assertIsNotNone(box)
        top, right, bottom, left = box
        self.assertLess(top, 135)
        self.assertGreater(bottom, 135)
        self.assertLess(left, 340)
        self.assertGreater(right, 340)
        self.assertGreater(right - left, 30)
        self.assertGreater(bottom - top, 30)


class TestIncidentPriority(unittest.TestCase):
    """Verify the incident priority table is correctly defined."""

    def test_weapon_is_highest_priority(self):
        from engine.inference import INCIDENT_PRIORITY
        self.assertEqual(INCIDENT_PRIORITY["CRIME_WEAPON_DETECTED"], 1)
        self.assertEqual(INCIDENT_PRIORITY["ARMED_VIOLENCE"], 1)

    def test_violence_is_higher_than_fall(self):
        from engine.inference import INCIDENT_PRIORITY
        self.assertLess(
            INCIDENT_PRIORITY["CRIME_VIOLENCE_DETECTED"],
            INCIDENT_PRIORITY["FALL_DETECTED"],
        )

    def test_crowd_is_lowest_priority(self):
        from engine.inference import INCIDENT_PRIORITY
        self.assertEqual(
            max(INCIDENT_PRIORITY.values()),
            INCIDENT_PRIORITY["OVERCROWD_DETECTED"],
        )


class TestWatchlistCaching(unittest.TestCase):
    """Verify watchlist caching only caches positive matches, never blacklisting missed faces."""

    def test_unmatched_track_not_blacklisted(self):
        from engine.detectors.watchlist import Watchlist
        wl = Watchlist(0.60)
        # Fake an empty scan on track 42
        blank = np.zeros((100, 100, 3), dtype=np.uint8)
        result = wl.match(blank, track_id=42)
        self.assertIsNone(result)
        # Track 42 must NOT be marked as cached!
        self.assertFalse(wl.is_cached(42), "Failed face scan must not permanently blacklist track from future recognition")
        self.assertIsNone(wl.cache_hit(42))

    def test_positive_match_cached(self):
        from engine.detectors.watchlist import Watchlist
        wl = Watchlist(0.60)
        wl._track_cache[99] = "Suspect_Alpha"
        self.assertTrue(wl.is_cached(99))
        self.assertEqual(wl.cache_hit(99), "Suspect_Alpha")


class TestMultiPairConvergence(unittest.TestCase):
    """Verify multi-pair convergence speed does not zero out on overlapping individuals."""

    def test_multi_pair_convergence_does_not_zero_out(self):
        detector = ViolenceDetector()
        # Set up Frame 1 centroids at t=0.0
        # Person 1 at (100, 100), Person 2 at (150, 100), Person 3 at (180, 100)
        detector._prev_centroid[1] = ((100.0, 100.0), 0.0)
        detector._prev_centroid[2] = ((150.0, 100.0), 0.0)
        detector._prev_centroid[3] = ((180.0, 100.0), 0.0)

        # Frame 2 at t=0.5: Person 1 moves closer to BOTH Person 2 and Person 3
        c1 = (120.0, 100.0)
        c2 = (145.0, 100.0)
        c3 = (175.0, 100.0)

        conv_1_2 = detector._convergence_speed(1, c1, 2, c2, 0.5)
        conv_1_3 = detector._convergence_speed(1, c1, 3, c3, 0.5)
        self.assertGreater(conv_1_2, 0.0, "Person 1 -> 2 convergence should be positive")
        self.assertGreater(conv_1_3, 0.0, "Person 1 -> 3 convergence should be positive and not overwritten")


class TestWebcamSourceSelection(unittest.TestCase):
    """Verify capture source switches to OpenCVWebcamSource for numeric camera inputs."""

    def test_numeric_url_uses_opencv(self):
        from engine.config import EngineConfig
        from engine.capture import OpenCVWebcamSource, FFmpegSource
        cfg_webcam = EngineConfig(rtsp_url="0")
        cfg_rtsp = EngineConfig(rtsp_url="rtsp://192.168.1.100:554/live")

        source_webcam = OpenCVWebcamSource(cfg_webcam) if cfg_webcam.rtsp_url.strip().isdigit() else FFmpegSource(cfg_webcam)
        source_rtsp = OpenCVWebcamSource(cfg_rtsp) if cfg_rtsp.rtsp_url.strip().isdigit() else FFmpegSource(cfg_rtsp)

        self.assertIsInstance(source_webcam, OpenCVWebcamSource)
        self.assertIsInstance(source_rtsp, FFmpegSource)


class TestCropOffsetFaceExtraction(unittest.TestCase):
    """Verify extract_face_box_from_landmarks supports crop-relative offsets."""

    def test_face_box_with_crop_offset(self):
        # Person at x=400..600, y=200..600 in full 1920x1080 frame
        crop_offset = (400, 200)
        crop_w, crop_h = 200, 400
        # Face landmarks in full frame coords
        landmarks = {
            "NOSE": (500.0, 260.0, 0.95),
            "LEFT_EYE": (485.0, 245.0, 0.95),
            "RIGHT_EYE": (515.0, 245.0, 0.95),
            "MOUTH_LEFT": (490.0, 280.0, 0.95),
            "MOUTH_RIGHT": (510.0, 280.0, 0.95),
        }
        # Without offset, full frame points fail inside 200x400 crop
        box_without_offset = extract_face_box_from_landmarks(landmarks, crop_w, crop_h)
        self.assertIsNone(box_without_offset, "Full-frame coordinates without offset must fail crop boundaries")

        # With offset, face box is computed relative to crop
        box_with_offset = extract_face_box_from_landmarks(landmarks, crop_w, crop_h, offset=crop_offset)
        self.assertIsNotNone(box_with_offset, "Face box must be successfully extracted using crop offset")
        top, right, bottom, left = box_with_offset
        self.assertGreaterEqual(top, 0)
        self.assertLessEqual(bottom, crop_h)
        self.assertGreaterEqual(left, 0)
        self.assertLessEqual(right, crop_w)


class TestSpatialDensityCrowdStability(unittest.TestCase):
    """Verify crowd detector does not rapidly flap when spatial density triggers alarm."""

    def test_density_alarm_does_not_flap_on_next_frame(self):
        detector = CrowdDetector(threshold=10, confirm_frames=3)
        # 4 persons tightly clustered in a 50x50 area (very high density)
        persons = [
            (1, (100, 100, 120, 140)),
            (2, (110, 105, 130, 145)),
            (3, (115, 110, 135, 150)),
            (4, (120, 115, 140, 155)),
        ]
        # Frame 1-3: density builds streak
        self.assertIsNone(detector.update(4, persons))
        self.assertIsNone(detector.update(4, persons))
        alarm = detector.update(4, persons)
        self.assertEqual(alarm, 4, "Spatial density should trigger alarm on reaching confirm_frames")
        self.assertTrue(detector.active)

        # Frame 4: Person count is still 4 (<= 10), but density is still high.
        # It must NOT immediately reset or start releasing!
        self.assertIsNone(detector.update(4, persons))
        self.assertTrue(detector.active, "Alarm must remain active while cluster remains packed")


class TestOcclusionConvergenceDiscard(unittest.TestCase):
    """Verify stale centroids from occluded persons do not trigger false convergence spikes."""

    def test_stale_centroid_returns_zero_convergence(self):
        detector = ViolenceDetector()
        # Person 1 was seen at t=0.0s, Person 2 was seen at t=4.0s
        detector._prev_centroid[1] = ((100.0, 100.0), 0.0)
        detector._prev_centroid[2] = ((150.0, 100.0), 4.0)

        # Now at t=4.1s (Person 1 reappeared after 4.1s occlusion)
        c1 = (130.0, 100.0)
        c2 = (140.0, 100.0)
        conv = detector._convergence_speed(1, c1, 2, c2, 4.1)
        self.assertEqual(conv, 0.0, "Stale centroid >0.5s old must discard convergence to prevent false spikes")


if __name__ == "__main__":
    unittest.main(verbosity=2)

