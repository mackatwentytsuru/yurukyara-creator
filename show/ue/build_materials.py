"""LED の親材質と、舞台の表面の材質を新しく作る。"""
import unreal

from ue_helpers import MATERIAL_DIR, MEDIA_DIR, get_or_create, save

mel = unreal.MaterialEditingLibrary

GRID_HLSL = """
float2 p = float2(UV.x * GridU + GridOffset, UV.y * GridV);
float2 w = max(fwidth(p), 0.0001);
float2 d = abs(frac(p + 0.5) - 0.5);
float2 half_width = float2(0.012, 0.024);
float2 seam = saturate((half_width + w * 0.5 - d) / w) * saturate(half_width * 2.0 / w);
return 1.0 - Strength * max(seam.x, seam.y);
"""


def clear_graph(material):
    mel.delete_all_material_expressions(material)


def scalar(material, name, default, x, y):
    node = mel.create_material_expression(material, unreal.MaterialExpressionScalarParameter, x, y)
    node.set_editor_property("parameter_name", name)
    node.set_editor_property("default_value", default)
    return node


def connect(a, b, pin):
    if not mel.connect_material_expressions(a, "", b, pin):
        raise RuntimeError(f"つなげない: {a.get_name()} -> {b.get_name()}.{pin}")


def append(material, a, b, x, y):
    node = mel.create_material_expression(material, unreal.MaterialExpressionAppendVector, x, y)
    connect(a, node, "A")
    connect(b, node, "B")
    return node


def make_grid_node(material, uv):
    custom = mel.create_material_expression(material, unreal.MaterialExpressionCustom, -500, 400)
    custom.set_editor_property("code", GRID_HLSL)
    custom.set_editor_property("output_type", unreal.CustomMaterialOutputType.CMOT_FLOAT1)
    custom.set_editor_property("description", "LED panel seams")
    names = ["UV", "GridU", "GridOffset", "GridV", "Strength"]
    inputs = []
    for name in names:
        entry = unreal.CustomInput()
        entry.set_editor_property("input_name", name)
        inputs.append(entry)
    custom.set_editor_property("inputs", inputs)
    connect(uv, custom, "UV")
    connect(scalar(material, "GridU", 16.0, -900, 400), custom, "GridU")
    connect(scalar(material, "GridOffset", 0.0, -900, 500), custom, "GridOffset")
    connect(scalar(material, "GridV", 31.0, -900, 600), custom, "GridV")
    connect(scalar(material, "GridStrength", 0.3, -900, 700), custom, "Strength")
    return custom


def build_led_material(media_texture):
    material, _ = get_or_create("M_LED", MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    clear_graph(material)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("two_sided", False)

    uv = mel.create_material_expression(material, unreal.MaterialExpressionTextureCoordinate, -1500, 0)
    scale = append(material, scalar(material, "UScale", 1.0, -1500, 150),
                   scalar(material, "VScale", 1.0, -1500, 250), -1200, 200)
    multiply = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -1000, 50)
    connect(uv, multiply, "A")
    connect(scale, multiply, "B")
    offset = append(material, scalar(material, "UOffset", 0.0, -1500, 350),
                    scalar(material, "VOffset", 0.0, -1500, 450), -1200, 400)
    add = mel.create_material_expression(material, unreal.MaterialExpressionAdd, -800, 50)
    connect(multiply, add, "A")
    connect(offset, add, "B")

    sample = mel.create_material_expression(material, unreal.MaterialExpressionTextureSample, -500, 0)
    sample.set_editor_property("texture", media_texture)
    sample.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
    connect(add, sample, "UVs")

    grid = make_grid_node(material, uv)
    brightness = scalar(material, "Brightness", 1.0, -500, 250)
    lit = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -200, 50)
    connect(sample, lit, "A")
    connect(brightness, lit, "B")
    final = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -50, 150)
    connect(lit, final, "A")
    connect(grid, final, "B")
    if not mel.connect_material_property(final, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR):
        raise RuntimeError("発光につなげない")
    mel.recompile_material(material)
    save(material)
    return material


def build_surface_material():
    material, _ = get_or_create("M_Surface", MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    clear_graph(material)
    color = mel.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -500, 0)
    color.set_editor_property("parameter_name", "Color")
    color.set_editor_property("default_value", unreal.LinearColor(0.05, 0.05, 0.05, 1.0))
    glow = mel.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -500, 500)
    glow.set_editor_property("parameter_name", "Glow")
    glow.set_editor_property("default_value", unreal.LinearColor(0, 0, 0, 1.0))
    property_map = [
        (color, unreal.MaterialProperty.MP_BASE_COLOR),
        (scalar(material, "Roughness", 0.5, -500, 200), unreal.MaterialProperty.MP_ROUGHNESS),
        (scalar(material, "Metallic", 0.0, -500, 300), unreal.MaterialProperty.MP_METALLIC),
        (glow, unreal.MaterialProperty.MP_EMISSIVE_COLOR),
    ]
    for node, prop in property_map:
        if not mel.connect_material_property(node, "", prop):
            raise RuntimeError(f"つなげない: {prop}")
    mel.recompile_material(material)
    save(material)
    return material


def build_face_material(atlas, columns=4, rows=6, brightness=1.3):
    """顔のアトラスから 1 コマだけを映す材質。コマは StartU・StartV で選ぶ。"""
    material, _ = get_or_create("M_FaceCell", MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    clear_graph(material)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("two_sided", True)
    material.set_editor_property("used_with_skeletal_mesh", True)
    uv = mel.create_material_expression(material, unreal.MaterialExpressionTextureCoordinate, -1100, 0)
    cell = append(material, scalar(material, "CellU", 1.0 / columns, -1100, 150),
                  scalar(material, "CellV", 1.0 / rows, -1100, 250), -900, 200)
    multiply = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -700, 50)
    connect(uv, multiply, "A")
    connect(cell, multiply, "B")
    start = append(material, scalar(material, "StartU", 0.0, -1100, 350),
                   scalar(material, "StartV", 0.0, -1100, 450), -900, 400)
    add = mel.create_material_expression(material, unreal.MaterialExpressionAdd, -500, 50)
    connect(multiply, add, "A")
    connect(start, add, "B")
    sample = mel.create_material_expression(material, unreal.MaterialExpressionTextureSample, -300, 0)
    sample.set_editor_property("texture", atlas)
    connect(add, sample, "UVs")
    lit = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -100, 0)
    connect(sample, lit, "A")
    connect(scalar(material, "Brightness", brightness, -300, 300), lit, "B")
    # 透明な隙間に残っている色が格子に見えるので、色に透明度を掛けて消す
    visible = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, 50, 0)
    connect(lit, visible, "A")
    if not mel.connect_material_expressions(sample, "A", visible, "B"):
        raise RuntimeError("顔の透明度につなげない")
    if not mel.connect_material_property(visible, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR):
        raise RuntimeError("顔の発光につなげない")
    mel.recompile_material(material)
    save(material)
    return material


def make_instance(name, parent, scalars=None, vectors=None):
    instance, _ = get_or_create(name, MATERIAL_DIR, unreal.MaterialInstanceConstant,
                                unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(instance, parent)
    for key, value in (scalars or {}).items():
        mel.set_material_instance_scalar_parameter_value(instance, key, float(value))
        got = mel.get_material_instance_scalar_parameter_value(instance, key)
        if abs(got - float(value)) > 1e-4:
            raise RuntimeError(f"{name}.{key} が入らない: {got}")
    for key, value in (vectors or {}).items():
        mel.set_material_instance_vector_parameter_value(instance, key, value)
    mel.update_material_instance(instance)
    save(instance)
    return instance


def build_media_texture():
    texture, _ = get_or_create("MT_LED", MEDIA_DIR, unreal.MediaTexture, unreal.MediaTextureFactoryNew())
    save(texture)
    return texture


def build_file_source(name, mp4_path):
    source, _ = get_or_create(f"FMS_{name}", MEDIA_DIR, unreal.FileMediaSource,
                              unreal.FileMediaSourceFactoryNew())
    source.set_file_path(mp4_path)
    save(source)
    return source
