#!/bin/sh
# 試験の 1 段を、作業役の申告ではなく同じ物差しで測る。
# 使い方: sh eval_stage.sh <段の名前> <.blend の相対パス(段のフォルダの中)> [pack の glb を含む .blend ではなく、正面を撮る blend]
# 出力: <段>/verify/{shot_front.png, cmp.png}、<段>/judge/{cmp.png, dir8.png, motion.png}(あれば。判定は別途 oc_web.ps1)
STAGE=$1; BL=$2
CHAR=${CHAR:-g_bighead}
ORIG=${ORIG:-work/creator_work/skilltest/jobs/g_bighead/out.png}
W=work/creator_work/skilltest/$CHAR/$STAGE
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"; PY=work/venv-trellis2/Scripts/python.exe; P=repo/creator/pipeline
mkdir -p $W/verify
"$B" -b -P $P/m02_shot.py -- $W/$BL $W/verify --views front,right,back,q --size 1024 --transparent 2>&1 | grep -E "SHOT"
$PY $P/s03_compare.py $ORIG $W/verify/shot_front.png $W/verify/cmp.png "桃のキャラ 元の絵と比べ($STAGE)" --names 元の絵,手組み版 | head -1
$PY - <<PYEOF
from PIL import Image
W='$W/verify/'
ims=[Image.open(W+f'shot_{v}.png').convert('RGBA') for v in ('front','q','right','back')]
s=Image.new('RGB',(4*512,512),(231,231,231))
for i,im in enumerate(ims):
    bg=Image.new('RGBA',im.size,(231,231,231,255)); bg.alpha_composite(im); s.paste(bg.convert('RGB').resize((512,512)),(i*512,0))
s.save(W+'views4.png')
PYEOF
