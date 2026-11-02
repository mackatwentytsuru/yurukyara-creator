"""手組みの形に使う部品(Blender の Python)。AI の 3D 生成を使わず、数式から滑らかな形を作る。

- superquadric: 半径 (rx, ry, rz)、角の丸さ (e_v, e_h)。e = 1 で楕円体、0 に近づくほど箱に近い(丸みのある箱)。
- ring: 輪(提灯の骨や台座のふち)。
- cloth: 曲げた布の板(提灯の羽根)。
- 向きは Blender の世界(正面が -Y、上が +Z)。物は原点に作ってから、位置と回転を直接頂点へ焼く。
"""
import math

import bpy
from mathutils import Euler, Matrix, Vector


def _sgnpow(v, e):
    return math.copysign(abs(v) ** e, v) if v != 0 else 0.0


def material(name, rgb, rough=0.7, emit=0.0, metallic=0.0, edge_rgb=None):
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


def ring(name, major, minor, center=(0, 0, 0), mat=None, seg=(64, 12), squash=1.0, rot_deg=(0, 0, 0)):
    """輪(トーラス)。squash は断面の縦の倍率。"""
    nu, nv = seg
    verts, faces = [], []
    for i in range(nu):
        u = 2 * math.pi * i / nu
        for j in range(nv):
            v = 2 * math.pi * j / nv
            r = major + minor * math.cos(v)
            verts.append((r * math.cos(u), r * math.sin(u), minor * squash * math.sin(v)))
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
