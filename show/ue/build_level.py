"""ステージのレベルを、エンジン付属の基本の形と新しい材質だけで組む。"""
import math

import unreal

from build_materials import make_instance
from stage_layout import (CAMERAS, LED_HEIGHT, LED_Z_BOTTOM, LED_Z_TOP, STAGE_Z, led_plates, plate_axes)
from ue_helpers import LEVEL_PATH, assets, vec

SHAPES = {name: f"/Engine/BasicShapes/{name}" for name in ("Cube", "Cylinder", "Plane")}
math_lib = unreal.MathLibrary
GRID_STRENGTH = 0.28
LED_BRIGHTNESS = 1.0
CHARACTER_HEIGHT_CM = 160.0
CHARACTER_SOURCE_HEIGHT_CM = 90.0
CHARACTER_POS = (0.0, 180.0, STAGE_Z)
CHARACTER_YAW = 0.0  # 撮って確かめて決める
HALL_X = (-1900.0, 2000.0)
HALL_Y = (-440.0, 1860.0)
HALL_TOP = 950.0
TRUSS_Z = 650.0
TRUSS_YS = (70.0, 400.0)
TRUSS_X = (-820.0, 1020.0)
TRUSS_DEPTH = 40.0
LED_GLOW_CANDELA = 7.0
TRUSS_FILL_CANDELA = 90.0
BEAM_SCATTER = 45.0
BEAM_CANDELA = 300.0
WASH_CANDELA = 200.0
KEY_CANDELA = 520.0


def to_color(linear):
    """0-1 の直線の色を、ライトが受け取る 8 ビットの sRGB にする。"""
    r, g, b = (int(255 * min(1.0, c) ** (1 / 2.2)) for c in linear[:3])
    return unreal.Color(r=r, g=g, b=b, a=255)


class StageBuilder:
    def __init__(self, surface_material):
        self.actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        self.meshes = {k: unreal.load_asset(v) for k, v in SHAPES.items()}
        self.surface_parent = surface_material
        self.surfaces = {}

    def surface(self, name, color, roughness, metallic=0.0, glow=(0, 0, 0)):
        if name not in self.surfaces:
            self.surfaces[name] = make_instance(
                f"MI_{name}", self.surface_parent,
                {"Roughness": roughness, "Metallic": metallic},
                {"Color": unreal.LinearColor(*color, 1.0), "Glow": unreal.LinearColor(*glow, 1.0)},
            )
        return self.surfaces[name]

    def shape(self, label, kind, center, scale, material, rotation=None, shadow=True):
        actor = self.actors.spawn_actor_from_class(
            unreal.StaticMeshActor, vec(*center), rotation or unreal.Rotator(0, 0, 0))
        actor.set_actor_label(label)
        actor.set_folder_path("Stage")
        actor.set_mobility(unreal.ComponentMobility.MOVABLE)
        actor.set_actor_scale3d(vec(*scale))
        component = actor.static_mesh_component
        component.set_static_mesh(self.meshes[kind])
        component.set_material(0, material)
        component.set_cast_shadow(shadow)
        return actor

    def box(self, label, x, y, z, material, shadow=True):
        """x, y, z は (小さい方, 大きい方)。"""
        center = ((x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2)
        scale = ((x[1] - x[0]) / 100, (y[1] - y[0]) / 100, (z[1] - z[0]) / 100)
        return self.shape(label, "Cube", center, scale, material, shadow=shadow)

    def tube(self, label, start, end, diameter, material):
        """start から end へ延びる円柱。"""
        direction = vec(end[0] - start[0], end[1] - start[1], end[2] - start[2])
        length = math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2)
        center = tuple((a + b) / 2 for a, b in zip(start, end))
        rotation = math_lib.make_rot_from_z(direction)
        return self.shape(label, "Cylinder", center, (diameter / 100, diameter / 100, length / 100),
                          material, rotation)


def build_hall(b):
    black = b.surface("Wall", (0.006, 0.006, 0.007), 0.95)
    hall_floor = b.surface("HallFloor", (0.012, 0.012, 0.014), 0.55)
    stage_floor = b.surface("StageFloor", (0.045, 0.045, 0.05), 0.22)
    b.box("Hall_Floor", HALL_X, HALL_Y, (-20, 0), hall_floor)
    b.box("Hall_Ceiling", HALL_X, HALL_Y, (HALL_TOP, HALL_TOP + 20), black)
    b.box("Hall_Wall_Back", HALL_X, (HALL_Y[0] - 20, HALL_Y[0]), (0, HALL_TOP), black)
    b.box("Hall_Wall_Front", HALL_X, (HALL_Y[1], HALL_Y[1] + 20), (0, HALL_TOP), black)
    b.box("Hall_Wall_Left", (HALL_X[0] - 20, HALL_X[0]), HALL_Y, (0, HALL_TOP), black)
    b.box("Hall_Wall_Right", (HALL_X[1], HALL_X[1] + 20), HALL_Y, (0, HALL_TOP), black)
    b.box("Stage_Floor", (-800, 1060), (-160, 450), (0, STAGE_Z), stage_floor)
    b.box("Backstage_Floor", (-800, 1060), (HALL_Y[0], -160), (0, STAGE_Z), hall_floor)


def build_led(b, led_parent, report):
    plates, curve_len = led_plates()
    report.append(f"C curve measured length {curve_len:.1f} cm for {len(plates) - 4} plates")
    actors = {}
    for p in plates:
        mi = make_instance(
            f"MI_{p['name']}", led_parent,
            {"UScale": p["u_scale"], "UOffset": p["u_offset"], "VScale": p["v_scale"],
             "VOffset": p["v_offset"], "GridU": p["grid_u_count"], "GridOffset": p["grid_u_offset"],
             "GridV": p["grid_v_count"], "GridStrength": GRID_STRENGTH, "Brightness": LED_BRIGHTNESS},
        )
        center, tangent, normal = plate_axes(p)
        forward = vec(*tangent)
        up = vec(*normal)
        right = up.cross(forward)
        rotation = math_lib.make_rotation_from_axes(forward, right, up)
        actor = b.shape(p["name"], "Plane", center, (p["width"] / 100, LED_HEIGHT / 100, 1), mi,
                        rotation, shadow=False)
        actors[p["name"]] = actor
    return actors


def build_truss(b):
    metal = b.surface("TrussMetal", (0.32, 0.32, 0.35), 0.5)
    span = TRUSS_X[1] - TRUSS_X[0]
    bays = int(span // 100)
    for t, y in enumerate(TRUSS_YS):
        half = TRUSS_DEPTH / 2
        for side_y in (-half, half):
            for side_z in (-half, half):
                b.tube(f"Truss{t}_Chord_{side_y:+.0f}_{side_z:+.0f}",
                       (TRUSS_X[0], y + side_y, TRUSS_Z + side_z),
                       (TRUSS_X[1], y + side_y, TRUSS_Z + side_z), 5, metal)
        for i in range(bays + 1):
            x = TRUSS_X[0] + i * span / bays
            for side_y in (-half, half):
                b.tube(f"Truss{t}_Post{i}_{side_y:+.0f}",
                       (x, y + side_y, TRUSS_Z - half), (x, y + side_y, TRUSS_Z + half), 3, metal)
            if i < bays:
                x2 = x + span / bays
                b.tube(f"Truss{t}_BraceTop{i}", (x, y - half, TRUSS_Z + half),
                       (x2, y + half, TRUSS_Z + half), 2.5, metal)
                b.tube(f"Truss{t}_BraceBottom{i}", (x, y + half, TRUSS_Z - half),
                       (x2, y - half, TRUSS_Z - half), 2.5, metal)
        for x in (TRUSS_X[0] + 120, 100.0, TRUSS_X[1] - 120):
            b.tube(f"Truss{t}_Chain_{x:.0f}", (x, y, TRUSS_Z + half), (x, y, HALL_TOP), 2, metal)


def moving_light(b, label, pos, target, color, intensity, cone_deg):
    """吊られた動く照明 1 台(箱の台座、腕、円柱の頭)と、スポットライト。"""
    body = b.surface("FixtureBody", (0.012, 0.012, 0.012), 0.5)
    x, y, z = pos
    b.box(f"{label}_Base", (x - 18, x + 18), (y - 16, y + 16), (z - 14, z), body)
    head_center = (x, y, z - 40)
    aim = vec(target[0] - head_center[0], target[1] - head_center[1], target[2] - head_center[2])
    aim_unit = aim.normal()
    tail = tuple(c - d * 18 for c, d in zip(head_center, (aim_unit.x, aim_unit.y, aim_unit.z)))
    tip = tuple(c + d * 18 for c, d in zip(head_center, (aim_unit.x, aim_unit.y, aim_unit.z)))
    b.tube(f"{label}_Head", tail, tip, 24, body)
    b.box(f"{label}_YokeL", (x - 18, x - 14), (y - 4, y + 4), (z - 46, z - 14), body)
    b.box(f"{label}_YokeR", (x + 14, x + 18), (y - 4, y + 4), (z - 46, z - 14), body)
    lens_mat = b.surface(f"Lens_{color[3]}", (0, 0, 0), 0.2, 0.0,
                         tuple(c * 6.0 for c in color[:3]))
    lens_tip = tuple(c + d * 1.5 for c, d in zip(tip, (aim_unit.x, aim_unit.y, aim_unit.z)))
    b.tube(f"{label}_Lens", tip, lens_tip, 20, lens_mat)
    start = tuple(c + d * 3 for c, d in zip(tip, (aim_unit.x, aim_unit.y, aim_unit.z)))
    light = b.actors.spawn_actor_from_class(unreal.SpotLight, vec(*start),
                                            math_lib.make_rot_from_x(aim_unit))
    light.set_actor_label(f"{label}_Beam")
    light.set_folder_path("Lights")
    comp = light.spot_light_component
    comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    comp.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
    comp.set_editor_property("intensity", intensity)
    comp.set_editor_property("light_color", to_color(color))
    comp.set_editor_property("inner_cone_angle", cone_deg * 0.6)
    comp.set_editor_property("outer_cone_angle", cone_deg)
    comp.set_editor_property("attenuation_radius", 1800.0)
    comp.set_editor_property("cast_shadows", True)
    comp.set_editor_property("volumetric_scattering_intensity", BEAM_SCATTER)
    return light


def build_lights(b):
    pink = (1.0, 0.25, 0.6, "Pink")
    cyan = (0.25, 0.65, 1.0, "Cyan")
    white = (1.0, 0.9, 0.85, "White")
    z = TRUSS_Z - 24
    back = TRUSS_YS[0]
    beams = [
        (-640, back, (-520, 330, 90), pink), (-400, back, (-160, 300, 90), cyan),
        (-180, back, (-300, 310, 90), pink), (180, back, (300, 310, 90), pink),
        (400, back, (160, 300, 90), cyan), (640, back, (520, 330, 90), pink),
        (880, back, (760, 300, 90), cyan),
    ]
    for i, (x, y, target, color) in enumerate(beams):
        moving_light(b, f"Mover{i}", (x, y, z), target, color, BEAM_CANDELA, 7.0)
    front = TRUSS_YS[1]
    wash = [(-560, front, (-420, 150, 90), cyan), (560, front, (420, 150, 90), cyan),
            (820, front, (760, 200, 90), pink)]
    for i, (x, y, target, color) in enumerate(wash):
        moving_light(b, f"Wash{i}", (x, y, z), target, color, WASH_CANDELA, 10.0)
    character_target = (0, 180, 190)
    for i, x in enumerate((-230, 230)):
        key = moving_light(b, f"Key{i}", (x, front, z), character_target, white, KEY_CANDELA, 18.0)
        key.spot_light_component.set_editor_property("volumetric_scattering_intensity", 0.6)
    backstage = moving_light(b, "Backstage0", (0, -110, z), (0, -300, 170), white, 200.0, 24.0)
    backstage.spot_light_component.set_editor_property("volumetric_scattering_intensity", 0.0)
    build_truss_fill(b)


def build_truss_fill(b):
    """客席の上から、トラスが見える程度に当てる弱い明かり。"""
    light = b.actors.spawn_actor_from_class(
        unreal.SpotLight, vec(100, 1150, 760),
        math_lib.make_rot_from_x(vec(0, -1150 + 235, 650 - 760).normal()))
    light.set_actor_label("TrussFill")
    light.set_folder_path("Lights")
    comp = light.spot_light_component
    comp.set_mobility(unreal.ComponentMobility.MOVABLE)
    comp.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
    comp.set_editor_property("intensity", TRUSS_FILL_CANDELA)
    comp.set_editor_property("outer_cone_angle", 50.0)
    comp.set_editor_property("inner_cone_angle", 40.0)
    comp.set_editor_property("attenuation_radius", 1800.0)
    comp.set_editor_property("cast_shadows", False)
    comp.set_editor_property("volumetric_scattering_intensity", 0.0)


def build_led_glow(b):
    """LED の光が舞台の床を少し染めるための、面の前の弱い面光源。"""
    if LED_GLOW_CANDELA <= 0:
        return
    glows = [("Glow_A", (-494, 6, 346), 0.0, 512), ("Glow_B", (0, -134, 346), 0.0, 704),
             ("Glow_C", (486, 6, 346), 0.0, 500), ("Glow_C1", (925, 62, 346), 45.0, 200),
             ("Glow_C2", (1029, 250, 346), 90.0, 260)]
    for label, pos, yaw_offset, width in glows:
        yaw = 90.0 + yaw_offset
        light = b.actors.spawn_actor_from_class(unreal.RectLight, vec(*pos), unreal.Rotator(0, 0, yaw))
        light.set_actor_label(label)
        light.set_folder_path("Lights")
        comp = light.rect_light_component
        comp.set_mobility(unreal.ComponentMobility.MOVABLE)
        comp.set_editor_property("intensity_units", unreal.LightUnits.CANDELAS)
        # 同じ明るさに見えるよう、強さは幅に比例させる(細い面光源は同じ cd だと明るすぎる)
        comp.set_editor_property("intensity", LED_GLOW_CANDELA * width / 500.0)
        comp.set_editor_property("source_width", float(width))
        comp.set_editor_property("source_height", float(LED_Z_TOP - LED_Z_BOTTOM))
        comp.set_editor_property("attenuation_radius", 1400.0)
        comp.set_editor_property("light_color", to_color((0.75, 0.12, 0.7)))
        comp.set_editor_property("cast_shadows", False)
        comp.set_editor_property("volumetric_scattering_intensity", 0.0)


def build_atmosphere(b):
    fog = b.actors.spawn_actor_from_class(unreal.ExponentialHeightFog, vec(0, 400, 0))
    fog.set_actor_label("Haze")
    comp = fog.component
    comp.set_editor_property("fog_density", 0.05)
    comp.set_editor_property("fog_height_falloff", 0.02)
    comp.set_editor_property("fog_inscattering_luminance", unreal.LinearColor(0, 0, 0, 1))
    comp.set_editor_property("enable_volumetric_fog", True)
    comp.set_editor_property("volumetric_fog_albedo", unreal.Color(r=255, g=255, b=255, a=255))
    comp.set_editor_property("volumetric_fog_extinction_scale", 0.2)
    comp.set_editor_property("volumetric_fog_distance", 3200.0)
    volume = b.actors.spawn_actor_from_class(unreal.PostProcessVolume, vec(0, 0, 300))
    volume.set_actor_label("FixedExposure")
    volume.set_editor_property("unbound", True)
    settings = volume.settings
    for key, value in [
        ("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL),
        ("auto_exposure_apply_physical_camera_exposure", False),
        ("auto_exposure_bias", 0.0),
        ("bloom_intensity", 0.25),
        ("vignette_intensity", 0.0),
        ("motion_blur_amount", 0.0),
    ]:
        settings.set_editor_property("override_" + key, True)
        settings.set_editor_property(key, value)
    volume.set_editor_property("settings", settings)


def camera(b, label, pos, target, focal):
    actor = b.actors.spawn_actor_from_class(unreal.CineCameraActor, vec(*pos))
    actor.set_actor_label(label)
    actor.set_folder_path("Cameras")
    actor.set_actor_rotation(math_lib.find_look_at_rotation(vec(*pos), vec(*target)), False)
    comp = actor.get_cine_camera_component()
    comp.set_editor_property("filmback", unreal.CameraFilmbackSettings(23.76, 13.365))
    comp.set_editor_property("current_focal_length", float(focal))
    focus = comp.get_editor_property("focus_settings")
    focus.set_editor_property("focus_method", unreal.CameraFocusMethod.DISABLE)
    comp.set_editor_property("focus_settings", focus)
    return actor


def place_character(b, meshes, face_material, report):
    """骨付きのメッシュを舞台に置く。"""
    if not meshes:
        raise RuntimeError("キャラの形が取り込めていない")
    scale = CHARACTER_HEIGHT_CM / CHARACTER_SOURCE_HEIGHT_CM
    placed = []
    for mesh in meshes:
        actor = b.actors.spawn_actor_from_class(
            unreal.SkeletalMeshActor, vec(*CHARACTER_POS), unreal.Rotator(0, 0, CHARACTER_YAW))
        actor.skeletal_mesh_component.set_skinned_asset_and_update(mesh)
        actor.set_actor_label("Character_" + mesh.get_name()[:12])
        # 1 つのメッシュに合わせたので、顔の材質は名前で探した枠へ入れる
        for index, slot in enumerate(mesh.get_editor_property("materials")):
            if "face" in str(slot.get_editor_property("material_slot_name")).lower():
                actor.skeletal_mesh_component.set_material(index, face_material)
                report.append(f"face material slot {index}")
        actor.set_actor_scale3d(vec(scale, scale, scale))
        origin, extent = actor.get_actor_bounds(False)
        report.append(f"{mesh.get_name()} bounds origin {origin} extent {extent}")
        placed.append(actor)
    return placed


def clear_level(actors_subsystem):
    for actor in actors_subsystem.get_all_level_actors():
        if isinstance(actor, (unreal.WorldSettings, unreal.Brush)):
            continue
        actors_subsystem.destroy_actor(actor)


def open_level():
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if assets.does_asset_exist(LEVEL_PATH):
        if not levels.load_level(LEVEL_PATH):
            raise RuntimeError("レベルを開けない")
    elif not levels.new_level(LEVEL_PATH):
        raise RuntimeError("レベルを作れない")
    return levels


def build_all(surface_material, led_parent, face_material, character_meshes, report):
    levels = open_level()
    builder = StageBuilder(surface_material)
    clear_level(builder.actors)
    build_hall(builder)
    led = build_led(builder, led_parent, report)
    build_truss(builder)
    build_lights(builder)
    build_led_glow(builder)
    build_atmosphere(builder)
    cameras = {
        key: camera(builder, f"Cam_{key.capitalize()}", spec["pos"], spec["target"], spec["focal"])
        for key, spec in CAMERAS.items()
    }
    characters = place_character(builder, character_meshes, face_material, report)
    if not levels.save_current_level():
        raise RuntimeError("レベルを保存できない")
    return {"led": led, "cameras": cameras, "characters": characters}
