"""合成の絵で、レンズ校正(lens_calib)と ST マップによる歪みの付け方(apply_distortion)の計算を確かめる。

  python place/shootlog/lens_selftest.py [--out <作業フォルダ>]
既知の歪み(k1=-0.12 など)をかけた「LED に出した盤」の動画を作り、lens_calib で係数を当てられるか、
st_map で CG の格子に歪みをかけた絵が、a7 の絵の歪みと合うか(格子の線が盤の線に重なる距離)を調べる。
実機の a7 の映像での確かめは、撮影後。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

from lenslib import Board, st_map, distort_image

TRUE_K = np.array([[1500.0, 0, 960.0], [0, 1500.0, 540.0], [0, 0, 1.0]])
TRUE_D = np.array([-0.12, 0.05, 0.0008, -0.0005, -0.01])
SIZE = (1920, 1080)


def look_at_world_to_cam(eye, target):
    """LED の座標(x 右・y 上・z 客席側)で、OpenCV のカメラ(x 右・y 下・z 前)への R, t。"""
    eye, target = np.asarray(eye, float), np.asarray(target, float)
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1.0, 0])
    r /= np.linalg.norm(r)
    d = np.cross(f, r)          # 画像の下
    R = np.stack([r, d, f])     # 行 = カメラの軸(世界の座標で)
    return R, -R @ eye


def render_view(board_img, board: Board, R, t):
    w, h = SIZE
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    pts = np.stack([xs.ravel(), ys.ravel()], axis=1).reshape(-1, 1, 2)
    norm = cv2.undistortPoints(pts, TRUE_K, TRUE_D).reshape(-1, 2)          # 歪んだ画素 → 歪みなしの正規化座標
    rays_cam = np.concatenate([norm, np.ones((len(norm), 1))], axis=1)
    rays_w = rays_cam @ R                                                    # R の行 = カメラの軸 → 世界の向き
    origin = -R.T @ t
    s = -origin[2] / rays_w[:, 2]                                           # z=0 の面との交点
    hit = origin + rays_w * s[:, None]
    px = hit[:, 0] / board.pitch_m
    py = board.face_px[1] - hit[:, 1] / board.pitch_m
    mx = px.reshape(h, w).astype(np.float32)
    my = py.reshape(h, w).astype(np.float32)
    valid = (s.reshape(h, w) > 0)
    img = cv2.remap(board_img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    img[~valid] = 0
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path.home() / "AppData/Local/Temp/lens_selftest"))
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    here = Path(__file__).resolve().parent

    subprocess.run([sys.executable, str(here / "make_led_board.py"), "--face-px", "1280", "1240", "--square-px", "160", "--out-dir", str(out)], check=True)
    board = Board.load(out / "board_A.json")
    board_img = cv2.imread(str(out / "led_board_A.png"), cv2.IMREAD_GRAYSCALE)

    # 角の id → LED の画素位置の対応が、検出と合っているか
    from lenslib import detect_corners
    cc, ids = detect_corners(board_img, board, 4)
    expect = board.corner_led_m(ids)
    got = np.stack([cc[:, 0] * board.pitch_m, (board.face_px[1] - cc[:, 1]) * board.pitch_m], axis=1)
    id_err_mm = float(np.abs(expect[:, :2] - got).max() * 1000)
    print(f"角の id と位置の対応の誤差(盤の画像): {id_err_mm:.2f} mm({len(ids)} 個)")

    rng = np.random.default_rng(3)
    fourcc = cv2.VideoWriter_fourcc(*"MJPG")
    vw = cv2.VideoWriter(str(out / "a7_sim.avi"), fourcc, 30, SIZE)
    centre = np.array([2.56, 2.0, 0.0])
    n = 70
    for i in range(n):
        eye = centre + np.array([rng.uniform(-1.8, 1.8), rng.uniform(-0.3, 0.8), rng.uniform(3.8, 6.0)])
        target = centre + np.array([rng.uniform(-1.8, 1.8), rng.uniform(-1.0, 1.0), 0.0])
        R, t = look_at_world_to_cam(eye, target)
        vw.write(cv2.cvtColor(render_view(board_img, board, R, t), cv2.COLOR_GRAY2BGR))
    vw.release()

    subprocess.run([sys.executable, str(here / "lens_calib.py"), "--video", str(out / "a7_sim.avi"), "--board", str(out / "board_A.json"),
                    "--out-dir", str(out / "lens"), "--every", "1"], check=True)
    lens = json.loads((out / "lens" / "lens.json").read_text(encoding="utf-8"))
    o = lens["distortion_opencv"]
    est = np.array([lens["fx"], lens["fy"], lens["cx"], lens["cy"], o["k1"], o["k2"], o["p1"], o["p2"], o["k3"]])
    true = np.array([1500, 1500, 960, 540, *TRUE_D])
    print("焦点距離の誤差 fx %.2f px(%.3f%%)、主点の誤差 %.2f px" % (est[0] - 1500, (est[0] - 1500) / 15, np.hypot(est[2] - 960, est[3] - 540)))
    print("係数: 推定", np.round(est[4:], 4), "真", true[4:])

    # 歪みの当たり具合: 周辺まで含めて、歪みを当てた画素位置が真の歪みの画素位置とどれだけ違うか(画素)
    K_est = np.array([[est[0], 0, est[2]], [0, est[1], est[3]], [0, 0, 1.0]])
    D_est = est[4:]
    g = np.array([[x, y] for x in np.linspace(0, SIZE[0] - 1, 25) for y in np.linspace(0, SIZE[1] - 1, 15)], np.float32).reshape(-1, 1, 2)
    und_true = cv2.undistortPoints(g, TRUE_K, TRUE_D, P=TRUE_K).reshape(-1, 2)
    und_est = cv2.undistortPoints(g, K_est, D_est, P=K_est).reshape(-1, 2)
    d_und = np.linalg.norm(und_true - und_est, axis=1)
    print(f"歪みを直した位置の食い違い: 平均 {d_und.mean():.2f} px、最大 {d_und.max():.2f} px(画面全体)")

    # ST マップ: CG の格子(歪みなしピンホール)に歪みをかけた絵と、真の歪みで描いた格子を比べる
    npz = np.load(out / "lens" / "st_map.npz")
    cg_w, cg_h = [int(v) for v in npz["cg_size"]]
    sx, sy = (cg_w - SIZE[0]) / 2.0, (cg_h - SIZE[1]) / 2.0
    grid_pts = []
    for X in np.linspace(-3.0, 3.0, 25):
        for Y in np.linspace(-1.6, 1.6, 15):
            grid_pts.append([X, Y, 10.0])
    grid_pts = np.array(grid_pts, np.float32)
    true_px, _ = cv2.projectPoints(grid_pts, np.zeros(3), np.zeros(3), TRUE_K, TRUE_D)
    cg_px = (TRUE_K @ grid_pts.T).T
    cg_px = cg_px[:, :2] / cg_px[:, 2:3] + np.array([sx, sy])
    cg = np.zeros((cg_h, cg_w), np.uint8)
    for p in cg_px:
        cv2.circle(cg, (int(round(p[0])), int(round(p[1]))), 6, 255, -1)
    dist_img = distort_image(cg, npz["map_x"], npz["map_y"])
    inside = [(p[0], p[1]) for p in true_px.reshape(-1, 2) if 12 < p[0] < SIZE[0] - 12 and 12 < p[1] < SIZE[1] - 12]
    errs = []
    for (u, v) in inside:
        x0, y0 = int(u) - 12, int(v) - 12
        patch = dist_img[y0:y0 + 24, x0:x0 + 24].astype(float)
        if patch.sum() < 100:
            continue
        yy, xx = np.mgrid[0:24, 0:24]
        cx_ = (patch * xx).sum() / patch.sum() + x0
        cy_ = (patch * yy).sum() / patch.sum() + y0
        errs.append(np.hypot(cx_ - u, cy_ - v))
    print(f"ST マップで歪みをかけた CG の格子の点と、真の歪みの点の距離: 平均 {np.mean(errs):.2f} px、最大 {np.max(errs):.2f} px({len(errs)} 点)")
    cv2.imwrite(str(out / "cg_grid_distorted.png"), dist_img)

    ok = (abs(est[0] - 1500) < 6 and d_und.mean() < 1.0 and np.mean(errs) < 1.0)
    print("合格" if ok else "不合格")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
