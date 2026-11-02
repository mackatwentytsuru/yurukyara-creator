---
name: ue-led-stage
description: Unreal Engine 5.8 で、複数の面の LED ウォールがあるステージを Python だけで新しく組み、mp4 を映して Movie Render Queue で撮る手順。LED に映像を流す、LED の面と絵の割り当てを合わせる、画面なしで材質・レベル・シーケンスを作る、撮影で LED が黒い・キャラが消えないなどで困ったときに使う。
---

# UE で LED ステージを Python だけで組む

## 流れ

1. `.uproject` と `Config/DefaultEngine.ini` を最小限で書く。プラグインは PythonScriptPlugin・EditorScriptingUtilities・MovieRenderPipeline・MediaCompositing・ElectraPlayer の 5 つを明示(Interchange は標準で入っている)。
2. 組むのは `UnrealEditor-Cmd.exe <uproject> -run=pythonscript -script=<py> -unattended -nosplash -nullrhi`。
3. 撮るのは `UnrealEditor-Cmd.exe <uproject> <level> -game -LevelSequence=<seq> -MoviePipelineConfig=<config> -windowed -log -Unattended`。カットごとに別の起動。
4. 数字で確かめる(下の「確かめ方」)。

## LED の面

- `/Engine/BasicShapes/Plane` は 100×100 cm、法線 +Z、**U=+X、V=+Y**(`ProceduralMeshLibrary.get_section_from_static_mesh` で読んだ)。
- 板の左から右を `t`、表の向きを `n` とすると、`make_rotation_from_axes(t, n × t, n)` で絵が正しい向きに貼れる(`×` は座標のふつうの外積)。向きを試行錯誤しなくてよい。
- 曲がった面は、弧長で等分した短い板(16 枚で十分なめらか)にし、板ごとに UV のずらしと倍率を変える。
- 材質は Unlit、Emissive = テクスチャ × 明るさ。UV = `TexCoord × (Uスケール, Vスケール) + (Uずらし, Vずらし)` を MI のパラメータにする。
- 1 本の絵を面ごとに切る形にすると、同じ映像を本物の LED にもそのまま出せる。面の変形を打ち消すときは、絵の中の物を描く段階で逆に伸ばす。

## mp4 を映す

- `MediaTexture`(`MediaTextureFactoryNew`)を `TextureSample` に入れる。**`sampler_type` は `SAMPLERTYPE_COLOR`**。`EXTERNAL` だとコンパイルに失敗し、LED が黒い通常材質になる。
- `FileMediaSource.set_file_path()` に絶対パス。H.264・yuv420p の 2840×620 で動いた。
- シーケンスに `MovieSceneMediaTrack` → `add_section()` → `media_source`・`media_texture`・`looping` を設定。
- 撮影の準備のコマでもメディアが要るので、**セクションは撮る範囲の前後に 60 コマずつ余らせる**(足りないと範囲外の警告が出る)。

## 撮影の設定(測った値)

- `MoviePipelinePrimaryConfig` に Output・DeferredPassBase・ImageSequenceOutput_PNG・AntiAliasing・GameOverride。
- 3 コマ、準備(engine / render warm up)45 コマ、temporal 4 で、1 カット 12〜16 秒(起動から終了まで、1920×1080、RTX 5090 相当)。
- 露出はマニュアル、`auto_exposure_apply_physical_camera_exposure=False`、bias 0 で、LED の発光 1.0 が白飛びしない(最大 255 のピクセルは面の 0.07% 以下)。この露出では、ライトは cd で 100〜500 ほどで足りる。
- ヘイズ: Exponential Height Fog は `enable_volumetric_fog`(`volumetric_fog` は無い)、density 0.05、extinction 0.2、ライトの `volumetric_scattering_intensity` 45、ビーム 300 cd。明るい LED の前では筋はまだ薄い。

## キャラ(glb)

- `AssetImportTask` で取り込むと、メッシュごとに別の骨付きメッシュと骨になる。胴と顔なら 2 アクタ置く。glTF の +Z(正面)は UE の +Y を向く。
- 顔のアトラスは glTF の材質のままだと全部映る。1 コマだけ映す材質を書き、`Emissive = 色 × 明るさ × 透明度`。透明の抜き(Masked)は縁がギザギザになった。
- **動きだけの glb(メッシュ無し)は Interchange が何も作らない**(スキンが使われていないと出る)。
- **動かす手順**(骨が同じ動きの glb が別にあるとき):
  1. Blender 背景モードで `scene.render.fps = 30` を**先に**入れる(初期の 24 のままだと、書き出しで動きが短くなる)。
  2. 形の glb を読み、メッシュを `join` で 1 つに合わせる(材質は枠で残る)。UE は glb のメッシュごとに別の骨を作るので、合わせないと動きを 1 本で流せない。
  3. 動きの glb を読み、骨の名前と初期の位置が同じかを確かめ、Action だけを取り、骨組みの NLA トラックに置く。
  4. `export_animation_mode="NLA_TRACKS"` で 1 本の GLB に書き出す。UE では Skeletal Mesh 1 つ・Anim Sequence が動きの数だけできる(名前は `<glb名><動き名>`)。
  5. シーケンスで `binding.add_track(unreal.MovieSceneSkeletalAnimationTrack)` → `add_section()` → `set_range`。`params` を `get_editor_property` で取り、`animation` を入れ、`set_editor_property("params", params)` で戻す。範囲が動きより長いと繰り返す。
  6. 材質の枠は `mesh.get_editor_property("materials")` の `material_slot_name` で探し、`set_material(番号, 材質)`。
- 測った値: Blender 2 秒、UE の取り込み 0.8 秒、撮影 1 コマ約 0.05 秒(骨 6 本・頂点 13,000 ほど)。
- 確かめ方: 同じカットの 2 つのコマを並べて見る。部品ごとの剛体の骨なら、顔の面も体に付いて動く。
- 顔のコマを途中で変えるのは未試験(`MovieSceneComponentMaterialTrack` はある)。

## 落とし穴

- **Git Bash からは `MSYS_NO_PATHCONV=1`。** `/Game/...` が書きかえられ、レベルが開かないのに終了コードは 0。
- 材質のエラー文は、**`-game` のログの `Failed to compile` の次の行**にある。行を切らずに読む。`-nullrhi` や画面なしの再コンパイルでは出なかった。
- 影なしのライトは床を突き抜けて下の床に当たる。ビームも影ありにする(撮影時間はほぼ変わらなかった)。
- 面光源の cd は面全体の量なので、細い面光源は明るく見える。幅に比例させる。
- `LinearColor.to_rgbe()` は色の変換ではない。ライトには `unreal.Color(r=, g=, b=, a=)`。
- HLSL の予約語(`line` など)を Custom ノードの変数名にしない。
- 同じ資産を作り直すときは消さず、`does_asset_exist` で読み直して上書きする。シーケンスは中のトラックと結びつきを消して作り直す。
- 位置のトラックは、9 本全部に `set_default` する(回転と大きさも)。カットごとに扉を開ける・物を動かすのに使える。

## 物を隠す

- `MovieSceneVisibilityTrack` では隠れなかった(プロパティ名 `bHiddenInGame`・`bHidden` のどちらも。原因は不明)。**位置のトラックで床下へ動かす**と確実に隠れる。

## 動きを付ける

- 位置のチャンネルに `channel.add_key(unreal.FrameNumber(f), 値)` をコマごとに入れる。なめらかさは式(`t*t*t*(t*(6*t-15)+10)`)で作る。回転と大きさは `set_default` のまま。
- カメラは、カメラカットに渡した結びつきと同じ物に位置のトラックを足す(`add_possessable` を 2 回呼ばない)。
- 速さ: 1920×1080・temporal 4 で 1 コマ約 0.07 秒(150 コマで起動込み 22 秒)。試しを何度も撮り直せる。
- 連番は `ffmpeg -framerate 30 -i x.%04d.png -an -c:v libx264 -pix_fmt yuv420p -map_metadata -1 out.mp4`。
- 奥の暗い所を見せる扉: 板は片面でも表からは奥を隠す。奥のライトは板より奥の物だけに当て、弱め(200 cd ほど)にすると、開いて初めて見える。

## 確かめ方

- カメラの式(焦点距離とセンサー幅)で面の範囲を計算し、面の中だけ平均と最大 255 の割合を測る。
- 160 px ごとの線と面の境目の赤線のグリッドを流して撮り、赤線の位置を計算と比べる(今回の差は 0.5〜2.5 px)。
- 同じカメラで、物があるカットと無いカットの差を取ると、物の範囲を測れる。LED の絵の中の物の縦横は、絵だけが違うカットとの差で測る(元の絵 0.922 に対して 0.921 だった)。

## ブラウザ(three.js)のキャラを LED の動画にする(保険の案)
- 実時間の画面録画ではなく、専用ページで `update(1/30)` を固定で進め、`canvas.toDataURL('image/png')` で透明 PNG を 1 コマずつ保存 → ffmpeg で背景に重ねる。1 コマ約 14 ms で、90 コマが数秒。
- 中央の面の横 1.48 倍の伸ばしと中心の移動は、カメラの射影行列に直接入れる(`elements[0] *= 1.48`、`elements[8]`=横のずれ、`elements[9]`=縦のずれ。`updateProjectionMatrix` を空にして上書きを防ぐ)。
- ヘッドレス Chrome は `--use-angle=d3d11 --ignore-gpu-blocklist`。`--use-angle=gl` だと WebGL のコンテキストが失われて全コマが透明になる。
- 境目の確認は、静止ポーズでなく動き全体の外接矩形(全コマのアルファ)で測る。体が回る動きは静止より横に 10〜20% 広がる。
- `web/` を書きかえずに読ませるには、小さな静的配信と import map(three・three/addons・@pixiv/three-vrm 系)で足りる。配る道を許可リストにして `.env` を除く。
- 動きの glb をブラウザと別の道具(UE など)で見比べるときは、先に骨の回転をページで出して glb の値と突き合わせる。rig の視線処理(lookBone)は、動きの骨が一定値だと角度が積み上がるので、録画ページでは切る。
