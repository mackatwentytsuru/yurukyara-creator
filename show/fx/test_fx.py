"""計算の層の試験。音のファイルも GPU も使わない。python test_fx.py で動く。"""
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fx_plan  # noqa: E402
from fx_layers import FxRenderer  # noqa: E402

FPS = 60
SONG = (2.0, 30.0)


def make_timeline(shift=0.0):
    beats = [round(3.0 + shift + i * 0.4, 4) for i in range(60)]
    return {"fps": FPS, "frames": 40 * FPS, "energy": [0.9] * (40 * FPS), "beats": beats, "downbeats": beats[::4],
            "sections": [{"id": "enter", "start": 1.0, "end": 2.0}, {"id": "song", "start": SONG[0], "end": SONG[1]},
                         {"id": "tail", "start": 35.0, "end": 40.0}]}


def make_stage(out_t=10.0, back_t=20.0):
    return {"life_size": {"height_px": 397, "foot_y": 1198},
            "plate": {"center_x": 2159, "quiet_gain": 0.5, "song_gain": 2.2},
            "led_character": [[1.0, out_t], [back_t, 34.0]],
            "flashes": [{"t": out_t, "kind": "out"}, {"t": back_t, "kind": "back"}],
            "monitor_rects": [[40, 190, 900, 506], [3380, 190, 900, 506]], "monitors": []}


def make_hits():
    hits = [{"t": 5.0 + i * 0.5, "band": "kick", "strength": i / 19.0} for i in range(20)]
    return hits + [{"t": 5.25, "band": "snare", "strength": 0.9}, {"t": 6.0, "band": "crash", "strength": 0.95}]


def make_plan(**stage_args):
    return fx_plan.FxPlan(make_timeline(), make_stage(**stage_args), make_hits())


def test_strong_hit_moves_more_than_weak():
    assert fx_plan.hit_amount("kick", 1.0) > 5.0 * fx_plan.hit_amount("kick", 0.5)
    assert fx_plan.hit_amount("crash", 0.5) == 0.0


def test_light_rises_over_three_frames():
    frames = np.arange(0.0, 10.0)
    shape = fx_plan.impulse(frames, 5.0, 20.0)
    rising = [i for i in range(1, 8) if shape[i] > shape[i - 1] + 1e-6]
    assert len(rising) >= 3, shape


def test_seconds_follow_the_stage_file():
    early, late = make_plan(out_t=10.0), make_plan(out_t=12.0)
    assert early.flash["out"]["ring"][10 * FPS + 2] > 0.0
    assert late.flash["out"]["ring"][10 * FPS + 2] == 0.0
    assert late.flash["out"]["ring"][12 * FPS + 2] > 0.0


def test_silent_sections_are_black():
    plan = make_plan()
    renderer = FxRenderer(plan, 0.125, "cpu")
    assert float(renderer.render(37 * FPS).max()) == 0.0


def test_any_frame_order_gives_the_same_picture():
    plan = make_plan()
    a = FxRenderer(plan, 0.125, "cpu")
    b = FxRenderer(plan, 0.125, "cpu")
    frame = 10 * FPS + 5
    first = a.render(frame)
    a.render(300)
    assert torch.equal(first, a.render(frame))
    assert torch.equal(first, b.render(frame))


def test_center_is_kept_dark():
    plan = make_plan()
    image = FxRenderer(plan, 0.125, "cpu").render(int(25.0 * FPS)).mean(dim=(0, 1))
    width = image.numel()
    center = image[int(2159 / 5680 * width)]
    assert center < 0.5 * image[int(4000 / 5680 * width)]


def test_call_runs_light_a_before_c():
    plan = make_plan()
    runs = plan.call_runs()
    assert runs and len(runs[0]) == 4
    xs = np.array([b["x"] for b in plan.bulbs])
    at = int(runs[0][0] * FPS) + 3
    idle = plan.bulb_table[at]
    assert idle[xs < 1279].mean() > idle[xs > 3039].mean()


def test_bulb_rows_keep_off_the_seams():
    bulbs = fx_plan.default_bulbs(2159.0)
    for seam in (1279.0, 3039.0):
        assert min(abs(b["x"] - seam) for b in bulbs) >= 40.0


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print("ok", test.__name__)
    print(f"全部 {len(tests)} 件 合格")
