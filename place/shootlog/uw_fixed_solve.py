"""超広角の固定カットの確かめ: 1 コマ(平均)から 3 面の盤を拾い、位置を解いて、どれだけ合うかを測る。

  python place/shootlog/uw_fixed_solve.py --video <超広角.mov> --info <同じ名前.json> --faces <faces_monitor.json> [--frames 30]
やること: 動かないカメラなので数十コマを平均してから盤の角を拾う。①iOS が付ける内部パラメータのまま ②歪みも解く(k1,k2 と焦点距離を未知数に、3 面の面ごとの位置と向きを解く)の 2 つで、再投影の誤差を比べる。
面の絵は平らとして解く。モニターは曲面なので、面ごとに別の向きを許す。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import least_squares

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from lenslib import Board, detect_corners  # noqa: E402


def load_boards(path):
    spec = json.loads(Path(path).read_text(encoding="utf-8"))
    return [(f["name"], Board(**{k: (tuple(v) if k in ("offset_px", "face_px") else v) for k, v in f["board"].items()})) for f in spec["faces"]]


def board_points(board, ids):
    cv = board.cv_board()
    pts = np.asarray(cv.getChessboardCorners(), np.float64)
    return pts[ids.flatten()]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--info", required=True)
    ap.add_argument("--faces", required=True)
    ap.add_argument("--frames", type=int, default=30)
    ap.add_argument("--out")
    a = ap.parse_args()
    info = json.loads(Path(a.info).read_text(encoding="utf-8"))
    cap = cv2.VideoCapture(a.video)
    imgs = []
    cap.set(cv2.CAP_PROP_POS_FRAMES, 60)
    for _ in range(a.frames):
        ok, f = cap.read()
        if not ok:
            break
        imgs.append(f.astype(np.float32))
    cap.release()
    mean = np.mean(imgs, axis=0).astype(np.uint8)
    gray = cv2.cvtColor(mean, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    boards = load_boards(a.faces)
    obs = []
    res = {"name": info.get("name"), "correction": info.get("correction_enabled"), "K_ios": info.get("K"), "size": [w, h], "faces": {}}
    for name, b in boards:
        det = detect_corners(gray, b, min_corners=6)
        if det is None:
            res["faces"][name] = {"corners": 0}
            continue
        c, ids = det[0], det[1]
        p3 = b.object_points(ids) if hasattr(b, "object_points") else board_points(b, ids)
        obs.append((name, np.asarray(c, np.float64).reshape(-1, 2), np.asarray(p3, np.float64).reshape(-1, 3)))
        res["faces"][name] = {"corners": int(len(c))}
    if not obs:
        raise SystemExit("盤が 1 つも見つからない")
    fx0, fy0, cx0, cy0 = info["K"]

    def proj(params, rv, tv, P):
        fx, cx, cy, k1, k2 = params
        K = np.array([[fx, 0, cx], [0, fx, cy], [0, 0, 1.0]])
        pr, _ = cv2.projectPoints(P, rv, tv, K, np.array([k1, k2, 0, 0, 0.0]))
        return pr.reshape(-1, 2)

    def initial(K, dist):
        out = []
        for name, c, P in obs:
            ok, rv, tv = cv2.solvePnP(P, c, K, dist, flags=cv2.SOLVEPNP_ITERATIVE)
            out.append((rv.ravel(), tv.ravel()))
        return out

    K0 = np.array([[fx0, 0, cx0], [0, fy0, cy0], [0, 0, 1.0]])
    init = initial(K0, np.zeros(5))
    # ①iOS の K のまま、面ごとに PnP
    errs = []
    per = {}
    for (name, c, P), (rv, tv) in zip(obs, init):
        pr, _ = cv2.projectPoints(P, rv, tv, K0, np.zeros(5))
        e = np.linalg.norm(pr.reshape(-1, 2) - c, axis=1)
        per[name] = round(float(np.sqrt((e ** 2).mean())), 2)
        errs.append(e)
    e = np.concatenate(errs)
    res["ios_K"] = {"rms_px_4k": round(float(np.sqrt((e ** 2).mean())), 2), "p95_px_4k": round(float(np.percentile(e, 95)), 2), "per_face": per}

    # ②焦点距離・中心・歪みも解く(面ごとの姿勢は別)
    x0 = [fx0, cx0, cy0, 0.0, 0.0]
    for rv, tv in init:
        x0 += list(rv) + list(tv)

    def residual(x):
        r = []
        for i, (name, c, P) in enumerate(obs):
            rv, tv = x[5 + 6 * i:8 + 6 * i], x[8 + 6 * i:11 + 6 * i]
            r.append((proj(x[:5], rv, tv, P) - c).ravel())
        return np.concatenate(r)

    sol = least_squares(residual, np.array(x0), loss="soft_l1", f_scale=2.0, max_nfev=200)
    r = residual(sol.x).reshape(-1, 2)
    e = np.linalg.norm(r, axis=1)
    per = {}
    off = 0
    for name, c, P in obs:
        per[name] = round(float(np.sqrt((e[off:off + len(c)] ** 2).mean())), 2)
        off += len(c)
    res["solved"] = {"fx": round(float(sol.x[0]), 1), "cx": round(float(sol.x[1]), 1), "cy": round(float(sol.x[2]), 1), "k1": round(float(sol.x[3]), 4), "k2": round(float(sol.x[4]), 4),
                     "rms_px_4k": round(float(np.sqrt((e ** 2).mean())), 2), "p95_px_4k": round(float(np.percentile(e, 95)), 2), "per_face": per,
                     "hfov_deg": round(float(2 * np.degrees(np.arctan(w / 2 / sol.x[0]))), 1)}
    res["note"] = "1 コマの視点だけなので、焦点距離と面の奥行きは強く結びつく。面の大きさ(盤の刻み)は既知として解いた"
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if a.out:
        Path(a.out).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
