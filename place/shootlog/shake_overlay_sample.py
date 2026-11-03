"""手持ちの実写に AR のキャラを重ねた見本を作り、手ブレで重ねがどれだけずれるかを数字で見る。受け手の記録(stream.hevc・index.jsonl)と、点の拾い(<rx>_events.json)を使う。

  python place/shootlog/shake_overlay_sample.py --rx <受け手の記録> --events <点の拾い.json> --out <出力フォルダ> [--start 400] [--frames 240]
やること:
 ①点のレイから LED の位置を解き、各点の「計算の位置」と「映像の中の本物の点」の差(画素)を時刻ごとに出す(手ブレでずれが増えるか)。カメラの動きの速さ・コマの鮮明さも一緒に出す。
 ②本物のページ(place/web/ar_show.js)を Chrome で動かし、録画の姿勢どおりにキャラを描いて透明の PNG にし、実写に重ねて mp4 にする。
ページは place/ios/ARSite を配る(python place/ios/tools/make_arsite.py を先に)。
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import subprocess
import threading
from pathlib import Path

import cv2
import numpy as np
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent / "ios" / "ARSite"
FACE_W, FACE_H, LED_BOTTOM = 0.6, 0.28125, 0.12
W, H = 1920, 1080
OUT_W, OUT_H = 1280, 720
PORT = 18800


def frac(k):
    return 0.1 + 0.8 * (k % 5) / 4, 0.15 + 0.7 * (k // 5) / 2


def to_rays(events):
    rays = []
    for k, u, v, T, K, ts, nfr in events:
        if k >= 15:
            continue
        M = np.array(T).reshape(4, 4).T
        fx, fy, cx, cy = K
        d = (M @ np.array([(u - cx) / fx, -(v - cy) / fy, -1.0, 0.0]))[:3]
        rays.append({"face": "A", "id": f"dot{k}", "dot": k, "origin": M[:3, 3].tolist(), "direction": (d / np.linalg.norm(d)).tolist(), "_u": u, "_v": v, "_T": T, "_K": K, "_ts": ts})
    return rays


def proj_from_k(K, near=0.05, far=80.0):
    fx, fy, cx, cy = K
    w, h = 3840.0, 2160.0
    P = np.zeros((4, 4))
    P[0, 0], P[0, 2] = 2 * fx / w, 2 * cx / w - 1
    P[1, 1], P[1, 2] = 2 * fy / h, 1 - 2 * cy / h
    P[2, 2], P[2, 3] = -(far + near) / (far - near), -2 * far * near / (far - near)
    P[3, 2] = -1
    return P.T.flatten().tolist()     # 列優先


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rx", required=True)
    ap.add_argument("--events", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--start", type=int, default=400)
    ap.add_argument("--frames", type=int, default=240)
    a = ap.parse_args()
    rx, out = Path(a.rx), Path(a.out)
    (out / "over").mkdir(parents=True, exist_ok=True)
    idx = [json.loads(line) for line in open(rx / "index.jsonl", encoding="utf-8")]
    raw = json.load(open(a.events))
    zeros = [i for i, e in enumerate(raw) if e[0] == 0]
    if len(zeros) >= 2:
        raw = raw[zeros[1]:]        # 最初の周は捨てる(録画の頭の緑の物で番号がずれることがある)
    events = [e for e in raw if 9 <= e[6] <= 16]
    rays = to_rays(events)

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    handler.log_message = lambda *x, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = (f"http://127.0.0.1:{PORT}/place/web/ar_show.html?track=/show/data/ar/dance_track&start_at=66&scale=0.19&charheight=0.3"
           f"&face_w={FACE_W}&face_h={FACE_H}&led_bottom={LED_BOTTOM}&test_center=1&show_led=1&pr=1&dot_rms=3")
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = b.new_page(viewport={"width": OUT_W, "height": OUT_H})
        page.goto(url)
        page.wait_for_function("window.__arShow && window.__arShow.ready", timeout=180000)
        page.add_style_tag(content="html,html.desktop,body,html.desktop body{background:transparent!important}#hud,#bar{display:none!important}")
        page.evaluate("(r) => window.__arShow.host.onCalibration(r)", [{k: v for k, v in r.items() if not k.startswith("_")} for r in rays])
        info = page.evaluate("({T: window.__arShow.T, align: window.__arShow.align})")
        print("校正:", info["align"])
        if not info["align"].startswith("点 "):
            raise SystemExit("校正が通らなかった: " + info["align"])
        M_led = np.array(info["T"]).reshape(4, 4).T

        # ①点の計算の位置と本物の点の差
        rows = []
        for r in rays:
            fx0, fy0 = frac(r["dot"])
            P = M_led @ np.array([fx0 * FACE_W, (1 - fy0) * FACE_H, 0.0, 1.0])
            T = np.array(r["_T"]).reshape(4, 4).T
            Pc = np.linalg.inv(T) @ P
            fx, fy, cx, cy = r["_K"]
            u, v = cx + fx * Pc[0] / -Pc[2], cy - fy * Pc[1] / -Pc[2]
            rows.append({"dot": r["dot"], "ts": r["_ts"], "err_px_fhd": float(np.hypot(u - r["_u"], v - r["_v"]) / 2)})
        # カメラの速さ(各コマ)
        ts = np.array([x["ar_ts"] for x in idx])
        Ts = [np.array(x["T"]).reshape(4, 4).T for x in idx]
        speed, ang = [0.0], [0.0]
        for i in range(1, len(Ts)):
            dt = max(ts[i] - ts[i - 1], 1e-3)
            speed.append(float(np.linalg.norm(Ts[i][:3, 3] - Ts[i - 1][:3, 3]) / dt))
            R = Ts[i - 1][:3, :3].T @ Ts[i][:3, :3]
            ang.append(float(np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))) / dt))
        for x in rows:
            i = int(np.searchsorted(ts, x["ts"]))
            i = min(i, len(ang) - 1)
            x["ang_deg_s"] = ang[i]
        err = np.array([x["err_px_fhd"] for x in rows])
        summary = {"events": len(rows), "err_px_fhd_median": float(np.median(err)), "err_px_fhd_p90": float(np.percentile(err, 90)), "err_px_fhd_max": float(err.max()),
                   "ang_deg_s_median": float(np.median(ang)), "ang_deg_s_p90": float(np.percentile(ang, 90)), "speed_m_s_median": float(np.median(speed)), "speed_m_s_p90": float(np.percentile(speed, 90)),
                   "align": info["align"]}
        slow = err[[x["ang_deg_s"] < 2 for x in rows]]
        fast = err[[x["ang_deg_s"] >= 2 for x in rows]]
        summary["err_slow_median"] = float(np.median(slow)) if len(slow) else None
        summary["err_fast_median"] = float(np.median(fast)) if len(fast) else None
        (out / "shake.json").write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False))

        # ②重ねの絵
        page.evaluate("() => window.__arShow.host.onManualStart()")
        for i in range(a.start, min(a.start + a.frames, len(idx))):
            rec = idx[i]
            page.evaluate("([w, p, t]) => { const h = window.__arShow.host; h.onPose(w, p, t); }", [rec["T"], proj_from_k(rec["K"]), rec["ar_ts"]])
            page.wait_for_timeout(120)
            page.screenshot(path=str(out / "over" / f"o_{i - a.start:05d}.png"), omit_background=True)
            if (i - a.start) % 30 == 0:
                print("描いた", i - a.start, flush=True)
        b.close()
    srv.shutdown()

    # 実写のコマ
    src = out / "frames"
    src.mkdir(exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "hevc", "-r", "30", "-i", str(rx / "stream.hevc"), "-vf", f"select='between(n\\,{a.start}\\,{a.start + a.frames - 1})',scale={OUT_W}:{OUT_H}", "-fps_mode", "passthrough", str(src / "f_%05d.png")], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-start_number", "1", "-i", str(src / "f_%05d.png"), "-framerate", "30", "-i", str(out / "over" / "o_%05d.png"),
                    "-filter_complex", "[0:v][1:v]overlay=format=auto,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-map_metadata", "-1", str(out / "shake_overlay_sample.mp4")], check=True)
    print("作った:", out / "shake_overlay_sample.mp4")


if __name__ == "__main__":
    main()
