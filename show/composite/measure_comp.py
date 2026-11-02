"""合成の位置を、正解のカメラの数字と比べて測る。

目印: 床の上の球の中心を、記録から読んだカメラで撮った絵で見つけ、正解のカメラで計算した画素と比べる(足と同じ床の高さ)。
足: キャラの透明の下の端を、キャラが立つ位置の計算と比べ、揺れと一定のずれを出す。
ロール: 記録に 10 度のロールを入れて撮り、符号を確かめる。

歪みがあるときは --stmap(撮った絵にかける表)と --truth-lens(正解のレンズ)を渡す。

使い方: python measure_comp.py <撮影フォルダ> <パスの連番のフォルダ> <comp_config.json> [--stmap stmap.npy --truth-lens レンズ.json]
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from lens import distorted_pixels, scale_lens
from ue_axes import project_ue, rotator_axes

STAGE_Z = 90.0
MARKER_RADIUS_CM = 6.0
CHARACTER_FLOOR = (0.0, 180.0, STAGE_Z)
THRESHOLD = 128


def project(rows_entry, points, fx, width, height, roll=None, lens=None):
    r = rows_entry
    axes = rotator_axes(r["pitch"], r["yaw"], r["roll"] if roll is None else roll)
    if lens is None:
        pixels, _ = project_ue(points, (r["x"], r["y"], r["z"]), *axes, fx, fx, width / 2.0, height / 2.0)
        return pixels
    normalized, _ = project_ue(points, (r["x"], r["y"], r["z"]), *axes, 1.0, 1.0, 0.0, 0.0)
    return distorted_pixels(normalized, lens)


def load_gray(path, table=None):
    gray = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    return gray if table is None else cv2.remap(gray, table[..., 0], table[..., 1], cv2.INTER_LINEAR)


def marker_centers(path, table=None):
    gray = load_gray(path, table)
    _, mask = cv2.threshold(gray, THRESHOLD, 255, cv2.THRESH_BINARY)
    count, _, _, centers = cv2.connectedComponentsWithStats(mask, connectivity=8)
    return centers[1:count]


def nearest_errors(found, wanted):
    if len(found) == 0:
        return np.full(len(wanted), np.inf)
    distance = np.linalg.norm(wanted[:, None, :] - found[None, :, :], axis=2)
    return distance.min(axis=1)


def measure_markers(frames, rows, points, fx, width, height, table=None, lens=None):
    errors = []
    for index, row in enumerate(rows):
        path = frames / f"f.{index:04d}.png"
        if not path.exists():
            break
        errors.append(nearest_errors(marker_centers(path, table), project(row, points, fx, width, height, lens=lens)))
    return np.array(errors)


def measure_roll(frames, rows, points, fx, width, height, roll, table=None, lens=None):
    found = marker_centers(frames / "f.0002.png", table)
    row = rows[0]
    return {f"{sign:+.0f}": round(float(nearest_errors(found, project(row, points, fx, width, height, sign, lens)).mean()), 2)
            for sign in (roll, -roll)}


def measure_feet(frames, rows, fx, width, height, table=None, lens=None):
    """透明の下の端の中央(x と y)と、立つ位置の計算との差。"""
    offsets = []
    for index, row in enumerate(rows):
        path = frames / f"f.{index:04d}.png"
        if not path.exists():
            break
        gray = load_gray(path, table)
        ys, xs = np.nonzero(gray > THRESHOLD)
        if ys.size == 0:
            continue
        bottom = ys.max()
        foot_x = xs[ys >= bottom - 2].mean()
        expected = project(row, np.array([CHARACTER_FLOOR]), fx, width, height, lens=lens)[0]
        offsets.append((foot_x - expected[0], bottom - expected[1]))
    return np.array(offsets)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("shoot", type=Path)
    parser.add_argument("frames", type=Path)
    parser.add_argument("config", type=Path)
    parser.add_argument("--stmap", type=Path)
    parser.add_argument("--truth-lens", type=Path)
    args = parser.parse_args()
    table = np.load(args.stmap) if args.stmap else None
    truth = json.loads((args.shoot / "truth.json").read_text(encoding="utf-8"))
    config = json.loads(args.config.read_text(encoding="utf-8"))
    rows, fx, width, height = truth["rows"], truth["fx"], truth["width"], truth["height"]
    points = np.array([[x, y, STAGE_Z + MARKER_RADIUS_CM] for x, y in config["markers_xy"]])
    lens = None
    if args.truth_lens:
        lens = scale_lens(json.loads(args.truth_lens.read_text(encoding="utf-8")), width)
    result = {}
    if (args.frames / "Comp_RollTest").exists():
        result["roll_error_px_by_sign"] = measure_roll(args.frames / "Comp_RollTest", rows, points, fx, width, height,
                                                       config["roll_test_deg"], table, lens)
    if (args.frames / "Comp_MatteMarks").exists():
        errors = measure_markers(args.frames / "Comp_MatteMarks", rows, points, fx, width, height, table, lens)
        result["markers"] = {"frames": len(errors), "mean_px": round(float(errors.mean()), 3),
                             "p95_px": round(float(np.percentile(errors, 95)), 3), "max_px": round(float(errors.max()), 3)}
        lost = errors[int(5.0 * 30):int(5.3 * 30)]
        result["markers"]["during_tracking_gap_max_px"] = round(float(lost.max()), 3) if lost.size else None
    if (args.frames / "Comp_MatteChar").exists():
        feet = measure_feet(args.frames / "Comp_MatteChar", rows, fx, width, height, table, lens)
        result["feet"] = {"frames": len(feet), "mean_offset_px": [round(float(v), 2) for v in feet.mean(axis=0)],
                          "std_px": [round(float(v), 2) for v in feet.std(axis=0)]}
    print(json.dumps(result, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
