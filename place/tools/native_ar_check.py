"""iPhone の殻アプリ(ARKit+透明 WKWebView)の代わりに偽の殻を差して、ブラウザで AR の道を通し試験する。
  python place/tools/native_ar_check.py [出力フォルダ]
偽の殻: window.webkit.messageHandlers.arhost を用意し、raycast を聞かれたら床の点 (0.5, -1.2, -2) を返す。
姿勢は、(0, 0.2, 1) のカメラが -z(部屋の奥)を向く行列と、縦長の画面の射影行列を送る。
確かめること: AR ボタンが使える・床を 2 回タップすると部屋が 25 度回って現実の点に重なる(向き・位置・床の高さ)・
そのあとのタップで床の点が返りキャラがそこに立つ・キャラの体が camera のほうを向く・
背景が透明(canvas の左上のピクセルの alpha が 0)・エラーが無い。
"""
import json
import math
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "place" / "shots"

FAKE_HOST = """
window.__shellMessages = [];
window.__hitQueue = [];
window.webkit = { messageHandlers: { arhost: { postMessage: (m) => {
  window.__shellMessages.push(m);
  if (m.type === 'raycast') setTimeout(() => { const h = (window.__hitQueue || []).shift() || [0.5, -1.2, -2]; window.__arhost && window.__arhost.onHit(h[0], h[1], h[2]); }, 20);
} } } };
"""


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
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            page = browser.new_page(viewport={"width": 390, "height": 844})
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(FAKE_HOST)
            page.goto(f"http://127.0.0.1:{port}/place/web/demo.html?place=test_room")
            page.wait_for_function("window.__place && window.__place.ready", timeout=20000)
            ar_enabled = page.evaluate("!document.getElementById('btn-ar').disabled")
            page.click("#btn-ar")
            page.wait_for_function("window.__shellMessages.some(m => m.type === 'ready')", timeout=5000)
            # 縦長の画面(390x844)の射影と、(0,0.2,1) から -z を向く姿勢を送る
            page.evaluate(
                """() => {
                  const c = new Float32Array(16);
                  const aspect = 390 / 844, near = 0.05, far = 50, f = 1 / Math.tan((60 * Math.PI / 180) / 2);
                  const proj = [f / aspect, 0, 0, 0,  0, f, 0, 0,  0, 0, (far + near) / (near - far), -1,  0, 0, 2 * far * near / (near - far), 0];
                  const world = [1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0.2, 1, 1];
                  window.__arhost.onPose(world, proj);
                }"""
            )
            # --- 位置合わせ: 部屋の目印の真下の床を 2 回タップ(正解は、25 度回して (1, -1.2, -3) に置いた部屋)
            targets = page.evaluate("window.__place.align.targets")
            yaw, tx, tz, fy = math.radians(25), 1.0, -3.0, -1.2

            def to_world(x, z):
                return [x * math.cos(yaw) + z * math.sin(yaw) + tx, fy, -x * math.sin(yaw) + z * math.cos(yaw) + tz]

            page.evaluate("(q) => window.__hitQueue.push(...q)", [to_world(*t["room"]) for t in targets])
            page.mouse.click(195, 600)
            page.wait_for_function("window.__place.align && window.__place.align.prompt.includes('2/2')", timeout=5000)
            page.mouse.click(195, 650)
            page.wait_for_function("window.__place.align.done", timeout=5000)
            align = page.evaluate("window.__place.align")
            first = targets[0]["name"]
            world_first = page.evaluate("(n) => window.__place.worldOfRoom(n)", first)
            expect_first = to_world(*targets[0]["room"])
            page.wait_for_timeout(200)
            char_after_align = page.evaluate("window.__place.characterPosition")
            # 位置合わせのあとのタップは、キャラを動かす
            page.evaluate("() => window.__hitQueue.push([0.5, -1.2, -2])")
            page.mouse.click(195, 700)
            page.wait_for_function("window.__place.nativeHit !== null", timeout=5000)
            page.wait_for_timeout(300)
            result = page.evaluate(
                """() => {
                  const cv = document.querySelector('canvas');
                  const gl = cv.getContext('webgl2') || cv.getContext('webgl');
                  const px = new Uint8Array(4);
                  gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
                  return { hit: window.__place.nativeHit, pos: window.__place.characterPosition,
                           yaw: window.__place.characterYaw, poses: window.__place.nativePoses,
                           cornerRGBA: Array.from(px), info: document.getElementById('info').textContent.slice(0, 80) };
                }"""
            )
            page.screenshot(path=str(OUT / "native_ar_390x844.png"))
            result.update({"align": align, "world_first": world_first, "expect_first": expect_first, "char_after_align": char_after_align, "ar_button_enabled": ar_enabled, "errors": errors, "messages": page.evaluate("window.__shellMessages")})
            print(json.dumps(result, ensure_ascii=False, indent=1))
            browser.close()
        ok = (
            result["ar_button_enabled"]
            and result["hit"] == [0.5, -1.2, -2]
            and abs(result["pos"][1] - -1.2) < 1e-6
            and result["align"]["ok"]
            and abs(math.degrees(result["align"]["result"]["yaw"]) - 25) < 0.01
            and all(abs(a - b) < 1e-4 for a, b in zip(result["world_first"], result["expect_first"]))
            and result["cornerRGBA"][3] == 0
            and not result["errors"]
        )
        print("合格" if ok else "不合格")
        return 0 if ok else 1
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == "__main__":
    raise SystemExit(main())
