"""作例が段 ⓪〜③ で育つ様子を、横に 4 枚並べた 1 枚の絵(1920x1080)にする。動画の素材用。

使い方: python creator/skilltest/grow_strip.py <id> --stills <正面の絵のフォルダ> --out <出力.png> [--plain <文字なしの出力.png>] [--report <json>]
  <正面の絵のフォルダ>: turntable.mjs --stills が書いた still_color.png と still_clay.png のあるフォルダ。

並べる物(全部、今のリポジトリにある物から作る。絵は変えない):
  ⓪ 描く      creator/samples/<id>_元の絵.png(Claude が SVG で描いた絵)
  ① 見る      同じ絵を薄くして、builder(creator/builders/<id>.py)の辞書 D に書いた部品の位置と大きさを線で重ね、
              builder の色を小さな四角で並べる。D の読み方の分からない項目は描かない。
              重ねた形が絵の上に 7 割以上のっていない物は描かない(読み違いを出さない)。
  ② 形        出来上がりの 3D から色と顔の模様を外して、ブラウザで正面から描いた絵(still_clay.png)
  ③ 色と質感  出来上がりの 3D をブラウザで正面から描いた絵(still_color.png)
注意: ② は段 ② の時の途中の物そのものではない(出来上がりから色を外した物)。① の数字は builder の今の値(直した後)。
"""
import argparse
import ast
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
from fontpath import find_font  # noqa: E402

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
W, H = 1920, 1080
BG = (238, 241, 246)          # 確かめ画面(creator/viewer)の地の色
CARD = (255, 255, 255)
INK = (22, 34, 58)
ACCENT = (30, 107, 255)       # ① の重ねる線
ARROW = (120, 130, 150)
TITLE_PX = 64                 # 字は画面幅の 3% 以上(58px 以上)
LABEL_PX = 60
MARGIN_X, GAP = 60, 56
LINE_FULL = 11                # ① の線の太さ(元の絵 1254px の上で)
FIT_MIN = 0.7                 # 重ねた形のうち、絵の上にのっている割合の下限
CENTER_TOL = 25               # 真ん中から離れた部品は左右に写す(builder も左右に置く)
CHIP, CHIP_GAP, CHIPS_MAX = 40, 10, 6
LABELS = ["⓪ 描く", "① 見る", "② 形", "③ 色と質感"]


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def is_pt(v):
    return isinstance(v, tuple) and len(v) == 2 and all(is_num(x) for x in v)


def is_rgb(v):
    return isinstance(v, tuple) and len(v) == 3 and all(isinstance(x, int) and 0 <= x <= 255 for x in v)


def read_builder(path):
    """builder の D(文字どおりに読める項目だけ)・数の定数(CX など)・色を、実行せずに読む。"""
    tree = ast.parse(open(path, encoding="utf-8").read())
    d, consts, colors = {}, {}, []

    def add_color(name, v):
        if is_rgb(v) and all(v != c for _, c in colors):
            colors.append((name, v))

    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        t = node.targets[0]
        if isinstance(t, ast.Name) and t.id == "D" and isinstance(node.value, ast.Call):
            for kw in node.value.keywords:
                try:
                    d[kw.arg] = ast.literal_eval(kw.value)
                except ValueError:
                    pass  # 関数を通した値(svg_px(...) など)は読まない
            continue
        try:
            val = ast.literal_eval(node.value)
        except ValueError:
            continue
        if isinstance(t, ast.Name):
            if is_num(val):
                consts[t.id] = val
            elif t.id.isupper():
                add_color(t.id, val)
        elif isinstance(t, ast.Tuple) and isinstance(val, tuple) and len(val) == len(t.elts):
            for e, v in zip(t.elts, val):
                if isinstance(e, ast.Name) and is_num(v):
                    consts[e.id] = v
    for node in ast.walk(tree):  # 材質の色: material("名前", (r, g, b), ...)
        if isinstance(node, ast.Call) and len(node.args) >= 2:
            fn = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
            if fn.endswith("material"):
                try:
                    add_color(ast.literal_eval(node.args[0]), ast.literal_eval(node.args[1]))
                except ValueError:
                    pass
    return d, consts, colors


def radii(r):
    if is_num(r):
        return r, r
    if isinstance(r, tuple) and len(r) in (2, 3) and all(is_num(x) for x in r):
        return r[0], r[-1]  # (横, 奥行き, 縦) の奥行きは正面の絵に出ない
    return None


def ellipse_pts(cx, cy, rx, ry, e=1.0, tilt=0.0, n=96):
    a = math.radians(tilt)
    out = []
    for k in range(n):
        t = 2 * math.pi * k / n
        c, s = math.cos(t), math.sin(t)
        x = rx * math.copysign(abs(c) ** e, c)
        y = ry * math.copysign(abs(s) ** e, s)
        out.append((cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)))
    return out


def capsule_pts(p, q, r, n=24):
    ang = math.atan2(q[1] - p[1], q[0] - p[0])
    out = []
    for cen, start in ((q, ang - math.pi / 2), (p, ang + math.pi / 2)):
        for k in range(n + 1):
            t = start + math.pi * k / n
            out.append((cen[0] + r * math.cos(t), cen[1] + r * math.sin(t)))
    return out


def bezier_pts(a, b, c, n=24):
    """2 次のベジェ(b は制御点)。builder の口の線と同じ作り方。"""
    out = []
    for k in range(n + 1):
        t = k / n
        out.append(tuple((1 - t) ** 2 * a[i] + 2 * (1 - t) * t * b[i] + t * t * c[i] for i in (0, 1)))
    return out


def tube_pts(path):
    """(x, y, 半幅) の並びを、幅のある管の輪郭にする。"""
    left, right = [], []
    for i, (x, y, r) in enumerate(path):
        (x0, y0), (x1, y1) = path[max(0, i - 1)][:2], path[min(len(path) - 1, i + 1)][:2]
        length = math.hypot(x1 - x0, y1 - y0) or 1.0
        nx, ny = -(y1 - y0) / length, (x1 - x0) / length
        left.append((x + nx * r, y + ny * r))
        right.append((x - nx * r, y - ny * r))
    return left + right[::-1]


def densify(pts, step=6.0):
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        out += [(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n) for k in range(n)]
    return out + [pts[-1]]


def on_drawing(mask, pts, closed):
    """形のうち、絵(白でない所)の上にのっている割合。閉じた形は面積で、線は線の上の点で数える。"""
    h, w = mask.shape
    if closed:
        im = Image.new("L", (w, h), 0)
        ImageDraw.Draw(im).polygon(pts, fill=255)
        area = np.asarray(im) > 0
        n = area.sum()
        return float((area & mask).sum() / n) if n else 0.0
    dense = densify(pts)
    inside = [0 <= int(x) < w and 0 <= int(y) < h and mask[int(y), int(x)] for x, y in dense]
    return sum(inside) / max(1, len(inside))


def best_of(mask, cands):
    """候補の形(pts, closed)のうち、いちばん絵にのる物。下限に届かなければ None。"""
    score, pts, closed = max(((on_drawing(mask, p, c), p, c) for p, c in cands), key=lambda t: t[0])
    return (pts, closed) if score >= FIT_MIN else None


def centers_of(d, n, cx_mid):
    """部品 n の中心(元の絵の画素)。左右の組は 2 つ返す。"""
    c, dx, y = d.get(n + "_c"), d.get(n + "_dx"), d.get(n + "_y")
    if is_pt(c):
        return [c]
    if isinstance(c, tuple) and len(c) == 2 and all(is_pt(p) for p in c):
        return list(c)
    if is_num(c) and is_num(dx):
        return [(cx_mid - dx, c), (cx_mid + dx, c)]
    if is_num(y) and is_num(dx):
        return [(cx_mid - dx, y), (cx_mid + dx, y)]
    if isinstance(y, tuple) and all(is_num(v) for v in y):
        return [(cx_mid, v) for v in y]  # 真ん中に縦に並ぶ物(ボタンなど)
    if is_pt(d.get(n)):
        return [d[n]]
    return []


def shapes_from_d(d, cx_mid, mask):
    """D の項目を、元の絵の上の形にする。読み方の決まり(どれにも当たらない項目は描かない):
    中心(centers_of)+ <名>_r → 楕円(<名>_e で角の丸み、<名>_tilt で傾き。傾きの向きは絵にのる方)。
    <名>_a/_b(か _root/_tip)+ <名>_r → 太い棒。<名>_a/_b/_c だけ → b を制御点にした曲線(口の線)。
    <名>_y が 3 つ以上の数 → 体の中の横の線。<名>_path((真ん中からの距離, 縦, 半幅) の並び)→ 左右の管。
    真ん中から離れた 1 つだけの物は左右に写す(builder も左右に置く)。
    絵にのらない時、x が小さければ「真ん中からの距離」と読み直す。それでも絵にのらない物は描かない。"""
    shapes = []

    def put(cands):
        got = best_of(mask, cands)
        if got:
            shapes.append(got)
        return int(bool(got))

    def mirror(x):
        return 2 * cx_mid - x

    names = sorted({k.rsplit("_", 1)[0] for k in d if "_" in k} | {k for k in d if is_pt(d[k])})
    for n in names:
        r = radii(d.get(n + "_r"))
        centers = centers_of(d, n, cx_mid)
        if r and centers:
            e = d.get(n + "_e", 1.0)
            e = e[0] if isinstance(e, tuple) else e
            tilt = d.get(n + "_tilt", 0.0)
            tilts = sorted({tilt, -tilt})
            single = len(centers) == 1
            placed = 0
            for x, y in centers:
                sides = [(x, 1), (mirror(x), -1)] if single and abs(x - cx_mid) > CENTER_TOL else [(x, 1)]
                for sx, sg in sides:
                    placed += put([(ellipse_pts(sx, y, r[0], r[1], e, sg * t), True) for t in tilts])
            if single and not placed and centers[0][0] < cx_mid / 2:
                x, y = centers[0]
                for sg in (1, -1):
                    put([(ellipse_pts(cx_mid + sg * x, y, r[0], r[1], e, sg * t), True) for t in tilts])
            continue
        ends = next(((d[n + a], d[n + b]) for a, b in (("_a", "_b"), ("_root", "_tip"))
                     if is_pt(d.get(n + a)) and is_pt(d.get(n + b))), None)
        if ends and r:
            p, q = ends
            put([(capsule_pts(p, q, r[0]), True)])
            if abs(p[0] - cx_mid) > CENTER_TOL:
                put([(capsule_pts((mirror(p[0]), p[1]), (mirror(q[0]), q[1]), r[0]), True)])
        elif ends:
            c = d.get(n + "_c")
            put([(bezier_pts(ends[0], ends[1], c) if is_pt(c) else list(ends), False)])
    body_c, body_r = d.get("body_c"), radii(d.get("body_r"))
    for k, v in d.items():
        if k.endswith("_y") and isinstance(v, tuple) and len(v) > 2 and all(is_num(x) for x in v) and is_pt(body_c) and body_r:
            (bx, by), (rx, ry) = body_c, body_r
            for y in v:
                half = rx * math.sqrt(max(0.0, 1 - ((y - by) / ry) ** 2)) * 0.92
                if half > 10:
                    put([([(bx - half, y), (bx + half, y)], False)])
        if k.endswith("_path") and isinstance(v, tuple) and len(v) > 1 and all(isinstance(p, tuple) and len(p) == 3 for p in v):
            for sg in (1, -1):  # (真ん中からの距離, 縦, 半幅) の並び。builder は左右に置く
                put([(tube_pts([(cx_mid + sg * dx, y, rr) for dx, y, rr in v]), True)])
    return shapes


def fg_mask(img):
    a = np.asarray(img.convert("RGB")).astype(np.int16)
    return np.abs(a - 255).max(axis=2) > 24


def look_panel(drawing, shapes):
    base = Image.blend(drawing.convert("RGB"), Image.new("RGB", drawing.size, (255, 255, 255)), 0.55)
    dr = ImageDraw.Draw(base)
    for pts, closed in shapes:
        dr.line(list(pts) + ([pts[0]] if closed else []), fill=ACCENT, width=LINE_FULL, joint="curve")
    return base


def crop_content(img, pad=0.06):
    ys, xs = np.nonzero(fg_mask(img))
    if not len(xs):
        return img
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    p = int(max(x1 - x0, y1 - y0) * pad)
    return img.crop((max(0, x0 - p), max(0, y0 - p), min(img.width, x1 + p), min(img.height, y1 + p)))


def fit_into(img, w, h):
    im = img.copy()
    im.thumbnail((w, h), Image.LANCZOS)
    return im


def compose(title, panels, colors, labels):
    canvas = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(canvas)
    font_t = ImageFont.truetype(find_font(), TITLE_PX)
    font_l = ImageFont.truetype(find_font(), LABEL_PX)
    top = 0
    if labels:
        for i, line in enumerate(title):
            dr.text((MARGIN_X, 36 + i * (TITLE_PX + 18)), line, font=font_t, fill=INK)
        top = 36 + len(title) * (TITLE_PX + 18) + 10
    card_w = (W - 2 * MARGIN_X - 3 * GAP) // 4
    bottom_space = LABEL_PX + 70 if labels else 0
    card_h = min(H - top - bottom_space - 40, int(card_w * 1.45))
    y0 = top + (H - top - bottom_space - card_h) // 2
    pad = 22
    for i, img in enumerate(panels):
        x0 = MARGIN_X + i * (card_w + GAP)
        dr.rounded_rectangle((x0, y0, x0 + card_w, y0 + card_h), radius=22, fill=CARD)
        chips_h = 64 if i == 1 and colors else 0  # ① の下に色の四角を並べる分
        im = fit_into(crop_content(img), card_w - 2 * pad, card_h - 2 * pad - chips_h)
        canvas.paste(im, (x0 + (card_w - im.width) // 2, y0 + pad + (card_h - 2 * pad - chips_h - im.height) // 2))
        if chips_h:
            shown = colors[:CHIPS_MAX]
            cx0 = x0 + (card_w - (len(shown) * CHIP + (len(shown) - 1) * CHIP_GAP)) // 2
            for j, (_, rgb) in enumerate(shown):
                cx = cx0 + j * (CHIP + CHIP_GAP)
                dr.rounded_rectangle((cx, y0 + card_h - pad - CHIP, cx + CHIP, y0 + card_h - pad), radius=8,
                                     fill=tuple(rgb), outline=(200, 205, 215), width=2)
        if i < len(panels) - 1:  # 矢印
            ax, ay = x0 + card_w + GAP // 2, y0 + card_h // 2
            dr.polygon([(ax - 12, ay - 22), (ax + 14, ay), (ax - 12, ay + 22)], fill=ARROW)
        if labels:
            tw = dr.textlength(LABELS[i], font=font_l)
            dr.text((x0 + (card_w - tw) / 2, y0 + card_h + 26), LABELS[i], font=font_l, fill=INK)
    return canvas


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("id")
    ap.add_argument("--stills", required=True, help="still_color.png と still_clay.png のあるフォルダ")
    ap.add_argument("--out", required=True)
    ap.add_argument("--plain", help="文字なしの版の出力")
    ap.add_argument("--report", help="① に描いた形の数などを書く json")
    a = ap.parse_args()
    cid = a.id
    drawing = Image.open(os.path.join(REPO, "creator", "samples", f"{cid}_元の絵.png")).convert("RGB")
    d, consts, colors = read_builder(os.path.join(REPO, "creator", "builders", f"{cid}.py"))
    shapes = shapes_from_d(d, consts.get("CX", drawing.width / 2), fg_mask(drawing))
    color = Image.open(os.path.join(a.stills, "still_color.png")).convert("RGB")
    clay = Image.open(os.path.join(a.stills, "still_clay.png")).convert("RGB")
    cj = json.load(open(os.path.join(REPO, "characters", cid, "character.json"), encoding="utf-8"))
    name = cj.get("name", cid)
    origin = cj.get("origin") or {}
    if origin.get("input") == "words" and origin.get("words"):
        title = [f"{name}: 言葉から 3D へ", f"「{origin['words']}」"]
    else:
        title = [f"{name}: 絵から 3D へ"]
    panels = [drawing, look_panel(drawing, shapes), clay, color]
    compose(title, panels, colors, True).save(a.out)
    if a.plain:
        compose(title, panels, colors, False).save(a.plain)
    rep = {"id": cid, "name": name, "title": title, "d_items": len(d), "shapes": len(shapes),
           "colors": [list(c) for _, c in colors[:CHIPS_MAX]]}
    if a.report:
        with open(a.report, "w", encoding="utf-8") as f:
            json.dump(rep, f, ensure_ascii=False, indent=1)
    print(json.dumps(rep, ensure_ascii=False))


if __name__ == "__main__":
    main()
