"""手組みの形に使う部品(Blender の Python)。AI の 3D 生成を使わず、数式から滑らかな形を作る。

- superquadric: 半径 (rx, ry, rz)、角の丸さ (e_v, e_h)。e = 1 で楕円体、0 に近づくほど箱に近い(丸みのある箱)。
- ring: 輪(提灯の骨や台座のふち)。
- cloth: 曲げた布の板(提灯の羽根)。
- 向きは Blender の世界(正面が -Y、上が +Z)。物は原点に作ってから、位置と回転を直接頂点へ焼く。
"""
import math
import os

import bpy
from mathutils import Euler, Matrix, Vector


def _sgnpow(v, e):
    return math.copysign(abs(v) ** e, v) if v != 0 else 0.0


def material(name, rgb, rough=0.7, emit=0.0, metallic=0.0, edge_rgb=None, spec=0.3, sheen=0.0, sheen_tint=None):
    """sRGB の 0〜255 で色を渡す(Blender の色は線形なので直す)。"""
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    col = (lin(rgb[0]), lin(rgb[1]), lin(rgb[2]), 1.0)
    b.inputs["Base Color"].default_value = col
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    for k in ("Specular IOR Level", "Specular"):   # つや消しの平らな色にするため、反射の強さを絞る
        if k in b.inputs:
            b.inputs[k].default_value = spec
            break
    if sheen > 0:
        # 布・ぬいぐるみの質感: 縁の毛羽立った明るさ(シーン)。glTF の KHR_materials_sheen として書き出せる
        for k in ("Sheen Weight", "Sheen"):
            if k in b.inputs:
                b.inputs[k].default_value = sheen
                break
        if "Sheen Roughness" in b.inputs:
            b.inputs["Sheen Roughness"].default_value = 0.5
        if "Sheen Tint" in b.inputs:
            t = sheen_tint or rgb
            b.inputs["Sheen Tint"].default_value = (_lin(t[0]), _lin(t[1]), _lin(t[2]), 1.0)
    if edge_rgb is not None:
        # 頂点の色(Col)を使う。glTF に書き出せるのは、手続きの節点ではなく頂点の色や絵だけ
        nt = m.node_tree
        ca = nt.nodes.new("ShaderNodeVertexColor")
        ca.layer_name = "Col"
        nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
        if emit > 0:
            nt.links.new(ca.outputs["Color"], b.inputs["Emission Color"])
            b.inputs["Emission Strength"].default_value = emit
        return m
    if emit > 0:
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = emit
    return m


def _lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _make(name, verts, faces, mat, center, rot_deg, smooth=True):
    me = bpy.data.meshes.new(name)
    R = Euler([math.radians(a) for a in rot_deg], "XYZ").to_matrix()
    me.from_pydata([tuple(R @ Vector(v) + Vector(center)) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat:
        me.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    # 頂点の色 Col(白)。合体したあと、色を使わない部品が黒くならないように、全部に入れておく
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for d in ca.data:
        d.color = (1.0, 1.0, 1.0, 1.0)
    return ob


def superquadric(name, radii, exps=(1.0, 1.0), center=(0, 0, 0), rot_deg=(0, 0, 0), mat=None, seg=(64, 32),
                 taper=None):
    """taper: (下の倍率, 上の倍率)。横の半径を高さに沿って変える(提灯の胴のくびれ用)。"""
    rx, ry, rz = radii
    ev, eh = exps
    nlon, nlat = seg
    verts, faces = [], []
    for j in range(nlat + 1):
        phi = -math.pi / 2 + math.pi * j / nlat
        cv = _sgnpow(math.cos(phi), ev)
        sv = _sgnpow(math.sin(phi), ev)
        t = (phi + math.pi / 2) / math.pi
        k = 1.0 if not taper else taper[0] + (taper[1] - taper[0]) * t
        for i in range(nlon):
            th = 2 * math.pi * i / nlon
            ch = _sgnpow(math.cos(th), eh)
            sh = _sgnpow(math.sin(th), eh)
            verts.append((rx * k * cv * ch, ry * k * cv * sh, rz * sv))
    for j in range(nlat):
        for i in range(nlon):
            a = j * nlon + i
            b = j * nlon + (i + 1) % nlon
            faces.append((a, b, b + nlon, a + nlon))
    return _make(name, verts, faces, mat, center, rot_deg)


def ring(name, major, minor, center=(0, 0, 0), mat=None, seg=(64, 12), squash=1.0, rot_deg=(0, 0, 0), xy=(1.0, 1.0), sq=1.0):
    """輪(トーラス)。squash は断面の縦の倍率。"""
    nu, nv = seg
    verts, faces = [], []
    for i in range(nu):
        u = 2 * math.pi * i / nu
        for j in range(nv):
            v = 2 * math.pi * j / nv
            # 断面: sq=1 で円、小さいほど角丸の長方形(太い帯)。minor は半径方向の半幅、minor*squash は軸方向の半幅
            r = major + minor * _sgnpow(math.cos(v), sq)
            verts.append((r * math.cos(u) * xy[0], r * math.sin(u) * xy[1], minor * squash * _sgnpow(math.sin(v), sq)))
    for i in range(nu):
        for j in range(nv):
            a = i * nv + j
            b = ((i + 1) % nu) * nv + j
            c = ((i + 1) % nu) * nv + (j + 1) % nv
            d = i * nv + (j + 1) % nv
            faces.append((a, b, c, d))
    return _make(name, verts, faces, mat, center, rot_deg)


def cloth(name, width, height, bend=0.04, flare=0.35, thick=0.014, center=(0, 0, 0), rot_deg=(0, 0, 0), mat=None,
          seg=(14, 18), wave=0.012):
    """上の端がせまく下が広がる、厚みのある布の板。上の端が原点、下へ垂れる。

    bend: 前へふくらむ量、flare: 下の広がり(倍率 - 1)、wave: 下の端のうねり。
    """
    nu, nv = seg
    top, bot = [], []
    for j in range(nv + 1):
        t = j / nv
        z = -height * t
        w = width * (1 + flare * t ** 1.5)
        for i in range(nu + 1):
            s = i / nu - 0.5
            x = s * w
            y = bend * math.sin(math.pi * t * 0.9) * (1 - 4 * s * s * 0.5) + wave * t ** 2 * math.sin(s * 9)
            top.append((x, y - thick / 2, z))
            bot.append((x, y + thick / 2, z))
    n = (nu + 1) * (nv + 1)
    verts = top + bot
    faces = []
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            faces.append((a, a + 1, a + nu + 2, a + nu + 1))
            faces.append((a + n, a + nu + 1 + n, a + nu + 2 + n, a + 1 + n))
    # 縁をふさぐ
    for i in range(nu):
        faces.append((i, i + n, i + n + 1, i + 1))
        a = nv * (nu + 1) + i
        faces.append((a, a + 1, a + n + 1, a + n))
    for j in range(nv):
        a = j * (nu + 1)
        faces.append((a, a + nu + 1, a + nu + 1 + n, a + n))
        b = a + nu
        faces.append((b, b + n, b + nu + 1 + n, b + nu + 1))
    return _make(name, verts, faces, mat, center, rot_deg)


def join(objs, name="Body"):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


def gradient(ob, center_rgb, edge_rgb, front=(0, -1, 0), power=1.0, vertical=0.0):
    """正面を向く所は center_rgb、横を向くほど edge_rgb に寄る色を、頂点に焼く。

    vertical: 0〜1。上と下を向く所(提灯のふたと台座のきわ)も edge_rgb に寄せる割合。
    あかりは体のまわり全部で光るので、正面だけを明るくしすぎない。"""
    me = ob.data
    f = Vector(front)
    ca = me.color_attributes["Col"]
    c0 = [_lin(c) for c in center_rgb]
    c1 = [_lin(c) for c in edge_rgb]
    for i, v in enumerate(me.vertices):
        t = (1.0 - max(0.0, v.normal.dot(f))) ** power
        t = min(1.0, t * (1.0 - vertical) + vertical * abs(v.normal.z) ** 1.2 + 0.0)
        ca.data[i].color = (c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, 1.0)


def outline(ob, thick, mat, name=None):
    """裏返しの殻で、茶色などの輪郭線を出す。物を法線の向きに thick(m)ふくらませ、面を裏返した複製を作る。
    裏返した面は、元の物の外にはみ出した縁だけが表から見える(背面を描かない設定で)。頂点グループは複製が引きつぐ。"""
    import bmesh
    sh = ob.copy()
    sh.data = ob.data.copy()
    sh.name = name or ("ol_" + ob.name)
    bpy.context.scene.collection.objects.link(sh)
    bm = bmesh.new()
    bm.from_mesh(sh.data)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * thick
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(sh.data)
    bm.free()
    sh.data.materials.clear()
    sh.data.materials.append(mat)
    return sh


def loft(name, secs, mat=None, n=48, e=1.0, close=True):
    """高さごとの断面(超楕円)をつないで、1 つの滑らかな形にする。元の絵の輪郭から読み取った「高さごとの幅」を、そのまま使える。

    secs: [{z, cx, cy, rx, ry, e(省略可)}, …] を下から上へ。cx, cy は断面の中心(x, y)。rx, ry は半幅。
    """
    if secs[0]["z"] > secs[-1]["z"]:   # 上から下へ渡されても裏返らないように、下から上へそろえる
        secs = list(reversed(secs))
    verts, faces = [], []
    for s in secs:
        ee = s.get("e", e)
        for i in range(n):
            th = 2 * math.pi * i / n
            verts.append((s.get("cx", 0.0) + s["rx"] * _sgnpow(math.cos(th), ee), s.get("cy", 0.0) + s["ry"] * _sgnpow(math.sin(th), ee), s["z"]))
    m = len(secs)
    for j in range(m - 1):
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    if close:
        for j, z_end in ((0, 0), (m - 1, 1)):
            c = len(verts)
            s = secs[j]
            verts.append((s.get("cx", 0.0), s.get("cy", 0.0), s["z"]))
            for i in range(n):
                a = j * n + i
                b = j * n + (i + 1) % n
                faces.append((c, b, a) if j == 0 else (c, a, b))
    return _make(name, verts, faces, mat, (0, 0, 0), (0, 0, 0))


def tube(name, pts, radii, mat=None, n=24, ry_scale=1.0):
    """曲がった管(腕の袖など)。pts は中心線の点(x, y, z)、radii は各点の半径。両端は丸める。"""
    verts, faces = [], []
    P_ = [Vector(p) for p in pts]
    for k, p in enumerate(P_):
        d = (P_[min(k + 1, len(P_) - 1)] - P_[max(k - 1, 0)]).normalized()
        ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
        u = d.cross(ref).normalized()
        w = d.cross(u).normalized()
        r = radii[k]
        for i in range(n):
            th = 2 * math.pi * i / n
            verts.append(tuple(p + u * (r * math.cos(th)) + w * (r * ry_scale * math.sin(th))))
    m = len(P_)
    for j in range(m - 1):
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    for j in (0, m - 1):
        c = len(verts)
        d = (P_[1] - P_[0]) if j == 0 else (P_[-1] - P_[-2])
        verts.append(tuple(P_[j] + d.normalized() * (radii[j] * 0.6) * (-1 if j == 0 else 1)))
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((c, b, a) if j == 0 else (c, a, b))
    return _make(name, verts, faces, mat, (0, 0, 0), (0, 0, 0))


def gradient_axis(ob, p0, p1, c0, c1, ease=1.0):
    """p0 から p1 への向きに沿って、c0 から c1 へ変わる頂点の色(羽の付け根のぼかしなど)。"""
    me = ob.data
    ca = me.color_attributes["Col"]
    a, b = Vector(p0), Vector(p1)
    ab = b - a
    L2 = ab.dot(ab)
    c0 = [_lin(c) for c in c0]
    c1 = [_lin(c) for c in c1]
    for i, v in enumerate(me.vertices):
        t = max(0.0, min(1.0, (v.co - a).dot(ab) / L2)) ** ease
        ca.data[i].color = (c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, 1.0)


FUZZ_FIBRES = 24         # 毛の本数(画像の 1 辺 × この数)。少ないと 1 本ずつが引っかき傷に見える
FUZZ_CLOUD_BLUR = 3      # 雲のなめらかさ
FUZZ_FIBRE_SHADE = 0.6   # 細い毛の明暗の強さ(grain に掛ける)
FUZZ_CLOUD_SHADE = 0.5   # ふわっとしたむらの強さ(grain に掛ける)


def fuzz_images(rgb, out_dir, name="fuzz", size=512, seed=7, grain=0.10, strength=1.0):
    """ぬいぐるみの毛足の画像を作る(継ぎ目なしに並べられる)。色の画像(色 × ふわっとしたむら × 細い毛)と、法線の画像の 2 枚。
    毛は、向きがなめらかに変わる細い線の重なりとして描く。1 画素の粒は使わない(砂壁に見える)。AI は使わない(numpy だけ)。"""
    import numpy as np
    rng = np.random.default_rng(seed)

    def soft_noise(cells):
        """巻きつけの、なめらかな雲。cells は 1 辺のマス目の数。"""
        n = rng.random((cells, cells)).astype(np.float32)
        out = np.kron(n, np.ones((size // cells + 1, size // cells + 1), np.float32))[:size, :size]
        for _ in range(FUZZ_CLOUD_BLUR):
            out = (out + np.roll(out, size // cells // 2, 0) + np.roll(out, size // cells // 2, 1)
                   + np.roll(np.roll(out, size // cells // 2, 0), size // cells // 2, 1)) / 4
        return (out - out.min()) / max(out.max() - out.min(), 1e-6)

    field = soft_noise(6) * 2 * math.pi           # 毛の向き: 場所ごとになめらかに変わる
    h = np.zeros((size, size), np.float32)
    for _ in range(size * FUZZ_FIBRES):
        x, y = float(rng.integers(0, size)), float(rng.integers(0, size))
        L = int(rng.integers(8, 22))
        for t in range(L):
            xi, yi = int(x) % size, int(y) % size
            h[yi, xi] += 0.5 * (1 - t / L)
            ang = field[yi, xi]
            x += math.cos(ang)
            y += math.sin(ang)
    h = sum(np.roll(np.roll(h, i, 0), j, 1) for i in (-1, 0, 1) for j in (-1, 0, 1)) / 9.0   # 線の角を丸める
    h = (h - h.mean()) / max(h.std() * 4, 1e-6) + 0.5
    h = np.clip(h, 0, 1)
    cloud = soft_noise(16) * 0.6 + soft_noise(8) * 0.4
    # 色: 平均 1 の明暗。細い毛(grain の幅)と、ふわっとしたむら
    shade = 1.0 + (h - 0.5) * 2 * grain * FUZZ_FIBRE_SHADE + (cloud - 0.5) * 2 * grain * FUZZ_CLOUD_SHADE
    col = np.clip(np.array(rgb, np.float32)[None, None, :] * shade[..., None], 0, 255).astype(np.uint8)
    # 法線: 高さの差分(巻きつけ)
    dx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    dy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
    os.makedirs(out_dir, exist_ok=True)
    pc, pn = os.path.join(out_dir, name + "_color.png"), os.path.join(out_dir, name + "_normal.png")
    def save(arr_u8, path):
        # Blender の Python には PIL が無いので、Blender の画像として書く(RGBA の 0〜1 で、上下が逆)
        h_, w_ = arr_u8.shape[:2]
        rgba = np.ones((h_, w_, 4), np.float32)
        rgba[..., :3] = arr_u8.astype(np.float32) / 255.0
        img = bpy.data.images.new(os.path.basename(path), w_, h_, alpha=False)
        img.pixels = rgba[::-1].reshape(-1).tolist()
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        bpy.data.images.remove(img)

    save(col, pc)
    save((nrm * 255).astype(np.uint8), pn)
    return pc, pn


FUZZ_NORMAL_GAIN = 0.4


def fuzz_material(name, rgb, out_dir, rough=0.95, sheen=1.0, sheen_tint=None, normal_strength=0.8, grain=0.10, seed=7):
    """毛足の画像(色+法線)と、縁の毛羽(シーン)を持つ材質。使う物には auto_uv(ob, tile) で UV を付ける。"""
    pc, pn = fuzz_images(rgb, out_dir, name, grain=grain, seed=seed)
    m = material(name, rgb, rough=rough, spec=0.1, sheen=sheen, sheen_tint=sheen_tint)
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tc = nt.nodes.new("ShaderNodeTexImage")
    tc.image = bpy.data.images.load(pc)
    tc.image.colorspace_settings.name = "sRGB"
    nt.links.new(tc.outputs["Color"], b.inputs["Base Color"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = bpy.data.images.load(pn)
    tn.image.colorspace_settings.name = "Non-Color"
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = normal_strength * FUZZ_NORMAL_GAIN   # 11-02: ブラウザでは凹凸が強く見える。細かい粒は保ち、強さだけ下げる(ぼかすと革のようになる)
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    return m


def auto_uv(ob, tile=4.0):
    """立方体投影で UV を付け、tile 倍に繰り返す(毛足の画像が大きすぎず、細かく見えるように)。"""
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=2.0 / max(tile, 0.01))
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


SHELL_HAIR_AREA = 5.0    # 毛 1 本の面積の目安(px)。本数 = 画像の面積 × density ÷ これ
SHELL_CUT_LOW = 0.15     # 内側の層の抜きの線(低いと毛が太い)
SHELL_CUT_HIGH = 0.6     # 外側の層の抜きの線(高いと、高い毛の先だけ残る)


def fuzz_shell(ob, rgb, out_dir, thick=0.012, density=0.28, name="shell", size=512, seed=11, tile=3.0, layers=2):
    """輪郭の毛羽: 物を少しふくらませた殻を重ね、毛の高さの画像を、層ごとの線で抜く(alphaMode: MASK)。
    全部の層で同じ毛の位置を使い、外の層ほど高い毛だけを残す。下から見ると毛の柱になり、輪郭がふんわりする。
    層ごとに模様をずらすと、毛ではなくばらばらの点に見える(試験で「輪郭に点が散る」と言われた)。
    戻り値: 作った殻の物の一覧。"""
    import bmesh
    import numpy as np
    rng = np.random.default_rng(seed)
    a = np.zeros((size, size), np.float32)
    for _ in range(int(size * size * density / SHELL_HAIR_AREA)):
        x, y = rng.integers(0, size, 2)
        height = 0.35 + 0.65 * rng.random()
        r = 1.2 + 1.3 * rng.random()
        ri = int(r) + 1
        for dy in range(-ri, ri + 1):
            for dx in range(-ri, ri + 1):
                d = math.hypot(dx, dy) / r
                if d < 1.0:
                    yy, xx = (y + dy) % size, (x + dx) % size
                    a[yy, xx] = max(a[yy, xx], height * (1.0 - d * d))
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, name + "_alpha.png")
    rgba = np.ones((size, size, 4), np.float32)
    rgba[..., :3] = np.array(rgb, np.float32)[None, None, :] / 255.0
    rgba[..., 3] = a
    img = bpy.data.images.new(name + "_alpha", size, size, alpha=True)
    img.pixels = rgba[::-1].reshape(-1).tolist()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()

    def layer_material(k):
        """k 層目の材質。同じ画像を、外の層ほど高い線で抜く(glTF の alphaCutoff になる)。"""
        m = bpy.data.materials.new(f"{name}{k}")
        m.use_nodes = True
        nt = m.node_tree
        b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        mt = nt.nodes.new("ShaderNodeMath")
        mt.operation = "GREATER_THAN"
        mt.inputs[1].default_value = SHELL_CUT_LOW + (SHELL_CUT_HIGH - SHELL_CUT_LOW) * k / max(layers - 1, 1)
        nt.links.new(t.outputs["Alpha"], mt.inputs[0])
        nt.links.new(mt.outputs["Value"], b.inputs["Alpha"])
        b.inputs["Roughness"].default_value = 1.0
        try:
            m.surface_render_method = "DITHERED"
        except Exception:
            pass
        m.blend_method = "CLIP"   # glTF の alphaMode: MASK
        return m

    shells = []
    for k in range(layers):
        sh = ob.copy()
        sh.data = ob.data.copy()
        sh.name = f"{name}{k}"
        bpy.context.scene.collection.objects.link(sh)
        bm = bmesh.new()
        bm.from_mesh(sh.data)
        bm.normal_update()
        for v in bm.verts:
            v.co += v.normal * thick * (k + 1) / layers
        bm.to_mesh(sh.data)
        bm.free()
        sh.data.materials.clear()
        sh.data.materials.append(layer_material(k))
        auto_uv(sh, tile=tile)   # 全部の層で同じ UV(毛の位置をそろえる)
        sh["surface_only"] = True    # 検査(m03_contact)で「体」にも「部品」にも数えない印。名前は自由でよい
        shells.append(sh)
    return shells
