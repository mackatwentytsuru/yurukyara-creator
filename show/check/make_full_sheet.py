"""全編の確認シート: timeline の区間ごとに 1 コマ以上と、出る・戻る・着地の瞬間を、ガイドを重ねて縦に並べる。

  python make_full_sheet.py --video <原版か mp4> --timeline <timeline.json> --stage <show_stage.json> --out <jpg> [--every N]

見出しは横 400 px に縮めても読める大きさ(セルの幅 1600 px で文字の高さ 72 px 以上 → 400 px で 18 px)。
ガイド: 黄=面の境界(1279・3039)、水色=主役の中心 x=2159、緑=主役の範囲、桃=左右のスクリーン、橙=2 面に映る所の端、
赤=足の線 y=1198、白の点線=身長 397 px の頭の線。
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "fx"))
import fx_plan  # noqa: E402

FONT = "C:/Windows/Fonts/meiryob.ttc"
CELL_W = 1600
TITLE_H = 110
TEXT_MIN = 72
CANVAS = (5680, 1240)


def band(text, width, height, bg):
    image = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(image)
    size = int(height * 0.8)
    font = ImageFont.truetype(FONT, size)
    while draw.textlength(text, font=font) > width - 24 and size > 20:
        size -= 2
        font = ImageFont.truetype(FONT, size)
    box = draw.textbbox((0, 0), text, font=font)
    draw.text((14 - box[0], (height - (box[3] - box[1])) / 2 - box[1]), text, font=font, fill=(255, 255, 255))
    return np.array(image)[:, :, ::-1].copy(), box[3] - box[1]


def grab(path, t):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.4f}", "-i", str(path), "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"],
                         capture_output=True, stdin=subprocess.DEVNULL).stdout
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), 1)
    if image is None:
        raise RuntimeError(f"{t} 秒のコマが読めない")
    return image


def guide(image, stage):
    height = int(round(CELL_W * CANVAS[1] / CANVAS[0]))
    out = cv2.resize(image, (CELL_W, height), interpolation=cv2.INTER_AREA)
    s = CELL_W / CANVAS[0]
    for x in (1279, 3039):
        cv2.line(out, (int(x * s), 0), (int(x * s), height), (0, 255, 255), 2)
    cv2.line(out, (int(2159 * s), 0), (int(2159 * s), height), (255, 255, 0), 1)
    cv2.rectangle(out, (int(1330 * s), int(135 * s)), (int(2990 * s), int(1170 * s)), (0, 255, 0), 1)
    for x, y, w, h in stage["monitor_rects"]:
        cv2.rectangle(out, (int(x * s), int(y * s)), (int((x + w) * s), int((y + h) * s)), (255, 0, 255), 1)
    for x in (957, 3345):
        cv2.line(out, (int(x * s), 0), (int(x * s), height), (0, 165, 255), 1)
    foot = stage["life_size"]["foot_y"]
    top = foot - stage["life_size"]["height_px"]
    cv2.line(out, (int(1900 * s), int(foot * s)), (int(2420 * s), int(foot * s)), (0, 0, 255), 1)
    for x in range(int(1900 * s), int(2420 * s), 8):
        cv2.line(out, (x, int(top * s)), (x + 4, int(top * s)), (255, 255, 255), 1)
    return out


def moments(timeline, stage, cues):
    """(秒, 見出し)。区間ごとに真ん中を 1 コマ、行き来の前後、着地、最後の決め。"""
    plan = fx_plan.FxPlan(timeline, stage, [], cues)
    rows = []
    end = timeline["frames"] / timeline["fps"]
    for s in timeline["sections"]:
        rows.append(((s["start"] + s["end"]) / 2.0, f"{s['id']}(区間 {s['start']:.1f}〜{s['end']:.1f} 秒)"))
    for at in plan.out_times:
        rows.append((at - 0.3, f"出る直前 {at - 0.3:.2f} 秒"))
        rows.append((at + 0.2, f"出た直後 {at + 0.2:.2f} 秒(LED のキャラが薄れる)"))
        rows.append((at + 3.0, f"舞台にいる間 {at + 3.0:.2f} 秒(LED にキャラなし)"))
    for at in plan.back_times:
        rows.append((at - 0.4, f"戻る直前 {at - 0.4:.2f} 秒(緞帳が閉じる)"))
        rows.append((at + 0.3, f"戻った直後 {at + 0.3:.2f} 秒(LED にキャラ)"))
    for at in plan.land_times:
        rows.append((at + 0.05, f"着地 {at:.2f} 秒"))
    if plan.finale_t is not None:
        rows.append((plan.finale_t + 0.1, f"最後の決め {plan.finale_t:.2f} 秒"))
    return sorted((min(max(t, 0.0), end - 0.02), label) for t, label in rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--video", required=True)
    parser.add_argument("--timeline", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--cues")
    parser.add_argument("--out", required=True)
    parser.add_argument("--every", type=int, default=1, help="原版が間引きなら N(秒の読みは同じ。動画の秒をそのまま使う)")
    args = parser.parse_args()
    timeline = json.loads(Path(args.timeline).read_text(encoding="utf-8"))
    stage = json.loads(Path(args.stage).read_text(encoding="utf-8"))
    cues = json.loads(Path(args.cues).read_text(encoding="utf-8")) if args.cues else None
    rows = []
    legend, _ = band("線 黄=面の境界 水色=中心 緑=主役 桃=スクリーン 赤=足 白=頭", CELL_W, TITLE_H, (40, 40, 10))
    rows.append(legend)
    heights = []
    for t, label in moments(timeline, stage, cues):
        title, text_h = band(label, CELL_W, TITLE_H, (60, 20, 40))
        heights.append(text_h)
        rows.append(title)
        rows.append(guide(grab(args.video, t), stage))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    cv2.imencode(".jpg", np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])[1].tofile(str(args.out))
    print(json.dumps({"cells": len(heights), "text_h_min_px": min(heights), "text_h_at_400px": round(min(heights) * 400 / CELL_W, 1),
                      "out": args.out}, ensure_ascii=False))


if __name__ == "__main__":
    main()
