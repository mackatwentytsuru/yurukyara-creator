"""試験だけで使う「絵を描いたふり」の道具(Claude を呼ばない)。yuru_make.py --fake-draw が段の道具の代わりに呼ぶ。

使い方: python creator/review/tests/fake_draw.py <出力フォルダ> [--round N]
出す物: drawing.svg(K1 の部品の <g id> つき)・drawing.png・drawing_noshadow.png・settings.md・lint.json・gen.py の写し
回ごとに色を少し変える(やり直しで絵が変わったことを、ハッシュで確かめられるように)。
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

COLORS = ["#f2a541", "#7cc4e8", "#9bd67a", "#f08a9d"]


def svg_text(color):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1254" height="1254">
<rect width="1254" height="1254" fill="#ffffff"/>
<g id="char">
<g id="shadow"><ellipse cx="627" cy="980" rx="260" ry="40" fill="#000" opacity="0.12"/></g>
<g id="body"><circle cx="627" cy="640" r="320" fill="{color}"/></g>
<g id="eye_R"><ellipse cx="530" cy="600" rx="34" ry="48" fill="#2b2b2b"/></g>
<g id="eye_L"><ellipse cx="724" cy="600" rx="34" ry="48" fill="#2b2b2b"/></g>
<g id="mouth"><path d="M587 720 Q627 760 667 720" stroke="#2b2b2b" stroke-width="12" fill="none" stroke-linecap="round"/></g>
</g>
</svg>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--round", type=int, default=1)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    color = COLORS[(a.round - 1) % len(COLORS)]
    (out / "drawing.svg").write_text(svg_text(color), encoding="utf-8")
    for name, shadow in (("drawing.png", True), ("drawing_noshadow.png", False)):
        im = Image.new("RGB", (1254, 1254), "white")
        d = ImageDraw.Draw(im)
        if shadow:
            d.ellipse((367, 940, 887, 1020), fill=(225, 225, 225))
        d.ellipse((307, 320, 947, 960), fill=color)
        d.ellipse((496, 552, 564, 648), fill=(43, 43, 43))
        d.ellipse((690, 552, 758, 648), fill=(43, 43, 43))
        im.save(out / name, "PNG")
    (out / "settings.md").write_text(f"名前: ためしちゃん\n- 色: {color}\n- 試験の絵(Claude は呼んでいない)\n", encoding="utf-8")
    (out / "lint.json").write_text(json.dumps({"ng": 0, "fake": True}), encoding="utf-8")
    (out / "gen.py").write_text("# 試験の絵(fake_draw.py)\n", encoding="utf-8")
    print(f"試験の絵を置きました: {out}(回 {a.round})")


if __name__ == "__main__":
    main()
