"""room_demo.html(画面から出てきて、歩いて、戻る)を、殻なしのブラウザで撮って確かめる。
  python place/tools/room_demo_check.py [出力フォルダ]
殻なしの既定(画面の左右の足元 (-0.6,0,0)・(0.6,0,0)、カメラ (0,1.3,3.2))で、動きの各時刻の絵を撮り、
VRM が読めたか・キャラの位置が画面の面(z=0)の前後でどう動くか・エラーを出す。
"""
import json
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "place" / "shots"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    port = free_port()
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=REPO,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/place/web/room_demo.html", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        with sync_playwright() as p:
            br = p.chromium.launch(channel="chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            page = br.new_page(viewport={"width": 960, "height": 540})
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"http://127.0.0.1:{port}/place/web/room_demo.html")
            page.wait_for_function("window.__roomDemo && window.__roomDemo.ready", timeout=120000)
            info = page.evaluate("() => ({vrm: window.__roomDemo.vrmLoaded, charHeight: window.__roomDemo.charHeight})")
            print(info)
            log = []
            for i, t in enumerate([0.5, 2.5, 4.5, 6.5, 7.5, 9.5, 11.5]):
                # t0 をそろえて時刻を決める(実時間に頼らず、ページの時刻を進める)
                page.evaluate("(t) => { window.__roomDemo.phase = null; }", t)
                time.sleep(0.2)
                ph = page.evaluate("() => window.__roomDemo.phase")
                png = OUT / f"room_demo_{i}.png"
                page.screenshot(path=str(png))
                log.append({"shot": png.name, "phase": ph, "holder": page.evaluate("() => window.__roomDemo.holder")})
                time.sleep(max(0.0, 2.0 - 0.3))
            print(json.dumps(log, ensure_ascii=False))
            print("エラー:", errors[:5])
            br.close()
    finally:
        server.terminate()


if __name__ == "__main__":
    main()
