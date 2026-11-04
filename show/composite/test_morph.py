#!/usr/bin/env python
"""変身の重ね(morph.py と composite.py の morph 引数)の試験。UE も素材の連番も要らない(作った人の形で確かめる)。

動かし方: PYTHONIOENCODING=utf8 work/AI/venv-sep/Scripts/python.exe -X utf8 show/composite/test_morph.py
"""
import pathlib
import sys

import cv2
import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]
import composite  # noqa: E402
import morph  # noqa: E402

H, W = 360, 300  # 小さい絵(キャラは縦 240 画素。1920 幅の本番と同じ大きさ)
STEPS = 36  # 4 打 = 1.2 秒 = 30p で 36 コマ


def person(tint, seed=1):
    """人の形(頭・胴・スカート・足)。色には縞と細かい模様を付ける(一色だと塊の移りが見えない)。かぶせ済みの色と透明。"""
    alpha = np.zeros((H, W), np.float32)
    cv2.circle(alpha, (150, 70), 28, 1.0, -1)
    cv2.rectangle(alpha, (125, 95), (175, 170), 1.0, -1)
    cv2.fillConvexPoly(alpha, np.array([[125, 150], [175, 150], [215, 290], [85, 290]]), 1.0)
    cv2.rectangle(alpha, (128, 290), (142, 310), 1.0, -1)
    cv2.rectangle(alpha, (158, 290), (172, 310), 1.0, -1)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.8)[..., None]
    rng = np.random.default_rng(seed)
    pattern = 0.75 + 0.25 * np.sin(np.arange(H, dtype=np.float32) / 6.0)[:, None, None] + 0.1 * rng.random((H, W, 1)).astype(np.float32)
    color = np.clip(np.array(tint, np.float32)[None, None, :] * pattern, 0.0, 1.0)
    return (color * alpha).astype(np.float32), alpha


A = person((0.9, 0.35, 0.7))
B = person((0.7, 0.72, 0.78), seed=2)


def test_ends_are_exactly_the_inputs():
    assert np.array_equal(morph.morph_layer(*A, *B, 0.0)[0], A[0]) and np.array_equal(morph.morph_layer(*A, *B, 1.0)[1], B[1])


def test_same_frame_is_same_picture_in_any_order_and_run():
    first = morph.morph_layer(*A, *B, 0.5)
    for p in (0.1, 0.9, 0.31):  # 途中のコマだけを作る・別のコマの後に作る、どちらも同じ
        morph.morph_layer(*A, *B, p)
    again = morph.morph_layer(*A, *B, 0.5)
    assert np.array_equal(first[0], again[0]) and np.array_equal(first[1], again[1])


def test_state_schedule():
    morphs = [{"start": 10.0, "end": 11.2, "to": "human"}, {"start": 20.0, "end": 21.2, "to": "anime"}]
    assert morph.state_at(morphs, 9.9) == ("anime", None)
    kind, src, dst, p = morph.state_at(morphs, 10.6)
    assert (kind, src, dst) == ("morph", "anime", "human") and abs(p - 0.5) < 1e-9
    assert morph.state_at(morphs, 11.2) == ("human", None) and morph.state_at(morphs, 15.0) == ("human", None)
    assert morph.state_at(morphs, 20.6)[:3] == ("morph", "human", "anime") and morph.state_at(morphs, 21.2) == ("anime", None)
    assert morph.state_at([], 5.0) == ("anime", None) and morph.state_at(None, 5.0) == ("anime", None)
    assert morph.state_at([{"start": 1.0, "end": 2.0, "to": "anime"}], 1.5) == ("anime", None)  # すでにその姿なら何もしない


def test_no_frame_goes_blank_and_nothing_flashes_white():
    base = float((A[1] > 0.5).sum())
    limit = max(A[0].max(), B[0].max()) + 1e-3
    means = []
    for k in range(STEPS + 1):
        color, alpha = morph.morph_layer(*A, *B, k / STEPS)
        assert (alpha > 0.5).sum() >= 0.7 * base, (k, (alpha > 0.5).sum() / base)  # どのコマも体の 7 割以上が見えている
        assert color.max() <= limit  # 純白・加算の光を出さない
        assert (alpha < 1.0 + 1e-3).all() and (alpha > -1e-3).all()
        means.append(float(color.mean()))
    steps = np.abs(np.diff(means))
    assert steps.max() < 0.06 * np.mean(means), (steps.max(), means[0], means[-1])  # 平均の明るさが 1 コマで 6% を超えて跳ねない(本番の絵での合格線は別に測る)


def test_dissolve_is_not_a_hard_horizontal_line():
    """体の中心から外へ広がる。足から・頭からの帯(硬い横線)にならない。"""
    inside = A[1][..., 0] > 0.5
    for p in (0.25, 0.4, 0.55):
        _, alpha = morph.morph_layer(*A, *B, p)
        gone = ((alpha[..., 0] < 0.8) & inside).astype(np.float32)
        rows = inside.sum(axis=1)
        keep = rows > 20
        fraction = (gone.sum(axis=1)[keep] / rows[keep])
        smoothed = np.convolve(fraction, np.ones(5) / 5.0, mode="same")
        assert np.abs(np.diff(smoothed)).max() < 0.2, (p, np.abs(np.diff(smoothed)).max())
    # 順の高さの成分が弱い: 上半分と下半分で、変わり始める進みが違いすぎない
    ys = np.where(inside.any(axis=1))[0]
    mid = (ys.min() + ys.max()) // 2
    _, alpha = morph.morph_layer(*A, *B, 0.3)
    gone = ((alpha[..., 0] < 0.8) & inside)
    upper, lower = gone[:mid].sum() / max(inside[:mid].sum(), 1), gone[mid:].sum() / max(inside[mid:].sum(), 1)
    assert 0.3 < (upper + 1e-6) / (lower + 1e-6) < 3.5, (upper, lower)


def test_particles_are_2_to_5_px_and_thousands_for_a_body():
    assert morph.SIZES.min() >= 2 and morph.SIZES.max() <= 5 and morph.CELL <= 5
    assert morph.particle_count(A[1]) >= 2000


def test_particles_rise_above_the_body_and_carry_the_colours():
    """途中では体の上に粒が舞い、色は A と B の間にある(別の色が混ざらない)。"""
    top = int(np.where((A[1][..., 0] > 0.5).any(axis=1))[0].min())
    _, alpha = morph.morph_layer(*A, *B, 0.45)
    assert (alpha[:top - 4] > 0.3).sum() > 20  # 頭より上に粒がある
    color, alpha = morph.morph_layer(*A, *B, 0.5)
    straight = color / np.maximum(alpha, 1e-3)
    lo = np.minimum(A[0] / np.maximum(A[1], 1e-3), B[0] / np.maximum(B[1], 1e-3)).min(axis=(0, 1)) - 0.12
    hi = np.maximum(A[0] / np.maximum(A[1], 1e-3), B[0] / np.maximum(B[1], 1e-3)).max(axis=(0, 1)) + 0.12
    solid = alpha[..., 0] > 0.9
    assert (straight[solid] >= lo - 1e-3).all() and (straight[solid] <= hi + 1e-3).all()


def fake_frames(tint, seed):
    """composite.compose に渡せる小さな連番(5 つのパス)。"""
    color, alpha = person(tint, seed)
    rng = np.random.default_rng(5)
    stage = (0.15 + 0.1 * rng.random((H, W, 3))).astype(np.float32)
    return {"with": np.clip(stage * (1 - alpha) + color, 0, 1).astype(np.float32), "without": stage,
            "matte": np.repeat(alpha, 3, axis=2), "shadow_with": np.full((H, W, 3), 0.4, np.float32),
            "shadow_without": np.full((H, W, 3), 0.5, np.float32)}


def test_compose_without_morph_or_at_the_ends_is_unchanged():
    a, b = fake_frames((0.9, 0.35, 0.7), 1), fake_frames((0.7, 0.72, 0.78), 2)
    plate = np.full((H, W, 3), 0.2, np.float32)
    plain = composite.compose(plate, a)
    assert np.array_equal(composite.compose(plate, a, morph=(b, 0.0)), plain)  # 進み 0 は A そのもの
    assert np.array_equal(composite.compose(plate, a, morph=(b, 1.0)), composite.compose(plate, b))  # 進み 1 は B そのもの(影・床まで)
    mid = composite.compose(plate, a, morph=(b, 0.5))
    assert mid.shape == plain.shape and np.isfinite(mid).all() and 0.0 <= mid.min() and mid.max() <= 1.0


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print("ok", t.__name__)
    print(f"全部 {len(tests)} 件 合格")
