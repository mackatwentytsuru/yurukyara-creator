"""L_Live の顔の寄りを数秒ぶん撮る(-game で動かす。直す前後の比べ用)。

環境変数 FACE_OUT(出力フォルダ)、FACE_SECONDS(例 "20,55,100")、FACE_TAG(前/後の名前)。
キャラ(タグ LiveChar)の動きを各秒へ送り、頭の骨の位置へカメラを向けて HighResShot で保存する。終わると FACE_DONE をログに出す。
"""
import os
import traceback

import unreal

LEVEL_OBJECT = "/Game/Show/L_Live.L_Live"
OUT = os.environ["FACE_OUT"]
SECONDS = [float(s) for s in os.environ.get("FACE_SECONDS", "20,55,100").split(",")]
TAG = os.environ.get("FACE_TAG", "x")
HEAD_NAMES = ["Head", "head", "J_Bip_C_Head", "mixamorig:Head", "Neck"]
DISTANCE_CM = float(os.environ.get("FACE_DIST", "70"))
DROP_CM = float(os.environ.get("FACE_DROP", "0"))
WARMUP_TICKS = 200
WAIT_TICKS = 20  # 動きと材質が落ち着くまで

state = {"step": 0, "tick": 0, "world": None, "comp": None, "cam": None, "head": None, "done": False}


def log(text):
    unreal.log("FACE " + text)


def setup():
    world = unreal.find_object(None, LEVEL_OBJECT)
    if world is None:
        return False
    statics = unreal.GameplayStatics
    chars = statics.get_all_actors_with_tag(world, "LiveChar")
    cams = statics.get_all_actors_with_tag(world, "LiveCam")
    controller = statics.get_player_controller(world, 0)
    if not chars or not cams or controller is None:
        return False
    controller.set_view_target_with_blend(cams[0], 0.0)
    comp = chars[0].skeletal_mesh_component
    mesh = comp.get_skinned_asset() if hasattr(comp, "get_skinned_asset") else comp.skeletal_mesh
    name = mesh.get_name()
    motion = unreal.load_asset(f"/Game/Show/Character/{name}/{name}/SkeletalMeshes/{name}_Anim")
    comp.set_animation_mode(unreal.AnimationMode.ANIMATION_SINGLE_NODE)
    comp.play_animation(motion, True)
    comp.set_play_rate(0.0)
    state.update(world=world, comp=comp, cam=cams[0], keep=[motion])
    bones = [str(n) for n in comp.get_all_socket_names()] if hasattr(comp, "get_all_socket_names") else []
    log(f"character={name} length={motion.get_editor_property('sequence_length') if hasattr(motion, 'get_editor_property') else '?'} sockets={bones[:40]}")
    for candidate in HEAD_NAMES:
        if candidate in bones:
            state["head"] = candidate
            break
    log(f"head={state['head']}")
    for index, slot in enumerate(comp.get_materials()):
        log(f"slot{index} {slot.get_name() if slot else None} parent={getattr(slot, 'parent', None) and slot.parent.get_name()}")
    return True


def aim(comp, cam):
    head = comp.get_socket_location(state["head"]) if state["head"] else comp.get_component_location() + unreal.Vector(0, 0, 150)
    head = head + unreal.Vector(0, 0, 8 - DROP_CM)
    # キャラの正面(+y 方向のカメラ側)から見る。置いた向きに合わせてキャラの前方へ
    forward = unreal.Vector(0.0, 1.0, 0.0)  # 本番のカメラは +y 側から -y を見る
    position = head + forward * DISTANCE_CM
    cam.set_actor_location_and_rotation(position, unreal.MathLibrary.find_look_at_rotation(position, head), False, False)
    component = cam.get_cine_camera_component()
    component.set_editor_property("current_focal_length", 50.0)
    component.set_editor_property("constrain_aspect_ratio", False)
    return head


def tick(delta):
    try:
        if state["done"]:
            return
        if state["world"] is None and not setup():
            return
        comp, cam, step = state["comp"], state["cam"], state["step"]
        if step >= len(SECONDS):
            log("FACE_DONE")
            state["done"] = True
            return
        if state["tick"] == 0 and step == 0 and not state.get("warm"):
            state["warm"] = True
            state["tick"] = -WARMUP_TICKS  # 材質の読み込み・シェーダーの用意を待つ
        if state["tick"] == 0:
            comp.set_position(SECONDS[step], False)
        state["tick"] += 1
        if state["tick"] == WAIT_TICKS:
            head = aim(comp, cam)
            log(f"t={SECONDS[step]} head={head}")
        elif state["tick"] == WAIT_TICKS + 5:
            path = f"{OUT}/{TAG}_{int(SECONDS[step])}.png"
            unreal.SystemLibrary.execute_console_command(state["world"], f"HighResShot 1280x1280 filename=\"{path}\"")
            log(f"shot {path}")
        elif state["tick"] >= WAIT_TICKS + 30:
            state["step"] += 1
            state["tick"] = 0
    except Exception:
        unreal.log_error("FACE_ERROR " + traceback.format_exc())
        state["done"] = True


unreal.face_tick = unreal.register_slate_post_tick_callback(tick)
unreal.log("FACE_SCRIPT_STARTED")
