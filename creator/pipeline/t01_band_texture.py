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
END_MARGIN = 0.04          # 帯の縁がこれ(幅に対して)より内へ食いこんだら、端の形とみなして塗りかえる
END_DEPTH = 0.12          # 食いこんだ縁から、この深さ(幅に対して)までを塗りかえる。縁の濃い線(破れて見える所)が 5〜7 画素ある
END_RAMP = 0.15           # 字の外の端をなだらかに塗りかえる幅(絵の高さに対して)
END_NEAR_TEXT = 0.02      # 字の縁からこの幅(絵の高さに対して)は塗りかえない
END_SHADE = 0.25          # 字の両端からこの幅(絵の高さに対して)の内で、陰を探す
SHADE_DARK = 10           # 行の地の色より、これ以上暗い所を陰とみなす(0〜255)
END_TEXT_PAD = 0.08       # 字の両端から、この割合(絵の高さに対して)だけ外は、無地の帯にする


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


def clean_ends(tex, offset, lo, hi, mid, width, is_text):
    """帯の両端を、無地の帯にそろえる。
    元の絵の帯の端は、肩で折り返す・腰で回り込む形と、その縁の濃い線を持つ。そのまま 3D の帯に貼ると、
    端が「破れた」「斜めに切れた」ように見える(ようこそくんの肩で実際に起きた)。
    字のない両端と、帯の縁が内へ食いこんだ所を、字のある所の「行ごとの地の色」で塗りかえる。
    塗りかえた端は、画像の extension = EXTEND で背中まで伸ばしても継ぎ目が出ない。"""
    from PIL import ImageFilter
    h, w = is_text.shape
    margin = END_MARGIN * width
    indent_lo = lo > mid - width / 2 + margin       # 上の縁が内へ食いこんだ列
    indent_hi = hi < mid + width / 2 - margin
    depth = END_DEPTH * width
    edge = (indent_lo & (offset < lo + depth)) | (indent_hi & (offset > hi - depth))
    cols = np.nonzero(is_text.any(0))[0]
    pad = int(END_TEXT_PAD * h)
    if len(cols) == 0:
        c0, c1 = int(w * 0.2), int(w * 0.8)
    else:
        c0, c1 = max(int(cols[0]) - pad, 1), min(int(cols[-1]) + pad, w - 2)
    replace = edge.copy()
    replace[:, :c0] = True
    replace[:, c1 + 1:] = True
    xs = np.arange(w)
    ramp = END_RAMP * h                                     # 字の外の端は、広い幅でなだらかに塗りかえる(縦の継ぎ目を出さない)
    near = END_NEAR_TEXT * h                                # 字の縁からこの幅は元の絵のまま
    t0, t1 = (c0 + pad, c1 - pad) if len(cols) else (c0, c1)
    col_w = np.clip(np.maximum((t0 - near - xs) / ramp, (xs - t1 - near) / ramp), 0, 1)
    near_text = np.array(Image.fromarray((is_text * 255).astype("uint8")).filter(ImageFilter.MaxFilter(13))) > 0
    core = ~replace & ~near_text
    core[:, :c0] = False
    core[:, c1 + 1:] = False
    vals = np.where(core[..., None], tex, np.nan)
    profile = np.nanmedian(vals, axis=1)                    # 行ごとの地の色(縁のふくらみの陰も行ごとに残る)
    bad = np.isnan(profile).any(1)
    if bad.any():
        profile[bad] = np.nanmedian(profile, axis=0)
    # 字のすぐ外に残る、折り返しの陰(周りの行の地の色より暗い、なだらかな所)も塗りかえる。残すと 3D で小さな折れ目に見えた
    shade_w = END_SHADE * h
    in_end = (xs < t0 + shade_w) | (xs > t1 - shade_w)
    lum = tex.mean(2) - profile.mean(1)[:, None]
    lum = np.array(Image.fromarray(np.clip(lum + 128, 0, 255).astype("uint8")).filter(ImageFilter.GaussianBlur(3))).astype(float) - 128
    shade = in_end[None, :] & (lum < -SHADE_DARK) & ~near_text
    edge = edge | shade
    soft_edge = np.array(Image.fromarray((edge * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(4))) / 255.0
    weight = np.maximum(np.maximum(soft_edge, edge), col_w[None, :])   # 食いこんだ縁は必ず塗りかえ、境だけをぼかす
    weight[is_text] = 0.0
    # 無地だと、字のある所のフェルトの粒と並べて樹脂のように見えるので、字のない所の粒(地の色からの差)を散らして足す
    grain = (tex - profile[:, None, :])[core]
    pick = np.random.default_rng(7).integers(0, len(grain), size=h * w)
    fill = profile[:, None, :] + grain[pick].reshape(h, w, 3)
    fill[:, :3] = profile[:, None, :]       # 端の列は粒なし。EXTEND で伸ばすと、粒が長さ方向の筋になる
    fill[:, -3:] = profile[:, None, :]
    return tex * (1 - weight[..., None]) + fill * weight[..., None]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("out")
    ap.add_argument("--color", required=True, help="帯の地の色 R,G,B")
    ap.add_argument("--tol", type=float, default=70.0)
    ap.add_argument("--json")
    ap.add_argument("--points", type=int, default=12)
    ap.add_argument("--raw-ends", action="store_true", help="端を整えない(元の絵の端の形と縁の線をそのまま残す。前の動き)")
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
    if not args.raw_ends:
        tex = clean_ends(tex, offset, np.interp(grid_u, idx, lo), np.interp(grid_u, idx, hi),
                         np.interp(grid_u, idx, mid), width, is_text)
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
