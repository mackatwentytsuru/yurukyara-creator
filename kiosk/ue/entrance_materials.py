"""人型(CC の FBX)の材質を、CC の説明ファイル(FBX の横の <名前>.json)の絵の対応から作り直す(UE の Python。build_entrance.py が呼ぶ)。
FBX の取り込みが自動で作る材質は、CC の髪の色(根元・毛先)や目の膜を扱えず、服が描かれない枠が出たので、自前の 4 種で置きかえる:
  M_EntOpaque  色の絵 × 色合い・法線・粗さ・金属
  M_EntMasked  上 + 切り抜き(不透明度の絵)。まつげ・手袋・チョーカーなど
  M_EntHair    根元の絵で、根元の色 → 毛先の色(CC の RootColor / TipColor)× 色の絵の明るさ。切り抜き
  M_EntHidden  描かない(目の膜・涙の線・目のまわりの影。CC 専用の陰の材質の代わり)
絵は取り込み済みの物(FBX の .fbm から入った物)を名前で探し、髪の根元の絵(textures/ の下)だけはここで取り込む。
"""
import json
import os

import unreal

lib = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
HIDE = ("Std_Eye_Occlusion", "Std_Tearline", "Std_Cornea")


def _expr(m, cls, x, y, **props):
    e = mel.create_material_expression(m, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


def _tex_param(m, name, x, y, default, sampler):
    return _expr(m, unreal.MaterialExpressionTextureSampleParameter2D, x, y, parameter_name=name,
                 texture=unreal.load_asset(default), sampler_type=sampler)


def _master(root, name, kind):
    path = f"{root}/{name}"
    if lib.does_asset_exist(path):
        return unreal.load_asset(path)
    m = tools.create_asset(name, root, unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property("two_sided", True)
    if kind != "opaque":
        m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
        m.set_editor_property("opacity_mask_clip_value", 0.33)
    if kind == "hidden":
        zero = _expr(m, unreal.MaterialExpressionConstant, -300, 300, r=0.0)
        mel.connect_material_property(zero, "", unreal.MaterialProperty.MP_OPACITY_MASK)
        mel.recompile_material(m)
        lib.save_loaded_asset(m, only_if_is_dirty=False)
        return m
    white = "/Engine/EngineResources/WhiteSquareTexture.WhiteSquareTexture"
    base = _tex_param(m, "BaseTex", -900, -200, white, unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
    normal = _tex_param(m, "NormalTex", -900, 250, "/Engine/EngineMaterials/DefaultNormal.DefaultNormal", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
    rough = _expr(m, unreal.MaterialExpressionScalarParameter, -400, 100, parameter_name="Roughness", default_value=0.55)
    metal = _expr(m, unreal.MaterialExpressionScalarParameter, -400, 180, parameter_name="Metallic", default_value=0.0)
    mel.connect_material_property(normal, "RGB", unreal.MaterialProperty.MP_NORMAL)
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(metal, "", unreal.MaterialProperty.MP_METALLIC)
    if kind == "hair":
        rootmap = _tex_param(m, "RootTex", -900, -500, white, unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
        rc = _expr(m, unreal.MaterialExpressionVectorParameter, -700, -700, parameter_name="RootColor", default_value=unreal.LinearColor(0.02, 0.27, 0.27, 1))
        tc = _expr(m, unreal.MaterialExpressionVectorParameter, -700, -850, parameter_name="TipColor", default_value=unreal.LinearColor(0.8, 0.84, 0.87, 1))
        lerp = _expr(m, unreal.MaterialExpressionLinearInterpolate, -450, -650)
        mel.connect_material_expressions(tc, "", lerp, "A")
        mel.connect_material_expressions(rc, "", lerp, "B")
        mel.connect_material_expressions(rootmap, "R", lerp, "Alpha")
        lum = _expr(m, unreal.MaterialExpressionDesaturation, -600, -200)
        mel.connect_material_expressions(base, "RGB", lum, "")
        bright = _expr(m, unreal.MaterialExpressionScalarParameter, -600, -50, parameter_name="Brightness", default_value=2.2)
        mul1 = _expr(m, unreal.MaterialExpressionMultiply, -400, -200)
        mel.connect_material_expressions(lum, "", mul1, "A")
        mel.connect_material_expressions(bright, "", mul1, "B")
        mul2 = _expr(m, unreal.MaterialExpressionMultiply, -250, -400)
        mel.connect_material_expressions(lerp, "", mul2, "A")
        mel.connect_material_expressions(mul1, "", mul2, "B")
        mel.connect_material_property(mul2, "", unreal.MaterialProperty.MP_BASE_COLOR)
    else:
        tint = _expr(m, unreal.MaterialExpressionVectorParameter, -700, -400, parameter_name="Tint", default_value=unreal.LinearColor(1, 1, 1, 1))
        mul = _expr(m, unreal.MaterialExpressionMultiply, -400, -250)
        mel.connect_material_expressions(base, "RGB", mul, "A")
        mel.connect_material_expressions(tint, "", mul, "B")
        mel.connect_material_property(mul, "", unreal.MaterialProperty.MP_BASE_COLOR)
    if kind in ("masked", "hair"):
        op = _tex_param(m, "OpacityTex", -900, 600, white, unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
        scale = _expr(m, unreal.MaterialExpressionScalarParameter, -600, 750, parameter_name="OpacityScale", default_value=1.0)
        mul = _expr(m, unreal.MaterialExpressionMultiply, -400, 650)
        mel.connect_material_expressions(op, "R", mul, "A")
        mel.connect_material_expressions(scale, "", mul, "B")
        mel.connect_material_property(mul, "", unreal.MaterialProperty.MP_OPACITY_MASK)
    mel.recompile_material(m)
    lib.save_loaded_asset(m, only_if_is_dirty=False)
    return m


def _find_textures(folder):
    out = {}
    for path in lib.list_assets(folder, recursive=True, include_folder=False):
        d = lib.find_asset_data(path)
        if str(d.asset_class_path.asset_name) == "Texture2D":
            out[str(d.asset_name).lower()] = path
    return out


def _texture(textures, rel, role):
    if not rel:
        return None
    stem = os.path.splitext(os.path.basename(rel))[0].lower()
    path = textures.get(stem) or textures.get(stem.replace(".", "_"))
    if not path:
        return None
    t = unreal.load_asset(path)
    if role == "normal":
        t.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        t.set_editor_property("srgb", False)
    elif role == "linear":
        t.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_DEFAULT)
        t.set_editor_property("srgb", False)
    lib.save_loaded_asset(t, only_if_is_dirty=True)
    return t


def _import_file(src, dest):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", src)
    task.set_editor_property("destination_path", dest)
    task.set_editor_property("automated", True)
    task.set_editor_property("save", True)
    task.set_editor_property("replace_existing", True)
    tools.import_asset_tasks([task])


def _rgb(v):
    return unreal.LinearColor(*[(c / 255.0) ** 2.2 for c in v[:3]], 1.0)


def rebuild(mesh, fbx_path, root, say, cc_json=None):
    """mesh の各枠に、作り直した材質を当てる。戻り値 = 当てた枠の数"""
    jpath = cc_json or os.path.splitext(fbx_path)[0] + ".json"  # CC の説明ファイル(書き出し直した FBX のときは元の物)
    name = os.path.splitext(os.path.basename(jpath))[0]
    d = json.load(open(jpath, encoding="utf-8"))
    meshes = d[name]["Object"][name]["Meshes"]
    mats = {}
    for mesh_info in meshes.values():
        for mn, mi in mesh_info.get("Materials", {}).items():
            mats[mn.lower()] = mi
    char_dir = mesh.get_path_name().rsplit("/", 1)[0]
    mdir = f"{root}/Materials"
    if not lib.does_directory_exist(mdir):
        lib.make_directory(mdir)
    masters = {k: _master(root, f"M_Ent{k.capitalize()}", k) for k in ("opaque", "masked", "hair", "hidden")}
    # 髪の根元の絵(FBX の外。textures/ の下)を取り込む
    base_dir = os.path.dirname(jpath)
    hair_dir = f"{char_dir}/HairMaps"
    for mi in mats.values():
        cs = mi.get("Custom Shader") or {}
        rel = ((cs.get("Image") or {}).get("Hair Root Map") or {}).get("Texture Path")
        if rel:
            src = os.path.normpath(os.path.join(base_dir, rel))
            if os.path.exists(src):
                _import_file(src, hair_dir)
    textures = _find_textures(char_dir)
    slots = mesh.get_editor_property("materials")
    count = 0
    for i, slot in enumerate(slots):
        sname = str(slot.get_editor_property("material_slot_name"))
        info = mats.get(sname.lower())
        if any(sname.startswith(h) for h in HIDE):
            slot.set_editor_property("material_interface", masters["hidden"])
            count += 1
            continue
        if info is None:
            say(f"material: no json for slot {sname}")
            continue
        tx = {k: (v.get("Texture Path") if isinstance(v, dict) else None) for k, v in (info.get("Textures") or {}).items()}
        cs = info.get("Custom Shader") or {}
        is_hair = cs.get("Shader Name") == "RLHair" and "lash" not in sname.lower()
        kind = "hair" if is_hair else ("masked" if tx.get("Opacity") and not sname.lower().startswith("std_eye_") else "opaque")
        inst_path = f"{mdir}/MI_{sname}"
        inst = unreal.load_asset(inst_path) if lib.does_asset_exist(inst_path) else tools.create_asset(
            f"MI_{sname}", mdir, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(inst, masters[kind])
        base = _texture(textures, tx.get("Base Color"), "color")
        if base:
            mel.set_material_instance_texture_parameter_value(inst, "BaseTex", base)
        normal = _texture(textures, tx.get("Normal"), "normal")
        if normal:
            mel.set_material_instance_texture_parameter_value(inst, "NormalTex", normal)
        if kind != "opaque":
            op = _texture(textures, tx.get("Opacity"), "linear")
            if op:
                mel.set_material_instance_texture_parameter_value(inst, "OpacityTex", op)
        low = sname.lower()
        rough = 0.5 if "skin" in low else (0.32 if any(k in low for k in ("satin", "patent")) else 0.6)
        mel.set_material_instance_scalar_parameter_value(inst, "Roughness", rough)
        mel.set_material_instance_scalar_parameter_value(inst, "Metallic", 0.85 if "gold" in low else 0.0)
        if is_hair:
            var = cs.get("Variable") or {}
            if var.get("RootColor"):
                mel.set_material_instance_vector_parameter_value(inst, "RootColor", _rgb(var["RootColor"]))
            if var.get("TipColor"):
                mel.set_material_instance_vector_parameter_value(inst, "TipColor", _rgb(var["TipColor"]))
            rel = ((cs.get("Image") or {}).get("Hair Root Map") or {}).get("Texture Path")
            root_tex = _texture(_find_textures(hair_dir), rel, "linear") if rel else None
            if root_tex:
                mel.set_material_instance_texture_parameter_value(inst, "RootTex", root_tex)
        elif not base and "lash" in low:
            mel.set_material_instance_vector_parameter_value(inst, "Tint", unreal.LinearColor(0.01, 0.01, 0.012, 1))
        lib.save_loaded_asset(inst, only_if_is_dirty=False)
        slot.set_editor_property("material_interface", inst)
        count += 1
        say(f"material {sname}: {kind} base={'y' if base else 'n'} normal={'y' if normal else 'n'}")
    mesh.set_editor_property("materials", slots)
    lib.save_loaded_asset(mesh, only_if_is_dirty=False)
    return count
