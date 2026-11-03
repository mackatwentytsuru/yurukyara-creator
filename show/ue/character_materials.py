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


def character_slots(mesh):
    """枠ごとに、元の色とテクスチャを写した材質の並びを返す。キャラごとに別の名前で作る。"""
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
