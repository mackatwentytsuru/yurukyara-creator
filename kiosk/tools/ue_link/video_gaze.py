"""録画(動画ファイル)の人を、UE のキャラの目と首で追わせる・視線の校正を、答えの分かる形で確かめる道具(カメラなし・手元だけ)。
  make : 床のカメラから見た「動く客の顔」の録画を作る(CG の顔 1 枚を、世界の位置から決めた画素・大きさで貼る)。正解の位置を横に書く。
         python video_gaze.py make --face <顔の絵> --out rec.mp4 [--seconds 40] [--geometry true.json]
  play : 録画を実時間で流し、検出 → 視線の橋(v1)→ UDP 5321(UE の sampleGazeDirector)へ送る。毎コマの向きと正解の差を記録する。
         python video_gaze.py play --file rec.mp4 [--geometry nominal.json] [--port 5321] [--log play.jsonl]
  calib: 仮想の客を床の数点に立たせ、各点のカメラの絵(同じ幾何で作った合成の絵)を検出 → 「自分を見ている」と感じる向き
         (= 本当の向き + 人のばらつき 1.5 度)を点にして gaze_calib.fit → 校正に使わない位置で、校正前後の誤差(度)を出す。
         python video_gaze.py calib --face <顔の絵> [--points 6] [--out calib.json]
限界: 顔の絵は CG の 1 種類(本物の人・暗さ・逆光ではない)。合成の絵はカメラのレンズのゆがみ・ぶれを含まない。
"""
from __future__ import annotations

import argparse
import json
import math
import socket
import statistics
import sys
import time
from dataclasses import replace
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "eye_camera"))
from detect import FaceDetector, FaceTracker  # noqa: E402
from gaze_bridge import GazeBridge, Geometry, gaze_angles, pixel_to_world, world_to_pixel  # noqa: E402
from gaze_calib import fit, save  # noqa: E402
from latency import DARK, crop_face  # noqa: E402

W, H, FPS = 1920, 1080, 15  # 実機のカメラ(1080p・15 fps)に合わせる

# 本当の幾何(店で測っていない「現地の値」の役)と、仮の初期値(図面からの見込み)。LED の面を z=0、床を y=0、客は +z。
TRUE = Geometry(width=W, height=H, cam_pos=(0.0, 0.05, 0.12), cam_pitch_deg=33.0, eye_pos=(0.04, 1.42, -0.05), ipd_m=0.0645)
NOMINAL = Geometry(width=W, height=H, cam_pos=(0.0, 0.05, 0.12), cam_pitch_deg=40.0, eye_pos=(0.0, 1.20, 0.0), ipd_m=0.0621)


def load_geo(path: str, default: Geometry) -> Geometry:
    if not path:
        return replace(default)
    g = Geometry.load(path)
    g.width, g.height = W, H
    return g


class FaceSprite:
    def __init__(self, face_path: str):
        base = FaceDetector()
        self.face = crop_face(base, face_path)
        r = base.detect(self.face)
        if not r["found"]:
            raise SystemExit("顔の絵から目が見つかりません")
        self.ipd = r["ipd_px"]
        self.eye = (r["eye_x"] * self.face.shape[1], r["eye_y"] * self.face.shape[0])

    def frame(self, g: Geometry, p: np.ndarray, ipd_m: float | None = None) -> np.ndarray:
        """世界の位置 p(客の目の中点)の客を、カメラ g から見た 1 コマ"""
        gg = replace(g, ipd_m=ipd_m) if ipd_m else g
        u, v, ipd_px = world_to_pixel(gg, p)
        s = ipd_px / self.ipd
        fw, fh = max(8, int(self.face.shape[1] * s)), max(8, int(self.face.shape[0] * s))
        out = np.full((H, W, 3), DARK, np.uint8)
        ff = cv2.resize(self.face, (fw, fh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
        x0, y0 = int(round(u - self.eye[0] * s)), int(round(v - self.eye[1] * s))
        sx0, sy0 = max(0, -x0), max(0, -y0)
        x0c, y0c, x1c, y1c = max(0, x0), max(0, y0), min(W, x0 + fw), min(H, y0 + fh)
        if x1c > x0c and y1c > y0c:
            out[y0c:y1c, x0c:x1c] = ff[sy0:sy0 + (y1c - y0c), sx0:sx0 + (x1c - x0c)]
        return out


def guest_path(t: float, T: float) -> np.ndarray:
    """録画の客の目の位置(m): 扉の方(奥 3.2 m)から近づき、左右に動いて、また離れる。目の高さ 1.55〜1.70 m"""
    ph = t / T
    z = 3.2 - 2.0 * math.sin(math.pi * ph)  # 3.2 → 1.2 → 3.2
    x = 0.75 * math.sin(2 * math.pi * ph * 1.5)
    y = 1.62 + 0.06 * math.sin(t * 0.9)
    return np.array([x, y, z])


def cmd_make(a) -> None:
    g = load_geo(a.geometry, TRUE)
    sp = FaceSprite(a.face)
    n = int(a.seconds * FPS)
    vw = cv2.VideoWriter(a.out, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    truth = []
    for i in range(n):
        p = guest_path(i / FPS, a.seconds)
        vw.write(sp.frame(g, p))
        truth.append([round(float(x), 4) for x in p])
    vw.release()
    Path(a.out + ".truth.json").write_text(json.dumps({"fps": FPS, "geometry": "true" if not a.geometry else a.geometry, "eye_m": truth}), encoding="utf-8")
    print(json.dumps({"out": a.out, "frames": n, "seconds": a.seconds}, ensure_ascii=False))


def cmd_play(a) -> None:
    g = load_geo(a.geometry, NOMINAL)
    tg = TRUE
    tpath = Path(a.file + ".truth.json")
    truth = json.loads(tpath.read_text(encoding="utf-8"))["eye_m"] if tpath.exists() else None
    cap = cv2.VideoCapture(a.file)
    fps = cap.get(cv2.CAP_PROP_FPS) or FPS
    det = FaceTracker(FaceDetector())
    bridge = GazeBridge(g=g, sink=("127.0.0.1", a.port), packet="v1")
    log = open(a.log, "w", encoding="utf-8") if a.log else None
    t0 = time.perf_counter()
    start_unix_ms = int(time.time() * 1000)
    i, errs, found = 0, [], 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        target = t0 + i / fps
        now = time.perf_counter()
        if now < target:
            time.sleep(target - now)
        r = det.detect(frame)
        now = time.perf_counter()
        msg = bridge.update(now, r)
        row = {"i": i, "t": round(now - t0, 3), "found": bool(r.get("found"))}
        if msg.get("found"):
            row.update(az=msg["yaw_deg"], el=msg["pitch_deg"])
        if truth and i < len(truth):
            ty, tp = gaze_angles(tg.eye_pos, truth[i])
            row.update(true_az=round(ty, 2), true_el=round(tp, 2))
            if msg.get("found"):
                errs.append(math.hypot(msg["yaw_deg"] - ty, msg["pitch_deg"] - tp))
        found += bool(r.get("found"))
        if log:
            log.write(json.dumps(row) + "\n")
        i += 1
    for _ in range(int(fps)):  # 終わったら「いない」を送る
        bridge.update(time.perf_counter() + 10, {"found": False})
    res = {"start_unix_ms": start_unix_ms, "frames": i, "found_rate": round(found / i, 3) if i else None,
           "err_deg_median": round(statistics.median(errs), 2) if errs else None,
           "geometry": a.geometry or "nominal"}
    print(json.dumps(res, ensure_ascii=False))


def measure(sp: FaceSprite, g_true: Geometry, p: np.ndarray, ipd_m: float, det: FaceDetector) -> dict | None:
    """仮想の客を p に立たせたカメラの絵を作って検出(画素・目の間隔)"""
    fr = sp.frame(g_true, p, ipd_m=ipd_m)
    tr = FaceTracker(det)
    for _ in range(4):  # 小さい顔は、小窓の探索(数コマに 1 回)で見つかる。同じ絵を数回渡す
        r = tr.detect(fr)
        if r.get("found"):
            break
    if not r.get("found"):
        return None
    return {"u": r["eye_x"] * W, "v": r["eye_y"] * H, "ipd_px": r["ipd_px"]}


def err_deg(g: Geometry, m: dict, g_true: Geometry, p: np.ndarray) -> float:
    est = pixel_to_world(g, m["u"], m["v"], m["ipd_px"])
    ey, ep = gaze_angles(g.eye_pos, est)
    ty, tp = gaze_angles(g_true.eye_pos, p)
    return math.hypot(ey - ty, ep - tp)


CAL_SPOTS = [(0.0, 2.0), (-0.7, 1.6), (0.7, 1.6), (-0.8, 3.0), (0.8, 3.0), (0.0, 2.7)]  # (横 m, 奥 m)。床の 6 点
TEST_SPOTS = [(x, z) for z in (1.4, 1.9, 2.4, 2.9, 3.4) for x in (-0.9, -0.45, 0.0, 0.45, 0.9)]  # 校正に使わない 25 点


def cmd_calib(a) -> None:
    rng = np.random.default_rng(a.seed)
    sp = FaceSprite(a.face)
    det = FaceDetector()
    gt, g0 = replace(TRUE), replace(NOMINAL)
    cal_eye_h, cal_ipd = 1.66, gt.ipd_m  # 校正する人(本人の役)の目の高さと目の間隔
    pts = []
    for x, z in CAL_SPOTS[: a.points]:
        p = np.array([x, cal_eye_h, z])
        m = measure(sp, gt, p, cal_ipd, det)
        if not m:
            continue
        ty, tp = gaze_angles(gt.eye_pos, p)
        pts.append({**m, "yaw_deg": ty + rng.normal(0, 1.5), "pitch_deg": tp + rng.normal(0, 1.5), "spot": [x, cal_eye_h, z]})
    g1, rep = fit(pts, g0)
    before, after = [], []
    for x, z in TEST_SPOTS:  # 別の客: 目の高さ 1.45〜1.80 m・目の間隔は個人差 ±6%
        h = float(rng.uniform(1.45, 1.80))
        ipd = gt.ipd_m * float(1 + rng.normal(0, 0.06))
        p = np.array([x, h, z])
        m = measure(sp, gt, p, ipd, det)
        if not m:
            continue
        before.append(err_deg(g0, m, gt, p))
        after.append(err_deg(g1, m, gt, p))
    q = lambda xs, pr: float(np.percentile(xs, pr)) if xs else None  # noqa: E731
    res = {
        "image_source": "合成の絵(UE の SceneCapture ではなく、同じ幾何で CG の顔を貼った絵)",
        "calib_points": len(pts), "test_points": len(before),
        "before_median_deg": round(statistics.median(before), 2), "before_p90_deg": round(q(before, 90), 2),
        "after_median_deg": round(statistics.median(after), 2), "after_p90_deg": round(q(after, 90), 2),
        "fit": rep, "true": {"cam_pitch_deg": gt.cam_pitch_deg, "eye_pos": gt.eye_pos, "ipd_m": gt.ipd_m},
        "nominal": {"cam_pitch_deg": g0.cam_pitch_deg, "eye_pos": g0.eye_pos, "ipd_m": g0.ipd_m},
        "points": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in pt.items()} for pt in pts],
    }
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if a.out:
        Path(a.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
        save(g1, str(Path(a.out).with_suffix(".geometry.json")))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("make")
    m.add_argument("--face", required=True)
    m.add_argument("--out", required=True)
    m.add_argument("--seconds", type=float, default=40)
    m.add_argument("--geometry", default="")
    p = sub.add_parser("play")
    p.add_argument("--file", required=True)
    p.add_argument("--geometry", default="")
    p.add_argument("--port", type=int, default=5321)
    p.add_argument("--log", default="")
    c = sub.add_parser("calib")
    c.add_argument("--face", required=True)
    c.add_argument("--points", type=int, default=6)
    c.add_argument("--seed", type=int, default=5)
    c.add_argument("--out", default="")
    a = ap.parse_args()
    {"make": cmd_make, "play": cmd_play, "calib": cmd_calib}[a.cmd](a)


if __name__ == "__main__":
    main()
