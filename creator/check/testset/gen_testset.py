"""ゆるキャラチェック(c01_yuru_check.py)の試験の絵 6 枚を、Claude が SVG のコードで描く(2026-11-06)。

使い方: python creator/check/testset/gen_testset.py <出力フォルダ>
出す物: <出力>/<名前>.svg と、正解の表 labels.json。PNG は d01_svg_to_png.py で作る(試験の台本 run_testset.py がする)。
- ゆるキャラ 2 枚: yuru_onigiri(おにぎり型の二足)・yuru_shizuku(しずく型、足なし)
- 人の顔の絵 2 枚: human_boy(正面の少年の顔、写実寄りの塗り)・human_woman(斜めの女性、長い髪と肩)
- 複雑な絵 2 枚: complex_town(建物・窓・車・木が多い町の景色)・complex_clutter(小さな部品が 400 個ある機械の絵)
実在の人・既存のキャラは描かない。写真は使わない(全部この場の図形)。
"""
import json
import math
import random
import sys
from pathlib import Path

W = 1254
HEAD = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {W}" width="{W}" height="{W}">'


def svg(defs, body, bg="#ffffff"):
    return f'{HEAD}<defs>{defs}</defs><rect width="{W}" height="{W}" fill="{bg}"/>{body}</svg>\n'


def rg(i, stops, cx, cy, r, fx=None, fy=None):
    st = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    f = f' fx="{fx}" fy="{fy}"' if fx is not None else ""
    return f'<radialGradient id="{i}" gradientUnits="userSpaceOnUse" cx="{cx}" cy="{cy}" r="{r}"{f}>{st}</radialGradient>'


def lg(i, stops, x1, y1, x2, y2):
    st = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return f'<linearGradient id="{i}" gradientUnits="userSpaceOnUse" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{st}</linearGradient>'


BLUR = '<filter id="b6" x="0" y="0" width="1254" height="1254" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="6"/></filter>' \
       '<filter id="b14" x="0" y="0" width="1254" height="1254" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="14"/></filter>'


def yuru_onigiri():
    d = BLUR + rg("rice", [(0, "#fffdf6"), (0.6, "#efe6cf"), (1, "#c9b98f")], 560, 470, 520, 520, 420) \
        + lg("nori", [(0, "#2d4a3a"), (1, "#14251c")], 0, 640, 0, 900)
    body = ('<ellipse cx="627" cy="1010" rx="300" ry="34" fill="#2b2b2b" opacity="0.25" filter="url(#b14)"/>'
            '<ellipse cx="520" cy="985" rx="80" ry="50" fill="#d98a4c"/><ellipse cx="734" cy="985" rx="80" ry="50" fill="#d98a4c"/>'
            '<ellipse cx="300" cy="700" rx="70" ry="58" fill="#e8dcbe"/><ellipse cx="954" cy="700" rx="70" ry="58" fill="#e8dcbe"/>'
            '<path d="M627,240 C720,240 1000,700 980,860 C960,960 820,990 627,990 C434,990 294,960 274,860 C254,700 534,240 627,240 Z" fill="url(#rice)"/>'
            '<path d="M470,700 L784,700 L800,980 L454,980 Z" fill="url(#nori)"/>'
            '<ellipse cx="560" cy="560" rx="26" ry="36" fill="#2a1d14"/><ellipse cx="694" cy="560" rx="26" ry="36" fill="#2a1d14"/>'
            '<circle cx="552" cy="548" r="9" fill="#fff"/><circle cx="686" cy="548" r="9" fill="#fff"/>'
            '<ellipse cx="500" cy="620" rx="34" ry="20" fill="#ff8f8f" opacity="0.7" filter="url(#b6)"/><ellipse cx="754" cy="620" rx="34" ry="20" fill="#ff8f8f" opacity="0.7" filter="url(#b6)"/>'
            '<path d="M597,610 Q627,645 657,610" stroke="#2a1d14" stroke-width="10" fill="none" stroke-linecap="round"/>'
            '<ellipse cx="560" cy="380" rx="90" ry="34" fill="#fff" opacity="0.7" filter="url(#b6)" transform="rotate(-30 560 380)"/>')
    return svg(d, body)


def yuru_shizuku():
    d = BLUR + rg("drop", [(0, "#d7f3ff"), (0.5, "#6cc4f0"), (1, "#2a7fc0")], 540, 520, 560, 500, 440)
    body = ('<ellipse cx="627" cy="1000" rx="260" ry="30" fill="#1d3550" opacity="0.25" filter="url(#b14)"/>'
            '<ellipse cx="545" cy="975" rx="62" ry="38" fill="#2f7fbf"/><ellipse cx="709" cy="975" rx="62" ry="38" fill="#2f7fbf"/>'
            '<path d="M627,200 C700,330 930,560 930,730 C930,880 800,985 627,985 C454,985 324,880 324,730 C324,560 554,330 627,200 Z" fill="url(#drop)"/>'
            '<ellipse cx="565" cy="700" rx="30" ry="40" fill="#13304d"/><ellipse cx="689" cy="700" rx="30" ry="40" fill="#13304d"/>'
            '<circle cx="556" cy="686" r="10" fill="#fff"/><circle cx="680" cy="686" r="10" fill="#fff"/>'
            '<ellipse cx="505" cy="770" rx="36" ry="22" fill="#ff86a8" opacity="0.75" filter="url(#b6)"/><ellipse cx="749" cy="770" rx="36" ry="22" fill="#ff86a8" opacity="0.75" filter="url(#b6)"/>'
            '<path d="M590,760 Q627,815 664,760 Q627,775 590,760 Z" fill="#13304d"/>'
            '<ellipse cx="520" cy="520" rx="44" ry="90" fill="#fff" opacity="0.65" filter="url(#b6)" transform="rotate(25 520 520)"/>')
    return svg(d, body)


def human_boy():
    """正面の少年の顔。肌の陰・鼻の陰・虹彩・まつげ・唇・髪の束・首と服。写実寄りの塗り。"""
    d = BLUR + rg("skin", [(0, "#f6d2b8"), (0.6, "#e4ad8c"), (1, "#b97a5c")], 600, 520, 380, 560, 470) \
        + lg("hair", [(0, "#3b2618"), (1, "#1a0f08")], 0, 220, 0, 560) + lg("shirt", [(0, "#5a7fa8"), (1, "#2c4566")], 0, 900, 0, 1254) \
        + rg("iris", [(0, "#6b4a2b"), (0.7, "#3d2614"), (1, "#1c0f06")], 0, 0, 1) + lg("bg", [(0, "#eef0f2"), (1, "#d7dbe0")], 0, 0, 0, 1254)
    eyes = ""
    for ex, s in ((515, 1), (739, -1)):
        eyes += (f'<path d="M{ex-70},560 Q{ex},515 {ex+70},560 Q{ex},590 {ex-70},560 Z" fill="#fbf7f3"/>'
                 f'<circle cx="{ex}" cy="557" r="27" fill="#4a301b"/><circle cx="{ex}" cy="557" r="12" fill="#120a04"/>'
                 f'<circle cx="{ex-9}" cy="549" r="6" fill="#fff"/>'
                 f'<path d="M{ex-74},556 Q{ex},505 {ex+74},556" stroke="#2a1a10" stroke-width="5" fill="none"/>'
                 f'<path d="M{ex-60},584 Q{ex},600 {ex+60},584" stroke="#b07f63" stroke-width="2" fill="none" opacity="0.6"/>'
                 f'<path d="M{ex-80},{485} Q{ex - 10 * s},{460} {ex+80},{482}" stroke="#2c1b0f" stroke-width="16" fill="none" stroke-linecap="round"/>')
    body = ('<rect width="1254" height="1254" fill="url(#bg)"/>'
            '<path d="M380,1254 C390,1020 500,960 627,960 C754,960 864,1020 874,1254 Z" fill="url(#shirt)"/>'
            '<path d="M540,860 L540,990 Q627,1030 714,990 L714,860 Z" fill="#d79c7c"/>'
            '<ellipse cx="350" cy="600" rx="40" ry="70" fill="#dea283"/><ellipse cx="904" cy="600" rx="40" ry="70" fill="#dea283"/>'
            '<path d="M380,520 C380,300 500,230 627,230 C754,230 874,300 874,520 C874,760 760,920 627,920 C494,920 380,760 380,520 Z" fill="url(#skin)"/>'
            '<path d="M370,470 C360,250 520,170 640,180 C800,190 900,280 885,470 C860,380 820,330 760,320 C700,350 600,360 470,330 C420,360 395,410 370,470 Z" fill="url(#hair)"/>'
            + eyes +
            '<path d="M627,560 C615,640 595,690 600,720 Q627,740 654,720 C659,690 639,640 627,560" fill="#c98c6c" opacity="0.55" filter="url(#b6)"/>'
            '<path d="M592,718 Q627,738 662,718" stroke="#9c6249" stroke-width="5" fill="none"/>'
            '<path d="M560,800 Q627,780 694,800 Q627,845 560,800 Z" fill="#c07466"/>'
            '<path d="M560,800 Q627,812 694,800" stroke="#7a3f36" stroke-width="3" fill="none"/>'
            '<ellipse cx="470" cy="720" rx="60" ry="34" fill="#e79a8a" opacity="0.35" filter="url(#b14)"/><ellipse cx="784" cy="720" rx="60" ry="34" fill="#e79a8a" opacity="0.35" filter="url(#b14)"/>')
    return svg(d, body)


def human_woman():
    """斜め向きの女性。長い髪・肩・首・横顔ぎみの鼻と唇。"""
    d = BLUR + rg("skin2", [(0, "#f8dcc8"), (0.65, "#e8b79c"), (1, "#c38a6f")], 660, 520, 380, 640, 450) \
        + lg("hair2", [(0, "#8a4b2a"), (0.5, "#5e2f17"), (1, "#3a1b0c")], 300, 200, 900, 1100) \
        + lg("dress", [(0, "#c9465d"), (1, "#7d1f33")], 0, 950, 0, 1254) + lg("bg2", [(0, "#f6efe6"), (1, "#e2d6c5")], 0, 0, 1254, 1254)
    body = ('<rect width="1254" height="1254" fill="url(#bg2)"/>'
            '<path d="M300,330 C280,140 560,90 700,140 C880,200 950,380 930,600 C920,800 980,980 1040,1254 L230,1254 C300,1000 330,800 300,330 Z" fill="url(#hair2)"/>'
            '<path d="M300,1254 C330,1060 460,990 600,980 C760,975 900,1050 960,1254 Z" fill="url(#dress)"/>'
            '<path d="M560,820 L560,1000 Q640,1040 720,990 L720,820 Z" fill="#dda68b"/>'
            '<path d="M430,520 C430,320 540,250 660,250 C790,250 880,340 870,520 C860,730 770,900 650,900 C530,900 430,740 430,520 Z" fill="url(#skin2)"/>'
            '<path d="M420,500 C410,300 560,200 690,220 C840,240 900,360 880,470 C820,360 720,310 600,330 C520,360 460,420 420,500 Z" fill="url(#hair2)"/>'
            '<path d="M555,575 Q600,545 645,575 Q600,592 555,575 Z" fill="#fbf6f2"/><circle cx="605" cy="572" r="17" fill="#3a5f3a"/><circle cx="605" cy="572" r="8" fill="#0d140c"/><circle cx="599" cy="566" r="4" fill="#fff"/>'
            '<path d="M725,575 Q768,548 810,575 Q768,590 725,575 Z" fill="#fbf6f2"/><circle cx="772" cy="572" r="16" fill="#3a5f3a"/><circle cx="772" cy="572" r="8" fill="#0d140c"/><circle cx="767" cy="566" r="4" fill="#fff"/>'
            '<path d="M548,572 Q600,535 652,570" stroke="#2a160c" stroke-width="5" fill="none"/><path d="M720,570 Q768,538 816,570" stroke="#2a160c" stroke-width="5" fill="none"/>'
            '<path d="M545,515 Q600,495 650,512" stroke="#4a2614" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M722,510 Q770,494 818,512" stroke="#4a2614" stroke-width="10" fill="none" stroke-linecap="round"/>'
            '<path d="M700,590 C705,650 720,690 735,712 Q712,728 690,720" stroke="#b4795f" stroke-width="5" fill="none"/>'
            '<path d="M640,790 Q700,770 760,790 Q700,830 640,790 Z" fill="#cc5a63"/><path d="M640,790 Q700,800 760,790" stroke="#83303a" stroke-width="3" fill="none"/>'
            '<ellipse cx="560" cy="700" rx="55" ry="30" fill="#ee9c8f" opacity="0.4" filter="url(#b14)"/><ellipse cx="820" cy="690" rx="45" ry="28" fill="#ee9c8f" opacity="0.4" filter="url(#b14)"/>'
            '<path d="M870,420 C930,600 900,800 960,1000" stroke="#3a1b0c" stroke-width="6" fill="none" opacity="0.5"/>'
            '<path d="M420,450 C380,650 420,850 360,1100" stroke="#3a1b0c" stroke-width="6" fill="none" opacity="0.5"/>')
    return svg(d, body)


def complex_town():
    rnd = random.Random(7)
    d = lg("sky", [(0, "#7ec8f2"), (1, "#e9f6ff")], 0, 0, 0, 800) + lg("road", [(0, "#6b6b6b"), (1, "#3d3d3d")], 0, 980, 0, 1254)
    b = ['<rect width="1254" height="820" fill="url(#sky)"/><circle cx="1080" cy="150" r="70" fill="#ffd75a"/>']
    for i in range(6):
        cx = rnd.randint(80, 1150)
        b.append(f'<ellipse cx="{cx}" cy="{rnd.randint(80, 260)}" rx="{rnd.randint(60, 120)}" ry="{rnd.randint(20, 40)}" fill="#ffffff" opacity="0.85"/>')
    x = 0
    pal = ["#d9784c", "#a8b5c4", "#e9d3a4", "#8d6e63", "#c94f4f", "#7fa37a", "#cfa8d8", "#5f7b9c"]
    while x < 1254:
        w = rnd.randint(90, 180)
        h = rnd.randint(280, 640)
        top = 980 - h
        b.append(f'<rect x="{x}" y="{top}" width="{w}" height="{h}" fill="{rnd.choice(pal)}"/>')
        for wy in range(top + 20, 960, 40):
            for wx in range(x + 12, x + w - 20, 28):
                c = "#fff6c4" if rnd.random() < 0.35 else "#2d3b4c"
                b.append(f'<rect x="{wx}" y="{wy}" width="16" height="22" fill="{c}"/>')
        x += w + rnd.randint(4, 16)
    b.append('<rect x="0" y="980" width="1254" height="274" fill="url(#road)"/>')
    for sx in range(0, 1254, 90):
        b.append(f'<rect x="{sx}" y="1110" width="50" height="10" fill="#f5f5f5"/>')
    for i in range(8):
        tx = rnd.randint(20, 1230)
        b.append(f'<rect x="{tx - 6}" y="900" width="12" height="80" fill="#6b4a2b"/><circle cx="{tx}" cy="880" r="{rnd.randint(30, 50)}" fill="#3f8f45"/>')
    for i in range(7):
        cx, cy = rnd.randint(20, 1150), rnd.choice([1040, 1170])
        col = rnd.choice(["#e53935", "#1e88e5", "#fdd835", "#43a047", "#ffffff", "#8e24aa"])
        b.append(f'<rect x="{cx}" y="{cy}" width="120" height="44" rx="12" fill="{col}"/><rect x="{cx + 20}" y="{cy - 26}" width="70" height="30" rx="8" fill="{col}"/>'
                 f'<circle cx="{cx + 25}" cy="{cy + 46}" r="14" fill="#222"/><circle cx="{cx + 95}" cy="{cy + 46}" r="14" fill="#222"/>')
    for i in range(14):
        px = rnd.randint(10, 1240)
        col = rnd.choice(["#c62828", "#283593", "#2e7d32", "#f9a825", "#6a1b9a"])
        b.append(f'<circle cx="{px}" cy="958" r="7" fill="#f1c7a5"/><rect x="{px - 6}" y="965" width="12" height="20" fill="{col}"/>')
    return svg(d, "".join(b))


def complex_clutter():
    rnd = random.Random(11)
    b = ['<rect x="227" y="230" width="800" height="800" rx="40" fill="#8a8f99"/>']
    cols = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa", "#212121", "#eeeeee", "#6d4c41", "#00acc1"]
    for i in range(420):
        x, y = rnd.randint(240, 1010), rnd.randint(240, 1015)
        c = rnd.choice(cols)
        k = rnd.random()
        if k < 0.3:
            b.append(f'<circle cx="{x}" cy="{y}" r="{rnd.randint(4, 22)}" fill="{c}"/>')
        elif k < 0.6:
            b.append(f'<rect x="{x}" y="{y}" width="{rnd.randint(6, 40)}" height="{rnd.randint(4, 30)}" fill="{c}" transform="rotate({rnd.randint(0, 90)} {x} {y})"/>')
        elif k < 0.85:
            x2, y2 = x + rnd.randint(-80, 80), y + rnd.randint(-80, 80)
            b.append(f'<line x1="{x}" y1="{y}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="{rnd.randint(2, 6)}"/>')
        else:
            n = rnd.randint(5, 9)
            r = rnd.randint(10, 30)
            pts = " ".join(f"{x + r * math.cos(2 * math.pi * j / n):.0f},{y + r * math.sin(2 * math.pi * j / n):.0f}" for j in range(n))
            b.append(f'<polygon points="{pts}" fill="none" stroke="{c}" stroke-width="3"/>')
    for i in range(12):
        x = 260 + i * 62
        b.append(f'<rect x="{x}" y="1035" width="20" height="120" fill="#555"/><rect x="{x - 10}" y="140" width="40" height="90" fill="#777"/>')
    return svg("", "".join(b))


PICS = {"yuru_onigiri": (yuru_onigiri, "yuru"), "yuru_shizuku": (yuru_shizuku, "yuru"),
        "human_boy": (human_boy, "human"), "human_woman": (human_woman, "human"),
        "complex_town": (complex_town, "complex"), "complex_clutter": (complex_clutter, "complex")}


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for name, (fn, _) in PICS.items():
        (out / f"{name}.svg").write_text(fn(), encoding="utf-8")
    (out / "labels.json").write_text(json.dumps({n: lab for n, (_, lab) in PICS.items()}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("書いた:", ", ".join(PICS))


if __name__ == "__main__":
    main()
