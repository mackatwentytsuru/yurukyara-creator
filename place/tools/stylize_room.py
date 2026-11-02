"""撮った部屋の GLB に、種類ごとの素材(床・壁・天井・ドア・窓・家具)を貼る。Blender の画面なしで動かす。
  blender -b --python place/tools/stylize_room.py -- <入力.glb> <出力.glb> --hints landmarks_hint.json [--room room.json]
        [--textures place/assets/textures] [--tile 1.0]
面ごとに、(1) ドア・窓・家具の箱の中か、(2) 向きと高さ、で種類を決める。名前には頼らない
(RoomPlan の USDZ の中の名前は実物で確かめるまで分からないため)。
座標は「撮った座標」(y が上)で判定する。Blender は z が上なので (x, y, z)_scan = (x, z, -y)_blender。
貼り方は箱の投影で、1 タイルが --tile m 四方(既定 1 m)。出力の GLB に画像を埋めこむ。
色を写真から付ける版(A)ができたら、この道具の代わりにその版を room.glb にする(place.json の variants で切りかえる)。
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("dst")
ap.add_argument("--hints", required=True)
ap.add_argument("--room", default=None)
ap.add_argument("--textures", default=str(Path(__file__).resolve().parents[1] / "assets" / "textures"))
ap.add_argument("--tile", type=float, default=1.0)
args = ap.parse_args(argv)

# 材質の並び(material_index はこの順)
MATERIALS = [
    ("floor", "floor_wood", 0.75),
    ("wall", "wall_plaster", 0.95),
    ("ceiling", "ceiling_plaster", 0.95),
    ("door", "door_wood", 0.6),
    ("window", "glass", 0.1),
    ("wood", "object_wood", 0.7),
    ("fabric", "fabric", 0.95),
    ("neutral", "neutral", 0.9),
]
IDX = {name: i for i, (name, _, _) in enumerate(MATERIALS)}
FABRIC = {"sofa", "bed"}
WOOD = {"table", "storage", "chair", "television", "stairs"}


def mat3_from_transform(t):
    """RoomPlan の transform(列優先の 4x4。入れ子でも平らでもよい)から、回転の列 3 本と位置。"""
    flat = []

    def walk(v):
        if isinstance(v, list):
            for x in v:
                walk(x)
        else:
            flat.append(float(v))

    walk(t)
    if len(flat) != 16:
        return None
    cols = [flat[0:3], flat[4:7], flat[8:11]]
    return cols, flat[12:15]


def load_elements():
    """箱のかたまり: {kind, name, center, axes(3 本), half(3)}。room.json があれば向きつき、無ければ向きなし。"""
    hints = json.loads(Path(args.hints).read_text(encoding="utf-8"))
    out = []
    room = json.loads(Path(args.room).read_text(encoding="utf-8")) if args.room and Path(args.room).exists() else None
    hint_objects = [h for h in hints if h["kind"] == "object"]
    if room is not None:
        keys = {"floor": "floors", "door": "doors", "window": "windows", "opening": "openings", "object": "objects"}
        for kind, key in keys.items():
            items = room.get(key) or []
            for i, it in enumerate(items):
                tr = mat3_from_transform(it.get("transform"))
                dims = it.get("dimensions")
                if tr is None or not dims or len(dims) != 3:
                    continue
                name = kind
                if kind == "object" and len(hint_objects) == len(items):
                    name = hint_objects[i]["name"]
                out.append({"kind": kind, "name": name, "center": tr[1], "axes": tr[0],
                            "half": [max(d / 2, 0.0) for d in dims]})
        if out:
            return out, hints
    # 向きの分からない代わり: ヒントの中心と寸法で、軸に平行な箱とみなす
    for h in hints:
        if h["kind"] in ("door", "window", "object", "opening"):
            out.append({"kind": h["kind"], "name": h["name"], "center": h["position"],
                        "axes": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                        "half": [max(d / 2, 0.0) for d in h["dimensions"]]})
    return out, hints


def floor_height(hints):
    floors = [h for h in hints if h["kind"] == "floor"]
    if floors:
        return sum(f["position"][1] for f in floors) / len(floors)
    walls = [h for h in hints if h["kind"] == "wall"]
    if walls:
        return min(w["position"][1] - w["dimensions"][1] / 2 for w in walls)
    return 0.0


def local_in(el, p):
    c, ax = el["center"], el["axes"]
    d = [p[i] - c[i] for i in range(3)]
    return [sum(ax[k][i] * d[i] for i in range(3)) for k in range(3)]


def inside(el, p):
    """面の中心 p(撮った座標)が、箱の中か。面(ドア・窓)は厚みが 0 なので、法線の向きに余裕を持たせる。"""
    loc = local_in(el, p)
    if el["kind"] in ("door", "window", "opening", "floor"):
        pad = (0.04, 0.04, 0.25)
    else:
        pad = (0.04, 0.04, 0.04)
    return all(abs(loc[k]) <= el["half"][k] + pad[k] for k in range(3))


def classify(p, n, elements, floor_y):
    for el in elements:
        if el["kind"] in ("door", "window") and inside(el, p):
            return "door" if el["kind"] == "door" else "window"
    for el in elements:
        if el["kind"] == "object" and inside(el, p):
            if el["name"] in FABRIC:
                return "fabric"
            if el["name"] in WOOD:
                return "wood"
            return "neutral"
    if n[1] > 0.7:
        return "floor" if p[1] < floor_y + 0.35 else "neutral"
    if n[1] < -0.7:
        return "ceiling" if p[1] > floor_y + 1.5 else "neutral"
    return "wall"


def make_material(name, tex, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = rough
    img = bpy.data.images.load(str(Path(args.textures) / f"{tex}.png"))
    img.pack()
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("stylize_room: メッシュが無い")
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
room = bpy.context.view_layer.objects.active
room.name = "room"
me = room.data
me.materials.clear()
for name, tex, rough in MATERIALS:
    me.materials.append(make_material(name, tex, rough))

elements, hints = load_elements()
floor_y = floor_height(hints)
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
uv = bm.loops.layers.uv.verify()
counts = {name: 0 for name, _, _ in MATERIALS}


def scan(v):
    return (v.x, v.z, -v.y)


for f in bm.faces:
    c = f.calc_center_median()
    p = scan(c)
    nb = f.normal
    n = scan(nb)
    kind = classify(p, n, elements, floor_y)
    f.material_index = IDX[kind]
    counts[kind] += 1
    ax = max(range(3), key=lambda i: abs(n[i]))
    for loop in f.loops:
        q = scan(loop.vert.co)
        u, v = (q[0], q[2]) if ax == 1 else ((q[2], q[1]) if ax == 0 else (q[0], q[1]))
        loop[uv].uv = (u / args.tile, v / args.tile)

bm.to_mesh(me)
bm.free()
bpy.ops.export_scene.gltf(filepath=args.dst, export_format="GLB", export_yup=True, export_apply=True)
print("STYLIZE_REPORT " + json.dumps({"faces": counts, "elements": len(elements), "floor_y": round(floor_y, 3),
                                      "oriented": bool(args.room and Path(args.room).exists())}, ensure_ascii=False))
