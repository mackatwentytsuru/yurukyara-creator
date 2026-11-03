"""形と動きが一緒に入った GLB を取り込み、中身を報告する。環境変数 GLB_SOURCE・GLB_NAME・GLB_REPORT。
GLB_SAMPLE_RATE(任意)を付けると、動きをそのコマ数で焼く。無ければ今までどおり自動(60 fps の glb が 24 fps に間引かれる)。
-run=pythonscript -script=このファイル で動かす。
"""
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import unreal  # noqa: E402

from ue_helpers import SHOW_ROOT, assets, write_report  # noqa: E402


def import_default(source, dest):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", source)
    task.set_editor_property("destination_path", dest)
    task.set_editor_property("automated", True)
    task.set_editor_property("save", True)
    task.set_editor_property("replace_existing", True)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    unreal.AssetRegistryHelpers.get_asset_registry().wait_for_completion()


def import_at_rate(source, dest, rate):
    """glTF の既定の流れを写して、動きのコマ数だけ変えて使う。エンジンの資産は変えない。"""
    name = f"P_GltfAssets_{rate}"
    path = f"{SHOW_ROOT}/RenderConfig/{name}"
    if not assets.does_asset_exist(path):
        # コマンドレットでは /Interchange が登録に載っていないので、読み込んでから写す
        source_pipeline = unreal.load_asset("/Interchange/Pipelines/DefaultGLTFAssetsPipeline.DefaultGLTFAssetsPipeline")
        if source_pipeline is None or assets.duplicate_loaded_asset(source_pipeline, path) is None:
            raise RuntimeError("glTF の取り込みの流れを写せない")
    pipeline = unreal.load_asset(path)
    animation = pipeline.get_editor_property("animation_pipeline")
    animation.set_editor_property("custom_bone_animation_sample_rate", rate)
    # 長さがコマの境界にわずかに乗らないと、取り込みがエラーで動きを作らない
    animation.set_editor_property("frame_alignment", unreal.InterchangeFrameAlignment.SNAP_TO_CLOSEST)
    assets.save_loaded_asset(pipeline, only_if_is_dirty=False)
    parameters = unreal.ImportAssetParameters()
    parameters.set_editor_property("is_automated", True)
    parameters.set_editor_property("replace_existing", True)
    parameters.set_editor_property("override_pipelines", [
        unreal.SoftObjectPath(f"{path}.{name}"),
        unreal.SoftObjectPath("/Interchange/Pipelines/DefaultGLTFPipeline.DefaultGLTFPipeline")])
    data = unreal.InterchangeManager.create_source_data(source)
    if not unreal.InterchangeManager.get_interchange_manager_scripted().import_asset(dest, data, parameters):
        raise RuntimeError("取り込みに失敗")
    unreal.AssetRegistryHelpers.get_asset_registry().wait_for_completion()


def main():
    source, dest = os.environ["GLB_SOURCE"], f"{SHOW_ROOT}/Character/{os.environ['GLB_NAME']}"
    rate = int(os.environ.get("GLB_SAMPLE_RATE", "0"))
    if rate:
        import_at_rate(source, dest, rate)
    else:
        import_default(source, dest)
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
            line += f" 長さ={unreal.AnimationLibrary.get_sequence_length(asset):.2f} コマ={unreal.AnimationLibrary.get_num_frames(asset)} 曲線={len(curves)} {[str(c) for c in curves][:6]}"
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
