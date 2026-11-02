"""期間中に作ったキャラの glb を取り込み、中身を報告する。"""
import unreal

from ue_helpers import CHARACTER_DIR, assets

MODEL_PATH = "repo/characters/f_led/model.glb"


def list_folder(folder):
    unreal.AssetRegistryHelpers.get_asset_registry().wait_for_completion()
    return assets.list_assets(folder, recursive=True, include_folder=False)


def import_character():
    existing = list_folder(CHARACTER_DIR)
    if existing:
        return existing
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", MODEL_PATH)
    task.set_editor_property("destination_path", CHARACTER_DIR)
    task.set_editor_property("automated", True)
    task.set_editor_property("save", True)
    task.set_editor_property("replace_existing", True)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    found = list_folder(CHARACTER_DIR)
    for path in found:
        asset = unreal.load_asset(path)
        if asset is not None:
            assets.save_loaded_asset(asset, only_if_is_dirty=False)
    return found


def find_character_meshes(paths):
    """骨付きの形(胴と顔が別々に入ってくる)を全部返す。"""
    meshes = [unreal.load_asset(path) for path in paths]
    return [mesh for mesh in meshes if isinstance(mesh, unreal.SkeletalMesh)]


def find_face_atlas(paths):
    for path in paths:
        asset = unreal.load_asset(path)
        if isinstance(asset, unreal.Texture2D):
            return asset
    raise RuntimeError("顔のアトラスが無い")
