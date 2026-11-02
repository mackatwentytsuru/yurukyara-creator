#!/usr/bin/env python3
"""LED 確認用のテスト映像(5680x1240、60p、30 秒でループ)を作る。

写真 1 枚で、面の境目・窓の位置・中央の面のつぶれ・色・コマ落ち・音のずれを測れる絵。
--out-dir の中に作るもの(名前は --name):
  <name>.mov          HEVC 10bit + PCM 24bit(納品形式。run/encode_led.sh で作る)
  <name>.mp4          予備の H.264
  <name>_preview.mp4  1420x310 の確認用
別に書けるもの:
  --sim-out    2840x620、30p、H.264、音なしの mp4(別のシミュレーター用)
  --check-jpg  1 コマの確認画像

使い方:
  python make_test_pattern.py --work-dir <作業> --out-dir <出力> [--name 名前]
        [--sim-out <mp4>] [--check-jpg <jpg>] [--check-only]
"""
from __future__ import annotations

import argparse
import math
import os
import shutil
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS, SECONDS = 5680, 1240, 60, 30
FRAMES = FPS * SECONDS
FACE_A_END, FACE_C_START = 1279, 3039
WIN_L, WIN_R, WIN_T, WIN_B = 957, 3345, 85, 1218
CENTER_X = 2159
CIRCLE_R = 400
STRETCH = 1.48
SQUARE = 400
STRIP_H = 36                  # 上端の動く線の帯
SYNC = (0, 40, 110, 150)      # 音との遅れを測る隅の四角 (x0, y0, x1, y1)
SYNC_FRAMES = 3               # 毎秒、この数のコマだけ白(ビープと同時。50 ms)
GREY_SECOND = 15              # この 1 秒だけ 50% 灰色の全面

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\YuGothB.ttc",
    r"C:\Windows\Fonts\meiryo.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
]


def find_font(override):
    for p in ([override] if override else []) + FONT_CANDIDATES:
        if p and os.path.exists(p):
            return p
    sys.exit("日本語フォントが見つからない。--font で指定する。")


class Fonts:
    def __init__(self, path):
        self.path, self._cache = path, {}

    def __call__(self, size):
        if size not in self._cache:
            self._cache[size] = ImageFont.truetype(self.path, size)
        return self._cache[size]


def text(d, xy, s, font, fill=(255, 255, 255), anchor="la", stroke=3):
    d.text(xy, s, font=font, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=(0, 0, 0))


def draw_grid(img):
    img[:] = (10, 10, 14)
    img[:, 0:FACE_A_END + 1] = (14, 20, 46)               # A 面
    img[:, FACE_A_END + 1:FACE_C_START] = (26, 26, 30)    # B 面
    img[:, FACE_C_START:] = (14, 38, 28)                  # C 面
    thin = np.array((52, 52, 62), np.uint8)
    thick = np.array((120, 120, 138), np.uint8)
    for x in range(0, W, 80):          # パネル 80x40
        img[:, x] = thin
    for y in range(0, H, 40):
        img[y, :] = thin
    for x in range(0, W, 160):         # 160 ごとに太く
        img[:, max(x - 1, 0):x + 2] = thick
    for y in range(0, H, 200):         # 数字と同じ 200 ごと
        img[max(y - 1, 0):y + 2, :] = thick


def draw_face_letters(pil, fonts):
    layer = Image.new("L", (W, H), 0)
    ld = ImageDraw.Draw(layer)
    for ch, cx in (("A", 640), ("B", CENTER_X), ("C", 4359)):
        ld.text((cx, 620), ch, font=fonts(640), fill=255, anchor="mm")
    spans = {"A": (0, FACE_A_END, (70, 130, 255)),
             "B": (FACE_A_END, FACE_C_START, (255, 150, 40)),
             "C": (FACE_C_START, W, (200, 90, 255))}
    for ch, (x0, x1, color) in spans.items():
        m = Image.new("L", (W, H), 0)
        m.paste(layer.crop((x0, 0, x1, H)), (x0, 0))
        pil.paste(color, mask=m.point(lambda v: int(v * 0.5)))


def draw_color_checks(d, fonts):
    x0, ph = 4830, 150
    text(d, (x0, 80), "色の確認", fonts(44))
    rows = [
        ([(round(255 * p),) * 3 for p in (0, 0.25, 0.5, 0.75, 1.0)], ["黒", "25%", "50%", "75%", "白"], 150),
        ([(255, 0, 0), (0, 255, 0), (0, 0, 255)], ["赤 R", "緑 G", "青 B"], 240),
        ([(0, 255, 255), (255, 0, 255), (255, 255, 0)], ["シアン", "マゼンタ", "黄"], 240),
        ([(226, 178, 150)], ["肌色"], 240),
    ]
    for r, (colors, names, cw) in enumerate(rows):
        y = 150 + r * 190
        for i, c in enumerate(colors):
            x = x0 + i * cw
            d.rectangle((x, y, x + cw - 1, y + ph - 1), fill=c)
            text(d, (x + cw // 2, y + ph + 6), names[i], fonts(30), anchor="mt", stroke=2)


def build_base(fonts):
    img = np.zeros((H, W, 3), np.uint8)
    draw_grid(img)
    pil = Image.fromarray(img)
    draw_face_letters(pil, fonts)
    d = ImageDraw.Draw(pil)

    f = fonts(24)   # 数字: x は 160 ごと(上)、y は 200 ごと(左右)
    for x in range(160, W, 160):
        text(d, (x + 4, 42), str(x), f, (210, 210, 225), stroke=2)
    for y in range(200, H, 200):
        text(d, (6, y + 4), str(y), f, (210, 210, 225), stroke=2)
        text(d, (W - 6, y + 4), str(y), f, (210, 210, 225), anchor="ra", stroke=2)

    text(d, (130, 95), "A面 下手", fonts(56), (150, 190, 255))
    text(d, (1330, 95), "B面 中央(奥)", fonts(56), (255, 190, 110))
    text(d, (3100, 95), "C面 上手", fonts(56), (225, 160, 255))

    # 素の真円(A・B・C)、B だけ横 STRETCH 倍の楕円も。正方形は各面に 1 つ
    cy, s = 600, SQUARE // 2
    for cx in (640, 4359, CENTER_X):
        d.ellipse((cx - CIRCLE_R, cy - CIRCLE_R, cx + CIRCLE_R, cy + CIRCLE_R), outline=(255, 255, 255), width=7)
        d.rectangle((cx - s, cy - s, cx + s, cy + s), outline=(255, 90, 255), width=5)
        text(d, (cx, cy - s - 14), f"正方形 一辺 {SQUARE}px", fonts(40), (255, 150, 255), anchor="ms")
        text(d, (cx, cy + s + 30), f"素の真円 半径{CIRCLE_R}", fonts(40), anchor="mm")
    rx = int(round(CIRCLE_R * STRETCH))
    d.ellipse((CENTER_X - rx, cy - CIRCLE_R, CENTER_X + rx, cy + CIRCLE_R), outline=(0, 230, 255), width=7)
    text(d, (CENTER_X, 1045), "客席から丸く見えるのはどちら?", fonts(56), anchor="mt")
    text(d, (CENTER_X, 1112), f"白=素のまま  シアン=横{STRETCH}倍", fonts(48), (0, 230, 255), anchor="mt")

    yel, grn, red = (255, 230, 0), (0, 255, 80), (255, 40, 40)
    for x in (WIN_L, WIN_R):
        d.rectangle((x - 2, WIN_T, x + 1, WIN_B), fill=yel)
    for y in (WIN_T, WIN_B):
        d.rectangle((WIN_L, y - 2, WIN_R, y + 1), fill=yel)
    d.rectangle((CENTER_X - 2, 0, CENTER_X + 1, H), fill=grn)
    for x in (FACE_A_END, FACE_C_START):
        d.rectangle((x - 4, 0, x + 3, H), fill=red)
    f36 = fonts(36)
    text(d, (WIN_L + 8, 200), f"窓の左端 x={WIN_L}", f36, yel)
    text(d, (WIN_R + 8, 200), f"窓の右端 x={WIN_R}", f36, yel)
    text(d, (2300, 92), f"窓の上 y={WIN_T}", f36, yel)
    text(d, (2650, 1176), f"窓の下 y={WIN_B}", f36, yel)
    text(d, (CENTER_X + 8, 150), f"中心 x={CENTER_X}", f36, grn)
    text(d, (FACE_A_END + 10, 260), f"境目 x={FACE_A_END}", f36, red)
    text(d, (FACE_C_START + 10, 260), f"境目 x={FACE_C_START}", f36, red)

    draw_color_checks(d, fonts)
    arr = np.array(pil)
    arr[0:STRIP_H, :] = (0, 0, 0)   # 動く線の通り道
    return arr


def text_patch(base, fonts, box, s, size):
    x0, y0, x1, y1 = box
    im = Image.fromarray(base[y0:y1, x0:x1].copy())
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, x1 - x0, y1 - y0), fill=(0, 0, 0))
    text(d, (8, (y1 - y0) // 2), s, fonts(size), anchor="lm")
    return np.array(im)


class FrameMaker:
    HALF_BOX = (130, 1040, 940, 1125)
    FRAME_BOX = (130, 1130, 940, 1215)

    def __init__(self, fonts):
        self.base = build_base(fonts)
        self.half = [text_patch(self.base, fonts, self.HALF_BOX, f"0.5秒ごと 番号 {i:02d}", 64)
                     for i in range(FRAMES // 30)]
        self.cnt = [text_patch(self.base, fonts, self.FRAME_BOX, f"コマ {i:02d} / 59", 64)
                    for i in range(FPS)]

    def frame(self, n):
        n %= FRAMES
        sec, k = divmod(n, FPS)
        if sec == GREY_SECOND:
            f = np.full((H, W, 3), 128, np.uint8)
        else:
            f = self.base.copy()
            x0, y0, x1, y1 = self.HALF_BOX
            f[y0:y1, x0:x1] = self.half[n // 30]
            x0, y0, x1, y1 = self.FRAME_BOX
            f[y0:y1, x0:x1] = self.cnt[k]
            ph = k / FPS                       # 細い縦線: 1 秒で 1 往復
            tri = 2 * ph if ph <= 0.5 else 2 * (1 - ph)
            x = int(round(tri * (W - 8)))
            f[0:STRIP_H, x:x + 8] = (255, 255, 255)
        sx0, sy0, sx1, sy1 = SYNC
        f[sy0:sy1, sx0:sx1] = (255, 255, 255) if k < SYNC_FRAMES else (0, 0, 0)
        return f


def write_beep_wav(path):
    """毎秒の頭に 1 kHz・-12 dBFS・50 ms のビープ。48 kHz 24bit ステレオ。"""
    sr = 48000
    sig = np.zeros(SECONDS * sr)
    n = int(0.05 * sr)
    fade = int(0.002 * sr)
    env = np.ones(n)
    env[:fade] = np.linspace(0, 1, fade)
    env[-fade:] = np.linspace(1, 0, fade)
    tone = np.sin(2 * math.pi * 1000 * np.arange(n) / sr) * env * 10 ** (-12 / 20)
    for s in range(SECONDS):
        sig[s * sr:s * sr + n] = tone
    i32 = np.round(sig * 8388607).astype("<i4")
    mono = i32.view(np.uint8).reshape(-1, 4)[:, :3]
    stereo = np.repeat(mono[:, None, :], 2, axis=1).reshape(-1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(sr)
        w.writeframes(stereo.tobytes())


def run(cmd):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def write_master(fm, out):
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv444p10le",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "0", "-colorspace", "bt709",
           "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", str(out)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    try:
        for n in range(FRAMES):
            p.stdin.write(fm.frame(n).tobytes())
            if n % 300 == 0:
                print(f"frame {n}/{FRAMES}", flush=True)
        p.stdin.close()
    except BrokenPipeError:
        pass
    if p.wait() != 0:
        sys.exit("マスター映像の書き出しに失敗")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--name", default="test_pattern")
    ap.add_argument("--sim-out", help="2840x620 30p H.264 の mp4 の書き出し先")
    ap.add_argument("--check-jpg", help="確認用に 1 コマを書く")
    ap.add_argument("--check-frame", type=int, default=0)
    ap.add_argument("--check-only", action="store_true", help="確認の 1 コマだけ作って終わる")
    ap.add_argument("--font")
    a = ap.parse_args()

    work, out = Path(a.work_dir), Path(a.out_dir)
    work.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    fm = FrameMaker(Fonts(find_font(a.font)))
    if a.check_jpg:
        Path(a.check_jpg).parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(fm.frame(a.check_frame)).save(a.check_jpg, quality=92)
        print("check jpg:", a.check_jpg)
    if a.check_only:
        return

    master, wav = work / "master.mkv", work / "beep.wav"
    write_beep_wav(wav)
    write_master(fm, master)
    encode = Path(__file__).resolve().parent.parent / "run" / "encode_led.sh"
    run([shutil.which("bash") or "bash", str(encode), str(master), str(wav), str(out), a.name])
    if a.sim_out:
        Path(a.sim_out).parent.mkdir(parents=True, exist_ok=True)
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(master),
             "-vf", "fps=30,scale=2840:620:flags=lanczos,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
             "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-colorspace", "bt709",
             "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
             "-an", "-map_metadata", "-1", "-movflags", "+faststart", a.sim_out])
    print("完了")


if __name__ == "__main__":
    main()
