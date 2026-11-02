"""シミュレーターの 3 案の同じ瞬間を縦に並べる。ラベルは幅 400px に縮めても読める大きさにする。

使い方: python make_sim_sheet.py <Cam1.mp4 などがあるフォルダ> <出力の jpg> [--at 秒]
"""
import argparse
import subprocess
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ue"))

from sim_layout import SIM_CAMERAS, camera_place, hidden_led_bottom_cm  # noqa: E402

FONT = "C:/Windows/Fonts/meiryob.ttc"
TILE_W, TILE_H = 1600, 900
TITLE_SIZE = 84  # 幅の 5%。幅 400px で 21px になる
INFO_SIZE = 66
BAND_H = 220


def grab_frame(video, seconds):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{seconds:.3f}", "-i", str(video), "-frames:v", "1",
                          "-f", "image2pipe", "-c:v", "png", "-"], capture_output=True, check=True).stdout
    return Image.open(BytesIO(raw)).convert("RGB").resize((TILE_W, TILE_H), Image.LANCZOS)


def side_text(side_m):
    if abs(side_m) < 0.05:
        return "真ん中"
    return f"{'上手' if side_m > 0 else '下手'}へ {abs(side_m):g}m"


def label_lines(number, spec):
    place = camera_place(spec)
    title = f"案{number} {spec['title']} {spec['mm35']:g}mm"
    info = (f"舞台の縁から {place['from_front_edge_m']:g}m・{side_text(place['side_m'])}・"
            f"高さ {place['height_from_hall_floor_m']:g}m")
    hidden = hidden_led_bottom_cm(spec)
    if hidden > 0:
        title += f"(下 {hidden:.0f}cm は舞台で隠れる)"
    return title, info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--at", type=float, default=2.0, help="mp4 の中の秒")
    args = parser.parse_args()
    numbers = [1, 2, 3]
    sheet = Image.new("RGB", (TILE_W, (TILE_H + BAND_H) * len(numbers)), (16, 16, 20))
    draw = ImageDraw.Draw(sheet)
    title_font = ImageFont.truetype(FONT, TITLE_SIZE)
    info_font = ImageFont.truetype(FONT, INFO_SIZE)
    for row, number in enumerate(numbers):
        top = row * (TILE_H + BAND_H)
        title, info = label_lines(number, SIM_CAMERAS[f"Sim_Cam{number}"])
        size = title_font if draw.textlength(title, font=title_font) < TILE_W - 32 else info_font
        draw.text((16, top + 8), title, fill=(255, 255, 255), font=size)
        draw.text((16, top + 118), info, fill=(255, 225, 150), font=info_font)
        sheet.paste(grab_frame(args.folder / f"Cam{number}.mp4", args.at), (0, top + BAND_H))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out, quality=90)
    print("wrote", args.out, sheet.size)


if __name__ == "__main__":
    main()
