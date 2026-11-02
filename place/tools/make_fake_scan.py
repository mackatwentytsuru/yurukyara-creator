"""撮影アプリの出力(room_mesh.usdz・landmarks_hint.json・room.json)に似せた、試し用のフォルダを Blender で作る。
本物のスキャンが届く前に、ingest_roomscan.mjs と stylize_room.py の道を端から端まで試すため。
  blender -b --python place/tools/make_fake_scan.py -- <出力フォルダ>
部屋: 幅 4.0 m(x)× 奥行き 5.0 m(z)× 高さ 2.5 m。RoomPlan のように、
 - 床が y=-1.3 にある座標で作る(撮りはじめた手の高さが原点になるため)
 - 部屋全体を y 軸まわりに 30 度回しておく(撮りはじめた向きしだいで、向きは毎回ちがうため)
入口のドアは奥の壁(部屋の座標で z=+2.5)の x=+1.5。
room.json は RoomPlan の形(列優先の 4x4 と寸法)のつもりで書く。実物の形は本物が届いたら確かめる。
"""
import json
import math
import sys
from pathlib import Path

import bpy

out = Path(sys.argv[sys.argv.index("--") + 1])
out.mkdir(parents=True, exist_ok=True)

FLOOR_Y = -1.3
W, D, H = 4.0, 5.0, 2.5
ALPHA = math.radians(30)  # 部屋全体を y 軸まわりに回す角度

bpy.ops.wm.read_factory_settings(use_empty=True)


def rot(p):
    """部屋の座標 → 撮った座標(y 軸まわりに ALPHA)。"""
    x, y, z = p
    return (x * math.cos(ALPHA) + z * math.sin(ALPHA), y, -x * math.sin(ALPHA) + z * math.cos(ALPHA))


def transform(center, base_yaw=0.0):
    """RoomPlan の transform のつもりの、列優先の 4x4(入れ子)。x 軸が幅、z 軸が法線。"""
    g = base_yaw + ALPHA
    c, s = math.cos(g), math.sin(g)
    cx, cy, cz = rot(center)
    return [[c, 0, -s, 0], [0, 1, 0, 0], [s, 0, c, 0], [cx, cy, cz, 1]]


def box(name, center, size, base_yaw=0.0):
    # 部屋の座標(y が上)の値を、回したあとの撮った座標にして、Blender(z が上)の (x, -z, y) に置く
    x, y, z = rot(center)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0], size[2], size[1])
    o.rotation_euler = (0, 0, ALPHA)
    return o


box("floor", (0, FLOOR_Y - 0.025, 0), (W, 0.05, D))
box("wall_n", (0, FLOOR_Y + H / 2, -D / 2), (W, H, 0.1))
box("wall_s", (0, FLOOR_Y + H / 2, D / 2), (W, H, 0.1))
box("wall_w", (-W / 2, FLOOR_Y + H / 2, 0), (0.1, H, D))
box("wall_e", (W / 2, FLOOR_Y + H / 2, 0), (0.1, H, D))
box("table", (-0.8, FLOOR_Y + 0.375, -1.0), (1.2, 0.75, 0.7))
box("sofa", (1.0, FLOOR_Y + 0.4, -1.8), (1.8, 0.8, 0.9))

bpy.ops.wm.usd_export(filepath=str(out / "room_mesh.usdz"))

# (kind, name, 部屋の座標の中心, 寸法 [幅, 高さ, 奥行き], 部屋の中での向き(rad))
ELEMENTS = [
    ("floor", "floor", (0, FLOOR_Y, 0), (W, D, 0.0), 0.0),
    ("wall", "wall", (0, FLOOR_Y + H / 2, -D / 2), (W, H, 0.1), 0.0),
    ("door", "door", (1.5, FLOOR_Y + 1.0, D / 2), (0.9, 2.0, 0.1), 0.0),
    ("window", "window", (-W / 2, FLOOR_Y + 1.5, 0.5), (1.2, 1.1, 0.1), math.pi / 2),
    ("object", "table", (-0.8, FLOOR_Y + 0.375, -1.0), (1.2, 0.75, 0.7), 0.0),
    ("object", "sofa", (1.0, FLOOR_Y + 0.4, -1.8), (1.8, 0.8, 0.9), 0.0),
]
hints = []
room_json = {"floors": [], "walls": [], "doors": [], "windows": [], "openings": [], "objects": [], "version": 2}
for kind, name, center, dims, yaw in ELEMENTS:
    hints.append({"kind": kind, "name": name, "position": [round(v, 4) for v in rot(center)],
                  "dimensions": list(dims), "confidence": "high"})
    room_json[kind + "s"].append({"transform": transform(center, yaw), "dimensions": list(dims)})

(out / "landmarks_hint.json").write_text(json.dumps(hints, ensure_ascii=False, indent=2), encoding="utf-8")
(out / "room.json").write_text(json.dumps(room_json, indent=2), encoding="utf-8")
print("make_fake_scan: できた", out)
