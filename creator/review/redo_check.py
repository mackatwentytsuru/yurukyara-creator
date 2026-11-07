"""描き直し(C0 のやり直し+一言)で、頼まれた所だけが変わったかを、前の回の絵とくらべる決まった確かめ(Claude を呼ばない)。

本人のひとこと(11/7 N-0026): 「みかんの子なのに、葉っぱだけ変えればいいのに、みかんの色まで変わっているのがおかしい」。
描き直しで変えてよいのは、一言(と選んだ言葉)が指す所だけ。名前・ほかの部品の色・部品の数と種類・形は保つ。

- SVG の決まった名前の部品(<g id="body"> など。K1 の 19 個)ごとに、色(不透明な塗りと、グラデーションの止めの色を
  面積の目安で重みづけした Lab の平均と、目立つ色の組)・箱(位置と大きさ)・部品の有る無しを読み、前の回とくらべる。
  うすい重ね(光・影・縁。不透明さ 0.6 未満)と mask の重ねは数えない。<g id="char"> の全体の拡大・移動は数えない。
- 一言から「変えてよい物」を決める: 部品の言葉(帽子・目・葉っぱ…)と、その子の設定(settings.md の「hat(くき)」
  「- 部品: hat = 葉っぱ」の形)から部品を、色・形・数・名前の言葉と、選んだ言葉(色が違う・部品が足りない…)から変わり方を。
- 前の回が絵(PNG)だけの時は、部品に分けられないので、絵の主な色だけをくらべる(主な色が消えたら知らせる)。

使い方:
  python creator/review/redo_check.py compare <前.svg|png> <今.svg> [--request-file r.json] [--prev-settings s.md]
                                      [--new-settings s.md] [--new-png 今.png] [--json 出力.json]
  python creator/review/redo_check.py inventory <絵.svg>
  終わりの番号: 0 = 頼まれていない変化なし / 3 = 頼まれていない変化あり / 2 = 読めない
"""
import argparse
import colorsys
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# 決まった部品の名前(K1 looks.2d.parts。正本は creator/pipeline/d03_svgkit.py の PARTS。試験で同じかを見る)
PARTS = ("shadow", "back", "foot_R", "foot_L", "arm_R", "arm_L", "body", "head", "ear_R", "ear_L",
         "cheek_R", "cheek_L", "eye_R", "eye_L", "brow_R", "brow_L", "mouth", "hat", "accessory")
LABEL = {"shadow": "影", "back": "背中の物", "foot_R": "右足", "foot_L": "左足", "arm_R": "右手", "arm_L": "左手",
         "body": "体", "head": "頭", "ear_R": "右耳", "ear_L": "左耳", "cheek_R": "右のほお", "cheek_L": "左のほお",
         "eye_R": "右目", "eye_L": "左目", "brow_R": "右のまゆ", "brow_L": "左のまゆ", "mouth": "口", "hat": "頭の上の物",
         "accessory": "飾り"}
PAIR_LABEL = {"foot": "足", "arm": "手", "ear": "耳", "cheek": "ほお", "eye": "目", "brow": "まゆ"}
FACE = ("eye_R", "eye_L", "brow_R", "brow_L", "mouth", "cheek_R", "cheek_L")

OPAQUE = 0.6          # これより薄い塗り(光・影・縁の重ね)は、部品の色と箱に数えない
MEAN_DE = 15.0        # 部品の色の平均(Lab)がこれより離れたら「色が変わった」
SPREAD_DE = 32.0      # 目立つ色(重みの 8% 以上)のどれかが、相手の色からこれより離れたら「色が変わった」
SPREAD_SHARE = 0.08
MOVE_MIN, MOVE_RATE = 30.0, 0.2      # 箱の中心が max(30px, 大きさの 20%)より動いたら「位置が変わった」
SIZE_LO, SIZE_HI, SIZE_MIN = 0.8, 1.25, 20.0   # 幅か高さが 0.8〜1.25 倍の外で、20px より違えば「大きさが変わった」
FOLLOW_DE = 12.0      # 体と同じ色だった部品が、変わった後も体と同じ色なら、体の色の頼みに付いていったとみなす
RASTER_SHARE, RASTER_DE = 0.08, 22.0  # 絵だけの時: 前の主な色(8% 以上)が、今の主な色から 22 より離れたら知らせる

SVG_NS = "http://www.w3.org/2000/svg"
SKIP_TAGS = {"defs", "clipPath", "mask", "filter", "linearGradient", "radialGradient", "pattern", "symbol",
             "title", "desc", "metadata", "style", "script", "marker"}
SHAPES = {"rect", "circle", "ellipse", "path", "polygon", "polyline", "line"}
NAMED = {"white": "#ffffff", "black": "#000000", "red": "#ff0000", "blue": "#0000ff", "green": "#008000",
         "yellow": "#ffff00", "orange": "#ffa500", "pink": "#ffc0cb", "gray": "#808080", "grey": "#808080",
         "brown": "#a52a2a", "purple": "#800080"}

# ---------- 一言の言葉 → 変えてよい部品・変わり方 ----------
# 部品の言葉(使う人の言い方)。短すぎて別の語に混ざる字(め・て・は)は入れない
PART_WORDS = [
    (r"全部|ぜんぶ|全体|ぜんたい|まるごと|丸ごと|別の子|べつの子|最初から|さいしょから|作り直|つくり直|つくりなお", "*"),
    (r"葉っぱ|はっぱ|(?<!言)葉|リーフ|くき|茎|へた|ヘタ|芽|花", "hat accessory ear_R ear_L head"),
    (r"帽子|ぼうし|ハット|キャップ|かんむり|冠|王冠|頭の上|あたまの上", "hat accessory"),
    (r"リボン|ネクタイ|蝶ネクタイ|首輪|くびわ|マフラー|スカーフ|バッジ|かばん|カバン|飾り|かざり|アクセサリー|メガネ|めがね|眼鏡", "accessory hat"),
    (r"角|つの|ツノ|髪|かみの毛|髪の毛|前髪|まえがみ|とさか", "hat head ear_R ear_L"),
    (r"耳|みみ", "ear_R ear_L"),
    (r"しっぽ|尻尾|シッポ|尾|羽|はね|つばさ|翼|背中|せなか|マント|リュック", "back"),
    (r"顔|かお|表情|ひょうじょう", "eye_R eye_L brow_R brow_L mouth cheek_R cheek_L"),
    (r"(?<![た回番度つ])目(?!立)|瞳|ひとみ|まつげ|まつ毛", "eye_R eye_L"),
    (r"まゆ|眉", "brow_R brow_L"),
    (r"口|くち|歯|舌|べろ|くちばし|クチバシ|ひげ|ヒゲ", "mouth"),
    (r"ほお|ほっぺ|頬|チーク", "cheek_R cheek_L"),
    (r"(?<![上下相])手|うで|腕", "arm_R arm_L"),
    (r"足(?!し|す|り|さ|せ)|あし|脚|くつ|靴", "foot_R foot_L"),
    (r"(?<![全具])体|からだ|胴|おなか|お腹|ボディ|皮", "body"),
    (r"頭|あたま", "head hat"),
    (r"影|かげ", "shadow"),
]
COLOR_WORDS = r"色|いろ|赤|あか|青|あお|緑|みどり|黄|きいろ|白|しろ|黒|くろ|ピンク|茶|ちゃいろ|オレンジ|橙|だいだい|紫|むらさき|水色|みずいろ|金|銀|灰|グレー|明るく|あかるく|暗く|くらく|濃く|こく|薄く|うすく|カラフル"
SHAPE_WORDS = r"大き|おおき|小さ|ちいさ|長く|ながく|短く|みじかく|太く|ふとく|細く|ほそく|丸く|まるく|形|かたち|大きさ|伸ば|のば|高く|たかく|低く|ひくく|とがら|ふっくら|位置|いち|向き|むき|上に|下に|右に|左に"
ADD_WORDS = r"増や|ふや|足して|たして|足す|付けて|つけて|付ける|つける|もう\s*\d|もう一|もうひと|[2-9２-９]\s*(枚|本|つ|個)|二|ふた|三|みっ|生やして|はやして"
REMOVE_WORDS = r"減ら|へら|外して|はずして|取って|とって|なくして|消して|けして|いらない|要らない"
NAME_WORDS = r"名前|なまえ"
# 選んだ言葉(review_state.TAGS の C0)の意味
TAG_RULES = {"言葉と違う": "all", "色が違う": "color_all", "顔が違う": "face", "部品が足りない": "add_all", "部品が多い": "remove_all",
             "かわいくない": "shape_all", "ゆるさが足りない": "shape_all", "線が多い": "shape_all"}


def _norm(text):
    import unicodedata
    return unicodedata.normalize("NFKC", str(text or ""))


def part_map(settings_text):
    """その子の設定の文から、部品の呼び名を読む: 「hat(くき)」「ear_R/L(葉っぱ 2 枚)」「- 部品: hat = 葉っぱ・へた」。
    戻り値 {部品: 呼び名の文}。"""
    out = {}
    text = _norm(settings_text)
    for m in re.finditer(r"\b(" + "|".join(sorted({p.split("_")[0] for p in PARTS}, key=len, reverse=True)) +
                         r")(?:_([RL])(?:/([RL]))?)?\s*[(\(]([^)\)]{1,40})[)\)]", text):
        base, s1, s2, label = m.group(1), m.group(2), m.group(3), m.group(4)
        for p in _expand(base, s1, s2):
            out[p] = (out.get(p, "") + " " + label).strip()
    for m in re.finditer(r"部品\s*[::]\s*([a-z]+)(?:_([RL])(?:/([RL]))?)?\s*[=＝]\s*([^\n]{1,60})", text):
        for p in _expand(m.group(1), m.group(2), m.group(3)):
            out[p] = (out.get(p, "") + " " + m.group(4)).strip()
    return out


def _expand(base, s1=None, s2=None):
    if base in PARTS:
        return [base]
    sides = [s for s in (s1, s2) if s] or ["R", "L"]
    return [f"{base}_{s}" for s in sides if f"{base}_{s}" in PARTS]


def allowed(note="", tags=(), labels=None):
    """一言と選んだ言葉から、変えてよい物を決める。戻り値の dict:
    all(全部よい)・parts(何でも変えてよい部品)・color(色だけ変えてよい部品)・shape(形だけ変えてよい部品)・
    add / remove(増やす・減らすのがよい部品。"*" は全部)・name(名前を変えてよい)・words(読んだ部品の言葉)。"""
    text = _norm(note)
    a = {"all": False, "parts": set(), "color": set(), "shape": set(), "add": set(), "remove": set(), "name": False, "words": []}
    for t in tags or ():
        rule = TAG_RULES.get(t)
        if rule == "all":
            a["all"] = True
        elif rule == "color_all":
            a["color"] |= set(PARTS)
        elif rule == "face":
            a["parts"] |= set(FACE)
        elif rule == "add_all":
            a["add"].add("*")
        elif rule == "remove_all":
            a["remove"].add("*")
        elif rule == "shape_all":
            a["shape"] |= set(PARTS)
    named = set()
    for pat, parts in PART_WORDS:
        m = re.search(pat, text)
        if m:
            if parts == "*":
                a["all"] = True
            else:
                named |= set(parts.split())
                a["words"].append(m.group(0))
    for p, label in (labels or {}).items():          # その子の部品の呼び名(葉っぱ・くき など)が一言にあれば、その部品
        for w in re.split(r"[\s・、,/((〜~]+", _norm(label)):
            w = re.sub(r"[\d枚本個つ)\)]+$", "", w).strip()
            if len(w) >= 2 and w in text:
                named.add(p)
                a["words"].append(w)
    a["parts"] |= named
    has_color = bool(re.search(COLOR_WORDS, text))
    has_shape = bool(re.search(SHAPE_WORDS, text))
    if re.search(ADD_WORDS, text):
        a["add"] |= named or {"*"}
    if re.search(REMOVE_WORDS, text):
        a["remove"] |= named or {"*"}
    if re.search(NAME_WORDS, text):
        a["name"] = True
    if not named and not a["all"]:
        if has_color:
            a["color"] |= {"body", "head"}     # 「もっと赤く」= 体の色
        if has_shape or not (has_color or a["name"]):
            a["shape"] |= set(PARTS)           # 「もっと丸く」・どこを指すか読めない一言は、形だけ変えてよい(色と数は保つ)
    return a


# ---------- 色 ----------

def hex_rgb(h):
    h = h.strip().lower()
    h = NAMED.get(h, h)
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?", h)
    if not m:
        m2 = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", h)
        return tuple(int(x) for x in m2.groups()) if m2 else None
    s = m.group(1)
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def rgb_hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(c)))) for c in rgb)


def lab(rgb):
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = r * 0.2126 + g * 0.7152 + b * 0.0722
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def lab_rgb(lb):
    L, a, b = lb
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200

    def finv(t):
        return t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787
    x, y, z = finv(fx) * 0.95047, finv(fy), finv(fz) * 1.08883
    r = x * 3.2406 + y * -1.5372 + z * -0.4986
    g = x * -0.9689 + y * 1.8758 + z * 0.0415
    bb = x * 0.0557 + y * -0.2040 + z * 1.0570

    def gam(c):
        c = max(0.0, min(1.0, c))
        return 255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055)
    return (gam(r), gam(g), gam(bb))


def de(l1, l2):
    return math.dist(l1, l2)


def color_name(hexc):
    """色のやさしい名前(札に出す)。"""
    rgb = hex_rgb(hexc) if isinstance(hexc, str) else hexc
    if rgb is None:
        return "色"
    h, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    hd = h * 360
    if v < 0.18:
        return "黒"
    if s < 0.14:
        return "白" if v > 0.9 else "灰色" if v > 0.35 else "黒"
    if hd < 15 or hd >= 345:
        return "こげ茶" if v < 0.45 else "ピンク" if s < 0.45 and v > 0.85 else "赤"
    if hd < 40:
        return "茶色" if v < 0.6 else "うすだいだい" if s < 0.35 else "だいだい"
    if hd < 66:
        return "茶色" if v < 0.55 else "クリーム" if s < 0.35 and v > 0.9 else "黄"
    if hd < 90:
        return "黄緑"
    if hd < 160:
        return "緑"
    if hd < 200:
        return "水色" if v > 0.7 else "青緑"
    if hd < 255:
        return "水色" if s < 0.35 and v > 0.85 else "青"
    if hd < 290:
        return "紫"
    return "ピンク" if v > 0.7 else "赤紫"


# ---------- 形(箱と面積の目安) ----------

def _nums(s):
    return [float(x) for x in re.findall(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?", s or "")]


def _f(el, name, d=0.0):
    try:
        return float(re.sub(r"px$", "", el.get(name, "")) or d)
    except ValueError:
        return d


def _mat_mul(a, b):
    return (a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3],
            a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5])


IDENT = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def parse_transform(t):
    m = IDENT
    for name, args in re.findall(r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)", t or ""):
        v = _nums(args)
        if name == "matrix" and len(v) == 6:
            step = tuple(v)
        elif name == "translate":
            step = (1, 0, 0, 1, v[0] if v else 0, v[1] if len(v) > 1 else 0)
        elif name == "scale":
            sx = v[0] if v else 1
            step = (sx, 0, 0, v[1] if len(v) > 1 else sx, 0, 0)
        elif name == "rotate":
            a = math.radians(v[0] if v else 0)
            c, s = math.cos(a), math.sin(a)
            step = (c, s, -s, c, 0, 0)
            if len(v) >= 3:
                step = _mat_mul(_mat_mul((1, 0, 0, 1, v[1], v[2]), step), (1, 0, 0, 1, -v[1], -v[2]))
        elif name == "skewX":
            step = (1, 0, math.tan(math.radians(v[0] if v else 0)), 1, 0, 0)
        else:
            step = (1, math.tan(math.radians(v[0] if v else 0)), 0, 1, 0, 0)
        m = _mat_mul(m, step)
    return m


def _apply_box(m, box):
    if box is None:
        return None
    x0, y0, x1, y1 = box
    pts = [(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def path_points(d):
    """path の d から、通る点と制御点(箱の目安)を返す。相対の命令も追う。"""
    toks = re.findall(r"[MmZzLlHhVvCcSsQqTtAa]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?", d or "")
    pts, cx, cy, sx, sy, cmd, i = [], 0.0, 0.0, 0.0, 0.0, None, 0
    size = {"M": 2, "L": 2, "T": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "A": 7, "Z": 0}
    while i < len(toks):
        t = toks[i]
        if re.fullmatch(r"[A-Za-z]", t):
            cmd = t
            i += 1
            if cmd in "Zz":
                cx, cy = sx, sy
                pts.append((cx, cy))
            continue
        if cmd is None:
            break
        n = size[cmd.upper()]
        args = [float(x) for x in toks[i:i + n]]
        if len(args) < n:
            break
        i += n
        rel = cmd.islower()
        up = cmd.upper()
        if up == "H":
            cx = cx + args[0] if rel else args[0]
            pts.append((cx, cy))
        elif up == "V":
            cy = cy + args[0] if rel else args[0]
            pts.append((cx, cy))
        elif up == "A":
            nx, ny = (cx + args[5], cy + args[6]) if rel else (args[5], args[6])
            r = max(abs(args[0]), abs(args[1]))
            midx, midy = (cx + nx) / 2, (cy + ny) / 2
            pts += [(midx - r, midy - r), (midx + r, midy + r), (nx, ny)]
            cx, cy = nx, ny
        else:
            for k in range(0, n, 2):
                px, py = (cx + args[k], cy + args[k + 1]) if rel else (args[k], args[k + 1])
                pts.append((px, py))
            cx, cy = pts[-1]
        if up == "M":
            sx, sy = cx, cy
            cmd = "l" if rel else "L"
    return pts


def shape_geom(el, tag):
    """(箱, 面積の目安)。読めない形は (None, 0)。"""
    if tag == "rect":
        x, y, w, h = _f(el, "x"), _f(el, "y"), _f(el, "width"), _f(el, "height")
        return ((x, y, x + w, y + h), w * h) if w > 0 and h > 0 else (None, 0)
    if tag == "circle":
        cx, cy, r = _f(el, "cx"), _f(el, "cy"), _f(el, "r")
        return ((cx - r, cy - r, cx + r, cy + r), math.pi * r * r) if r > 0 else (None, 0)
    if tag == "ellipse":
        cx, cy, rx, ry = _f(el, "cx"), _f(el, "cy"), _f(el, "rx"), _f(el, "ry")
        return ((cx - rx, cy - ry, cx + rx, cy + ry), math.pi * rx * ry) if rx > 0 and ry > 0 else (None, 0)
    if tag == "line":
        x1, y1, x2, y2 = _f(el, "x1"), _f(el, "y1"), _f(el, "x2"), _f(el, "y2")
        w = _f(el, "stroke-width", 1.0)
        return (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)), math.dist((x1, y1), (x2, y2)) * w
    pts = path_points(el.get("d")) if tag == "path" else list(zip(*[iter(_nums(el.get("points")))] * 2))
    if len(pts) < 2:
        return None, 0
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    box = (min(xs), min(ys), max(xs), max(ys))
    area = (box[2] - box[0]) * (box[3] - box[1]) * 0.6
    if area <= 1:      # 線だけの形(口の線など)は、長さ×太さ
        area = math.dist((box[0], box[1]), (box[2], box[3])) * _f(el, "stroke-width", 1.0)
    return box, area


# ---------- SVG を読む ----------

def _local(tag):
    return tag.split("}", 1)[-1] if isinstance(tag, str) else ""


def _style(el):
    out = {}
    for kv in (el.get("style") or "").split(";"):
        if ":" in kv:
            k, v = kv.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def _attr(el, name):
    st = _style(el)
    return st.get(name, el.get(name))


def _num(v, d=1.0):
    try:
        return float(str(v).strip().rstrip("%")) / (100.0 if str(v).strip().endswith("%") else 1.0)
    except (TypeError, ValueError):
        return d


class Doc:
    def __init__(self, svg_text):
        self.root = ET.fromstring(svg_text)
        self.by_id = {el.get("id"): el for el in self.root.iter() if el.get("id")}
        self._grad = {}

    def gradient(self, gid, depth=0):
        """グラデーションの止めの [(rgb, 不透明さ)]。href で継ぐ形も読む。"""
        if gid in self._grad:
            return self._grad[gid]
        el = self.by_id.get(gid)
        stops = []
        if el is not None and _local(el.tag) in ("linearGradient", "radialGradient"):
            for s in el:
                if _local(s.tag) != "stop":
                    continue
                rgb = hex_rgb(_attr(s, "stop-color") or "#000000")
                if rgb:
                    stops.append((rgb, _num(_attr(s, "stop-opacity"), 1.0)))
            href = el.get("{http://www.w3.org/1999/xlink}href") or el.get("href")
            if not stops and href and href.startswith("#") and depth < 5:
                stops = self.gradient(href[1:], depth + 1)
        self._grad[gid] = stops
        return stops

    def clip_box(self, ref):
        m = re.match(r"url\(\s*#([^)\s]+)\s*\)", ref or "")
        el = self.by_id.get(m.group(1)) if m else None
        if el is None:
            return None, 0
        boxes, area = [], 0.0
        for ch in el.iter():
            tag = _local(ch.tag)
            if tag in SHAPES:
                b, a = shape_geom(ch, tag)
                b = _apply_box(parse_transform(ch.get("transform")), b)
                if b:
                    boxes.append(b)
                    area += a
        if not boxes:
            return None, 0
        return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)), area

    def paint(self, value):
        """塗りの値 → [(rgb, 止めの不透明さ, 割合)]。none・読めない値は []。"""
        v = (value or "").strip()
        if not v or v in ("none", "transparent", "currentColor", "inherit"):
            return []
        m = re.match(r"url\(\s*#([^)\s]+)\s*\)", v)
        if m:
            stops = self.gradient(m.group(1))
            return [(rgb, op, 1.0 / len(stops)) for rgb, op in stops] if stops else []
        rgb = hex_rgb(v)
        return [(rgb, 1.0, 1.0)] if rgb else []


def _intersect(a, b):
    if a is None or b is None:
        return a or b
    box = (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))
    return box if box[2] > box[0] and box[3] > box[1] else None


def read_parts(svg_text):
    """SVG の決まった名前の部品ごとに {colors: [(lab, 重み, hex)], box, n, weight} を返す。"""
    doc = Doc(svg_text)
    parts = {}

    def walk(el, p, m, op, fill, fill_op, stroke, clip, masked):
        tag = _local(el.tag)
        if tag in SKIP_TAGS:
            return
        m = _mat_mul(m, parse_transform(el.get("transform")))
        op = op * _num(_attr(el, "opacity"), 1.0)
        fill = _attr(el, "fill") if _attr(el, "fill") is not None else fill
        fill_op = fill_op * _num(_attr(el, "fill-opacity"), 1.0) if _attr(el, "fill-opacity") is not None else fill_op
        stroke = _attr(el, "stroke") if _attr(el, "stroke") is not None else stroke
        if el.get("clip-path"):
            cb, carea = doc.clip_box(el.get("clip-path"))
            clip = (_intersect(clip[0], _apply_box(m, cb)) if clip else _apply_box(m, cb), min(carea, clip[1]) if clip else carea)
        masked = masked or bool(el.get("mask"))
        if tag in SHAPES:
            box, area = shape_geom(el, tag)
            box = _apply_box(m, box)
            sc = abs(m[0] * m[3] - m[1] * m[2]) or 1.0
            area *= sc
            if clip:
                box = _intersect(box, clip[0])
                area = min(area, clip[1] * sc if clip[1] else area)
            eff = op * (0.3 if masked else 1.0)
            paints = [(rgb, sop * eff * fill_op, share) for rgb, sop, share in doc.paint(fill if fill is not None else "#000000")]
            if not paints and stroke:
                paints = [(rgb, sop * eff, share) for rgb, sop, share in doc.paint(stroke)]
            rec = parts.setdefault(p, {"colors": [], "box": None, "n": 0, "weight": 0.0})
            counted = False
            for rgb, o, share in paints:
                if o < OPAQUE or box is None or area <= 0:
                    continue
                w = area * o * share
                rec["colors"].append((lab(rgb), w, rgb_hex(rgb)))
                rec["weight"] += w
                counted = True
            if counted:
                rec["n"] += 1
                b = rec["box"]
                rec["box"] = box if b is None else (min(b[0], box[0]), min(b[1], box[1]), max(b[2], box[2]), max(b[3], box[3]))
        for ch in el:
            walk(ch, p, m, op, fill, fill_op, stroke, clip, masked)

    def find(el):
        for ch in el:
            pid = ch.get("id")
            if _local(ch.tag) == "g" and pid in PARTS:
                parts.setdefault(pid, {"colors": [], "box": None, "n": 0, "weight": 0.0})
                walk(ch, pid, IDENT, 1.0, None, 1.0, None, None, False)
            elif _local(ch.tag) not in SKIP_TAGS:
                find(ch)
    find(doc.root)
    for rec in parts.values():
        rec["mean"] = _mean(rec["colors"])
    return parts


def _mean(colors):
    tot = sum(w for _, w, _ in colors)
    if tot <= 0:
        return None
    return tuple(sum(c[0][i] * c[1] for c in colors) / tot for i in range(3))


def _main_colors(colors, share=SPREAD_SHARE, merge=10.0):
    """目立つ色(重みの share 以上)を、近い色をまとめて [(lab, 割合, hex)] で返す(重い順)。"""
    tot = sum(w for _, w, _ in colors) or 1.0
    groups = []
    for lb, w, hx in sorted(colors, key=lambda c: -c[1]):
        for g in groups:
            if de(g[0], lb) < merge:
                g[1] += w
                break
        else:
            groups.append([lb, w, hx])
    return [(g[0], g[1] / tot, g[2]) for g in sorted(groups, key=lambda g: -g[1]) if g[1] / tot >= share]


# ---------- くらべる ----------

def _group(parts_list):
    """左右の組を「目(左右)」のようにまとめた呼び名の一覧。"""
    names, done = [], set()
    for p in parts_list:
        if p in done:
            continue
        base, _, side = p.partition("_")
        twin = f"{base}_{'L' if side == 'R' else 'R'}" if side else None
        if twin and twin in parts_list:
            names.append(f"{PAIR_LABEL.get(base, base)}(左右)")
            done |= {p, twin}
        else:
            names.append(LABEL.get(p, p))
            done.add(p)
    return names


def compare(prev_svg, new_svg, note="", tags=(), prev_name=None, new_name=None, labels=None):
    """前の回と今の回をくらべる。戻り値 {ok, beyond: [...], within: [...], allowed, parts_prev, parts_new}。
    beyond の 1 つ = {kind: color|shape|added|removed|name, parts: [...], before, after, text(札の言葉), brief(描き手への言葉)}。"""
    a = allowed(note, tags, labels)
    old, new = read_parts(prev_svg), read_parts(new_svg)
    beyond, within = [], []

    def may(kind, p):
        if a["all"] or p in a["parts"]:
            return True
        if kind == "color":
            return p in a["color"]
        if kind == "shape":
            return p in a["shape"]
        if kind == "added":
            return "*" in a["add"] or p in a["add"]
        if kind == "removed":
            return "*" in a["remove"] or p in a["remove"]
        return False

    def follows_body(p, o, n):
        for base in ("body", "head"):
            if p == base or base not in old or base not in new or not may("color", base):
                continue
            bo, bn = old[base]["mean"], new[base]["mean"]
            if bo and bn and de(o["mean"], bo) < FOLLOW_DE and de(n["mean"], bn) < FOLLOW_DE:
                return True
        return False

    def put(kind, p, before=None, after=None):
        (within if may(kind, p) else beyond).append({"kind": kind, "part": p, "before": before, "after": after})

    for p in PARTS:
        if p in old and p not in new:
            put("removed", p)
        elif p in new and p not in old:
            put("added", p)
        elif p in old and p in new:
            o, n = old[p], new[p]
            if o["mean"] is not None and n["mean"] is not None and p != "shadow":
                d_mean = de(o["mean"], n["mean"])
                om, nm = _main_colors(o["colors"]), _main_colors(n["colors"])
                spread = 0.0
                for x in om:
                    spread = max(spread, min((de(x[0], y[0]) for y in n["colors"]), default=0))
                for y in nm:
                    spread = max(spread, min((de(y[0], x[0]) for x in o["colors"]), default=0))
                if d_mean > MEAN_DE or spread > SPREAD_DE:
                    if follows_body(p, o, n):        # 体と同じ色の部品(手・足など)は、体の色の頼みに付いていってよい
                        within.append({"kind": "color", "part": p, "before": rgb_hex(lab_rgb(o["mean"])), "after": rgb_hex(lab_rgb(n["mean"]))})
                    else:
                        put("color", p, rgb_hex(lab_rgb(o["mean"])), rgb_hex(lab_rgb(n["mean"])))
            if o["box"] and n["box"]:
                ob, nb = o["box"], n["box"]
                ow, oh, nw, nh = ob[2] - ob[0], ob[3] - ob[1], nb[2] - nb[0], nb[3] - nb[1]
                move = math.dist(((ob[0] + ob[2]) / 2, (ob[1] + ob[3]) / 2), ((nb[0] + nb[2]) / 2, (nb[1] + nb[3]) / 2))
                grown = any((r < SIZE_LO or r > SIZE_HI) and abs(x1 - x0) > SIZE_MIN
                            for r, x0, x1 in ((nw / ow if ow else 1, ow, nw), (nh / oh if oh else 1, oh, nh)))
                if move > max(MOVE_MIN, MOVE_RATE * max(ow, oh)) or grown:
                    put("shape", p, [round(v) for v in ob], [round(v) for v in nb])
    if prev_name and new_name and prev_name != new_name:
        (within if a["name"] or a["all"] else beyond).append({"kind": "name", "part": None, "before": prev_name, "after": new_name})
    return {"ok": not beyond, "beyond": _texts(beyond), "within": _texts(within), "allowed": _plain_allowed(a),
            "parts_prev": sorted(old), "parts_new": sorted(new)}


def _texts(items):
    """同じ種類の変化をまとめ、札の言葉(text)と描き手への言葉(brief)を付ける。"""
    out = []
    for kind in ("color", "added", "removed", "shape", "name"):
        rows = [x for x in items if x["kind"] == kind]
        if not rows:
            continue
        if kind == "name":
            r = rows[0]
            out.append({**r, "parts": [], "text": f"名前(「{r['before']}」→「{r['after']}」)",
                        "brief": f"名前: 前の回は「{r['before']}」。settings.md の 1 行目を「名前: {r['before']}」に戻す"})
            continue
        parts = [x["part"] for x in rows]
        names = "・".join(_group(parts))
        if kind == "color":
            pieces, briefs = [], []
            for x in rows:
                pieces.append((x["part"], f"{color_name(x['before'])}→{color_name(x['after'])}"))
                briefs.append(f"{x['part']}({LABEL[x['part']]}) 前 {x['before']} → 今 {x['after']}")
            seen, txt = set(), []
            for p, change in pieces:
                key = (p.split("_")[0] if p.endswith(("_R", "_L")) else p, change)
                if key in seen:
                    continue
                seen.add(key)
                label = PAIR_LABEL.get(key[0], LABEL.get(p, p)) if p.endswith(("_R", "_L")) else LABEL.get(p, p)
                txt.append(f"{label}の色({change})")
            out.append({"kind": kind, "parts": parts, "text": "・".join(txt),
                        "brief": "色を前の回に戻す: " + "、".join(briefs)})
        elif kind == "added":
            out.append({"kind": kind, "parts": parts, "text": f"{names}が増えた",
                        "brief": f"増えた部品を外す(前の回に無かった): {', '.join(parts)}"})
        elif kind == "removed":
            out.append({"kind": kind, "parts": parts, "text": f"{names}がなくなった",
                        "brief": f"なくなった部品を戻す(前の回にあった): {', '.join(parts)}"})
        else:
            out.append({"kind": kind, "parts": parts, "text": f"{names}の形か位置",
                        "brief": "形・位置・大きさを前の回に戻す: " + "、".join(
                            f"{x['part']} 前の箱 {x['before']} → 今 {x['after']}" for x in rows)})
    return out


def _plain_allowed(a):
    if a["all"]:
        return {"all": True, "text": "全部(作り直し)"}
    bits = []
    if a["parts"]:
        bits.append("・".join(_group(sorted(a["parts"], key=PARTS.index))) + "(色・形・数)")
    color_only = sorted(a["color"] - a["parts"], key=PARTS.index)
    if color_only:
        bits.append(("全部の部品" if len(color_only) >= len(PARTS) - 1 else "・".join(_group(color_only))) + "の色")
    shape_only = sorted(a["shape"] - a["parts"], key=PARTS.index)
    if shape_only:
        bits.append(("全部の部品" if len(shape_only) >= len(PARTS) - 1 else "・".join(_group(shape_only))) + "の形・大きさ")
    if "*" in a["add"]:
        bits.append("部品を足す")
    if "*" in a["remove"]:
        bits.append("部品を減らす")
    if a["name"]:
        bits.append("名前")
    return {"all": False, "text": "、".join(bits) or "なし", "parts": sorted(a["parts"], key=PARTS.index), "words": a["words"]}


def notice_text(beyond, limit=120):
    """札に出す、やさしい日本語の一言(120 字まで)。"""
    if not beyond:
        return None
    head = "頼んでいない所も変わりました: "
    tail = "。直す時は「直したい」で一言どうぞ"
    items = [b["text"] for b in beyond if b["kind"] != "name"]
    if not items:
        return None
    body = ""
    for i, t in enumerate(items):
        nxt = (body + "・" if body else "") + t
        if len(head + nxt + tail) > limit - 4:
            body = (body or t[: max(10, limit - len(head + tail) - 4)]) + " ほか"
            break
        body = nxt
    return (head + body + tail)[:limit]


# ---------- 描き手への頼みの文(申し送りの前に、前の回の部品と色をそのまま並べる) ----------

def inventory(svg_text):
    """[(部品, 呼び名, 目立つ色の hex の組, 箱)]。"""
    rows = []
    parts = read_parts(svg_text)
    for p in PARTS:
        if p not in parts:
            continue
        rec = parts[p]
        cols = [hx for _, _, hx in _main_colors(rec["colors"], share=0.1)][:3]
        rows.append((p, LABEL[p], cols, [round(v) for v in rec["box"]] if rec["box"] else None))
    return rows


def keep_brief(svg_text, note="", tags=(), labels=None, name=None):
    """頼みの文に入れる「保つ物」の節(前の回の部品・色・箱をそのまま並べ、変えてよい物と変えない物を分けて書く)。"""
    al = allowed(note, tags, labels)
    a = _plain_allowed(al)
    rows = inventory(svg_text)
    have = [p for p, *_ in rows]
    lines = [f"- 前の回の絵の部品(全部で {len(rows)} 個): " + "・".join(have)]
    for p, label, cols, box in rows:
        lab_txt = f"(呼び名: {labels[p]})" if labels and labels.get(p) else ""
        box_txt = f" 箱 {box}" if box else ""
        lines.append(f"  - {p}({label}){lab_txt}: 色 {'・'.join(cols) or 'なし'}{box_txt}")
    lines.append(f"- 一言で変えてよい物: {a['text']}")
    if al["all"]:
        return "\n".join(lines)
    free = al["parts"]
    keep_color = [p for p in have if p not in free and p not in al["color"] and p != "shadow"]
    keep_shape = [p for p in have if p not in free and p not in al["shape"]]
    keep = []
    if keep_color:
        keep.append("・".join(_group(keep_color)) + "の色(上の hex のまま)")
    if keep_shape:
        keep.append("・".join(_group(keep_shape)) + "の形・位置・大きさ")
    if "*" not in al["add"] and "*" not in al["remove"]:
        keep.append("部品の数と種類(" + ("上の部品のほかに増やさない・減らさない" if not free else
                                      "変えてよい部品のほかは、増やさない・減らさない") + ")")
    if not al["name"]:
        keep.append(f"名前「{name}」" if name else "名前")
    if keep:
        lines.append("- 変えない物: " + "、".join(keep))
    return "\n".join(lines)


# ---------- 絵(PNG)だけの時 ----------

def raster_main_colors(png_path, share=RASTER_SHARE):
    """絵の主な色(白い地と灰色の影を除く)。[(lab, 割合, hex)]。"""
    from PIL import Image
    im = Image.open(png_path).convert("RGB")
    im.thumbnail((160, 160))
    counts = {}
    for rgb in getattr(im, "get_flattened_data", im.getdata)():
        h, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
        if (s < 0.12 and v > 0.55) or v > 0.97 and s < 0.2:   # 白い地・灰色の床の影
            continue
        key = tuple((c // 24) * 24 + 12 for c in rgb)
        counts[key] = counts.get(key, 0) + 1
    colors = [(lab(k), n, rgb_hex(k)) for k, n in counts.items()]
    return _main_colors(colors, share=share, merge=14.0)


def compare_raster(prev_png, new_png, note="", tags=(), labels=None):
    """前の回が絵だけの時: 前の主な色が今の絵にも残っているかだけを見る(部品には分けない)。"""
    a = allowed(note, tags, labels)
    old, new = raster_main_colors(prev_png), raster_main_colors(new_png, share=0.03)
    lost = []
    for lb, sh, hx in old:
        near = min((de(lb, y[0]) for y in new), default=99)
        if near > RASTER_DE:
            lost.append((hx, sh))
    may = a["all"] or bool(a["color"]) and len(a["color"]) >= len(PARTS) - 1
    beyond = [] if may or not lost else [{"kind": "color", "parts": [], "before": [h for h, _ in lost], "after": None,
                                          "text": "主な色(" + "・".join(sorted({color_name(h) for h, _ in lost})) + ")が見えない",
                                          "brief": "前の回の絵の主な色が見えない: " + "、".join(f"{h}(絵の {round(s * 100)}%)" for h, s in lost)}]
    return {"ok": not beyond, "beyond": beyond, "within": [], "allowed": _plain_allowed(a), "raster": True,
            "colors_prev": [h for _, _, h in old], "colors_new": [h for _, _, h in new]}


def read_name(settings_text):
    for line in str(settings_text or "").splitlines()[:6]:
        m = re.match(r"^\s*[#*\-\s]*名前\s*[:：]\s*([^\s(（|*]{1,20})", line)
        if m:
            return m.group(1)
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description="描き直しで、頼まれた所だけが変わったかを確かめる")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("compare")
    c.add_argument("prev")
    c.add_argument("new")
    c.add_argument("--request-file")
    c.add_argument("--prev-settings")
    c.add_argument("--new-settings")
    c.add_argument("--new-png")
    c.add_argument("--json")
    i = sub.add_parser("inventory")
    i.add_argument("svg")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "inventory":
            print(keep_brief(Path(a.svg).read_text(encoding="utf-8")))
            return 0
        req = json.loads(Path(a.request_file).read_text(encoding="utf-8")) if a.request_file else {}
        prev_set = Path(a.prev_settings).read_text(encoding="utf-8") if a.prev_settings and Path(a.prev_settings).exists() else ""
        new_set = Path(a.new_settings).read_text(encoding="utf-8") if a.new_settings and Path(a.new_settings).exists() else ""
        labels = part_map(prev_set)
        if a.prev.lower().endswith(".svg"):
            res = compare(Path(a.prev).read_text(encoding="utf-8"), Path(a.new).read_text(encoding="utf-8"),
                          req.get("note") or "", req.get("tags") or [], read_name(prev_set) or req.get("name"), read_name(new_set), labels)
        else:
            res = compare_raster(a.prev, a.new_png or a.new, req.get("note") or "", req.get("tags") or [], labels)
    except (OSError, ET.ParseError, ValueError) as e:
        print(f"くらべられませんでした: {e}", file=sys.stderr)
        return 2
    if a.json:
        Path(a.json).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print("変えてよい物: " + res["allowed"]["text"])
    if res["ok"]:
        print("頼まれていない変化: なし")
        return 0
    print("頼まれていない変化:")
    for b in res["beyond"]:
        print(f"- {b['brief']}")
    return 3


if __name__ == "__main__":
    sys.exit(main())
