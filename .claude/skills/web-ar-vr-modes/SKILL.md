---
name: web-ar-vr-modes
description: 同じ three.js ページを、画面・iPhone の AR(自作の殻アプリ)・Quest 3 の AR/VR で動かす切りかえ(place/web/modes.js)の使い方と、実機が無くても試せるやり方、調べて分かった制約。web/ に AR/VR を足す・殻アプリを直す・偽の殻で通し試験を書くときに使う。
---

# 画面 / AR / VR の切りかえ

## 呼び方(web/ 側)
```js
const modes = await createPresentation({ renderer, scene, camera, place, background, onViewer, onHit, onFloor, onChange });
mountModeButtons({ modes, container });
renderer.setAnimationLoop(() => { modes.frame(); renderer.render(scene, camera); });
// 殻の中なら: if (modes.available.ar_kind === 'native') await modes.enter('ar');
```
- `modes.available` = `{screen, ar, vr, ar_kind: 'webxr'|'native'|null}`。iPhone の Safari では ar も vr も false(WebXR が無いため)。殻の中だけ `native`。
- 入ると `<html data-presentation="ar|vr|screen">` が付き、AR では html と body の背景が透明(紫のグラデーションなどが別の要素にあれば `data-hide-in-ar`)。
- 殻の AR は、撮った部屋を現実に重ねる手順 `createAlignFlow`(床を 2 回タップ)を通す → `place.setAlignment`。

## 調べて分かったこと(出どころは docs/devlog_場所.md)
- iPhone の Safari に WebXR は無い(iOS 27.2 でも)。殻 = ARKit の上の透明な WKWebView。**ARKit が背面カメラを使うので、殻の中は getUserMedia の前面カメラと競合する見込み**(実機未検証)→ `?source=pose`(カメラを使わない人の入力)にする。
- Quest 3 は three.js の `renderer.xr` で immersive-ar / immersive-vr。`requiredFeatures` は 1 つでも満たせないと requestSession ごと失敗するので、機能は全部 `optionalFeatures`、入ったあと `session.enabledFeatures` を見る。マイクは入る前の 2D 画面で許可(session 中の許可は資料が無い)。DOM overlay は使えない。
- 頭の位置は render に渡す camera の `getWorldPosition()`(AR でも VR でも同じ)。

## 実機が無くても試す(偽物で端から端まで)
- `node --test`(`place/test/`): 偽の `navigator.xr`・偽の renderer で、機能一覧・背景の戻し方・モードの切りかえ・ボタン。
- ページを作ったら `python place/tools/check_modes_page.py <ページのパス>` で確かめる(殻あり・なしの両方。ページの決まりは、そのファイルの先頭に書いてある)。three は `importmap` で `/place/node_modules/three/…` を指す(`place/web/demo.html` が見本)。
- `python place/tools/native_ar_check.py`: ヘッドレス Chrome に `window.webkit.messageHandlers.arhost` を差し、姿勢(`window.__arhost.onPose`)を送って、AR に入る→床 2 回タップで部屋が重なる→タップでキャラが動く、背景が透明、エラー 0 を見る。
- はまった所: アニメーションのループが、あとで `let` する変数を参照して起動直後に落ちる(TDZ)→ 先に `let x = null` を宣言。`html` と `body` の背景は、`body.ar html` では効かない(`html.ar, html.ar body`)。
- 実機で確かめた物と、偽物でだけ確かめた物は、devlog で分けて書く。
- `native_ar_check.py` は `demo.html` 専用。ほかのページは `check_modes_page.py`(ページの決まりは先頭)で確かめる。Python の subprocess に Git Bash 形式のパス(`/d/...`)を渡すと失敗する(`D:/...` か `os.getcwd()`)。
- 殻で自動に `enter('ar')` しても、ボタンの表示は自動で今のモードに合う(`modes.subscribe`、2026-11-02 の試験で Haiku が見つけた不具合を直した)。ページの側で `buttons.refresh()` を呼ぶ必要は無い。
- 判定の限界: canvas の隅の alpha の確認は、`preserveDrawingBuffer: true` が無いと中身に関係なく 0 になって通りうる。本当の透明の確認は html と body の背景の計算値(`rgba(0, 0, 0, 0)`)で見ている。

## Quest 3 の VR で話す(2026-11-04。ここまでは偽の WebXR で確かめた物。実機の結果は devlog を見る)
- 偽物は Meta の IWER(`iwer`)が使える。`web/scripts/vr-check.mjs` が見本。**Chrome 本体の navigator.xr に負けるので `installRuntime({ forceInstall: true })`。** IWER 2.7.0 の `getOffsetReferenceSpace` は `XRRigidTransform` を行列として扱うので、ずれが効かない(`offset.matrix` を渡す包みを試験の中で足す)。頭は `device.position.set(...)`、スティックは `controllers.right.updateAxes('thumbstick', x, y)`、トリガーは `updateButtonValue('trigger', 1)`。
- 偽のマイク: `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>%noloop`。ファイルの頭に長い無音を入れて、VR に入ったあとで声を流す。**「字が出た」だけで合格にしない**(「カルカルカル…」でも合格になった)。声に入っている言葉と照らす。
- **`ScriptProcessor` は描画と同じ流れなので、VR の描画が重いと音が欠けて字が崩れた。`AudioWorklet` に替えると、同じ声が正しく字になった。**
- Whisper は聞き取れない音でやり直しを繰り返す(2.8 秒の音に 45 秒)。`temperature=0.0` で止める。`no_speech_prob` だけで切ると、きれいな声(0.67)まで捨てる。`avg_logprob` と合わせて見る。
- 立ち位置は、キャラを動かさず、`renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(変換の逆))` で見ている人のほうを動かす(撮った部屋の立ち位置・視線の計算を変えなくてよい)。計算は `web/src/vrStage.js` の `computeRig`。
- 3D の文字の板は、変わったときだけ描き直す(毎フレーム `needsUpdate` にしない)。
- ヘッドセットの判定は `isSessionSupported` でなく UA で行う(Link の入った PC の Chrome でも VR が true になり、カメラの入口が消えるのを防ぐ)。

## 段下げ試験(2026-11-02、切りかえページ作り)
固定の試験: `place/testdata/skill_trials/brief_modes.md` の依頼文だけで、`place/skilltest/<段>/index.html` と `main.js` を作らせる(`modes.js`・`mountModeButtons`・`loadPlace` を使う)。まっさらな文脈の作業役。合否は私が別に `check_modes_page.py`(偽の殻あり・なし)で判定した。トークンはその作業役が使った合計。

| 段 | モデル / effort | 合否 | 時間 | トークン | 気づいたこと |
|---|---|---|---|---|---|
| 0 | Opus 5.5 / xhigh | 合 | 77.6 秒 | 147,866 | `enter('ar')` を `__ready` の前に呼ぶ順番が書かれていないと指摘(判定が `__ready` の後、ready を 5 秒待つ) |
| 1 | Opus 5.5 / high | 合 | 47.2 秒 | 140,327 | `preserveDrawingBuffer` が要るかもしれない、と指摘(上の「判定の限界」に反映) |
| 2 | Opus 5.5 / medium | 合 | 42.3 秒 | 138,982 | つまずき無し |
| 3 | Sonnet 5.5 / high | 合 | 32.4 秒 | 135,076 | つまずき無し(`onViewer` の中で `updateMatrixWorld(true)` を呼んでから位置を取った) |
| 4 | Sonnet 5.5 / medium | 合 | 24.6 秒 | 134,729 | つまずき無し |
| 5 | Haiku 5.5 | 合 | 92.4 秒 | 153,974 | 自動で AR に入ったあとボタンの表示が古いままになる**部品の不具合**を自力で見つけて回避 → 部品を直した |

結論: **一番安く動く設定は Sonnet 5.5 の medium**(合格・最短・トークン最少)。Haiku も合格したが、時間が約 4 倍、トークンも多く、部品の不具合を踏んだ(直した)。Opus の段の間に品質の差は出なかった。この試験は、ページの決まりと見本(`demo.html`・`demo.js`)がそろっていれば難しくない。決まりを減らしたり、見本を隠したりした「もっと難しい試験」は、まだしていない。

## Quest 3 の道(サーバーの聞き取り)の遅れを測る(2026-11-04)
- `node web/scripts/stt-latency.mjs --port <番号> --mic 声.wav --out <フォルダ> --word <正しい言葉の全文>`(VR には入らず、Quest の UA と偽のマイクで聞き取り → 返事だけ通す)。まとめは `--summary a.json b.json`。起点は声の区間が閉じた時刻(声が止まって 450ms 後)。`Listener.timings` に、閉じた・送った・字が返った時刻が残る。
- 偽のマイクの録音は 1 回の読み込みで 1 度しか流れない(`%noloop`)。`mic3.wav` は 101 秒で、声は 54〜80 秒の同じ文 3 区間。5 回以上は読み込みを重ねる。字が合うかは、`--word` と照らす(完全一致・余計な字つき・外れ)。録音の正しい言葉は、medium など大きい型でページを通さずに確かめる。
- 見つけた不具合: server の聞き取りだと、2.5 秒を超える発話ではあいづちが字より先に出なかった(先に出す条件が「直近 2.5 秒以内の途中の字」で、server は声の出始めの「…」しか出さない)。区間が閉じるときにも `onInterim('…')` を出して直した。**あいづちが字より先かは、時刻を取って確かめる**(出ているかの見た目では分からない)。
- 共有の `web/logs/claude_usage.json`(1 日の回数)は、ほかの作業の分も数える。朝に 800 回を超えていることがあり、上限 200 だと本物の頭脳は断られる。測る前に `/api/status` の `claude.remainingToday` を見る。上限を勝手に上げず、仮の頭脳で測れる分(聞き取り・あいづち)だけ測って、残りは人に頼む。
- `Start-Process` で起動したサーバーを PowerShell の同じ呼び出しで待つと戻ってこない。別のプロセスで呼んで、`pid` をファイルに残し、その PID だけ止める。
