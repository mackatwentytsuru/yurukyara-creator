"""dots_align.py(Python)が、本物のページ(ar_show.js の solveDots)と同じ答えを出すかの確かめ。Chrome で本物のページを動かす。

  python place/ios/tools/make_arsite.py && python place/shootlog/dots_align_selftest.py
同じレイをページと dots_align.solve の両方に渡し、解いた変換の yaw が 0.1° 以内・位置が 0.5 cm 以内で合うこと(合格の線)。
レイは 4 通り: ①雑音だけ ②外れが 2 割 ③面 B が図面より 20 cm 奥 ④雑音が大きい。点の表(33 点)がページと同じかも見る。
"""
from __future__ import annotations

import functools
import http.server
import sys
import threading
from pathlib import Path

import numpy as np
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dots_align  # noqa: E402
from dots_page_selftest import rays as make_rays  # noqa: E402
from make_led_dots_video import dots  # noqa: E402

ROOT = HERE.parent / "ios" / "ARSite"
PORT = 18797
YAW_TOL_DEG, POS_TOL_CM = 0.1, 0.5


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

    table = dots()
    mine = np.array([d["p"] for d in dots_align.DOTS])
    ref = np.array([[(c["stage_cm"][0] + 749.7) / 100, (c["stage_cm"][2] - 98) / 100, c["stage_cm"][1] / 100] for c in table])
    check("点の表が make_led_dots_video.dots() と同じ", len(mine) == 33 and np.abs(mine - ref).max() < 1e-3, f"最大差 {np.abs(mine - ref).max():.2e} m")

    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = b.new_page(viewport={"width": 800, "height": 500})
        page.goto(f"http://127.0.0.1:{PORT}/place/web/ar_show.html?dots=led3&dot_rms=4&track=/show/data/ar/dance_track&show_led=1")
        page.wait_for_function("window.__arShow && window.__arShow.ready", timeout=120000)
        led3 = page.evaluate("window.__arShow.led3")
        check("点の表がページと同じ", np.abs(np.array([a["p"] for a in led3]) - mine).max() < 1e-3)
        pts = [a["p"] for a in led3]
        cam = [(0 + 749.7) / 100, (220 - 98) / 100, 13.0]

        def page_solve(rs):
            page.reload()
            page.wait_for_function("window.__arShow && window.__arShow.ready", timeout=120000)
            page.evaluate("(r) => window.__arShow.host.onCalibration(r)", rs)
            T = page.evaluate("window.__arShow.T")
            return None if T is None else np.array(T).reshape(4, 4).T

        def compare(name, rs):
            res = dots_align.solve(rs)
            Tp = page_solve(rs)
            if Tp is None or not res["ok"]:
                check(name, False, f"ページ T={'なし' if Tp is None else 'あり'}、こちら ok={res['ok']} {res['reason']}")
                return
            Tm = np.array(res["T"])
            yaw_p = np.degrees(np.arctan2(Tp[0, 2], Tp[0, 0]))
            dyaw = abs((res["yaw_deg"] - yaw_p + 180) % 360 - 180)
            dpos = float(np.linalg.norm(Tm[:3, 3] - Tp[:3, 3]) * 100)
            # 舞台の中央(キャラの位置)でも比べる
            centre = np.array([749.7 / 100, -0.98, 1.8, 1.0])
            dcen = float(np.linalg.norm((Tm @ centre - Tp @ centre)[:3]) * 100)
            check(name, dyaw <= YAW_TOL_DEG and dpos <= POS_TOL_CM and dcen <= POS_TOL_CM,
                  f"yaw 差 {dyaw:.4f}°、位置の差 {dpos:.3f} cm、中央の差 {dcen:.3f} cm(点 {res['n_dots']}、rms {res['rms_cm']:.2f} cm)")

        rng = np.random.default_rng(5)
        th, t = np.radians(37.0), np.array([1.3, -0.4, 2.1])
        compare("①雑音だけ", make_rays(pts, th, t, cam, rng))
        rs = make_rays(pts, th, t, cam, rng)
        for i in rng.choice(len(rs), 6, replace=False):
            rs[int(i)]["direction"] = (np.array(rs[int(i)]["direction"]) + rng.normal(0, 0.05, 3)).tolist()
        compare("②外れが 2 割", rs)
        moved = [list(p) for p in pts]
        for i, a in enumerate(led3):
            if a["face"] == "B":
                moved[i][2] -= 0.20
        compare("③面 B が図面より 20 cm 奥", make_rays(moved, th, t, cam, rng))
        compare("④雑音が大きい(2 mrad)", make_rays(pts, th, t, cam, rng, noise_rad=0.002, walk=1.0))
        b.close()
    srv.shutdown()
    print("全部合格" if ok else "不合格あり")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
