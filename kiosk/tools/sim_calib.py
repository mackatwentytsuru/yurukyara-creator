"""校正と視線の誤差の机上の試験(UE を使わない、計算だけの答え合わせ)。
  python kiosk/tools/sim_calib.py [--trials 400] [--out result.json]

世界(LED の面 z=0、x=右、y=上、z=客の側)に、LED と下向きでない「下から見上げる」カメラを置き、客の目の位置(正解)を決める。
カメラの絵(歪みつき・ノイズつき)を計算で作り、(1) 床の印の人(巻き尺で測った位置)から solvePnP でカメラの置き場所・向きを出し、
(2) 別の客の目の位置を「目の間隔から距離 → 位置」で推定して、キャラの目から見た視線の誤差(度)を出す。
点の数・ノイズ・歪みの補正の誤り・目の間隔の個人差で、誤差がどう変わるかを見る。
前提はすべて仮定(LED の寸法・カメラの高さ・歪みの強さは未測定)。実物の顔の検出・暗さ・逆光は、ここでは確かめられない。
"""
from __future__ import annotations

import argparse
import json

import cv2
import numpy as np

W, H = 1080, 1920  # 縦持ちのカメラの画素
FOV_DIAG = 120.0
F = (np.hypot(W, H) / 2) / np.tan(np.radians(FOV_DIAG / 2))
K = np.array([[F, 0, W / 2], [0, F, H / 2], [0, 0, 1]], float)
DIST_TRUE = np.array([-0.25, 0.05, 0, 0, 0], float)  # 超広角の樽型の歪み(仮定)
IPD_MEAN, IPD_SD = 0.0621, 0.0037  # 成人の目の間隔(Fesharaki 2012)


def cam_pose(pitch_deg: float, cam_y: float):
    """世界 → カメラの回転 R と平行移動 t。カメラは +z(客の側)を向き、pitch だけ上を向く。カメラ座標: x=右, y=下, z=前"""
    p = np.radians(pitch_deg)
    # 世界の前方(0,0,1)・上(0,1,0)に対する、上向き p のカメラの軸(世界座標)
    fwd = np.array([0, np.sin(p), np.cos(p)])
    right = np.array([1, 0, 0])
    down = np.cross(fwd, right)  # 前 × 右 = 下
    R = np.stack([right, down, fwd])  # 世界 → カメラ
    C = np.array([0, cam_y, 0.0])
    return R, -R @ C


def project(pts, R, t, dist):
    pc = (R @ pts.T).T + t
    rvec, _ = cv2.Rodrigues(np.eye(3))
    img, _ = cv2.projectPoints(pc, rvec, np.zeros(3), K, dist)
    return img.reshape(-1, 2), pc


def in_image(img, pc):
    return (pc[:, 2] > 0.1) & (img[:, 0] > 0) & (img[:, 0] < W) & (img[:, 1] > 0) & (img[:, 1] < H)


def gaze_deg(est, true, eye):
    """キャラの目 eye から見た、推定の位置と本当の位置の方向の差(度)"""
    a, b = est - eye, true - eye
    c = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.degrees(np.arccos(np.clip(c, -1, 1))))


def run(trials, n_cal, noise_px, tape_cm, k_err, ipd_known, rng, cam_y=0.4, pitch=30.0, eye=np.array([0, 2.0, -0.3])):
    R, t = cam_pose(pitch, cam_y)
    # 校正の位置(床の格子 + 目の高さ)
    # 校正の位置: 床の 9 か所。**目の高さを交互に変える**(全部同じ高さだと平面になり、姿勢が反転して解けなくなる)
    pos = [(x, z) for z in (1.5, 2.0, 3.0) for x in (-0.8, 0, 0.8)]
    if n_cal >= 18:
        cal = np.array([(x, h, z) for (x, z) in pos for h in (1.6, 1.3)], float)
    else:
        pick = np.linspace(0, 8, n_cal).round().astype(int)
        cal = np.array([(pos[i][0], 1.6 if k % 2 == 0 else 1.3, pos[i][1]) for k, i in enumerate(pick)], float)
    img, pc = project(cal, R, t, DIST_TRUE)
    ok = in_image(img, pc)
    cal, img = cal[ok], img[ok]
    errs_pos, errs_ang, gaze = [], [], []
    dist_est = DIST_TRUE * (1 + k_err)  # 歪みの補正が、本当の値から k_err だけ(割合で)ずれている
    for _ in range(trials):
        tape = cal + rng.normal(0, tape_cm / 100, cal.shape)  # 巻き尺の測りの誤差
        meas = img + rng.normal(0, noise_px, img.shape)  # 顔の点の検出のぶれ
        okp, rv, tv = cv2.solvePnP(tape, meas, K, dist_est, flags=cv2.SOLVEPNP_SQPNP)
        if not okp:
            continue
        rv, tv = cv2.solvePnPRefineLM(tape, meas, K, dist_est, rv, tv)
        Re, _ = cv2.Rodrigues(rv)
        Ce = -Re.T @ tv.ravel()
        C = -R.T @ t
        errs_pos.append(float(np.linalg.norm(Ce - C)) * 100)
        errs_ang.append(float(np.degrees(np.arccos(np.clip((np.trace(Re @ R.T) - 1) / 2, -1, 1)))))
        # 別の客(ランダムな位置・目の高さ・個人の目の間隔)を、推定した外部パラメータと「目の間隔 → 距離」で位置にする
        for _ in range(6):
            true = np.array([rng.uniform(-1, 1), rng.uniform(1.4, 1.8), rng.uniform(1.2, 3.2)])
            ti, tpc = project(true[None], R, t, DIST_TRUE)
            if not in_image(ti, tpc).all():
                continue
            ipd = IPD_MEAN if not ipd_known else IPD_MEAN
            ipd_true = rng.normal(IPD_MEAN, IPD_SD)
            # 画像の目の間隔(画素)= 焦点距離 × 本当の目の間隔 / 奥行き。個人の差は ipd_true、推定は平均の ipd を使う
            depth_true = tpc[0, 2]
            ipd_px = F * ipd_true / depth_true + rng.normal(0, noise_px * 0.7)
            und = cv2.undistortPoints(ti.reshape(-1, 1, 2) + rng.normal(0, noise_px, (1, 1, 2)), K, dist_est, P=K).reshape(2)
            z_est = F * ipd / max(ipd_px, 1e-3)
            xc = (und[0] - K[0, 2]) / F * z_est
            yc = (und[1] - K[1, 2]) / F * z_est
            pest_c = np.array([xc, yc, z_est])
            pest = Re.T @ (pest_c - tv.ravel())
            gaze.append(gaze_deg(pest, true, eye))
    g = np.array(gaze)
    return {
        "校正の点": int(len(cal)),
        "位置の誤差_cm_中央値": round(float(np.median(errs_pos)), 1),
        "向きの誤差_度_中央値": round(float(np.median(errs_ang)), 2),
        "視線の誤差_度_中央値": round(float(np.median(g)), 2),
        "視線の誤差_度_90%": round(float(np.percentile(g, 90)), 2),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--trials", type=int, default=300)
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    rng = np.random.default_rng(7)
    rows = []

    def add(name, **kw):
        base = dict(n_cal=9, noise_px=1.0, tape_cm=1.5, k_err=0.0, ipd_known=False)
        base.update(kw)
        r = run(a.trials, rng=rng, **base)
        r["条件"] = name
        rows.append(r)
        print(f"{name:<34} 点{r['校正の点']:>2}  位置 {r['位置の誤差_cm_中央値']:>5} cm  向き {r['向きの誤差_度_中央値']:>5}°  視線 中央 {r['視線の誤差_度_中央値']:>5}° / 90% {r['視線の誤差_度_90%']:>5}°")

    add("基準(9 点・1 px・巻き尺 1.5 cm)")
    add("点が少ない: 4 点", n_cal=4)
    add("点が少ない: 6 点", n_cal=6)
    add("点が多い: 18 点", n_cal=18)
    add("検出のぶれが大きい: 3 px", noise_px=3.0)
    add("巻き尺が雑: 5 cm", tape_cm=5.0)
    add("歪みの補正が 10% ずれ", k_err=0.10)
    add("歪みの補正が 30% ずれ", k_err=0.30)
    add("歪みを補正しない(100% ずれ)", k_err=-1.0)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump({"前提": {"画素": [W, H], "対角の画角": FOV_DIAG, "歪み": DIST_TRUE.tolist(), "目の間隔": [IPD_MEAN, IPD_SD], "カメラの高さ": 0.4, "上向き": 30, "キャラの目": [0, 2.0, -0.3]}, "結果": rows}, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
