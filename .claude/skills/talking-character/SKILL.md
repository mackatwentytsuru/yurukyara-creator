---
name: talking-character
description: 絵 1 枚から、ブラウザで話すキャラを作る入口の手順。お店の受付や案内に立つ、ゆるキャラ・ぬいぐるみ・ロボットを、3D の部品から組み、骨・目と口・動きを付けて、声と字幕で話すところまで進める。「この絵を話すキャラにしたい」「うちの店の案内キャラを作りたい」「マスコットを動かして喋らせたい」と言われたときに使う。
---

# 絵 1 枚から、話すキャラを作る

このリポジトリを開いた Claude Code が、人の手をできるだけ借りずに、絵から話すキャラまでを作る手順です。形を作る細かい技は `hand-built-character` スキルに書いてあります。

## 向いている物、まだ確かめていない物

- 向いている: 丸い頭と胴に短い手足の物、球や箱の胴の物、帽子のある物。硬い物(ロボット)。確認の根拠は `docs/カバー率.md`。
- まだ通らない(この版で完成とし、直さない): 毛足のある布の質感は、判定が通らない(無料の布の素材を貼っても同じ。`hand-built-character` の素材の節)。耳・たすき・くちばし・翼・花・マント・角・文字などの細部は、作れるが元の絵と差が残る。頭と胴の境の段は残る。
- 人の顔や人型の体は、この手順では質が出ない。先に使う人に伝える。

できないことをできると言わない。測った数字と、確かめていないことを、最後に分けて報告する。

途中のひとことも報告も、使う人の言葉で書く(日本語で頼まれたら日本語)。

## 1. 聞くことは 1 回にまとめる

最初に次の 3 つだけを聞く。答えがなければ、( )の既定で進めて、報告に書く。

1. 絵のファイル。**使う人が権利を持つ絵か**を確かめる。権利が分からない絵(有名なキャラなど)では作らない。
2. キャラの名前と、性格を一言(絵から決める)。
3. どこで、誰を迎えるか(お店の入口で、はじめて来た人を迎える)。

**鍵は聞かない。** チャットに貼ってもらわない。声や頭脳の鍵が要るときは、使う人に、自分の環境変数に設定してもらう(`web/README.md`)。鍵がなくても、仮の返事と口パクで試せる。

### 絵が無いとき・元の絵を Claude が SVG で描く(2026-11-06、f_led・d_lantern で実際にやった)

使う人に絵が無いなら、Claude が SVG(ベクターのイラスト)を自分のコードで描き、それを「元の絵」にして、以降を同じ手順で流せる。画像の取り込み(`<image>`)・写真・ほかの AI の絵は使わない。

- **構図**: `viewBox="0 0 1254 1254"`、背景は白の `<rect>`、正面向き・全身・左右対称、体のまわりに 5% 以上(63px)の余白。足元から頭のてっぺんまでの px を実寸に割りあてて S = px ÷ m を決める(f_led は 954px = 0.9m → 1060、d_lantern は 966px = 0.7m → 1380)。部品の位置は、SVG を作る Python(`gen_<id>.py`)の数字で持つと、あとで測り直さずに builder へ移せる。
- **3D のおもちゃに見せる塗り**: 面ごとに `linearGradient`(体の斜め光)、`radialGradient`(やわらかいハイライト、提灯の中心の明るさ)、小さな楕円を `feGaussianBlur` でぼかしたハイライトと影。**輪郭線は引かない。** 丸みは「体の形で `clipPath` を切り、その中に太い暗い線をぼかして描く」と縁が暗く沈んで立体に見える。
- **床の影は、同じ SVG の「影なし版」(`--noshadow`)を輪郭用に作る。** 影があると、`s03_compare`・`s05_gaps`・`check_all` が影を体と数える(f_led で輪郭の重なり 0.877 が、影なしで 0.981)。見せる絵・判定に出す絵は影つき、測る絵(`s03 --mask`、`check_all.sh` の元の絵)は影なし。体に落とす接触の影は、その部品の形で `clip-path` に切る(背景へにじむと、輪郭が汚れて抜けとして出る)。
- **光る点の輪は、格子に載せない。** 格子の点で輪を作ると八角形・四角に見えた。円周上に等間隔の点を置くと丸い輪になる。
- **文字**は、フォントに頼らずパスにして書く(今回の 2 体には文字がなく、パス化は未実施)。
- **PNG にする**: SVG を埋めた HTML を、Chrome のヘッドレスで撮る(GPU を使わない 2D)。`chrome.exe --headless=new --screenshot=<絶対パス>.png --window-size=1254,1254 --default-background-color=FFFFFFFF --disable-gpu --hide-scrollbars file:///<絶対パス>.html`。**html は絶対パスで渡す**(相対だと撮れない)。`html,body{margin:0;overflow:hidden}` と `svg{display:block}` を付ける。
- **3 回以上、PNG を開いて直す。** 見る点: かわいいか・左右の釣り合い・手足が切れていないか・顔が読めるか・色が沈んでいないか。直した例: 腕が「棒と球」の継ぎ目に見えた→1 つの形に(f_led)、羽根が細い棒の耳に見えた→付け根を丸く・下を開いた垂れ布に(d_lantern)。
- 保存は `creator/samples/<id>_元の絵.svg` と `.png`。

## 2. 環境を調べて設定する

```bash
python creator/setup/doctor.py --write
```

足りない物と直し方が出る。自分で直せる物(`pip install pillow numpy`、`cd web && npm install`)は直して、もう一度流す。Blender が見つからないときだけ、入っている場所を聞いて `--blender <実行ファイル>` で渡す。入っていなければ、入れてもらう(自分で入れない)。

判定役は、新しい文脈の Claude(Haiku 5.5 と Sonnet 5.5、各 3 回)だけ。決まりは `creator/pipeline/j01_judge.py` の先頭。2 つとも同じ系統なので、通っても目で確かめる。

## 3. 作る

作業フォルダは `_trials/<id>/`(リポジトリに入らない)。`hand-built-character` スキルを全部読み、そのとおりに進める。

1. 絵を見て、部品の一覧を決める。builder を書いて 1 周する(`creator/builders/_template_px.py` が型)。
2. 骨と動きを入れて pack を作る(`b07_rig_groups.py`、`pk02_check_character.py`)。
3. builder を直すたびに検査を通す。**全部 OK になるまで、人に見せない。**

```bash
sh creator/pipeline/check_all.sh <build.blend> <pack> <元の絵> <作業フォルダ>/check [帯の名前,…]
```

検査の記録は `<作業フォルダ>/check/history/` に自動でたまる。試行錯誤の記録になるので消さない。

## 4. 別の目で判定する

作った担当(自分)は判定しない。

```bash
python creator/pipeline/j01_judge.py <元の絵> <作業フォルダ>/check/browser <作業フォルダ>/judge [--part 部分の名前] [--fur]
```

- 「同じキャラに見えるか」と「色」が通らなければ、下の答えの `D:` の行を読んで直す。直すのは 2 回まで。
- 布・ぬいぐるみの絵なら `--fur` を付ける。毛足の判定はぶれるので、合否に入れず、数字だけ報告する。
- 指摘が実測と食い違うことがある。数字と大きく撮った絵で確かめてから直す。
- **合格を狙って判定だけを繰り返さない。** 使う人の目が最後に決める。

## 5. 話させる

```bash
python creator/pipeline/pk04_install.py <pack> <id> --name <表示の名前> --persona <性格の文.md>
cd web && npm run build
PORT=8799 SHOP_DATA_FILE=../creator/setup/shop_empty.json npm run server
node creator/pipeline/web_talk_check.mjs --port 8799 --character <id> --out <作業フォルダ>/web
```

`web_talk_check.mjs` が、キャラの読み込み・返事・口・表情か動きを確かめる。全部できたら、使う人に開いてもらう: `http://localhost:8799/?character=<id>`

番号 8799 がすでに使われていたら、別の番号で起動する(`PORT=8811` など)。動いているサーバーの中身は別のキャラかもしれないので、使わない。

サーバーは、自分で起動した番号(PID)だけを止める。`claude` や `node` を名前で止めない(ほかの仕事まで止まる)。

性格の文(`persona.md`)には、キャラの話し方と、分からないことはスタッフに渡すことを書く。お店の情報を推測で書かない。

**お店のデータ**: `SHOP_DATA_FILE` を付けないと、見本の店(LED のあるショーの店)のデータで答えてしまう(試験で、パンのキャラが席の話をした)。データをもらっていないときは、上のように `creator/setup/shop_empty.json` を使う。知らないことを聞かれると、スタッフに渡す。データをもらったら、`web/server/shop/sample.json` と同じ形の JSON を作り、`SHOP_DATA_FILE` で渡す(手順は `shop-guide` スキル)。もらっていない営業時間や料金を作らない。

**動きだけを確かめるときは、新しく声を作らない(声の生成は費用がかかる。本人の決まり、2026-11-04)。** 前に録った声(`web_talk_record.mjs` の出力の音、例 `video_1104/*_talk_*.webm` の音声)を使い回して、口と動きを見る。新しい声は、返事の中身や声そのものを確かめるときだけ。

動画に残すなら `node creator/pipeline/web_talk_record.mjs --port 8799 --character <id> --out <出力.webm>`(字幕ごとの画面と声。話す言葉はその場の返事)。作る様子の早回しは `python creator/skilltest/timelapse.py <作業フォルダ> <元の絵> <出力.mp4>`。

- `web_talk_record.mjs` の出力(webm)は長さの情報が入らない。長さは `ffmpeg -i x.webm -f null -` の最後の `time=` で読む。声は `-af volumedetect -vn -f null -` の `max_volume`(2026-11-04 の 4 本は -0.4〜-1.0 dB、平均 -18 dB 前後)。確認の絵は、`silencedetect` で最初の音の時刻を出し、そこから `-ss <時刻> -vf fps=1,scale=640:-1,tile=3x2` で 6 コマ。録るのは 1 本 20 秒台(質問 2 つ、各キャラ 約 40 秒かかる)。
- 字を消すには `ffmpeg -i x.webm -map_metadata -1 -c copy`(webm は `-c copy` で通る。Opus の「Error parsing Opus packet header」の注意が 1 回出るが、音は残る)。
- `timelapse.py` の作業フォルダは、`repo/_trials/*/check/history/*` を持つ作業の最上位(`.../c1_sonnet_medium`)。試験の中の `q_robot_trial` ではない。作業フォルダ直下の `check/history/*` だけの場合(ようこそくん)と `log.jsonl` が無い場合も通るように直した。
- PowerShell の `$()` を含む一行は許可の確認で止まる。起動の命令は `.ps1` に書いて `powershell -NoProfile -File` で流す。`Start-Process` の PID を `Out-File` で書くと UTF-16 なので、読むときは数字だけ取り出す(`tr -dc 0-9`)。

## macOS で流すとき(2026-11-04 に M4 の Mac で通した)

Claude を使わない部分(doctor → builder → 骨 → `check_all.sh` → `npm run build` → サーバー → `web_talk_check.mjs`)は、手を足さずに通った。違いだけ書く。

- 場所: Blender は `/Applications/Blender.app/Contents/MacOS/Blender`、Chrome は `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`(どちらも `doctor.py` が見つけて `env.local.sh` に書く)。Homebrew の Blender は `/opt/homebrew/bin/blender` に出ることもある。
- python3 は PIL と numpy が入っていれば、そのまま使える。無ければ作業フォルダの venv に入れる(全体に入れない)。ssh で入ると node が PATH に無いので、先に `export PATH=/opt/homebrew/bin:$HOME/.local/bin:$PATH`。
- `timeout` コマンドは Mac に無い。時間切れが要るときは、中の道具(Playwright など)の時間切れに任せる。
- 一覧の絵(`s01`〜`s04`)の日本語の見出しは `creator/pipeline/fontpath.py` が字体を探す(Windows の Meiryo、Mac の Hiragino Sans GB)。ここが `C:\Windows\Fonts` 決め打ちで、Mac では `OSError: cannot open resource` で落ちた。
- `check_all.sh` の最後の「Terminated」の表示は、bash 以外の sh で出る。`{ kill; wait; } 2>/dev/null` でまとめて捨てている。
- `check_all.sh` の ③ が `sash 浮き` で落ちるのは OS の差ではない。第 5 引数に体に付く部品の名前(`sash`)を渡すと通る。
- `web/` の build は `web/src/stage/`(AR・部屋重ねの部品)を読む。リポジトリの一部だけを写すときは `web/src/stage` も入れる。
- ここまで偽物なし(Mac の実機で Blender と Chrome を動かした)。同じ builder のブラウザの正面の絵を Windows の絵と目で比べ、同じに見えた(数字では比べていない)。頭脳は仮の頭脳で試した。

## 6. Quest 3 でも話させる(頼まれたら)

アプリのビルドは要らない。**同じキャラのまま、Quest のブラウザで VR に入って話せる。** GLB のキャラ(`rig`)も VRM も、`?character=<id>` を替えるだけ。詳しくは `web/README.md` の「Quest 3 で話す」。

- 聞き取りはサーバーで行う(Quest のブラウザに聞き取りの機能が無い報告があるため)。`pip install faster-whisper`。鍵は要らない。
- 使う人の操作: 開発者モードと USB デバッグの許可。`node web/scripts/quest-usb.mjs --port 8799 --character <id>` が許可を待って、道を張り、ブラウザで開く。
- 見せる前に偽物で確かめる: `node web/scripts/vr-check.mjs --port 8799 --character <id> --out <作業フォルダ>/vr`。立ち位置・床・大きさ・視線・歩く・トリガー・声・口を数字で見る。**これは偽物の結果。実機で確かめるまで「Quest で動く」と言わない。**
- 作ったキャラを VRM で持っている人は、`characters/<id>/` に `model.vrm` と `character.json`(`"type": "vrm"`、`height_m`、`persona`)を置くだけ。権利のある物だけを使う(買った素材の再配布の条件を確かめる)。

## 7. 報告する

順番: できたか → 測った数字(輪郭の重なり、検査、判定の回数、かかった時間と費用)→ 開き方 → 確かめていないこと → 決めてほしいこと。

見た目は判定役より使う人の目が優先する。直してほしい所を聞いて、builder の数字を直して、3 から回す。

学んだことは `hand-built-character` スキルに書き足す。

## main をゆるキャラだけに整えたときの知見(2026-11-06)
- 柱を外すときは、先に `grep` で「残す側が外す側のファイルを読んでいないか」を見る。`web/src/main.js` が `place/web/` の 8 ファイル(alignFlow・align・modes・xr・nativeAR・modeButtons・loadPlace・placeSchema)を読んでいたので、`web/src/stage/` へ移して直した。
- 試験が、外すフォルダの見本やスキルを読むことがある(`memory.test.mjs` は `kiosk/memory/sample`、`shop/rules.mjs` は shop-guide スキル)。外す前に `node --test` を流して、落ちた所を直す。
- プライバシーの試験は `web/src` の `fetch(変数)` を許可リストで見る。移した部品の `fetch(url)` は `VARIABLE_FETCH` に足す。
- 他のスレッドが動いている作業コピーは動かさない。main の整理は別の worktree でやり、元の作業コピーは別の線(archive)に切り替えるだけにすると、未コミットの変更も絶対パスの台本も壊れない。
- 別の worktree には `web/node_modules`(junction)と、`tools/prepush_terms.local.txt`(git 無視)を写さないと、`npm test` と `prepush_check` が動かない。

## 公開の前に git の履歴を書き換える手順(2026-11-06)
- 元の repo・worktree には触らず、`git clone --no-local --single-branch --branch main` の写しで作る。道具は `pip install --user git-filter-repo`(`python -m git_filter_repo`)。
- 手順は 1 回の `filter-repo` にまとめる: ① `--paths-from-file`(今の木の追跡一覧)で、外したファイルの古い版と、それだけを触ったコミットを落とす ② `--replace-text` と `--replace-message`(同じ規則ファイル)で、残るファイルとコミットの文の語を置き換える ③ 必要なら `--mailmap` で作者のメールを GitHub の noreply(`<数字の id>+<名前>@users.noreply.github.com`、id は `gh api users/<名前> --jq .id`)にする。
- 規則ファイルは Write で書く(Bash の heredoc だと `\b` が壊れる)。置き換えは、先に `git log -p` の足された行を数える自作の走査で、語ごとの出現ファイルと前後を見てから決める。語の一覧は `tools/history_terms.local.txt`(git 無視)。機械の名前・IP・ローカルのパス・メールも走査に入れる。
- 日時と `Co-Authored-By` の行は残る(落ちるのは、落としたファイルだけを触ったコミットの分)。確かめは、写しで `tools/history_check.py` が 0 件、バイナリも `git grep -a` で語が 0 件、`npm test`、`prepush_check`、元の木との差が置き換えの行だけ、の 5 つ。
- 公開すると全部のブランチと履歴が見える。archive の線は別の非公開リポジトリへ移してから、本体から消す。

## SVG の元の絵から作り直した記録(2026-11-06、f_led・d_lantern)
- 流れは同じ(① 測る → ② builder → 骨 → 検査 → ⑦ 話す)。f_led は約 35 分、d_lantern は約 20 分(記録した時刻から。絵を描く時間を含む)。**道具の穴が 4 つ見つかり、直した**: `pk02` が顔の面の口(`mouth.kind: "atlas"`)を ERROR にしていた(光る点・紙の顔の型は全部落ちた)、`pk04_install` が `face_atlas.png` を置かなかった(前の顔が残る)、`m03_contact` が最大の物(本体)を「浮き」で落とした(平らな面の多い箱の胴)、`check_all.sh` のブラウザ(⑤⑥)が CPU 描画だけだった(`CHECK_GPU=1` で d3d11。GPU の札を取ってから流す)。
- 判定(Claude: Haiku 5.5・Sonnet 5.5、各 3 回、新しい文脈): **同じキャラ 3/3・3/3(2 体とも)、色 0/3・0/3、難しい部分(f_led は光る点の顔、d_lantern は羽根)0/3・0/3。** 色は、測るとブラウザの絵が元の絵に近い(f_led の中央値 40,62,131 対 34,56,121)のに「いいえ」。元の絵のつやのハイライトと画面の縁(ベゼル)・羽根のひだは、3D 側に無い。判定を替えて通さず、そのまま記録した。直したのは、f_led 2 回(点を小さく細く・円周の輪・体を明るい紺に)、d_lantern 2 回(胴を橙寄りに・羽根の厚みは検査で戻した)。
- ブラウザの色が白く飛ぶ・灰色にくすむ: 頂点の色 → 発光の接続は glTF に書き出せず、白い発光になって色が洗われる(提灯の胴で測定)。**内側から光る紙は、`pk01_package.py --glow Paper:1,0.62,0.28:0.5`(character.json の `glow`。実行側が発光の色を足す)を使い、材質の発光は 0 にして、色の濃淡は頂点の色だけに**(測った数字は同じだった)。`pk01` の `--height` を忘れると 0.9 になる(d_lantern は 0.7)。
- 声は作っていない(サーバーを `ELEVENLABS_API_KEY`・`ANTHROPIC_API_KEY` なしで起動 → 仮の頭脳。`env -u` で外す)。⑦ は 2 体とも `ok: true`(口 0.69、表情 happy・think、動き wave・think・bow)。声と本物の返事は未確認。

### SVG で描くコツ(ぬいぐるみ・ロボット編。2026-11-06、ようこそくん・ロボくんで試した。上の「絵が無いとき」の続き)

**キャラの設定の文だけから、Claude が SVG のコードを書いて元の絵にする**。後の手順(部品の一覧・画素の測り・builder)は、PNG にした絵をそのまま使える。

- **紙**: `viewBox="0 0 1254 1254"`、白い背景、正面・全身、左右対称気味、体のまわりに 5%(63px)以上の余白(影を含めて測る。ロボくんは上が 68px だった)。キャラの全高は 1050px 前後にすると、`S`(画素 → メートル)が決めやすい。
- **おもちゃ・ぬいぐるみ風の立体**: 面ごとに `radialGradient`(`fx`・`fy` を左上へずらして光を作る。中心 → 縁で明 → 暗)、ハイライトは白い楕円を `feGaussianBlur`(標準偏差 4〜26)でぼかして重ねる、足元は薄い黒の楕円 2 枚(広くぼかしたもの + 細く濃いもの)。**輪郭線は引かない**(塗りの明暗だけで形を読ませる)。縁取りが無くても、白い背景との差で輪郭が測れる。
- **毛足(布)**: `feTurbulence` + `feDisplacementMap`(scale 6〜7)で輪郭をわずかにゆらし、`feBlend mode="soft-light"` でざらつきを重ねる。**`filter` の領域は `filterUnits="userSpaceOnUse"` で紙全体にする**(既定の箱だと、線(stroke)だけの腕が水平に切れた)。
- **重なり順**: 後ろの物から描く。たすきが腕にかかるなら、腕 → たすき(体の楕円で `clipPath` して端を体の輪郭で切る)→ 頭。顔の部品は最後。頭が胴に落とす影は、胴の `clipPath` の中で描く(外へ出ると宙に浮いた灰色の塊になった)。
- **文字はパスにする**: フォントに頼らない。`fontTools` で字の輪郭を SVG の `d` にして埋め込む(`SVGPathPen` + `TransformPen` で y を反転。BIZ UD ゴシックの太字を使った)。丸ゴシックの見た目は、同じ色の線(`stroke-linejoin="round"`、字の 1/30 ほどの太さ)を重ねて角を丸める。縫い目は、帯の縁の内側に `stroke-dasharray` の破線。
- **PNG にする**: `chrome.exe --headless=new --screenshot=out.png --window-size=1254,1254 --default-background-color=FFFFFFFF --disable-gpu --hide-scrollbars --user-data-dir=<空のフォルダ> file:///<svg を埋めた html の絶対パス>`(約 1 秒)。**`--user-data-dir` が無いと `Missing headless user data directory` で何も出ない**。相対パスの html は `ERR_FILE_NOT_FOUND` になる。
- **描き直しの見どころ**: ① 顔が読めるか ② 左右の釣り合い ③ 手足が切れていないか(切れたら filter の領域) ④ 重なり順(字が腕に隠れた → 腕を帯より先に描く) ⑤ 色が沈んでいないか ⑥ 足元の影が外へはみ出していないか。ようこそくんは 4 回、ロボくんは 3 回描き直した。
- **測れる形にしておく**: 部品の中心・半径は、SVG に書いた数字が builder の辞書 `D` の元になる。足元の影・白い文字・目のハイライトは、`s03_compare_core.silhouette` が体に数えるよう直した(色味のない明るい灰色の影を体から外し、体の中の白い穴は埋める)。
