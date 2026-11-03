"""形と動きが一緒に入った GLB を取り込み、中身を報告する。環境変数 GLB_SOURCE・GLB_NAME・GLB_REPORT。
-run=pythonscript -script=このファイル で動かす。
"""
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unreal  # noqa: E402

from ue_helpers import SHOW_ROOT, assets, write_report  # noqa: E402


def main():
    source, dest = os.environ["GLB_SOURCE"], f"{SHOW_ROOT}/Character/{os.environ['GLB_NAME']}"
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", source)
    task.set_editor_property("destination_path", dest)
    task.set_editor_property("automated", True)
    task.set_editor_property("save", True)
    task.set_editor_property("replace_existing", True)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    unreal.AssetRegistryHelpers.get_asset_registry().wait_for_completion()
    lines = []
    for path in assets.list_assets(dest, recursive=True, include_folder=False):
        asset = unreal.load_asset(path)
        if asset is None:
            lines.append(f"{path} 読めない")
            continue
        assets.save_loaded_asset(asset, only_if_is_dirty=False)
        line = f"{path} {type(asset).__name__}"
        if isinstance(asset, unreal.AnimSequence):
            curves = unreal.AnimationLibrary.get_animation_curve_names(asset, unreal.RawCurveTrackTypes.RCT_FLOAT)
            line += f" 長さ={unreal.AnimationLibrary.get_sequence_length(asset):.2f} 曲線={len(curves)} {[str(c) for c in curves][:6]}"
        if isinstance(asset, unreal.SkeletalMesh):
            line += f" 形の数={len(asset.get_all_morph_target_names())} 材質={len(asset.materials)} 骨={asset.skeleton.get_name() if asset.skeleton else None}"
        lines.append(line)
    lines.append("IMPORT_OK")
    write_report(os.environ["GLB_REPORT"], lines)


try:
    main()
except Exception:
    write_report(os.environ["GLB_REPORT"], ["IMPORT_FAILED", traceback.format_exc()])
    raise
