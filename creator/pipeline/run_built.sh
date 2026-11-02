#!/bin/sh
# 手組み版を 1 周まわす: builder → 顔の表 → 骨 → 8 方向 → 元の絵との比べ
# 使い方: sh run_built.sh <id> <作業フォルダ> <元の絵> [builder の追加引数…]
ID=$1; W=$2; ORIG=$3; shift 3
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"; PY=work/venv-trellis2/Scripts/python.exe
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p $W/built $W/face2 $W/rig2
"$B" -b -P $HERE/../builders/$ID.py -- $W/built/${ID}_built.blend "$@" 2>&1 | grep -E "^BUILD|Traceback" | grep -v unregister
STYLE=led; [ "$ID" = "d_lantern" ] && STYLE=paper
$PY $HERE/f01_face_atlas.py $STYLE $W/face2 > /dev/null
"$B" -b -P $HERE/b03_rig.py -- $HERE/../specs/${ID}_built.json $W/built/${ID}_built.blend - $W/face2 $W/rig2 2>&1 | grep -E "^B03" | cut -c1-80
rm -rf $W/views2; "$B" -b -P $HERE/b05_render.py -- $W/rig2/model.glb $W/views2 --size 600 2>&1 | grep -E "B05" | cut -c1-10
# 動きの確かめ(大きな一覧)
rm -rf $W/poses2; "$B" -b -P $HERE/b06_posecheck.py -- $W/rig2/rig.blend $W/poses2 wave:17 wave:22 bow:25 jump:20 think:40 nod:7 talk:9 sad:30 2>&1 | grep -E "B06" | cut -c1-10
