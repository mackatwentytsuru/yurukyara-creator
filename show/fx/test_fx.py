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


def test_exit_goes_from_zero_to_one_before_the_out_second():
    plan = make_plan(out_t=10.0)
    begin = 10.0 - fx_plan.EXIT_START_BEFORE
    assert plan.exit_progress(begin - 0.01) == 0.0
    assert 0.0 < plan.exit_progress(begin + fx_plan.EXIT_SEC / 2.0) < 1.0
    assert plan.exit_progress(10.0) == 1.0


def test_curtain_opens_at_out_and_closes_at_back():
    plan = make_plan(out_t=10.0, back_t=20.0)
    assert plan.opened[int(9.9 * FPS)] == 0.0
    assert plan.opened[int(15.0 * FPS)] == 1.0
    assert plan.opened[int(25.0 * FPS)] == 0.0


def test_measured_bulbs_keep_their_flow_and_position():
    bulbs = [{"x": 100.0, "y": 200.0, "flow": 0.4, "arch": False}, {"x": 2159.0, "y": 300.0, "flow": 0.0, "arch": True}]
    plan = fx_plan.FxPlan(make_timeline(), make_stage(), make_hits(), None, bulbs)
    assert plan.measured_bulbs and list(plan.flow) == [0.4, 0.0]
    renderer = FxRenderer(plan, 0.125, "cpu")
    assert renderer.s_x.tolist() == [100.0]  # 2 つに 1 つ。ずらさない


def test_landing_is_the_first_beat_after_the_out():
    plan = make_plan(out_t=10.0)
    assert plan.land_times[0] > 10.0 + fx_plan.LAND_MIN_AFTER - 1e-6
    assert plan.land_times[0] in plan.timeline["beats"]


def test_led_character_stays_behind_and_fades_late():
    plan = make_plan(out_t=10.0)
    assert plan.led_character_fade(10.0) == 1.0
    middle = 10.0 + (fx_plan.LED_FADE_START + fx_plan.LED_FADE_END) / 2.0
    assert 0.0 < plan.led_character_fade(middle) < 1.0
    assert plan.led_character_fade(10.0 + fx_plan.LED_FADE_END) == 0.0
    assert plan.held_frame(int(10.1 * FPS)) == 10 * FPS - 1


def make_two_trip_stage(shift=0.0):
    """行き来 2 回: 出る 10、戻る 20、出る 25、戻る 31(shift だけずらせる)。"""
    stage = make_stage(out_t=10.0 + shift, back_t=20.0 + shift)
    stage["led_character"] = [[1.0 + shift, 10.0 + shift], [20.0 + shift, 25.0 + shift], [31.0 + shift, 34.0 + shift]]
    stage["flashes"] += [{"t": 25.0 + shift, "kind": "out"}, {"t": 31.0 + shift, "kind": "back"}]
    return stage


def make_shifted_timeline(shift):
    timeline = make_timeline(shift)
    timeline["frames"] = int((40 + shift) * FPS) + FPS
    timeline["energy"] = [0.9] * timeline["frames"]
    timeline["sections"] = [{"id": "preroll", "start": 0.0, "end": 0.5 + shift},
                            *[{**s, "start": s["start"] + shift, "end": s["end"] + shift} for s in timeline["sections"]]]
    return timeline


def test_two_trips_hide_the_led_character_while_on_stage():
    plan = fx_plan.FxPlan(make_timeline(), make_two_trip_stage(), make_hits())
    assert plan.curtain_events() == [(10.0, 20.0), (25.0, 31.0)]
    for t in (12.0, 19.9, 27.0, 30.9):  # 舞台の上
        assert plan.led_character_level(t) == 0.0, t
        assert plan.stage_character_present(t), t
    for t in (5.0, 22.0, 33.0):  # LED の中
        assert plan.led_character_level(t) == 1.0, t
        assert not plan.stage_character_present(t), t
    # 戻るの直後は 0 から上がる、出るの直後は遅れて薄れる
    assert 0.0 < plan.led_character_level(20.0 + fx_plan.LED_APPEAR_SEC["back"] / 2.0) < 1.0
    assert 0.0 < plan.led_character_level(25.0 + fx_plan.LED_FADE_START + 0.1) < 1.0
    # 緞帳は 2 回とも開いて閉じる
    for open_t, back in plan.curtain_events():
        assert plan.opened[int((open_t + 2.0) * FPS)] == 1.0
        assert plan.opened[int((back + fx_plan.CURTAIN_CLOSE_END + 0.05) * FPS)] == 0.0


def make_hop_stage(land_xy):
    stage = make_stage(out_t=10.0)
    stage["led_character"] = [[1.0, 9.6], [20.0, 34.0]]
    stage["hops"] = [{"out": 10.0, "takeoff": 9.6, "land": 10.4, "start_xy": [0.0, -130.0], "land_xy": list(land_xy),
                      "led_fade": [9.65, 9.8], "reveal": [9.65, 9.8]}]
    return stage


def test_hop_shift_follows_the_stage_character():
    """跳ぶ間、LED の層は舞台のキャラへ横にずれる。前へまっすぐなら 0。秒は stage の hops だけから。"""
    from fx_plan import stage_layout

    left = fx_plan.FxPlan(make_timeline(), make_hop_stage((-100.0, 70.0)), make_hits())
    front = fx_plan.FxPlan(make_timeline(), make_hop_stage((0.0, 70.0)), make_hits())
    assert left.hop_led_shift_px(9.0) == 0.0 and left.hop_led_shift_px(9.6) == 0.0  # 踏み切りまで動かない
    shifts = [left.hop_led_shift_px(t) for t in np.arange(9.6, 10.41, 0.05)]
    assert all(b < a for a, b in zip(shifts, shifts[1:])), shifts  # 左へ進み続ける
    for t in np.arange(9.0, 11.0, 0.05):
        assert abs(front.hop_led_shift_px(t)) < 1e-9, t
    # 着地で: 見る人の目から中央の面へ写した横の動き(cm)を、面の画素の幅で割った値
    vx, vy = stage_layout.CAMERAS["wide"]["pos"][:2]
    cm = (-100.0 - vx) * (vy - stage_layout.B_Y) / (vy - 70.0) - (0.0 - vx) * (vy - stage_layout.B_Y) / (vy + 130.0)
    px = cm / (2 * stage_layout.B_X_HALF / (stage_layout.B_PX_X1 - stage_layout.B_PX_X0))
    assert abs(left.hop_led_shift_px(10.4) - px) < 1e-6 and px < -100.0 / 0.2948
    # 見る人の位置を cues で渡せる(カメラが右にいると、まっすぐ前でも左へずれて見える)
    side = fx_plan.FxPlan(make_timeline(), make_hop_stage((0.0, 70.0)), make_hits(), cues={"viewer_cm": [130.0, 1590.0]})
    assert side.hop_led_shift_px(10.4) < -10.0


def test_hop_led_shift_moves_the_layer():
    import compose_led

    image = torch.zeros(1, 4, 20)
    image[0, :, 10] = 1.0
    moved = compose_led.shift_x(image, -3.5)
    assert abs(float(moved[0, 0, 6]) - 0.5) < 1e-6 and abs(float(moved[0, 0, 7]) - 0.5) < 1e-6
    assert abs(float(moved.sum()) - float(image.sum())) < 1e-6
    assert compose_led.shift_x(image, 0.0) is image


def test_stage_open_closes_by_playing_the_opening_backwards():
    from types import SimpleNamespace

    from stage_open import FULL_AGE, StageOpen
    fake = SimpleNamespace(events=[(10.0, 20.0), (25.0, 31.0)], close_sec=1.2, close_end=0.1)
    age = lambda t: StageOpen.age(fake, t)  # noqa: E731
    assert age(9.9) is None and age(10.5) == 0.5
    assert age(18.5) >= FULL_AGE  # 閉じ始める(18.9 秒)前は開ききり
    middle = age(20.1 - 0.6)
    assert 0.0 < middle < FULL_AGE
    assert age(20.11) is None and age(24.9) is None
    assert age(26.0) == 1.0 and age(31.2) is None


def test_no_seconds_are_written_in_code():
    """別の timeline(全部を 7.3 秒ずらした)で、計画の秒が同じだけずれる。"""
    shift = 7.3
    base = fx_plan.FxPlan(make_shifted_timeline(0.0), make_two_trip_stage(0.0), [])
    moved = fx_plan.FxPlan(make_shifted_timeline(shift), make_two_trip_stage(shift), [])
    (a0, b0), (a1, b1) = base.body_range(), moved.body_range()
    assert abs(a1 - a0 - shift) < 1e-9 and abs(b1 - b0 - shift) < 1e-9
    assert len(base.curtain_events()) == len(moved.curtain_events()) == 2
    for p, q in zip(base.curtain_events(), moved.curtain_events()):
        assert abs(p[0] + shift - q[0]) < 1e-9 and abs(p[1] + shift - q[1]) < 1e-9
    assert all(abs(x + shift - y) < 1e-9 for x, y in zip(base.land_times, moved.land_times))
    for t in np.arange(1.0, 39.0, 0.25):
        assert abs(base.led_character_level(t) - moved.led_character_level(t + shift)) < 1e-6, t
        assert base.stage_character_present(t) == moved.stage_character_present(t + shift), t
        frame = int(round(t * FPS))
        assert abs(float(base.bg_level[frame]) - float(moved.bg_level[frame + int(round(shift * FPS))])) < 0.02, t


def test_background_is_black_outside_the_show():
    plan = fx_plan.FxPlan(make_shifted_timeline(0.0), make_two_trip_stage(0.0), [])
    assert plan.bg_level[int(0.2 * FPS)] == 0.0  # 待ち
    assert plan.bg_level[int(37.0 * FPS)] == 0.0  # 尾
    assert plan.bg_level[int(15.0 * FPS)] == 1.0  # 歌


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print("ok", test.__name__)
    print(f"全部 {len(tests)} 件 合格")
