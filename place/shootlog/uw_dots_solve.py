"""超広角の固定カットの点の校正の確かめ: 録画した映像から緑の点を拾い(合図からの時間で番号を決める)、固定のカメラの位置を PnP で解く。

  python place/shootlog/uw_dots_solve.py --video <超広角.mov> --info <同じ名前.json> [--mon3]
--mon3: 点の位置をモニターに縮めた形(dot_calib_led.html)で扱う。なければ会場の舞台の座標(led_dots の表)。
出す物: 拾えた点の数、面ごとの再投影の誤差(4K の画素)、カメラの位置。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from make_led_dots_video import dots, GAP, ON, STEP  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--info", required=True)
    ap.add_argument("--mon3", action="store_true")
    a = ap.parse_args()
    info = json.loads(Path(a.info).read_text(encoding="utf-8"))
    fx, fy, cx, cy = info["K"]
    table = dots()
    W, H = 1920, 1080          # 拾うのはフル HD に縮めて(速さのため)。位置は 4K の画素に直す
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", a.video, "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    fs, fi = W * H * 3, 0
    fps = 30.0
    sync_end, in_sync, sync_start = None, False, 0.0
    in_ev, frames, quiet = False, [], 0
    found: dict[int, list] = {}
    base = None
    syncs = 0
    while True:
        buf = p.stdout.read(fs)
        if len(buf) < fs:
            break
        t = fi / fps
        fi += 1
        img = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.int16)
        b, g, r = img[..., 0], img[..., 1], img[..., 2]
        raw = ((g - np.maximum(b, r)) > 40) & (g > 60)
        if base is None:
            base = raw.astype(np.float32)
        m = raw & (base < 0.25)        # ずっと緑の物(ほかのモニターの画面など)は除く
        base = base * 0.97 + raw.astype(np.float32) * 0.03
        total = int(m.sum())
        if total > 0.08 * W * H:
            if not in_sync:
                sync_start = t
            in_sync = True
            in_ev = False
            frames = []
            continue
        if in_sync:
            in_sync = False
            if 0.25 <= t - sync_start <= 0.6:
                sync_end = t
                syncs += 1
        n, lab, st, cen = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
        best = None
        for i in range(1, n):
            x, y, w, h, area = st[i]
            if area < 6 or area > 6000 or not 0.4 < w / h < 2.5 or area / (w * h) < 0.5:
                continue
            if best is None or area > best[0]:
                best = (area, cen[i])
        if best is not None:
            if not in_ev:
                in_ev, frames = True, []
            quiet = 0
            frames.append((t, best[1][0] * 2, best[1][1] * 2))
            continue
        if not in_ev:
            continue
        quiet += 1
        if quiet < 2:
            continue
        in_ev = False
        if len(frames) < 2 or frames[-1][0] - frames[0][0] > 0.35 or sync_end is None:
            continue
        mid = (frames[0][0] + frames[-1][0]) / 2
        q = (mid - sync_end - GAP - ON / 2) / STEP
        k = int(round(q))
        if abs(q - round(q)) * STEP > 0.1 or not 0 <= k < len(table):
            continue
        found.setdefault(k, []).append((frames[len(frames) // 2][1], frames[len(frames) // 2][2]))
    p.stdout.close()
    p.terminate()
    print(f"コマ {fi}、合図 {syncs}、拾えた点 {len(found)}/{len(table)}")
    if len(found) < 6:
        raise SystemExit("点が少なくて解けない")
    P3, P2, faces = [], [], []
    PITCH = 1.2 / 5680
    for k, obs in sorted(found.items()):
        d = table[k]
        if a.mon3:
            P3.append([d["px"] * PITCH, (1240 - d["py"]) * PITCH, 0.0])
        else:
            X, Y, Z = d["stage_cm"]
            P3.append([X / 100, Z / 100, Y / 100])
        P2.append(np.mean(obs, axis=0))
        faces.append(d["face"])
    P3, P2 = np.array(P3, np.float64), np.array(P2, np.float64)
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.0]])
    ok, rv, tv, inl = cv2.solvePnPRansac(P3, P2, K, np.zeros(5), reprojectionError=25.0, flags=cv2.SOLVEPNP_ITERATIVE)
    pr, _ = cv2.projectPoints(P3, rv, tv, K, np.zeros(5))
    e = np.linalg.norm(pr.reshape(-1, 2) - P2, axis=1)
    per = {f: (round(float(np.sqrt((e[[i for i, x in enumerate(faces) if x == f]] ** 2).mean())), 1), faces.count(f)) for f in sorted(set(faces))}
    R, _ = cv2.Rodrigues(rv)
    cam = (-R.T @ tv).ravel()
    print(json.dumps({"inliers": 0 if inl is None else len(inl), "rms_px_4k": round(float(np.sqrt((e ** 2).mean())), 1), "p95_px_4k": round(float(np.percentile(e, 95)), 1), "面ごと(rms, 点の数)": per, "カメラの位置 m": [round(float(v), 2) for v in cam]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
