#!/bin/sh
# 部品ごとの骨(b07)で作るキャラを 1 周まわす: builder → 骨と動き(b07)→ 8 方向 → 動きの姿勢 → 元の絵との比べ
# 使い方: sh run_groups.sh <id> <作業フォルダ> <元の絵.png>
# 前提: <作業フォルダ>/sash.png など builder が読む物は先に作っておく。builder は work=<作業フォルダ> を受け取る。
# run_built.sh は顔の表(f01・b03)の道。目と口がシェイプキーのキャラ(ようこそくん・ロボくん)は、こちらを使う。
ID=$1; W=$(cygpath -m "$2"); ORIG=$(cygpath -m "$3")
HERE=$(cd "$(dirname "$0")" && pwd)
ENV_SH="$HERE/run_groups.sh"; . "$HERE/../env.sh"
B=$BLENDER
mkdir -p "$W/built" "$W/rig2"
"$B" -b -P "$HERE/../builders/$ID.py" -- "$W/built/${ID}_built.blend" work="$W" 2>&1 | grep -E "^BUILD|Traceback|Error" | grep -v unregister
"$B" -b -P "$HERE/b07_rig_groups.py" -- "$HERE/../specs/${ID}_built.json" "$W/built/${ID}_built.blend" "$W/rig2" 2>&1 | grep -E "^B07" | cut -c1-200
rm -rf "$W/views2"; "$B" -b -P "$HERE/b05_render.py" -- "$W/rig2/model.glb" "$W/views2" --size 600 2>&1 | grep -E "B05" | cut -c1-40
rm -rf "$W/poses2"; "$B" -b -P "$HERE/b06_posecheck.py" -- "$W/rig2/rig.blend" "$W/poses2" wave:17 wave:22 bow:25 nod:7 talk:9 idle:30 --size 560 2>&1 | grep -E "B06" | cut -c1-40
