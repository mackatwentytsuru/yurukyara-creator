"""入口の LED(縦長)の UE のレベルを組む。画面なしの UE で動かす(期間中に作ったショーの UE プロジェクトに、新しいレベルとして足す)。
  UnrealEditor-Cmd.exe <HackShow.uproject> -run=pythonscript -script=<このファイル> -unattended -nosplash -nullrhi
設定は entrance_config.json(キャラの差し替えは character の 1 か所 → このファイルを流し直す)。
作る物(全部 content_root の下。ショーの /Game/Show は触らない):
  Char/<name>/      人型の FBX の取り込み(初回だけ。同じ名前があれば使い回す)
  M_EntranceSurface 壁と床の単色の材質
  BP_EntranceChar   PoseableMesh を 1 つ持つ箱。ゲーム中に entrance_runtime.py が首・目・顎・腕を動かす
  L_Entrance_Interview  キャラ・部屋・光・縦長の LED の画角のカメラ
報告は環境変数 ENTRANCE_REPORT(既定 ./entrance_build_report.txt)。最後の行が BUILD_OK なら成功。
"""
import json
import math
import os
import sys
import time
import traceback

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import entrance_materials  # noqa: E402
CFG = json.load(open(os.path.join(HERE, "entrance_config.json"), encoding="utf-8"))
ROOT = CFG["content_root"]
VARIANT = os.environ.get("ENTRANCE_VARIANT", CFG.get("variant", "glb"))
EXPOSURE = CFG["autosetup"].get("exposure_bias", 1.0) if VARIANT == "autosetup" else 1.0  # 露出(レベルの後処理。材質は触らない)  # autosetup = Auto Setup の人型(autosetup_import.py で取り込み済み)/ glb = 予備
REPORT = os.environ.get("ENTRANCE_REPORT", os.path.join(os.getcwd(), "entrance_build_report.txt"))
lib = unreal.EditorAssetLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary
report = []


def say(msg):
    report.append(str(msg))
    unreal.log("[Entrance] " + str(msg))


def vec(x, y, z):
    return unreal.Vector(float(x), float(y), float(z))


def find_skeletal_mesh(folder):
    for path in lib.list_assets(folder, recursive=True, include_folder=False):
        data = unreal.EditorAssetLibrary.find_asset_data(path)
        if str(data.asset_class_path.asset_name) == "SkeletalMesh":
            return unreal.load_asset(path)
    return None


def import_character():
    c = CFG["character"]
    dest = f"{ROOT}/Char/{c['name']}"
    mesh = find_skeletal_mesh(dest) if lib.does_directory_exist(dest) else None
    if mesh and os.environ.get("ENTRANCE_REIMPORT") != "1":
        say(f"character reuse {mesh.get_path_name()}")
        return mesh
    if not os.path.exists(c["fbx"]):
        raise RuntimeError("FBX が無い: " + c["fbx"])
    if lib.does_directory_exist(dest):
        lib.delete_directory(dest)
    t0 = time.time()
    if c["fbx"].lower().endswith(".glb"):
        # GLB(kiosk/ue/cc_fbx_to_glb.py で CC の FBX から作った物。骨とメッシュの枠が揃っている)は 5.8 の Interchange で入れる
        task = unreal.AssetImportTask()
        for k, v in (("filename", c["fbx"]), ("destination_path", dest), ("automated", True), ("save", True), ("replace_existing", True)):
            task.set_editor_property(k, v)
        tools.import_asset_tasks([task])
        unreal.AssetRegistryHelpers.get_asset_registry().wait_for_completion()
        say(f"import glb {time.time() - t0:.0f}s: " + ", ".join(list(task.get_editor_property("imported_object_paths"))[:8]))
        mesh = find_skeletal_mesh(dest)
        if mesh is None:
            raise RuntimeError("GLB の取り込みで SkeletalMesh ができない")
        lib.save_directory(dest, only_if_is_dirty=True, recursive=True)
        return mesh
    # 従来の FBX の取り込みを使う(5.8 の Interchange は CC の FBX の骨の基準の姿勢を「無効」として、服の形が崩れた: コルセットが消える・裾が飛ぶ)
    unreal.SystemLibrary.execute_console_command(None, "Interchange.FeatureFlags.Import.FBX False")
    ui = unreal.FbxImportUI()
    ui.set_editor_property("import_mesh", True)
    ui.set_editor_property("import_as_skeletal", True)
    ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_SKELETAL_MESH)
    ui.set_editor_property("import_animations", False)
    ui.set_editor_property("import_materials", True)
    ui.set_editor_property("import_textures", True)
    ui.set_editor_property("create_physics_asset", False)
    sk = ui.get_editor_property("skeletal_mesh_import_data")
    sk.set_editor_property("import_morph_targets", True)
    sk.set_editor_property("use_t0_as_ref_pose", os.environ.get("ENTRANCE_T0", "1") == "1")
    sk.set_editor_property("convert_scene", True)
    sk.set_editor_property("update_skeleton_reference_pose", False)
    task = unreal.AssetImportTask()
    task.set_editor_property("options", ui)
    task.set_editor_property("filename", c["fbx"])
    task.set_editor_property("destination_path", dest)
    task.set_editor_property("automated", True)
    task.set_editor_property("save", True)
    task.set_editor_property("replace_existing", True)
    tools.import_asset_tasks([task])
    unreal.AssetRegistryHelpers.get_asset_registry().wait_for_completion()
    say(f"import {time.time() - t0:.0f}s: " + ", ".join(list(task.get_editor_property("imported_object_paths"))[:8]))
    mesh = find_skeletal_mesh(dest)
    if mesh is None:
        raise RuntimeError("取り込みで SkeletalMesh ができない")
    lib.save_directory(dest, only_if_is_dirty=True, recursive=True)
    return mesh


def describe_mesh(mesh):
    try:
        morphs = [m.get_name() for m in mesh.get_editor_property("morph_targets")]
    except Exception as e:  # 5.8 で名前が違うとき
        morphs = [f"(morph の一覧を読めない: {e})"]
    slots = [str(s.get_editor_property("material_slot_name")) for s in mesh.get_editor_property("materials")]
    say(f"mesh {mesh.get_name()} morphs {len(morphs)} (V_Open {'V_Open' in morphs}) slots {len(slots)}: {', '.join(slots[:40])}")


def surface_material():
    path = f"{ROOT}/M_EntranceSurface"
    if lib.does_asset_exist(path):
        return unreal.load_asset(path)
    m = tools.create_asset("M_EntranceSurface", ROOT, unreal.Material, unreal.MaterialFactoryNew())
    color = mel.create_material_expression(m, unreal.MaterialExpressionVectorParameter, -400, 0)
    color.set_editor_property("parameter_name", "Color")
    color.set_editor_property("default_value", unreal.LinearColor(0.2, 0.2, 0.2, 1))
    rough = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -400, 250)
    rough.set_editor_property("parameter_name", "Roughness")
    rough.set_editor_property("default_value", 0.8)
    mel.connect_material_property(color, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.recompile_material(m)
    lib.save_loaded_asset(m, only_if_is_dirty=False)
    return m


def surface(name, parent, rgb, rough=0.85):
    path = f"{ROOT}/MI_{name}"
    mi = unreal.load_asset(path) if lib.does_asset_exist(path) else tools.create_asset(
        f"MI_{name}", ROOT, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, parent)
    mel.set_material_instance_vector_parameter_value(mi, "Color", unreal.LinearColor(*rgb, 1))
    mel.set_material_instance_scalar_parameter_value(mi, "Roughness", rough)
    lib.save_loaded_asset(mi, only_if_is_dirty=False)
    return mi


def character_blueprint(mesh, name="BP_EntranceChar"):
    """PoseableMesh を 1 つ持つ BP(ゲーム中に Python が骨を直接置く。アニメの BP は使わない)"""
    path = f"{ROOT}/{name}"
    sds = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    lib_sd = unreal.SubobjectDataBlueprintFunctionLibrary
    comp = None
    if lib.does_asset_exist(path):  # あれば使い回す(消して作り直すと、同じ名前の古い物がメモリに残って作れない)
        bp = unreal.load_asset(path)
        for h in sds.k2_gather_subobject_data_for_blueprint(bp):
            o = lib_sd.get_object(lib_sd.get_data(h))
            if isinstance(o, unreal.PoseableMeshComponent):
                comp = o
    else:
        factory = unreal.BlueprintFactory()
        factory.set_editor_property("parent_class", unreal.Actor)
        bp = tools.create_asset(name, ROOT, unreal.Blueprint, factory)
    if comp is None:
        root = sds.k2_gather_subobject_data_for_blueprint(bp)[0]
        handle, fail = sds.add_new_subobject(unreal.AddNewSubobjectParams(
            parent_handle=root, new_class=unreal.PoseableMeshComponent, blueprint_context=bp))
        if not lib_sd.is_handle_valid(handle):
            raise RuntimeError(f"PoseableMesh を足せない: {fail}")
        sds.rename_subobject(handle, unreal.Text("Body"))
        comp = lib_sd.get_object(lib_sd.get_data(handle))
    comp.set_skinned_asset_and_update(mesh)
    comp.set_editor_property("component_tags", ["EntranceBody", "EntranceVariant_" + VARIANT])
    unreal.BlueprintEditorLibrary.compile_blueprint(bp)
    lib.save_loaded_asset(bp, only_if_is_dirty=False)
    say(f"blueprint {bp.get_path_name()} body {comp.get_class().get_name()}")
    return bp


def open_level(path):
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if lib.does_asset_exist(path):
        if not levels.load_level(path):
            raise RuntimeError("レベルを開けない")
    elif not levels.new_level(path):
        raise RuntimeError("レベルを作れない")
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for a in actors.get_all_level_actors():
        if not isinstance(a, (unreal.WorldSettings, unreal.Brush)):
            actors.destroy_actor(a)
    return levels, actors


def build_level(bp, parent, bp_mesh=None, level_path=None):
    level_path = level_path or CFG["level"]
    levels, actors = open_level(level_path)
    cube = unreal.load_asset("/Engine/BasicShapes/Cube.Cube")

    def box(label, center, size_cm, mi):
        a = actors.spawn_actor_from_class(unreal.StaticMeshActor, vec(*center))
        a.set_actor_label(label)
        a.static_mesh_component.set_static_mesh(cube)
        a.set_actor_scale3d(vec(*(s / 100.0 for s in size_cm)))
        a.static_mesh_component.set_material(0, mi)
        return a

    # 部屋: キャラは原点、カメラ(= LED の面の手前の客)は +X。奥の壁は -X。
    floor = surface("EntranceFloor", parent, (0.08, 0.075, 0.07), 0.6)
    wall = surface("EntranceWall", parent, (0.16, 0.15, 0.17))
    accent = surface("EntranceAccent", parent, (0.02, 0.11, 0.12), 0.5)
    box("Floor", (0, 0, -5), (1400, 1400, 10), floor)
    box("BackWall", (-320, 0, 250), (20, 900, 600), wall)
    box("SideWall_L", (100, -330, 250), (900, 20, 600), wall)
    box("SideWall_R", (100, 330, 250), (900, 20, 600), wall)
    box("BackStripe", (-308, 0, 240), (4, 130, 420), accent)

    char = actors.spawn_actor_from_class(bp.generated_class(), vec(0, 0, 0), unreal.Rotator(0, 0, 0))
    char.set_actor_label("EntranceChar")
    char.tags = ["EntranceChar"]
    if os.environ.get("ENTRANCE_TEST_SKM") == "1":  # 切り分け用: 普通の骨つきメッシュを並べる
        char.set_actor_location(vec(0, -60, 0), False, False)
        skm = actors.spawn_actor_from_class(unreal.SkeletalMeshActor, vec(0, 60, 0), unreal.Rotator(0, 0, 0))
        skm.skeletal_mesh_component.set_skinned_asset_and_update(bp_mesh)
        skm.set_actor_label("TestSkeletalMesh")

    sky = actors.spawn_actor_from_class(unreal.SkyLight, vec(0, 0, 400))
    sc = sky.get_component_by_class(unreal.SkyLightComponent)
    sc.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
    sc.set_editor_property("real_time_capture", False)
    sc.set_editor_property("intensity", 1.0)
    sc.set_editor_property("lower_hemisphere_is_black", False)
    sun = actors.spawn_actor_from_class(unreal.DirectionalLight, vec(0, 0, 500), unreal.Rotator(0, -40, 160))
    sun.light_component.set_editor_property("intensity", 2.0)
    key = actors.spawn_actor_from_class(unreal.RectLight, vec(260, -160, 260), unreal.MathLibrary.find_look_at_rotation(vec(260, -160, 260), vec(0, 0, 150)))
    kc = key.get_component_by_class(unreal.RectLightComponent)
    kc.set_editor_property("intensity", 60.0)
    kc.set_editor_property("source_width", 120.0)
    kc.set_editor_property("source_height", 120.0)
    kc.set_editor_property("attenuation_radius", 1500.0)
    fill = actors.spawn_actor_from_class(unreal.RectLight, vec(240, 200, 180), unreal.MathLibrary.find_look_at_rotation(vec(240, 200, 180), vec(0, 0, 140)))
    fc = fill.get_component_by_class(unreal.RectLightComponent)
    fc.set_editor_property("intensity", 22.0)
    fc.set_editor_property("source_width", 150.0)
    fc.set_editor_property("source_height", 150.0)
    rim = actors.spawn_actor_from_class(unreal.SpotLight, vec(-220, 120, 330), unreal.MathLibrary.find_look_at_rotation(vec(-220, 120, 330), vec(0, 0, 160)))
    rim.light_component.set_editor_property("intensity", 40.0)
    rim.light_component.set_editor_property("light_color", unreal.Color(r=170, g=230, b=255, a=255))

    ppv = actors.spawn_actor_from_class(unreal.PostProcessVolume, vec(0, 0, 150))
    ppv.set_editor_property("unbound", True)
    s = ppv.get_editor_property("settings")
    for k, v in (("override_auto_exposure_method", True), ("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL),
                 ("override_auto_exposure_apply_physical_camera_exposure", True), ("auto_exposure_apply_physical_camera_exposure", False),
                 ("override_auto_exposure_bias", True), ("auto_exposure_bias", float(os.environ.get("ENTRANCE_EXPOSURE", EXPOSURE))),
                 ("override_vignette_intensity", True), ("vignette_intensity", 0.25),
                 ("override_motion_blur_amount", True), ("motion_blur_amount", 0.0)):
        try:
            s.set_editor_property(k, v)
        except Exception as e:
            say(f"ppv {k}: {e}")
    ppv.set_editor_property("settings", s)

    # 縦長の LED の画角: キャラの面で幅 236 × 高さ 300 cm(等身)が窓いっぱいになる横の画角
    led = CFG["led"]
    d = CFG["camera_distance_cm"]
    cz = led["bottom_cm"] + led["height_cm"] / 2
    hfov = math.degrees(2 * math.atan(led["width_cm"] / 2 / d))
    cam = actors.spawn_actor_from_class(unreal.CameraActor, vec(d, 0, cz), unreal.Rotator(0, 0, 180))
    cam.set_actor_label("EntranceLEDCamera")
    cc = cam.camera_component
    cc.set_editor_property("field_of_view", hfov)
    cc.set_editor_property("constrain_aspect_ratio", False)
    cc.set_editor_property("aspect_ratio", led["width_cm"] / led["height_cm"])
    cam.set_editor_property("auto_activate_for_player", unreal.AutoReceiveInput.PLAYER0)
    start = actors.spawn_actor_from_class(unreal.PlayerStart, vec(d + 400, 0, 100), unreal.Rotator(0, 0, 180))
    start.set_actor_label("PlayerStart_behind_camera")
    say(f"camera x={d} z={cz} hfov={hfov:.2f}")
    levels.save_current_level()
    say("level saved " + level_path)


def main():
    if not lib.does_directory_exist(ROOT):
        lib.make_directory(ROOT)
    say(f"variant {VARIANT}")
    if VARIANT == "autosetup":
        a = CFG["autosetup"]
        folder = f"{a['folder']}/{CFG['character']['name']}"
        mesh = find_skeletal_mesh(folder) if lib.does_directory_exist(folder) else None
        if mesh is None:
            raise RuntimeError("Auto Setup の人型が無い(先に autosetup_import.py): " + folder)
        describe_mesh(mesh)  # 材質は Auto Setup の物のまま(作り直さない)
        bp_name, level_path = a["blueprint"], a["level"]
    else:
        mesh = import_character()
        describe_mesh(mesh)
        if os.environ.get("ENTRANCE_KEEP_MATERIALS") != "1":
            say(f"materials rebuilt: {entrance_materials.rebuild(mesh, CFG['character']['fbx'], ROOT, say, CFG['character'].get('cc_json'))} slots")
        bp_name, level_path = "BP_EntranceChar", CFG["level"]
    parent = surface_material()
    bp = character_blueprint(mesh, bp_name)
    build_level(bp, parent, mesh, level_path)
    say("BUILD_OK")


try:
    main()
except Exception:
    say("BUILD_FAILED\n" + traceback.format_exc())
finally:
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
