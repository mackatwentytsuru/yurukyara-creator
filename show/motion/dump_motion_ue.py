# Kawaii の動きの骨を、そのまま数字で書き出す(読むだけ。何も保存しない)
import json, struct, pathlib, unreal
OUT = pathlib.Path(r'work/ue_show/motion_kawaii/raw')
ROOT = '/Game/KawaiiAnimations/Animations'
SKIP = ('/Combat/', '/Locomotion/', '/Sit/', '/Sleep/', '/StickToTheWall/', '/Idle_Sit/', '/Idle_Pair/', '/Action/')
BONES = ['root','pelvis','spine_01','spine_02','spine_03','spine_04','spine_05','neck_01','neck_02','head',
 'clavicle_l','upperarm_l','lowerarm_l','hand_l','clavicle_r','upperarm_r','lowerarm_r','hand_r',
 'thigh_l','calf_l','foot_l','ball_l','thigh_r','calf_r','foot_r','ball_r']
for s in 'lr':
    for f in ['thumb','index','middle','ring','pinky']:
        for i in ['metacarpal','01','02','03']:
            BONES.append(f'{f}_{i}_{s}')
reg = unreal.AssetRegistryHelpers.get_asset_registry()
reg.wait_for_completion()
assets = reg.get_assets_by_path(ROOT, recursive=True)
done = 0
index = {}
opts = unreal.AnimPoseEvaluationOptions()
for a in assets:
    path = str(a.package_name)
    if a.asset_class_path.asset_name != 'AnimSequence' or any(k in path for k in SKIP):
        continue
    seq = unreal.load_asset(path)
    skel = seq.get_editor_property('skeleton')
    length = unreal.AnimationLibrary.get_sequence_length(seq)
    nframes = unreal.AnimationLibrary.get_num_frames(seq)
    fps = 60.0
    n = int(length * fps) + 1
    ref = unreal.AnimPoseExtensions.get_reference_pose(skel)
    names = [str(b) for b in unreal.AnimPoseExtensions.get_bone_names(ref)]
    use = [b for b in BONES if b in names]
    def tr(pose, b, refpose=False):
        fn = unreal.AnimPoseExtensions.get_ref_bone_pose if refpose else unreal.AnimPoseExtensions.get_bone_pose
        t = fn(pose, b, unreal.AnimPoseSpaces.WORLD)
        q, p = t.rotation, t.translation
        return (q.x, q.y, q.z, q.w, p.x, p.y, p.z)
    name = path.rsplit('/', 1)[1]
    out = bytearray()
    for f in range(n):
        pose = unreal.AnimPoseExtensions.get_anim_pose_at_time(seq, min(f / fps, length), opts)
        for b in use:
            out += struct.pack('<7f', *tr(pose, b))
    (OUT / (name + '.bin')).write_bytes(bytes(out))
    refvals = {b: tr(ref, b, True) for b in use}
    index[name] = {'path': path, 'skeleton': skel.get_path_name(), 'length': length, 'src_frames': nframes, 'frames': n, 'fps': fps, 'bones': use, 'ref': refvals}
    done += 1
    if done % 20 == 0:
        unreal.log(f'KDUMP {done}')
        (OUT / '_index.json').write_text(json.dumps(index), encoding='utf-8')
(OUT / '_index.json').write_text(json.dumps(index), encoding='utf-8')
unreal.log(f'KDUMP DONE {done}')
