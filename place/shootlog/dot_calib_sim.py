"""点の校正の精度の見積もり(合成データ)。会場の寸法(show/ue/stage_layout.py)で、面 A だけの点と 3 面の点を比べる。

  python place/shootlog/dot_calib_sim.py
カメラを舞台の前に置き、点へのレイに画素の雑音とカメラの姿勢の雑音を足して、ページと同じ解き方(y 回りの回転 + 平行移動の 4 未知数)で解く。
見る数字: 主役の立つ所(舞台の中央 x=0、床)の位置の誤差と、向きの誤差。実物の LED では未確かめの見積もり。
"""
from __future__ import annotations

import numpy as np

FX = 3065.0            # iPad の 4K の焦点距離(画素)
Z_TOP, Z_BOTTOM = 594.0, 98.0
A_X = (-749.7, -749.7 + 955 * 0.4)    # 面 A の使える所(絵の x 0〜955)
B_X = (-352.0 + (1280 - 957) * 0.2948, -352.0 + (3038 - 957) * 0.2948)   # 面 B の使える所(絵の x 1280〜3038)
B_Y = -140.0
C_X = (236.7 + (3346 - 3039) * 0.4, 236.7 + (4288 - 3039) * 0.4)         # 面 C の平らな所(絵の x 3346〜4288)


def grid(x0, x1, y, cols, rows):
    pts = []
    for r in range(rows):
        for c in range(cols):
            fx = 0.1 + 0.8 * c / (cols - 1)
            fz = 0.15 + 0.7 * r / (rows - 1)
            pts.append((x0 + fx * (x1 - x0), y, Z_TOP - fz * (Z_TOP - Z_BOTTOM)))
    return np.array(pts) / 100.0      # m(舞台の座標: x 右、y 客席、z 上)


def stage_to_ar(p):
    """舞台(x, y, z 上)→ ARKit 風(x, y 上, z)。y 回りの回転で世界と結ばれるように、上の軸をそろえる。"""
    return np.stack([p[..., 0], p[..., 2], p[..., 1]], -1)


def solve(P, O, D):
    def cost(th):
        c, s = np.cos(th), np.sin(th)
        R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
        A = np.zeros((3, 3)); b = np.zeros(3)
        for p, o, d in zip(P, O, D):
            M = np.eye(3) - np.outer(d, d)
            A += M; b += M @ (o - R @ p)
        t = np.linalg.solve(A, b)
        e = 0.0
        for p, o, d in zip(P, O, D):
            v = R @ p + t - o
            v = v - d * (v @ d)
            e += v @ v
        return e, t
    ths = np.linspace(-np.pi, np.pi, 180, endpoint=False)
    th0 = ths[int(np.argmin([cost(t)[0] for t in ths]))]
    lo, hi = th0 - np.pi / 90, th0 + np.pi / 90
    for _ in range(40):
        a, b = lo + (hi - lo) / 3, hi - (hi - lo) / 3
        if cost(a)[0] < cost(b)[0]: hi = b
        else: lo = a
    th = (lo + hi) / 2
    return th, cost(th)[1]


def trial(rng, pts_stage, cam_y, cam_z, walk, px_sigma, pos_sigma, rot_sigma_deg):
    true_th = np.radians(rng.uniform(-180, 180))
    c, s = np.cos(true_th), np.sin(true_th)
    R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    t = rng.uniform(-2, 2, 3)
    P = stage_to_ar(pts_stage)
    W = (R @ P.T).T + t
    O, D, keep = [], [], []
    for i, w in enumerate(W):
        cam = np.array([rng.uniform(-walk, walk), cam_y + rng.uniform(-walk, walk), cam_z])     # 舞台の座標
        cam_w = R @ stage_to_ar(cam) + t + rng.normal(0, pos_sigma, 3)
        d = w - cam_w
        d /= np.linalg.norm(d)
        # 画素の雑音 + カメラの向きの雑音を、角度の雑音として足す
        ang = np.hypot(px_sigma / FX, np.radians(rot_sigma_deg))
        a = np.cross(d, [0, 1, 0]); a /= np.linalg.norm(a)
        b = np.cross(d, a)
        d = d + a * rng.normal(0, ang) + b * rng.normal(0, ang)
        O.append(cam_w); D.append(d / np.linalg.norm(d))
    th, t2 = solve(P, np.array(O), np.array(D))
    c2, s2 = np.cos(th), np.sin(th)
    R2 = np.array([[c2, 0, s2], [0, 1, 0], [-s2, 0, c2]])
    centre = stage_to_ar(np.array([0.0, 1.8, 0.0]))     # 主役の立つ所(舞台の中央、客席へ 1.8 m、床)
    err = np.linalg.norm((R2 @ centre + t2) - (R @ centre + t))
    dth = np.degrees(np.arctan2(np.sin(th - true_th), np.cos(th - true_th)))
    return err * 100, abs(dth)


def main():
    rng = np.random.default_rng(1)
    faces = {
        "A だけ(5×3=15 点)": grid(*A_X, 0.0, 5, 3),
        "B だけ(5×3=15 点)": grid(*B_X, B_Y, 5, 3),
        "A+B+C(3×3+5×3+3×3=33 点)": np.vstack([grid(*A_X, 0.0, 3, 3), grid(*B_X, B_Y, 5, 3), grid(*C_X, 0.0, 3, 3)]),
    }
    cams = {"遠く 13 m・止まる": (13.0, 2.2, 0.03), "遠く 13 m・手持ちで ±1 m": (13.0, 2.2, 1.0), "中間 8 m・手持ちで ±1 m": (8.0, 1.5, 1.0)}
    print("主役の立つ所の位置の誤差(cm、中央値 / 90%)・向きの誤差(度、中央値)。画素の雑音 3 px、カメラの位置 1 cm、向き 0.1°。各 200 回")
    for cname, (cy, cz, walk) in cams.items():
        print(f"\n--- {cname}")
        for fname, pts in faces.items():
            r = np.array([trial(rng, pts, cy, cz, walk, 3.0, 0.01, 0.1) for _ in range(200)])
            print(f"{fname:32s} 位置 {np.median(r[:, 0]):6.1f} / {np.percentile(r[:, 0], 90):6.1f} cm   向き {np.median(r[:, 1]):5.2f}°")


if __name__ == "__main__":
    main()
