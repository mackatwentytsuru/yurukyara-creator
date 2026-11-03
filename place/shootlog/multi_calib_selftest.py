"""multi_calib.py の合成の確かめ。3 つの面(向きと位置が違う)の盤を、歪みのあるレンズで 40 か所から撮ったことにして、
角の画素(雑音 0.3 px)と ARKit の姿勢(位置の雑音 1 cm+ゆっくりしたずれ 2 cm、向き 0.3°)から、正解のレンズ・面の配置・ARKit の変換を取り戻せるかを見る。

  python place/shootlog/multi_calib_selftest.py [--faces 3] [--views 40]
実映像の確かめではない(角の検出・LED のモアレ・ARKit の本当のずれは、実機の撮影で)。
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation as Rot

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import multi_calib as M  # noqa: E402
from lenslib import Board  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--faces", type=int, default=3)
ap.add_argument("--views", type=int, default=40)
ap.add_argument("--px-noise", type=float, default=0.3)
ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--scale-error", type=float, default=0.0, help="最後の面の大きさ(画素の大きさの仮定)の本当のずれ(例 0.03 = 3%)")
a = ap.parse_args()
rng = np.random.default_rng(a.seed)

W, H = 1920, 1080
K_true = np.array([[1400.0, 0, 960], [0, 1400.0, 540], [0, 0, 1]])
k1_true, k2_true = -0.06, 0.01
boards = [Board(7, 9, 136, 102, (2, 8), (956, 1240), 0.001, "DICT_4X4_250", 32 * i) for i in range(a.faces)]
faces = [M.Face("ABC"[i], boards[i]) for i in range(a.faces)]
# 面の真の配置(基準 = 面 0)。面の座標は x 右・y 上・z 手前、左下が原点
true_faces = [(np.eye(3), np.zeros(3)),
              (Rot.from_euler("y", -30, degrees=True).as_matrix(), np.array([1.2, 0.0, -0.3])),
              (Rot.from_euler("y", 40, degrees=True).as_matrix(), np.array([-1.3, 0.0, 0.1]))][: a.faces]
true_scale = [1.0] * a.faces
if a.faces > 1:
    true_scale[-1] = 1.0 + a.scale_error
ids_all = np.arange(48)
local = [b.corner_led_m(ids_all).astype(float) for b in boards]

def look_at(eye, target):
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1, 0])
    r /= np.linalg.norm(r)
    d = np.cross(f, r)                 # OpenCV: y 下
    R_cam_to_ref = np.stack([r, d, f], axis=1)
    return R_cam_to_ref.T, -R_cam_to_ref.T @ eye   # T_cam←ref

# ARKit の世界 → 基準の座標 の真の変換(縮尺は 1.0 とする)
Ra_true = Rot.from_euler("y", 70, degrees=True).as_matrix() @ Rot.from_euler("x", 1.0, degrees=True).as_matrix()
ta_true = np.array([0.4, -1.1, 0.2])
s_true = 1.0

obs, views, truth_cams = [], [], []
n = 0
while n < a.views:
    ang = rng.uniform(-50, 50)
    dist = rng.uniform(2.2, 4.2)
    eye = np.array([0.1 + dist * np.sin(np.radians(ang)), rng.uniform(0.3, 1.4), 0.3 + dist * np.cos(np.radians(ang))])
    target = np.array([0.1, 0.6, 0.0]) + rng.normal(0, 0.15, 3)
    Rv, tv = look_at(eye, target)
    row = []
    for k in range(a.faces):
        Rk, tk = true_faces[k]
        P = true_scale[k] * (Rk @ local[k].T).T + tk
        Pc = (Rv @ P.T).T + tv
        if (Pc[:, 2] < 0.5).any():
            continue
        # 面の表(+z)が camera のほうを向いているか
        normal = Rk @ np.array([0, 0, 1.0])
        if np.dot(normal, eye - tk) / np.linalg.norm(eye - tk) < 0.25:
            continue
        xn, yn = Pc[:, 0] / Pc[:, 2], Pc[:, 1] / Pc[:, 2]
        r2 = xn ** 2 + yn ** 2
        d = 1 + k1_true * r2 + k2_true * r2 ** 2
        uv = np.stack([1400 * xn * d + 960, 1400 * yn * d + 540], axis=1)
        inside = (uv[:, 0] > 5) & (uv[:, 0] < W - 5) & (uv[:, 1] > 5) & (uv[:, 1] < H - 5)
        if inside.sum() < 12:
            continue
        row.append((k, uv[inside] + rng.normal(0, a.px_noise, (inside.sum(), 2)), local[k][inside], ids_all[inside]))
    if not row:
        continue
    v = len(views)
    # ARKit の姿勢: カメラ(ARKit 流 = OpenCV 流 · D)→ ARKit の世界。雑音とゆっくりしたずれを足す
    R_ref_cv = Rv.T
    C_ref = -Rv.T @ tv
    drift = np.array([0.02, -0.01, 0.015]) * (v / a.views)
    R_ark_cam = Ra_true.T @ R_ref_cv @ M.D_CV
    R_ark_cam = Rot.from_rotvec(rng.normal(0, np.radians(0.3), 3)).as_matrix() @ R_ark_cam
    C_ark = Ra_true.T @ (C_ref - ta_true) / s_true + rng.normal(0, 0.01, 3) + drift
    T_ark = np.eye(4); T_ark[:3, :3] = R_ark_cam; T_ark[:3, 3] = C_ark
    views.append(M.View(v, v, T_ark))
    truth_cams.append((Rv, tv))
    for k, uv, p3, ids in row:
        obs.append(M.Obs(v, k, uv, p3, ids))
    n += 1

K0 = np.array([[1300.0, 0, 940], [0, 1300.0, 520], [0, 0, 1]])   # わざと外した初期値(ARKit の K を想定)
prob, x, r = M.solve(faces, obs, views, K0)
rep = M.report(prob, x, views)
ho = M.holdout(faces, obs, views, K0)

ok = True
def check(name, cond, text):
    global ok
    print(("合格 " if cond else "不合格 ") + name + " " + text)
    ok &= bool(cond)

K = rep["K"]
check("焦点距離", abs(K["fx"] - 1400) / 1400 < 0.003, f"fx={K['fx']:.1f}(正解 1400)、fy={K['fy']:.1f}、cx={K['cx']:.1f}(960)、cy={K['cy']:.1f}(540)")
check("歪み k1", abs(rep["dist"]["k1"] - k1_true) < 0.01, f"k1={rep['dist']['k1']:.4f}(正解 {k1_true})、k2={rep['dist']['k2']:.4f}({k2_true})")
for k in range(1, a.faces):
    T = np.array(rep["faces"][faces[k].name]["T_ref_from_face"])
    Rk, tk = true_faces[k]
    dpos = np.linalg.norm(T[:3, 3] - tk) * 1000
    drot = np.degrees(np.linalg.norm(M.R_to_rv(T[:3, :3].T @ Rk)))
    sc = rep["faces"][faces[k].name]["scale"]
    check(f"面 {faces[k].name} の配置", dpos < 8 and drot < 0.25 and abs(sc - true_scale[k]) < 0.004, f"位置の誤差 {dpos:.1f} mm、向きの誤差 {drot:.3f}°、大きさ {sc:.4f}(正解 {true_scale[k]:.4f})")
ark = rep["arkit"]
T = np.array(ark["T_ref_from_ark"])
dpos = np.linalg.norm(T[:3, 3] - ta_true) * 100
drot = np.degrees(np.linalg.norm(M.R_to_rv(T[:3, :3].T @ Ra_true)))
check("ARKit の変換", dpos < 3 and drot < 0.5 and abs(ark["scale"] - 1) < 0.01, f"位置 {dpos:.2f} cm、向き {drot:.3f}°、縮尺 {ark['scale']:.4f}")
check("角の再投影", rep["reprojection_px"]["rms"] < 0.6, f"rms {rep['reprojection_px']['rms']:.3f} px、p95 {rep['reprojection_px']['p95']:.2f}、{rep['reprojection_px']['n']} 点、視点 {len(views)}")
check("取り置きの視点", ho["px_rms"] is not None and ho["px_rms"] < 0.8, f"{ho}")
print("ARKit の姿勢との差(雑音+ずれを含む):", ark["pose_diff_cm"], ark["pose_diff_deg"])
print("全部合格" if ok else "不合格あり")
sys.exit(0 if ok else 1)
