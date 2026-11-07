"""試験だけで使う「絵を描いたふり」の道具(Claude を呼ばない)。yuru_make.py --fake-draw が段の道具の代わりに呼ぶ。

使い方: python creator/review/tests/fake_draw.py <出力フォルダ> [--round N] [--fix]
出す物: drawing.svg(K1 の部品の <g id> つき。体・目・口・帽子)・drawing.png・drawing_noshadow.png・settings.md・lint.json・gen.py の写し
- 1 回目は橙の体と緑の帽子。やり直し(2 回目から)は、環境変数 YC_FAKE_REDO で描き方を選ぶ(頼みの文は読まない):
  keep(既定)= 帽子の色だけ変える(「帽子を青にして」を守った形)/ drift = 帽子に加えて体の色も変える(頼んでいない所まで変わる)/
  drift_once = 1 回目の描き直しは drift、--fix(決まった確かめの後の 2 回目)では keep / rename = keep で名前だけ変える /
  brows = 帽子は 1 回目のまま、眉(K1 の brow_R・brow_L)だけを足す(「眉を足す(ふつうの太さ)。ほかは変えない」を守った形)
"""
import argparse
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw

BODY = "#f2a541"
DRIFT_BODY = ["#f2a541", "#7cc4e8", "#9bd67a", "#f08a9d"]
HATS = ["#4caf50", "#3a7bd5", "#e05a5a", "#f0d050"]


BROWS = """<g id="brow_R"><path d="M490 520 Q530 500 570 520" stroke="#2b2b2b" stroke-width="9" fill="none" stroke-linecap="round"/></g>
<g id="brow_L"><path d="M684 520 Q724 500 764 520" stroke="#2b2b2b" stroke-width="9" fill="none" stroke-linecap="round"/></g>
"""


def svg_text(body, hat, brows=False):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1254" height="1254">
<rect width="1254" height="1254" fill="#ffffff"/>
<g id="char">
<g id="shadow"><ellipse cx="627" cy="980" rx="260" ry="40" fill="#000" opacity="0.12"/></g>
<g id="body"><circle cx="627" cy="640" r="320" fill="{body}"/></g>
<g id="eye_R"><ellipse cx="530" cy="600" rx="34" ry="48" fill="#2b2b2b"/></g>
<g id="eye_L"><ellipse cx="724" cy="600" rx="34" ry="48" fill="#2b2b2b"/></g>
{BROWS if brows else ""}<g id="mouth"><path d="M587 720 Q627 760 667 720" stroke="#2b2b2b" stroke-width="12" fill="none" stroke-linecap="round"/></g>
<g id="hat"><ellipse cx="627" cy="300" rx="150" ry="60" fill="{hat}"/></g>
</g>
</svg>
"""


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--round", type=int, default=1)
    ap.add_argument("--fix", action="store_true", help="決まった確かめの後の 2 回目")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    mode = os.environ.get("YC_FAKE_REDO", "keep")
    drift = a.round > 1 and (mode == "drift" or (mode == "drift_once" and not a.fix))
    body = DRIFT_BODY[(a.round - 1) % len(DRIFT_BODY)] if drift else BODY
    brows = a.round > 1 and mode == "brows"
    hat = HATS[0] if brows else HATS[(a.round - 1) % len(HATS)]
    name = "べつのこ" if a.round > 1 and mode == "rename" else "ためしちゃん"
    (out / "drawing.svg").write_text(svg_text(body, hat, brows), encoding="utf-8")
    for fname, shadow in (("drawing.png", True), ("drawing_noshadow.png", False)):
        im = Image.new("RGB", (1254, 1254), "white")
        d = ImageDraw.Draw(im)
        if shadow:
            d.ellipse((367, 940, 887, 1020), fill=(225, 225, 225))
        d.ellipse((307, 320, 947, 960), fill=rgb(body))
        d.ellipse((477, 240, 777, 360), fill=rgb(hat))
        d.ellipse((496, 552, 564, 648), fill=(43, 43, 43))
        d.ellipse((690, 552, 758, 648), fill=(43, 43, 43))
        im.save(out / fname, "PNG")
    (out / "settings.md").write_text(f"名前: {name}\n- 色: 体 {body}・帽子 {hat}\n- 部品: hat = 帽子\n- 試験の絵(Claude は呼んでいない)\n",
                                     encoding="utf-8")
    (out / "lint.json").write_text(json.dumps({"ng": 0, "fake": True}), encoding="utf-8")
    (out / "gen.py").write_text("# 試験の絵(fake_draw.py)\n", encoding="utf-8")
    print(f"試験の絵を置きました: {out}(回 {a.round}{'・直し' if a.fix else ''}・{mode})")


if __name__ == "__main__":
    main()
