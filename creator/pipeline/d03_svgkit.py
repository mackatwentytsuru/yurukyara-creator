"""ゆるキャラの SVG を書くための小さな部品集(yc-0-draw スキルが使う)。全部この場で書いた物で、外から写していない。

使い方(gen_<id>.py の中で):
    import sys; sys.path.insert(0, "creator/pipeline")
    from d03_svgkit import *
    k = Kit()                                          # defs(グラデーション・ぼかし)をためる箱
    body = [circle(627, 560, 260), ellipse(480, 700, 200, 150), rrect(300, 760, 654, 140, 70)]   # 体の形(重ねた和)
    k.add(solid_body(k, body, light="#bfe6ff", mid="#6fb6ec", dark="#3c82c8", light_at=(470, 380)), "body")
    k.add(highlight(k, 520, 400, 90, 40, rot=-30), "body")
    open("x.svg", "w", encoding="utf-8").write(k.svg())

形は (種類, 数字…) のタプル。種類は circle・ellipse・rrect・path。

部品の組(2026-11-06 に足した。K1 の looks.2d.parts と同じ名前):
  k.add(<SVG の文字>, "<部品の名前>") で、描いた物を決まった名前の部品に入れる。名前は PARTS の中だけ。
  書き出すと <g id="char"> の下に <g id="body"> <g id="eye_L"> … が描いた順に並ぶ(2D の道で目・口を差し替える所)。
  同じ部品を、間に別の部品をはさんで 2 回に分けて描くことはできない(id が 2 つになるため。止める)。
  左右は「キャラ自身の左右」: eye_L はキャラの左目 = 絵の右側(x が中央より大きい側)。3D の骨の .L と同じ向き。
"""
import itertools

W = H = 1254
_ids = itertools.count(1)

# 決まった部品の名前(K1 looks.2d.parts)。後ろ → 前の、ふつうの描く順に並べてある
PARTS = ("shadow", "back", "foot_R", "foot_L", "arm_R", "arm_L", "body", "head", "ear_R", "ear_L",
         "cheek_R", "cheek_L", "eye_R", "eye_L", "brow_R", "brow_L", "mouth", "hat", "accessory")
REQUIRED = ("body", "eye_L", "eye_R", "mouth")
FACE = ("eye_R", "eye_L", "brow_R", "brow_L", "mouth", "cheek_R", "cheek_L")


def circle(cx, cy, r):
    return ("c", cx, cy, r)


def ellipse(cx, cy, rx, ry, rot=0):
    return ("e", cx, cy, rx, ry, rot)


def rrect(x, y, w, h, r):
    return ("r", x, y, w, h, r)


def path(d):
    return ("p", d)


def shape_svg(s, attrs=""):
    t = s[0]
    if t == "c":
        return f'<circle cx="{s[1]}" cy="{s[2]}" r="{s[3]}" {attrs}/>'
    if t == "e":
        rot = f' transform="rotate({s[5]} {s[1]} {s[2]})"' if s[5] else ""
        return f'<ellipse cx="{s[1]}" cy="{s[2]}" rx="{s[3]}" ry="{s[4]}"{rot} {attrs}/>'
    if t == "r":
        return f'<rect x="{s[1]}" y="{s[2]}" width="{s[3]}" height="{s[4]}" rx="{s[5]}" {attrs}/>'
    return f'<path d="{s[1]}" {attrs}/>'


class Kit:
    def __init__(self, bg="#ffffff"):
        self.defs = []
        self.body = []
        self.bg = bg
        self.parts = []

    def uid(self, p):
        return f"{p}{next(_ids)}"

    def blur(self, sd):
        i = self.uid("bl")
        # filter の領域は紙全体(既定の箱だと、細い物や影が切れる)
        self.defs.append(f'<filter id="{i}" filterUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">'
                         f'<feGaussianBlur stdDeviation="{sd}"/></filter>')
        return i

    def linear(self, stops, x1, y1, x2, y2):
        """面ごとの斜め光。stops = [(位置0〜1, 色), …]。座標は紙の座標(userSpaceOnUse)。"""
        i = self.uid("lg")
        st = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
        self.defs.append(f'<linearGradient id="{i}" gradientUnits="userSpaceOnUse" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{st}</linearGradient>')
        return i

    def radial(self, stops, cx, cy, r, fx=None, fy=None):
        """球のような丸み。fx・fy を光の来る側(左上)へずらす。"""
        i = self.uid("rg")
        st = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
        f = f' fx="{fx}" fy="{fy}"' if fx is not None else ""
        self.defs.append(f'<radialGradient id="{i}" gradientUnits="userSpaceOnUse" cx="{cx}" cy="{cy}" r="{r}"{f}>{st}</radialGradient>')
        return i

    def clip(self, shapes):
        i = self.uid("cp")
        self.defs.append(f'<clipPath id="{i}">' + "".join(shape_svg(s) for s in shapes) + "</clipPath>")
        return i

    def rim_mask(self, shapes, erode=16, soft=22):
        """縁だけ暗くするための mask。体の形を縮めてぼかし、黒で抜く(白い所が暗くなる)。
        重ねた形の内側の継ぎ目は、1 つの組(<g>)にまとめてぼかすので出ない。"""
        i, f = self.uid("rm"), self.uid("er")
        self.defs.append(f'<filter id="{f}" filterUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">'
                         f'<feMorphology operator="erode" radius="{erode}"/><feGaussianBlur stdDeviation="{soft}"/></filter>')
        inner = "".join(shape_svg(s, 'fill="#000"') for s in shapes)
        self.defs.append(f'<mask id="{i}" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">'
                         f'<rect width="{W}" height="{H}" fill="#fff"/><g filter="url(#{f})">{inner}</g></mask>')
        return i

    def add(self, s, g):
        """描いた物 s(SVG の文字)を部品 g に入れる。g は PARTS の名前だけ。"""
        if g not in PARTS:
            raise ValueError(f"部品の名前 {g!r} は決まった名前にない: {PARTS}")
        self.body.append((g, s))

    def groups(self):
        """[(部品の名前, [SVG の文字…])] を描いた順に。同じ部品が離れて 2 回出たら止める。"""
        out, seen = [], set()
        for g, s in self.body:
            if out and out[-1][0] == g:
                out[-1][1].append(s)
                continue
            if g in seen:
                raise ValueError(f"部品 {g} が 2 か所に分かれた。1 回にまとめて描く")
            seen.add(g)
            out.append((g, [s]))
        missing = [g for g in REQUIRED if g not in seen]
        if missing:
            raise ValueError(f"要る部品が無い: {missing}")
        return out

    def part(self, name, cx, cy, w, h, color, note=""):
        """部品の一覧に 1 行足す(描いた座標のまま。大きさ w・h は外接の幅と高さ)。
        parts_md() が、拡大・移動をかけた最終の画素に直して表にする。builder の辞書の元になる。"""
        self.parts.append((name, cx, cy, w, h, color, note))

    def parts_md(self, scale=1.0, anchor=(627, 960), to=(627, 1100)):
        rows = ["| 部品 | 中心 x | 中心 y | 幅 | 高さ | 色 | 備考 |", "|---|---|---|---|---|---|---|"]
        for name, cx, cy, w, h, color, note in self.parts:
            x = to[0] + (cx - anchor[0]) * scale
            y = to[1] + (cy - anchor[1]) * scale
            rows.append(f"| {name} | {x:.0f} | {y:.0f} | {w * scale:.0f} | {h * scale:.0f} | {color} | {note} |")
        return chr(10).join(rows)

    def svg(self, scale=1.0, anchor=(627, 960), to=(627, 1100)):
        """scale を指定すると、全体を anchor(足元の中心)を軸に拡大し、足元を to へ置く。
        体の高さを紙の 0.7〜0.8 にそろえるのに使う(描いてから大きさだけ直せる)。"""
        xf = ""
        if scale != 1.0 or anchor != to:
            xf = f' transform="translate({to[0]} {to[1]}) scale({scale}) translate({-anchor[0]} {-anchor[1]})"'
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
                f'<defs>\n' + "\n".join(self.defs) + f'\n</defs>\n<rect width="{W}" height="{H}" fill="{self.bg}"/>\n'
                f'<g id="char"{xf}>\n' + "\n".join(f'<g id="{g}">' + "".join(ss) + "</g>" for g, ss in self.groups())
                + "\n</g>\n</svg>\n")


def solid_body(k, shapes, light, mid, dark, light_at, rim=0.55, rim_color=None, spread=700):
    """体 1 つ分の塗り: 斜めの光(light_at が一番明るい)+縁の暗がり。輪郭線は引かない。
    shapes は重ねた形の和。戻り値は SVG の文字。"""
    cp = k.clip(shapes)
    lx, ly = light_at
    g = k.radial([(0, light), (0.45, mid), (1, dark)], lx + 120, ly + 150, spread, fx=lx, fy=ly)
    m = k.rim_mask(shapes)
    rc = rim_color or dark
    return (f'<g clip-path="url(#{cp})"><rect width="{W}" height="{H}" fill="url(#{g})"/>'
            f'<rect width="{W}" height="{H}" fill="{rc}" opacity="{rim}" mask="url(#{m})"/></g>')


def highlight(k, cx, cy, rx, ry, rot=0, opacity=0.75, sd=10, color="#ffffff", clip=None):
    """やわらかい光のつや(白い楕円をぼかす)。clip を渡すと体の形で切る。"""
    b = k.blur(sd)
    e = ellipse(cx, cy, rx, ry, rot)
    inner = shape_svg(e, f'fill="{color}" opacity="{opacity}" filter="url(#{b})"')
    return f'<g clip-path="url(#{clip})">{inner}</g>' if clip else inner


def soft_shadow(k, cx, cy, rx, ry, opacity=0.28, sd=22, color="#27323f"):
    """足元の影。k.add(..., "shadow") で入れる(d01 --noshadow が id="shadow" の組を外す)。広くぼかした楕円+細く濃い楕円の 2 枚。"""
    b1, b2 = k.blur(sd), k.blur(sd * 0.4)
    return (f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{color}" opacity="{opacity}" filter="url(#{b1})"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{rx*0.6:.0f}" ry="{ry*0.45:.0f}" fill="{color}" opacity="{opacity*1.3:.2f}" filter="url(#{b2})"/>')


def contact_shadow(k, shapes_clip, cx, cy, rx, ry, opacity=0.25, sd=20, color="#1d3a63"):
    """体の別の部分に落ちる影(頭が胴に落とす影など)。clip の中でだけ描く(外へにじむと輪郭が汚れる)。"""
    b = k.blur(sd)
    return f'<g clip-path="url(#{shapes_clip})"><ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{color}" opacity="{opacity}" filter="url(#{b})"/></g>'


def eye(k, cx, cy, rx, ry, color="#1b2a4a", shine=True):
    """目: 暗い楕円+大小 2 つの白いハイライト(顔が読める一番の手がかり)。"""
    s = shape_svg(ellipse(cx, cy, rx, ry), f'fill="{color}"')
    if shine:
        s += shape_svg(circle(cx - rx * 0.28, cy - ry * 0.3, rx * 0.36), 'fill="#fff"')
        s += shape_svg(circle(cx + rx * 0.3, cy + ry * 0.38, rx * 0.17), 'fill="#fff" opacity="0.9"')
    return s


def cheek(k, cx, cy, rx, ry, color="#ff8fa3", opacity=0.55, sd=7):
    b = k.blur(sd)
    return shape_svg(ellipse(cx, cy, rx, ry), f'fill="{color}" opacity="{opacity}" filter="url(#{b})"')


def smile(cx, cy, w, depth, color="#1b2a4a", thick=9, open_mouth=False, tongue="#ff8fa3"):
    """口: 下に曲がる細い弧。open_mouth=True なら中を塗る(笑い口)。線の端は丸める。"""
    x0, x1 = cx - w / 2, cx + w / 2
    if open_mouth:
        d = f"M{x0},{cy} Q{cx},{cy + depth * 1.9} {x1},{cy} Q{cx},{cy + depth * 0.15} {x0},{cy} Z"
        return (f'<path d="{d}" fill="{color}"/>'
                f'<clipPath id="mc{int(cx)}"><path d="{d}"/></clipPath>'
                f'<ellipse cx="{cx}" cy="{cy + depth * 1.35}" rx="{w * 0.22}" ry="{depth * 0.5}" fill="{tongue}" clip-path="url(#mc{int(cx)})"/>')
    return (f'<path d="M{x0},{cy} Q{cx},{cy + depth * 1.8} {x1},{cy}" fill="none" stroke="{color}" '
            f'stroke-width="{thick}" stroke-linecap="round"/>')
