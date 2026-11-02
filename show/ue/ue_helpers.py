"""UE の Python で何度も使う小さな道具。"""
import unreal

SHOW_ROOT = "/Game/Show"
MATERIAL_DIR = SHOW_ROOT + "/Materials"
MEDIA_DIR = SHOW_ROOT + "/Media"
CHARACTER_DIR = SHOW_ROOT + "/Character/f_led"
SEQUENCE_DIR = SHOW_ROOT + "/Seq"
RENDER_CONFIG_DIR = SHOW_ROOT + "/RenderConfig"
LEVEL_PATH = SHOW_ROOT + "/L_Stage"

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
assets = unreal.EditorAssetLibrary
log = unreal.log


def get_or_create(name, folder, cls, factory):
    """同じ名前の資産があれば使い回す(資産は消さない)。"""
    path = f"{folder}/{name}"
    if assets.does_asset_exist(path):
        return unreal.load_asset(path), False
    created = asset_tools.create_asset(name, folder, cls, factory)
    if created is None:
        raise RuntimeError(f"資産を作れない: {path}")
    return created, True


def save(asset):
    if not assets.save_loaded_asset(asset, only_if_is_dirty=False):
        raise RuntimeError(f"保存できない: {asset.get_path_name()}")


def vec(x, y, z):
    return unreal.Vector(float(x), float(y), float(z))


def write_report(path, lines):
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(str(line) for line in lines) + "\n")
