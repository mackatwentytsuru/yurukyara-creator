あなたは、ゆるキャラの 3D を作る担当です。これは、スキルだけを頼りに 1 体作れるかの試験です。最後の報告は日本語で、15 行まで。

# 読んでよい物(これだけ)
1. スキル: repo\.claude\skills\hand-built-character\SKILL.md(最初に全部読む。手順の正本)
2. 道具(中身を読んで使い方を知ってよい): repo\creator\pipeline\ の m00_prims.py、m02_shot.py、s04_overlay.py、s03_compare.py、b07_rig_groups.py、b04_motions.py、b06_posecheck.py、s02_posesheet.py、s01_sheet.py、f01_face_atlas.py
3. 型: repo\creator\builders\_template_px.py、repo\creator\specs\_template_rig.json
**読んではいけない物**: repo\creator\builders\ の f_led.py と d_lantern.py、repo\characters\ の中身、work\creator_work\ の他のフォルダ(作業フォルダ以外)。スキルに書いてないことが分からないときは、他のキャラの物を見ず、報告の「足りなかった知識」に書く。

# 作る物
入力の絵: {IMAGE}(正面 1 枚だけ。横の形は推測してよい)。
作業フォルダ(ここだけに書く): {WORK}
- builder: そのフォルダの builder.py(Blender の Python。m00_prims を使う)。リポジトリ(repo)には何も書かない・コミットしない・push しない。
- Blender: "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P ... 。Python(PIL・numpy): work\venv-trellis2\Scripts\python.exe 。claude や node を名前で止めない(taskkill /IM などは禁止)。

# 合格の条件(全部、実測で確かめる)
1. builder が通り、.blend ができる。
2. 元の絵との輪郭の重なり(s03_compare.py の IoU)が 90% 以上。重ねの一覧(s04_overlay.py)で、頭・胴・手・足・小物の位置と大きさがほぼ重なる。
3. 元の絵の特徴(色・質感・顔の部品)が出ている。顔(目・口・ほお)は部品かシェイプキーで組む。
4. 骨を入れ、動き(idle・talk・nod・bow など 3 つ以上)を GLB に出す(b07_rig_groups.py)。まばたきと口の開きのシェイプキーを付ける(値は 0 に戻す)。
5. 一覧の絵(比べ、動きの姿勢)を自分で開いて見て直す。2 周は直す。
6. 正面・右・後ろ・斜めを見て、体が崩れていないか確かめる。
7. ブラウザで再生できる形にする(pk02_check_character.py が OK を出すまで直す): model.glb と motions/*.glb、character.json(creator/README.md の rig の形)を {WORK}\pack\ に出す。
一覧の絵に付ける見出しは日本語で、大きく。

# 報告に必ず入れること
- 合格条件 1〜7 ごとに、できた/できない と実測(数字・ファイル名)。
- builder を直した回数、かかったおおよその時間。
- 「足りなかった知識」: スキルに書いてあれば迷わなかったのに、というもの(スキルへ書き足す文として)。
- つまずき: うまくいかなかった試しと、直し方。
- 作った一覧の絵(比べ・動き)のフルパスを 2〜3 枚。
