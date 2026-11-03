"""点の校正の答え合わせ: UE の仮想カメラで録った点の映像を、本番と同じ決まりで解き、正解(送った姿勢)と比べる。

  python place/shootlog/scout/rehearsal_dots.py --out <rehearsal.py dots の出力>
広角: DotCalibrator.swift と同じ決まりで点を拾ってレイにし、本物のページ(ar_show.js の solveDots)に渡す。ARKit の世界は舞台と別の所に
あるので、仮の回転と平行移動を掛けたレイを渡し、ページがそれを解き当てるかを見る。超広角: uw_fixed_camera.py の find_dots と solve_pose。
出力: dots_answers.json(定位置ごとの点の数・残差・舞台の中央の誤差)。
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import subprocess
import sys
import threading
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]
from make_led_dots_video import dots  # noqa: E402
from rehearsal import FX, H4K, W4K, station_pose  # noqa: E402
from uw_fixed_camera import find_dots, solve_pose, stage_points  # noqa: E402

GW, GH = 240, 135
GAP, STEP, ON = 0.4, 0.3, 0.2      # DotCalibrator.swift と同じ
AR_THETA, AR_T = np.radians(37.0), np.array([1.3, -0.4, 2.1])   # ARKit の世界が舞台からずれている量(仮の値)
SITE = HERE.parents[1] / "ios" / "ARSite"
PORT = 18798
STAGE_CENTRE_CM = (0.0, 180.0, 180.0)   # 誤差を測る所(舞台の上のキャラの位置)


def replay(video):
    """映像の各コマから点を拾う。DotCalibrator.process の写し。[(番号, 時刻, x, y)] を 1920×1080 の画素で返す。"""
    W, H = 1920, 1080
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(video), "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], stdout=subprocess.PIPE)
    size = W * H * 3 // 2
    ys = (np.arange(GH) * H // GH + H // (2 * GH))
    xs = (np.arange(GW) * W // GW + W // (2 * GW))
    base = None
    in_sync, in_event, sync_end, sync_start, quiet = False, False, None, 0.0, 0
    events, frames = [], []
    syncs, fi = 0, 0
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        t = fi / 30.0
        fi += 1
        a = np.frombuffer(buf, np.uint8)
        Y = a[:W * H].reshape(H, W)
        U = a[W * H:W * H + W * H // 4].reshape(H // 2, W // 2)
        V = a[W * H + W * H // 4:].reshape(H // 2, W // 2)
        lum = Y[np.ix_(ys, xs)].astype(np.float32)
        cb = U[np.ix_(ys // 2, xs // 2)].astype(np.float32)
        cr = V[np.ix_(ys // 2, xs // 2)].astype(np.float32)
        chroma = np.maximum(0, 128 - cb) + np.maximum(0, 128 - cr)
        both = (cb < 118) & (cr < 118)
        if base is None:
            base = chroma.copy()
        cand = (lum >= 70) & (chroma >= 70) & both & (base < 40)
        rate = np.where(cand, 0.01, 0.05)
        base = base * (1 - rate) + chroma * rate
        if cand.sum() >= 800:
            if not in_sync:
                sync_start = t
            in_sync, in_event, frames = True, False, []
            continue
        if in_sync:
            in_sync = False
            if 0.25 <= t - sync_start <= 0.6:
                sync_end, syncs = t, syncs + 1
        n, _, st, cen = cv2.connectedComponentsWithStats(cand.astype(np.uint8), connectivity=8)
        best = None
        for i in range(1, n):
            x, y, w, h, area = st[i]
            if not 6 <= area <= 400 or not 0.6 <= w / h <= 1.7 or area / (w * h) < 0.55:
                continue
            if best is None or area > best[0]:
                best = (area, cen[i][0] + 0.5, cen[i][1] + 0.5)
        if best is not None:
            if not in_event:
                in_event, frames = True, []
            quiet = 0
            frames.append((t, best[1] * W / GW, best[2] * H / GH))
            continue
        if not in_event:
            continue
        quiet += 1
        if quiet < 2:
            continue
        in_event = False
        if len(frames) < 2 or sync_end is None or frames[-1][0] - frames[0][0] > 0.35:
            frames = []
            continue
        mid = (frames[0][0] + frames[-1][0]) / 2
        q = (mid - sync_end - GAP - ON / 2) / STEP
        k = int(round(q))
        ev = frames[len(frames) // 2]
        frames = []
        if abs(q - round(q)) * STEP <= 0.08 and 0 <= k < 33:
            events.append((k, mid, ev[1], ev[2]))
    p.stdout.close()
    p.terminate()
    return events, syncs, fi


def world_ar(p):
    """舞台の世界(y 上、m)→ ARKit の仮の世界。"""
    c, s = np.cos(AR_THETA), np.sin(AR_THETA)
    R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return R @ np.asarray(p) + AR_T, R


def rays_for(events, st):
    """点の画素 → 仮の ARKit の世界のレイ。点ごとに新しい 3 本まで(アプリと同じ)。"""
    per: dict[int, list] = {}
    _, R = world_ar([0, 0, 0])
    fx = FX[st["lens"]] / 2.0
    for k, mid, u, v in events:
        msg = station_pose(tuple(st["pos"]), tuple(st["target"]), st["lens"], st["shake"], mid + st["offset"])
        T = np.array(msg["T"], np.float64).reshape(4, 4).T
        dc = np.array([(u - 960.0) / fx, -(v - 540.0) / fx, -1.0, 0.0])
        d = R @ (T @ dc)[:3]
        o = world_ar(T[:3, 3])[0]
        per.setdefault(k, []).append({"face": "A", "id": f"dot{k}", "dot": k, "origin": o.tolist(), "direction": (d / np.linalg.norm(d)).tolist()})
    return [r for rs in per.values() for r in rs[-3:]], len(per)


def visible_count(st, table):
    """その定位置の画角に入る点の数(計算)。"""
    msg = station_pose(tuple(st["pos"]), tuple(st["target"]), st["lens"], False, 0.0)
    T = np.array(msg["T"], np.float64).reshape(4, 4).T
    inv = np.linalg.inv(T)
    n, fx = 0, FX[st["lens"]]
    for c in table:
        x, y, z = c["stage_cm"]
        pc = inv @ np.array([x / 100, z / 100, y / 100, 1.0])
        if pc[2] < 0:
            u, v = -fx * pc[0] / pc[2], -fx * pc[1] / pc[2]
            n += int(abs(u) <= W4K / 2 and abs(v) <= H4K / 2)
    return n


def solve_wide(page, rays):
    page.reload()
    page.wait_for_function("window.__arShow && window.__arShow.ready", timeout=120000)
    page.evaluate("(r) => window.__arShow.host.onCalibration(r)", rays)
    return page.evaluate("({T: window.__arShow.T, align: window.__arShow.align})")


def centre_error_cm(T_list):
    """ページの解いた変換の舞台の中央の誤差。ページの LED の座標 = 舞台 (x+749.7, z-98, y)/100。"""
    M = np.array(T_list).reshape(4, 4).T
    x, y, z = STAGE_CENTRE_CM
    p_led = np.array([(x + 749.7) / 100, (z - 98) / 100, y / 100, 1.0])
    p_stage = np.array([x / 100, z / 100, y / 100])
    return float(np.linalg.norm((M @ p_led)[:3] - world_ar(p_stage)[0]) * 100)


def solve_ultra(st, video, table):
    found, syncs, n = find_dots(str(video))
    res = {"syncs": syncs, "dots": len(found)}
    if len(found) < 8:
        return res
    keys = sorted(found)
    P3 = stage_points(table, keys)
    P2 = np.array([np.mean(found[k], axis=0) for k in keys], np.float64)
    fx = FX["ultra"]
    K = np.array([[fx, 0, W4K / 2], [0, fx, H4K / 2], [0, 0, 1.0]])
    rv, tv, _, _, e, use = solve_pose(P3, P2, K)
    R, _ = cv2.Rodrigues(np.asarray(rv))
    cam = (-R.T @ np.asarray(tv)).ravel()
    truth = np.array([st["pos"][0], st["pos"][2], st["pos"][1]], np.float64) / 100
    msg = station_pose(tuple(st["pos"]), tuple(st["target"]), "ultra", False, 0.0)
    T = np.array(msg["T"], np.float64).reshape(4, 4).T
    Rtrue = np.linalg.inv(T[:3, :3] @ np.diag([1.0, -1.0, -1.0]))     # 世界 → OpenCV のカメラ
    ang = np.degrees(np.arccos(np.clip((np.trace(R @ Rtrue.T) - 1) / 2, -1, 1)))
    res.update({"used": int(use.sum()), "rms_px_4k": round(float(np.sqrt((e[use] ** 2).mean())), 2), "position_error_cm": round(float(np.linalg.norm(cam - truth) * 100), 1), "angle_error_deg": round(float(ang), 3)})
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    stations = json.loads((out / "dots_stations.json").read_text(encoding="utf-8"))
    table = dots()
    from playwright.sync_api import sync_playwright
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SITE))
    handler.log_message = lambda *x, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    rows = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome", headless=True, args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = b.new_page(viewport={"width": 800, "height": 500})
        page.goto(f"http://127.0.0.1:{PORT}/place/web/ar_show.html?dots=led3&dot_rms=4&track=/show/data/ar/dance_track&show_led=1")
        for st in stations:
            video = out / f"dots_{st['i']:02d}.mp4"
            row = {"name": st["name"], "lens": st["lens"], "visible": visible_count(st, table)}
            if st["lens"] == "ultra":
                row.update(solve_ultra(st, video, table))
            else:
                events, syncs, n = replay(video)
                rays, count = rays_for(events, st)
                row.update({"syncs": syncs, "dots": count, "rays": len(rays), "frames": n})
                if count >= 3:
                    r = solve_wide(page, rays)
                    row["align"] = r["align"]
                    row["centre_error_cm"] = round(centre_error_cm(r["T"]), 1) if r["T"] else None
            rows.append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
        b.close()
    srv.shutdown()
    (out / "dots_answers.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
