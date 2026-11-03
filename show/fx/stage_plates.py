"""閉じた緞帳と開いた世界の 2 枚の静止画から、切り替えに要る物を作る(絵は固定、秒に関係しない)。

  python stage_plates.py --closed a.png --open b.png --out <フォルダ> [--lift 0.72]

出す物:
  bulbs.json       本物の電球の座標 [{x, y, flow, arch}, ...]。flow は光が流れる順(0 が先)
  warp_open.npy    開いた絵を閉じた絵の額縁に合わせるずらし(1/8 の大きさ、dx・dy の 2 枚、画素は 5680 の単位)
  fg_mask.png      額縁・ひも・電球の範囲(動かない物)
  inner_mask.png   額縁の開口の中(緞帳の幕)
  closed_lift.png  両脇を持ち上げた閉じた絵
  closed_clean.png 額縁とひもを消した閉じた絵(幕を動かすときの下地)
  report.json      測った数字
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from scipy.interpolate import RBFInterpolator

CENTER_X = 2159
FLOOR_Y = 1092  # 額縁の足元。これより下は床
BULB_BLUE = 45
BULB_GAP = 71
FG_GREEN = 12
HALO_REACH = 71  # 電球のまわりの光を幕から消す範囲。幕を動かすと光の輪が一緒に動くので
ARCH_REACH = 880
ARCH_WIDTH_MAX = 330
MATCH_REACH = 20.0
WARP_DIV = 8
ZONES = {"A": (945, 1279), "B_side_L": (1279, 1729), "B_side_R": (2589, 3039), "C": (4290, 5680)}


def read_image(path):
    image = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(path)
    return image


def write_image(path, image):
    ok, data = cv2.imencode(Path(path).suffix, image)
    if not ok:
        raise RuntimeError(path)
    data.tofile(str(path))


def find_bulbs(image):
    """電球の白い芯。金属の額縁は青が少ないので、青のチャンネルの山で拾う。"""
    blue = cv2.GaussianBlur(image[..., 0].astype(np.float32), (0, 0), 5.0)
    peaks = (blue == cv2.dilate(blue, np.ones((BULB_GAP, BULB_GAP), np.uint8))) & (blue > BULB_BLUE)
    peaks[FLOOR_Y:] = False
    rows = [(float(x), float(y)) for y, x in np.argwhere(peaks)]
    return np.array(sorted(rows), dtype=np.float64)


def match_points(points_a, points_b):
    """近い物どうしの組。"""
    pairs = []
    for point in points_a:
        distance = np.hypot(*(points_b - point).T)
        best = int(np.argmin(distance))
        if distance[best] < MATCH_REACH:
            pairs.append((point, points_b[best]))
    return np.array(pairs)


def warp_field(pairs, size):
    """開いた絵の中の、閉じた絵の点 (x, y) を読むときのずらし。電球の組をなめらかにつなぐ。"""
    width, height = size
    keys = pairs[:, 0]
    moves = pairs[:, 1] - pairs[:, 0]
    interpolate = RBFInterpolator(keys, moves, kernel="thin_plate_spline", smoothing=2.0)
    ys, xs = np.mgrid[0:height // WARP_DIV, 0:width // WARP_DIV]
    grid = np.stack([xs.ravel() * WARP_DIV + WARP_DIV / 2.0, ys.ravel() * WARP_DIV + WARP_DIV / 2.0], axis=1)
    field = interpolate(grid).reshape(height // WARP_DIV, width // WARP_DIV, 2)
    return field.astype(np.float32), float(np.abs(moves).max()), float(np.hypot(*moves.T).max())


def foreground_mask(image):
    """額縁・ひも・電球。赤い幕には緑がほとんど無いので、緑のチャンネルだけで分かれる。"""
    green = cv2.GaussianBlur(image[..., 1], (0, 0), 1.0)
    mask = (green > FG_GREEN).astype(np.uint8)
    mask[FLOOR_Y:] = 0
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    keep = np.zeros(count, np.uint8)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] > 300
    mask = cv2.morphologyEx(keep[labels], cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    return fill_arch(mask)


def fill_arch(mask):
    """額縁の中の暗い筋を埋める(行ごとに、開口の外の端から端まで)。"""
    filled = mask.copy()
    for y in range(mask.shape[0]):
        cols = np.where(mask[y, CENTER_X - ARCH_REACH:CENTER_X + ARCH_REACH])[0] + CENTER_X - ARCH_REACH
        for side in (cols[cols < CENTER_X], cols[cols > CENTER_X]):
            if side.size > 1 and np.ptp(side) < ARCH_WIDTH_MAX:
                filled[y, side.min():side.max() + 1] = 1
    return filled


def arch_mask(foreground):
    """fg のうち、中央の大きな塊(額縁)を塗りつぶす形で、開口を求める。"""
    height, width = foreground.shape
    blocked = cv2.dilate(foreground, np.ones((3, 3), np.uint8)).copy()
    blocked[FLOOR_Y:] = 1
    count, labels = cv2.connectedComponents((1 - blocked).astype(np.uint8), connectivity=4)
    inner_label = labels[int(FLOOR_Y * 0.7), CENTER_X]
    if inner_label == 0:
        raise RuntimeError("開口の中が見つかりません")
    return (labels == inner_label).astype(np.uint8)


def clean_plate(image, foreground):
    """額縁とひもを消す。1/4 の大きさで埋めて戻し、外は元のまま。"""
    height, width = image.shape[:2]
    grow = cv2.dilate(foreground, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (HALO_REACH, HALO_REACH)))
    small = cv2.resize(image, (width // 4, height // 4), interpolation=cv2.INTER_AREA)
    small_mask = cv2.resize(grow, (width // 4, height // 4), interpolation=cv2.INTER_NEAREST)
    filled = cv2.inpaint(small, cv2.dilate(small_mask, np.ones((3, 3), np.uint8)), 7, cv2.INPAINT_TELEA)
    filled = cv2.resize(cv2.GaussianBlur(filled, (0, 0), 1.5), (width, height), interpolation=cv2.INTER_CUBIC)
    soft = cv2.GaussianBlur(grow.astype(np.float32), (0, 0), 4.0)[..., None]
    return (image * (1.0 - soft) + filled * soft).clip(0, 255).astype(np.uint8)


def lift_dark(image, foreground, exponent):
    """額縁と電球を変えず、幕だけを持ち上げる(sRGB のべき乗)。"""
    soft = cv2.GaussianBlur(foreground.astype(np.float32), (0, 0), 3.0)[..., None]
    lifted = 255.0 * (image / 255.0) ** exponent
    return (image * soft + lifted * (1.0 - soft)).clip(0, 255).astype(np.uint8)


def zone_means(image):
    luma = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    means = {name: round(float(luma[:FLOOR_Y, a:b].mean()), 2) for name, (a, b) in ZONES.items()}
    means["all"] = round(float(luma.mean()), 2)
    return means


def flow_of(bulb, inner_top):
    """アーチは頂点から足へ、ひもは中央から外へ。"""
    x, y, on_arch = bulb
    if on_arch:
        return float(np.clip((y - inner_top) / (FLOOR_Y - inner_top) * 0.9, 0.0, 0.9))
    return float(np.clip(abs(x - CENTER_X) / 3500.0, 0.05, 1.0))


def write_bulbs(path, points, inner):
    inner_rows = np.where(inner.any(axis=1))[0]
    inner_cols = np.where(inner.any(axis=0))[0]
    half_width = max(inner_cols.max() - CENTER_X, CENTER_X - inner_cols.min())
    top = inner_rows.min()
    rows = []
    for x, y in points:
        on_arch = abs(x - CENTER_X) < half_width + 230 and y > top - 200
        rows.append({"x": round(float(x), 1), "y": round(float(y), 1), "arch": bool(on_arch),
                     "flow": round(flow_of((x, y, on_arch), top - 120), 3)})
    Path(path).write_text(json.dumps(rows, ensure_ascii=False, indent=0), encoding="utf-8")
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--closed", required=True)
    parser.add_argument("--open", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--lift", type=float, default=0.62, help="幕の持ち上げ(sRGB のべき乗。1 で変えない)")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    closed, opened = read_image(args.closed), read_image(args.open)
    size = (closed.shape[1], closed.shape[0])
    bulbs_closed, bulbs_open = find_bulbs(closed), find_bulbs(opened)
    pairs = match_points(bulbs_closed, bulbs_open)
    field, max_axis, max_move = warp_field(pairs, size)
    np.save(args.out / "warp_open.npy", field)
    foreground = foreground_mask(closed)
    inner = arch_mask(foreground)
    write_image(args.out / "fg_mask.png", foreground * 255)
    write_image(args.out / "inner_mask.png", inner * 255)
    lifted = lift_dark(closed, foreground, args.lift)
    write_image(args.out / "closed_lift.png", lifted)
    write_image(args.out / "closed_clean.png", clean_plate(lifted, foreground))
    rows = write_bulbs(args.out / "bulbs.json", bulbs_closed, inner)
    report = {"bulbs_closed": len(bulbs_closed), "bulbs_open": len(bulbs_open), "pairs": len(pairs),
              "bulb_move_max_px": round(max_move, 2), "arch_bulbs": sum(r["arch"] for r in rows),
              "means_before": zone_means(closed), "means_after": zone_means(lifted), "means_open": zone_means(opened),
              "lift": args.lift, "foreground_pct": round(float(foreground.mean()) * 100.0, 2)}
    (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
