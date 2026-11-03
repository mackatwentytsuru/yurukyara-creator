"""LED のキャラと左右のアップだけを、透明つきの層として撮るためのレベルとシーケンスを組む。背景は入れない。

build_led_theatre.py の main から呼ぶ(config に "layers" があるとき)。t は build_led_theatre のモジュール。
作る物(全部 /Game/Show/LedTheatre の下、材質は /Game/Show/Materials の M_LL_ と MI_LL_ で始まる物):
  L_LedLayerChar    キャラ。位置はカメラの式のまま(足 y=1198、身長 397 px、中心 x=2159)
  L_LedLayerReflect 床に映るキャラ。z を反転した複製。薄める計算は led_layers_post.py
  L_LedLayerShadow  灰色の床とキャラの影。キャラ自身は写さない。比は led_layers_post.py
  L_LedLayerClose   顔のアップ。左右で別のカメラとシーケンス
"""
import math

import unreal

import led_plan
from build_level import StageBuilder, clear_level, to_color  # noqa: F401
from build_sequences import add_camera_cut
from ue_helpers import MATERIAL_DIR, get_or_create, save, vec

ROOT = "/Game/Show/LedTheatre"
LEVELS = {name: f"{ROOT}/L_LedLayer{name}" for name in ("Char", "Reflect", "Shadow", "Close")}
MPC_NAME = "MPC_LL_Look"
MPC_SCALARS = ("Cool", "KeyGain", "RimTeal", "RimPink")
HEAD_TEXTURE_KEY = "46ad30a1"  # 頭のテクスチャの材質。瞳はここに描いてある
WHITE_TEXTURE = "/Engine/EngineResources/WhiteSquareTexture"
GOLD_KEY, COOL_KEY = (1.0, 0.82, 0.58), (0.82, 0.92, 1.0)
GOLD_RIM, TEAL, PINK = (1.0, 0.72, 0.32), (0.04, 0.85, 0.78), (1.0, 0.10, 0.45)
SHADOW_CANDELA = 900.0
SHADOW_LIGHT_AT = (60.0, 160.0, 800.0)
SHADOW_SOURCE_RADIUS = 14.0
mel = unreal.MaterialEditingLibrary

# 瞳は頭のテクスチャの 2 か所。(0.2258, 0.857) は上が上、(0.952, 0.669) は上下が逆(11-03 テクスチャから実測)
LOOK_HLSL = """
float3 n = normalize(Normal) * FaceSign;
float3 v = normalize(ToCamera);
float ndv = saturate(dot(n, v));
float wrap = dot(n, normalize(float3(-0.5, 0.72, 0.55))) * 0.5 + 0.5;
float lit = smoothstep(ShadeEdge - ShadeSoft, ShadeEdge + ShadeSoft, wrap);
float3 keyTint = lerp(float3(1.03, 0.97, 0.88), float3(0.94, 0.98, 1.05), Cool);
float3 shadeTint = lerp(float3(0.60, 0.48, 0.52), float3(0.36, 0.35, 0.60), Cool);
float3 c = Base * lerp(shadeTint, keyTint, lit) * KeyGain;
float low = saturate(1.0 - abs(Height) / 70.0);
c += Base * low * low * lerp(float3(0.28, 0.15, 0.04), float3(0.05, 0.24, 0.26), Cool) * Bounce;
float fres = pow(1.0 - ndv, RimPower);
float left = smoothstep(0.0, 0.75, dot(n, normalize(float3(-0.92, -0.2, 0.25))));
float right = smoothstep(0.0, 0.75, dot(n, normalize(float3(0.92, -0.2, 0.25))));
float top = smoothstep(0.25, 0.9, n.z);
float3 rimL = lerp(float3(1.0, 0.72, 0.32), float3(0.04, 0.95, 0.85), Cool);
float3 rimR = lerp(float3(1.0, 0.56, 0.22), float3(1.0, 0.12, 0.50), Cool);
c += (rimL * RimTeal * left + rimR * RimPink * right + lerp(float3(1.0, 0.8, 0.5), float3(0.75, 0.7, 1.0), Cool) * 0.45 * top) * fres * RimGain;
if (EyeGain > 0.0)
{
    float2 e1 = UV - float2(0.2258, 0.857);
    float2 e2 = float2(0.952, 0.669) - UV;
    float iris = max(1.0 - smoothstep(0.022, 0.037, length(e1)), 1.0 - smoothstep(0.022, 0.037, length(e2)));
    float big = max(1.0 - smoothstep(0.0060, 0.0085, length(e1 - float2(-0.012, -0.013))), 1.0 - smoothstep(0.0060, 0.0085, length(e2 - float2(-0.012, -0.013))));
    float small = max(1.0 - smoothstep(0.0028, 0.0042, length(e1 - float2(0.013, 0.012))), 1.0 - smoothstep(0.0028, 0.0042, length(e2 - float2(0.013, 0.012))));
    c += Base * iris * 0.35 * EyeGain + (big * 1.1 + small * 0.6) * EyeGain;
}
return c;
"""
CUSTOM_NAMES = ["Base", "Normal", "FaceSign", "ToCamera", "Height", "UV", "Cool", "KeyGain", "RimTeal", "RimPink",
                "ShadeEdge", "ShadeSoft", "RimPower", "RimGain", "Bounce", "EyeGain"]
SLOT_SCALARS = ("ShadeEdge", "ShadeSoft", "RimPower", "RimGain", "Bounce", "EyeGain")


def look_collection():
    collection, _ = get_or_create(MPC_NAME, MATERIAL_DIR, unreal.MaterialParameterCollection, unreal.MaterialParameterCollectionFactoryNew())
    entries = []
    for name in MPC_SCALARS:
        entry = unreal.CollectionScalarParameter()
        entry.set_editor_property("parameter_name", name)
        entry.set_editor_property("default_value", 1.0)
        entries.append(entry)
    collection.set_editor_property("scalar_parameters", entries)
    save(collection)
    return collection


def look_parent(t, shading, collection):
    """キャラの材質の親。unlit は計算の陰だけ、lit は本物のライトも受ける。どちらも両面でモーフに使える。"""
    material, _ = get_or_create(f"M_LL_Char_{shading}", MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    mel.delete_all_material_expressions(material)
    is_lit = shading == "lit"
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_DEFAULT_LIT if is_lit else unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("two_sided", True)
    material.set_editor_property("used_with_skeletal_mesh", True)
    material.set_editor_property("used_with_morph_targets", True)
    texture = mel.create_material_expression(material, unreal.MaterialExpressionTextureSampleParameter2D, -1400, 0)
    texture.set_editor_property("parameter_name", "BaseColorTexture")
    texture.set_editor_property("texture", unreal.load_asset(WHITE_TEXTURE))
    factor = mel.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -1400, 300)
    factor.set_editor_property("parameter_name", "BaseColorFactor")
    base = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -1100, 100)
    t.attach(material, texture, base, "A")
    t.attach(material, factor, base, "B")
    node = t.custom_node(material, LOOK_HLSL, CUSTOM_NAMES, unreal.CustomMaterialOutputType.CMOT_FLOAT3, -500, 0)
    t.attach(material, base, node, "Base")
    t.attach(material, mel.create_material_expression(material, unreal.MaterialExpressionVertexNormalWS, -1100, 400), node, "Normal")
    t.attach(material, mel.create_material_expression(material, unreal.MaterialExpressionTwoSidedSign, -1100, 500), node, "FaceSign")
    t.attach(material, mel.create_material_expression(material, unreal.MaterialExpressionCameraVectorWS, -1100, 600), node, "ToCamera")
    position = mel.create_material_expression(material, unreal.MaterialExpressionWorldPosition, -1400, 700)
    height = mel.create_material_expression(material, unreal.MaterialExpressionComponentMask, -1100, 700)
    height.set_editor_property("r", False)
    height.set_editor_property("g", False)
    height.set_editor_property("b", True)
    t.attach(material, position, height, "")
    t.attach(material, height, node, "Height")
    t.attach(material, mel.create_material_expression(material, unreal.MaterialExpressionTextureCoordinate, -1100, 800), node, "UV")
    for i, name in enumerate(MPC_SCALARS):
        parameter = mel.create_material_expression(material, unreal.MaterialExpressionCollectionParameter, -1100, 900 + i * 100)
        parameter.set_editor_property("collection", collection)
        parameter.set_editor_property("parameter_name", name)
        t.attach(material, parameter, node, name)
    for i, name in enumerate(SLOT_SCALARS):
        t.attach(material, t.scalar(material, name, 0.0, -1100, 1300 + i * 100), node, name)
    if is_lit:
        mix = t.scalar(material, "EmissiveMix", 0.5, -500, 400)
        scaled = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -200, 200)
        t.attach(material, node, scaled, "A")
        t.attach(material, mix, scaled, "B")
        connected = (mel.connect_material_property(scaled, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
                     and mel.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
                     and mel.connect_material_property(t.scalar(material, "Rough", 0.7, -500, 500), "", unreal.MaterialProperty.MP_ROUGHNESS)
                     and mel.connect_material_property(t.scalar(material, "Spec", 0.25, -500, 600), "", unreal.MaterialProperty.MP_SPECULAR))
    else:
        connected = mel.connect_material_property(node, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    if not connected:
        raise RuntimeError("キャラの材質をつなげない")
    mel.recompile_material(material)
    save(material)
    return material


def look_slots(t, mesh, look, collection):
    """枠ごとに、元の色とテクスチャを写し、案の値を入れた材質を返す。"""
    parent = look_parent(t, look["shading"], collection)
    made = []
    for index, slot in enumerate(mesh.get_editor_property("materials")):
        source = slot.get_editor_property("material_interface")
        instance, _ = get_or_create(f"MI_LL_{mesh.get_name()}_{look['shading']}_{index:02d}", MATERIAL_DIR,
                                    unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(instance, parent)
        mel.set_material_instance_vector_parameter_value(instance, "BaseColorFactor", mel.get_material_instance_vector_parameter_value(source, "BaseColorFactor"))
        if "BaseColorTexture" in [str(n) for n in mel.get_texture_parameter_names(source)]:
            texture = mel.get_material_instance_texture_parameter_value(source, "BaseColorTexture")
            if texture is not None:
                mel.set_material_instance_texture_parameter_value(instance, "BaseColorTexture", texture)
        is_head = HEAD_TEXTURE_KEY in source.get_name()
        values = {"ShadeEdge": look["shade_edge"], "ShadeSoft": look["shade_soft"], "RimPower": look["rim_power"],
                  "RimGain": look["rim_gain"], "Bounce": look["bounce"], "EyeGain": look["eye_gain"] if is_head else 0.0}
        if look["shading"] == "lit":
            values["EmissiveMix"] = look["emissive"]
        for name, value in values.items():
            mel.set_material_instance_scalar_parameter_value(instance, name, float(value))
        mel.update_material_instance(instance)
        save(instance)
        made.append(instance)
    return made


def layer_post(builder, tone_curve):
    """光のにじみ・GI・反射を切る。空も霧も置かない(置くと透明が全部不透明になる)。"""
    volume = builder.actors.spawn_actor_from_class(unreal.PostProcessVolume, vec(0, 0, 300))
    volume.set_actor_label("LayerPost")
    volume.set_editor_property("unbound", True)
    settings = volume.settings
    for key, value in (("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL), ("auto_exposure_apply_physical_camera_exposure", False),
                       ("auto_exposure_bias", 0.0), ("bloom_intensity", 0.0), ("vignette_intensity", 0.0), ("motion_blur_amount", 0.0),
                       ("tone_curve_amount", float(tone_curve)), ("ambient_occlusion_intensity", 0.0), ("film_grain_intensity", 0.0),
                       ("dynamic_global_illumination_method", unreal.DynamicGlobalIlluminationMethod.NONE),
                       ("reflection_method", unreal.ReflectionMethod.NONE)):
        settings.set_editor_property("override_" + key, True)
        settings.set_editor_property(key, value)
    volume.set_editor_property("settings", settings)


def key_look(t, sequence, collection, rows, total, fps):
    track = sequence.add_track(unreal.MovieSceneMaterialParameterCollectionTrack)
    track.set_editor_property("mpc", collection)
    section = track.add_section()
    section.set_range(0, total)
    for name in MPC_SCALARS:
        for row in rows:
            # MPC の区間は名前で受ける。時刻は部品の材質トラックと同じく tick
            section.add_scalar_parameter_key(name, unreal.FrameNumber(int(round(row["t"] * fps)) * t.TICKS // fps), float(row[name]),
                                             unreal.MovieSceneKeyInterpolation.LINEAR)


def real_lights(t, builder, sequence, look, rows, total, fps):
    """lit の案だけ: 主の光(暖と冷)、輪郭の光(金、青緑、ピンク)の本物のライト。キーは look_keys から作る。"""
    target = (0.0, 0.0, 100.0)
    spec = [("KeyWarm", (-420.0, 620.0, 620.0), GOLD_KEY, look["key_candela"], lambda r: (1.0 - r["Cool"]) * r["KeyGain"], True),
            ("KeyCool", (-420.0, 620.0, 620.0), COOL_KEY, look["key_candela"], lambda r: r["Cool"] * r["KeyGain"], True),
            ("RimGoldL", (-420.0, -340.0, 380.0), GOLD_RIM, look["rim_candela"], lambda r: (1.0 - r["Cool"]) * r["RimTeal"], False),
            ("RimGoldR", (420.0, -340.0, 380.0), GOLD_RIM, look["rim_candela"], lambda r: (1.0 - r["Cool"]) * r["RimPink"], False),
            ("RimTeal", (-420.0, -340.0, 380.0), TEAL, look["rim_candela"], lambda r: r["Cool"] * r["RimTeal"], False),
            ("RimPink", (420.0, -340.0, 380.0), PINK, look["rim_candela"], lambda r: r["Cool"] * r["RimPink"], False)]
    for label, at, color, peak, gain, shadow in spec:
        light = t.place_spot(builder, label, at, target, color, 26.0, shadow, 0.0)
        keys = [[row["t"], gain(row)] for row in rows]
        t.key_intensity(sequence, light, light.spot_light_component, keys, peak, total, fps)


def stage_character(t, sequence, character, anim, plan, total, scale=None):
    binding = sequence.add_possessable(character)
    t.key_visibility(t.transform_channels(character, binding, total, scale=scale), plan["visibility"])
    t.add_animation(sequence, binding, anim, total)


def new_level(t, path):
    levels = t.open_level(path)
    builder = StageBuilder(t.load_required(f"{MATERIAL_DIR}/M_Surface"))
    clear_level(builder.actors)
    return levels, builder


def finish(levels, sequence, name, report):
    save(sequence)
    report.append(f"{name} ok")
    if not levels.save_current_level():
        raise RuntimeError(f"{name} のレベルを保存できない")


def build_char(t, config, cam, parts, report):
    plan, fps, total = config["plan"], config["fps"], config["total_frames"]
    levels, builder = new_level(t, LEVELS["Char"])
    layer_post(builder, parts["look"]["tone_curve"])
    character = t.place_character(builder, parts["mesh"], "LayerCharacter", (0.0, 0.0, 0.0), parts["materials"])
    camera = t.place_camera(builder, cam)
    sequence = t.new_sequence("Seq_LedLayerChar", total)
    t.setup_range(sequence, fps, plan["first_frame"], plan["last_frame"])
    add_camera_cut(sequence, camera, total)
    stage_character(t, sequence, character, parts["anim"], plan, total)
    key_look(t, sequence, parts["collection"], plan["look"], total, fps)
    if parts["look"]["shading"] == "lit":
        real_lights(t, builder, sequence, parts["look"], plan["look"], total, fps)
    finish(levels, sequence, "Seq_LedLayerChar", report)


def build_reflect(t, config, cam, parts, report):
    """床に映るキャラ。z を反転した複製をそのまま撮る(足元から下だけが意味を持つ)。"""
    plan, fps, total = config["plan"], config["fps"], config["total_frames"]
    levels, builder = new_level(t, LEVELS["Reflect"])
    layer_post(builder, parts["look"]["tone_curve"])
    character = t.place_character(builder, parts["mesh"], "ReflectCharacter", (0.0, 0.0, 0.0), parts["materials"])
    character.set_actor_scale3d(vec(1.0, 1.0, -1.0))
    camera = t.place_camera(builder, cam)
    sequence = t.new_sequence("Seq_LedLayerReflect", total)
    t.setup_range(sequence, fps, plan["first_frame"], plan["last_frame"])
    add_camera_cut(sequence, camera, total)
    stage_character(t, sequence, character, parts["anim"], plan, total, scale=(1.0, 1.0, -1.0))
    key_look(t, sequence, parts["collection"], plan["look"], total, fps)
    finish(levels, sequence, "Seq_LedLayerReflect", report)


def build_shadow(t, config, cam, parts, report):
    """灰色の床に落ちる影だけを撮る。キャラは写らず影だけ落とす。キャラがいないコマとの比で透明にする。"""
    plan, fps, total = config["plan"], config["fps"], config["total_frames"]
    levels, builder = new_level(t, LEVELS["Shadow"])
    layer_post(builder, 0.0)
    floor = builder.surface("LL_ShadowFloor", (0.5, 0.5, 0.5), 0.95)
    builder.shape("ShadowFloor", "Plane", (0.0, 0.0, 0.0), (60.0, 60.0, 1.0), floor, shadow=False)
    character = t.place_character(builder, parts["mesh"], "ShadowCharacter", (0.0, 0.0, 0.0), parts["materials"])
    component = character.skeletal_mesh_component
    component.set_editor_property("render_in_main_pass", False)
    component.set_editor_property("cast_hidden_shadow", True)
    light = t.place_spot(builder, "ShadowLight", SHADOW_LIGHT_AT, (0.0, 0.0, 0.0), (1.0, 1.0, 1.0), 40.0, True, 0.0)
    comp = light.spot_light_component
    comp.set_editor_property("intensity", SHADOW_CANDELA)
    comp.set_editor_property("source_radius", SHADOW_SOURCE_RADIUS)
    camera = t.place_camera(builder, cam)
    sequence = t.new_sequence("Seq_LedLayerShadow", total)
    t.setup_range(sequence, fps, plan["first_frame"], plan["last_frame"])
    add_camera_cut(sequence, camera, total)
    stage_character(t, sequence, character, parts["anim"], plan, total)
    finish(levels, sequence, "Seq_LedLayerShadow", report)


def close_camera_actor(builder, label, width, height):
    actor = builder.actors.spawn_actor_from_class(unreal.CineCameraActor, vec(0, 200, 150), unreal.Rotator(0, 0, -90.0))
    actor.set_actor_label(label)
    comp = actor.get_cine_camera_component()
    sensor_w, sensor_h = 36.0, 36.0 * height / width
    comp.set_editor_property("filmback", unreal.CameraFilmbackSettings(sensor_w, sensor_h))
    comp.set_editor_property("lens_settings", unreal.CameraLensSettings(min_focal_length=4.0, max_focal_length=1000.0, min_f_stop=0.5, max_f_stop=32.0, diaphragm_blade_count=8))
    comp.set_editor_property("current_focal_length", sensor_h / 2.0 / math.tan(math.radians(led_plan.CLOSE_FOV_V_DEG / 2.0)))
    focus = comp.get_editor_property("focus_settings")
    focus.set_editor_property("focus_method", unreal.CameraFocusMethod.MANUAL)
    comp.set_editor_property("focus_settings", focus)
    return actor


def key_close_camera(t, sequence, camera, rows, heads, side_sign, total):
    """コマごとの位置、向き、焦点の距離、絞り。カットの所でも頭を追う値はなめらかに続ける。"""
    binding = sequence.add_possessable(camera)
    channels = t.transform_channels(camera, binding, total)
    comp = camera.get_cine_camera_component()
    comp_binding = sequence.add_possessable(comp)
    focus = comp_binding.add_track(unreal.MovieSceneFloatTrack)
    focus.set_property_name_and_path("ManualFocusDistance", "FocusSettings.ManualFocusDistance")
    focus_section = focus.add_section()
    focus_section.set_range(0, total)
    focus_channel = focus_section.get_all_channels()[0]
    aperture = comp_binding.add_track(unreal.MovieSceneFloatTrack)
    aperture.set_property_name_and_path("CurrentAperture", "CurrentAperture")
    aperture_section = aperture.add_section()
    aperture_section.set_range(0, total)
    aperture_channel = aperture_section.get_all_channels()[0]
    follow, previous = None, None
    for row in rows:
        frame = unreal.FrameNumber(row["frame"])
        head = heads[row["frame"]]
        if previous != row["frame"] - 1:
            follow = head
        follow = tuple(a + (b - a) * led_plan.FOLLOW for a, b in zip(follow, head))
        at, target = led_plan.close_camera(row["shot"], row["shot_age"], follow, side_sign)
        rotation = unreal.MathLibrary.find_look_at_rotation(vec(*at), vec(*target))
        constant = unreal.MovieSceneKeyInterpolation.CONSTANT if row["cut"] else unreal.MovieSceneKeyInterpolation.LINEAR
        for channel, value in zip(channels[:6], (*at, rotation.roll, rotation.pitch, rotation.yaw)):
            channel.add_key(frame, float(value), interpolation=constant)
        focus_channel.add_key(frame, float(led_plan.close_focus(at, follow)), interpolation=constant)
        aperture_channel.add_key(frame, float(led_plan.CLOSE_APERTURE[row["shot"]]), interpolation=unreal.MovieSceneKeyInterpolation.CONSTANT)
        previous = row["frame"]


def build_close(t, config, parts, report):
    plan, fps, total = config["plan"], config["fps"], config["total_frames"]
    levels, builder = new_level(t, LEVELS["Close"])
    layer_post(builder, parts["look"]["tone_curve"])
    character = t.place_character(builder, parts["mesh"], "CloseCharacter", (0.0, 0.0, 0.0), parts["materials"])
    width, height = config["stage"]["monitor_rects"][0][2:]
    heads = t.head_positions(parts["anim"], plan["close"]["0"], fps)
    for side, rows in plan["close"].items():
        side = int(side)
        camera = close_camera_actor(builder, f"CloseCamera{side}", int(width), int(height))
        name = f"Seq_LedLayerClose{side}"
        sequence = t.new_sequence(name, total)
        t.setup_range(sequence, fps, rows[0]["frame"], rows[-1]["frame"] + 1)
        add_camera_cut(sequence, camera, total)
        t.add_animation(sequence, sequence.add_possessable(character), parts["anim"], total)
        key_look(t, sequence, parts["collection"], plan["look"], total, fps)
        if parts["look"]["shading"] == "lit":
            real_lights(t, builder, sequence, parts["look"], plan["look"], total, fps)
        key_close_camera(t, sequence, camera, rows, heads, 1.0 if side == 0 else -1.0, total)
        save(sequence)
        report.append(f"{name} frames={len(rows)}")
    if not levels.save_current_level():
        raise RuntimeError("L_LedLayerClose を保存できない")


def build_layers(config, cam, report, t):
    """config["layers"] = {"look": 案の値, "parts": ["char", "reflect", "shadow", "close"]} の分だけ組む。"""
    layers = config["layers"]
    mesh, anim = t.character_assets(config["character"])
    report.append(f"anim num_frames={unreal.AnimationLibrary.get_num_frames(anim)} length={unreal.AnimationLibrary.get_sequence_length(anim):.3f}")
    collection = look_collection()
    parts = {"mesh": mesh, "anim": anim, "look": layers["look"], "collection": collection,
             "materials": look_slots(t, mesh, layers["look"], collection)}
    if "char" in layers["parts"]:
        build_char(t, config, cam, parts, report)
    if "reflect" in layers["parts"]:
        build_reflect(t, config, cam, parts, report)
    if "shadow" in layers["parts"]:
        build_shadow(t, config, cam, parts, report)
    if "close" in layers["parts"]:
        # アップは本物のライトだと顔が飛ぶ(11-04 目で確かめ)。close_look があれば、アップだけその案にする
        close_look = layers.get("close_look") or layers["look"]
        build_close(t, config, {**parts, "look": close_look, "materials": look_slots(t, mesh, close_look, collection)}, report)
