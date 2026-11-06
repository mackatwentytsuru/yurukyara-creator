"""体の面に沿う部品と、やわらかい影(Blender の Python)。builder から m00_prims と一緒に使う。

- wrap_band: 体に巻く帯(たすき・ベルト・襟・リボン)。道は (角度, 高さ) で渡し、光線で体の面に載せる。UV は帯の長さ方向につながる(文字の画像を貼れる)。
- soft_patch: 頬の丸など、縁が消えていく色の当て布(透明さのある画像)。
- ruffle: フリル。付け根の列は動かず、外へ行くほど波打つ。
- limb: 腕・脚・耳のような、体から生える部品。付け根を体の面から必ず埋めて太らせるので、肩や股が抜けない。
- bake_ao: 物どうしのくぼみの影を、頂点の色 Col に掛ける。three.js には接地の影が無いので、元の絵の立体感はここで出す。
角度は、正面(-Y)が 0、体の左(+X)が 90。高さは世界の Z(メートル)。
"""
import math
import os

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from m00_prims import _make, tube

FAR = 5.0            # 体の外から光線を飛ばす距離(メートル)
AO_FLOOR = 0.35      # 影の濃さの下限。真っ黒にしない
MIN_RAY_START = 2e-3 # 自分の面に当たらないよう、光線の出発点を法線の向きへずらす量
FLARE_REACH = 0.6    # 生える部品の太らせを、面から半径の何倍まで続けるか。長いと、くさび形に見える


def body_bvh(objs):
    """物の集まりを、世界の座標の BVH にする。"""
    pts, tris = [], []
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        base = len(pts)
        pts.extend(o.matrix_world @ v.co for v in me.vertices)
        tris.extend(tuple(base + i for i in t.vertices) for t in me.loop_triangles)
    return BVHTree.FromPolygons(pts, tris, all_triangles=True)


def _axis_of(objs):
    """物の集まりの XY の中心(巻く軸)。"""
    xs, ys = [], []
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            xs.append(w.x)
            ys.append(w.y)
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def _dir(angle_deg):
    a = math.radians(angle_deg)
    return Vector((math.sin(a), -math.cos(a), 0.0))


def _hit(bvh, axis, angle_deg, z):
    """軸の外から内へ光線を飛ばし、いちばん外の面を返す。当たらなければ止める(勝手な位置に置かない)。"""
    d = _dir(angle_deg)
    start = Vector((axis[0], axis[1], z)) + d * FAR
    loc, nor, _, _ = bvh.ray_cast(start, -d, FAR * 2)
    if loc is None:
        raise ValueError(f"体に当たらない: 角度 {angle_deg:.1f} 度、高さ {z:.3f} m。道か幅を直す")
    return loc, nor


def _resample(path, n, closed):
    """(角度, 高さ) の折れ線を、道のりで等分する。"""
    pts = list(path) + ([(path[0][0] + 360.0, path[0][1])] if closed else [])   # 一周は 360 度先へ閉じる(0 度へ戻ると逆回りになる)
    lens = [0.0]
    for (a0, z0), (a1, z1) in zip(pts, pts[1:]):
        lens.append(lens[-1] + math.hypot((a1 - a0) / 90.0, z1 - z0))
    out = []
    seg = 0
    for i in range(n + 1):
        d = lens[-1] * i / n
        while seg < len(lens) - 2 and lens[seg + 1] < d:
            seg += 1
        t = (d - lens[seg]) / max(lens[seg + 1] - lens[seg], 1e-9)
        (a0, z0), (a1, z1) = pts[seg], pts[seg + 1]
        out.append((a0 + (a1 - a0) * t, z0 + (z1 - z0) * t))
    return out


def wrap_band(name, body, path, width, thick=0.008, clearance=0.002, mat=None, seg=96, rows=8, closed=False, axis=None,
              smooth=2, taper=0.0, taper_min=0.6, over=None, over_slope=0.8, over_max=0.03, over_pad=0.01, under=None):
    """体に巻く帯。path = [(角度, 高さ), …]。closed=True なら一周(path に最後の点を重ねて書かない)。
    断面はかまぼこ形(中央がふくらむ)。UV は u が帯の長さ、v が幅。
    over: 帯がかぶさる部品(腕の付け根など)の一覧。帯はまず body の面に載り、over の中に入った所だけ、その面の外へ持ち上げ、
    まわりは over_slope(持ち上げ ÷ 横の距離)の坂でつなぐ。持ち上げは over_max(m)まで。over_pad はさらに浮かす分(ブラウザの毛の殻が帯を突き抜けて、縁がぎざぎざに見えた)。たすきが肩で腕の付け根にかぶる形になる。
    under: 帯が下にもぐる部品(頭・帯の上にかぶさる腕など)の一覧。帯の縁がその中に入る所だけ、帯の幅をその部品の外までに縮める
    (見えない所なので見た目は変わらず、m03 の「深く埋まる点」が消える)。over で持ち上げきれなかった所も、同じく縮める。
    over に入れずに body だけで巻くと、腕が帯を突き抜けて手前に出る。body に腕を入れると、横からの光線が腕の先に当たって帯が飛ぶ。
    taper: 両端のこの割合(0〜0.5)で、幅を taper_min 倍まで細める。肩や胴の端で帯の角が折れたり、頭や腕に刺さるのを防ぐ。"""
    bvh = body_bvh(body)
    axis = axis or _axis_of(body)
    samples = _resample(path, seg, closed)
    grid = []
    for k, (a, z) in enumerate(samples):
        a0, z0 = samples[max(k - 1, 0)]
        a1, z1 = samples[min(k + 1, len(samples) - 1)]
        loc, _ = _hit(bvh, axis, a, z)
        radius = max(math.hypot(loc.x - axis[0], loc.y - axis[1]), 1e-3)
        ds = math.radians(a1 - a0) * radius      # 道の向きを、面の上の長さで求める
        dz = z1 - z0
        ln = max(math.hypot(ds, dz), 1e-6)
        across_s, across_z = -dz / ln, ds / ln   # 道に直角な向き(面の上)
        w = width
        if taper > 0 and not closed:
            edge = min(k, len(samples) - 1 - k) / max(len(samples) - 1, 1) / taper
            f = min(edge, 1.0)
            w = width * (taper_min + (1 - taper_min) * f * f * (3 - 2 * f))
        row = []
        for j in range(rows + 1):
            u = 2 * j / rows - 1
            aj = a + math.degrees(across_s * u * w / 2 / radius)
            zj = z + across_z * u * w / 2
            p, n = _hit(bvh, axis, aj, zj)
            row.append((p, n, u))
        grid.append(row)
    for _ in range(smooth):                      # 体のくぼみで帯が段にならないよう、長さ方向にならす
        src = [[(p.copy(), n, u) for p, n, u in r] for r in grid]
        cnt = len(src)
        for k in range(cnt):
            if not closed and k in (0, cnt - 1):
                continue
            for j in range(rows + 1):
                prev, nxt = src[(k - 1) % cnt][j][0], src[(k + 1) % cnt][j][0]
                grid[k][j] = ((prev + nxt) * 0.25 + src[k][j][0] * 0.5, src[k][j][1], src[k][j][2])
    for row in grid:                             # ならすと丸い体では内側へ縮むので、面へ載せ直す(m03_contact が 0.5 cm の埋まりを見つけた)
        for j, (p, _, u) in enumerate(row):
            near, nor, _, _ = bvh.find_nearest(p)
            row[j] = (near, nor, u)
    if over:
        _drape_over(grid, over, over_slope, over_max, over_pad)
    if over or under:
        _trim_rows(grid, list(over or []) + list(under or []))
    if closed:                                   # 一周の帯の継ぎ目をふさぐ(最初と最後の列を同じ位置に)
        grid[-1] = [(p.copy(), n, u) for p, n, u in grid[0]]
    verts, faces, uvs = [], [], []
    nu, nv = len(grid), rows + 1
    for k, row in enumerate(grid):
        for p, n, u in row:
            lift = clearance + thick * math.sqrt(max(1 - u * u, 0.0))
            verts.append(tuple(p + n * lift))
            uvs.append((k / (nu - 1), (u + 1) / 2))
    for k, row in enumerate(grid):               # 裏面(体の側)。外から見えないが、閉じておくと影と点検が素直になる
        for p, n, u in row:
            verts.append(tuple(p + n * clearance * 0.3))
            uvs.append((k / (nu - 1), (u + 1) / 2))
    for k in range(nu - 1):
        for j in range(nv - 1):
            a, b = k * nv + j, (k + 1) * nv + j
            faces.append((a, b, b + 1, a + 1))
            a2, b2 = a + nu * nv, b + nu * nv
            faces.append((a2 + 1, b2 + 1, b2, a2))
    ob = _make(name, verts, faces, mat, (0, 0, 0), (0, 0, 0))
    _set_uv(ob, uvs)
    return ob


def _inside_bvh(bvh, p):
    d = Vector((0.27, 0.53, 0.80)).normalized()
    start, count = p.copy(), 0
    for _ in range(64):
        hit = bvh.ray_cast(start, d, FAR * 2)[0]
        if hit is None:
            break
        count += 1
        start = hit + d * 1e-5
    return count % 2 == 1


def _drape_over(grid, over, slope, max_lift, pad):
    """帯の点のうち、over の物の中に入った点を、法線の向きにその物の外まで持ち上げ、まわりを坂でつなぐ(テントのように)。
    持ち上げは max_lift まで。法線の向きが腕の長さの向きに近いと、出口が腕の先になり、帯が腕全体にかぶさった(上限なしで起きた)。"""
    bvhs = [body_bvh([o]) for o in over]
    pts = [(k, j) for k in range(len(grid)) for j in range(len(grid[k]))]
    lifted = []
    for k, j in pts:
        p, n, _ = grid[k][j]
        for b in bvhs:
            if _inside_bvh(b, p):
                q = b.ray_cast(p + n * 1e-5, n, 1.0)[0]
                if q is not None:
                    lifted.append((p.copy(), min((q - p).length, max_lift) + pad))
    if not lifted:
        return
    for k, j in pts:
        p, n, u = grid[k][j]
        lift = max(max(L - slope * (p - q).length, 0.0) for q, L in lifted)
        if lift > 0:
            grid[k][j] = (p + n * lift, n, u)


def _trim_rows(grid, objs):
    """帯の各列で、縁の点が objs の中に入っていたら、中心の点から外へ続く「外にある範囲」だけに、列の点を並べ直す。
    範囲の端は二分法で部品の面に合わせる(行の間隔のままだと、縁が段になる)。中心の点が中にある列は触らない。"""
    bvhs = [body_bvh([o]) for o in objs]

    def inside(p):
        return any(_inside_bvh(b, p) for b in bvhs)

    for k, row in enumerate(grid):
        pts = [p for p, _, _ in row]
        flags = [inside(p) for p in pts]
        c = len(row) // 2
        if not any(flags) or flags[c]:
            continue
        lo = c
        while lo > 0 and not flags[lo - 1]:
            lo -= 1
        hi = c
        while hi < len(row) - 1 and not flags[hi + 1]:
            hi += 1

        def edge(a, b):                         # a は外、b は中
            pa, pb = pts[a].copy(), pts[b].copy()
            for _ in range(10):
                m = (pa + pb) / 2
                if inside(m):
                    pb = m
                else:
                    pa = m
            return pa
        line = ([edge(lo, lo - 1)] if lo > 0 else []) + pts[lo:hi + 1] + ([edge(hi, hi + 1)] if hi < len(row) - 1 else [])
        nrm = ([row[lo][1]] if lo > 0 else []) + [row[j][1] for j in range(lo, hi + 1)] + ([row[hi][1]] if hi < len(row) - 1 else [])
        acc = [0.0]
        for a, b in zip(line, line[1:]):
            acc.append(acc[-1] + (b - a).length)
        total = max(acc[-1], 1e-9)
        new = []
        seg = 0
        for j in range(len(row)):
            d = total * j / (len(row) - 1)
            while seg < len(line) - 2 and acc[seg + 1] < d:
                seg += 1
            t = (d - acc[seg]) / max(acc[seg + 1] - acc[seg], 1e-9)
            new.append((line[seg].lerp(line[seg + 1], min(max(t, 0.0), 1.0)), nrm[seg if t < 0.5 else seg + 1], row[j][2]))
        grid[k] = new


def tilted_loop(body, front, step=10.0, axis=None, tilt_back=None):
    """たすき・ななめの帯を、閉じた 1 本の輪の道にする。front = 元の絵から測った前の道 [(角度, 高さ), …]。
    前の道が載る体の面の点に、平面 z = c + a·x + b·y を合わせ、全周 (-180〜180 度) をその平面と体の面の交わりで返す。
    肩の上・腰の横・背中が前の続きになるので、手で背中の点を足さなくてよい(足した道は、肩の上が空き、腰で急に折れた)。
    tilt_back: 前後の傾き b を決め打ちする(None なら前の道から合わせる)。戻り値は (道, 前の道との高さのずれの二乗平均 m)。
    wrap_band(..., closed=True) に渡す。"""
    import numpy as np
    bvh = body_bvh(body)
    axis = axis or _axis_of(body)
    P = []
    for a, z in front:
        loc, _ = _hit(bvh, axis, a, z)
        P.append((loc.x - axis[0], loc.y - axis[1], z))
    P = np.array(P)
    if tilt_back is None:
        A = np.stack([np.ones(len(P)), P[:, 0], P[:, 1]], 1)
        c, a, b = np.linalg.lstsq(A, P[:, 2], rcond=None)[0]
    else:
        b = tilt_back
        A = np.stack([np.ones(len(P)), P[:, 0]], 1)
        c, a = np.linalg.lstsq(A, P[:, 2] - b * P[:, 1], rcond=None)[0]
    err = float(np.sqrt(np.mean((c + a * P[:, 0] + b * P[:, 1] - P[:, 2]) ** 2)))
    zs = [v.co.z for o in body for v in o.data.vertices]
    zlo, zhi = min(zs) + 2e-3, max(zs) - 2e-3
    loop = []
    for i in range(int(round(360 / step))):
        ang = -180.0 + i * step
        # 平面と面の交わりの高さを、二分法で求める。くりかえし代入(z を平面の式で更新)は、丸い小さな胴で傾きが急だと
        # 行ったり来たりして、体に当たらない高さへ飛んだ(ようこそくんの作り直しで、角度 81 度で例外)
        lo, hi = zlo, zhi
        for _ in range(40):
            z = (lo + hi) / 2
            loc, _ = _hit(bvh, axis, ang, z)
            if z - (c + a * (loc.x - axis[0]) + b * (loc.y - axis[1])) < 0:
                lo = z
            else:
                hi = z
        loop.append((ang, float((lo + hi) / 2)))
    return loop, err


def band_text_uv(ob, loop, seg, a_start, a_end, fill=1.0):
    """閉じた帯(wrap_band(closed=True))の UV の u を、角度 a_start〜a_end の部分に字の絵の 0〜fill が載るように付け直す。
    u は面の上の長さで決める。範囲の外の u は 0 未満・1 より大きくなるので、絵の extension を EXTEND にして端の無地を伸ばす。"""
    import numpy as np
    samples = _resample(loop, seg, True)
    nu = len(samples)
    me = ob.data
    nv = len(me.vertices) // 2 // nu
    cen = [sum((me.vertices[k * nv + j].co for j in range(nv)), Vector()) / nv for k in range(nu)]
    s = [0.0]
    for p, q in zip(cen, cen[1:]):
        s.append(s[-1] + (q - p).length)
    ang = np.array([a for a, _ in samples])
    s0, s1 = np.interp(a_start, ang, s), np.interp(a_end, ang, s)
    uv = me.uv_layers.active.data
    for li, loop_ in enumerate(me.loops):
        k = (loop_.vertex_index % (nu * nv)) // nv
        uv[li].uv.x = fill * (s[k] - s0) / (s1 - s0)


def _set_uv(ob, per_vertex_uv):
    uv = ob.data.uv_layers.new(name="UVMap")
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = per_vertex_uv[ob.data.loops[li].vertex_index]


def _soft_image(rgb, out_dir, name, hardness, opacity, size=128):
    """縁が消えていく丸の画像。hardness までは一定、そこから外へ二乗で消える。"""
    import numpy as np
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    d = np.hypot((xx + 0.5) / size * 2 - 1, (yy + 0.5) / size * 2 - 1)
    a = np.clip((1 - d) / max(1 - hardness, 1e-3), 0, 1) ** 2 * opacity
    rgba = np.ones((size, size, 4), np.float32)
    rgba[..., :3] = np.array(rgb, np.float32) / 255.0
    rgba[..., 3] = a
    img = bpy.data.images.new(name, size, size, alpha=True)
    img.pixels = rgba[::-1].reshape(-1).tolist()
    os.makedirs(out_dir, exist_ok=True)
    img.filepath_raw = os.path.join(out_dir, name + ".png")
    img.file_format = "PNG"
    img.save()
    return img


def soft_patch(name, body, angle_deg, z, half_w, half_h, rgb, out_dir, clearance=0.003, n=20, hardness=0.35,
               opacity=0.85, axis=None):
    """頬の丸など。体の面に沿う網に、縁が消える画像を貼る(glTF の alphaMode: BLEND)。half_w・half_h はメートル。"""
    bvh = body_bvh(body)
    axis = axis or _axis_of(body)
    loc, _ = _hit(bvh, axis, angle_deg, z)
    radius = max(math.hypot(loc.x - axis[0], loc.y - axis[1]), 1e-3)
    verts, faces, uvs = [], [], []
    for j in range(n + 1):
        for i in range(n + 1):
            u, v = 2 * i / n - 1, 2 * j / n - 1
            p, nor = _hit(bvh, axis, angle_deg + math.degrees(u * half_w / radius), z + v * half_h)
            verts.append(tuple(p + nor * clearance))
            uvs.append(((u + 1) / 2, (v + 1) / 2))
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i
            faces.append((a, a + 1, a + n + 2, a + n + 1))
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = _soft_image(rgb, out_dir, name, hardness, opacity)
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = 1.0
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.0
    m.blend_method = "BLEND"
    ob = _make(name, verts, faces, m, (0, 0, 0), (0, 0, 0))
    _set_uv(ob, uvs)
    ob["surface_only"] = True    # 検査(m03_contact)で「体」にも「部品」にも数えない印
    return ob


def ruffle(name, path, width, folds=12, gather=0.45, up=(0, 0, 1), outward=(0, 0, -1), mat=None, per_fold=10, rows=4,
           closed=True):
    """フリル。path は 3D の折れ線。付け根は path から動かず、外の列ほど up の向きへ波打つ。
    outward: 布が伸びる向きの目安(道に直角な向きのうち、これに近い方を使う)。UV は u が道のり、v が幅。"""
    pts = [Vector(p) for p in path] + ([Vector(path[0])] if closed else [])
    dist = [0.0]
    for p, q in zip(pts, pts[1:]):
        dist.append(dist[-1] + (q - p).length)
    total = dist[-1]
    if total <= 1e-6:
        raise ValueError("フリルの道の長さが 0")
    count = folds * per_fold
    vup, vout = Vector(up).normalized(), Vector(outward)
    verts, faces, uvs = [], [], []
    seg = 0
    for i in range(count + (0 if closed else 1)):
        s = total * i / count
        while seg < len(dist) - 2 and dist[seg + 1] < s:
            seg += 1
        t = (s - dist[seg]) / max(dist[seg + 1] - dist[seg], 1e-9)
        at = pts[seg].lerp(pts[seg + 1], t)
        tan = (pts[seg + 1] - pts[seg]).normalized()
        side = tan.cross(vup)
        if side.length < 1e-6:
            side = tan.cross(Vector((0, 1, 0)))
        side.normalize()
        if side.dot(vout) < 0 and vup.dot(vout) > -0.9:
            side = -side
        phase = 2 * math.pi * folds * s / total
        for j in range(rows):
            f = j / (rows - 1)
            wave = width * gather * f ** 1.3 * math.sin(phase)
            reach = width * f * (1 - 0.15 * gather * math.cos(phase))
            if abs(vup.dot(vout)) > 0.9:      # 下へ垂れるフリル: 波は道の外側へ、長さは下へ
                pos = at + vout.normalized() * reach + side * wave
            else:
                pos = at + side * reach + vup * wave
            verts.append(tuple(pos))
            uvs.append((s / total, f))
    n = len(verts) // rows
    last = n if closed else n - 1
    for i in range(last):
        k = (i + 1) % n
        for j in range(rows - 1):
            a, b = i * rows + j, k * rows + j
            faces.append((a, b, b + 1, a + 1))
    ob = _make(name, verts, faces, mat, (0, 0, 0), (0, 0, 0))
    _set_uv(ob, uvs)
    return ob


def _inside_any(body, p):
    """どれかの物の内側にあるか(物ごとに、光線の交差の回数を数える)。"""
    d = Vector((0.27, 0.53, 0.80)).normalized()
    for o in body:
        bvh = body_bvh([o])
        start, count = p.copy(), 0
        for _ in range(64):
            hit = bvh.ray_cast(start, d, FAR * 2)[0]
            if hit is None:
                break
            count += 1
            start = hit + d * 1e-5
        if count % 2:
            return True
    return False


def limb(name, body, root, tip, r_root, r_tip, mat=None, bury=0.8, flare=1.2, n=24, rows=20, ry_scale=1.0, round_root=True):
    """体から生える部品。root→tip の線が体の面を出る所を測り、そこから r_root × bury だけ内側を付け根にする。
    面のすぐ近くだけを r_root × flare まで太らせ、肩の抜けをふさぐ。先は丸める。
    r_root と r_tip はほぼ同じにする(差が大きいと、くさび形に見える)。
    体に当たらない置き方、付け根が体の中に入らない置き方は、例外で止まる(浮いたまま仕上げない)。
    round_root: 付け根の端も丸める(既定)。平らな端の縁が肩の丸みから角として出るのを防ぐ。
    戻り値の ob["pivot"] を、その部品の骨の位置に使う(骨が体の中にあれば、回しても付け根が開かない)。"""
    p_root, p_tip = Vector(root), Vector(tip)
    d = p_tip - p_root
    if d.length < 1e-4:
        raise ValueError(f"{name}: root と tip が同じ位置")
    d.normalize()
    surf = body_bvh(body).ray_cast(p_tip, -d, FAR * 2)[0]
    if surf is None:
        raise ValueError(f"{name}: tip から root へ向かう線が体に当たらない。root を体の中へ動かす")
    anchor = surf - d * (r_root * bury)
    if not _inside_any(body, anchor):
        raise ValueError(f"{name}: 付け根 {tuple(round(v, 3) for v in anchor)} が体の中に入らない。bury か r_root を小さくする")
    length = (p_tip - anchor).length
    from_surface = (surf - anchor).length
    pts, radii = [], []
    for k in range(rows + 1):
        t = k / rows
        at = t * length
        r = r_root + (r_tip - r_root) * t
        past = max(at - from_surface, 0.0) / max(r_root * FLARE_REACH, 1e-4)   # 面から外へ、太らせる範囲のどこまで来たか
        fade = max(1.0 - past, 0.0)
        r *= 1.0 + (flare - 1.0) * fade * fade * (3 - 2 * fade)
        left = length - at
        if left < r_tip:                       # 先を丸める
            r *= math.sqrt(max(1.0 - (1.0 - left / r_tip) ** 2, 0.0025))
        if round_root and at < r_root:         # 付け根も丸める。平らな端の縁が、肩の丸みから角として飛び出す(ようこそくんで起きた)
            r *= math.sqrt(max(1.0 - (1.0 - at / r_root) ** 2, 0.04))
        pts.append(tuple(anchor + d * at))
        radii.append(r)
    ob = tube(name, pts, radii, mat=mat, n=n, ry_scale=ry_scale)
    ob["pivot"] = [round(float(v), 4) for v in anchor]
    return ob


def pivot_of(ob):
    """limb の付け根を、JSON に書ける普通の数の並びで返す(rig.json の at に使う)。"""
    return [float(v) for v in ob["pivot"]]


def _hemisphere(samples):
    """法線を +Z とした半球の向き。cos に比例して集める(黄金角で並べる)。"""
    out = []
    for i in range(samples):
        r = math.sqrt((i + 0.5) / samples)
        a = 2 * math.pi * ((i * 0.61803398875) % 1)
        out.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(max(1 - r * r, 0.0)))))
    return out


def bake_ao(objs, occluders=None, samples=32, dist=0.25, strength=0.9, attr="Col", blur=1):
    """くぼみの影を、頂点の色 attr に掛ける(色は残し、明るさだけ落とす)。
    occluders: 影を落とす物(毛羽の殻は入れない)。既定は objs。戻り値: 物ごとの影の平均と最小。
    書き出しは b07_rig_groups が scene["ao_vertex"] を見て、頂点の色を GLB に入れる。"""
    bvh = body_bvh(occluders or objs)
    dirs = _hemisphere(samples)
    report = {}
    for o in objs:
        me = o.data
        ca = me.color_attributes.get(attr)
        if ca is None:
            continue
        rot = o.matrix_world.to_3x3()
        vals = []
        for v in me.vertices:
            n = (rot @ v.normal).normalized()
            q = n.to_track_quat("Z", "Y")
            start = o.matrix_world @ v.co + n * MIN_RAY_START
            hit = sum(1 for d in dirs if bvh.ray_cast(start, q @ d, dist)[0] is not None)
            vals.append(1.0 - strength * hit / samples)
        vals = _blur_on_mesh(me, vals, blur)
        for i, val in enumerate(vals):
            val = max(val, AO_FLOOR)
            c = ca.data[i].color
            ca.data[i].color = (c[0] * val, c[1] * val, c[2] * val, c[3])
        report[o.name] = (round(sum(vals) / max(len(vals), 1), 3), round(min(vals, default=1.0), 3))
    bpy.context.scene["ao_vertex"] = True
    return report


def _blur_on_mesh(me, vals, times):
    """隣の点との平均で、影のまだらをならす。"""
    if times <= 0:
        return vals
    nb = [[] for _ in vals]
    for e in me.edges:
        a, b = e.vertices
        nb[a].append(b)
        nb[b].append(a)
    for _ in range(times):
        vals = [(v + sum(vals[j] for j in nb[i])) / (1 + len(nb[i])) for i, v in enumerate(vals)]
    return vals
