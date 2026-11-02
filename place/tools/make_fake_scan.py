"""撮影アプリの出力(room_mesh.usdz と landmarks_hint.json)に似せた、試し用のフォルダを Blender で作る。
本物のスキャンが届く前に、ingest_roomscan.mjs の道を端から端まで試すため。
  blender -b --python place/tools/make_fake_scan.py -- <出力フォルダ>
部屋: 幅 4.0 m(x)× 奥行き 5.0 m(z)× 高さ 2.5 m。RoomPlan のように、床が y=-1.3 にある座標で作る
(撮りはじめた手の高さが原点になるため)。入口のドアは奥の壁(z=+2.5)、x=+1.5。
"""
import json
import sys
from pathlib import Path

import bpy

out = Path(sys.argv[sys.argv.index("--") + 1])
out.mkdir(parents=True, exist_ok=True)

FLOOR_Y = -1.3
W, D, H = 4.0, 5.0, 2.5

bpy.ops.wm.read_factory_settings(use_empty=True)


def box(name, center, size):
    # Blender は z が上。ここでは「y が上」の座標で決めた値を (x, -z, y) に直して置く。
    x, y, z = center
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0], size[2], size[1])
    return o


box("floor", (0, FLOOR_Y - 0.025, 0), (W, 0.05, D))
box("wall_n", (0, FLOOR_Y + H / 2, -D / 2), (W, H, 0.1))
box("wall_s", (0, FLOOR_Y + H / 2, D / 2), (W, H, 0.1))
box("wall_w", (-W / 2, FLOOR_Y + H / 2, 0), (0.1, H, D))
box("wall_e", (W / 2, FLOOR_Y + H / 2, 0), (0.1, H, D))
box("table", (-0.8, FLOOR_Y + 0.375, -1.0), (1.2, 0.75, 0.7))

bpy.ops.wm.usd_export(filepath=str(out / "room_mesh.usdz"))

hints = [
    {"kind": "floor", "name": "floor", "position": [0, FLOOR_Y, 0], "dimensions": [W, D, 0], "confidence": "high"},
    {"kind": "wall", "name": "wall", "position": [0, FLOOR_Y + H / 2, -D / 2], "dimensions": [W, H, 0.1], "confidence": "high"},
    {"kind": "door", "name": "door", "position": [1.5, FLOOR_Y + 1.0, D / 2], "dimensions": [0.9, 2.0, 0.1], "confidence": "high"},
    {"kind": "window", "name": "window", "position": [-W / 2, FLOOR_Y + 1.5, 0.5], "dimensions": [1.2, 1.1, 0.1], "confidence": "medium"},
    {"kind": "object", "name": "table", "position": [-0.8, FLOOR_Y + 0.375, -1.0], "dimensions": [1.2, 0.75, 0.7], "confidence": "high"},
]
(out / "landmarks_hint.json").write_text(json.dumps(hints, ensure_ascii=False, indent=2), encoding="utf-8")
print("make_fake_scan: できた", out)
