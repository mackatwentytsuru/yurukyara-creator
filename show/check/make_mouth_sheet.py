"""VRM の口と目を確かめる寄りの絵を作る。入力の値が決まったコマの顔を、場面ごとに並べる。幅 400 px に縮めても分かる大きさで切る。
使い方: python show/check/make_mouth_sheet.py <timeline.json> <出力.jpg> <描いたフォルダ> [<描いたフォルダ> ...]
フォルダは master.mov と character_box.json があるもの。
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT = "C:/Windows/Fonts/meiryob.ttc"
TARGETS = (0.0, 0.3, 0.6, 1.0)
SECTIONS = ("line", "song", "answer")
CELL_W, CELL_H = 640, 460
FACE_W, FACE_H = 470, 340  # 全身の大きさのときに切る幅と高さ(5680x1240 の座標)
FPS = 60


def load_folder(folder):
    data = json.loads((Path(folder) / "character_box.json").read_text(encoding="utf-8"))
    rows = {r["frame"]: r for r in data["frames"] if r["box"]}
    return {"master": str(Path(folder) / "master.mov"), "rows": rows, "first": data["first_frame"], "zoom": data.get("zoom_max") or 1}


def grab(folder, frame):
    row = folder["rows"][frame]
    z = 1 + (folder["zoom"] - 1) * row.get("zoom", 0)
    w, h = int(FACE_W * z), int(FACE_H * z)
    x = int(row["foot"][0] - w / 2)
    y = max(0, int(row["box"][1]) - 10)
    t = (frame - folder["first"]) / FPS
    vf = f"crop={w}:{min(h, 1240 - y)}:{x}:{y},scale={CELL_W}:{CELL_H},format=rgb24"
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{t:.4f}", "-i", folder["master"], "-frames:v", "1", "-vf", vf, "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return Image.frombuffer("RGB", (CELL_W, CELL_H), raw)


def main():
    timeline = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = sys.argv[2]
    folders = [load_folder(f) for f in sys.argv[3:]]
    font = ImageFont.truetype(FONT, 58)
    mouth = timeline["mouth"]
    sections = [s for s in timeline["sections"] if s["id"] in SECTIONS]
    sheet = Image.new("RGB", (CELL_W * len(TARGETS), CELL_H * len(sections)), (20, 20, 20))
    for y, section in enumerate(sections):
        a, b = int(section["start"] * FPS), int(section["end"] * FPS)
        # 曲はせりふと重なるので、あとに渡したフォルダ(サビ)を先に見る
        for folder in reversed(folders) if section["id"] == "song" else folders:
            frames = [f for f in folder["rows"] if a <= f < b]
            if frames:
                break
        else:
            continue
        for x, target in enumerate(TARGETS):
            frame = min(frames, key=lambda f: abs(mouth[f] - target))
            cell = grab(folder, frame)
            draw = ImageDraw.Draw(cell)
            draw.rectangle((0, 0, CELL_W, 76), fill=(0, 0, 0))
            draw.text((8, -2), f"{section['id']} 入力{mouth[frame]:.1f}", fill=(255, 255, 0), font=font)
            sheet.paste(cell, (x * CELL_W, y * CELL_H))
    sheet.save(out, quality=90)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
