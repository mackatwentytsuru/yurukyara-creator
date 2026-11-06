"""描いた SVG と、その PNG が「測れる形」かを点検する。見た目の良し悪しは見ない(それは目と判定役)。

使い方: python creator/pipeline/d02_check_svg.py <元の絵.svg> [<元の絵.png>] [--json 出力.json]
  PNG を省くと、SVG と同じ名前の .png を使う。<名前>_noshadow.png があれば、体の測りはそちらで行う
  (影を外した絵。d01_svg_to_png.py --noshadow)。余白は影つきの絵でも測る。
結果の印: OK / 注意(WARN)/ 不合格(FAIL)。1 つでも FAIL があれば終わりの番号 1。

点検する物
  部品: <g id="char"> の下が、決まった名前の <g id>(d03_svgkit.PARTS = K1 の looks.2d.parts)だけ。
       要る部品(body・eye_L・eye_R・mouth)がある / 同じ名前が 2 つ無い / 部品の外に描いた物が無い(2026-11-06 に足した)
  SVG: <image>・<foreignObject>・<script>・外への参照が無い / 文字は <text> でなくパス / viewBox が 0 0 1254 1254
       / 白い背景の <rect> から始まる / グラデーションがある / 輪郭線(stroke)だらけでない
  PNG: 1254×1254・四隅が白 / 余白 5% 以上(体と影つきの両方)/ 左右の釣り合い(鏡に映した重なり)
       / 輪郭が白背景から分かれる(体の縁の画素が白から離れている割合)/ 浮いた部品の数
       / 体の高さ / 色数の目安 / 目に当たる暗い点(2 つ以上、顔が読めるかの目安。注意どまり)
"""
import argparse
import colorsys
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent))
from d03_svgkit import PARTS, REQUIRED, FACE  # noqa: E402

SIZE = 1254
MARGIN_PX = round(SIZE * 0.05)      # 63
BG_DIFF = 40                        # 白からの色の差(RGB の差の合計)がこれを超えたら体
RING_PX = 3                         # 体の縁から内へ 3 画素の所で、白との差を見る
RING_DIST = 70                      # その画素の色が、白からこの距離(RGB のユークリッド)以上離れていればよい
MIRROR_OK, MIRROR_FAIL = 0.85, 0.70
EDGE_OK, EDGE_FAIL = 0.90, 0.75
DARK_LUM = 70

results = []


def rec(level, name, value, note=""):
    results.append({"level": level, "name": name, "value": value, "note": note})


def local(tag):
    return tag.split("}", 1)[-1]


def check_svg(path):
    text = Path(path).read_text(encoding="utf-8")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        rec("FAIL", "SVG が読める", str(e))
        return
    tags = [local(e.tag) for e in root.iter()]
    for bad, why in (("image", "画像の取り込みは使わない"), ("foreignObject", "HTML の埋め込みは使わない"),
                     ("script", "スクリプトは使わない")):
        n = tags.count(bad)
        rec("FAIL" if n else "OK", f"<{bad}> が無い", n, why if n else "")
    n_text = tags.count("text") + tags.count("tspan")
    rec("FAIL" if n_text else "OK", "文字は <text> でなくパス", n_text, "フォントに頼らない。字はパスにする" if n_text else "")
    ext = []
    for e in root.iter():
        for k, v in e.attrib.items():
            if local(k) == "href" and not v.startswith("#"):
                ext.append(v[:40])
    rec("FAIL" if ext else "OK", "外への参照が無い", len(ext), ", ".join(ext[:3]))
    vb = (root.get("viewBox") or "").split()
    ok_vb = [float(x) for x in vb] == [0, 0, SIZE, SIZE] if len(vb) == 4 else False
    rec("OK" if ok_vb else "FAIL", f"viewBox が 0 0 {SIZE} {SIZE}", root.get("viewBox"))
    shapes = [e for e in root.iter() if local(e.tag) in ("rect", "circle", "ellipse", "path", "polygon", "polyline", "line")]
    first = next((e for e in root.iter() if local(e.tag) in ("rect", "circle", "ellipse", "path", "polygon")
                  and not any(local(p.tag) in ("defs", "clipPath", "mask", "filter") for p in [])), None)
    # defs の中の図形は数えない
    in_defs = set()
    for d in root.iter():
        if local(d.tag) in ("defs", "clipPath", "mask", "filter", "symbol", "pattern"):
            in_defs.update(id(x) for x in d.iter())
    drawn = [e for e in shapes if id(e) not in in_defs]
    first = drawn[0] if drawn else None
    white_bg = bool(first is not None and local(first.tag) == "rect"
                    and (first.get("fill", "").lower() in ("#fff", "#ffffff", "white"))
                    and float(first.get("width", "0").rstrip("%") or 0) >= SIZE * 0.99 or
                    (first is not None and local(first.tag) == "rect" and first.get("width") == "100%"))
    rec("OK" if white_bg else "WARN", "最初に白い背景の <rect>", white_bg, "" if white_bg else "背景を白で塗らないと、透明で撮れて測りがずれる")
    n_grad = tags.count("linearGradient") + tags.count("radialGradient")
    rec("OK" if n_grad >= 3 else "WARN", "グラデーションが 3 つ以上", n_grad, "面ごとの立体感(おもちゃの塗り)に要る" if n_grad < 3 else "")
    stroked = [e for e in drawn if (e.get("stroke") or "none") not in ("none", "") and float(re.sub(r"[^0-9.]", "", e.get("stroke-width", "1")) or 1) >= 4]
    ratio = len(stroked) / max(len(drawn), 1)
    rec("OK" if ratio <= 0.25 else "WARN", "太い輪郭線(幅 4 以上)の割合", round(ratio, 2), "輪郭線は引かず、塗りの明暗で形を読ませる" if ratio > 0.25 else "")
    return check_parts(root)


def check_parts(root):
    """部品の組の点検。2D の道(目・口の差し替え)と 3D の部品の表が、同じ名前で部品を探せるようにする。"""
    char = [c for c in root if local(c.tag) == "g" and c.get("id") == "char"]
    if len(char) != 1:
        rec("FAIL", '部品の親 <g id="char"> が 1 つ', len(char), "d03_svgkit の Kit.svg() で書き出す")
        return []
    kids = list(char[0])
    stray = [local(c.tag) for c in kids if local(c.tag) != "g" or not c.get("id")]
    rec("FAIL" if stray else "OK", "部品の外に描いた物が無い", len(stray), ", ".join(stray[:5]))
    ids = [c.get("id") for c in kids if local(c.tag) == "g" and c.get("id")]
    unknown = [i for i in ids if i not in PARTS]
    rec("FAIL" if unknown else "OK", "部品の名前が決まった名前だけ", unknown or len(ids), "" if not unknown else f"使える名前: {', '.join(PARTS)}")
    dup = sorted({i for i in ids if ids.count(i) > 1})
    all_ids = [e.get("id") for e in root.iter() if e.get("id") in PARTS]
    dup_all = sorted({i for i in all_ids if all_ids.count(i) > 1})
    rec("FAIL" if dup or dup_all else "OK", "同じ部品の名前が 2 つ無い", dup or dup_all or 0)
    missing = [g for g in REQUIRED if g not in ids]
    rec("FAIL" if missing else "OK", "要る部品がある(" + "・".join(REQUIRED) + ")", missing or "全部")
    empty = [c.get("id") for c in kids if c.get("id") in REQUIRED and len(list(c)) == 0]
    rec("FAIL" if empty else "OK", "要る部品が空でない", empty or 0)
    rec("OK" if "shadow" in ids else "WARN", '床の影 <g id="shadow">', "shadow" in ids, "" if "shadow" in ids else "影が無いと --noshadow の測りが同じ絵になるだけ(不可ではない)")
    if "body" in ids:
        before = [g for g in ids[:ids.index("body")] if g in FACE]
        rec("WARN" if before else "OK", "顔の部品が体より後(上)に描かれる", before or 0, "顔が体に隠れる" if before else "")
    return ids


def body_mask(rgb):
    a = rgb.astype(int)
    m = np.abs(a - 255).sum(axis=2) > BG_DIFF
    a_max, a_min = a.max(axis=2), a.min(axis=2)
    m &= ~(((a_max - a_min) < 18) & (a_max > 120))     # 色味のない薄い灰色(床の影)は体でない
    m = ndi.binary_opening(m, iterations=1)
    return ndi.binary_fill_holes(m)


def margins(mask):
    ys, xs = np.where(mask)
    h, w = mask.shape
    return xs.min(), ys.min(), w - 1 - xs.max(), h - 1 - ys.max(), (xs.min(), ys.min(), xs.max(), ys.max())


def check_png(png, png_noshadow):
    im = Image.open(png).convert("RGB")
    rec("OK" if im.size == (SIZE, SIZE) else "FAIL", f"PNG が {SIZE}×{SIZE}", f"{im.size[0]}×{im.size[1]}")
    arr = np.array(im)
    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    white = all(int(c.min()) >= 250 for c in corners)
    rec("OK" if white else "FAIL", "四隅が白", [list(map(int, c)) for c in corners][0] if white else [list(map(int, c)) for c in corners])
    # 影つきの絵: 影を含む全体の余白
    allm = (np.abs(arr.astype(int) - 255).sum(axis=2) > BG_DIFF)
    if allm.any():
        l, t, r, b, _ = margins(allm)
        mn = min(l, t, r, b)
        rec("OK" if mn >= MARGIN_PX else "FAIL", f"余白 {MARGIN_PX}px(5%)以上(影を含む)", {"左": int(l), "上": int(t), "右": int(r), "下": int(b)})
    else:
        rec("FAIL", "絵が空(白だけ)", 0)
        return
    body_im = Image.open(png_noshadow).convert("RGB") if png_noshadow else im
    barr = np.array(body_im)
    mask = body_mask(barr)
    area = int(mask.sum())
    if area < 5000:
        rec("FAIL", "体が見つかる", area)
        return
    l, t, r, b, (x0, y0, x1, y1) = margins(mask)
    mn = min(l, t, r, b)
    rec("OK" if mn >= MARGIN_PX else "FAIL", f"余白 {MARGIN_PX}px 以上(体)", {"左": int(l), "上": int(t), "右": int(r), "下": int(b)})
    hr = (y1 - y0 + 1) / SIZE
    rec("OK" if 0.55 <= hr <= 0.90 else "WARN", "体の高さ(紙に対する割合 0.55〜0.90)", round(hr, 3))
    # 左右の釣り合い: 体の外接箱の中心で鏡に映した重なり(IoU)
    cx = (x0 + x1) / 2
    off = abs(cx - (SIZE - 1) / 2) / SIZE
    rec("OK" if off <= 0.04 else "WARN", "体の中心が紙の中央(ずれ 4% 以内)", round(off, 3))
    crop = mask[y0:y1 + 1, x0:x1 + 1]
    mir = crop[:, ::-1]
    iou = float((crop & mir).sum() / max((crop | mir).sum(), 1))
    lv = "OK" if iou >= MIRROR_OK else ("WARN" if iou >= MIRROR_FAIL else "FAIL")
    rec(lv, f"左右の釣り合い(鏡に映した重なり {MIRROR_OK} 以上)", round(iou, 3), "" if lv == "OK" else "左右で形が違う。横向き・片手を上げた絵は、3D の下絵に向かない")
    # 輪郭が白から分かれるか: 体の縁から 3 画素内側の色が、白からどれだけ離れているか
    ring = mask & ~ndi.binary_erosion(mask, iterations=RING_PX + 1) & ndi.binary_erosion(mask, iterations=RING_PX)
    dist = np.sqrt(((barr.astype(float) - 255) ** 2).sum(axis=2))
    frac = float((dist[ring] >= RING_DIST).mean()) if ring.any() else 0.0
    lv = "OK" if frac >= EDGE_OK else ("WARN" if frac >= EDGE_FAIL else "FAIL")
    rec(lv, f"輪郭が白背景から分かれる(縁の画素の {int(EDGE_OK*100)}% 以上が白から距離 {RING_DIST} 以上)", round(frac, 3),
        "" if lv == "OK" else "体の縁が白に近い。縁を濃い色にするか、全体の色を濃くする(白い雲・白い体に注意)")
    # 浮いた部品
    lab, n = ndi.label(mask)
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    big = [int(s) for s in sizes if s >= area * 0.003]
    rec("OK" if len(big) == 1 else "WARN", "体のかたまりが 1 つ(0.3% 以上の物を数える)", len(big),
        "" if len(big) == 1 else "離れた部品がある。つなぐか、3D で別部品として意図しているか確かめる")
    # 色数の目安
    px = barr[mask].astype(float) / 255
    hsv = np.array([colorsys.rgb_to_hsv(*p) for p in px[::max(len(px) // 20000, 1)]])
    bins = {}
    for h, s, v in hsv:
        if v < 0.22:
            k = "暗"
        elif s < 0.15:
            k = "白" if v > 0.85 else "灰"
        elif s < 0.25:
            k = "淡"
        else:
            k = f"色{int(h * 360 // 30) * 30}"
        bins[k] = bins.get(k, 0) + 1
    tot = sum(bins.values())
    main = {k: round(v / tot, 2) for k, v in bins.items() if v / tot >= 0.04}
    lv = "OK" if 2 <= len(main) <= 7 else "WARN"
    rec(lv, "主な色の数の目安(色相 30 度ごと+暗・白・灰。4% 以上。グラデーションで隣に広がるので目安)", len(main), json.dumps(main, ensure_ascii=False))
    # 目に当たる暗い点
    sub = barr[y0:y1 + 1, x0:x1 + 1].astype(float)
    lum = 0.299 * sub[..., 0] + 0.587 * sub[..., 1] + 0.114 * sub[..., 2]
    dark = (lum < DARK_LUM) & crop
    dark[int((y1 - y0) * 0.70):] = False        # 体の上 70% だけ(顔のある所)
    dl, dn = ndi.label(dark)
    ds = ndi.sum(dark, dl, range(1, dn + 1))
    eyes = [int(s) for s in ds if 40 <= s <= 12000]
    rec("OK" if len(eyes) >= 2 else "WARN", "目に当たる暗い点が 2 つ以上(上 70%)", len(eyes),
        "" if len(eyes) >= 2 else "顔が暗い点で読めない絵かもしれない(光る目・白い目の絵なら問題なし)。目で確かめる")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("svg")
    ap.add_argument("png", nargs="?")
    ap.add_argument("--json")
    a = ap.parse_args()
    svg = Path(a.svg)
    png = Path(a.png) if a.png else svg.with_suffix(".png")
    parts = check_svg(svg) or []
    if png.exists():
        ns = png.with_name(png.stem + "_noshadow.png")
        check_png(png, ns if ns.exists() else None)
    else:
        rec("FAIL", "PNG がある", str(png))
    mark = {"OK": "OK  ", "WARN": "注意", "FAIL": "不可"}
    for r in results:
        v = r["value"]
        print(f"[{mark[r['level']]}] {r['name']}: {v}" + (f"  ← {r['note']}" if r["note"] else ""))
    nf = sum(r["level"] == "FAIL" for r in results)
    nw = sum(r["level"] == "WARN" for r in results)
    print(f"結果: 不可 {nf}・注意 {nw}・OK {sum(r['level'] == 'OK' for r in results)}")
    if a.json:
        Path(a.json).write_text(json.dumps({"svg": str(svg), "png": str(png), "parts": parts, "results": results}, ensure_ascii=False, indent=1), encoding="utf-8")
    sys.exit(1 if nf else 0)


if __name__ == "__main__":
    main()
