"""Unit tests for the AI fusion detectors.

These cover the pure-geometry / temporal-logic layers of all five pillars.
They deliberately avoid loading YOLO, MediaPipe or dlib so the suite runs on
CI machines without model weights or GPUs.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trans_guard_engine import (  # noqa: E402
    CROWD_CONSENSUS_FRAMES,
    VIOLENCE_CONFIRM_FRAMES,
    VIOLENCE_WRIST_SPEED_PX_S,
    CrowdDetector,
    PoseEngine,
    ViolenceDetector,
    bbox_iou,
    boxes_intersect_with_radius,
    crop_bbox,
)

import numpy as np  # noqa: E402


def landmark_set(nose_y, hip_y, wrist_x=0.0, wrist_y=0.0, visibility=0.9):
    return {
        "NOSE": (50.0, nose_y, visibility),
        "LEFT_HIP": (40.0, hip_y, visibility),
        "RIGHT_HIP": (60.0, hip_y, visibility),
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


class TestFallGeometry(unittest.TestCase):
    def setUp(self):
        self.engine = PoseEngine.__new__(PoseEngine)  # no mediapipe needed
        self.engine.pose = object()  # pretend a skeleton source exists
        self.engine._pose_landmark = None
        self.engine.fall_streaks = {}

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
        self.engine.forget({1})
        self.assertEqual(set(self.engine.fall_streaks), {1})


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
        events = []
        for index in range(VIOLENCE_CONFIRM_FRAMES + 2):
            events.extend(self.detector.evaluate(persons, speeds, index * 0.1))
        self.assertTrue(events)
        id_a, id_b, iou, peak = events[0]
        self.assertEqual((id_a, id_b), (1, 2))
        self.assertGreater(iou, 0.15)
        self.assertGreaterEqual(peak, VIOLENCE_WRIST_SPEED_PX_S)

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
