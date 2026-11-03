"""画角の下見の絵: 候補の位置から iPad のレンズで見た UE の絵を自動で撮って、並べた 1 枚を作る(本人が iPad を持たなくてよい)。

  python place/shootlog/scout/scout_shots.py --out <出力フォルダ> [--time 66]
scout.py と同じ位置・同じ起動。UE の札を取ってから流す。
"""
from __future__ import annotations

import argparse
import json
import math
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from scout import RUN_LIVE, SPOTS, UDP_PORT, yaw_to_target  # noqa: E402

K = [3065.0, 3065.0, 1920.0, 1080.0]      # iPad の ARKit(4K の画素)の代表値
W_, H_ = 3840, 2160
CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
# ページの「絵を撮る」ボタンの代わりに、Chrome の screenshot を使う
SHOT = 8.0


def identity_T():
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def send(s, msg):
    s.sendto(json.dumps(msg).encode("utf-8"), ("127.0.0.1", UDP_PORT))


def poses(s, seconds):
    end = time.time() + seconds
    while time.time() < end:
        send(s, {"t": time.time(), "T": identity_T(), "K": K, "w": W_, "h": H_, "ok": True})
        time.sleep(1 / 30)


def label(img, text):
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(pil)
    size = int(pil.width * 0.045)
    font = ImageFont.truetype(r"C:\Windows\Fonts\YuGothB.ttc", size)
    d.rectangle([0, 0, pil.width, int(size * 1.5)], fill=(0, 0, 0))
    d.text((10, int(size * 0.15)), text, fill=(255, 255, 255), font=font)
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--time", type=float, default=66.0)
    ap.add_argument("--media", default=None)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    start = SPOTS[0][1]
    cmd = [sys.executable, str(RUN_LIVE), "serve", "--out", str(out / "live"), "--lan", "--start-pos", *[str(v) for v in start], "--start-yaw", str(yaw_to_target(start)),
           "--start-sec", str(a.time), "--serve-minutes", "12"]
    if a.media:
        cmd += ["--media", a.media]
    log = open(out / "run_live.log", "w", encoding="utf-8")
    live = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    from playwright.sync_api import sync_playwright
    shots = []
    try:
        for _ in range(300):
            time.sleep(1)
            if "ready:" in Path(out / "run_live.log").read_text(encoding="utf-8", errors="replace"):
                break
            if live.poll() is not None:
                raise SystemExit("UE が起動しなかった: " + Path(out / "run_live.log").read_text(encoding="utf-8", errors="replace")[-600:])
        else:
            raise SystemExit("UE の用意が 300 秒で終わらなかった")
        with sync_playwright() as pw:
            b = pw.chromium.launch(channel="chrome", headless=True, args=["--use-angle=d3d11", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"])
            page = b.new_page(viewport={"width": 1280, "height": 720})
            page.goto("http://127.0.0.1:8080/")
            poses(s, 6)
            for name, pos, note in SPOTS:
                send(s, {"cmd": "recenter", "pos": list(pos), "yaw": yaw_to_target(pos)})
                send(s, {"cmd": "media", "seconds": a.time})
                poses(s, SHOT)
                f = out / f"spot_{len(shots)}.png"
                page.screenshot(path=str(f))
                shots.append((f, name + ("  " + note if note else "")))
                print("撮った", name, flush=True)
            b.close()
    finally:
        s.close()
        live.terminate()
        try:
            live.wait(timeout=40)
        except subprocess.TimeoutExpired:
            pass
    tiles = [label(cv2.resize(cv2.imdecode(np.fromfile(str(f), np.uint8), 1), (800, 450)), t) for f, t in shots]
    while len(tiles) % 2:
        tiles.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles), 2)]
    ok, buf = cv2.imencode(".jpg", np.vstack(rows))
    (out / "候補の位置の絵.jpg").write_bytes(buf.tobytes())
    print("作った:", out / "候補の位置の絵.jpg")


if __name__ == "__main__":
    main()
