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

## 全編の映像と音を流す(シミュレーター)

- **メディアはコマに固定して撮れる**(`MovieSceneMediaTrack`、Electra、`-game` の Movie Render Queue)。乱数の明るさのテスト映像で測って、83.3 秒・2499 コマで全区間ずれ 0、光と音の差は 28 回とも 0 ms。途中の秒から撮っても同じ。
- ただし設定が 2 つ要る:
  - **`temporal_sample_count` 4 だと前後のコマが混ざる**(相関 0.71)。temporal 1・spatial 4・`anti_aliasing_method` を `AAM_NONE`(`override_anti_aliasing` True)にすると 0.99 になる。1 コマの時間は変わらなかった。
  - **絵は 1 コマ遅れて届く**(相関の山が -1 に一定)。メディアのセクションの始まりを 1 コマ前に置く。
- シーケンスの 0 コマ目に映像の 0 秒を置くと、準備のコマの置き場がない。60 コマ後ろに置き、`set_playback_start/end` で撮る範囲を決める。ファイル名は `{frame_number_rel}` で 0 から数えられる。
- 音: `MovieSceneAudioTrack` → `section.set_sound()`。24bit は避け 16bit に直して取り込んだ。撮影は `-nosound` で動かし(音を鳴らさない)、mp4 には元の wav を `-ss` で重ねる。
- 1 コマ 0.05 秒、起動込みで 2499 コマ 133 秒(1920x1080、temporal 1・spatial 4、Lumen の反射あり、RTX 5090 相当)。組み立ては資産を上書きするだけで 6〜10 秒。
- 同じ物を別のレベルにする: `build_level` の部品を呼んで `L_Sim` を作り、`SpotLight` を消す。既存のカットを壊さない。

### 暗い箱の床の見え方

- 床の反射は材質の粗さだけで出た。舞台 0.08、客席の床 0.2(元は 0.22 と 0.55)。Lumen の反射は `r.ReflectionMethod=1` のまま。0.55 の客席の床は何も映らなかった。
- 面光源を面の前に置くなら、**一定の強さにしない**。LED が黒い間も床が光る。映像の直線の輝度を `MovieSceneFloatTrack`(`set_property_name_and_path("Intensity", "Intensity")`)にキーで入れる。結びつきは `add_possessable(actor)` のあとに `add_possessable(actor.rect_light_component)`。
- 強さの目安: 一定の 40 cd は床が白く飛び、反射が消えた。「真っ白のとき 60 cd × 輝度」(この絵で輝度 0.1 前後)でちょうどよい。黒い間は全画面が 0.0 のまま。
- キーが 3 分の 1 秒ごとだと、補間で床が LED より先に光り始めた(LED が点く 2 コマ前に床の平均が 10)。10 分の 1 秒ごとにした(直したあとの黒から点く瞬間は測っていない)。

### カメラを選ぶときの幾何

- 案の焦点距離は 35mm 換算 × センサー幅 / 36。
- 中央の面は 140 cm 奥にあるので、**斜めから撮ると手前の面が中央の面を隠す**。縁の線 (x=-237, y=0) を通る線で隠れる範囲を計算してから置く。
- 舞台の床より低いカメラは、舞台の前の縁で LED の下が隠れる。隠れる高さ = (舞台の高さ - カメラの高さ) × (縁から面まで) / (カメラから縁まで)。

## 実写とカメラを合わせて合成する

- **座標:** 記録の世界(y が上、右手系、m)の (x, y, z) は UE の (x, z, y) の並びで、この入れ替えだけで右手系が左手系になる。あとは水平の回転と平行移動だけ(重力は合っている)。向きは「前・右・上」の列のまま同じ変換に通し、UE の式(`FRotationMatrix`)の逆で Pitch・Yaw・Roll にする。
- **ロールの符号:** UE の Rotator の正は、後ろから見てカメラが時計回り。`roll = atan2(-right.z, up.z)`。記録に 10 度入れて撮って確かめた(正しい符号で誤差 2.09 px、逆で 118.5 px)。**`atan2(dot(cross(h, right), fwd), dot(h, right))` の形は符号が逆になる。**
- 焦点距離は、センサー幅 36mm にして `focal = fx * 36 / 画像の幅`。センサーの高さは画像の比に合わせる。焦点距離は `MovieSceneFloatTrack` の `CurrentFocalLength`(コンポーネントの結びつき)でキーにする。
- 誤差の実測: 4 隅の狙いのずれ 0.1° の記録で、カメラの位置のずれ最大 2.4 cm・向き 0.06°、床の目印は 1920 幅で平均 2.1 px・最大 4.5 px。追跡が切れた 0.3 秒は前後の補間で同じ精度。面ごとの残差は 1.4〜3.1 cm(配置は正解なので、これが狙いの誤差の分)。
- **透明:** 真っ黒の中で材質を Unlit の真っ白(発光 50)にして、spatial 16 で撮る。MRQ は tone map 後を平均するので、白飛びさせても縁の割合が正しく出る。**にじみ(bloom)を 0 にする。** 残すと透明が周りへ何十画素も広がる。
- **色:** キャラあり・なしを同じカメラで撮り、`with − (1−α)·without` でステージの色を抜く。縁に背景が残らない。
- **影:** 灰色の床と LED の位置の面光源で、有り無しの比(直線の明るさ)。1500 cd は床が白飛びして比が取れなかった。400 cd で足りた。
- **見えない床は要らなかった:** 比で取れば床の形はレベルに置くだけでよい。
- **LED の映り込み:** 床の `with − without` を足すと、キャラの映り込みも入る。本物の床が光らないときは下げる。
- 舞台の床は、高さ 1.5 m のカメラからは足の前で 14 px の帯しか見えない。影を見せたいならカメラを高くする。
- 同じレベルでキャラを床下に置く形は、1 パス 600 コマ約 40 秒(spatial 16 は約 90 秒)。
- **音の無い実写の合わせ方:** 明るさの平方根の差分を、局所の大きさ + 床の値(0.15)で割って相関。床の値が小さいと、暗い所のノイズを持ち上げて 8 秒で外れた。全編・20・8・4 秒はずれ 0 コマ、preroll だけ(変化なし)は外れる。
- **ffmpeg を subprocess で呼ぶときは `stdin=subprocess.DEVNULL`。** Python を標準入力から動かしていると、ffmpeg が標準入力を読んで止まる(10 分止まった)。
- Git Bash から `/Game/...` を引数で Python に渡すときも `MSYS_NO_PATHCONV=1`。`C:/Program Files/Git/Game/...` になる。

## リアルタイムで動かして、絵を端末へ返す(11-03 に測った。コードは `show/live/`)

- **公式の Unreal VCam は旧 Pixel Streaming(1)にしか対応しない。** `VirtualCameraCore.uplugin` の依存が `PixelStreaming`、その `PixelStreamingVCam` は `UncookedOnly`(エディタ用)。自分のカメラのアプリと併用するなら、-game + Pixel Streaming 2 + 自作の UDP がよい。
- **-game には signalling が無い。** 内蔵の `MakeSignallingServer` を呼ぶのはエディタのモジュールだけで、Blueprint や Python からは呼べない。公式の `get_ps_servers` は GitHub から落とす物。取り次ぎの形は単純(`SignallingServer.cpp` を読む): UE に `config`・`identify` を送る、`endpointId` で名前が来る、ページの `subscribe` で UE へ `playerConnected`、以後 `offer`/`answer`/`iceCandidate` を `playerId` を付け外しして渡す。Python の websockets で 150 行ほど。同じポートでページも出せる。
- 起動: `UnrealEditor.exe <uproject> <level> -game -windowed -ResX -ResY -ForceRes -RenderOffScreen -nosound -PixelStreamingConnectionURL=ws://127.0.0.1:8888 -PixelStreamingEncoderCodec=H264 -PixelStreamingEncoderLatencyMode=ULTRA_LOW_LATENCY -PixelStreamingWebRTCStartBitrate=10000000 -PixelStreamingWebRTCMaxBitrate=20000000 "-ExecCmds=t.MaxFPS 60, r.VSync 0, py <スクリプト>"`。起動から用意まで 13〜32 秒。
- **`-ExecCmds` の区切りは `,`。** `;` だと最初の命令しか動かず、エラーも出ない。
- **エンコーダーの目標を固定しない。** `-PixelStreamingEncoderTargetBitrate` を固定すると、回線の見積り(既定は 1 Mbps から)が上がるまで送り待ちがたまり、遅れが 1 秒を超えた(中央値 1,285 ms → 直して 120 ms)。代わりに `-PixelStreamingWebRTCStartBitrate` を上げる。
- -game の Python: 世界は `unreal.find_object(None, "/Game/.../L_X.L_X")`、物は `GameplayStatics.get_all_actors_with_tag`。編集用の Subsystem は無い。毎コマは `unreal.register_slate_post_tick_callback`(1 回 1 ms 未満)。カメラは `controller.set_view_target_with_blend`。LED は `unreal.new_object(unreal.MediaPlayer)` → `media_texture.set_media_player` → `open_file`。秒の指定は `unreal.MathLibrary.from_seconds`(`unreal.Timespan` は引数 5 つまで)。
- 測り方: カメラに付けた小さな発光の箱の色を印の番号で変え、ページの `requestVideoFrameCallback` で色の変化を読み、送った時刻と比べる(同じ機械でも時計は WebSocket の往復で合わせる)。
- 実測(RTX 5090、同じ機械のヘッドレス Chrome、H.264 baseline、全編の描画とは別の時間): 1280x720 60fps で送ってから絵まで中央値 86 ms・p95 106 ms・最大 137 ms、75 秒でコマ落ち 0・16.7 Mbps。1280x960 は中央値 96〜105 ms。1920x1080 はブラウザが 42 fps・フリーズ 7 回。全編の描画と同時は UE 57 fps を保ち、全編の描画は 0.19〜0.23 秒/コマで、始める前の 0.21 と変わらなかった。
- 画角は `focal = fx * 36 / w`、センサー 36 × 36·h/w。絵の解像度を端末の縦横比に合わせる。主点のずれは入れていない。

### レンズの歪みを実写に合わせる

- 歪みは直さない。CG を広く描き、ST マップで実写の歪みへ写す。**色・透明・影の全部に同じ表をかけてから重ねる。**
- UE の Cine Camera は主点が真ん中に固定で、画素は正方形。主点がずれたレンズは、ずれの分だけ広く描き、ST マップの値を「真ん中が主点」に足し直す(`(map - 主点) + (描く幅 - 1) / 2`。縦は fx/fy も掛ける)。センサーの幅は 36mm × 描く幅 / 実写の幅、焦点距離は fx × 36 / 実写の幅。
- 実測(試し。k1 -0.12、1920 幅): 床の目印 平均 1.6 px・最大 4.2 px。歪みをかけないと足 6.8 px、舞台の端で 64 px ずれる。k1 -0.12 だと 1.09 倍以上広く描く。
- 校正の絵は ChArUco の盤が点の格子より強い(同じ歪みで rms 0.067 px 対 0.525 px。4K)。点の格子の自作は、向きの印が画面から切れると番号が付かず、面の取り違えも起きた。
- 全編の時間合わせは `ffmpeg -vf fps=30` の後の明るさで合わせれば時刻で読むので 29.97p でもずれない(-7.3 秒をぴったり)。コマ番号で数えると 83 秒で 1.5 コマずれる。

### 焦点距離の見積もり

- a7 III の 4K 30p は 1.2 倍クロップ(実質 mm = ズームの mm × 1.2)。LED の角と床の縁が画面の余り 1.5% で入る最短は、舞台の縁から 30p×24mm 12.3 m、24p×28mm 11.9 m、30p×28mm 14.7 m(高さ 1.5 m、計算はピンホール)。

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

## 確認用テスト映像と納品エンコード(11-03 に作って測った)

- 作り方: `show/media/make_test_pattern.py`(背景は 1 回だけ描き、コマごとに数字・動く線・同期の四角だけ差し替える。1800 コマが数分)。書き出しは `show/run/encode_led.sh <master> <wav か none> <出力> <名前>`。
- 中間のマスターは libx264 `-crf 0` の yuv444p10le(mkv)。インター予測が効いて小さい。FFV1 は全コマ独立なので大きくなる見込みで、試していない。rawvideo → ffmpeg には `scale=out_color_matrix=bt709:out_range=tv` を付けないと、色の行列が 601 のままになる。
- 測った値(RTX 5090、hevc_nvenc p7 tune hq、vbr cq16): 5680x1240・60p・30 秒の静的な絵で、.mov(音込み)は約 15 MB、H.264 mp4 は約 5 MB。ffprobe は `hevc,Main 10,5680,1240,yuv420p10le,60/1` と `pcm_s24le,48000,2`、コマ数 1800、音と映像の長さの差は 0 だった。
- ffprobe の `-show_entries stream=...  -of csv=p=0` は、要求した順でなく ffprobe の決まった順に出る。比べる文字列はこの順(codec,profile,width,height,pix_fmt,r_frame_rate)。
- Git Bash では、長い heredoc で python ファイルを作ると引用符で壊れることがあった。ファイルは Write で作る。
- 50% 灰色(値 128)は、HEVC の tv レンジを通すと約 126 で戻る。
- 幅 400px に縮めると、文字は 56px 以上でないと読めない。大きい A・B・C(640px)と赤い境目は読める。
- 未確認: 本物の LED の寸法・中央の面のつぶれ(写真が来てから)。

## ブラウザで全編の映像を 1 コマずつ作る(背景のシェーダー+キャラを 1 枚に)
- 道具: `show/led_browser/render_show.mjs`(`show_page.mjs`・`show_background.mjs`・`show_output.mjs`・`show_timing.mjs`)。台本は `show/show_motion.json`。全部をまとめて動かすのは `show/run/build_show.sh`。
- **送り出しに自動操作の道具(playwright / CDP)をつながない。** 5680×1240×4 バイト(28MB)の POST は、playwright をつなぐと 1 コマ 0.86 秒、Chrome を `--headless=new` で素のまま起動してページが自分で送ると 0.15 秒(実測)。ページの結果は `/result` へ POST で受ける。
- 速さの内訳の測定値: 描画 20〜40 ms、枠の測定 5 ms、送信 80〜130 ms。全体で 1 コマ約 0.12〜0.17 秒。FFV1 への書き込み自体は 1 コマ 33 ms で、律速ではなかった。
- **10bit で読む**: 素の WebGL2 で `RGB10_A2` の枠に描き、`readPixels(RGBA, UNSIGNED_INT_2_10_10_10_REV)` が ffmpeg の `x2bgr10le` とそのまま同じ並び。暗い面の段を防げる。読み出しの行は下から上なので、シェーダーで上下を返すと ffmpeg の vflip が要らない。
- RGB から Y'CbCr への変換は `scale=in_range=pc:out_color_matrix=bt709:out_range=tv` と明示する。指定しないと bt601 になる。
- master は FFV1(yuv444p10le)。途中の部品は `.nut` にする(止まっても読める。コマの刻みが正確)。`concat` の `outpoint` で切り、`.mov` へ `-c copy` でつなぐと `--from <コマ>` の続きができる。
- **同じ入力で同じ絵にするときの落とし穴**:
  - three の描画の側も `Math.random` を使う(内部の id)。キャラの分だけ乱数の流れを分けないと、描いたコマ数で視線やまばたきが変わる。
  - 動きの glb は読み込みが終わった順に並ぶ。名前の順に作り直す。
  - キャラの計算は前のコマの座標を読むので、描かないコマでも `scene.updateMatrixWorld()` を呼ぶ。
  - 直したあとの差(測定): 2 回描いて、10bit で最大 1、1 コマで違う値は 2,100 万個のうち 63 個まで。途中から(`--from`)でも同じ。残りの原因は未確認。
- キャラの大きさは、全部の動きを低解像度で先に流して枠を測り、自動で決める(5000 コマで約 5 秒)。曲や stretch が変わっても境目をまたがない。jump の大きさが高さを食うので、台本の `weight` で小さくすると、キャラを大きくできる。
- 暗い絵は線形の値で 0.01 以下まで落とす。sRGB に変えると 0.012 が約 12% に見えるので、最初の絵は全体が明るすぎて灰色に浮いた。
- 走る波の式は、繰り返しの継ぎ目で値がそろわないと、絵に縦の硬い線が出る。

### Bash の注意
- ツールの Bash で、ヒアドキュメントの中に対にならない `'` があると `unexpected EOF while looking for matching` で全部止まる。長いファイルは Write で書く。

## レンズ歪みの校正用「点の格子」(11-03)

- `show/media/make_calib_dots.py`: 黒地に直径 36 px の白い点を、A 面(x 80〜1200)と C 面の平らな部分(x 3120〜4240)に、80 px 間隔で 15 列 × 14 行。各面の左上だけ直径 64 px の印。面ごとに 210 点、白の面積は全体の 6.5%。
- C 面の平らな部分は `stage_layout.py` の `C_FLAT` 500 cm ÷ 画素の比(2641 px / 1056 cm)で約 1250 px、つまり x 3039〜約 4290。点はその手前の 4240 まで。
- HEVC を通した .mov の 1 コマで、`SimpleBlobDetector`(面積 300〜4000、円形度 0.8)が A・C とも 210 点を全部検出。B 面は 0 点。`findCirclesGrid((15,14), SYMMETRIC)` も両面で成功(向きの印の大きい点があっても通った)。
- 静止画は `ffmpeg -loop 1 -framerate 60 -i png -t 20` でマスターにし、encode_led.sh へ。音は `none`(無音の PCM が付く)。
- m の値は、パネル 32x16 cm の仕様値からの計算で、本物の寸法は未確認。

## 外の .vrm を LED の絵で試し描き(11-03 測定)
- `node show/led_browser/render_show.mjs --timeline <timeline.json> --character-file <.vrm> --stretch 1.48 --at 40 --seconds 3 --out <フォルダ>`。ファイルは `/show-data/character.vrm` で配られる(リポジトリの外のファイルが読める)。`--at` は timeline の絶対の秒。
- 人型は高さで倍率が決まる(VRM v1m1: 1.95、高さ律速。パネルくんは幅律速 1.70)。3 秒の描画は下調べ込みで約 40 秒(VRM)。
- VRM の動きは gestures.js の nod/bow/wave/think/tilt/shake/shrug/point だけ。show_motion.json の jump は `play` が false を返して無視される(読みかえは未設定)。
- 口は mouth 0.28 でもほぼ開いて見える(v1m1 の aa が強い)。完全に閉じた絵は mouth=0 の区間(song の外)で確かめる。

### 長い描画の止まり(測って分かったこと)
- 28MB の POST を 1 ページで続けると、929 コマ目で Chrome の描画プロセスがメモリ不足で落ちた(`Crashpad/reports` の .dmp の例外コード `0xe0000008`、`ptype=renderer`)。親の Chrome は生きたままなので、ffmpeg も node も待ち続け、エラーが出ない。
- 見分け方: ffmpeg の `ReadTransferCount` がちょうどコマの倍数(途中で詰まったのではない)、node に確立した接続が無い、生きている描画プロセスの CPU 時間がほぼ 0。
- 直し方: 500 コマごとに Chrome を開き直す(5,958 コマで開き直し 12 回、1 コマ 0.187 秒)。60 秒新しいコマが来なければ止めて続きから、最大 3 回。1 コマぶんを全部受けてから ffmpeg へ書くと、途中で落ちてもコマがずれない。進み具合は 1 分ごとに `progress.txt` へ。
- ページのファイルは最初に読んだ内容を配り続ける。開き直しのたびにディスクから読むと、描画中の直しが途中から混ざる。
- 音圧のそろった曲は、音の強さだけでサビが分からない(実測 0.8〜0.9 で平ら)。曲の構成の秒を台本に書く。
- 口の入力も高い値に集まる(歌の中央値 0.93)。そのまま使うと開きっぱなしになるので、べき乗で差を広げる。
- 人型の寄りは、頭の位置を決めて太ももの位置から倍率を計算する。腕が境目を越える分は倍率で抑える。サビで大きく横へ腕を出す動きは倍率を食う。

## VRM の手続きの踊り(`show/led_browser/show_vrm_dance.mjs`、11-03 測定)
- 呼び方: `createDance(vrm, timeline)` と `danceInput(timeline, frame)`。`vrm.update` を包み、揺れ物の計算より先に `dance.apply` で骨を書く(全身と腰の位置を上書き。目と顔は触らない)。show_motion.json の bounce・turn_deg・play は二重になるので切る。
- 状態を持たず t だけで姿勢が決まる。重なる section(せりふが曲のイントロに乗る)は重ならない並びに直し、切り替わりは前の場面の姿勢も同じ t で計算して混ぜる。同じコマを 2 回書いた差は 0.000003 度。
- 計算は 1 コマ平均 0.03〜0.04 ms。全部の骨を四元数で解き、物を作らない。
- 正規化の骨の向き(実機で確認、VRM 1.0): 前屈 +X、キャラの右へ傾く +Z、キャラの左を向く +Y、左腕を下げる −Z、肘は左 −Y・右 +Y、膝は +X。VRM 0.x は向きが違うので止める。
- 腕は手首の位置と肘の向きで解く 2 本骨。肘の曲げ軸から上腕・前腕の向きを作ると、肘は決まった向きにしか曲がらず、手のひらも自然な向きになる(ねじりの補正はほとんど要らない)。脚も同じ解き方で足を床に固定し、足の高さのずれは最大 0.00003 cm。
- 腕の下限(別に測ったスカートとの距離 + 揺れの余裕 5°): 肘を伸ばして横なら真下から 35°、肘を 45° 曲げて前に出すなら 15°。腰に手を当てる形は肘を 75° 以上開かないと食い込むので使わない。全コマで手・肘と胴・スカートの頂点の距離は 6.6 cm 以上。
- 重心の曲線に `|sin|^0.7` のような形を使うと、0 をまたぐ所の傾きが無限になり、上腕が 1 コマ 27.7° 跳ぶ。`sin x + 0.16 sin 3x` に変えた。腕を左右へ切り替える量を重心の値で作ると 0.14 秒で振り切るので、切り替えは 2 拍に広げる(21.9° → 10°)。1 コマの回転を骨ごとに記録して、時刻が拍と一緒に繰り返す所を探すと、原因がすぐ分かる。
- 脚が伸びきる近くは腰の小さな動きで膝が速く動く(1 コマ 9.9°)ので、曲の間は腰を 1.4 cm ほど深く落としておく。
- 前へ差し出す指さしは、正面の絵で腕が縮んで「頭の横の手」に見える。外へ開く。ハートはピンクの衣装の前だと読めないので肌の前へ上げる。ただし口を隠さない高さ(手首 1.295 m)。立ち姿は腕を真下から離すだけだと案山子に見えるので、肘を曲げて手を前へ出す。
- 揺れ物は 1/60 秒の固定で静かだった(揺れ物の骨の動きは 1 コマ最大 1.7 cm)。
- 判定 AI の使い分け: 静止画では、跳ねや重心の移動を「無い」と言い、胸の前の手を「めり込み」と言うことがある。頂点の距離の数字と照らして分ける。ハート・指さし・一礼の読みにくさの指摘は当たっていた。

## 何体ものゆるキャラを LED で踊らせる(`show/led_browser/yuru_*`、11-03 測定)
- 1 枚の不透明の絵に、背景 1 回 + キャラごとに 1 回描く。キャラごとにカメラを持ち、投影行列の `e[0]` `e[5]` `e[8]` `e[9]` で大きさ・横の伸ばし・位置を変える(物は全部原点に置いたまま)。`autoClear = false`、キャラの間で `clearDepth`。B 面のキャラだけ `e[0]` に stretch を掛けるので、A・C 面と同じ場面で混ぜられる。
- 動きをコマ番号だけで決める: 全部の動きを `LoopRepeat` で再生の状態にして、毎コマ `action.time` と重みを入れ、`mixer.update(0)`。rig の `_apply` は idle と talk の重みを書くので、呼ぶ間だけ `character.actions` を空の Map に差しかえる(表情・まばたき・視線はそのまま効く)。途中のコマから描いても同じ絵で、0 コマ目から計算し直さなくてよい。別の開き直しで描いた同じコマの差は、5680×1240 のうち 10 画素(8bit で 4 を超えた画素)。開き直しの境目の差は、隣のコマどうしの差と同じ程度。
- 骨に手で足す腕の回転は、次のコマの前に「動きだけの値」へ戻す(ミキサーは値が前と同じだと骨に書かないので、積み上がる)。
- 面の幅をキャラの枠の広さに比べて分けると、等分より大きくできる(5 体で倍率 0.90 → 1.02、高さ 452 → 512 px)。B 面に 3 体だと 269 px まで小さくなったので、A 2・B 2・C 1 にした。
- 下調べは 1/4 の絵で 2 コマに 1 回、5 体で 23 秒。枠は 4 px の誤差。毛の殻つき 5 体で、全編 4,339 コマ(うち絵のあるコマ 1,339)が 1 コマ平均 0.204 秒(ほかの描画と重なると 0.238 秒)、開き直し 9 回、再開 0 回。
- 失敗: 着地のつぶれを `exp(-p)` だけで作ると、拍の頭で 1 コマに 15〜30% つぶれて、絵の上の端が 148 px とぶ。静止画と判定 AI では見えない。枠のコマ間の移動を数字で見て気づいた。立ち上がりを 0.1 拍にして 68 px に抑えた。腕も決めの頭で 1 コマに 1.1 ラジアン動いていた。
- 失敗: 背景を明るい昼にしたら平均の明るさが 178/255(同期のフラッシュ 179 と同じ)で、上限 150 を超えた。背景だけ全体を線形で 0.62 倍(キャラは後から描くので暗くならない)にして最大 147.7、白飛び 0.002%。
- 音楽 AI の曲の拍(`show_beats.py`)は一定 BPM の格子なので、揺れのある曲でもならす処理は要らない。全体の BPM 測定 143.2 に対して、イントロだけでは 139.8 で、低音の立ち上がりに合った。切り出す区間で測り直す。

## UE 5.8 を別の PC へ「最小の写し」で入れる(11-03、リアルタイムの現地用)
- 要る物だけ: `Engine\Binaries\Win64`(.pdb・UnrealGame*・Switchboard 等を除く)、`Binaries\ThirdParty`(DotNet・Mac・Linux 等を除く)、`Content`・`Config`・`Shaders`・`Programs`・`Build`・`Platforms`、`Extras\Redist\en-us\vc_redist.x64.exe`、**使うプラグインだけ**。
- プラグインの選び方: 一度動かした `ue.log` の `Mounting Engine plugin <名前>` を集め(-game で 265 本)、その .uplugin のフォルダを Source・Intermediate・.pdb・.lib を除いて写す。45GB → 2.1GB。DotNET と Source は不要。
- **`Engine\DerivedDataCache\Compressed.ddp`(1.7GB)は必須級**。無いと初回のシェーダー作りで UE の用意が 240 秒を超えて run_live が落ちる。入れると用意 47〜52 秒。
- 合計: 展開後 約 8.2GB(ddp 込み)、tar(圧縮なし)8.3GB。Epic のログイン・ランチャーは要らない(ログに EOS・ログインの行なし)。EngineAssociation 5.8 のままで、exe を直接呼べば開く。
- 確かめ: `UnrealEditor-Cmd -run=pythonscript -nullrhi` で L_Live が読める(actors=273)。`run_live.py try` 720p で UE 59.6 fps、ブラウザ 55 fps。UE 同梱の Python 3.11(`ThirdParty\Python3\Win64\python.exe`)で run_live.py が動く。websockets は wheel を zip として広げて `PYTHONPATH` に(pip 不要)。
- 落とし穴: bash の heredoc は `\t` を壊す(`System32\tar.exe`)。Windows 標準の tar.exe で作った tar を同じ tar.exe で広げた(新しい場所への展開 + 起動.bat で 115 秒で起動)。LiveCodingConsole.exe が無いとログに Error が 1 行出る(動作には無関係。入れた)。
- 判定 AI(DeepSeek)は、たすきの文字を読み誤り、静止画では動きの不具合が分からなかった。つばの欠けのような指摘は、寄りの絵で自分でも確かめる。

### 全編の組み立ての実測(5680×1240・60p・7,646 コマ・VRM)
- 描画: キャラあり 1,411 秒(1 コマ 0.185 秒)、キャラなし 1,280 秒(0.167 秒)。2 本を並べても開き直し 16 回、見張りでの再開 0 回。書き出しは 1 本で、HEVC 約 7 分、H.264 約 6 分、プレビュー約 7 分(ほかの処理と重なった値)。確かめは最大 9 分。
- 白飛びは背景でなくキャラの光で起きていた(白飛びの画素は全部キャラの範囲)。背景を弱めても 1.32% のまま、VRM の光を 0.8 倍にして 0.82%。場所を測ってから直す。
- 灯る演出: 灯るまで全面の絵を 0 にし、歌声の直前の小節の頭で、半径を拍で広げるマスクと光の先頭の輪を足す。sRGB では光の裾が遠くまで見えるので、半径を小さく感じても面全体が光る。
- `sync_flash.py` は本編の明るい所も立ち上がりとして拾う(19 回のうち 7 回)。2 本の動画に同じように入るので、対は取れる(残差 0.02 ms)。
- VRM の口が動かないときは、先に表情を疑う。happy を 1.0 にしていると、入力 0.3 と 1.0 の差がほとんど見えなかった。土台を 0.2 以下にすると差が出た(口の曲線 gain 0.95・power 2)。標準でない表情は `CharacterBase` の土台から渡らないので、`vrm.update` の前に自分で `setValue` する。

### LED の絵と同じ動きのキャラを UE へ(11-03)
- `show/run/sample_into_ue.sh <並べ方の json> [名前]`。描画ページの骨の数字(揺れ物と顔の形まで)を VRM の glb に動きとして足し、合成とリアルタイムの 2 つのプロジェクトへ入れる。VRM4U も Blender も要らない。7,646 コマの書き出しが 3.8 秒、全部で 57 秒。
- glb のメッシュは 1 つにまとめる。顔の形のない部分には空の形を足して数をそろえる(分けたままだと 5 つの骨付きメッシュで入る)。
- 骨の材質の決まり: 顔の形を持つメッシュへ当てる自作の材質には `used_with_morph_targets` が要る(無いと既定の材質に戻り、透明の絵が空になる)。透明の材質は両面にする(スカートの裏が抜ける)。
- Git Bash から環境変数で `/Game/...` を渡すとパスに書き換えられる。名前だけ渡して中で組み立てる。
- シーケンスで全編と同じ時刻に動かすには、スケルタルアニメーションのセクションの `first_loop_start_frame_offset` に `(全編の秒 − LEAD_FRAMES / FPS) × 24000` を入れる。
- リアルタイムは、LED の映像の時刻に 1 秒ごとに動きをそろえる(差 0.15 秒を超えたら `set_position`)。最小の UE でも動いた(720p、中央値 59 fps、送ってから絵まで中央値 84 ms)。

## LED の絵そのものを UE で描く(11-03。`show/ue/build_led_theatre.py`、`led_plan.py`、`led_venue.py`、`show/run/render_led_ue.py`、確かめは `show/check/check_led_ue.py`)
- **カメラ:** 正方形の画素の 3838×1240 で描き、ffmpeg で 5680 に伸ばす。CineCamera の filmback の `sensor_horizontal_offset` / `sensor_vertical_offset` は 5.8 の Python で触れて、`-game` の MRQ でも効いた(大きく描いて切る必要なし)。式: ずらし mm = (描く幅/2 − 中心 x)/(描く幅/2) × センサー幅/2。縦は (中心 y − 高さ/2)/(高さ/2) × センサー高/2。どちらも正で消失点が左・下へ動く。
- ブラウザ版(fov 14 の射影行列)と同じ写りにする値: f_px = 1/tan(7°) × (397/500) × 620 = 4009.3、距離 = 1/tan(7°) × 身長 × 1.24 = 1761.8 cm(身長 174.45 cm)、カメラの高さ = 身長/2、水平に見る。測定: 足 1 px、身長 2 px、中心 x 1.41 px 以内(547 コマ)。
- **glTF の親 `MI_Unlit_Opaque_DS` はモーフのフラグが無い。** `-game` で顔だけ既定の材質に戻る(灰・白・黒)。ログ `missing usage flag MorphTargets`。`show/ue/character_materials.py` の `character_slots(mesh)` で、自前の親(無照明、両面、`used_with_morph_targets`、`used_with_skeletal_mesh`)の MI に替える。LED と合成(`build_comp.py`)の両方がこれを使う。 合成の短い試し(240 コマ)で、6 パスのログの `missing usage flag` は 0 件。顔は頭の帯の肌色の画素で見分けられる(髪の青緑と帽子のピンクを除く)。頭の中の色は with と合成で確かめる。
- **材質トラック:** `MovieSceneComponentMaterialTrack` → `set_material_index(0)` → `add_section()` → `add_scalar_parameter_key(MaterialParameterInfo, FrameNumber, 値, "", "", 補間)`。**時刻は tick**(コマ × 24000 / fps)。チャンネルの `add_key` はコマなのに、こちらは違う。コマのまま渡すと全部のキーが頭に固まり、エラーも出ない。
- 光のキーは、最初のキーの 1 コマ前に必ず 0 を置く。無いと最初のキーの値が手前へ伸びて全編光りっぱなしになる。
- **シーンキャプチャは `-game` の MRQ でそのまま撮れる。** `capture_every_frame`、RT は RGBA16F、`SCS_FINAL_COLOR_HDR`、材質は `SAMPLERTYPE_LINEAR_COLOR`。露出は capture の `post_process_settings` に手で入れる(blend weight 1)。Fog・VolumetricFog・Lumen の show flag を切ると軽い。
- キャラが舞台の外にいる間もアップを撮るので、視野から遠い所(x=-30000)に複製のキャラを置く「撮影所」にする。複製は `ALWAYS_TICK_POSE_AND_REFRESH_BONES`。頭の位置はシーケンスより先に `AnimPoseExtensions.get_anim_pose_at_time` + `get_bone_pose(..., WORLD)` で取り、カメラはコマごとのキーにする。
- **Niagara:** `MovieSceneNiagaraSystemTrack`(部品の結びつきに足す)→ `add_section()`、`section_start_behavior` ACTIVATE。エンジンの `/Niagara/DefaultAssets/Templates/Systems/RadialBurst` が `-game` の MRQ で撮れた。**同じトラックに区間を並べると最初の区間しか発火しなかった**(測定: 2 番目以降の 73.4 秒、左右の 55.2 秒は粒が 0)。発火ごとに 1 体ずつ置く形に直すと出た(左の粒の場所の細かい点の数: 発火前 54、18 コマ後 2903)。
- 枠に合わせたスクリーン: カメラの式で「絵の矩形 → その奥行きの世界の矩形」を計算し、カメラに平行な板を置く。測定: 目標 x 40〜940、y 190〜696 に対して x 38〜941、y 189〜697。
- 待ちの間に前の撮影の連番が残っていると、コマ数の確認が落ちる。範囲の番号のファイルだけを数える。ファイル名は `f.{frame_number}` で全編のコマ番号にすると、ブラウザ版の枠と直接比べられる。
- 速さ: 3838×1240、spatial 4、Lumen、影ありライト 8 灯、キャプチャ 2 本で 1 コマ 0.125〜0.156 秒(CC5 と重なると遅い方)。起動は 15 秒ほど。組み立て 7〜12 秒。png は 1 コマ約 4 MB。
- ヘイズの強さ: 密度 0.02(キーで最大 0.04)、ビーム 1100 cd、`volumetric_scattering_intensity` 30。密度 0.1・1800 cd・散乱 45 は全体が白く霞んで絵が消えた。
- UE に入った動きは 24 fps に間引かれている(`get_num_frames` 3058 / 127.42 秒)。LED と見比べて口や速い動きが気になるときは、取り込みの設定から疑う(未確かめ)。
- ブラウザ版のキャラは `enter` で下から上がり、`outro` の終わりで消える(`characterVisible`)。`led_character` だけを見ると 107.43〜112 秒に余分に出る。

## 計算の効果の層と重ねる道具(`show/fx/`、11-04 に測定)
- 構成: `audio_hits.py`(音から打点)→ `fx_plan.py`(コマごとの表)→ `fx_layers.py`(torch の絵)→ `compose_led.py`(背景・効果・キャラ・左右のアップを重ねて ProRes か連番)。測るのは `fx_measure.py`、試験は `test_fx.py`(音と GPU なしで動く)。torch が要る(作業用 PC は `work/AI/venv-sep`)。
- 秒は timeline・show_stage・任意の `--cues`(電球の灯る音、コールの打点、最後の決め)だけから読む。曲が替わってもコードを変えない。電球の位置は `--bulbs`。背景の額縁が決まったら合わせる。
- コマ番号だけで絵が決まる作りにする(全編の表を先に作る。前のコマを覚えない)。途中のコマから描いても同じ絵になる。
- **timeline の energy は音圧のそろった曲で平ら**(54.8〜64 秒で 0.84〜0.96)で、強弱を分けられない。伴奏の wav(`karaoke.wav`)の帯ごとの振幅の増え(30〜150 Hz、1.2〜5 kHz、6〜16 kHz)を取り、帯の中の順位にした。127 秒の曲で 1 秒かからない。強いキックと拍の差は中央値 13.5 ms。クラッシュはハイハットと分けるために 0.25 秒の鳴り残りの比を掛ける。`drums.wav` があれば優先(未試験)。
- 反応は順位の上位だけ強くする(上位 30% だけ 0.25〜1.0、残りは 0.1 以下)。測定: 決めの外で強い音 13 件を全部押せた、増えの中央値は強い音 8.76、弱い音 0.78(0〜255)。
- 測定の値(5680×1240、RTX 5090、54.8〜64 秒の 552 コマ): 効果だけ 1 コマ中央値 0.089 秒、重ねた版 0.150 秒(平均 0.151、静止画の背景と黒地のキャラの png、ProRes へ渡すまで)。ProRes 422 HQ は 1 コマ約 3 MB。動く背景と左右のアップの読み込みの分は未測定。
- 光の差: 強い音との差の絶対値の中央値 5.4 ms、決めの外 4.6 ms。拍全部では 15.8 ms(弱い拍はほとんど動かないので、測る値にばらつきが出る)。コマの幅が 16.7 ms なので、これより小さい差は測りの限界に近い。
- 明るさ: 平均の最大 59.4 / 255、純白 0%(黒地の仮のキャラは色を塗った値)。上限 105 の制限は一度も働かなかった。
- 3 コマの決まり: 立ち上がりを 3 コマにして、真ん中を打点に置く。全体の明るさの山は半分の高さで全部 3 コマ以上。下の帯に幅 2 コマの山が 2 つ(3505、3553)あるが、高さ 1〜2 の小さなこぶで、本体の立ち上がりではない。
### 見た目で失敗したこと(どれも静止画を見て直した)
- 流れ落ちる光を同じ太さの棒にすると櫛に見える。太さ・長さ・落ち方・強さをそろえない。霞を強く掛けると炎に見え、暗い穴も開く(0.5 → 0.16)。流れの上の端を硬く切ると階段が出る。
- 直線の光で青緑とピンクを足すと灰色に濁る。同じ所に重ねない(`pink *= 1 - teal`)。暗い金は茶色・黄土色になる。柱は青緑とピンクだけにし、金は粒・電球・決めの光に残した。全面を同じ金で塗るとのっぺりするので、下に寄せて大きな波で濃淡を付ける。薄い暖色の丸も灰色に見えたのでピンクを混ぜた。
- 粒 150 個は星空に見えた。70 個 + 大きくぼけた粒 18 個にした。
- 残光を区間で切らないと、黒のはずの区間に漏れる。最後に全体へ関門を掛ける(試験で見つけた)。
- 暗いなめらかな面は 8bit で段が出るので、三角分布の揺らぎを足す。
### 落とし穴
- 左右のアップの透明の絵を測るとき、A・C 面の平均には左右のスクリーンが入る。隠れない所(x 945〜1279、4290〜5680)だけを測る。
- 背景の仮の絵(中心が絵の真ん中)は `--bg-center-src 0.5` で中心だけを x=2159 へ寄せられる。左右で伸びが変わるので試し用。
- GPU の札は順番待ちが続くことがある。CPU でも 1/4 の絵なら 1 コマ 0.03〜0.12 秒で、測定の数字は原寸とほぼ同じだった(強い音 86.4%・平均の最大 59.42、原寸 59.44)。絵と秒の詰めは CPU で進められる。

## キャラとアップだけを透明つきの層で撮る(11-04。`show/ue/led_layers.py`、`show/run/render_led_ue.py --look --layer`、後始末 `show/run/led_layers_post.py`、確かめ `show/check/check_led_layers.py`)
- **本物の透明は設定ファイルを変えずに出せる。** 起動の引数 `-ini:Engine:[/Script/Engine.RendererSettings]:r.PostProcessing.PropagateAlpha=True`(ログに `Set CVar [[r.PostProcessing.PropagateAlpha:1]]`)+ `MoviePipelineDeferredPassBase` の `accumulator_includes_alpha` True + レベルに空と霧を置かない。無照明も DefaultLit も被写界深度も崩れない。
- **MRQ の透明つき PNG は、直線の値に透明が掛かった形で sRGB になっている**(不透明 223 のとき透明 0.5 で 173)。そのまま重ねると縁が黒い。直線に戻して透明で割り、sRGB に戻す(`led_layers_post.py straight`)。透明の値は直線の割合。
- 測定: キャラの足・身長・中心 x は透明の 128 で測って 1 / 2 / 1.89 px(240 コマ)。黒地の白キャラの測定と同じ範囲。`check_led_ue.py --alpha`。
- このキャラの材質は全部 OPAQUE(glb の alphaMode)。髪の縁の半透明は面の縁の spatial 8 の被覆だけで、髪の板自体に透明は無い。
- **60 fps の取り込み:** glb は 7,646 コマあるのに自動だと 24 fps(3058 コマ)に間引かれる。`DefaultGLTFAssetsPipeline` を `duplicate_loaded_asset` で /Game に写し(コマンドレットでは /Interchange は登録に載らないので `duplicate_asset` は失敗する。`load_asset` は通る)、`animation_pipeline` の `custom_bone_animation_sample_rate`=60、`frame_alignment`=`InterchangeFrameAlignment.SNAP_TO_CLOSEST`(無いと「長さ 127.417 は 60 fps と互換性がない」で動きが作られない)。`ImportAssetParameters.override_pipelines` に渡し、`InterchangeManager.get_interchange_manager_scripted().import_asset`。結果 7,645 コマ。資産は入れる glb の名前のフォルダに入るので、glb を `sample_show60.glb` に写してから入れる。
- ただし 54.8〜58.8 秒の頭の動きの 2 階差は、前後で差が出なかった(RMS 0.081 と 0.083 px。ゆっくりした区間では 24 fps の直線補間と見分けられない)。速い動きでの差は未確かめ。
- **光のキーは Material Parameter Collection が楽。** `MovieSceneMaterialParameterCollectionTrack` に `mpc` を入れ、`add_section()`、`section.add_scalar_parameter_key(名前, FrameNumber(tick), 値, 補間)`(部品の材質トラックと違い名前で受ける。4 引数)。材質は `MaterialExpressionCollectionParameter`。`-game` の MRQ で効いた。
- `-run=pythonscript -script=` では `__main__` がそのファイルにならない。`sys.modules[__name__]` は使えない。`types.SimpleNamespace(**globals())` で渡す。
- **見た目の比べ:** 無照明 + 計算の陰と輪郭(案 A)はテクスチャの色がきれいに出るが、体は平ら。本物のライト(案 B: emissive 0.75、主 170 cd、輪郭 620 cd)はスカートに奥行きが出るが、顔の寄りでは鼻がテカり肌が飛ぶ。**全身は B、アップは A に分けた**(`led_plan.CLOSE_LOOK`)。最初の B(主 1400 cd、輪郭 5200 cd、emissive 0.55)は全体が白く飛んだ。tone_curve 0 で色はテクスチャのまま、光は足すとすぐ飽和する。
- 暖かい光でテクスチャを割ると、青緑の髪が緑に転ぶ。主の光の暖色は (1.03, 0.97, 0.88) まで弱める。金は輪郭の光に持たせる。
- 瞳は頭のテクスチャの (0.2258, 0.857) と (0.952, 0.669)(後者は上下逆)。UV で足すハイライトはまばたきのまぶたに隠れる。
- 被写界深度: f/1.2 と f/0.7 はアップ全体が眠く見えた。顔 f/2.8、バスト f/1.6 にした。焦点の距離は `FocusSettings.ManualFocusDistance` の float トラックで毎コマ打つ。
- **影の層:** キャラに `render_in_main_pass` False と `cast_hidden_shadow` True、灰色の床だけを撮り、キャラのいないコマとの直線の比で透明にする。カメラの高さ 87 cm は床すれすれなので影は細い線になる。そのままだと黒く硬い線に見えるので、薄め 0.6・ぼかし 5 px を足した(y 1137〜1200)。
- **映り込みの層:** 複製を scale z=-1 で撮るだけ(トラックの既定値にも -1 を入れる)。足の線 y=1198 より下だけ残して薄める。**絵の下の端まで 42 px しかなく、B 面は y 1218 までなので見えるのは 20 px。** 本物の床の反射のほうが主役。
- 速さ: 3838×1240、spatial 8。本番の 552 コマで キャラ 0.204 秒、映り込み 0.221 秒、影 0.213 秒(別の UE が札なしで同時に動いていたので、遅めに出ている)。短い試しは 0.03〜0.05 秒。アップ 900×506 は 0.027〜0.061 秒。起動は 12〜15 秒。後始末は 552 コマ × 3 層 + 204 × 2 と確かめで約 6 分。

## 閉じる → 開く と「LED から舞台へ出る」(11-04 朝の見本。`show/fx/stage_plates.py`、`stage_open.py`、`compose_led.py --bg-open --open-plates --shadow-dir --reflect-dir`、`composite.py --exit --exit-lift --exit-land --led-video`)
- **動かす Python は `work/AI/venv-sep`。** `ue_show/venv_audio` は torch はあるが cv2 が無い。
- **額縁は色で分ける:** 赤い幕には緑がほとんど無いので、緑のチャンネルのしきい値(12)だけで額縁・ひも・電球がきれいに分かれた。暖色の判定(色相)では途切れた。電球は金属に無い青のチャンネルの山で拾う(明るさで拾うと額縁の反射を数える。49 個全部)。
- **開いた絵を額縁に合わせる:** 電球の組の薄板スプライン(1/8 の表)。組の範囲 20 px で 45 組。測定: 開く前後の電球のずれ、額縁 平均 0.45・最大 0.9 px、ひも 最大 4.9 px。開く間の額縁の跳び 0.25 px。組の範囲を 40 px にすると、開いた絵のボケ球と組になって 27 px ずれた。
- **幕の開き方:** 額縁・ひもは固定、幕の下地は額縁と電球の光の輪を消した絵(輪が幕と一緒に動く。消す範囲は 61〜71 px)。開口の中は割れて足へ詰まり、外は滑って出る、床は中心から広がる。幕の上の黒い所で境目を硬くすると、開いた絵の縦の切れ目が見える(ぼかしを 1100 px まで広げた)。
- **両脇の持ち上げ:** 幕だけ sRGB のべき乗 0.62(額縁は変えない)。A6 の A 面 4.83 → 11.92、C 面 4.19 → 8.99、全体 10.05 → 17.41。効果を足して A 13.4〜15.0、C 11.5〜12.2。
- **足から移す:** LED のキャラを足から消し(後半は全体を薄く)、同じ秒に舞台のキャラを足から出す。合成の側は有り無しの差の外(`with - without`)が床の映り込みなので、`clip(alpha*8)` で分けないと映り込みが二重に強く出た。
- **LED の足と床の足の高さは違う:** LED の足 y=1198 は床より上にあるので、同じ位置に立たせても、舞台のキャラは 1920 幅で約 12 px 低く見え、頭が二重になった。出る間だけ 12 px 持ち上げ、59.2 秒の拍へ落として「着地」にした(だんだん速く)。カメラと距離で値が変わる。
- 舞台のキャラの縁の光: 面の平均の色は青緑とピンクが混ざって灰色に寄るので、最小の色を引いて色の差だけにする。LED の中央が暗い秒は、ほとんど見えない。
- 流れ落ちる光を本物の電球の座標につなぐときは、ずらさず、幅 18〜52 px に細くする(70〜190 px は幕の上で茶色のもやになった)。
- 測定(5680×1240、RTX 5090、動く背景 2 本 + 透明つき 3 層 + アップ): 1 コマ 0.36〜0.39 秒、552 コマ 約 3.5 分。ProRes は 1 本 1.8 GB。舞台の素材 6 パス(276 コマ)と組み立てで 約 5 分、重ねは CPU で 約 4 分(276 コマ)。緞帳の計算の動きは 312 コマ 168 秒(CPU)。
- **札のつまずき:** `--kind video` を長く待たせている間は、同じスレッドの `--kind gpu` や `ue` も「先に待っている 動画の生成」の後ろに回って取れない。待たせる前に、先に済ませる。ヒアドキュメント内の cwd とファイル名は、`_h3cmp.jpg` のように失敗しても -v error だと気づきにくい(出力を ls で確かめる)。

### 「LED から踏み出した」に見せる引き継ぎ(11-04 朝の直し。判定 2 つの指摘から。`compose_led.py`、`composite.py --exit --exit-lift --exit-hop --exit-land --stats`)
- **同じ形の 2 体を同じ位置で重ねると、光の帯が上がるだけで「現れた」にしか読めない。** 空間の差を入れると読める: 舞台のキャラは引き継ぎの間に前へ 200 cm、横へ 38 cm 動き(0.86 秒、`ar_path` に 1 キー足す)、合成の弧で着地の拍へ落ちる。LED のキャラは奥に残り、出る秒の手前 0.25 秒から後 0.25 秒で薄れる。横にずらすと、奥に残るキャラが見えて 2 体の距離が分かる。
- LED の層は「出る」の秒で終わる。最後のコマを保って薄れさせれば、撮り直しは要らなかった(`FxPlan.held_frame`)。
- **消す形をやめる:** LED のキャラを足から消すと、薄い透明と光が混ざって濁った塊になった。体は消さず、細い光の線(σ6 px、半値幅 10 px。LED で身長の 3.8%、面積最大 3.86%。舞台で太さ 2.7%、面積 4.0%)だけを通す。
- **着地の重さ:** 靴の真下に短い影を、映り込みごと暗くする(直線で掛ける。映り込みの足元は少し下から始める)。測り方は足の下 2〜7 px の平均と横 40 px の床の比。映り込みの上に影を置く前は、足元のほうが明るかった(-42%)。直して 36〜50% 暗い。着いた直後だけ一段濃く、宙にいる間は薄く広くした。
- LED 側の発光は着地の前に弱め(足元の光の減衰 0.55 → 0.16 秒、出るの輪と光を半分)、床の光は着地の拍に足元から 1 回だけ広げる。着地の秒は `beats` の「出る」+0.3 秒より後の最初の拍(cues の `landings` で変えられる)。平均の明るさの最大が 55 → 48〜50 に下がった。
- 舞台のキャラのなじませ: 直線で明るさ 0.76、彩度 0.88。色と透明を σ0.7 px でぼかし、透明 12% 以下を捨てる。縁の光は 0.9 → 0.32。LED の層も、横 1.48 倍の bicubic が縁に明るい線を作っていたので直線の補間にした。
- 流れ落ちる光は、下へ細く薄くする(幅を下の端で 0.2 倍、明るさを 0.3 倍)。式が分離できなくなるので 1 本ずつ 2 次元で足す(短い区間だけなので遅くならなかった)。山の明るさ(幕の上の差の 99.5 パーセンタイル)78 → 49。
- 測り方の落とし穴: `exit_progress` は浮動小数で 0.99999 になる(丸めた)。舞台のキャラの最初のコマは透明が無いので、コマの範囲を確かめる。

### 引き継ぎの 3 回目: カメラの軸に沿った動きでは 2 人が離れて見えない(11-04 朝)
- 前へ 200 cm + 横へ 38 cm は、正面 16 m ほどのカメラからはほぼ重なり、スカートが膨らんだ 1 人に見えた。静止のコマの列では気づきにくい。**30 コマ毎秒で続けて並べて見る。**
- 横を 100 cm に増やすと、1 コマ目から 2 人に見える。頭の離れが身長の 25%(肩幅の控えめな見積もり)以上で 2 人とも見える時間が 0.37 秒(58.73〜59.07 秒)。**足から現れる長さを 0.45 → 0.30 秒に短くし、LED のキャラは「出る」の 0.05 秒後から 0.42 秒後まで**で薄れる(薄れる間は 9 コマ)。
- 測り方(`morning_1104\_measure_sep.py` の形): LED のキャラの頭は `truth.json` のカメラで世界の点を投影し、舞台のキャラの頭は透明の上 14% の中心。出る前のコマ(108)で 2 つの差が 0.7 px なので投影は合っている。肩幅を透明の幅から測ると腕や髪で 11〜24 px と揺れるので、身長の 25% を使った。足の位置は一番下の 3% の中心なので、足が入れ替わるコマで 11 px ほど跳んで見える(頭の横の差は最大 8.5 px で滑らか)。
- 床の光の始まりは、足元の LED 上の位置を `cues` の `landing_x` で渡す(ここでは 1710)。
- 跳ぶ 0.42 秒の間、LED のキャラは「出る」の前の最後のコマで止まる。層は撮り直さずに済むが、薄れながら止まっていることになる(動いたまま残すなら層を伸ばして撮り直す)。
