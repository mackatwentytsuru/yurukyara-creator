"""目の周りの前後を並べた 1 枚(上段 前、下段 後、4 体)を作る。見出しは日本語。字の高さは絵の幅の 3% 以上(400px 幅に縮めても読める)。

使い方: python creator/skilltest/eye_sheet.py <前のフォルダ> <後のフォルダ> <出力.png> [種類: eye または chest(既定 eye)]
前後のフォルダには <id>_<種類>.png が入っている(shot_eye.mjs の出力)。
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
from fontpath import find_font  # noqa: E402

IDS = [("yokoso", "ようこそくん"), ("robo", "ロボくん"), ("f_led", "パネルくん"), ("d_lantern", "提灯くん")]
CELL = 480
HEAD = 84     # 見出しの帯。字の高さは 2048 の 3% = 61px 以上にするため 66px
LEFT = 130
TEXT = 66


def main():
    before, after, out = sys.argv[1:4]
    kind = sys.argv[4] if len(sys.argv) > 4 else "eye"
    font = ImageFont.truetype(find_font(), TEXT)
    w = LEFT + CELL * len(IDS)
    sheet = Image.new("RGB", (w, HEAD + CELL * 2), "white")
    d = ImageDraw.Draw(sheet)
    for k, (i, name) in enumerate(IDS):
        d.text((LEFT + k * CELL + CELL // 2, HEAD // 2), name, fill="black", font=font, anchor="mm")
        for r, folder in enumerate((before, after)):
            im = Image.open(os.path.join(folder, f"{i}_{kind}.png")).convert("RGB").resize((CELL, CELL), Image.LANCZOS)
            sheet.paste(im, (LEFT + k * CELL, HEAD + r * CELL))
    for r, label in enumerate(("前", "後")):
        d.text((LEFT // 2, HEAD + r * CELL + CELL // 2), label, fill="black", font=font, anchor="mm")
    sheet.save(out)
    print("書いた:", out, sheet.size, "字の高さ", TEXT, "px =", round(100 * TEXT / w, 1), "% (幅に対して)")


main()
