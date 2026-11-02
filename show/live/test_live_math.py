"""live_math の確かめ。python test_live_math.py"""
import math

from live_math import IDENTITY, axes_to_rotator, axes_to_T, camera_from_K, marker_color, pose_axes, recenter, rotator_axes


def close(a, b, tolerance=1e-6):
    return all(abs(x - y) < tolerance for x, y in zip(a, b))


def test_round_trip_with_alignment():
    angle = 0.7
    rotation = ((math.cos(angle), -math.sin(angle), 0.0), (math.sin(angle), math.cos(angle), 0.0), (0.0, 0.0, 1.0))
    translation = (12.0, -30.0, 5.0)
    position = (100.0, 1500.0, 170.0)
    axes = rotator_axes(4.0, -95.0, 3.0)
    T = axes_to_T(position, *axes, rotation, translation)
    got_position, *got_axes = pose_axes(T, rotation, translation)
    assert close(got_position, position)
    assert close(axes_to_rotator(*got_axes), (4.0, -95.0, 3.0))


def test_recenter_puts_current_pose_at_target():
    T = axes_to_T((-250.0, 90.0, 140.0), *rotator_axes(2.0, 33.0, 0.0))
    rotation, translation = recenter(T, (130.0, 1600.0, 150.0), -90.0)
    position, forward, right, up = pose_axes(T, rotation, translation)
    assert close(position, (130.0, 1600.0, 150.0))
    pitch, yaw, roll = axes_to_rotator(forward, right, up)
    assert close((pitch, yaw), (2.0, -90.0))


def test_focal_from_K():
    assert close(camera_from_K([1440.0, 1440.0, 960.0, 540.0], 1920, 1080), (27.0, 36.0, 20.25))


def test_marker_codes_differ():
    assert len({marker_color(code) for code in range(1, 8)}) == 7
    assert pose_axes(axes_to_T((0.0, 0.0, 0.0), *rotator_axes(0, 0, 0)), IDENTITY)[0] == (0.0, 0.0, 0.0)


if __name__ == "__main__":
    test_round_trip_with_alignment()
    test_recenter_puts_current_pose_at_target()
    test_focal_from_K()
    test_marker_codes_differ()
    print("ok")
