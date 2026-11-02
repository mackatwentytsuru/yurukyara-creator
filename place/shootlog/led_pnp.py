"""保険: 三脚などで固定して撮った動画から、LED の 4 隅を使ってカメラの位置と向きを計算で出す(solvePnP)。
ARKit の追跡が切れた撮影や、iPhone 以外のカメラの映像のとき、こちらで UE のカメラ位置を作る。

  python place/shootlog/led_pnp.py --video <動画> --led-size <横m> <縦m> \\
      --corners "tl=x,y tr=x,y br=x,y bl=x,y" (最初のコマでの画素。左上から。LED の角)
      [--shoot <撮影フォルダ>]            … 撮影記録の frames.jsonl の K(画角)を使う
      [--focal-px <f> | --hfov-deg <度>]   … 撮影記録が無いとき(焦点距離が分からなければ 35mm 換算の焦点距離から: --focal-mm35 <mm>)
      [--ue-origin X Y Z --ue-yaw 度]       … UE の座標でも書く(export_ue.py と同じ約束)
      [--out camera_track_pnp.csv] [--debug-dir <点検の絵を出すフォルダ>]

LED の角は、最初のコマで人が指定し、あとのコマは Lucas–Kanade で追う。四角が平面なので IPPE で解き、
前のコマに近いほうの解を選ぶ(カメラは客席側 = LED の z>0 にいる)。角を見失ったコマは ok=false。
角が画面から外れる、LED の表示が角ごとに大きく変わる、などで追いきれないときは --reseed-every で人が指定し直す。
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import cv2
import numpy as np

from shootlib import CORNER_IDS, intrinsics_to_fov_deg, invert_rigid, led_corners, led_to_ue_matrix, load_shoot, ue_camera_row

ARKIT_FROM_CV = np.diag([1.0, -1.0, -1.0, 1.0])   # OpenCV のカメラ(y 下・z 前)→ ARKit 流(y 上・z 後ろ)


def parse_corners(text: str) -> np.ndarray:
    d = {}
    for tok in text.split():
        k, v = tok.split("=")
        x, y = v.split(",")
        d[k] = (float(x), float(y))
    return np.array([d[k] for k in CORNER_IDS], dtype=np.float32)


def solve_frame(obj, img_pts, K, prev_T=None):
    n, rvecs, tvecs, errs = cv2.solvePnPGeneric(obj.astype(np.float64), img_pts.astype(np.float64), K, None, flags=cv2.SOLVEPNP_IPPE)
    best = None
    for r, t, e in zip(rvecs, tvecs, errs):
        R, _ = cv2.Rodrigues(r)
        M = np.eye(4)
        M[:3, :3], M[:3, 3] = R, t.ravel()
        T_led_from_cv = invert_rigid(M)
        if T_led_from_cv[2, 3] <= 0:        # カメラは LED の客席側(z>0)
            continue
        T = T_led_from_cv @ ARKIT_FROM_CV
        err = float(np.ravel(e)[0])
        score = err if prev_T is None else float(np.linalg.norm(T[:3, 3] - prev_T[:3, 3])) + 0.01 * err
        if best is None or score < best[0]:
            best = (score, T, err)
    return None if best is None else (best[1], best[2])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--led-size", nargs=2, type=float, required=True, metavar=("W_M", "H_M"))
    ap.add_argument("--corners", required=True)
    ap.add_argument("--shoot", default=None)
    ap.add_argument("--focal-px", type=float)
    ap.add_argument("--hfov-deg", type=float)
    ap.add_argument("--focal-mm35", type=float)
    ap.add_argument("--ue-origin", nargs=3, type=float)
    ap.add_argument("--ue-yaw", type=float)
    ap.add_argument("--reseed-file", default=None, help='JSON {"コマ番号": "tl=x,y tr=x,y br=x,y bl=x,y"}。そのコマで角を指定し直す(追いきれなくなる前に)')
    ap.add_argument("--out", default="camera_track_pnp.csv")
    ap.add_argument("--debug-dir", default=None)
    ap.add_argument("--max-frames", type=int, default=None)
    a = ap.parse_args()

    cap = cv2.VideoCapture(a.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    shoot = load_shoot(a.shoot) if a.shoot else None

    def K_for(i):
        if shoot and i < len(shoot.frames):
            return shoot.frames[i]["K"]
        if a.focal_px:
            f = a.focal_px
        elif a.hfov_deg:
            f = (W / 2) / np.tan(np.radians(a.hfov_deg) / 2)
        elif a.focal_mm35:
            f = a.focal_mm35 * W / 36.0
        else:
            raise SystemExit("画角が分からない: --shoot か --focal-px か --hfov-deg か --focal-mm35 のどれかを指定する")
        return [f, f, W / 2, H / 2]

    w, h = a.led_size
    led = led_corners(w, h)
    obj = np.array([led[k] for k in CORNER_IDS], dtype=np.float32)
    led_to_ue = led_to_ue_matrix(a.ue_origin, a.ue_yaw) if a.ue_origin and a.ue_yaw is not None else None
    if a.debug_dir:
        Path(a.debug_dir).mkdir(parents=True, exist_ok=True)

    pts = parse_corners(a.corners).reshape(-1, 1, 2)
    reseed = {int(k): parse_corners(v).reshape(-1, 1, 2) for k, v in json.loads(Path(a.reseed_file).read_text(encoding="utf-8")).items()} if a.reseed_file else {}
    prev_gray = None
    prev_T = None
    rows = []
    cols = ["frame", "time_s", "led_x_m", "led_y_m", "led_z_m", "hfov_deg", "focal_mm_35", "reproj_px", "ok"]
    if led_to_ue is not None:
        cols += ["ue_x_cm", "ue_y_cm", "ue_z_cm", "ue_pitch_deg", "ue_yaw_deg", "ue_roll_deg"]
    i = 0
    lk = dict(winSize=(61, 61), maxLevel=5, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))
    while True:
        ok_read, img = cap.read()
        if not ok_read or (a.max_frames and i >= a.max_frames):
            break
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        ok = True
        if prev_gray is not None:
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev_gray, gray, pts, None, **lk)
            back, st2, _ = cv2.calcOpticalFlowPyrLK(gray, prev_gray, nxt, None, **lk)
            good = (st.ravel() == 1) & (st2.ravel() == 1) & (np.linalg.norm((back - pts).reshape(-1, 2), axis=1) < 3.0)
            ok = bool(good.all())
            pts = nxt if ok else pts   # 見失ったら前の位置のまま(ok=false)
        if i in reseed:
            pts = reseed[i].astype(np.float32)
            ok = True
        K4 = K_for(i)
        K = np.array([[K4[0], 0, K4[2]], [0, K4[1], K4[3]], [0, 0, 1.0]])
        res = solve_frame(obj, pts.reshape(-1, 2), K, prev_T)
        reproj = None
        if res is not None:
            T, reproj = res
            prev_T = T
        elif prev_T is not None:
            T = prev_T
            ok = False
        else:
            raise SystemExit("最初のコマで LED の向きが決まらない(角の指定の順番と位置を確かめる)")
        hfov, _ = intrinsics_to_fov_deg(K4, W, H)
        row = [i, f"{i / fps:.4f}", *[f"{v:.4f}" for v in T[:3, 3]], f"{hfov:.3f}", f"{K4[0] * 36.0 / W:.2f}",
               "" if reproj is None else f"{reproj:.3f}", str(ok).lower()]
        if led_to_ue is not None:
            u = ue_camera_row(T, K4, W, H, led_to_ue)
            row += [f"{u[c]:.4f}" for c in cols[9:]]
        rows.append(row)
        if a.debug_dir and i % 30 == 0:
            vis = img.copy()
            for p in pts.reshape(-1, 2):
                cv2.circle(vis, (int(p[0]), int(p[1])), 14, (0, 255, 255) if ok else (0, 0, 255), 3)
            cv2.imwrite(str(Path(a.debug_dir) / f"pnp_{i:05d}.jpg"), cv2.resize(vis, (1280, int(H * 1280 / W))))
        prev_gray = gray
        i += 1
    cap.release()
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(cols)
        wr.writerows(rows)
    lost = sum(1 for r in rows if r[8] == "false")
    print(f"書いた: {a.out}({len(rows)} コマ、追いきれなかったコマ {lost})")


if __name__ == "__main__":
    main()
