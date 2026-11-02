"""動きの glb を 1 本取り込めるかを試す(1 回だけの確かめ)。結果をファイルに書く。"""
import unreal

SOURCE = "repo/characters/f_led/motions/wave.glb"
DEST = "/Game/Show/Character/f_led_motion/wave"
REPORT = "work/ue_show/logs/try_motion.txt"

lines = []
task = unreal.AssetImportTask()
task.set_editor_property("filename", SOURCE)
task.set_editor_property("destination_path", DEST)
task.set_editor_property("automated", True)
task.set_editor_property("save", True)
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
unreal.AssetRegistryHelpers.get_asset_registry().wait_for_completion()
for path in unreal.EditorAssetLibrary.list_assets(DEST, recursive=True, include_folder=False):
    asset = unreal.load_asset(path)
    line = f"{path} {type(asset).__name__}"
    if isinstance(asset, unreal.AnimSequence):
        skeleton = asset.get_editor_property("skeleton")
        line += f" skeleton={skeleton.get_path_name() if skeleton else None}"
        line += f" length={asset.get_editor_property('sequence_length') if hasattr(asset, 'sequence_length') else '?'}"
    lines.append(line)
lines.append(f"count {len(lines)}")
with open(REPORT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
