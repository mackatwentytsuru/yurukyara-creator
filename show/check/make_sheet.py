"""4 カットを 1 枚に並べた確認シートを作る。題の文字は画像の横幅の 3% 以上の高さにする。

使い方: python make_sheet.py <出力の jpg>  (環境変数 SHOW_SHEET_OUT でも指定できる)
"""
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RENDER = Path("work/ue_show/render")
DEFAULT_OUT = os.environ.get("SHOW_SHEET_OUT", str(RENDER / "sheet.jpg"))
FONT = "C:/Windows/Fonts/meiryob.ttc"
CUTS = [
    ("Cut1_StandWide", "① 舞台に立つ(全景)"),
    ("Cut2_StandClose", "② 舞台に立つ(寄り)"),
    ("Cut3_LedCharacter", "③ LED の中に大きく"),
    ("Cut4_DoorOpen", "④ 扉が開いた"),
]
TILE_W, TILE_H = 1200, 675
TITLE_SIZE = 78  # 横 2400 の 3% = 72 px 以上
BAND_H = 112
HEADER = "仮の絵・新しいステージ"


def tile(cut, title):
    frames = sorted((RENDER / cut).glob("*.png"))
    if not frames:
        raise FileNotFoundError(f"絵が無い: {cut}")
    image = Image.open(frames[-1]).convert("RGB").resize((TILE_W, TILE_H), Image.LANCZOS)
    panel = Image.new("RGB", (TILE_W, TILE_H + BAND_H), (16, 16, 20))
    draw = ImageDraw.Draw(panel)
    draw.text((16, 6), title, fill=(255, 255, 255), font=ImageFont.truetype(FONT, TITLE_SIZE))
    panel.paste(image, (0, BAND_H))
    return panel


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT)
    panels = [tile(cut, title) for cut, title in CUTS]
    header_h = 120
    sheet = Image.new("RGB", (TILE_W * 2, header_h + (TILE_H + BAND_H) * 2), (40, 8, 40))
    draw = ImageDraw.Draw(sheet)
    draw.text((16, 8), HEADER, fill=(255, 220, 240), font=ImageFont.truetype(FONT, TITLE_SIZE))
    for i, panel in enumerate(panels):
        sheet.paste(panel, ((i % 2) * TILE_W, header_h + (i // 2) * (TILE_H + BAND_H)))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=90)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main()
