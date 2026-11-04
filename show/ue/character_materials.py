"""取り込んだ glTF のキャラの材質を、顔の形(モーフ)が使える材質に替える。

glTF の親 MI_Unlit_Opaque_DS は used_with_morph_targets が無く、-game では顔だけ既定の材質に戻る
(ログ: missing usage flag MorphTargets)。エンジンの資産は変えず、/Game/Show/Materials に親を作って差し替える。
見た目は元と同じ(無照明、両面、BaseColorFactor × BaseColorTexture を発光に)。
"""
import unreal

from ue_helpers import MATERIAL_DIR, get_or_create, save

PARENT_NAME = "M_CharUnlit"
WHITE_TEXTURE = "/Engine/EngineResources/WhiteSquareTexture"
mel = unreal.MaterialEditingLibrary


def unlit_parent():
    material, _ = get_or_create(PARENT_NAME, MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    mel.delete_all_material_expressions(material)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("two_sided", True)
    material.set_editor_property("used_with_skeletal_mesh", True)
    material.set_editor_property("used_with_morph_targets", True)
    sample = mel.create_material_expression(material, unreal.MaterialExpressionTextureSampleParameter2D, -700, 0)
    sample.set_editor_property("parameter_name", "BaseColorTexture")
    sample.set_editor_property("texture", unreal.load_asset(WHITE_TEXTURE))
    factor = mel.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -700, 300)
    factor.set_editor_property("parameter_name", "BaseColorFactor")
    multiply = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, -300, 100)
    if not (mel.connect_material_expressions(sample, "", multiply, "A")
            and mel.connect_material_expressions(factor, "", multiply, "B")
            and mel.connect_material_property(multiply, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)):
        raise RuntimeError("キャラの材質をつなげない")
    mel.recompile_material(material)
    save(material)
    return material


STAND_IN_NAME = "M_StandInSilver"
STAND_IN_KEY = "standin"


def _node(material, kind, x, y, **props):
    node = mel.create_material_expression(material, kind, x, y)
    for key, value in props.items():
        node.set_editor_property(key, value)
    return node


def _wire(a, b, pin):
    if not mel.connect_material_expressions(a, "", b, pin):
        raise RuntimeError(f"代役の材質をつなげない({pin})")


def stand_in_material():
    """代役の人型の材質。無地の銀色のマネキン風(無照明。法線と固定の明かりの向きだけで陰を付ける)。
    変身の見本の「別の姿」の代役。工房の人型が来たら使わない(キャラの名前を替えるだけ)。完成の見た目ではない。"""
    material, _ = get_or_create(STAND_IN_NAME, MATERIAL_DIR, unreal.Material, unreal.MaterialFactoryNew())
    mel.delete_all_material_expressions(material)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("two_sided", True)
    material.set_editor_property("used_with_skeletal_mesh", True)
    material.set_editor_property("used_with_morph_targets", True)
    normal = mel.create_material_expression(material, unreal.MaterialExpressionPixelNormalWS, -900, 0)
    light = _node(material, unreal.MaterialExpressionConstant3Vector, -900, 200, constant=unreal.LinearColor(-0.35, 0.55, 0.75, 1.0))
    dot = mel.create_material_expression(material, unreal.MaterialExpressionDotProduct, -650, 100)
    _wire(normal, dot, "A")
    _wire(light, dot, "B")
    lit = mel.create_material_expression(material, unreal.MaterialExpressionSaturate, -450, 100)
    _wire(dot, lit, "")
    shade = mel.create_material_expression(material, unreal.MaterialExpressionLinearInterpolate, -250, 100)
    shade.set_editor_property("const_a", 0.1)
    shade.set_editor_property("const_b", 1.0)
    _wire(lit, shade, "Alpha")
    silver = _node(material, unreal.MaterialExpressionVectorParameter, -250, 300, parameter_name="SilverColor",
                   default_value=unreal.LinearColor(0.36, 0.38, 0.43, 1.0))
    body = mel.create_material_expression(material, unreal.MaterialExpressionMultiply, 0, 150)
    _wire(shade, body, "A")
    _wire(silver, body, "B")
    rim = _node(material, unreal.MaterialExpressionFresnel, -250, 450, exponent=3.0)
    rim_gain = _node(material, unreal.MaterialExpressionMultiply, 0, 450, const_b=0.4)
    _wire(rim, rim_gain, "A")
    total = mel.create_material_expression(material, unreal.MaterialExpressionAdd, 250, 250)
    _wire(body, total, "A")
    _wire(rim_gain, total, "B")
    if not mel.connect_material_property(total, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR):
        raise RuntimeError("代役の材質を出力につなげない")
    mel.recompile_material(material)
    save(material)
    return material


def character_slots(mesh, override=None):
    """枠ごとに、元の色とテクスチャを写した材質の並びを返す。キャラごとに別の名前で作る。
    override: 全部の枠をこの 1 つの材質にする。STAND_IN_KEY(代役の銀色)か、材質の資産の道(/Game/...)。"""
    if override:
        material = stand_in_material() if override == STAND_IN_KEY else unreal.load_asset(override)
        if material is None:
            raise RuntimeError(f"材質が無い: {override}")
        return [material] * len(mesh.get_editor_property("materials"))
    parent, made = unlit_parent(), []
    for index, slot in enumerate(mesh.get_editor_property("materials")):
        source = slot.get_editor_property("material_interface")
        instance, _ = get_or_create(f"MI_CharUnlit_{mesh.get_name()}_{index:02d}", MATERIAL_DIR,
                                    unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(instance, parent)
        mel.set_material_instance_vector_parameter_value(
            instance, "BaseColorFactor", mel.get_material_instance_vector_parameter_value(source, "BaseColorFactor"))
        if "BaseColorTexture" in [str(n) for n in mel.get_texture_parameter_names(source)]:
            texture = mel.get_material_instance_texture_parameter_value(source, "BaseColorTexture")
            if texture is not None:
                mel.set_material_instance_texture_parameter_value(instance, "BaseColorTexture", texture)
        mel.update_material_instance(instance)
        save(instance)
        made.append(instance)
    return made
