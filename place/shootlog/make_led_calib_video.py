"""サンプル会場の LED(5680×1240、60p)の映像の頭に入れる「校正の映像」を作る。3 つの面(A・B・C の平らな部分)の盤+上下のコマ番号の帯+合図のフラッシュ。

  python place/shootlog/make_led_calib_video.py --out <出力フォルダ> [--seconds 20] [--no-video]
出力: led_calib_head_5680x1240.mov(HEVC 10bit・無音の PCM)と _H264.mp4(60p、23 秒 = 黒 1 秒 → 全面の白 0.5 秒(合図のフラッシュ)→ 黒 0.5 秒 → 盤 20 秒 → 黒 1 秒)、
       faces_led.json(multi_calib.py・read_timecode.py に渡す: 面ごとの盤と帯の定義)、led_calib_still.png(盤の 1 コマ)、layout.md。
面(絵の画素。ショーの割り当て show/ue/stage_layout.py と同じ。重なって映る絵の 957〜1279 と 3039〜3345 は使わない):
  A: x 0〜955(1 画素 4 mm、縦も 4 mm)
  B: x 1280〜3038、y 85〜1217(横 2.948 mm・縦 4.378 mm の不ぞろいな画素。四角の物理の大きさをそろえる)
  C(平らな部分): x 3346〜4288(1 画素 4 mm)
フラッシュは映像の 1.0 秒の頭(コマ 60)で、全面が一度に白になる。コマ番号は 60 Hz のコマ番号(映像の 0 コマ目 = 0)。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import timecode as TC  # noqa: E402
from lenslib import Board, imwrite  # noqa: E402

CANVAS_W, CANVAS_H = 5680, 1240
FPS = 60
B_PITCH_X = 7.04 / 2388          # 中央の面 B: 704 cm を絵の 957〜3345(2388 画素)に映す
B_PITCH_Y = 4.96 / 1133                       # 縦は 496 cm を絵の y 85〜1218(1133 画素)に映す
TC_CELL = 40

FACES = [
    # name, canvas x, y, w, h, pitch_x, pitch_y, square_px(横), square_py(縦)
    ("A", 0, 0, 956, 1240, 0.004, 0.004, 80, 80),
    ("B", 1280, 85, 1759, 1133, B_PITCH_X, B_PITCH_Y, 108, 73),
    ("C", 3346, 0, 943, 1240, 0.004, 0.004, 80, 80),
]


def build_faces(dictionary="DICT_5X5_1000"):
    canvas = np.zeros((CANVAS_H, CANVAS_W), np.uint8)
    specs, offset = [], 0
    for name, x, y, w, h, px, py, sq, sqy in FACES:
        cols, rows = w // sq, (h - 2 * TC_CELL) // sqy
        ox, oy = (w - cols * sq) // 2, TC_CELL + ((h - 2 * TC_CELL) - rows * sqy) // 2
        board = Board(cols, rows, sq, int(sq * 0.75), (ox, oy), (w, h), px, dictionary, offset, py, sqy)
        n_markers = len(board.cv_board().getIds())
        img = board.render()
        strips = TC.make_strips(w, h, TC_CELL)
        TC.draw(img, 0, strips)
        canvas[y:y + h, x:x + w] = img
        specs.append({"name": name, "board": board.to_json(), "timecode": {"strips": strips, "bits": TC.BITS, "cells": TC.CELLS},
                      "canvas_rect": [x, y, w, h], "marker_ids": [offset, offset + n_markers - 1],
                      "physical": {"width_m": round(w * px, 3), "height_m": round(h * py, 3), "square_m": [round(sq * px, 4), round(sqy * py, 4)]}})
        offset += n_markers
    return canvas, specs


def frame_for(canvas, specs, index, seconds_boards):
    """映像のコマ index の絵(グレー)。0〜59 黒、60〜89 全面の白(フラッシュ)、90〜119 黒、120〜(120+秒×60) 盤+帯、その後 黒 1 秒。"""
    if index < 60 or 90 <= index < 120:
        return None
    if 60 <= index < 90:
        return "white"
    if index < 120 + seconds_boards * FPS:
        img = canvas.copy()
        for s in specs:
            x, y, w, h = s["canvas_rect"]
            TC.draw(img[y:y + h, x:x + w], index, s["timecode"]["strips"])
        return img
    return None


def encode_procs(out: Path):
    common = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{CANVAS_W}x{CANVAS_H}", "-r", str(FPS), "-i", "-",
              "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest"]
    mov = subprocess.Popen(common + ["-vf", "format=yuv420p10le", "-c:v", "libx265", "-preset", "medium", "-crf", "12", "-tag:v", "hvc1", "-x265-params", "log-level=error:pools=8",
                                     "-c:a", "pcm_s24le", "-map_metadata", "-1", str(out / "led_calib_head_5680x1240.mov")], stdin=subprocess.PIPE)
    mp4 = subprocess.Popen(common + ["-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-c:a", "aac", "-b:a", "128k", "-map_metadata", "-1",
                                     str(out / "led_calib_head_H264.mp4")], stdin=subprocess.PIPE)
    return mov, mp4


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seconds", type=int, default=20, help="盤を出す秒数")
    ap.add_argument("--no-video", action="store_true", help="faces_led.json と静止画だけ作る")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    canvas, specs = build_faces()
    imwrite(out / "led_calib_still.png", canvas)
    (out / "faces_led.json").write_text(json.dumps({"faces": specs, "canvas": [CANVAS_W, CANVAS_H], "fps": FPS, "flash_frame": 60,
                                                    "timeline_s": {"black": [0, 1], "flash": [1.0, 1.5], "black2": [1.5, 2.0], "boards": [2.0, 2.0 + a.seconds], "black3": [2.0 + a.seconds, 3.0 + a.seconds]}},
                                                   indent=2, ensure_ascii=False), encoding="utf-8")
    lines = ["# LED の校正の映像(映像の頭に入れる)", "", f"- 長さ {3.0 + a.seconds:.1f} 秒(60p)。0〜1 秒 黒、**1.0 秒の頭(コマ 60)から 0.5 秒 全面の白 = 合図のフラッシュ**、1.5〜2.0 秒 黒、2.0〜{2.0 + a.seconds:.1f} 秒 盤+コマ番号の帯、最後に黒 1 秒。", ""]
    for s in specs:
        x, y, w, h = s["canvas_rect"]
        lines.append(f"- 面 {s['name']}: 絵の x {x}〜{x + w - 1}、y {y}〜{y + h - 1}。物理 {s['physical']['width_m']}×{s['physical']['height_m']} m、四角 {s['physical']['square_m']} m、マーカー ID {s['marker_ids'][0]}〜{s['marker_ids'][1]}、角 {(s['board']['cols'] - 1) * (s['board']['rows'] - 1)} 点")
    lines += ["", "コマ番号の帯: 各面の上端と下端、16 ビット Gray コード、60 Hz のコマ番号(映像の 0 コマ目 = 0)。read_timecode.py で読む。", "解く: multi_calib.py --faces faces_led.json(面 A が基準)。"]
    (out / "layout.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if a.no_video:
        print("書いた(映像なし):", out)
        return
    total = 120 + a.seconds * FPS + 60
    mov, mp4 = encode_procs(out)
    black = np.zeros((CANVAS_H, CANVAS_W), np.uint8).tobytes()
    white = np.full((CANVAS_H, CANVAS_W), 255, np.uint8).tobytes()
    for i in range(total):
        f = frame_for(canvas, specs, i, a.seconds)
        data = black if f is None else (white if isinstance(f, str) else f.tobytes())
        for p in (mov, mp4):
            p.stdin.write(data)
    for p in (mov, mp4):
        p.stdin.close()
    rc = [p.wait() for p in (mov, mp4)]
    print("書いた:", out, "ffmpeg の終了コード", rc)


if __name__ == "__main__":
    main()
