"""まるい部品の道具(Blender の Python + numpy)。絵の輪郭に面を合わせず、式の形から、どの向きでもへこまない網を作る。

考え方
- 形 = 楕円体・超楕円体を「やわらかい和」でつないだ式。点を入れると、面までのおよその距離を返す(中が負)。
- 網 = 立方体を球にふくらませた四角の格子(極が無く、四角の大きさがそろう)の点を、形の中の 1 点から外へ光線で飛ばして面に載せる。
  形がその点から見て「星形」(どの向きの光線も面を 1 回だけ出る)なら、へこみも穴も出ない。外れた光線の数は数えて返す。
- 輪郭の殻 = 面の点を、式の向き(法線)へ t だけ外へ出し、面を裏返した複製。粗い格子で作ってもよい(三角形の節約)。
- 顔の模様(仮面・鼻・ほお・おなか・目・口) = 2D の輪郭の内側を、まん中の点と輪の列で区切った格子。光線で同じ式の面に載せ、
  面の向きへ少し持ち上げる。持ち上げの量を輪ごとに変えると、ふくらんだレンズ(目)になる。
- 管(腕・しっぽ) = 中心線に沿って、ねじれの少ない枠で輪を並べ、両端を半球でとじる。
- 回した形(耳) = 断面の(半径・高さ)の列を軸のまわりに回す。耳のように平たくするときは、片方の向きだけ縮める。
向きは Blender の世界(正面が -Y、上が +Z)。長さはメートル。
"""
import math

import bpy
import numpy as np

import m00_prims as P


# ---------------- 式の形 ----------------

def blob(c, r, n=2.0, k=0.0, rot=None, cut=False):
    """楕円体(n = 2)か超楕円体(n > 2 で角ばる)。k = それまでの形とつなぐ丸みの大きさ(m)。cut = True でけずる。"""
    return dict(c=np.asarray(c, float), r=np.asarray(r, float), n=float(n), k=float(k),
                R=np.eye(3) if rot is None else np.asarray(rot, float), cut=bool(cut))


def _one(p, b):
    q = (p - b["c"]) @ b["R"]
    r = b["r"]
    if b["n"] == 2.0:
        k0 = np.sqrt(((q / r) ** 2).sum(1))
        k1 = np.sqrt(((q / (r * r)) ** 2).sum(1))
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
    f = (np.abs(q / r) ** b["n"]).sum(1) ** (1.0 / b["n"])
    return (f - 1.0) * r.min()


def smin(a, b, k):
    if k <= 0.0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def sdf(p, blobs):
    """点の列 (N, 3) → 面までのおよその距離 (N,)。中が負。"""
    p = np.asarray(p, float)
    if callable(blobs):
        return blobs(p)
    d = None
    for b in blobs:
        e = _one(p, b)
        if d is None:
            d = e
        elif b["cut"]:
            d = -smin(-d, e, b["k"])
        else:
            d = smin(d, e, b["k"])
    return d


def normals(p, blobs, eps=2e-4):
    """式の傾き(外向きの法線)。"""
    p = np.asarray(p, float)
    g = np.zeros_like(p)
    for i in range(3):
        e = np.zeros(3)
        e[i] = eps
        g[:, i] = sdf(p + e, blobs) - sdf(p - e, blobs)
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-12)


# ---------------- 網 ----------------

def quad_sphere(n):
    """立方体の 6 面を n×n に割って球へふくらませた向きの列と、外向きの四角の面。"""
    t = np.tan(np.linspace(-math.pi / 4, math.pi / 4, n + 1))
    t[0], t[-1] = -1.0, 1.0
    index, verts, faces = {}, [], []
    for axis in range(3):
        ua, va = ((1, 2), (2, 0), (0, 1))[axis]
        for sign in (1.0, -1.0):
            ids = np.empty((n + 1, n + 1), int)
            for i in range(n + 1):
                for j in range(n + 1):
                    p = [0.0, 0.0, 0.0]
                    p[axis], p[ua], p[va] = sign, t[i], t[j]
                    v = np.array(p) / math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2)
                    key = (round(v[0], 6) + 0.0, round(v[1], 6) + 0.0, round(v[2], 6) + 0.0)
                    if key not in index:
                        index[key] = len(verts)
                        verts.append(v)
                    ids[i, j] = index[key]
            for i in range(n):
                for j in range(n):
                    q = (int(ids[i, j]), int(ids[i + 1, j]), int(ids[i + 1, j + 1]), int(ids[i, j + 1]))
                    faces.append(q if sign > 0 else q[::-1])
    return np.array(verts), faces


def radial_surface(center, dirs, blobs, tmax, steps=200):
    """center から dirs の向きへ光線を飛ばし、形を出る最初の点を返す。(点の列, もう一度入り直す光線の数)。"""
    c = np.asarray(center, float)
    ts = np.linspace(0.0, tmax, steps)
    d = np.empty((len(dirs), steps))
    for s in range(steps):
        d[:, s] = sdf(c + dirs * ts[s], blobs)
    if (d[:, 0] >= 0).any():
        raise RuntimeError("網の中心が形の外にある")
    out = d > 0
    if not out.any(1).all():
        raise RuntimeError("光線が面に届かない(tmax を長く)")
    k = out.argmax(1)
    reenter = int(sum(1 for i in range(len(dirs)) if (d[i, k[i]:] < 0).any()))
    lo, hi = ts[k - 1].copy(), ts[k].copy()
    for _ in range(36):
        mid = 0.5 * (lo + hi)
        inside = sdf(c + dirs * mid[:, None], blobs) < 0
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    return c + dirs * (0.5 * (lo + hi))[:, None], reenter


def ray_hits(starts, direction, blobs, tmax, steps=240):
    """starts から direction へまっすぐ進み、最初に形へ入る点。(点の列, 当たったか)。"""
    s0 = np.asarray(starts, float)
    D = np.asarray(direction, float)
    D = D / np.linalg.norm(D)
    if D.ndim == 1:
        D = np.repeat(D[None, :], len(s0), 0)
    ts = np.linspace(0.0, tmax, steps)
    d = np.empty((len(s0), steps))
    for s in range(steps):
        d[:, s] = sdf(s0 + D * ts[s], blobs)
    inside = d < 0
    ok = inside.any(1) & (d[:, 0] > 0)
    k = np.maximum(inside.argmax(1), 1)
    lo, hi = ts[k - 1].copy(), ts[k].copy()
    for _ in range(36):
        mid = 0.5 * (lo + hi)
        ins = sdf(s0 + D * mid[:, None], blobs) < 0
        hi = np.where(ins, mid, hi)
        lo = np.where(ins, lo, mid)
    return s0 + D * (0.5 * (lo + hi))[:, None], ok


def make(name, verts, faces, mat=None, smooth=True):
    return P._make(name, [tuple(float(x) for x in v) for v in verts], faces, mat, (0, 0, 0), (0, 0, 0), smooth=smooth)


def signed_volume(verts, faces):
    v = np.asarray(verts, float)
    vol = 0.0
    for f in faces:
        a = v[f[0]]
        for i in range(1, len(f) - 1):
            vol += np.dot(a, np.cross(v[f[i]], v[f[i + 1]]))
    return vol / 6.0


def outward(verts, faces):
    """閉じた形の面を外向きにそろえる(符号つきの体積が負なら全部裏返す)。"""
    return faces if signed_volume(verts, faces) >= 0 else [tuple(f[::-1]) for f in faces]


def implicit_part(name, blobs, center, n, tmax, mat):
    """式の形を、四角の格子の網にする。(物, 入り直した光線の数)。"""
    dirs, faces = quad_sphere(n)
    pts, bad = radial_surface(center, dirs, blobs, tmax)
    return make(name, pts, faces, mat), bad


def implicit_shell(name, blobs, center, n, tmax, thick, mat):
    """輪郭の殻: 粗い格子を面に載せ、法線の向きへ thick だけ外へ出して裏返す。"""
    dirs, faces = quad_sphere(n)
    pts, _ = radial_surface(center, dirs, blobs, tmax)
    pts = pts + normals(pts, blobs) * thick
    ob = make(name, pts, [f[::-1] for f in faces], mat)
    ob["surface_only"] = True
    return ob


def offset_shell(ob, thick, mat, name=None):
    """網の物を、頂点の法線の向きへ thick だけ外へ出して裏返す(管・回した形の殻)。"""
    sh = P.outline(ob, thick, mat, name)
    sh["surface_only"] = True
    return sh


# ---------------- 管と回した形 ----------------

def catmull(pts, per=8):
    """点の列をなめらかな曲線で per 倍に増やす(端は同じ点をくりかえす)。"""
    p = [np.asarray(x, float) for x in pts]
    out = []
    for i in range(len(p) - 1):
        p0, p1, p2, p3 = p[max(i - 1, 0)], p[i], p[i + 1], p[min(i + 2, len(p) - 1)]
        for j in range(per):
            t = j / per
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(p[-1])
    return np.array(out)


def sweep(name, pts, radii, n=20, per=8, cap=(True, True), cap_rings=6, flat=1.0, mat=None, up=(0.0, 0.0, 1.0), cap_depth=(1.0, 1.0)):
    """中心線 pts(半径 radii)に沿う管。ねじれの少ない枠(二重の鏡映し)で輪を並べ、両端を半球でとじる。"""
    C = catmull(pts, per)
    rr = np.interp(np.linspace(0, len(radii) - 1, len(C)), np.arange(len(radii)), np.asarray(radii, float))
    T = np.gradient(C, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    ref = np.asarray(up, float)
    if abs(np.dot(ref, T[0])) > 0.9:
        ref = np.array([1.0, 0.0, 0.0])
    U = [np.cross(T[0], ref)]
    U[0] /= np.linalg.norm(U[0])
    for i in range(len(C) - 1):
        v1 = C[i + 1] - C[i]
        c1 = np.dot(v1, v1)
        rl = U[i] - (2 / c1) * np.dot(v1, U[i]) * v1
        tl = T[i] - (2 / c1) * np.dot(v1, T[i]) * v1
        v2 = T[i + 1] - tl
        c2 = np.dot(v2, v2)
        u = rl - (2 / c2) * np.dot(v2, rl) * v2 if c2 > 1e-12 else rl
        U.append(u / np.linalg.norm(u))
    U = np.array(U)
    W = np.cross(T, U)
    th = np.linspace(0, 2 * math.pi, n, endpoint=False)
    ring = lambda c, u, w, r: [c + r * (math.cos(a) * u + flat * math.sin(a) * w) for a in th]  # noqa: E731
    rings = []
    if cap[0]:
        for k in range(cap_rings, 0, -1):
            ph = math.pi / 2 * k / (cap_rings + 1)
            rings.append(ring(C[0] - T[0] * rr[0] * cap_depth[0] * math.sin(ph), U[0], W[0], rr[0] * math.cos(ph)))
    for i in range(len(C)):
        rings.append(ring(C[i], U[i], W[i], rr[i]))
    if cap[1]:
        for k in range(1, cap_rings + 1):
            ph = math.pi / 2 * k / (cap_rings + 1)
            rings.append(ring(C[-1] + T[-1] * rr[-1] * cap_depth[1] * math.sin(ph), U[-1], W[-1], rr[-1] * math.cos(ph)))
    verts = [v for r in rings for v in r]
    faces = []
    m = len(rings)
    for j in range(m - 1):
        for i in range(n):
            a, b = j * n + i, j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    for end, ok in ((0, cap[0]), (m - 1, cap[1])):
        pole = C[0] - T[0] * rr[0] * cap_depth[0] if end == 0 else C[-1] + T[-1] * rr[-1] * cap_depth[1]
        c = len(verts)
        verts.append(pole if ok else (C[0] if end == 0 else C[-1]))
        for i in range(n):
            a, b = end * n + i, end * n + (i + 1) % n
            faces.append((c, b, a) if end == 0 else (c, a, b))
    return make(name, verts, outward(verts, faces), mat)


def round_cone_profile(r1, r2, length, n=26):
    """丸い円すい(根元の球 r1・先の球 r2・中心の間 length)の断面。(半径, 高さ) を下の極から上の極へ。"""
    a = math.asin(max(min((r1 - r2) / length, 0.999), -0.999))
    pts = []
    k1 = max(4, int(n * 0.45))
    for i in range(k1 + 1):
        ang = -math.pi / 2 + (a + math.pi / 2) * i / k1
        pts.append((r1 * math.cos(ang), r1 * math.sin(ang)))
    b0 = np.array([r1 * math.cos(a), r1 * math.sin(a)])
    b1 = np.array([r2 * math.cos(a), length + r2 * math.sin(a)])
    k2 = max(3, int(n * 0.3))
    for i in range(1, k2):
        q = b0 + (b1 - b0) * i / k2
        pts.append((q[0], q[1]))
    k3 = max(4, int(n * 0.35))
    for i in range(k3 + 1):
        ang = a + (math.pi / 2 - a) * i / k3
        pts.append((r2 * math.cos(ang), length + r2 * math.sin(ang)))
    pts[0] = (0.0, pts[0][1])
    pts[-1] = (0.0, pts[-1][1])
    return pts


def spin(name, prof, origin, axis, side, n=24, flat=1.0, mat=None):
    """断面 prof [(半径, 高さ)…](両端は半径 0 の極)を axis のまわりに回す。flat で side と直角の向きを縮める。"""
    o = np.asarray(origin, float)
    a = np.asarray(axis, float)
    a /= np.linalg.norm(a)
    u = np.asarray(side, float)
    u = u - a * np.dot(u, a)
    u /= np.linalg.norm(u)
    w = np.cross(a, u)
    th = np.linspace(0, 2 * math.pi, n, endpoint=False)
    verts, faces = [], []
    verts.append(o + a * prof[0][1])
    for r, h in prof[1:-1]:
        for t in th:
            verts.append(o + a * h + r * (math.cos(t) * u + flat * math.sin(t) * w))
    verts.append(o + a * prof[-1][1])
    m = len(prof) - 2
    for i in range(n):
        faces.append((0, 1 + (i + 1) % n, 1 + i))
    for j in range(m - 1):
        for i in range(n):
            a0, b0 = 1 + j * n + i, 1 + j * n + (i + 1) % n
            faces.append((a0, b0, b0 + n, a0 + n))
    top = len(verts) - 1
    for i in range(n):
        faces.append((top, 1 + (m - 1) * n + i, 1 + (m - 1) * n + (i + 1) % n))
    return make(name, verts, outward(verts, faces), mat)


# ---------------- 面に載せる板 ----------------

def disc_topology(rings, k):
    """まん中の 1 点 + rings 本の輪(各 k 点)の板の面。点の番号: 0 = まん中、1 + (輪 − 1)·k + i。"""
    faces = [(0, 1 + i, 1 + (i + 1) % k) for i in range(k)]
    for j in range(rings - 1):
        for i in range(k):
            a, b = 1 + j * k + i, 1 + j * k + (i + 1) % k
            faces.append((a, a + k, b + k, b))
    return faces


def disc_uv(boundary, center, rings, ease=1.0):
    """2D の輪郭(閉じた点の列)とまん中から、板の点(2D)と、輪ごとの割合 s(0 = まん中、1 = 縁)を作る。"""
    B = np.asarray(boundary, float)
    c = np.asarray(center, float)
    pts, ss = [c], [0.0]
    for j in range(1, rings + 1):
        s = (j / rings) ** ease
        for b in B:
            pts.append(c + (b - c) * s)
            ss.append(s)
    return np.array(pts), np.array(ss)


def place_on(pts2, ss, frame, blobs, lift, depth=0.6):
    """板の 2D の点を面に載せる。frame = (原点, U, V, 光線の向き D)。点 = 原点 + a·U + b·V − D·depth から D へ光線。
    lift(s) は面からの持ち上げ(法線の向き、m)。(3D の点, 法線, 当たらなかった数)。"""
    o, U, V, D = (np.asarray(x, float) for x in frame)
    p2 = np.array(pts2, float)
    starts = o[None, :] + p2[:, :1] * U + p2[:, 1:2] * V - D * depth
    hit, ok = ray_hits(starts, D, blobs, depth * 2.0)
    miss = int((~ok).sum())
    c2 = p2.mean(0)
    for _ in range(40):              # 面の外へ出た点は、板のまん中へ 3% ずつ寄せて当て直す(縁が形の輪郭の外に出た所)
        if ok.all():
            break
        bad = ~ok
        p2[bad] = c2 + (p2[bad] - c2) * 0.97
        st = o[None, :] + p2[bad, :1] * U + p2[bad, 1:2] * V - D * depth
        h2, ok2 = ray_hits(st, D, blobs, depth * 2.0)
        hit[bad] = h2
        ok[bad] = ok2
    nor = normals(hit, blobs)
    lifts = np.array([lift(s) for s in ss])
    return hit + nor * lifts[:, None], nor, miss


def plate(name, boundary, center, rings, frame, blobs, lift, mat, back=None, ease=1.0):
    """面に沿う板。back(s) を渡すと、縁を共有する裏の面(面より奥)で閉じたレンズにする。"""
    p2, ss = disc_uv(boundary, center, rings, ease)
    k = len(boundary)
    front, nor, miss = place_on(p2, ss, frame, blobs, lift)
    faces = disc_topology(rings, k)
    verts = list(front)
    if back is not None:
        bk, _, _ = place_on(p2, ss, frame, blobs, back)
        base = len(verts)
        rim0 = 1 + (rings - 1) * k            # 縁の輪の最初の番号。縁は表と同じ点を使う
        verts += list(bk[:rim0])
        remap = lambda i: i if i >= rim0 else base + i  # noqa: E731
        faces = faces + [tuple(remap(v) for v in f[::-1]) for f in disc_topology(rings, k)]
    # 表の面が法線の向きを向くようにそろえる
    v = np.asarray(verts)
    f0 = faces[len(boundary)] if len(faces) > len(boundary) else faces[0]
    fn = np.cross(v[f0[1]] - v[f0[0]], v[f0[2]] - v[f0[0]])
    if np.dot(fn, nor[f0[0]]) < 0:
        faces = [tuple(f[::-1]) for f in faces]
    ob = make(name, verts, faces, mat)
    ob["miss"] = miss
    return ob


def keyed_points(boundary, center, rings, frame, blobs, lift, back=None, warp=None, ease=1.0):
    """plate と同じ並びの点を、2D の点を warp(pts2, ss) で動かしてから作る(シェイプキー用)。"""
    p2, ss = disc_uv(boundary, center, rings, ease)
    if warp is not None:
        p2 = warp(p2, ss)
    front, _, _ = place_on(p2, ss, frame, blobs, lift)
    pts = list(front)
    if back is not None:
        rim0 = 1 + (rings - 1) * len(boundary)
        bk, _, _ = place_on(p2, ss, frame, blobs, back)
        pts += list(bk[:rim0])
    return np.array(pts)


def stroke_uv(pts2, half, per=6, tip=0.25):
    """2D の線(点の列)を、太さ 2·half の帯の点(3 列 × 点の数)にする。両端は半円のように細らせる(先は half·tip)。"""
    C = catmull(pts2, per)
    seg = np.linalg.norm(np.diff(C, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    L = s[-1]
    T = np.gradient(C, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
    N = np.stack([-T[:, 1], T[:, 0]], 1)
    h = np.full(len(C), float(half))
    for i in range(len(C)):
        d = min(s[i], L - s[i])
        if d < half:
            h[i] = half * max(math.sqrt(max(1.0 - (1.0 - d / half) ** 2, 0.0)), tip)
    rows = [C + N * h[:, None], C, C - N * h[:, None]]
    return np.concatenate(rows, 0), len(C)


def stroke_faces(m):
    faces = []
    for r in range(2):
        for i in range(m - 1):
            a, b = r * m + i, r * m + i + 1
            faces.append((a, b, b + m, a + m))
    return faces


def stroke(name, pts2, half, frame, blobs, lift, mat, per=6):
    """面に沿う細い線(鼻の線・口の線・笑う目の弧)。"""
    p2, m = stroke_uv(pts2, half, per)
    pts, nor, miss = place_on(p2, np.zeros(len(p2)), frame, blobs, lambda s: lift)
    faces = stroke_faces(m)
    v = np.asarray(pts)
    f0 = faces[m // 2]
    fn = np.cross(v[f0[1]] - v[f0[0]], v[f0[2]] - v[f0[0]])
    if np.dot(fn, nor[f0[0]]) < 0:
        faces = [tuple(f[::-1]) for f in faces]
    ob = make(name, pts, faces, mat)
    ob["miss"] = miss
    return ob


def add_key(ob, name, pts):
    """シェイプキーを足す(値は 0 にして返す)。"""
    if ob.data.shape_keys is None:
        ob.shape_key_add(name="Basis")
    kb = ob.shape_key_add(name=name)
    for i, p in enumerate(pts):
        kb.data[i].co = tuple(float(x) for x in p)
    kb.value = 0.0
    return kb


def curve_outline(fn, k):
    """t ∈ [0, 1) の閉じた曲線 fn(t) → (a, b) を k 点にする。"""
    return np.array([fn(i / k) for i in range(k)])


def grow2d(boundary, g):
    """2D の閉じた輪郭を、外へ g だけ広げる(となりの点から法線を作る)。"""
    B = np.asarray(boundary, float)
    nb = np.roll(B, -1, 0) - np.roll(B, 1, 0)
    nrm = np.stack([nb[:, 1], -nb[:, 0]], 1)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
    c = B.mean(0)
    if np.mean(((B - c) * nrm).sum(1)) < 0:
        nrm = -nrm
    return B + nrm * g


def group(ob, bone, w=1.0):
    vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
    vg.add([v.index for v in ob.data.vertices], w, "REPLACE")
    return vg


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
