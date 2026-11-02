"""ステージを組む入口。-run=pythonscript -script=このファイル で動かす。"""
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unreal  # noqa: E402

import build_character  # noqa: E402
import build_level  # noqa: E402
import build_materials  # noqa: E402
import build_sequences  # noqa: E402
from ue_helpers import assets, write_report  # noqa: E402

REPORT_PATH = "work/ue_show/logs/build_report.txt"


def main():
    report = []
    media_texture = build_materials.build_media_texture()
    led_parent = build_materials.build_led_material(media_texture)
    surface = build_materials.build_surface_material()
    paths = build_character.import_character()
    report.append("character assets: " + ", ".join(paths))
    meshes = build_character.find_character_meshes(paths)
    face = build_materials.build_face_material(build_character.find_face_atlas(paths))
    level_actors = build_level.build_all(surface, led_parent, face, meshes, report)
    build_sequences.build_all(level_actors, media_texture)
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    report.append("content: " + ", ".join(assets.list_assets("/Game", recursive=True, include_folder=False)))
    report.append("BUILD_OK")
    write_report(REPORT_PATH, report)


try:
    main()
except Exception:
    write_report(REPORT_PATH, ["BUILD_FAILED", traceback.format_exc()])
    raise
