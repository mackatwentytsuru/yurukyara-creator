"""箱の見え方の計算(座席から LED のどこが見えるか・演者が LED のどこを隠すか)。ブラウザや UE に依存しない。

座標と単位は show/ue/stage_layout.py と同じ(cm。x=0 が中央の面の真ん中、+x が客席から見て右、+y が客席、z=0 が床)。
LED の形(A・B・C の面、C の曲がりの実測)は stage_layout.py を読むだけで使い、ここへ写さない。
座席の位置・演者の立ち位置は scenario.json(仮の値。実測の座席表に差し替える入力)。

  python place/venue/venue.py [scenario.json]    各場面の見え方の数字を表示する
"""
from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def _load_layout():
    path = REPO / "show" / "ue" / "stage_layout.py"
    spec = importlib.util.spec_from_file_location("stage_layout", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


L = _load_layout()

# 舞台(sim_layout.py と同じ): 床から STAGE_Z の高さ、前の縁は y=450、幅 -800〜1060、奥は LED の裏まで
STAGE_BOX = (-800.0, 1060.0, -140.0, 450.0, 0.0, L.STAGE_Z)


def plates():
    """LED の板の一覧(show 側の割り当てのまま)。"""
    ps, _ = L.led_plates()
    return ps


def plate_points(p, step_px=8.0):
    """1 枚の板を、絵の画素で step_px おきに分けた点。返り値: 3D の点 (N,3)、絵の x・y(画素)、表の向き(単位ベクトル xy)。"""
    x0, y0 = p["start"]
    x1, y1 = p["end"]
    w_px = p["u_scale"] * L.CANVAS_W
    h_px = p["v_scale"] * L.CANVAS_H
    nu = max(2, int(round(w_px / step_px)))
    nv = max(2, int(round(h_px / step_px)))
    s = (np.arange(nu) + 0.5) / nu
    t = (np.arange(nv) + 0.5) / nv
    S, T = np.meshgrid(s, t)
    X = x0 + (x1 - x0) * S
    Y = y0 + (y1 - y0) * S
    Z = L.LED_Z_TOP - (L.LED_Z_TOP - L.LED_Z_BOTTOM) * T
    cx = (p["u_offset"] + p["u_scale"] * S) * L.CANVAS_W
    cy = (p["v_offset"] + p["v_scale"] * T) * L.CANVAS_H
    tx, ty = (x1 - x0) / p["width"], (y1 - y0) / p["width"]
    normal = np.array([-ty, tx])
    pts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    return pts, cx.ravel(), cy.ravel(), normal, (nv, nu)


def _hit_cylinder(eye, pts, cyl):
    """目 → 各点の線分が、垂直な円柱(中心 xy・半径・z の範囲)に当たるか。"""
    cx, cy = cyl["x"], cyl["y"]
    r = cyl["radius"]
    z0, z1 = cyl["z0"], cyl["z1"]
    d = pts - eye
    ex, ey = eye[0] - cx, eye[1] - cy
    a = d[:, 0] ** 2 + d[:, 1] ** 2
    b = 2 * (ex * d[:, 0] + ey * d[:, 1])
    c = ex * ex + ey * ey - r * r
    disc = b * b - 4 * a * c
    ok = (disc > 0) & (a > 1e-9)
    sq = np.sqrt(np.where(ok, disc, 0))
    sa = np.where(ok, (-b - sq) / (2 * np.where(a > 1e-9, a, 1)), 2.0)
    sb = np.where(ok, (-b + sq) / (2 * np.where(a > 1e-9, a, 1)), 2.0)
    lo = np.maximum(sa, 0.0)
    hi = np.minimum(sb, 1.0)
    # z(s) = eye_z + s * dz。z が [z0, z1] に入る s の区間
    dz = d[:, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        s0 = (z0 - eye[2]) / dz
        s1 = (z1 - eye[2]) / dz
    zlo = np.where(np.abs(dz) < 1e-9, np.where((eye[2] >= z0) & (eye[2] <= z1), -1e9, 1e9), np.minimum(s0, s1))
    zhi = np.where(np.abs(dz) < 1e-9, np.where((eye[2] >= z0) & (eye[2] <= z1), 1e9, -1e9), np.maximum(s0, s1))
    return ok & (np.maximum(lo, zlo) <= np.minimum(hi, zhi))


def _hit_box(eye, pts, box):
    x0, x1, y0, y1, z0, z1 = box
    d = pts - eye
    tmin = np.zeros(len(pts))
    tmax = np.ones(len(pts))
    hit = np.ones(len(pts), bool)
    for axis, (lo, hi) in enumerate([(x0, x1), (y0, y1), (z0, z1)]):
        da = d[:, axis]
        small = np.abs(da) < 1e-9
        with np.errstate(divide="ignore", invalid="ignore"):
            t1 = (lo - eye[axis]) / da
            t2 = (hi - eye[axis]) / da
        tn = np.where(small, -1e9, np.minimum(t1, t2))
        tf = np.where(small, 1e9, np.maximum(t1, t2))
        inside = (eye[axis] >= lo) & (eye[axis] <= hi)
        hit &= np.where(small, inside, True)
        tmin = np.maximum(tmin, tn)
        tmax = np.minimum(tmax, tf)
    # LED の点そのもの(s=1)に触れるだけの接触は数えない
    return hit & (tmin <= tmax) & (tmin < 0.999)


def performer_cylinder(perf, stage_z=L.STAGE_Z):
    return {"x": perf["x"], "y": perf["y"], "radius": perf.get("radius", 30.0),
            "z0": stage_z, "z1": stage_z + perf.get("height", 160.0)}


def view(eye, performers, step_px=8.0, use_stage=True):
    """目の位置から見た各板の見え方。

    返り値 plates[名前] = {hidden_by_performer, hidden_by_stage, visible, mean_cos, min_cos, 隠れる所の絵の範囲}
    と、板ごとの点・マスク(絵を作る用)。
    """
    eye = np.array(eye, float)
    cyls = [performer_cylinder(p) for p in performers]
    out = {}
    detail = {}
    for p in plates():
        pts, cx, cy, normal, shape = plate_points(p, step_px)
        hid_p = np.zeros(len(pts), bool)
        for c in cyls:
            hid_p |= _hit_cylinder(eye, pts, c)
        hid_s = _hit_box(eye, pts, STAGE_BOX) if use_stage else np.zeros(len(pts), bool)
        # 板の裏側から見る(客席が板の表の向きと逆)点は見えない
        to_eye = eye - pts
        dist = np.linalg.norm(to_eye, axis=1)
        cosv = (to_eye[:, 0] * normal[0] + to_eye[:, 1] * normal[1]) / dist
        back = cosv <= 0
        hid_p &= ~hid_s
        n = len(pts)

        def rng(mask):
            if not mask.any():
                return None
            return {"x": [round(float(cx[mask].min())), round(float(cx[mask].max()))],
                    "y": [round(float(cy[mask].min())), round(float(cy[mask].max()))]}

        out[p["name"]] = {
            "hidden_by_performer": round(float(hid_p.mean()), 4),
            "hidden_by_stage": round(float(hid_s.mean()), 4),
            "backside": round(float(back.mean()), 4),
            "visible": round(float((~hid_p & ~hid_s & ~back).mean()), 4),
            "mean_cos": round(float(cosv.mean()), 3),
            "min_cos": round(float(cosv.min()), 3),
            "performer_range_px": rng(hid_p),
            "stage_range_px": rng(hid_s),
            "width_cm": round(p["width"], 1),
        }
        detail[p["name"]] = {"cx": cx, "cy": cy, "hid_p": hid_p, "hid_s": hid_s, "back": back, "cos": cosv, "shape": shape}
    return out, detail


def group_faces(plate_view):
    """板の数字を、A・B・C の面ごとに、面積(板の幅×高さの比)で重みをつけてまとめる。"""
    faces = {"A": [], "B": [], "C": []}
    for name, v in plate_view.items():
        face = "A" if name == "LED_A" else ("B" if name.startswith("LED_B") else "C")
        faces[face].append(v)
    res = {}
    for f, items in faces.items():
        wsum = sum(i["width_cm"] for i in items)
        def avg(k):
            return round(sum(i[k] * i["width_cm"] for i in items) / wsum, 3)
        res[f] = {"hidden_by_performer": avg("hidden_by_performer"), "hidden_by_stage": avg("hidden_by_stage"),
                  "visible": avg("visible"), "min_cos": round(min(i["min_cos"] for i in items), 3),
                  "width_cm": round(wsum, 1)}
    return res


def load_scenario(path=None):
    path = Path(path) if path else HERE / "scenario.json"
    return json.loads(path.read_text(encoding="utf-8"))


def run(path=None, step_px=8.0):
    sc = load_scenario(path)
    results = []
    for seat in sc["seats"]:
        for perf in sc["performer_sets"]:
            pv, _ = view(seat["eye"], perf["performers"], step_px)
            results.append({"seat": seat["id"], "seat_name": seat["name"], "perf": perf["id"], "perf_name": perf["name"],
                            "faces": group_faces(pv), "plates": pv})
    return {"scenario": sc.get("note", ""), "results": results}


if __name__ == "__main__":
    res = run(sys.argv[1] if len(sys.argv) > 1 else None)
    print(res["scenario"])
    for r in res["results"]:
        f = r["faces"]
        print(f"{r['seat_name']} × {r['perf_name']}: " + "、".join(
            f"{k}面 見える {v['visible']*100:.0f}%(演者に隠れる {v['hidden_by_performer']*100:.1f}%・舞台に隠れる {v['hidden_by_stage']*100:.1f}%・いちばん斜め cos {v['min_cos']})" for k, v in f.items()))
