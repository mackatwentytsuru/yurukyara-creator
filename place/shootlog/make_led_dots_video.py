"""本番の LED(5680×1240、60p)に流す「点の校正」の映像を作る。AR モニターが、これを見て LED の位置を自動で取る(アプリの DotCalibrator.swift)。

  python place/shootlog/make_led_dots_video.py --out <出力フォルダ> [--no-video]
出力: led_dots_5680x1240.mov(HEVC 10bit)と _H264.mp4(60p、約 34 秒。くり返して流してよい)、led_dots.json(点の表)、led_dots_still.png(1 コマ)。
ショーの映像とは別の 1 本。撮影の前に流して校正してから、ショーの映像を流す(ショーの時刻に影響しない)。
1 周(11.4 秒): 全面を 0.4 秒緑に光らせる(合図)→ 0.4 秒消す → 33 点を順に 0.2 秒ずつ(0.3 秒おき)→ 0.7 秒あける。
緑の明るさを周ごとに 100%・60%・35% と変える(LED が明るくて緑が白く飛ぶ周があっても、飛ばない周の点を拾える)。
点(番号順): A 3×3(絵の x 0〜955)・B 5×3(x 1280〜3038、y 85〜1217)・C 3×3(平らな部分 x 3346〜4288)。重なって映る絵の 957〜1279 と 3039〜3345 は使わない。
位置の決まりは place/web/ar_show.js の LED3 と同じ。大きさは物理で直径 50 cm(面 B は画素が縦横で違うので楕円で描く)。
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

W, H, FPS = 5680, 1240, 60
SYNC, GAP, STEP, ON, TAIL = 0.4, 0.4, 0.3, 0.2, 0.7
LEVELS = (1.0, 0.6, 0.35)
DOT_DIAMETER_M = 0.5
A_PITCH = 0.004
B_PITCH_X, B_PITCH_Y = 7.04 / 2388, 4.96 / 1133


def dots():
    out = []

    def add(face, cols, rows, rx, ry, rw, rh, stage, px_x, px_y):
        for r in range(rows):
            for c in range(cols):
                px = rx + (0.1 + 0.8 * c / (cols - 1)) * rw
                py = ry + (0.15 + 0.7 * r / (rows - 1)) * rh
                X, Y, Z = stage(px, py)
                out.append({"k": len(out), "face": face, "px": round(px, 2), "py": round(py, 2), "stage_cm": [round(X, 2), round(Y, 2), round(Z, 2)],
                            "rx": round(DOT_DIAMETER_M / 2 / px_x, 1), "ry": round(DOT_DIAMETER_M / 2 / px_y, 1)})

    add("A", 3, 3, 0, 0, 956, 1240, lambda x, y: (-749.7 + x * 0.4, 0.0, 594 - y * 0.4), A_PITCH, A_PITCH)
    add("B", 5, 3, 1280, 85, 1759, 1133, lambda x, y: (-352 + (x - 957) * (704 / 2388), -140.0, 594 - (y - 85) * (496 / 1133)), B_PITCH_X, B_PITCH_Y)
    add("C", 3, 3, 3346, 0, 943, 1240, lambda x, y: (236.7 + (x - 3039) * 0.4, 0.0, 594 - y * 0.4), A_PITCH, A_PITCH)
    return out


def frame_key(t, table):
    """t 秒のコマの中身: ('sync'|'dot'|'off', 番号, 明るさ)。"""
    cycle = SYNC + GAP + len(table) * STEP + TAIL
    n = int(t // cycle)
    level = LEVELS[min(n, len(LEVELS) - 1)]
    q = t - n * cycle
    if q < SYNC:
        return ("sync", -1, level)
    if q >= SYNC + GAP:
        s = q - SYNC - GAP
        i = int(s // STEP)
        if i < len(table) and s - i * STEP < ON:
            return ("dot", i, level)
    return ("off", -1, level)


def render(key, table):
    kind, i, level = key
    img = np.zeros((H, W, 3), np.uint8)   # RGB
    g = int(round(255 * level))
    if kind == "sync":
        img[:, :, 1] = g
    elif kind == "dot":
        d = table[i]
        cv2.ellipse(img, (int(round(d["px"])), int(round(d["py"]))), (int(round(d["rx"])), int(round(d["ry"]))), 0, 0, 360, (0, g, 0), -1, cv2.LINE_AA)
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", default="led_dots_5680x1240")
    ap.add_argument("--no-video", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    table = dots()
    cycle = SYNC + GAP + len(table) * STEP + TAIL
    seconds = cycle * len(LEVELS)
    (out / "led_dots.json").write_text(json.dumps({"canvas": [W, H], "fps": FPS, "seconds": seconds, "cycle": cycle, "levels": LEVELS, "sync": SYNC, "gap": GAP, "step": STEP, "on": ON, "dots": table}, ensure_ascii=False, indent=1), encoding="utf-8")
    still = render(("dot", 16, 1.0), table)
    ok, buf = cv2.imencode(".png", cv2.cvtColor(still, cv2.COLOR_RGB2BGR))
    (out / "led_dots_still.png").write_bytes(buf.tobytes())
    print(f"点 {len(table)}、1 周 {cycle:.1f} 秒、全部 {seconds:.1f} 秒")
    if a.no_video:
        return
    common = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest"]
    mov = subprocess.Popen(common + ["-vf", "format=yuv420p10le", "-c:v", "libx265", "-preset", "fast", "-crf", "14", "-tag:v", "hvc1", "-x265-params", "log-level=error:pools=8",
                                     "-c:a", "pcm_s24le", "-map_metadata", "-1", str(out / f"{a.name}.mov")], stdin=subprocess.PIPE)
    mp4 = subprocess.Popen(common + ["-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-c:a", "aac", "-b:a", "128k", "-map_metadata", "-1",
                                     str(out / f"{a.name}_H264.mp4")], stdin=subprocess.PIPE)
    last_key, data = None, b""
    for i in range(int(round(seconds * FPS))):
        key = frame_key(i / FPS, table)
        if key != last_key:
            data = render(key, table).tobytes()
            last_key = key
        mov.stdin.write(data)
        mp4.stdin.write(data)
    for p in (mov, mp4):
        p.stdin.close()
    print("ffmpeg の終了コード", mov.wait(), mp4.wait())


if __name__ == "__main__":
    main()
