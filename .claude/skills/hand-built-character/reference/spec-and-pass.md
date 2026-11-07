# 合否の数字を先に決める(輪郭の重なり以外)

(元の文のまま)


`s03_compare.py` は、輪郭の重なり(IoU)に加えて、**中心のずれ(正規化した 500px の絵で、何 px)・外接箱の幅の差(%)・高さの差(%)** を出す。目安: IoU 0.90 以上、中心のずれ 6px 以内、幅・高さの差 3% 以内。外れた数字で、直す所を決める(中心のずれ → 体の置き場所、幅の差 → 部品の半径、高さの差 → 全体の高さの割り当て)。顔の部品のずれは `s04_overlay.py` の重ねで、画素で読む。

## character.json の正しい形(最上位に置く。`rig` の入れ子は使わない)

```json
{
  "id": "peach", "name": "もも", "model": "model.glb", "type": "rig", "height_m": 1.0, "fur": {},
  "expressions": ["neutral", "happy", "surprised", "sad", "think"],
  "motions": { "idle": "motions/idle.glb", "talk": "motions/talk.glb", "nod": "motions/nod.glb" },
  "look":  { "bone": "head", "max_deg": [22, 14], "eyes": ["eye_L", "eye_R"] },
  "mouth": { "kind": "morph", "morph": "mouth_open", "gain": 1.2 },
  "blink": { "morph": "eye_blink" },
  "morphs": { "happy": { "mouth_wide": 0.9 }, "surprised": { "mouth_o": 1.0 }, "sad": { "eye_blink": 0.3 } }
}
```

- `expressions` は表情ボタンの名前。`morphs` は、表情の名前 → シェイプキーの重み(キーは model.glb にある名前)。
- `look.bone` は体を向ける骨、`look.eyes` は黒目の骨(無ければ省く)。口は `mouth.kind = "morph"` と `mouth.morph`(口を開くキー)が要る。
- **pack を作ったら、必ず `python creator/pipeline/pk02_check_character.py <pack>` を通す**(最上位のキー、モーフの名前、骨の名前、動きのファイルを機械で確かめ、外れた所を ERROR で出す)。`OK` が出るまで直す。ブラウザで確かめる前に、ここで落ちる誤りが多い(入れ子にした、`mouth.kind` を書き忘れた、`expressions` が空)。
- `pk01_package.py` は、model.glb の骨とモーフを読んで character.json を書く(11-04 に直した)。`mouth_open` があれば `mouth.kind: "morph"`・`blink`・`morphs`・`look.eyes` を自動で書き、既定で `"fur": {}`(使わないなら `--no-fur`)。顔の表(`face/face_atlas.json`)は無くてもよい。出力は手直しなしで `pk02` を通る(`characters/robo`・`yokoso` の GLB で OK を確認)。`mouth_open` が無く atlas だけのときは atlas の口で書き、WARN を出す(`pk02` は通らない)。

## 合格の目安

正面・横の重ねで、主な部品(目・口・手足・小物)の位置と大きさが元の絵とほぼ重なる。Claude の判定で「位置・色・形はほぼ合う」。ブラウザで、表情・口・まばたき・動き 5 つ以上が動く。
