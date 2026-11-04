"""点の校正のレイ(アプリの calibration_rays.json)→ LED の面ごとの alignment_<面>.json。

  from dots_align import solve, write_alignments
  result = solve(rays)                       # 解く(place/web/ar_show.js の solveDots と solveAlign と同じ決まり)
  write_alignments(shoot_dir, result)        # alignment_A/B/C.json(show/composite/shoot_track.py が読む形)
  python place/shootlog/dots_align.py <calibration_rays.json> [--out <撮影フォルダ>]

標準ライブラリだけで動く(Mac の python3 に numpy が無くても)。LED の面・点の座標は show/ue/stage_layout.py から読む
(リポジトリの中なら ../../show/ue、無ければこのファイルと同じフォルダの stage_layout.py)。
決まり(ar_show.js と同じ):
  - 点の座標は「ページの LED の座標」= 舞台の (X − A_X0, Z − LED_Z_BOTTOM, Y) / 100 m(x 右、y 上、z 客席のほう)。
  - 未知数は y 回りの回転 θ と平行移動 t の 4 つ(ARKit は重力に合わせてあるので)。θ を 2° おきに総当たり → 前後 2° を三分探索 40 回。
    θ ごとに t は最小二乗の閉じた式(Σ(I − d dᵀ) の逆行列)。
  - 外れ: 残差(cm)の中央値 med、lim = max(1.5, 2.5·med) を超えるレイを除いて解き直す(4 回まで、残りが 6 本未満なら止める)。
  - 良い解: 使った点が 10 以上、rms ≤ 上限(アプリの URL の dot_rms = 4 cm)。足りなければ alignment を書かない。
alignment_<面> は、面の左下が原点・x が面の右・y が上・z が客席のほう(shootlib.led_corners と同じ)。面 C は端と端を結ぶ平らな板とみなす。
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
for _cand in (HERE.parents[1] / "show" / "ue", HERE):
    if (_cand / "stage_layout.py").exists():
        sys.path.append(str(_cand))
        break
from stage_layout import (A_X0, A_X1, B_PX_X0, B_PX_X1, B_PX_Y0, B_PX_Y1, B_X_HALF, B_Y, C_CURVE_MEASURED,  # noqa: E402
                          C_FLAT_X0, C_PX_X0, LED_HEIGHT, LED_Z_BOTTOM, LED_Z_TOP, PANEL_W_CM)

MIN_DOTS = 10          # ar_show.js: nDots >= 10
DEFAULT_MAX_RMS_CM = 4.0   # アプリの AR ページの URL(dot_rms=4)
PITCH_CM = PANEL_W_CM / 80.0   # A・C の絵 1 画素の大きさ(LED のパネルは 80 画素)


def dot_table():
    """33 点(番号順: A 3×3、B 5×3、C 3×3)。[{k, face, stage_cm: (X, Y, Z), p: ページの LED の座標 m}]。make_led_dots_video.dots() と同じ決まり。"""
    out = []

    def add(face, cols, rows, rx, ry, rw, rh, stage):
        for r in range(rows):
            for c in range(cols):
                px = rx + (0.1 + 0.8 * c / (cols - 1)) * rw
                py = ry + (0.15 + 0.7 * r / (rows - 1)) * rh
                X, Y, Z = stage(px, py)
                out.append({"k": len(out), "face": face, "stage_cm": (X, Y, Z), "p": page_point(X, Y, Z)})

    b_x_scale = 2 * B_X_HALF / (B_PX_X1 - B_PX_X0)
    b_z_scale = LED_HEIGHT / (B_PX_Y1 - B_PX_Y0)
    add("A", 3, 3, 0, 0, 956, 1240, lambda x, y: (A_X0 + x * PITCH_CM, 0.0, LED_Z_TOP - y * PITCH_CM))
    add("B", 5, 3, 1280, 85, 1759, 1133, lambda x, y: (-B_X_HALF + (x - B_PX_X0) * b_x_scale, B_Y, LED_Z_TOP - (y - B_PX_Y0) * b_z_scale))
    add("C", 3, 3, 3346, 0, 943, 1240, lambda x, y: (C_FLAT_X0 + (x - C_PX_X0) * PITCH_CM, 0.0, LED_Z_TOP - y * PITCH_CM))
    return out


def page_point(X, Y, Z):
    """舞台の (X, Y, Z) cm → ページの LED の座標 m。"""
    return ((X - A_X0) / 100.0, (Z - LED_Z_BOTTOM) / 100.0, Y / 100.0)


DOTS = dot_table()


# ---- 3×3 の計算(numpy なし) -------------------------------------------------------------

def _inv3(m):
    a, b, c = m[0]
    d, e, f = m[1]
    g, h, i = m[2]
    det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    if abs(det) < 1e-12:
        return None
    k = 1.0 / det
    return [[(e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k],
            [(f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k],
            [(d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k]]


def _rot_y(theta, p):
    c, s = math.cos(theta), math.sin(theta)
    return (c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2])


def _perp(v, d):
    """v から d 方向の成分を除いた長さ(点とレイの距離)。"""
    along = v[0] * d[0] + v[1] * d[1] + v[2] * d[2]
    return math.sqrt(max(0.0, sum((v[k] - along * d[k]) ** 2 for k in range(3))))


def _unit(v):
    n = math.sqrt(sum(x * x for x in v))
    return (v[0] / n, v[1] / n, v[2] / n) if n > 0 else (0.0, 0.0, 0.0)


def _cost(rays, theta):
    """θ を決めたときの、最小二乗の t と誤差の二乗和。rays は [(p, o, d)]。"""
    A = [[0.0] * 3 for _ in range(3)]
    b = [0.0, 0.0, 0.0]
    rp = [_rot_y(theta, r[0]) for r in rays]
    for (_, o, d), q in zip(rays, rp):
        M = [[1 - d[0] * d[0], -d[0] * d[1], -d[0] * d[2]], [-d[1] * d[0], 1 - d[1] * d[1], -d[1] * d[2]], [-d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2]]]
        diff = (o[0] - q[0], o[1] - q[1], o[2] - q[2])
        for a in range(3):
            for c in range(3):
                A[a][c] += M[a][c]
            b[a] += M[a][0] * diff[0] + M[a][1] * diff[1] + M[a][2] * diff[2]
    inv = _inv3(A)
    if inv is None:
        return float("inf"), None
    t = tuple(inv[a][0] * b[0] + inv[a][1] * b[1] + inv[a][2] * b[2] for a in range(3))
    e = 0.0
    for (_, o, d), q in zip(rays, rp):
        v = (q[0] + t[0] - o[0], q[1] + t[1] - o[1], q[2] + t[2] - o[2])
        e += _perp(v, d) ** 2
    return e, t


def solve_align(rays):
    """ar_show.js の solveAlign。rays は [(p, o, d)]。戻り: {theta, t, rms_cm, yaw_deg, n, errs}、解けなければ None。"""
    if len(rays) < 3:
        return None
    best = (float("inf"), 0.0, None)
    for k in range(180):
        th = -math.pi + k / 180 * 2 * math.pi
        e, t = _cost(rays, th)
        if e < best[0]:
            best = (e, th, t)
    if best[2] is None:
        return None
    lo, hi = best[1] - math.pi / 90, best[1] + math.pi / 90
    for _ in range(40):
        m1, m2 = lo + (hi - lo) / 3, hi - (hi - lo) / 3
        if _cost(rays, m1)[0] < _cost(rays, m2)[0]:
            hi = m2
        else:
            lo = m1
    th = (lo + hi) / 2
    e, t = _cost(rays, th)
    if t is None:
        return None
    errs = []
    for p, o, d in rays:
        q = _rot_y(th, p)
        errs.append(_perp((q[0] + t[0] - o[0], q[1] + t[1] - o[1], q[2] + t[2] - o[2]), d) * 100)
    return {"theta": th, "t": t, "rms_cm": math.sqrt(e / len(rays)) * 100, "yaw_deg": math.degrees(th), "n": len(rays), "errs": errs}


def _usable(rays):
    """レイの JSON(配列)→ [(dot 番号, 点 p, o, d)]。ar_show.js の solveAlign と同じく face が 'A' の物だけ(アプリは全部 'A' で送る)。"""
    out = []
    for r in rays or []:
        try:
            k = r["dot"]
            if r.get("face") != "A" or not isinstance(k, int) or not 0 <= k < len(DOTS):
                continue
            o = tuple(float(v) for v in r["origin"])
            d = _unit(tuple(float(v) for v in r["direction"]))
            if len(o) == 3 and d != (0.0, 0.0, 0.0):
                out.append((k, DOTS[k]["p"], o, d))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def _matrix(theta, t):
    c, s = math.cos(theta), math.sin(theta)
    return [[c, 0.0, s, t[0]], [0.0, 1.0, 0.0, t[1]], [-s, 0.0, c, t[2]], [0.0, 0.0, 0.0, 1.0]]


def solve(rays, max_rms_cm=DEFAULT_MAX_RMS_CM, min_dots=MIN_DOTS):
    """点のレイ → 結果の dict。ok が True のときだけ alignment に使ってよい。reason は ok が False の理由(日本語)。

    戻り: ok, reason, T(ページの LED の座標 → ARKit の世界、4×4 の行の並び), yaw_deg, rms_cm, n_rays, n_rays_all, n_dots,
          face_residual_cm({面: 全部のレイの残差の中央値}), face_dots({面: 使った点の数})。
    """
    items = _usable(rays)
    n_all = len(items)
    if n_all == 0:
        has_corner = any(isinstance(r, dict) and "dot" not in r for r in rays or [])
        return {"ok": False, "reason": "点のレイが無い" + ("(4 隅の校正のレイだけ。点の校正ではない)" if has_corner else "(点の映像を見せて校正してから録る)"), "n_rays_all": 0, "n_dots": 0}
    use = items
    r = None
    for _ in range(4):
        r = solve_align([(p, o, d) for _, p, o, d in use])
        if r is None:
            return {"ok": False, "reason": "レイから位置を解けない(レイが平行、または 3 本未満)", "n_rays_all": n_all, "n_dots": len({k for k, *_ in use})}
        errs = sorted(r["errs"])
        med = errs[len(errs) // 2]
        lim = max(1.5, 2.5 * med)
        kept = [it for it, e in zip(use, r["errs"]) if e <= lim]
        if len(kept) == len(use) or len(kept) < 6:
            break
        use = kept
    T = _matrix(r["theta"], r["t"])
    # 面ごとの残差: 外す前の全部のレイで(面が図面からずれていると、外れとして除かれて、除いた後には出ないため)
    per_face: dict[str, list[float]] = {}
    for k, p, o, d in items:
        q = _rot_y(r["theta"], p)
        per_face.setdefault(DOTS[k]["face"], []).append(_perp((q[0] + r["t"][0] - o[0], q[1] + r["t"][1] - o[1], q[2] + r["t"][2] - o[2]), d) * 100)
    face_res = {f: round(sorted(v)[len(v) // 2], 2) for f, v in per_face.items()}
    face_dots: dict[str, int] = {}
    for k in {k for k, *_ in use}:
        face_dots[DOTS[k]["face"]] = face_dots.get(DOTS[k]["face"], 0) + 1
    n_dots = len({k for k, *_ in use})
    out = {"ok": True, "reason": "", "T": T, "yaw_deg": r["yaw_deg"], "rms_cm": r["rms_cm"], "n_rays": r["n"], "n_rays_all": n_all, "n_dots": n_dots,
           "face_residual_cm": face_res, "face_dots": face_dots, "max_rms_cm": max_rms_cm}
    if n_dots < min_dots:
        out.update(ok=False, reason=f"点が足りない({n_dots} 点。{min_dots} 点以上要る)")
    elif r["rms_cm"] > max_rms_cm:
        out.update(ok=False, reason=f"残差が大きい({r['rms_cm']:.1f} cm。{max_rms_cm:g} cm 以下でないと使わない)")
    return out


# ---- alignment_<面>.json -----------------------------------------------------------------

def face_ends():
    """面の左端・右端の舞台の位置 (x, y) cm。show/composite/shoot_track.py の FACE_ENDS と同じ(C は端と端を結ぶ平らな板)。"""
    return {"A": ((A_X0, 0.0), (A_X1, 0.0)), "B": ((-B_X_HALF, B_Y), (B_X_HALF, B_Y)), "C": ((C_FLAT_X0, 0.0), tuple(C_CURVE_MEASURED[-1]))}


def _mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def _inv_rigid(m):
    r = [[m[j][i] for j in range(3)] for i in range(3)]
    t = [-sum(r[i][k] * m[k][3] for k in range(3)) for i in range(3)]
    return [r[0] + [t[0]], r[1] + [t[1]], r[2] + [t[2]], [0.0, 0.0, 0.0, 1.0]]


def face_frame(face):
    """面の座標(左下が原点・x が面の右・y が上・z が客席のほう)→ ページの LED の座標、の 4×4 と、面の大きさ m。"""
    (x0, y0), (x1, y1) = face_ends()[face]
    width = math.hypot(x1 - x0, y1 - y0)
    ex = ((x1 - x0) / width, 0.0, (y1 - y0) / width)       # ページの LED の座標での面の右(x, y=上, z=客席)
    ey = (0.0, 1.0, 0.0)
    ez = (ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0])
    o = page_point(x0, y0, LED_Z_BOTTOM)
    m = [[ex[0], ey[0], ez[0], o[0]], [ex[1], ey[1], ez[1], o[1]], [ex[2], ey[2], ez[2], o[2]], [0.0, 0.0, 0.0, 1.0]]
    return m, (width / 100.0, LED_HEIGHT / 100.0)


def face_docs(T_world_from_page, extra):
    """ページの LED の座標 → 世界の 4×4 から、面ごとの alignment の dict を作る(面の形は図面から)。extra は各面にそのまま足す項目。"""
    out = {}
    for face in "ABC":
        frame, size = face_frame(face)
        T = _mul(T_world_from_page, frame)
        out[face] = {"face": face, "led_size_m": [size[0], size[1]], "T_world_from_led": T, "T_led_from_world": _inv_rigid(T),
                     "yaw_deg": math.degrees(math.atan2(T[0][2], T[0][0])), "led_origin_world": [T[0][3], T[1][3], T[2][3]], **extra(face)}
    return out


def stage_world_docs(extra):
    """世界が舞台の座標そのもの(右手系 m、x 右・y 上・z 客席。原点は舞台の原点: x=0 が中央の面の真ん中、y=0 が床)のとき。
    超広角の固定カット(uw_fixed_camera.py)用。ページの LED の座標からは (A_X0, LED_Z_BOTTOM, 0)/100 だけずれる。"""
    T = [[1.0, 0.0, 0.0, A_X0 / 100.0], [0.0, 1.0, 0.0, LED_Z_BOTTOM / 100.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]
    return face_docs(T, extra)


def alignments(result):
    """solve の結果(ok)→ {面: alignment の dict}。"""
    if not result.get("ok"):
        raise ValueError("校正が使えない: " + result.get("reason", ""))
    return face_docs(result["T"], lambda face: {
        "source": "dots", "rms_cm": round(result["rms_cm"], 3), "face_residual_cm": result["face_residual_cm"].get(face),
        "dots_used": result["n_dots"], "dots_used_on_face": result["face_dots"].get(face, 0),
        "rays_used": result["n_rays"], "rays_total": result["n_rays_all"], "arSessionId": result.get("arSessionId"),
        "notes": "点の校正から(dots_align.py)。面ごとの形は舞台の図面(stage_layout.py)から。face_residual_cm は、その面の点のレイと解いた位置との距離の中央値(外れを除く前の全部のレイ)。"})


def write_alignments(shoot_dir, result):
    """alignment_A/B/C.json を shoot_dir に書く。書いたパスの一覧を返す。"""
    paths = []
    for face, doc in alignments(result).items():
        p = Path(shoot_dir) / f"alignment_{face}.json"
        p.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
        paths.append(p)
    return paths


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("rays_json", help="calibration_rays.json(受け手が書く)、またはレイの配列の JSON")
    ap.add_argument("--out", help="alignment を書く撮影フォルダ(無ければ解くだけ)")
    ap.add_argument("--max-rms-cm", type=float, default=DEFAULT_MAX_RMS_CM)
    a = ap.parse_args()
    doc = json.loads(Path(a.rays_json).read_text(encoding="utf-8"))
    rays = doc.get("rays") if isinstance(doc, dict) else doc
    res = solve(rays, max_rms_cm=a.max_rms_cm)
    print(json.dumps({k: v for k, v in res.items() if k != "T"}, ensure_ascii=False))
    if a.out and res["ok"]:
        for p in write_alignments(a.out, res):
            print("書いた:", p)
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
