"""AR ページの点の校正(dots=led3)を、合成のレイで確かめる(Chrome で本物のページを動かす。place/ios/ARSite を配る)。

  python place/ios/tools/make_arsite.py && python place/shootlog/dots_page_selftest.py
確かめる物: ①動画の表とページの表が同じ ②正しいレイで、解いた変換が正解に合う ③外れたレイが 2 割まざっても解ける ④悪いレイだけでは前の校正を保持する ⑤面 B が図面より 20 cm 奥でも、面ごとの残差に出る。
"""
from __future__ import annotations

import http.server
import json
import functools
import sys
import threading
from pathlib import Path

import numpy as np
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from make_led_dots_video import dots  # noqa: E402

ROOT = HERE.parent / "ios" / "ARSite"
PORT = 18799


def world(p, th, t):
    c, s = np.cos(th), np.sin(th)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]) @ np.asarray(p) + t


def rays(led_pts, th, t, cam_led, rng, noise_rad=0.0002, walk=0.5):
    out = []
    for k, p in enumerate(led_pts):
        o = world(np.asarray(cam_led) + rng.uniform(-walk, walk, 3), th, t)
        d = world(p, th, t) - o
        d = d / np.linalg.norm(d) + rng.normal(0, noise_rad, 3)
        out.append({"face": "A", "id": f"dot{k}", "dot": k, "origin": o.tolist(), "direction": (d / np.linalg.norm(d)).tolist()})
    return out


def main():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(("合格" if cond else "不合格"), name, detail)

    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = b.new_page(viewport={"width": 800, "height": 500})
        page.goto(f"http://127.0.0.1:{PORT}/place/web/ar_show.html?dots=led3&dot_rms=4&track=/show/data/ar/dance_track&show_led=1")
        page.wait_for_function("window.__arShow && window.__arShow.ready", timeout=120000)

        # ①表が同じ
        led3 = page.evaluate("window.__arShow.led3")
        tab = dots()
        d = max(max(abs(a["px"] - c["px"]), abs(a["py"] - c["py"])) for a, c in zip(led3, tab))
        stage = [[(c["stage_cm"][0] + 749.7) / 100, (c["stage_cm"][2] - 98) / 100, c["stage_cm"][1] / 100] for c in tab]
        d2 = max(np.abs(np.array(a["p"]) - np.array(s)).max() for a, s in zip(led3, stage))
        check("動画の表とページの表が同じ", len(led3) == 33 and d < 0.01 and d2 < 1e-3, f"点 {len(led3)}、画素の差 {d:.3f}、位置の差 {d2:.5f} m")

        rng = np.random.default_rng(3)
        th, t = np.radians(37.0), np.array([1.3, -0.4, 2.1])
        pts = [a["p"] for a in led3]
        cam = [(0 + 749.7) / 100, (220 - 98) / 100, 13.0]

        def solve(rs):
            page.evaluate("(r) => window.__arShow.host.onCalibration(r)", rs)
            return page.evaluate("({T: window.__arShow.T, align: window.__arShow.align})")

        def err_at_centre(T):
            M = np.array(T).reshape(4, 4).T
            centre = np.array([749.7 / 100, -0.98, 1.8, 1.0])
            return np.linalg.norm((M @ centre)[:3] - world(centre[:3], th, t)) * 100

        # ②正しいレイ
        r = solve(rays(pts, th, t, cam, rng))
        e = err_at_centre(r["T"])
        check("正しいレイで、舞台の中央の誤差が 5 cm 以下", e < 5, f"{e:.1f} cm / {r['align']}")

        # ③外れ 2 割
        rs = rays(pts, th, t, cam, rng)
        for i in rng.choice(len(rs), 6, replace=False):
            rs[int(i)]["direction"] = (np.array(rs[int(i)]["direction"]) + rng.normal(0, 0.05, 3)).tolist()
        r = solve(rs)
        e = err_at_centre(r["T"])
        check("外れが 2 割まざっても、中央の誤差が 5 cm 以下", e < 5, f"{e:.1f} cm / {r['align']}")

        # ④悪いレイだけ
        before = r["T"]
        bad = rays(pts, th + 1.2, t + 3, cam, rng, walk=0.0)
        for q in bad:
            q["direction"] = (np.array(q["direction"]) + rng.normal(0, 0.2, 3)).tolist()
        r = solve(bad)
        check("悪いレイだけなら、前の校正を保持する", r["T"] == before and "保持" in r["align"], r["align"])

        # ⑤面 B が図面より奥
        moved = [list(p) for p in pts]
        for i, a in enumerate(led3):
            if a["face"] == "B":
                moved[i][2] -= 0.20
        r = solve(rays(moved, th, t, cam, rng))
        print("参考: 面 B が図面より 20 cm 奥のとき:", r["align"])
        check("面ごとの残差が表示される", "[A " in r["align"] and " B " in r["align"], r["align"])
        b.close()
    srv.shutdown()
    print("全部合格" if ok else "不合格あり")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
