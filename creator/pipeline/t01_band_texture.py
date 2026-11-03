"""元の絵に描かれた帯(たすき・ベルトなど)を、まっすぐに伸ばして絵として切り出す。帯の中心の道と幅も測る。

使い方: python creator/pipeline/t01_band_texture.py <元の絵> <出力.png> --color R,G,B [--tol 70] [--json 出力.json] [--points 12]
出力: 帯の絵(長さの向きが横)と、JSON(path = 帯の中心の道の画素の点、width_px = 帯の幅の画素)。
文字を書き直すより、元の絵の字をそのまま使うほうが近い。太さと道も、測った数字をそのまま builder に渡せる。
帯の中の文字(白など)は穴になるが、断面ごとに帯の色の両端を測るので、穴は気にしなくてよい。
"""
import argparse
import json

import numpy as np
from PIL import Image

MIN_REGION_RATIO = 0.002   # 絵の面積のこれ未満なら、帯が見つからないとして止める
END_TRIM = 0.15            # 両端は体の陰や丸みで測れないので、両端のこの割合は使わず、なめらかに伸ばす
MID_FIT_DEGREE = 3
TEXT_BAND = 0.36           # 帯の中心からこの割合(幅に対して)の内にある明るい色だけ、文字として残す
TEXT_END = 0.07            # 両端のこの割合に明るい色があれば、字ではなく背景とみなす
WHITE_SAT = 40             # 文字とみなす色の、最大と最小の差
OUT_HEIGHT = 400


def largest_region(mask):
    """いちばん大きな塊だけを残す(頬など、離れた同じ色を外す)。"""
    h, w = mask.shape
    labels = np.zeros((h, w), int)
    best, best_size, cur = 0, 0, 0
    for sy, sx in zip(*np.nonzero(mask)):
        if labels[sy, sx]:
            continue
        cur += 1
        stack = [(sy, sx)]
        labels[sy, sx] = cur
        size = 0
        while stack:
            y, x = stack.pop()
            size += 1
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = cur
                    stack.append((ny, nx))
        if size > best_size:
            best, best_size = cur, size
    return labels == best


def sample(arr, xs, ys):
    """双線形で色を読む。"""
    h, w = arr.shape[:2]
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 2)
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 2)
    fx = np.clip(xs - x0, 0, 1)[..., None]
    fy = np.clip(ys - y0, 0, 1)[..., None]
    top = arr[y0, x0] * (1 - fx) + arr[y0, x0 + 1] * fx
    low = arr[y0 + 1, x0] * (1 - fx) + arr[y0 + 1, x0 + 1] * fx
    return top * (1 - fy) + low * fy


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("out")
    ap.add_argument("--color", required=True, help="帯の地の色 R,G,B")
    ap.add_argument("--tol", type=float, default=70.0)
    ap.add_argument("--json")
    ap.add_argument("--points", type=int, default=12)
    args = ap.parse_args()
    arr = np.array(Image.open(args.image).convert("RGB")).astype(float)
    color = np.array([float(v) for v in args.color.split(",")])
    mask = largest_region(np.linalg.norm(arr - color, axis=2) < args.tol)
    if mask.sum() < MIN_REGION_RATIO * mask.size:
        raise SystemExit(f"帯の色が見つかりません(--color か --tol を直す): {int(mask.sum())} 画素")
    ys, xs = np.nonzero(mask)
    pts = np.stack([xs, ys], 1).astype(float)
    center = pts.mean(0)
    _, _, vt = np.linalg.svd(pts - center, full_matrices=False)
    along, across = vt[0], vt[1]
    if along[0] < 0:   # 左から右へそろえる
        along = -along
    across = np.array([-along[1], along[0]])   # 下向きが正
    u = (pts - center) @ along
    v = (pts - center) @ across
    u0, u1 = u.min(), u.max()
    n = int(u1 - u0) + 1
    lo, hi = np.full(n, np.nan), np.full(n, np.nan)
    bins = np.clip((u - u0).astype(int), 0, n - 1)
    np.fmin.at(lo, bins, v)
    np.fmax.at(hi, bins, v)
    good = ~np.isnan(lo)
    idx = np.arange(n)
    lo = np.interp(idx, idx[good], lo[good])
    hi = np.interp(idx, idx[good], hi[good])
    trim = int(n * END_TRIM)
    inner = idx[trim:n - trim]
    width = float(np.median((hi - lo)[inner]))
    mid = np.polyval(np.polyfit(inner, ((lo + hi) / 2)[inner], MID_FIT_DEGREE), idx)
    # 幅は真ん中の値にそろえる。端が丸いと、測った幅どおりに伸ばすと字が歪む
    out_w = int(OUT_HEIGHT * n / width)
    tu = np.linspace(0, n - 1, out_w)
    tv = np.linspace(-0.5, 0.5, OUT_HEIGHT)
    grid_u, grid_v = np.meshgrid(tu, tv)
    offset = np.interp(grid_u.ravel(), idx, mid).reshape(grid_u.shape) + grid_v * width
    px = center[0] + (u0 + grid_u) * along[0] + offset * across[0]
    py = center[1] + (u0 + grid_u) * along[1] + offset * across[1]
    tex = sample(arr, px, py)
    # 帯の地の色から外れた所は、体や背景が映りこんだ所。地の色で埋める(真ん中の明るい色は文字なので残す)
    off_band = np.linalg.norm(tex - color, axis=2) > args.tol
    is_text = (tex.max(2) - tex.min(2) < WHITE_SAT) & (np.abs(grid_v) < TEXT_BAND) & (tex.min(2) > 150) & (grid_u > n * TEXT_END) & (grid_u < n * (1 - TEXT_END))
    tex[off_band & ~is_text] = np.median(tex[~off_band], axis=0)
    Image.fromarray(np.clip(tex, 0, 255).astype("uint8")).save(args.out)
    keys = np.linspace(0, n - 1, args.points)
    path = [[round(float(center[0] + (u0 + k) * along[0] + np.interp(k, idx, mid) * across[0]), 1),
             round(float(center[1] + (u0 + k) * along[1] + np.interp(k, idx, mid) * across[1]), 1)] for k in keys]
    report = dict(path=path, width_px=round(width, 1), length_px=n, image_size=[out_w, OUT_HEIGHT])
    print(json.dumps(report, ensure_ascii=False))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
