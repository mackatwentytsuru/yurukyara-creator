"""固定カットの解き方の合成の試験: 会場の寸法で、超広角のカメラ(13 m)から 33 点を写し、雑音を足して解く。舞台の中央の床の位置の誤差を見る。

  python place/shootlog/uw_fixed_selftest.py
K が iOS の値から少しずれている場合と、焦点距離も解く場合を比べる。
"""
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from make_led_dots_video import dots  # noqa: E402
from uw_fixed_camera import solve_pose, stage_points  # noqa: E402

FX, W, H = 1478.0, 3840, 2160
CENTRE = np.array([0.0, 0.0, 1.8])      # 舞台の中央、床、客席へ 1.8 m(m。x 右、y 上、z 客席)


def look_at(cam, target):
    f = np.asarray(target, float) - cam
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1, 0])
    r /= np.linalg.norm(r)
    d = np.cross(f, r)
    R = np.stack([r, d, f])             # 世界 → OpenCV のカメラ
    return R, -R @ cam


def trial(rng, keys, table, cam, f_err, px_sigma, solve_focal):
    P3 = stage_points(table, keys)
    R, t = look_at(np.asarray(cam, float), [0, 2.3, 0])
    K_true = np.array([[FX, 0, W / 2], [0, FX, H / 2], [0, 0, 1.0]])
    pr, _ = cv2.projectPoints(P3, cv2.Rodrigues(R)[0], t, K_true, np.zeros(5))
    P2 = pr.reshape(-1, 2) + rng.normal(0, px_sigma, (len(P3), 2))
    K0 = K_true.copy()
    K0[0, 0] *= 1 + f_err
    K0[1, 1] *= 1 + f_err
    rv, tv, fx, k1, e, use = solve_pose(P3, P2, K0, solve_focal=solve_focal)
    Rs = cv2.Rodrigues(np.asarray(rv))[0]
    K = np.array([[fx, 0, W / 2], [0, fx, H / 2], [0, 0, 1.0]])
    # 舞台の中央が画面のどこに写るかの差(合成で見えるずれ)と、カメラの位置の差
    p_true = K_true @ (R @ CENTRE + t)
    p_true = p_true[:2] / p_true[2]
    p_est = K @ (Rs @ CENTRE + np.asarray(tv).ravel())
    p_est = p_est[:2] / p_est[2]
    cam_est = -Rs.T @ np.asarray(tv).ravel()
    return np.linalg.norm(p_est - p_true), np.linalg.norm(cam_est - np.asarray(cam)) * 100, fx


def main():
    table = dots()
    keys = list(range(len(table)))
    rng = np.random.default_rng(2)
    print("超広角 固定 13 m。33 点。画面のずれ(4K の画素。13 m で 1 px ≈ 0.9 cm)・カメラの位置の誤差 cm(各 100 回の中央値)")
    ok = True
    for name, fe, sig, sf in [("K 正しい・雑音 1.5 px", 0, 1.5, False), ("K 1% ずれ・雑音 1.5 px", 0.01, 1.5, False), ("K 1% ずれ・焦点も解く", 0.01, 1.5, True), ("K 3% ずれ・焦点も解く", 0.03, 1.5, True), ("K 正しい・雑音 4 px", 0, 4, False)]:
        r = np.array([trial(rng, keys, table, (0.0, 1.7, 13.0), fe, sig, sf) for _ in range(100)])
        print(f"{name:24s} 画面 {np.median(r[:, 0]):5.2f} px  カメラ {np.median(r[:, 1]):5.1f} cm  fx {np.median(r[:, 2]):7.1f}")
        if fe == 0 and sig == 1.5:
            ok = ok and np.median(r[:, 0]) < 2
    print("合格" if ok else "不合格")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
