"""modes.js を使って作ったページが、AR/VR の切りかえとして正しく動くかを、偽の殻で判定する。
  python place/tools/check_modes_page.py <リポジトリの根からのページのパス。例 place/skilltest/x/index.html>
ページの決まり(スキル web-ar-vr-modes の呼び方どおり):
  - ?place=test_room を読む。loadPlace → createPresentation → mountModeButtons({container: #modes})。
  - 殻の中(modes.available.ar_kind === 'native')なら、読み込み後に自分で modes.enter('ar') を呼ぶ。
  - onViewer で、見ている人の頭(camera のワールド位置)を window.__viewer = [x, y, z] に入れる。
  - 準備ができたら window.__ready = true。
判定: (殻あり) AR に入る・殻へ ready が届く・html の data-presentation が ar・背景が透明・姿勢を送ると
 window.__viewer がカメラ位置に一致・エラー 0 / (殻なし) AR・VR のボタンが無く data-presentation が screen・エラー 0。
合格なら終了コード 0。
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
PAGE = sys.argv[1].lstrip("/") if len(sys.argv) > 1 else ""

FAKE_HOST = """
window.__shellMessages = [];
window.webkit = { messageHandlers: { arhost: { postMessage: (m) => window.__shellMessages.push(m) } } };
"""
WORLD = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 1.5, 2, 1]  # カメラを (0.5, 1.5, 2) に置く
PROJ = [1.8, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.1002, 0]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def run_page(browser, url, with_shell):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    errors = []
    # favicon が無いことによる 404 は雑音なので数えない。ほかの読み込み失敗とページの例外は数える
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("response", lambda r: errors.append(f"HTTP {r.status}: {r.url}") if r.status >= 400 and "favicon" not in r.url else None)
    if with_shell:
        page.add_init_script(FAKE_HOST)
    page.goto(url)
    page.wait_for_function("window.__ready === true", timeout=20000)
    out = {"errors": errors, "presentation": page.evaluate("document.documentElement.dataset.presentation")}
    if with_shell:
        page.wait_for_function("window.__shellMessages.some(m => m.type === 'ready')", timeout=5000)
        out["presentation"] = page.evaluate("document.documentElement.dataset.presentation")
        page.evaluate("([w, p]) => window.__arhost.onPose(w, p)", [WORLD, PROJ])
        page.wait_for_timeout(300)
        out["viewer"] = page.evaluate("window.__viewer")
        out["corner_alpha"] = page.evaluate(
            """() => { const cv = document.querySelector('canvas'); const gl = cv.getContext('webgl2') || cv.getContext('webgl');
                      const px = new Uint8Array(4); gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return px[3]; }"""
        )
        out["html_bg"] = page.evaluate("getComputedStyle(document.documentElement).backgroundColor")
        out["body_bg"] = page.evaluate("getComputedStyle(document.body).backgroundColor")
    else:
        out["mode_buttons"] = page.evaluate("document.querySelectorAll('#modes .place-mode-ar, #modes .place-mode-vr').length")
    page.close()
    return out


def main() -> int:
    if not PAGE or not (REPO / PAGE).exists():
        print(f"不合格: ページが無い: {PAGE}")
        return 1
    port = free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    problems = []
    try:
        url = f"http://127.0.0.1:{port}/{PAGE}?place=test_room"
        for _ in range(50):
            try:
                urllib.request.urlopen(url, timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            try:
                shell = run_page(browser, url, True)
                plain = run_page(browser, url, False)
            except Exception as e:  # noqa: BLE001
                print(f"不合格: ページが動かない: {e}")
                return 1
            finally:
                browser.close()
        print(json.dumps({"shell": shell, "plain": plain}, ensure_ascii=False, indent=1))
        if shell["errors"]:
            problems.append(f"殻あり: エラー {shell['errors'][:2]}")
        if shell["presentation"] != "ar":
            problems.append(f"殻あり: data-presentation が ar でない({shell['presentation']})")
        v = shell.get("viewer")
        if not v or any(abs(a - b) > 1e-3 for a, b in zip(v, [0.5, 1.5, 2])):
            problems.append(f"殻あり: window.__viewer が (0.5,1.5,2) でない({v})")
        if shell.get("corner_alpha") != 0:
            problems.append(f"殻あり: canvas が透明でない(alpha={shell.get('corner_alpha')})")
        for k in ("html_bg", "body_bg"):
            if shell.get(k) not in ("rgba(0, 0, 0, 0)", "transparent"):
                problems.append(f"殻あり: {k} が透明でない({shell.get(k)})")
        if plain["errors"]:
            problems.append(f"殻なし: エラー {plain['errors'][:2]}")
        if plain["presentation"] != "screen":
            problems.append(f"殻なし: data-presentation が screen でない({plain['presentation']})")
        if plain.get("mode_buttons") != 0:
            problems.append(f"殻なし: AR/VR のボタンが出ている({plain.get('mode_buttons')})")
    finally:
        server.terminate()
        server.wait(timeout=10)
    if problems:
        print("不合格:\n- " + "\n- ".join(problems))
        return 1
    print("合格: 切りかえのページは決まりどおりに動いた")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
