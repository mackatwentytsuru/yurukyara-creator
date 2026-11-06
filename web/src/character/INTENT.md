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

## 5. 確かめ方

- `test/intent.test.mjs`: 形をそろえる・7 つと別名・近い物への落とし方・5 つの呼び方の順・2D と 3D(rig の表情の一覧)の両方で例外が出ない。
- `test/char2d_intent.test.mjs`(S2): 意図の列 10 個を 2D の板に流す。この `intent.js` があれば、こちらの `applyIntent` を使う。
