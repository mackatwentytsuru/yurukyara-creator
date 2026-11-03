"""リハーサルの 1 枚と通しの動画を作る。カットごとに、番号・名前・歩き方・上から見た経路と、時間順の 4 コマを並べる。
スマホの幅で読めるように、字の高さは絵の幅の 3% 以上にする。
"""
from __future__ import annotations

import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path[:0] = [str(REPO / "show" / "live"), str(REPO / "show" / "ue")]
from stage_layout import C_CURVE_MEASURED  # noqa: E402
from stage_path import ar_at, on_led  # noqa: E402

FONT = r"C:\Windows\Fonts\YuGothB.ttc"
SHEET_W = 1800
TILE_W = (SHEET_W - 360) // 4
TILE_H = TILE_W * 9 // 16
BAR_H = 68
MOVIE_W, MOVIE_H = 1920, 1080


def plan_map(cut, fx_table, stage, size):
    """上から見た図: LED の 3 面、舞台の前の縁、カメラの歩く線と画角、キャラの動いた所。"""
    w, h = size
    img = Image.new("RGB", (w, h), (24, 24, 28))
    d = ImageDraw.Draw(img)
    x0, x1, y0, y1 = -1150.0, 1150.0, -220.0, 1450.0
    scale = min(w / (x1 - x0), h / (y1 - y0))

    def px(x, y):
        return (w / 2 + x * scale, h - (y - y0) * scale)

    d.line([px(-749.7, 0), px(-237.7, 0)], fill=(120, 220, 210), width=4)
    d.line([px(-352, -140), px(352, -140)], fill=(120, 220, 210), width=4)
    d.line([px(236.7, 0), px(732.6, 0)] + [px(a, b) for a, b in C_CURVE_MEASURED], fill=(120, 220, 210), width=4)
    d.line([px(-800, 450), px(800, 450)], fill=(110, 110, 110), width=2)
    # キャラ
    steps = np.linspace(cut["start"], cut["start"] + cut["sec"], 40)
    pts = [px(*ar_at(stage["ar_path"], t)[:2]) for t in steps if not on_led(stage, t)]
    for p in pts:
        d.ellipse([p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3], fill=(255, 90, 170))
    # カメラ
    route = [k[1] for k in cut["keys"]]
    if len(route) > 1:
        d.line([px(r[0], r[1]) for r in route], fill=(255, 190, 40), width=5)
    a, b = route[0], route[-1]
    d.ellipse([px(a[0], a[1])[0] - 8, px(a[0], a[1])[1] - 8, px(a[0], a[1])[0] + 8, px(a[0], a[1])[1] + 8], fill=(255, 190, 40))
    # 画角(終わりの位置から)
    look = cut["look"]
    if look == "char":
        last = ar_at(stage["ar_path"], cut["start"] + cut["sec"])
        target = (last[0], last[1])
    else:
        target = (look[0], look[1])
    yaw = math.atan2(target[1] - b[1], target[0] - b[0])
    half = math.atan(1920.0 / fx_table[cut["lens"]])
    reach = 900.0
    for side in (-1, 1):
        d.line([px(b[0], b[1]), px(b[0] + reach * math.cos(yaw + side * half), b[1] + reach * math.sin(yaw + side * half))], fill=(255, 190, 40), width=1)
    return img


def text_bar(width, height, text, font_size, fill=(255, 255, 255), back=(0, 0, 0)):
    img = Image.new("RGB", (width, height), back)
    font = ImageFont.truetype(FONT, font_size)
    ImageDraw.Draw(img).text((12, (height - font_size) // 2 - 4), text, fill=fill, font=font)
    return img


def frames_of(video, times):
    cap = cv2.VideoCapture(str(video))
    out = []
    for t in times:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * 30))
        ok, f = cap.read()
        out.append(Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)) if ok else Image.new("RGB", (1920, 1080)))
    cap.release()
    return out


def make_sheet(a, cuts, fx_table, lens_jp):
    import json
    stage = json.loads((REPO / "show" / "show_stage.json").read_text(encoding="utf-8"))
    out = Path(a.out)
    rows = []
    for cut in cuts:
        video = out / f"cut_{cut['no']:02d}.mp4"
        if not video.exists():
            continue
        cap = cv2.VideoCapture(str(video))
        seconds = cap.get(cv2.CAP_PROP_FRAME_COUNT) / 30.0
        cap.release()
        tiles = frames_of(video, [seconds * k for k in (0.08, 0.36, 0.64, 0.92)])
        row = Image.new("RGB", (SHEET_W, BAR_H * 2 + TILE_H), (0, 0, 0))
        row.paste(text_bar(SHEET_W, BAR_H, f"{cut['no']}  {cut['name']}", 56, back=(30, 50, 90)), (0, 0))
        row.paste(text_bar(SHEET_W, BAR_H, f"{lens_jp[cut['lens']]} / {cut['walk']}", 54, fill=(255, 210, 120)), (0, BAR_H))
        row.paste(plan_map(cut, fx_table, stage, (360, TILE_H)), (0, BAR_H * 2))
        for i, f in enumerate(tiles):
            row.paste(f.resize((TILE_W, TILE_H), Image.LANCZOS), (360 + i * TILE_W, BAR_H * 2))
        rows.append(row)
    head = text_bar(SHEET_W, 100, "撮影カットの候補(UE のリハーサル)番号で選んでください", 58, back=(60, 20, 60))
    note = text_bar(SHEET_W, 76, "左: 上から見た図 橙=カメラの歩く線 桃=キャラ 水色=LED", 54, fill=(200, 200, 200))
    note2 = text_bar(SHEET_W, 76, "キャラの顔が黒いのは、この下見の中だけの不具合", 54, fill=(255, 150, 150))
    sheet = Image.new("RGB", (SHEET_W, 252 + sum(r.height + 8 for r in rows)), (0, 0, 0))
    sheet.paste(head, (0, 0))
    sheet.paste(note, (0, 100))
    sheet.paste(note2, (0, 176))
    y = 252
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height + 8
    if a.sheet:
        sheet.convert("RGB").save(a.sheet, quality=90)
        print("1 枚:", a.sheet, sheet.size)
    if a.movie:
        make_movie(out, cuts, lens_jp, a.movie)


def make_movie(out, cuts, lens_jp, movie):
    """カットを番号と名前を入れて 1 本につなぐ。"""
    parts = []
    for cut in cuts:
        video = out / f"cut_{cut['no']:02d}.mp4"
        if not video.exists():
            continue
        label = Image.new("RGBA", (MOVIE_W, 90), (0, 0, 0, 160))
        font = ImageFont.truetype(FONT, 56)
        ImageDraw.Draw(label).text((24, 12), f"{cut['no']}  {cut['name']}  {lens_jp[cut['lens']]}", fill=(255, 255, 255, 255), font=font)
        png = out / f"label_{cut['no']:02d}.png"
        label.save(png)
        part = out / f"part_{cut['no']:02d}.mp4"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-i", str(png), "-filter_complex", "[0][1]overlay=0:0", "-map_metadata", "-1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "6", str(part)], check=True)
        parts.append(part)
    listing = out / "parts.txt"
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", "-map_metadata", "-1", str(movie)], check=True)
    print("通しの動画:", movie)
