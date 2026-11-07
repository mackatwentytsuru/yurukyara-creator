# 動きの意図(契約 K2 版 1)

- 持ち主: S5(描画と端末)。使う流れ: S2(2D)・S3(会話)・主役の 2D と 3D。
- 中身のコード: `web/src/character/intent.js`(three も DOM も使わない。ブラウザ・`node --test`・サーバーのどれでも読める)。
- 試験: `cd web && node --test test/intent.test.mjs test/char2d_intent.test.mjs`
- 固めた日: 2026-11-06(金)。欄を足すのは持ち主の判断でよい。消す・名前を変える時は、司令塔の OK を取り、`INTENT_VERSION` を上げる。

## 1. 意図の形(1 つの文・1 つの場面ごとに 1 つ)

```js
{ emotion: 'happy', intensity: 0.9, gesture: 'wave', gaze: 'user', mouth: 0 }
```

| 欄 | 値 | 無い・壊れている時 |
|---|---|---|
| `emotion` | 7 つの表情: `neutral` `happy` `surprised` `sad` `angry` `relaxed` `think`。キャラ独自の表情の名前(例 `wink`)を書いてもよい | `neutral` |
| `intensity` | 0〜1(表情の強さ) | 1 |
| `gesture` | 動きの言葉: `none` `nod` `bow` `wave` `think` `tilt` `shake` `shrug` `point` `jump`。キャラ独自の動きの名前を書いてもよい | `none` |
| `gaze` | `'user'`(話し相手。`'person'` も同じ)・`'away'`(よそを見る)・`'landmark:<名前>'`(場所の目印)・`[x, y, z]` か `{x, y, z}`(ワールド座標、m) | `null` = 変えない(いつもの視線のまま) |
| `mouth` | 0〜1(口の開き) | 0 |

- 名前の大文字・小文字は問わない。日本語の言いかえ(「うれしい」「びっくり」「おじぎ」など)も少しだけ受ける(`intent.js` の別名の表)。
- 口: 声が出ている間は、画面(`main.js`)が声の大きさで毎コマ上書きする。意図の `mouth` は、声の無い場面(試験・台本の動き)用。
- 7 つの表情の名前は、K1 の `looks.2d.expressions` の名前と同じ(K1 の 17:52 の決まり)。

## 2. 受け手(キャラ)の 5 つの呼び方

2D(`Svg2DCharacter`)も 3D(`RigCharacterV2`・`VrmCharacter`)も、`CharacterBase` を継いで同じ呼び方を持つ。

| 呼び方 | 中身 |
|---|---|
| `lookAt(ワールド座標 \| null)` | その点を見る。`null` なら、だれも見ずにぼんやり |
| `setExpression(名前, 0〜1)` | 表情の強さ。1 つだけにする時は `setEmotion(名前, 0〜1)`(ほかを 0 に戻す) |
| `setMouth(0〜1)` | 口の開き |
| `play(名前, opts)` | 一回きりの動き。知らない名前なら `false` を返す(例外は出さない) |
| `update(dt)` | 毎コマ。なめらかにして体と顔に書く |

- そのキャラが出せる表情は `canShow(名前)`(2D)か `expressions`(3D・VRM)で分かる。
- `missingReceiverMethods(キャラ)` で、足りない呼び方が分かる(空なら OK)。

## 3. 無い物は近い物へ(`applyIntent` がする)

- 表情: 出せる名前ならそのまま(キャラ独自の表情も残す)。出せなければ、別名と近い物の表で 7 つのどれかに直し、下の順で試す。最後はいつも `neutral`。

| 頼まれた表情 | 代わりに試す順 |
|---|---|
| `happy` | `relaxed` → `neutral` |
| `relaxed` | `happy` → `neutral` |
| `angry` | `sad` → `neutral`(同じ「いやな気持ち」の側) |
| `think` | `relaxed` → `neutral` |
| `surprised`・`sad` | `neutral` |
| 知らない名前(例「なぞの表情」) | `neutral` |

- 動き: 頼まれた名前を先に試し(キャラ独自の動きもそのまま)、無ければ下の順。どれも無ければ動かない(`played: false`)。

| 頼まれた動き | 代わりに試す順 |
|---|---|
| `bow`・`wave`・`tilt` | `nod` |
| `think` | `tilt` → `nod` |
| `shake`・`shrug` | `tilt` |
| `point`・`jump` | `wave` → `nod` |
| 知らない名前(例 `dance`) | 動かない |

- 強さ: `neutral` は 0(ほかの表情を全部戻す)。キャラ独自の表情(漫符の板が値に比例して大きくなる物)は 1 で出す。それ以外は `intensity`。
- 今の作例の 3D(rig)は `angry`・`relaxed` の顔を持たないので、`sad`・`happy` で出る。2D(ようこそくん)は 7 つとも描いてある。

## 4. 使い方

```js
import { applyIntent, intentFromSay } from './character/intent.js';

// 会話(S3): サーバーの say のイベントが話し始める瞬間に、1 回だけ流す
const result = applyIntent(character, intentFromSay(ev), { setGaze });
// result = { asked, emotion: 実際に出した表情, weight, gesture: 実際に動かした名前 | 'none', played, gaze, mouth }

// 画面のない所(試験・2D の見本)では、setGaze の代わりに相手の位置を渡す
applyIntent(character2d, { emotion: 'surprised', intensity: 0.8, gesture: 'tilt', gaze: 'user' }, { userPosition: [0, 1.4, 2] });
```

- `ctx.setGaze` があれば、視線はそれに任せる(画面は毎コマ人を追って `lookAt` を上書きするため)。`main.js` の `setGaze` は `'person'`・`'away'`・`'landmark:<名前>'`・`[x, y, z]` を受け、2.4 秒ほど保つ。目印の時は、キャラから見た位置を返し、`point` の向きに使う。
- `intentFromSay(ev)`: サーバーの `{ type: 'say', expression, motion, gaze }` を意図にする(強さ 0.9、口 0)。
- 1 つの返事の中で、キャラ独自の表情を何度も切り替えない決まり(`expressionNames.js` の `oneCustomPerReply`)は、会話の側(S3)が先にかける。

## 5. かわいい仕草の層(11/8 B5G。`cuteLayer.js`・`cuteRig.js`)

- 本人の決め「モデリングで可愛さを出すのは限界がある。仕草で、どんなキャラクターでも徹底的に可愛く」。どのキャラにも同じ名前で効く 1 つの層。キャラごとの手付けはしない。
- 状態(画面 `main.js` が毎コマ `character.setActivity(名前)` で渡す。返事では送らない): `idle`(待つ: 小さな息・体のゆれ・ときどき首をかしげる・まばたきの間を毎回変える・しっぽ)/`listening`(聞く: 相づちのうなずき・話す人の方へ少し向く・少し前へ寄る)/`thinking`(考える: 首をかしげて上を見る・片手を前へ)/`talking`(話す: 文の調子で小さく頭が動く。ほかの仕草は 0.55 倍、弾みは 0.4 倍)。
- 返事で頼める仕草(上の動きの言葉に足した名前): `greet`(手をふって小さく弾む)・`happy`(小さく弾んで左右にゆれる・腕をぱたぱた)・`cheer`(ばんざい)・`shy`(うつむいてよそ見・体をよじる・手を前でもじもじ・頬が赤くなる)・`surprised`(小さくはねて少し後ろへ)・`droop`(しょんぼり)。前からの `nod`・`tilt`・`think`・`shake`・`shrug` も、この層がやわらかく動かす(同じ名前が続いても、左右・回数・深さを替える)。`bow`・`wave`・`point` の腕と体の形は、キャラの動きのファイル(rig)か `gestures.js`(VRM・2D)のまま、この層は顔と体の添え物だけを足す。`greet` はキャラに `wave` の動きがあれば、それで腕を動かす。
- 表情だけが変わった時(返事の `motion` が `none`)は、表情に合う小さな仕草が自動で付く(happy → happy、surprised → surprised、think → think、sad → droop、angry → shake)。6 秒に 1 回まで。
- 部位: 骨は決まった名前で探す(`root`・`body`/`spine`・`head`・`arm_L`/`arm_R`・`ear_L`/`ear_R`・`tail…`)。首の骨が無い子は頭の動きを体に寄せ、腕の骨が無い子は腕の仕草を近い物へ。しっぽの骨が無いのに、しっぽの部品(名前に tail)がある子には、読み込みの時に骨を 1 本足す(根元は体のまま、先がしなる)。頬の部品(cheek・blush)があれば、てれる・うれしい時に赤みを強くする。
- 腕を上げた時の脇: 仕草が上げる腕は、そのキャラの `wave` の形をもとに、120° まで(両腕を上げても頭とほおに当てない。肩のずらしも同じ割合)。袖と胴のつなぎ目に重みのある皮(腕と体の両方に重み)なら、読み込みの時に、つぶれる・のびすぎる三角形の割合で持ちこたえる角度を測り、動きのファイルの腕もその角度より上に上げない。作例 4 体はつなぎ目の無い硬い腕なので、この制限はかからない(測った)。
- 弾み: 根元は 3.5% まで上がる(`CUTE_RISE`)。画面の頭の上の余白(`motionRise`)に、これと首をかしげた時に耳が上へ出る分を足す。
- 2D の板(`pose2d.js`): 同じ数字から、弾み・横ずれ・体のゆれ(腰を中心に回す)・しっぽの板・耳の板が動く(いつも跳ねる前の弾みは、仕草の層がある時は使わない)。
- 会話の流れ(S3)は、返事の意図(あいさつ・ほめられた・びっくり・考えて答える など)をこの名前に当てる。キャラごとに使える名前は `motionChoices(character)`(サーバーへ `motions` として届く。24 個まで)。

## 6. 確かめ方

- `test/intent.test.mjs`: 形をそろえる・7 つと別名・近い物への落とし方・5 つの呼び方の順・2D と 3D(rig の表情の一覧)の両方で例外が出ない。
- `test/char2d_intent.test.mjs`(S2): 意図の列 10 個を 2D の板に流す。この `intent.js` があれば、こちらの `applyIntent` を使う。
- `test/intent_cute_layer.test.mjs`(B5G): 仕草の名前・同じ形を続けない・待つ間も止まらない・数字の範囲・話す間は小さい・ばね・まばたきの間・腕と首の無い子・表情からの自動の仕草・聞く・考える。
- `test/intent_cute_rig.test.mjs`(B5G): 作例 4 体の GLB を node で読み、骨の見つけ方・腕の上げ幅 120° まで・動きの上に足した分が次のコマで外れる(積み上がらない)・しっぽの骨の重み。
