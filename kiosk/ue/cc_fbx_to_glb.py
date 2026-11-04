"""CC の FBX(骨の枠がメッシュに対して X 軸まわりに 90° 回っている)→ メッシュを骨の枠に合わせ、腕を下ろした姿勢を基準にした GLB。
口の形(V_*)とまばたき(C_Blink*)だけ残す。絵は入れない(UE 側で CC の説明ファイルの絵を当てる)。
使い方: blender -b --factory-startup -P kiosk/ue/cc_fbx_to_glb.py                    (entrance_config.json の source_fbx → fbx)
        blender -b --factory-startup -P kiosk/ue/cc_fbx_to_glb.py -- <in.fbx> <out.glb> <腕を下ろす度>"""
import bpy, sys, re, math, os, json
from mathutils import Matrix, Vector
args = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
if args:
    src, dst, arm_deg = args[0], args[1], float(args[2])
else:
    _c = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "entrance_config.json"), encoding="utf-8"))["character"]
    src, dst, arm_deg = _c["source_fbx"], _c["fbx"], float(_c.get("bake_arm_down_deg", 42))
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
KEEP = re.compile(r"^(V_(Open|Explosive|Wide|Tight_O|Tight|Lip_Open|Dental_Lip|Affricate|None)|C_Blink[LR])$")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:  # 要らない形を先に消す(軽くする)
    sk = o.data.shape_keys
    if sk:
        for k in list(sk.key_blocks)[1:]:
            if not KEEP.match(k.name):
                o.shape_key_remove(k)
# 1) 姿勢を外し(基準の姿勢)、メッシュを骨の枠へ回す
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
W = arm.matrix_world
def wpos(n): return W @ arm.data.bones[n].head_local
def mesh_pt_near_hand():
    o = bpy.data.objects['sample_glove_v38']; P = [o.matrix_world @ v.co for v in o.data.vertices]
    return max(P, key=lambda p: p.x)
print("BEFORE bone hand", [round(v,3) for v in wpos('hand_l')], "glove max-x", [round(v,3) for v in mesh_pt_near_hand()])
Rm = Matrix.Rotation(math.radians(90), 4, 'X')
for o in meshes:
    o.data.transform(o.matrix_world.inverted() @ Rm @ o.matrix_world, shape_keys=True)
    o.data.update()
print("AFTER  bone hand", [round(v,3) for v in wpos('hand_l')], "glove max-x", [round(v,3) for v in mesh_pt_near_hand()])
# 2) 立てる(骨の上 = -Y → +Z)
arm.matrix_world = Matrix.Rotation(math.radians(-90), 4, 'X') @ arm.matrix_world
bpy.context.view_layer.update()
W = arm.matrix_world
print("STAND head", [round(v,3) for v in wpos('head')], "foot", [round(v,3) for v in wpos('foot_l')])

def bake():
    for o in meshes:
        sk = o.data.shape_keys
        keep = [k.name for k in sk.key_blocks[1:]] if sk else []
        def ev():
            bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
            e = o.evaluated_get(dg); m = e.to_mesh(); co = [v.co.copy() for v in m.vertices]; e.to_mesh_clear(); return co
        if sk:
            for k in sk.key_blocks: k.value = 0.0
        base = ev(); shapes = {}
        for n in keep:
            sk.key_blocks[n].value = 1.0; shapes[n] = ev(); sk.key_blocks[n].value = 0.0
        if sk: o.shape_key_clear()
        for v, c in zip(o.data.vertices, base): v.co = c
        if keep:
            o.shape_key_add(name="Basis")
            for n in keep:
                kb = o.shape_key_add(name=n)
                for i, c in enumerate(shapes[n]): kb.data[i].co = c
        o.data.update()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

# 3) 腕を下ろす(世界の下へ)
down = Vector((0, 0, -1))
for side in "lr":
    ua = arm.pose.bones[f"upperarm_{side}"]; hand = arm.pose.bones[f"hand_{side}"]
    h = W @ ua.head; t = W @ hand.head
    axis = (t - h).normalized().cross(down).normalized()
    R = Matrix.Rotation(math.radians(arm_deg), 4, axis)
    ua.matrix = W.inverted() @ (Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ (W @ ua.matrix))
    bpy.context.view_layer.update()
    print("ARM", side, [round(v,3) for v in t], "->", [round(v,3) for v in W @ hand.head])
if arm_deg:
    bake()
# 4) 1 つのメッシュにまとめる(UE の glTF の取り込みは、メッシュごとに別の骨つきメッシュを作るため。形は名前で合わさる)
bpy.ops.object.select_all(action='DESELECT')
body = bpy.data.objects['cc_base_body'] if 'cc_base_body' in bpy.data.objects else meshes[0]
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = os.path.splitext(os.path.basename(dst))[0]
# 5) 骨の親の回転と縮尺(0.01)を焼き込む(残すと UE で人型が 1/100 になる)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
arm.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.context.view_layer.update()
print("APPLIED head z", round((arm.matrix_world @ arm.data.bones['head'].head_local).z, 3), "mesh max z", round(max((body.matrix_world @ v.co).z for v in body.data.vertices), 3))
print("JOINED", body.name, len(body.data.vertices), len(body.data.materials), [k.name for k in body.data.shape_keys.key_blocks] if body.data.shape_keys else [])
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_skins=True, export_morph=True, export_morph_normal=False,
                          export_animations=False, export_image_format='NONE', export_yup=True)
print("EXPORTED", dst)
