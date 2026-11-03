"""複数の面(画面)の盤を、動きながら撮った映像から、レンズ・各面の位置と向き・ARKit と面の座標の変換を一度に解く(バンドル調整)。

  python place/shootlog/multi_calib.py --faces faces.json --shoot <撮影フォルダ> --out multi_calib.json [--every 6] [--no-arkit]
faces.json: {"faces": [{"name": "A", "board": <Board の json>} , ...]}(先頭の面が基準の座標 = 「LED の座標」。x 右・y 上・z 客席、左下が原点)。
解く物(未知数): レンズ(fx fy cx cy k1 k2)、各視点のカメラの姿勢、基準でない面の位置と向き、ARKit の世界 → 基準の面の座標の変換(回転・平行移動・縮尺)。
測定: 盤の角の 2D(映像から)・ARKit のカメラの姿勢(弱い測定として、位置 2 cm・向き 0.7° の幅で加える)。盤の角の間隔は既知(= 大きさの手がかり)。
面が違う向き・位置にあるほど解きやすい。面の比率をサンプル会場に合わせる必要はない。
結果: K・歪み・各面の T(基準の座標での位置と向き)・ARKit→基準の変換・誤差(px、ARKit の姿勢との差 cm/°、取り置いた視点での角の誤差 px)。
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import least_squares
from scipy.sparse import lil_matrix
from scipy.spatial.transform import Rotation as Rot

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import shootlib as S  # noqa: E402
from lenslib import Board, detect_corners  # noqa: E402

SIG_PX = 0.5          # 角の画素の誤差の見積もり
SIG_POS = 0.02        # ARKit の位置の幅(m)
SIG_ROT = np.radians(0.7)  # ARKit の向きの幅
SIG_FACE_SCALE = 0.02  # 基準でない面の大きさ(画素の大きさの仮定)の事前の幅(2%)。画面の寸法が正確なら小さく、不確かなら大きく
D_CV = np.diag([1.0, -1.0, -1.0])  # ARKit のカメラ(y 上・z 後ろ)→ OpenCV のカメラ(y 下・z 前)


@dataclass
class Face:
    name: str
    board: Board


@dataclass
class Obs:
    view: int
    face: int
    pts2d: np.ndarray     # (N,2)
    local3d: np.ndarray   # (N,3) 面の座標(m)
    ids: np.ndarray


@dataclass
class View:
    index: int
    frame: int | None
    T_ark: np.ndarray | None  # カメラ → ARKit の世界(ARKit の約束)


def detect_view(gray: np.ndarray, faces: list[Face], min_corners=6):
    out = {}
    for i, f in enumerate(faces):
        r = detect_corners(gray, f.board, min_corners=min_corners)
        if r is None:
            continue
        c, ids = r
        out[i] = (c.astype(float), f.board.corner_led_m(ids).astype(float), ids)
    return out


# ---- 回転・剛体の小道具 -----------------------------------------------------------

def rv_to_R(rv):
    return Rot.from_rotvec(np.asarray(rv, float).reshape(-1)).as_matrix()


def R_to_rv(R):
    return Rot.from_matrix(R).as_rotvec()


def inv_T(R, t):
    return R.T, -R.T @ t


def mean_rotation(Rs):
    q = Rot.from_matrix(np.array(Rs)).mean()
    return q.as_matrix()


def umeyama(src: np.ndarray, dst: np.ndarray):
    """dst ≈ s R src + t の最小二乗(縮尺あり)。"""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    xs, xd = src - mu_s, dst - mu_d
    cov = xd.T @ xs / len(src)
    U, D, Vt = np.linalg.svd(cov)
    S_ = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S_[2, 2] = -1
    R = U @ S_ @ Vt
    var_s = (xs ** 2).sum() / len(src)
    s = np.trace(np.diag(D) @ S_) / var_s if var_s > 0 else 1.0
    t = mu_d - s * R @ mu_s
    return s, R, t


# ---- 初期値 -------------------------------------------------------------------------

def initial_guess(obs: list[Obs], n_views: int, n_faces: int, K0: np.ndarray):
    """各視点・各面を PnP で解き、面どうしの相対の姿勢と、各視点のカメラの姿勢(基準の面の座標)を作る。"""
    pnp = {}
    for o in obs:
        if len(o.pts2d) < 6:
            continue
        ok, rv, tv = cv2.solvePnP(o.local3d, o.pts2d, K0, None, flags=cv2.SOLVEPNP_ITERATIVE)
        if ok:
            pnp[(o.view, o.face)] = (rv_to_R(rv), tv.ravel())
    # 面 k の基準の面(0)に対する相対の姿勢 T_ref←k を、同じ視点で両方見えた所から。つながっていない面は他の面を経由する
    rel = {0: (np.eye(3), np.zeros(3))}
    pairs: dict[tuple[int, int], list] = {}
    for v in range(n_views):
        vis = [k for k in range(n_faces) if (v, k) in pnp]
        for a in vis:
            for b in vis:
                if a == b:
                    continue
                Ra, ta = pnp[(v, a)]
                Rb, tb = pnp[(v, b)]
                # T_a←b = inv(T_cam←a) · T_cam←b
                Ria, tia = inv_T(Ra, ta)
                pairs.setdefault((a, b), []).append((Ria @ Rb, Ria @ tb + tia))
    changed = True
    while changed and len(rel) < n_faces:
        changed = False
        for (a, b), lst in pairs.items():
            if a in rel and b not in rel:
                Rr = mean_rotation([x[0] for x in lst])
                tr = np.mean([x[1] for x in lst], axis=0)
                Ra, ta = rel[a]
                rel[b] = (Ra @ Rr, Ra @ tr + ta)
                changed = True
    missing = [k for k in range(n_faces) if k not in rel]
    if missing:
        raise SystemExit(f"面 {missing} が、ほかの面と一緒に写った視点が無い(基準の面と同時に見える視点が要る)")
    cam = {}
    for v in range(n_views):
        cands = []
        for k in range(n_faces):
            if (v, k) in pnp:
                Rc, tc = pnp[(v, k)]            # T_cam←k
                Rk, tk = rel[k]                  # T_ref←k
                Rkr, tkr = inv_T(Rk, tk)         # T_k←ref
                cands.append((Rc @ Rkr, Rc @ tkr + tc))  # T_cam←ref
        if cands:
            cam[v] = (mean_rotation([c[0] for c in cands]), np.mean([c[1] for c in cands], axis=0))
    return rel, cam


# ---- 解く -----------------------------------------------------------------------------

class Problem:
    def __init__(self, faces, obs, views, use_arkit=True):
        self.faces, self.obs, self.views, self.use_arkit = faces, obs, views, use_arkit
        self.nf, self.nv = len(faces), len(views)
        self.o_view = np.concatenate([[o.view] * len(o.pts2d) for o in obs]).astype(int)
        self.o_face = np.concatenate([[o.face] * len(o.pts2d) for o in obs]).astype(int)
        self.o_pt = np.concatenate([o.local3d for o in obs])
        self.o_uv = np.concatenate([o.pts2d for o in obs])
        self.ark_rows = [v.index for v in views if v.T_ark is not None] if use_arkit else []
        self.n_intr = 6
        self.n_face = 7 * (self.nf - 1)   # 面ごとに 回転 3・移動 3・大きさ 1
        self.n_ark = 7 if self.ark_rows else 0
        self.n_cam = 6 * self.nv

    def unpack(self, x):
        i = 0
        intr = x[i:i + 6]; i += 6
        fp = x[i:i + self.n_face].reshape(-1, 7); i += self.n_face
        ark = x[i:i + self.n_ark]; i += self.n_ark
        cams = x[i:i + self.n_cam].reshape(-1, 6)
        return intr, fp, ark, cams

    def pack(self, intr, rel, cam, ark):
        parts = [np.array(intr, float)]
        for k in range(1, self.nf):
            R, t = rel[k]
            parts.append(np.concatenate([R_to_rv(R), t, [1.0]]))
        if self.n_ark:
            parts.append(np.concatenate([R_to_rv(ark[0]), ark[1], [ark[2]]]))
        for v in range(self.nv):
            R, t = cam[v]
            parts.append(np.concatenate([R_to_rv(R), t]))
        return np.concatenate(parts)

    def project(self, x, idx=None):
        intr, fp, _, cams = self.unpack(x)
        fx, fy, cx, cy, k1, k2 = intr
        Rf = np.concatenate([np.eye(3)[None], Rot.from_rotvec(fp[:, :3]).as_matrix()]) if self.nf > 1 else np.eye(3)[None]
        tf = np.concatenate([np.zeros((1, 3)), fp[:, 3:6]]) if self.nf > 1 else np.zeros((1, 3))
        sf = np.concatenate([[1.0], fp[:, 6]]) if self.nf > 1 else np.ones(1)
        Rv = Rot.from_rotvec(cams[:, :3]).as_matrix()
        tv = cams[:, 3:]
        sel = slice(None) if idx is None else idx
        of, ov, pt = self.o_face[sel], self.o_view[sel], self.o_pt[sel]
        P = sf[of][:, None] * np.einsum("nij,nj->ni", Rf[of], pt) + tf[of]
        Pc = np.einsum("nij,nj->ni", Rv[ov], P) + tv[ov]
        z = Pc[:, 2]
        xn, yn = Pc[:, 0] / z, Pc[:, 1] / z
        r2 = xn * xn + yn * yn
        d = 1 + k1 * r2 + k2 * r2 * r2
        return np.stack([fx * xn * d + cx, fy * yn * d + cy], axis=1), z

    def residuals(self, x):
        uv, z = self.project(x)
        res = [((uv - self.o_uv) / SIG_PX).ravel()]
        if self.nf > 1:
            _, fp0, _, _ = self.unpack(x)
            res.append((fp0[:, 6] - 1.0) / SIG_FACE_SCALE)
        if self.ark_rows:
            _, _, ark, cams = self.unpack(x)
            Ra, ta, s = Rot.from_rotvec(ark[:3]).as_matrix(), ark[3:6], ark[6]
            for v in self.ark_rows:
                Rv, tv = rv_to_R(cams[v, :3]), cams[v, 3:]
                C = -Rv.T @ tv
                Ta = self.views[v].T_ark
                C_pred = Ra @ (s * Ta[:3, 3]) + ta
                R_pred = Ra @ Ta[:3, :3] @ D_CV
                dR = Rv @ R_pred   # (ref←cv)^T · (ref←cv)_pred = Rv · R_pred
                res.append((C - C_pred) / SIG_POS)
                res.append(R_to_rv(dR) / SIG_ROT)
        return np.concatenate(res)

    def sparsity(self):
        n_obs = len(self.o_pt)
        n_res = 2 * n_obs + (self.nf - 1) + 6 * len(self.ark_rows)
        A = lil_matrix((n_res, self.n_intr + self.n_face + self.n_ark + self.n_cam), dtype=int)
        base_face = self.n_intr
        base_ark = base_face + self.n_face
        base_cam = base_ark + self.n_ark
        rows = np.arange(n_obs)
        for j in range(self.n_intr):
            A[2 * rows, j] = 1; A[2 * rows + 1, j] = 1
        for i in range(n_obs):
            f, v = self.o_face[i], self.o_view[i]
            if f > 0:
                for j in range(7):
                    A[2 * i, base_face + 7 * (f - 1) + j] = 1; A[2 * i + 1, base_face + 7 * (f - 1) + j] = 1
            for j in range(6):
                A[2 * i, base_cam + 6 * v + j] = 1; A[2 * i + 1, base_cam + 6 * v + j] = 1
        for f in range(1, self.nf):
            A[2 * n_obs + f - 1, base_face + 7 * (f - 1) + 6] = 1
        r0 = 2 * n_obs + (self.nf - 1)
        for n, v in enumerate(self.ark_rows):
            for j in range(self.n_ark):
                for r in range(6):
                    A[r0 + 6 * n + r, base_ark + j] = 1
            for j in range(6):
                for r in range(6):
                    A[r0 + 6 * n + r, base_cam + 6 * v + j] = 1
        return A


def solve(faces: list[Face], obs: list[Obs], views: list[View], K0: np.ndarray, use_arkit=True, verbose=0):
    prob = Problem(faces, obs, views, use_arkit)
    rel, cam = initial_guess(obs, len(views), len(faces), K0)
    for v in range(len(views)):
        cam.setdefault(v, (np.eye(3), np.array([0, 0, 3.0])))
    ark0 = None
    if prob.n_ark:
        centers = np.array([-cam[v][0].T @ cam[v][1] for v in prob.ark_rows])
        ark_c = np.array([views[v].T_ark[:3, 3] for v in prob.ark_rows])
        s, R, t = umeyama(ark_c, centers)
        ark0 = (R, t, s)
    intr0 = [K0[0, 0], K0[1, 1], K0[0, 2], K0[1, 2], 0.0, 0.0]
    x0 = prob.pack(intr0, rel, cam, ark0)
    r = least_squares(prob.residuals, x0, jac_sparsity=prob.sparsity(), loss="soft_l1", f_scale=2.0, x_scale="jac", method="trf", max_nfev=80, verbose=verbose)
    return prob, r.x, r


def report(prob: Problem, x, views: list[View]):
    intr, fp, ark, cams = prob.unpack(x)
    uv, z = prob.project(x)
    err = np.linalg.norm(uv - prob.o_uv, axis=1)
    out = {
        "K": {"fx": intr[0], "fy": intr[1], "cx": intr[2], "cy": intr[3]}, "dist": {"k1": intr[4], "k2": intr[5]},
        "reprojection_px": {"rms": float(np.sqrt(np.mean(err ** 2))), "median": float(np.median(err)), "p95": float(np.percentile(err, 95)), "max": float(err.max()), "n": int(len(err))},
        "per_face_px_rms": {prob.faces[k].name: float(np.sqrt(np.mean(err[prob.o_face == k] ** 2))) if (prob.o_face == k).any() else None for k in range(prob.nf)},
        "faces": {},
    }
    for k in range(prob.nf):
        if k == 0:
            R, t = np.eye(3), np.zeros(3)
        else:
            R, t = rv_to_R(fp[k - 1, :3]), fp[k - 1, 3:6]
        T = np.eye(4); T[:3, :3] = R; T[:3, 3] = t
        out["faces"][prob.faces[k].name] = {"scale": 1.0 if k == 0 else float(fp[k - 1, 6]), "T_ref_from_face": T.tolist(), "position_m": t.tolist(),
                                            "normal_in_ref": (R @ np.array([0, 0, 1.0])).tolist(), "yaw_deg": float(np.degrees(np.arctan2(R[0, 2], R[2, 2])))}
    if prob.n_ark:
        Ra, ta, s = rv_to_R(ark[:3]), ark[3:6], float(ark[6])
        T = np.eye(4); T[:3, :3] = Ra; T[:3, 3] = ta
        dpos, drot = [], []
        for v in prob.ark_rows:
            Rv, tv = rv_to_R(cams[v, :3]), cams[v, 3:]
            C = -Rv.T @ tv
            Ta = views[v].T_ark
            C_pred = Ra @ (s * Ta[:3, 3]) + ta
            dpos.append(np.linalg.norm(C - C_pred) * 100)
            drot.append(np.degrees(np.linalg.norm(R_to_rv(Rv @ (Ra @ Ta[:3, :3] @ D_CV)))))
        out["arkit"] = {"T_ref_from_ark": T.tolist(), "scale": s, "pose_diff_cm": {"median": float(np.median(dpos)), "p95": float(np.percentile(dpos, 95)), "max": float(np.max(dpos))},
                        "pose_diff_deg": {"median": float(np.median(drot)), "p95": float(np.percentile(drot, 95)), "max": float(np.max(drot))},
                        "note": "ARKit の姿勢と、盤から解いたカメラの姿勢の差(= ARKit のずれ+解の誤差)。縮尺が 1.00 から離れていれば、ARKit の長さか盤の大きさの仮定のずれ"}
    return out


def holdout(faces, obs, views, K0, use_arkit=True, seed=0):
    """視点の半分で解いた面の配置・レンズを使い、残りの半分の各視点を PnP し直して、角の再投影誤差を見る(取り置きの誤差)。"""
    rng = np.random.default_rng(seed)
    vs = np.array(sorted({o.view for o in obs}))
    rng.shuffle(vs)
    train = set(vs[: len(vs) // 2].tolist())
    idx = {v: i for i, v in enumerate(sorted(train))}
    v_tr = [View(idx[v.index], v.frame, v.T_ark) for v in views if v.index in train]
    o_tr = [Obs(idx[o.view], o.face, o.pts2d, o.local3d, o.ids) for o in obs if o.view in train]
    prob, x, _ = solve(faces, o_tr, v_tr, K0, use_arkit)
    intr, fp, _, _ = prob.unpack(x)
    K = np.array([[intr[0], 0, intr[2]], [0, intr[1], intr[3]], [0, 0, 1]])
    dist = np.array([intr[4], intr[5], 0, 0], float)
    errs = []
    for v in sorted(set(vs.tolist()) - train):
        ov = [o for o in obs if o.view == v]
        pts3, pts2 = [], []
        for o in ov:
            if o.face == 0:
                R, t = np.eye(3), np.zeros(3)
            else:
                R, t = rv_to_R(fp[o.face - 1, :3]), fp[o.face - 1, 3:6]
            sc = 1.0 if o.face == 0 else fp[o.face - 1, 6]
            pts3.append(sc * (R @ o.local3d.T).T + t)
            pts2.append(o.pts2d)
        if not pts3:
            continue
        p3, p2 = np.concatenate(pts3), np.concatenate(pts2)
        if len(p3) < 8:
            continue
        ok, rv, tv = cv2.solvePnP(p3, p2, K, dist, flags=cv2.SOLVEPNP_ITERATIVE)
        if not ok:
            continue
        proj, _ = cv2.projectPoints(p3, rv, tv, K, dist)
        errs.extend(np.linalg.norm(proj.reshape(-1, 2) - p2, axis=1).tolist())
    return {"views_train": len(train), "views_test": len(vs) - len(train), "px_rms": float(np.sqrt(np.mean(np.square(errs)))) if errs else None, "px_p95": float(np.percentile(errs, 95)) if errs else None}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--faces", required=True)
    ap.add_argument("--shoot", required=True)
    ap.add_argument("--out", default="multi_calib.json")
    ap.add_argument("--every", type=int, default=6)
    ap.add_argument("--min-faces-per-view", type=int, default=1)
    ap.add_argument("--no-arkit", action="store_true")
    a = ap.parse_args()
    spec = json.loads(Path(a.faces).read_text(encoding="utf-8"))
    faces = [Face(f["name"], Board(**{k: (tuple(v) if k in ("offset_px", "face_px") else v) for k, v in f["board"].items()})) for f in spec["faces"]]
    shoot = S.load_shoot(a.shoot)
    cap = cv2.VideoCapture(str(shoot.video))
    obs, views = [], []
    for i in range(0, len(shoot.frames), a.every):
        fr = shoot.frames[i]
        if not fr.get("ok", True):
            continue
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, img = cap.read()
        if not ok:
            continue
        det = detect_view(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), faces)
        if len(det) < a.min_faces_per_view:
            continue
        v = len(views)
        views.append(View(v, i, shoot.T(i)))
        for k, (c, p3, ids) in det.items():
            obs.append(Obs(v, k, c, p3, ids))
    cap.release()
    if len(views) < 6:
        raise SystemExit(f"盤が写った視点が少ない({len(views)})。6 以上要る")
    K4 = shoot.frames[views[0].frame]["K"]
    scale = float(shoot.meta.get("intrinsics_scale", 1.0))     # PC に送った記録は、K が元の 4K の画素で、映像はフル HD
    K0 = np.array([[K4[0] * scale, 0, K4[2] * scale], [0, K4[1] * scale, K4[3] * scale], [0, 0, 1]])
    prob, x, r = solve(faces, obs, views, K0, use_arkit=not a.no_arkit)
    out = report(prob, x, views)
    out["holdout"] = holdout(faces, obs, views, K0, use_arkit=not a.no_arkit)
    out["views"] = len(views)
    out["frames"] = [v.frame for v in views]
    Path(a.out).write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: out[k] for k in ("reprojection_px", "per_face_px_rms", "holdout", "views")}, ensure_ascii=False))
    if "arkit" in out:
        print("ARKit との差:", out["arkit"]["pose_diff_cm"], out["arkit"]["pose_diff_deg"], "縮尺", round(out["arkit"]["scale"], 4))


if __name__ == "__main__":
    main()
