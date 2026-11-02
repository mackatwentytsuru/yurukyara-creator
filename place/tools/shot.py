"""ヘッドレスのブラウザで demo.html を撮る。
使い方: python place/tools/shot.py [出力フォルダ] [places/ の下のフォルダ名]   (リポジトリの外のどこからでも動く)
自分で起動した http サーバーだけを止める。
"""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "place" / "shots"
PLACE = sys.argv[2] if len(sys.argv) > 2 else "test_room"
SHOTS = [("entrance", 1280, 720), ("top", 1000, 700), ("side", 1280, 720), ("entrance", 390, 844)]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    port = free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/place/web/demo.html", timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        results = []
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            for cam, w, h in SHOTS:
                page = browser.new_page(viewport={"width": w, "height": h})
                errors = []
                page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(f"http://127.0.0.1:{port}/place/web/demo.html?cam={cam}&place={PLACE}")
                page.wait_for_function("window.__place && window.__place.ready", timeout=20000)
                page.wait_for_timeout(500)
                if os.environ.get("SHOT_CLEAN"):  # 情報欄とボタンを隠した絵(部屋を見せる用)
                    page.add_style_tag(content="#info, #bar { display: none !important; }")
                name = f"{cam}_{w}x{h}.png"
                page.screenshot(path=str(OUT / name))
                info = page.evaluate("window.__place")
                results.append({"shot": name, "errors": errors, **info})
                page.close()
            browser.close()
        print(json.dumps(results, ensure_ascii=False, indent=1))
        return 1 if any(r["errors"] for r in results) else 0
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == "__main__":
    raise SystemExit(main())
