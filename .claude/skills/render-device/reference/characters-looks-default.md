# 見た目の切り替え(3D と 2D。2026-11-07 第 5 波)

(元の文のまま。見た目の切り替えと、2D の板・既定のキャラ・動きの意図)

- 3D と 2D の両方があるキャラだけ、上の段に `#lookSwitch`(「見た目」+「3D」「2D」の 2 つのボタン、aria-pressed、押す所 44px)を出す。スマホの幅では、畳んだ「Claude の考え」の見出しの右に `position: fixed` で置く(上の段の行を増やさない。考えを開いても切り替えは窓より手前で押せる。第 7 波)。AR(data-hide-in-ar)・VR の間・入口の LED・ヘッドセット・`?perf=1` では出さない。
- 両方あるかは `availableLooks(character)`(character/index.js): 3D は model があれば。2D は `looks.2d.parts` が文字(S2 の parts.json の場所)なら見に行かずにあり、`looks` はあるが `2d` が無い時は決まりの場所 `2d/parts.json` を 1 回 GET で見る(ノリーは合わせ⑤から looks.2d が書いてあるので見に行かない)(content-type が json の 200 だけ)。前の形(looks が無い。ロボくん・パネルくん・提灯くん)と、2d が部品の名前の並びだけ(みかんちゃん。板の部品の表が無い)は見に行かない(404 をコンソールに出さない)。
- 替える時は `loadCharacter(lookSource.url, { ...app.tierOverrides, look })` で読み、舞台の object3d を入れ替え、`app.character` と `dialogue.character` を替え、置き直す。読んだ物は Map に持ち、2 回目からはすぐ替わる。会話・記憶・人格の文はキャラの id が同じなのでそのまま。
- **舞台の子が替わるたびに作り直す(S5w9。S4 の頼み・CRITux2 高 1 の残り)**: `swapCharacter(next)`(見た目の切り替え・S4 の初めての会話の見本の子・案内役に戻す、の全部が通る 1 つの口)の最後と起動の最後で `refreshLookSwitch(next)` を呼び、今の子に合わせて出す・隠す・aria-pressed を合わせる。控えの鍵は `lookKey(id, look)`(`characterKey` = character.json の id。three を読まない looks.js)。**前は最初の子で 1 回だけ作り、控えの鍵が見た目だけだったので、見本の子(ようこそくん)で 2D → 3D と押すと最初の子(ノリー)の 3D が戻り、閉じた後のノリーで 2D を押すとようこそくんの 2D が出た。** 出せる見た目は子ごとに 1 回だけ調べて覚える。調べている間(2d/parts.json を見に行く子だけ)は隠し、調べ終わる前に子が替わったら古い答えは捨てる(回の番号)。押す受け口は 1 回だけ付ける。読んでいる間に S4 が子を替えたら、その子は替えない。URL の `?look=` を書き換えるのは最初に出した子の時だけ。S4 の `html.fr-guest #lookSwitch { display: none }`(見本の子の間は隠す)は、この作り直しが入った後に S4 が外す約束(外すまでは hidden 属性が S5 の決め・display が見え方)。
- 選んだ方は、このタブだけで覚える: `sessionStorage` の `yc.look.<character.json の id>`(読み書きは try/catch。使えないブラウザでは覚えないだけ)。順は `?look=` → このタブで選んだ物 → `looks.default`。`?look=` が URL にある時は、押した時に `history.replaceState` で選んだ方へ書き換える(読み込み直しても同じ)。別のタブ・新しい文脈では既定に戻る。
- 決まりは three を読まない `web/src/character/looks.js`(試験 `web/test/place_look_switch.test.mjs`。今の木のキャラの looks の形と、index.html・style.css の形も見る)。
- **今の木のキャラを見る試験は、読んだ character.json から期待を作る(決め打ちしない)。** character.json はほかの流れ(主役・S1)の持ち物で、合わせの順で先に変わる。2026-11-07 合わせ⑤: 主役の流れがノリーの looks に `2d` を足しただけで、文字のぶつかり 0 のまま `'probe'` の決め打ちが落ちた(意味のぶつかり。382 件中 1 件)。直し方は「looks.2d があれば `'yes'`・無ければ `'probe'`」。決まりの答え(主役は 2D を出せる)は残し、形の違いだけを読んで合わせる。試す前に、looks.2d を外した写し(structuredClone して delete)でも期待と looks.js の答えが合うのを 1 行の node で見る。

## 2D の板と見た目の方式(looks)
- `web/src/character/index.js` の `loadCharacter(url, { look, lookMemory })`: `?look=2d|3d` が先、次にこのタブで選んだ物(lookMemory = sessionStorage)、次に character.json の `looks.default`。3D の形(model)が無く 2D がある時は 2D。2D が読めない時は、3D があれば 3D に戻す(警告だけ)。返すキャラには `lookSource`(元の URL と character.json)が付く。
- 2D は `looks.2d.parts` の parts.json(無ければ決まりの場所 `2d/parts.json`)と、その中の svg を読む。読み込み(fetch)は character/index.js の中だけで、宛先の変数名は `url`(privacy の試験の決まり)。2D の部品は `import('../char2d/index.js')` で、2D の時だけ読む(8.7KB)。
- `looks.2d.parts` が部品の名前の配列(S1 の K1 の形。みかんちゃん)だと、parts.json が見つからず 3D に戻る。2D の板で出すには S2 の parts.json が要る。
- **2D の部品(2d/parts.json・body.svg)だけが入っても、`characters/<id>/character.json` が無いとキャラは出ない**(既定の順では 404 で次のキャラへ、`?character=<id>` では「読み込めない」)。2D だけで出す最小の形: `{"id","name","looks":{"default":"2d","2d":{"parts":"2d/parts.json"}},"persona":"persona.md"}`。2026-11-07 00:1x、写しの木でこの形のノリー(S2 の 2D・S3 の人格の文)が、既定のキャラ 4/4・話す試験の口 0.692・IWER 19 項目・読み込み 1.20MB・最初のコマ 0.3〜0.4 秒で通った。
- 測った数(GPU・PC と幅 390 と Quest のまね): ようこそくんの 2D は描く呼び出し 17・三角 80・読み込み 1.26MB(ほとんど画面の JS)。3D は 112・37 万・4.19MB。

## 既定のキャラ(主役ノリー)
- 既定のキャラは `DEFAULT_CHARACTERS`(主役 norrie → ようこそくん。`web/src/character/defaults.js`)の順に、読めた物。主役がまだ無い木でも画面は出る(404 が 1 回コンソールに出るのは決まり)。主役の形が読みかけで壊れていても、ようこそくんに戻る。`?character=<id>` を書いた時は、そのキャラだけ(読めなければ理由を出す)。
- 主役の決まり(id と表示の名前)は `MAIN_CHARACTER`(defaults.js)1 か所。初めての会話の案内役(S4 の mountFirstRun の guide)にも、main.js からこれを渡す。
- 主役は自分のことも「ノリー」と呼ぶ(11/7 本人。伸ばす棒の無い呼び名は書かない。呼び名でない言葉・id の norrie・ファイルの名前はそのまま)。試験の見本の文は、S3 の人格の文の直しと同じ形で、呼び名の所だけを伸ばす棒つきの「ノリー」に替える(文のほかは替えない。文字送りの途中を探す所も同じ)。自分の場所の確かめは `git grep -n -P "\x{30CE}\x{30EA}(?!\x{30FC}|\x{30CE}\x{30EA})" -- <自分の場所>` で 0 件(式に呼び名をそのまま書くと、その行が自分に当たるので、文字の番号で書く)。
- `character/index.js` は creator/viewer/rigRuntime.js を通して three を読むので、node の試験では読めない(creator/viewer から web/node_modules が見えない)。試験したい決まりは、three を読まない小さな部品(defaults.js の `loadFirstOf` のように、読み込みを引数で渡す形)に出す。試験は `web/test/place_default_character.test.mjs`(主役が入ったら id と 2D か 3D の形を確かめる行も動く)。

## 動きの意図(K2)
- `web/src/character/intent.js` の `applyIntent(character, { emotion, intensity, gesture, gaze, mouth }, { setGaze })`。2D も 3D も同じ 5 つの呼び方(lookAt・setExpression・setMouth・play・update)で受ける。無い表情・動きは近い物へ(INTENT.md の表)。
- 画面(main.js)は毎コマ人を追って lookAt を上書きするので、視線は `ctx.setGaze` に渡す(main.js の setGaze は 'person'・'away'・'landmark:<名前>'・[x,y,z] を受ける)。
