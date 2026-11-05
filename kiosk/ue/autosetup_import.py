"""CC5 の人型の FBX を、Reallusion の Auto Setup(RLPlugin の CCFbxFactory)で取り込む。材質は Auto Setup が作った物だけを使う。
  UnrealEditor.exe <HackShow.uproject> -nullrhi -unattended -nosplash -nosound -abslog=<ログ> -ExecutePythonScript=<このファイル>
  (UnrealEditor-Cmd の commandlet では Auto Setup が保存の窓を開こうとして落ちる。窓なしのエディタで流す)
前提: プロジェクトの Plugins に RLPlugin(Auto Setup)がある。FBX の横に CC の json・.fbm・textures がある(書き出しのまま)。
設定: entrance_config.json の autosetup(取り込み先)と character(FBX・名前)。
髪の絵の付け直し(ENTRANCE_AS_HAIRFIX=1 で既定 on): Auto Setup が作った髪の材質のうち、絵の差し込み口が空の物に、
  ほかの髪の材質の同じ名前の絵を入れるだけ(新しい材質は作らない)。前後を報告に分けて書く。
報告は環境変数 ENTRANCE_REPORT。最後の行が AS_OK なら成功。
"""
import json
import os
import time
import traceback

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "entrance_config.json"), encoding="utf-8"))
AS = CFG["autosetup"]
REPORT = os.environ.get("ENTRANCE_REPORT", os.path.join(os.getcwd(), "entrance_autosetup_report.txt"))
lib = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary
report = []


def say(msg):
    report.append(str(msg))
    unreal.log("[EntranceAS] " + str(msg))


def flush():
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")


def find_skeletal_mesh(folder):
    for path in lib.list_assets(folder, recursive=False, include_folder=False):
        data = lib.find_asset_data(path)
        if str(data.asset_class_path.asset_name) == "SkeletalMesh":
            return unreal.load_asset(path)
    return None


def do_import(src, dest):
    fac = unreal.CCFbxFactory()
    ui = unreal.FbxImportUI()
    for k, v in (("import_mesh", True), ("import_as_skeletal", True), ("import_materials", True),
                 ("import_textures", True), ("import_animations", False)):
        ui.set_editor_property(k, v)
    ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_SKELETAL_MESH)
    task = unreal.AssetImportTask()
    for k, v in (("filename", src), ("destination_path", dest), ("automated", True), ("replace_existing", True),
                 ("save", True), ("factory", fac), ("options", ui)):
        task.set_editor_property(k, v)
    t0 = time.time()
    try:
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    except Exception as e:  # 最後に AS_ExpSequence の例外が出ても、Auto Setup は済んでいる(ログで確かめる)
        say(f"import raised (expected AS_ExpSequence?): {str(e)[:200]}")
    unreal.AssetRegistryHelpers.get_asset_registry().wait_for_completion()
    say(f"import {time.time() - t0:.0f}s")


def tex_params(mi):
    out = {}
    for name in mel.get_texture_parameter_names(mi.get_editor_property("parent")) if mi.get_editor_property("parent") else []:
        out[str(name)] = mel.get_material_instance_texture_parameter_value(mi, name)
    return out


def hair_fix(mesh, dest):
    """髪の材質の絵の口のうち、Auto Setup が既定の絵(Black・Flow_downward・ORM_Default など。取り込み先の外の絵)のままにした物へ、
    同じ絵の組(Blend Map が同じ = L と R、T と B が 1 枚の絵を分け合う)の髪の材質に入った絵を差す。新しい材質は作らない。"""
    hair = []
    for s in mesh.get_editor_property("materials"):
        mi = s.get_editor_property("material_interface")
        slot = str(s.get_editor_property("material_slot_name"))
        if isinstance(mi, unreal.MaterialInstanceConstant) and "Hair" in slot and "Scalp" not in slot:
            hair.append((slot, mi))
    if not hair:
        say("hair: no hair slots")
        return
    params = {slot: tex_params(mi) for slot, mi in hair}
    own = lambda t: t is not None and t.get_path_name().startswith(dest + "/")  # noqa: E731  取り込んだ絵か
    for slot, p in params.items():
        say(f"hair AS-as-is {slot}: " + ", ".join(f"{k}={'-' if v is None else v.get_name()}" for k, v in sorted(p.items())
                                                     if k in ("Root Map", "ID Map", "Flow Map", "ORM Map", "Blend Map", "Base Color Map")))
    if os.environ.get("ENTRANCE_AS_HAIRFIX", "1") != "1":
        return
    for slot, mi in hair:
        blend = params[slot].get("Blend Map")
        donors = sorted((o for o, _ in hair if o != slot), key=lambda o: params[o].get("Blend Map") != blend)  # 同じ組を先に
        changed = False
        for k, v in params[slot].items():
            if own(v) or not k.endswith("Map"):
                continue
            donor = next((params[o][k] for o in donors if own(params[o].get(k))), None)
            if donor is not None:
                mel.set_material_instance_texture_parameter_value(mi, k, donor)
                say(f"hair re-texture {slot}.{k}: {'-' if v is None else v.get_name()} -> {donor.get_name()}")
                changed = True
        if changed:
            mel.update_material_instance(mi)
            lib.save_loaded_asset(mi, only_if_is_dirty=False)


def main():
    c = CFG["character"]
    dest = f"{AS['folder']}/{c['name']}"
    mesh = find_skeletal_mesh(dest) if lib.does_directory_exist(dest) else None
    if mesh is None or os.environ.get("ENTRANCE_REIMPORT") == "1":
        do_import(c["source_fbx"], dest)
        mesh = find_skeletal_mesh(dest)
    if mesh is None:
        raise RuntimeError("Auto Setup の取り込みで SkeletalMesh ができない: " + dest)
    skel = mesh.get_editor_property("skeleton")
    say(f"mesh {mesh.get_path_name()} skeleton {skel.get_path_name() if skel else None}")
    morphs = [m.get_name() for m in mesh.get_editor_property("morph_targets")]
    say(f"morphs {len(morphs)} sample: {', '.join(m for m in morphs if m.startswith(('V_', 'Mouth', 'Jaw', 'Eye_Blink')))[:400]}")
    for s in mesh.get_editor_property("materials"):
        mi = s.get_editor_property("material_interface")
        par = mi.get_editor_property("parent") if isinstance(mi, unreal.MaterialInstance) else None
        say(f"slot {s.get_editor_property('material_slot_name')}: {mi.get_path_name() if mi else None} parent {par.get_path_name() if par else None}")
    hair_fix(mesh, dest)
    say("AS_OK")


try:
    main()
except Exception:
    say("AS_FAILED\n" + traceback.format_exc())
finally:
    flush()
