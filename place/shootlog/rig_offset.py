"""a7 と iPhone を同じ台に付けたときの、固定のずれ(位置と向き)を測る。あわせて、盤から LED の位置(ARKit の世界での)も出す。

  python place/shootlog/rig_offset.py --a7-video <a7 の動画> --lens lens.json --iphone-shoot <撮影フォルダ> --board board_A.json --sync sync.json --out-dir <出力> [--every 5]

手順(本人 1 人で): LED の面に盤(make_led_board.py の画像)を出し、台に付けた 2 台で同時に撮りながら、
盤が見える 5〜8 か所で 2 秒ずつ止まる(位置も向きも少しずつ変える)。止まっている所だけを使うので、時刻合わせの誤差が効かない。
やっていること: 2 台それぞれの映像で盤を見つけて、盤(= LED の座標)から見たカメラの姿勢を PnP で出し、
  T(iPhone→a7) = inv(T_LED←iPhone) · T_LED←a7  を止まっている所ごとに出して、中央値と平均の向きにまとめる。
出力: rig_offset.json(T_iphone_from_a7 = a7 のカメラを iPhone のカメラの座標で。ARKit 流の軸 = +x 右・+y 上・−z 前、m)、
      alignment_board.json(ARKit の世界 → LED。盤から求めた版。align_led.py の角のタップの版より正確になるはず)。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial.transform import Rotation as Rot, Slerp

from lenslib import Board, detect_corners
from shootlib import invert_rigid, load_shoot, mat4

ARKIT_FROM_CV = np.diag([1.0, -1.0, -1.0, 1.0])


def pose_from_board(gray, board: Board, K, dist, min_corners=12, max_rms=2.5):
    """盤の画像 → ARKit 流の軸で、LED の座標でのカメラの姿勢 4x4。見つからない・合わないときは None。"""
    r = detect_corners(gray, board, min_corners)
    if r is None:
        return None
    corners, ids = r
    obj = board.corner_led_m(ids)
    ok, rvec, tvec = cv2.solvePnP(obj, corners.reshape(-1, 1, 2), K, dist, flags=cv2.SOLVEPNP_ITERATIVE)
    if not ok:
        return None
    proj, _ = cv2.projectPoints(obj, rvec, tvec, K, dist)
    rms = float(np.sqrt(np.mean(np.sum((proj.reshape(-1, 2) - corners) ** 2, axis=1))))
    if rms > max_rms:
        return None
    Rm, _ = cv2.Rodrigues(rvec)
    M = np.eye(4)
    M[:3, :3], M[:3, 3] = Rm, tvec.ravel()
    return invert_rigid(M) @ ARKIT_FROM_CV


def interp_pose(frames, pts, t):
    """iPhone の記録から時刻 t(pts の秒)の姿勢を補間する。戻り: (4x4, ok, 隣のコマとの間隔 s)。"""
    i = int(np.searchsorted(pts, t))
    i0, i1 = max(0, min(i - 1, len(pts) - 1)), min(i, len(pts) - 1)
    if i0 == i1:
        return mat4(frames[i0]["T"]), frames[i0]["ok"], 0.0
    T0, T1 = mat4(frames[i0]["T"]), mat4(frames[i1]["T"])
    u = (t - pts[i0]) / max(pts[i1] - pts[i0], 1e-9)
    rots = Rot.from_matrix([T0[:3, :3], T1[:3, :3]])
    R = Slerp([0, 1], rots)(min(max(u, 0), 1)).as_matrix()
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = T0[:3, 3] * (1 - u) + T1[:3, 3] * u
    return T, bool(frames[i0]["ok"] and frames[i1]["ok"]), float(pts[i1] - pts[i0])


def is_still(frames, pts, t, half=0.15, max_move_m=0.02, max_rot_deg=1.5):
    lo, hi = np.searchsorted(pts, t - half), np.searchsorted(pts, t + half)
    if hi - lo < 3:
        return False
    Ts = [mat4(frames[i]["T"]) for i in range(lo, hi)]
    pos = np.array([T[:3, 3] for T in Ts])
    rots = Rot.from_matrix([T[:3, :3] for T in Ts])
    rel = (rots[0].inv() * rots).magnitude()
    return bool(np.ptp(pos, axis=0).max() < max_move_m and np.degrees(rel).max() < max_rot_deg and all(frames[i]["ok"] for i in range(lo, hi)))


def average_rotations(Rs):
    return Rot.from_matrix(np.array(Rs)).mean().as_matrix()


def summarize(Ts):
    """4x4 の列 → (中央値の平行移動 + 平均の向きの 4x4, 平行移動のばらつき mm(軸ごとの MAD 由来)、向きのばらつき度(中央値, 95%))。"""
    A = np.array(Ts)
    t = np.median(A[:, :3, 3], axis=0)
    mad = np.median(np.abs(A[:, :3, 3] - t), axis=0) * 1.4826
    Rm = average_rotations(A[:, :3, :3])
    dev = np.degrees([np.linalg.norm(Rot.from_matrix(Rm.T @ T[:3, :3]).as_rotvec()) for T in A])
    M = np.eye(4)
    M[:3, :3], M[:3, 3] = Rm, t
    return M, mad * 1000, (float(np.median(dev)), float(np.percentile(dev, 95)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--a7-video", required=True)
    ap.add_argument("--lens", required=True)
    ap.add_argument("--iphone-shoot", required=True)
    ap.add_argument("--board", required=True)
    ap.add_argument("--sync", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--every", type=int, default=5, help="a7 のコマを何コマおきに見るか")
    a = ap.parse_args()

    board = Board.load(a.board)
    lens = json.loads(Path(a.lens).read_text(encoding="utf-8"))
    sync = json.loads(Path(a.sync).read_text(encoding="utf-8"))
    Ka = np.array([[lens["fx"], 0, lens["cx"]], [0, lens["fy"], lens["cy"]], [0, 0, 1.0]])
    o = lens["distortion_opencv"]
    Da = np.array([o["k1"], o["k2"], o["p1"], o["p2"], o["k3"]])
    shoot = load_shoot(a.iphone_shoot)
    pts = np.array([f["pts"] for f in shoot.frames])

    # a7 の側: 盤の姿勢
    cap = cv2.VideoCapture(a.a7_video)
    fps_a = cap.get(cv2.CAP_PROP_FPS) or 30.0
    a7_poses = {}
    i = 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if i % a.every == 0:
            P = pose_from_board(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), board, Ka, Da)
            if P is not None:
                a7_poses[i] = P
        i += 1
    cap.release()

    # どの iPhone のコマが要るか(止まっている所だけ)
    need = {}
    for i, P in a7_poses.items():
        t_a = i / fps_a
        t_b = (t_a - sync["beta"]) / sync["alpha"]
        if t_b < pts[0] or t_b > pts[-1] or not is_still(shoot.frames, pts, t_b):
            continue
        need[i] = int(np.argmin(np.abs(pts - t_b)))
    wanted = {j: i for i, j in need.items()}

    cap = cv2.VideoCapture(str(shoot.video))
    ip_poses = {}
    j = 0
    while wanted:
        ok, img = cap.read()
        if not ok:
            break
        if j in wanted:
            fr = shoot.frames[j]
            fx, fy, cx, cy = fr["K"]
            K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.0]])
            P = pose_from_board(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), board, K, np.zeros(5))
            if P is not None:
                ip_poses[j] = P
            wanted.pop(j)
        j += 1
    cap.release()

    offsets, world_to_led = [], []
    for i, jj in need.items():
        if i in a7_poses and jj in ip_poses:
            offsets.append(invert_rigid(ip_poses[jj]) @ a7_poses[i])
            world_to_led.append(ip_poses[jj] @ invert_rigid(mat4(shoot.frames[jj]["T"])))
    if len(offsets) < 3:
        raise SystemExit(f"使えた止まっている所が少ない({len(offsets)} 個。a7 で盤が見えたコマ {len(a7_poses)}、うち止まっていた {len(need)}、iPhone でも盤が見えた {len(ip_poses)})。止まる時間を長く、盤が両方に写る構図で撮り直す")
    M, t_std_mm, (rot_med, rot_p95) = summarize(offsets)
    W, W_std, (wr_med, wr_p95) = summarize(world_to_led)

    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    res = {
        "T_iphone_from_a7": M.tolist(),
        "a7_position_in_iphone_cam_mm": [round(float(v) * 1000, 1) for v in M[:3, 3]],
        "translation_spread_mm_per_axis": [round(float(v), 1) for v in t_std_mm],
        "rotation_spread_deg_median_p95": [round(rot_med, 3), round(rot_p95, 3)],
        "samples": len(offsets), "a7_frames_with_board": len(a7_poses), "still_frames": len(need), "iphone_frames_with_board": len(ip_poses),
        "axes": "ARKit 流(+x 右、+y 上、−z 前)、m。T_iphone_from_a7 は a7 のカメラの姿勢を iPhone のカメラの座標で表したもの",
    }
    (out / "rig_offset.json").write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
    al = {
        "source": "board", "T_led_from_world": W.tolist(), "T_world_from_led": invert_rigid(W).tolist(),
        "translation_spread_mm_per_axis": [round(float(v), 1) for v in W_std], "rotation_spread_deg_median_p95": [round(wr_med, 3), round(wr_p95, 3)],
        "samples": len(world_to_led),
        "notes": "盤を撮った iPhone の姿勢と ARKit の世界から求めた LED の位置。盤は LED の面の画像のとおりに置いた前提。",
    }
    (out / "alignment_board.json").write_text(json.dumps(al, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"ずれ: a7 は iPhone のカメラから {res['a7_position_in_iphone_cam_mm']} mm、ばらつき {res['translation_spread_mm_per_axis']} mm、向き {res['rotation_spread_deg_median_p95']}°(中央値,95%)、{len(offsets)} か所")


if __name__ == "__main__":
    main()
