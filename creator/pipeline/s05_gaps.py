"""元の絵と比べて「抜け」を探す。元の絵では体なのに、3D では背景が見える、太い場所を数える(肩・首・股の抜け)。

使い方: python s05_gaps.py <元の絵> <作った物の透明背景の絵> [--out 重ねた絵.png] [--json 出力.json] [--thick 5]
輪郭の重なり(s03)は全体の割合なので、肩の小さな抜けは見逃す。ここでは場所ごとに見る。
縁が少しずれただけの細い差は数えない。「抜け」は次のどちらか(高さ 500px にそろえた絵で):
  太い: 太さ thick px 以上。 囲まれた: 8 方向のうち 5 方向以上で、近く(REACH px 以内)に体がある、面積 MIN_POCKET px 以上の場所(肩のくさびなど)。
終わりの番号: 0 = 抜けなし、1 = 抜けあり。元の絵とポーズが違えば、腕の場所は抜けと出る(絵に合わせるか、目で確かめる)。
"""
import json
import sys

import numpy as np
from PIL import Image

from s03_compare_core import norm_mask, silhouette

SIZE = 500
THICK_DEFAULT = 5
REACH = 40           # 囲まれているかを見る距離(px)
MIN_DIRS = 5         # 8 方向のうち、体に当たる方向の数
MIN_POCKET = 60      # 囲まれた抜けとして数える最小の面積(px)。小さいと、縁の細かいでこぼこまで拾う
OPEN_PX = 2          # 毛羽の細かい点を「体」と数えないよう、この太さより細い所を除いてから囲みを見る
DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))


def erode(m, times):
    out = m.copy()
    for _ in range(times):
        out = out & np.roll(out, 1, 0) & np.roll(out, -1, 0) & np.roll(out, 1, 1) & np.roll(out, -1, 1)
    return out


def components(m):
    """つながった場所ごとに、点の一覧を返す(4 近傍)。"""
    seen = np.zeros(m.shape, bool)
    h, w = m.shape
    found = []
    for y, x in zip(*np.nonzero(m)):
        if seen[y, x]:
            continue
        stack, pts = [(y, x)], []
        seen[y, x] = True
        while stack:
            cy, cx = stack.pop()
            pts.append((cy, cx))
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        found.append(pts)
    return found


def dilate(m, times):
    out = m.copy()
    for _ in range(times):
        out = out | np.roll(out, 1, 0) | np.roll(out, -1, 0) | np.roll(out, 1, 1) | np.roll(out, -1, 1)
    return out


def surrounded(built, y, x):
    """この点から 8 方向を見て、近くに体がある方向の数。"""
    h, w = built.shape
    count = 0
    for dy, dx in DIRS:
        for t in range(1, REACH + 1):
            ny, nx = y + dy * t, x + dx * t
            if not (0 <= ny < h and 0 <= nx < w):
                break
            if built[ny, nx]:
                count += 1
                break
    return count


def find_gaps(base, built, thick):
    missing = base & ~built
    cores = erode(missing, thick)
    solid = dilate(erode(built, OPEN_PX), OPEN_PX)
    gaps = []
    for pts in components(missing):
        ys = np.array([p[0] for p in pts])
        xs = np.array([p[1] for p in pts])
        kind = "太い" if cores[ys, xs].any() else None
        pocket = [(y, x) for y, x in pts if surrounded(solid, y, x) >= MIN_DIRS]
        if kind is None and len(pocket) >= MIN_POCKET:
            kind = "囲まれた"
        if kind is None:
            continue
        gaps.append(dict(kind=kind, x_pct=round(float(xs.mean()) / SIZE * 100, 1), y_pct=round(float(ys.mean()) / SIZE * 100, 1),
                         area_px=len(pts), pocket_px=len(pocket), pts=(ys, xs)))
    return sorted(gaps, key=lambda g: -g["area_px"])


def main():
    a = sys.argv[1:]
    opt = {}
    for key in ("--out", "--json", "--thick"):
        if key in a:
            i = a.index(key)
            opt[key] = a[i + 1]
            del a[i:i + 2]
    base = norm_mask(silhouette(Image.open(a[0])))
    built = norm_mask(silhouette(Image.open(a[1])))
    gaps = find_gaps(base, built, int(opt.get("--thick", THICK_DEFAULT)))
    area = int(base.sum())
    total = sum(g["area_px"] for g in gaps)
    print(f"S05 抜け {len(gaps)} か所、合計 {total} px(体の {total / max(area, 1) * 100:.1f}%)")
    for g in gaps:
        print(f"  {g['kind']}: 左から {g['x_pct']}%、上から {g['y_pct']}%、{g['area_px']} px(囲まれた所 {g['pocket_px']} px)")
    if "--out" in opt:
        img = np.full((SIZE, SIZE, 3), 235, np.uint8)
        img[built] = (150, 170, 200)
        img[base & ~built] = (250, 200, 120)
        for g in gaps:
            img[g["pts"]] = (220, 30, 30)
        Image.fromarray(img).resize((1000, 1000), Image.NEAREST).save(opt["--out"])
    if "--json" in opt:
        rows = [{k: v for k, v in g.items() if k != "pts"} for g in gaps]
        json.dump(dict(gaps=rows, total_px=total, visual_pass=False, not_checked=["正面だけを見る", "動いたときの抜けは見ない"]),
                  open(opt["--json"], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    sys.exit(1 if gaps else 0)


if __name__ == "__main__":
    main()
