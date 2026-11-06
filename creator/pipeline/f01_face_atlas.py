"""段 6: 顔の絵の表(アトラス)を自分で描く。AI は使わない。

使い方: python f01_face_atlas.py led|paper <出力フォルダ> [eye_x=… eye_y=… eye_r=… eye_t=… eye_dot=… mouth_y=… smile_w=… bg_a=… fade=… corner=… gh=… eye_circle=… dot=… glow=… smile_h=… smile_t=…]
(led の目と口の位置・大きさを、元の絵に合わせて上書きできる。値は点の数。run_built.sh は specs/<id>_face.args があれば渡す)

表の並び: 横 = 口の開き 4 段階(0 閉じる〜3 大きく開く)、縦 = 表情(neutral happy surprised sad think)と
まばたき(blink = neutral の目を閉じた形)。1 マスの縦横比は 5:3。
- led: 光る点(ドット)で顔を作る。点の格子は 40×24。光らない点もうっすら見える(画面らしさ)。
- paper: 紙に墨で描いたようなやわらかい顔(茶色の目と口、ほおの赤み)。背景は透明で、体に重ねて使う。
出力: face_atlas.png と face_atlas.json(マスの並びと、表情ごとの行)
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

COLS = 4
ROWS = ["neutral", "happy", "surprised", "sad", "think", "blink"]
GW, GH = 40, 24          # 点の格子(led は main で 40×40 の正方形に変える)
EYE_Y, MOUTH_Y = 9, 17
EYE_R = 4.6   # 目の輪の外側の半径(点の数)
EYE_X = 11    # 左の目の中心(点の位置。右は対称)
EYE_T = 1.9   # 目の輪の太さ(点の数)
SMILE_W = 12  # ふつうの笑い口の幅(点の数)
EYE_DOT = 1.5 # 目の輪の中の点の半径(点の数。0.6 なら 1 つの小さな点)
BG_A = 150    # 画面の暗さ(アルファ 0〜255)
FADE = 0.10   # 画面の縁がなめらかに消える幅(小さいほど、くっきりした画面の縁)
CORNER = 0.10 # 画面の角の丸さ
EYE_CIRCLE = 0  # 0 でなければ、目の輪をこの数の点で円周に並べる(格子に載せない)
DOT = 0.52    # 光る点の半径(点の間隔に対する割合。小さいほど細かい点に見える)
GLOW = 1.0    # 光のにじみの強さ(0〜1)
SMILE_H = 2.8 # ふつうの笑い口の深さ(点の数)
SMILE_T = 1.8 # 笑い口の太さ(点の数。1.0 なら点が 1 列)
CELL_W, CELL_H = 400, 240  # 1 マス(点の間隔 10 画素)
SS = 3                    # 描くときの拡大(ぎざぎざ除け)


def ring(cx, cy, r_out, r_in):
    return {(x, y) for x in range(GW) for y in range(GH)
            if r_in <= math.hypot(x - cx, (y - cy)) <= r_out}


def disc(cx, cy, r):
    return ring(cx, cy, r, 0)


def arc_up(cx, cy, w, h, thick=1.0):
    """上に凸の弧(はの目)。"""
    pts = set()
    for x in range(GW):
        t = (x - cx) / (w / 2)
        if abs(t) <= 1:
            y = cy - h * (1 - t * t)
            for yy in range(GH):
                if abs(yy - (cy - h * (1 - t * t))) <= thick / 2 + 0.01:
                    pts.add((x, yy))
    return pts


def smile(cx, cy, w, h, thick=1.0, frown=False):
    """口の弧。h が大きいほど深い。frown は への字。"""
    pts = set()
    for x in range(GW):
        t = (x - cx) / (w / 2)
        if abs(t) <= 1:
            y = cy + (-1 if frown else 1) * h * (1 - t * t)  # 中央が低い = 笑い口
            for yy in range(GH):
                if abs(yy - y) <= thick / 2 + 0.01:
                    pts.add((x, yy))
    return pts


def hline(cx, cy, w):
    return {(x, cy) for x in range(int(cx - w / 2), int(cx + w / 2) + 1) if 0 <= x < GW}


def eyes(kind):
    lx, rx, y = EYE_X, GW - 1 - EYE_X, EYE_Y
    if kind in ("neutral", "sad") and EYE_CIRCLE:
        # 輪は、格子に載せず、円周に等間隔の点(格子の輪は八角形に見えた)。点の位置は小数
        rc = EYE_R - EYE_T / 2
        out = set()
        for cx0 in (lx, rx):
            out.add((cx0, y))
            for k in range(EYE_CIRCLE):
                th = 2 * math.pi * (k + 0.5) / EYE_CIRCLE
                out.add((cx0 + rc * math.cos(th), y + rc * math.sin(th)))
        if kind == "sad":
            out = {(x, yy + 1) for x, yy in out}
        return out
    if kind in ("neutral", "sad"):
        out = ring(lx, y, EYE_R, EYE_R - EYE_T) | disc(lx, y, EYE_DOT) | ring(rx, y, EYE_R, EYE_R - EYE_T) | disc(rx, y, EYE_DOT)
        if kind == "sad":
            out = {(x, yy + 1) for x, yy in out}
        return out
    if kind == "happy":
        return arc_up(lx, y + 1, 9, 3.2, 1.6) | arc_up(rx, y + 1, 9, 3.2, 1.6)
    if kind == "surprised":
        return (ring(lx, y, 5.6, 3.8) | disc(lx, y, 2.0) | ring(rx, y, 5.6, 3.8) | disc(rx, y, 2.0))
    if kind == "think":
        # 左の目は ふつう、右の目は小さく、上を見る
        return ring(lx, y, 4.6, 3.0) | disc(lx + 1, y - 1, 1.4) | ring(rx, y - 1, 3.4, 1.8)
    if kind == "blink":
        return hline(lx, y, 9) | hline(rx, y, 9) | hline(lx, y + 1, 9) | hline(rx, y + 1, 9)
    raise ValueError(kind)


def mouth(kind, level):
    cx, cy = 20, MOUTH_Y
    if level == 0:
        if kind == "happy":
            return smile(cx, cy - 1, 16, 3.5, 1.4)
        if kind == "sad":
            return smile(cx, cy + 1, 10, 2.5, 1.2, frown=True)
        if kind == "think":
            return hline(cx + 3, cy, 8) | hline(cx - 2, cy + 1, 4)
        if kind == "surprised":
            return ring(cx, cy, 2.6, 1.4)
        return smile(cx, cy - 1, SMILE_W, SMILE_H, SMILE_T)
    # 開いた口: 楕円。段階で大きくなる
    r = {1: (3.2, 1.6), 2: (4.8, 2.6), 3: (5.6, 3.6)}[level]
    pts = {(x, y) for x in range(GW) for y in range(GH)
           if ((x - cx) / r[0]) ** 2 + ((y - cy) / r[1]) ** 2 <= 1.0}
    if kind == "happy":
        pts = {(x, y) for (x, y) in pts if y >= cy - 1}   # 半月(上がまっすぐ)
    return pts


def draw_cell(on, w=CELL_W, h=CELL_H):
    W, H = w * SS, h * SS
    img = Image.new("RGB", (W, H), (6, 14, 40))
    d = ImageDraw.Draw(img)
    pitch = w / GW * SS
    r_off, r_on = pitch * 0.26, pitch * 0.40
    for x in range(GW):
        for y in range(GH):
            c = ((x + 0.5) * pitch, (y + 0.5) * (h * SS / GH))
            if (x, y) in on:
                continue
            d.ellipse([c[0] - r_off, c[1] - r_off, c[0] + r_off, c[1] + r_off], fill=(14, 30, 70))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for (x, y) in on:
        c = ((x + 0.5) * pitch, (y + 0.5) * (h * SS / GH))
        gd.ellipse([c[0] - r_on * 1.7, c[1] - r_on * 1.7, c[0] + r_on * 1.7, c[1] + r_on * 1.7], fill=(0, 70, 95))
    glow = glow.filter(ImageFilter.GaussianBlur(pitch * 0.9))
    from PIL import ImageChops
    img = ImageChops.add(img, glow)
    d = ImageDraw.Draw(img)
    for (x, y) in on:
        c = ((x + 0.5) * pitch, (y + 0.5) * (h * SS / GH))
        d.ellipse([c[0] - r_on, c[1] - r_on, c[0] + r_on, c[1] + r_on], fill=(40, 225, 255))
        d.ellipse([c[0] - r_on * 0.45, c[1] - r_on * 0.45, c[0] + r_on * 0.45, c[1] + r_on * 0.45], fill=(200, 250, 255))
    return img.resize((w, h), Image.LANCZOS)


INK = (92, 54, 30, 255)
BLUSH = (238, 150, 90, 70)
# 紙の顔の上書き(元の絵に合わせる。割合は 1 マスの横・縦に対する値)
PAPER = dict(lx=0.30, ey=0.36, erx=None, ery=None, my=0.70, smile_cx=0.5, smile_cy=None, smile_rx=0.12, smile_ry=0.12,
             smile_t=0.035, ch_x=0.17, ch_y=0.66, ch_rx=0.085, ch_ry=0.10, ch_blur=0, gloss=0, lw=1.0, sy=1.0)


def paper_cell(kind, level, w=CELL_W, h=CELL_H):
    """紙の顔。座標は 0〜1 の割合で書く(横 w、縦 h に合わせる)。"""
    k = 4
    img = Image.new("RGBA", (w * k, h * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def X(v):
        return v * w * k

    def Y(v):
        return v * h * k

    def oval(cx, cy, rx, ry, fill):
        d.ellipse([X(cx - rx), Y(cy - ry), X(cx + rx), Y(cy + ry)], fill=fill)

    def line(pts, width):
        width = width * PAPER["lw"]
        d.line([(X(a), Y(b)) for a, b in pts], fill=INK, width=int(width * h * k), joint="curve")
        for a, b in (pts[0], pts[-1]):
            oval(a, b, width / 2 * h / w, width / 2, INK)

    def arc(cx, cy, rx, ry, a0, a1, n=24):
        return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]

    P_ = PAPER
    lx, ey = P_["lx"], P_["ey"]
    rx_ = 1.0 - lx
    sy, lwk = P_["sy"], P_["lw"]
    # ほお(ch_blur があれば、ふちをぼかす)
    if P_["ch_blur"]:
        ch = Image.new("RGBA", img.size, tuple(BLUSH[:3]) + (0,))   # 透明でも、ほおの色にする(黒がにじんで灰色のふちになる)
        cd = ImageDraw.Draw(ch)
        for cxv in (P_["ch_x"], 1.0 - P_["ch_x"]):
            cd.ellipse([X(cxv - P_["ch_rx"]), Y(P_["ch_y"] - P_["ch_ry"]), X(cxv + P_["ch_rx"]), Y(P_["ch_y"] + P_["ch_ry"])], fill=BLUSH)
        img.alpha_composite(ch.filter(ImageFilter.GaussianBlur(P_["ch_blur"] * h * k)))
    else:
        oval(P_["ch_x"], P_["ch_y"], P_["ch_rx"], P_["ch_ry"], BLUSH)
        oval(1.0 - P_["ch_x"], P_["ch_y"], P_["ch_rx"], P_["ch_ry"], BLUSH)
    # 目
    if kind == "blink":
        line(arc(lx, ey - 0.02, 0.07, 0.05 * sy, 20, 160), 0.035)
        line(arc(rx_, ey - 0.02, 0.07, 0.05 * sy, 20, 160), 0.035)
    elif kind == "happy":
        line(arc(lx, ey + 0.05, 0.075, 0.09 * sy, 200, 340), 0.04)
        line(arc(rx_, ey + 0.05, 0.075, 0.09 * sy, 200, 340), 0.04)
    else:
        er = {"neutral": (0.092, 0.178), "surprised": (0.105, 0.21), "sad": (0.092, 0.178), "think": (0.092, 0.178)}[kind]
        for i, cx in enumerate((lx, rx_)):
            e = er
            cy = ey
            if kind == "think" and i == 1:
                e, cy = (0.045, 0.085), ey - 0.04
            if kind == "sad":
                cy += 0.03
            if P_["erx"]:   # 元の絵の目の大きさ(割合)で上書き。つやのある黒目は、白い光を 2 つ
                erx_, ery_ = P_["erx"] * e[0] / 0.092, P_["ery"] * e[1] / 0.178
            else:
                erx_, ery_ = e[0] * h / w * 1.6, e[1]
            oval(cx, cy, erx_, ery_, INK)
            if P_["gloss"]:
                oval(cx - 0.3 * erx_, cy - 0.38 * ery_, 0.33 * erx_, 0.34 * ery_, (255, 255, 255, 245))
                oval(cx + 0.3 * erx_, cy + 0.27 * ery_, 0.15 * erx_, 0.14 * ery_, (255, 255, 255, 220))
            else:
                oval(cx + erx_ * 0.3, cy - ery_ * 0.4, erx_ * 0.37, ery_ * 0.28, (255, 255, 255, 255))
        if kind == "sad":
            line([(lx - 0.07, ey - 0.12), (lx + 0.06, ey - 0.17)], 0.03)
            line([(rx_ + 0.07, ey - 0.12), (rx_ - 0.06, ey - 0.17)], 0.03)
    # 口
    mx, my = P_["smile_cx"], P_["my"]
    if level == 0:
        if kind == "happy":
            line(arc(mx, my - 0.10, 0.16, 0.16, 20, 160), 0.04)
        elif kind == "sad":
            line(arc(mx, my + 0.16, 0.10, 0.09, 200, 340), 0.035)
        elif kind == "surprised":
            oval(mx, my, 0.032, 0.07, INK)
        elif kind == "think":
            line([(mx - 0.06, my + 0.02), (mx - 0.02, my), (mx + 0.02, my + 0.03), (mx + 0.06, my + 0.01)], 0.03)
        else:
            scy = P_["smile_cy"] if P_["smile_cy"] is not None else my - 0.08
            line(arc(mx, scy, P_["smile_rx"], P_["smile_ry"], 25, 155), P_["smile_t"])
    else:
        rx_m, ry_m = {1: (0.045, 0.045), 2: (0.075, 0.085), 3: (0.095, 0.13)}[level]
        oval(mx, my + 0.02, rx_m * 1.0, ry_m, INK)
        if level >= 2:
            oval(mx, my + 0.02 + ry_m * 0.45, rx_m * 0.62, ry_m * 0.5, (205, 90, 80, 255))
    return img.resize((w, h), Image.LANCZOS)


def draw_overlay(on, w=None, h=None):
    """体の前面にそのまま重ねる点の絵(背景は透明)。光る点は大きく明るく、光らない点はうっすら暗い。"""
    w, h = w or CELL_W, h or CELL_H
    k = 3
    W, H = w * k, h * k
    pitch = W / GW
    ph = H / GH
    off = Image.new("RGBA", (W, H), (3, 8, 34, BG_A))   # 画面は体より暗い紺(元の絵のとおり)
    d = ImageDraw.Draw(off)
    r_off = pitch * 0.20
    for x in range(GW):
        for y in range(GH):
            if (x, y) in on:
                continue
            cx, cy = (x + 0.5) * pitch, (y + 0.5) * ph
            d.ellipse([cx - r_off, cy - r_off, cx + r_off, cy + r_off], fill=(4, 10, 40, 120))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for (x, y) in on:
        cx, cy = (x + 0.5) * pitch, (y + 0.5) * ph
        gd.ellipse([cx - pitch * 1.1, cy - pitch * 1.1, cx + pitch * 1.1, cy + pitch * 1.1], fill=(30, 150, 255, int(230 * GLOW)))
    glow = glow.filter(ImageFilter.GaussianBlur(pitch * 1.1))
    img = Image.alpha_composite(off, glow)
    d = ImageDraw.Draw(img)
    r_on = pitch * DOT
    for (x, y) in on:
        cx, cy = (x + 0.5) * pitch, (y + 0.5) * ph
        d.ellipse([cx - r_on, cy - r_on, cx + r_on, cy + r_on], fill=(60, 235, 255, 255))
        d.ellipse([cx - r_on * 0.5, cy - r_on * 0.5, cx + r_on * 0.5, cy + r_on * 0.5], fill=(225, 252, 255, 255))
    return img.resize((w, h), Image.LANCZOS)


def edge_mask(w, h, fade=0.07, radius=0.10):
    """丸い角と、縁がなめらかに消えるアルファ(横から見ても貼った板に見えない)。"""
    import numpy as np
    ys, xs = np.mgrid[0:h, 0:w]
    u, v = xs / (w - 1), ys / (h - 1)
    r = radius * h / w
    dx = np.maximum(np.maximum(r - u, u - (1 - r)), 0) / r
    dy = np.maximum(np.maximum(radius - v, v - (1 - radius)), 0) / radius
    corner = np.sqrt(dx ** 2 + dy ** 2)                      # 角の外で 1 を超える
    edge = np.minimum(np.minimum(u, 1 - u) / fade, np.minimum(v, 1 - v) / (fade * w / h))
    a = np.clip(np.minimum(edge, (1 - corner) * 6.0), 0, 1)
    a = a * a * (3 - 2 * a)
    return Image.fromarray((a * 255).astype("uint8"))


def main():
    global GW, GH, CELL_W, CELL_H, EYE_Y, MOUTH_Y, EYE_R, EYE_X, EYE_T, SMILE_W, EYE_DOT, EYE_CIRCLE, INK, BLUSH, BG_A, FADE, CORNER, DOT, GLOW, SMILE_H, SMILE_T
    style, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    if style == "led":
        # 体の前面いっぱいの正方形の画面。目と口の位置は、元の絵の高さに合わせた
        GW, GH, CELL_W, CELL_H, EYE_Y, MOUTH_Y = 40, 40, 400, 400, 17, 28
        EYE_R, EYE_X = 6.2, 9.5
        for kv in sys.argv[3:]:   # 元の絵に合わせた上書き
            k, v = kv.split("=")
            if k == "gh":   # 点の縦の数。顔の面が横長のとき、点を正方形にそろえる(1 マスの高さ = gh × 10 画素)
                GH = int(v)
                CELL_H = GH * 10
                continue
            g = dict(eye_x="EYE_X", eye_y="EYE_Y", eye_r="EYE_R", eye_t="EYE_T", eye_dot="EYE_DOT", eye_circle="EYE_CIRCLE", mouth_y="MOUTH_Y", smile_w="SMILE_W",
                      bg_a="BG_A", fade="FADE", corner="CORNER", dot="DOT", glow="GLOW", smile_h="SMILE_H", smile_t="SMILE_T")[k]
            globals()[g] = float(v) if "." in v else int(v)
    if style == "paper":
        for kv in sys.argv[3:]:
            k, v = kv.split("=")
            if k == "cell_h":
                CELL_H = int(v)
            elif k == "ink":
                INK = tuple(int(t) for t in v.split(",")) + (255,)
            elif k == "blush":
                BLUSH = tuple(int(t) for t in v.split(","))
            else:
                PAPER[k] = float(v)
    if style not in ("led", "paper"):
        raise SystemExit("led か paper")
    atlas = Image.new("RGBA", (COLS * CELL_W, len(ROWS) * CELL_H), (0, 0, 0, 0))
    for r, kind in enumerate(ROWS):
        for c in range(COLS):
            base = "neutral" if kind == "blink" else kind
            if style == "led":
                on = eyes(kind) | mouth(base, c)
                cell = draw_overlay(on)
                from PIL import ImageChops
                cell.putalpha(ImageChops.multiply(cell.getchannel("A"), edge_mask(CELL_W, CELL_H, fade=FADE, radius=CORNER)))
                atlas.paste(cell, (c * CELL_W, r * CELL_H))
            else:
                atlas.paste(paper_cell(kind, c, CELL_W, CELL_H), (c * CELL_W, r * CELL_H))
    atlas.save(os.path.join(out, "face_atlas.png"))
    spec = {"style": style, "cols": COLS, "rows": ROWS, "cell_aspect": CELL_W / CELL_H, "grid": [GW, GH],
            "mouth_levels": COLS, "blink_row": "blink"}
    with open(os.path.join(out, "face_atlas.json"), "w", encoding="utf-8") as f:
        json.dump(spec, f, ensure_ascii=False, indent=1)
    print("atlas", atlas.size)


if __name__ == "__main__":
    main()
