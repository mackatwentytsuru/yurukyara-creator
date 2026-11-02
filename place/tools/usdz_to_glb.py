"""Blender の画面なし(-b)で USDZ を GLB に変える。
  blender -b --python place/tools/usdz_to_glb.py -- <入力.usdz> <出力.glb>
RoomPlan の USDZ は y が上・単位 m。Blender は z が上で取りこみ、glTF の書き出しで y が上に戻る。
縮尺と向きは、変換後に ingest_roomscan.mjs が箱の大きさを測って確かめる。
"""
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.usd_import(filepath=src)
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
)
print("usdz_to_glb: 書き出した", dst)
