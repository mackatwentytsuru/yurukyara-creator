"""合成の「a7 + iPhone を台に付けて LED の盤を撮った」データで、rig_offset と export_a7_ue を通しで確かめる。

  python place/shootlog/rig_selftest.py [--out <作業フォルダ>]
真のずれ(a7 は iPhone の 9 cm 下、向きが少しずれ)、a7 は歪みあり(1280×720)、iPhone は歪みなし(960×540、ARKit の記録に雑音)、
時刻合わせに 12 ms の誤差、止まっている所が 8 か所。出てきたずれ・LED の位置・UE のカメラ位置を真の値と比べる。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial.transform import Rotation as Rot, Slerp

from lenslib import Board
from shootlib import apply, invert_rigid, led_to_ue_matrix, rot_y, ue_camera_row

ARKIT_FROM_CV = np.diag([1.0, -1.0, -1.0, 1.0])
KA = np.array([[1000.0, 0, 640.0], [0, 1000.0, 360.0], [0, 0, 1.0]])
DA = np.array([-0.12, 0.05, 0.0008, -0.0005, -0.01])
SA = (1280, 720)
KI = np.array([[800.0, 0, 480.0], [0, 800.0, 270.0], [0, 0, 1.0]])
SI = (960, 540)
ALPHA, BETA = 1.0001, 1.237          # t_a = ALPHA * t_b + BETA
FPS_A = 29.97


def cv_pose_look_at(eye, target):
    """LED の座標での OpenCV 流のカメラの姿勢 4x4(カメラ→LED)。"""
    eye, target = np.asarray(eye, float), np.asarray(target, float)
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1.0, 0])
    r /= np.linalg.norm(r)
    d = np.cross(f, r)
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = r, d, f, eye
    return T


def render(board_img, board: Board, T_led_from_cv, K, dist, size, cache):
    w, h = size
    key = (w, h)
    if key not in cache:
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        pts = np.stack([xs.ravel(), ys.ravel()], axis=1).reshape(-1, 1, 2)
        cache[key] = cv2.undistortPoints(pts, K, dist).reshape(-1, 2)
    norm = cache[key]
    rays_cam = np.concatenate([norm, np.ones((len(norm), 1))], axis=1)
    rays_w = rays_cam @ T_led_from_cv[:3, :3].T
    origin = T_led_from_cv[:3, 3]
    s = -origin[2] / rays_w[:, 2]
    hit = origin + rays_w * s[:, None]
    mx = (hit[:, 0] / board.pitch_m).reshape(h, w).astype(np.float32)
    my = (board.face_px[1] - hit[:, 1] / board.pitch_m).reshape(h, w).astype(np.float32)
    img = cv2.remap(board_img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    img[(s.reshape(h, w) <= 0)] = 0
    return img


def pose_at(stops, t, still=2.0, move=0.7):
    """a の時計 t での、a7 の姿勢(CV 流、カメラ→LED)。止まる 2 秒と動く 0.7 秒の繰り返し。"""
    period = still + move
    k = int(t // period)
    k = min(k, len(stops) - 1)
    local = t - k * period
    if local <= still or k == len(stops) - 1:
        return stops[k]
    u = (local - still) / move
    u = u * u * (3 - 2 * u)
    A, B = stops[k], stops[k + 1]
    R = Slerp([0, 1], Rot.from_matrix([A[:3, :3], B[:3, :3]]))(u).as_matrix()
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = A[:3, 3] * (1 - u) + B[:3, 3] * u
    return T


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path.home() / "AppData/Local/Temp/rig_selftest"))
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    here = Path(__file__).resolve().parent
    rng = np.random.default_rng(11)

    subprocess.run([sys.executable, str(here / "make_led_board.py"), "--face-px", "1280", "1240", "--square-px", "160", "--out-dir", str(out)], check=True)
    board = Board.load(out / "board_A.json")
    board_img = cv2.imread(str(out / "led_board_A.png"), cv2.IMREAD_GRAYSCALE)

    # 真の値
    T_world_from_led = np.eye(4)
    T_world_from_led[:3, :3] = rot_y(np.radians(40))
    T_world_from_led[:3, 3] = [1.0, 0.05, -2.0]
    T_led_from_world = invert_rigid(T_world_from_led)
    R_off = Rot.from_euler("yxz", [1.5, 0.8, -0.5], degrees=True).as_matrix()
    T_iph_from_a7 = np.eye(4)
    T_iph_from_a7[:3, :3], T_iph_from_a7[:3, 3] = R_off, [0.004, -0.09, 0.02]

    centre = np.array([2.56, 2.0, 0.0])
    stops = []
    for k in range(8):
        eye = centre + np.array([rng.uniform(-1.2, 1.2), rng.uniform(-0.4, 0.6), rng.uniform(4.0, 5.5)])
        target = centre + np.array([rng.uniform(-0.8, 0.8), rng.uniform(-0.6, 0.6), 0.0])
        stops.append(cv_pose_look_at(eye, target))
    duration = 8 * 2.7

    cache = {}
    # a7 の動画
    vw = cv2.VideoWriter(str(out / "a7.avi"), cv2.VideoWriter_fourcc(*"MJPG"), FPS_A, SA)
    n_a = int(duration * FPS_A)
    for i in range(n_a):
        T = pose_at(stops, i / FPS_A)
        vw.write(cv2.cvtColor(render(board_img, board, T, KA, DA, SA, cache), cv2.COLOR_GRAY2BGR))
    vw.release()

    # iPhone の動画と記録(b の時計。コマ間隔に揺れ)
    tb = np.cumsum(np.concatenate([[0.0], 1 / 30 + rng.normal(0, 0.003, int(duration * 31))]))
    tb = tb[(ALPHA * tb + BETA) < duration]
    shoot = out / "shoot"
    shoot.mkdir(exist_ok=True)
    vw = cv2.VideoWriter(str(shoot / "video.mov"), cv2.VideoWriter_fourcc(*"MJPG"), 30, SI)
    frames = []
    drift = np.zeros(3)
    for i, t in enumerate(tb):
        T_a7 = pose_at(stops, ALPHA * t + BETA)                       # CV 流のカメラ→LED
        T_led_a7_ark = T_a7 @ ARKIT_FROM_CV
        T_led_iph_ark = T_led_a7_ark @ invert_rigid(T_iph_from_a7)
        T_cv_iph = T_led_iph_ark @ ARKIT_FROM_CV
        vw.write(cv2.cvtColor(render(board_img, board, T_cv_iph, KI, np.zeros(5), SI, cache), cv2.COLOR_GRAY2BGR))
        drift += rng.normal(0, 0.0002, 3)                               # ARKit のゆっくりしたずれ
        T_w = T_world_from_led @ T_led_iph_ark
        T_w[:3, 3] += drift + rng.normal(0, 0.0005, 3)
        T_w[:3, :3] = Rot.from_rotvec(rng.normal(0, np.radians(0.03), 3)).as_matrix() @ T_w[:3, :3]
        frames.append({"i": i, "t": 1000 + t, "pts": float(t), "T": [float(v) for v in T_w.T.reshape(-1)],
                       "K": [KI[0, 0], KI[1, 1], KI[0, 2], KI[1, 2]], "track": "normal", "ok": True, "exp": 0.01})
    vw.release()
    (shoot / "frames.jsonl").write_text("\n".join(json.dumps(f) for f in frames) + "\n", encoding="utf-8")
    (shoot / "meta.json").write_text(json.dumps({"videoFile": "video.mov", "stats": {"width": SI[0], "height": SI[1], "frames": len(frames)}}), encoding="utf-8")

    lens = {"image_size": list(SA), "fx": 1000.0, "fy": 1000.0, "cx": 640.0, "cy": 360.0,
            "distortion_opencv": {"k1": DA[0], "k2": DA[1], "p1": DA[2], "p2": DA[3], "k3": DA[4]}}
    (out / "lens.json").write_text(json.dumps(lens), encoding="utf-8")
    sync = {"alpha": ALPHA, "beta": BETA + 0.012}                          # 時刻合わせの誤差 12 ms
    (out / "sync.json").write_text(json.dumps(sync), encoding="utf-8")

    subprocess.run([sys.executable, str(here / "rig_offset.py"), "--a7-video", str(out / "a7.avi"), "--lens", str(out / "lens.json"),
                    "--iphone-shoot", str(shoot), "--board", str(out / "board_A.json"), "--sync", str(out / "sync.json"),
                    "--out-dir", str(out / "rig"), "--every", "3"], check=True)
    rig = json.loads((out / "rig" / "rig_offset.json").read_text(encoding="utf-8"))
    M = np.array(rig["T_iphone_from_a7"])
    dt_mm = np.linalg.norm(M[:3, 3] - T_iph_from_a7[:3, 3]) * 1000
    dr_deg = np.degrees(np.linalg.norm(Rot.from_matrix(M[:3, :3].T @ T_iph_from_a7[:3, :3]).as_rotvec()))
    print(f"ずれの誤差: 位置 {dt_mm:.1f} mm、向き {dr_deg:.3f}°(真のずれは 9 cm と約 1.8°)")

    al = json.loads((out / "rig" / "alignment_board.json").read_text(encoding="utf-8"))
    W = np.array(al["T_led_from_world"])
    dw_cm = np.linalg.norm(W[:3, 3] - T_led_from_world[:3, 3]) * 100
    dwr = np.degrees(np.linalg.norm(Rot.from_matrix(W[:3, :3].T @ T_led_from_world[:3, :3]).as_rotvec()))
    print(f"盤から求めた LED の位置の誤差: {dw_cm:.2f} cm、向き {dwr:.3f}°(ARKit のゆっくりしたずれを含む)")

    # UE への書き出し: a7 の真の位置と比べる
    csv_path = out / "track_ue.csv"
    ue_origin, ue_yaw = [1000.0, -500.0, 0.0], 30.0
    subprocess.run([sys.executable, str(here / "export_a7_ue.py"), "--iphone-shoot", str(shoot), "--alignment", str(out / "rig" / "alignment_board.json"),
                    "--rig", str(out / "rig" / "rig_offset.json"), "--lens", str(out / "lens.json"), "--sync", str(out / "sync.json"),
                    "--a7-fps", str(FPS_A), "--a7-frames", str(n_a), "--ue-origin", *map(str, ue_origin), "--ue-yaw", str(ue_yaw),
                    "--out", str(csv_path)], check=True)
    import csv
    rows = list(csv.DictReader(open(csv_path, encoding="utf-8")))
    led_to_ue = led_to_ue_matrix(ue_origin, ue_yaw)
    errs, errs_still = [], []
    for r in rows:
        i = int(r["frame"])
        t = i / FPS_A
        T_true = pose_at(stops, t) @ ARKIT_FROM_CV
        truth = ue_camera_row(T_true, [1000, 1000, 640, 360], SA[0], SA[1], led_to_ue)
        e = np.linalg.norm([float(r["ue_x_cm"]) - truth["ue_x_cm"], float(r["ue_y_cm"]) - truth["ue_y_cm"], float(r["ue_z_cm"]) - truth["ue_z_cm"]])
        errs.append(e)
        if (t % 2.7) < 2.0:
            errs_still.append(e)
    print(f"UE のカメラ位置の誤差(a7 の全コマ): 平均 {np.mean(errs):.2f} cm、止まっている間 {np.mean(errs_still):.2f} cm、最大 {np.max(errs):.2f} cm")
    ok = dt_mm < 15 and dr_deg < 0.3 and np.mean(errs_still) < 3.0
    print("合格" if ok else "不合格")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
