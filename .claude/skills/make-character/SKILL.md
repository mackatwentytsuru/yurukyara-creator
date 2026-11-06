---
name: make-character
description: 言葉か絵 1 枚から、ブラウザで話す 3D のゆるキャラを、7 段(⓪ 描く〜⑦ 話す)で作る入口。段の順・各段の命令・合格の確かめ・時間と費用の記録(run.jsonl)をまとめる。「言葉からキャラを作って」「この絵を話すキャラにして」「7 段を通して」と言われたとき、最初に読む。
---

# make-character: 言葉か絵から、話すゆるキャラまで(7 段の入口)

細かい手順は各段のスキルにある。ここは順番と、段の間で渡す物と、確かめの命令だけ。

| 段 | 何をする | 命令・スキル | 合格の確かめ |
|---|---|---|---|
| 入口(絵のとき) | ゆるキャラチェック | `yuru-check`(`c01_yuru_check.py`) | `class` が yuru なら ① へ(手描き・落書きは ⓪ で描き直してから)。human は「ゆるキャラにしてみる?」→ ⓪、complex は別の絵か ⓪ |
| ⓪ 描く(言葉のとき) | 言葉 → SVG・PNG・設定 | `yc-0-draw`(`creator/draw/gen_<id>.py` → d01 → d02 → d04) | d02 が「不可 0」(部品は決まった `<g id>`)。PNG を 3 回以上見て直した |
| ① 見る | 部品・比率・色を読む | `hand-built-character` の 1〜2(元の SVG を `<g id="char">` の変換込みで測る。設定の表・gen の生の座標をそのまま使わない) | 部品の一覧が builder の辞書 `D` になる |
| ②③④ 形・材質・模様 | Blender の Python で部品ごとに組む・色・顔 | `creator/builders/<id>.py`、`run_groups.sh`(目と口がシェイプキー)か `run_built.sh`(顔の表) | `check_all.sh` の ③ 埋まりと浮き・④ 抜け |
| ⑤⑥ 骨・動き | 部品ごとの骨、5 つの動き | `b07_rig_groups.py`(run_groups の中)、`pk01_package.py` → `pk02_check_character.py` | pk02 が OK、`check_all.sh` が「全部 OK」(GPU で) |
| 判定 | 作った担当以外の目 | `j01_judge.py`(Haiku・Sonnet 各 3 回)。直すのは 1 回だけ | 結果をそのまま記録(通らなくても) |
| ⑦ 話す | 取り付け・会話の画面で確かめ | `python creator/pipeline/t07_talk.py <pack> <id> --name … --out … --words "…"` | `web_check.json` の ok(読み込み・返事・口・表情か動き) |

## 人の確認(契約 K3)と段の道具(2026-11-06 夜から)
- キャラに確認の状態(`creator/work/<id>/review/state.json`。`python creator/review/review_state.py init <id>` で作る)があると、段の道具が自分で止まる。
  - `stage_run.py`(claude・tool)と `t07_talk.py` は、段 N の前に `review_state.py can-start <id> <N>` を呼び、前の段が `ok`(人が OK)か `auto`(門の無い段が済んだ)でなければ、流さずに終わりの番号 2(run.jsonl にも書かない)。やり直し中(`redo`)も止まる。
  - `--upto M` で段 N〜M をまとめて頼むとき、途中で終わる門(C0=段 0・C2=段 2・C3=段 3〜4・C5=段 7)があれば止まる(門を人の確認なしに越えない)。C3 は段 3・4 をまとめて見る門なので `--stage 3 --upto 4` で作る(段 3 だけは断る)。最後の段が門なら、済んだあと `--publish-right <絵>`(C0 は描いた SVG、C2 は正面の絵。`--publish-views`・`--publish-sheet` も)でスマホに出す。
  - 済んだ段は `stage <id> <N> done`(門の無い段は `<N>.json` が auto で書かれる)。落ちた段は `failed`。部品は `creator/pipeline/review_gate.py`(K3 の CLI だけを呼ぶ)。
  - `--review auto`(既定: 状態があるときだけ見る)・`on`(状態が無ければ止める)・`off`(見ない。記録の `review` に off と残す)。夜の無人の試しは状態を作らずに流す(`review: none`)。
- 試験: `python -m unittest creator/skilltest/test_review_gate.py`(12 件。本当に stage_run を流す。人の判断は確認画面のサーバーと同じ `make_request` で作る)。壊した版 4 つ(素通り・範囲の門を見ない・門の途中で終わる範囲を許す・done にしない)で落ちることを確かめた。
- C3・C5 の画面はまだ無い(11-06)。確認の状態を作ったキャラは、段 3〜4 が済むと C3 の人の OK まで段 5 へ進めない(それが正しい止まり方)。
- `t07_talk.py` で作り直しを取り付けるとき、同じ言葉(`--words`)なら `origin`(生まれた時の記録)を変えない(前は `created` が今の時刻に書き換わった)。

## 落書き・手描きの絵 1 枚から(試しの道。2026-11-06 夜)
- `python creator/skilltest/doodle_run.py <絵 か フォルダ> --work <作業フォルダ> [--name <名前>] [--watch --until 07:00] [--dry-run]`。ゆるキャラチェック → ⓪ 描き直し(yc-0-draw の「絵から作るとき」、落書きの形と色を保つ)→ ①〜⑥(新しい文脈の Claude)→ ⑦ 話す → 参考に「落書きと 3D は同じキャラか」の判定。
- GPU の命令は環境変数 `YC_GPU_WRAP`(機械の札の道具で包む命令の頭、JSON の配列)を付けて流す。無ければ ⓪ のあとで止まる。作る役の頼みの文にも「GPU の命令はこの頭を付ける」と書いて渡す。
- 結果は `<作業>/<id>/result.md`・`result.json`。**「落書きからでも作れた」と言ってよいのは passed が true のときだけ**(全段 ok・check_all 全部 OK・話す確かめ ok)。人の落書きの絵そのものはリポジトリに入れない。
- 11-06 夜に確かめた所: 機械で描いた落書き風の試し絵(人の落書きではない。白い紙・ゆれた黒い輪郭・黄色の塗り・点の目)で、チェック 13 秒(yuru、3/3・3/3)→ ⓪ 129 秒 → ①〜⑥ 537 秒(check_all 全部 OK)→ ⑦ 13 秒(口 0.69・表情 2・動き 2)、**合計 12.1 分・定価に直した目安 1.97 ドル**で「通った」。判定は同じキャラ 3/3・3/3(落書きと比べても同じ)、色は Haiku 0/3・Sonnet 3/3。⓪ の判定「3D にしやすい」は Sonnet 0/3(縁のがたがた・手が無い)だったが、①〜⑥ は縁のがたがたも 3D にして通った。人の落書きでは未確認。試しで出来た builder・絵・キャラはリポジトリに入れず、作業フォルダの repo_files に移した。

## 時間と費用を残す(動画と README の数字の正本)
- 段を新しい文脈の Claude に頼むときは `creator/skilltest/stage_run.py claude …`、道具だけの段は `stage_run.py tool … -- <命令>`。1 段 = run.jsonl の 1 行。まとめは `stage_run.py sum --run <回>`。
- 置き場所(契約 K6): `creator/work/<id>/run.jsonl`(git に入らない)。重い途中の物はリポジトリの外の作業フォルダ。
- `cost_usd` は claude -p の `total_cost_usd`。**定額のプランで流したので、請求ではなく定価に直した目安**と必ず書く。主のセッションの中でした作業は測れないので数えない(null)。

## 実際に通した記録(2026-11-06、言葉から みかんちゃん)
- 言葉「みかんの子。まるくて元気。頭に葉っぱが 1 枚」。⓪ 215 秒(Sonnet 5.5、yc-0-draw だけ)→ ①〜⑥ 1,007 秒(Sonnet 5.5、talking-character と hand-built-character だけ)→ ⑦ 15 秒(t07_talk.py)。**合計 20.6 分・定価の目安 4.37 ドル**。
- ⓪ の 2.23 ドルのうち 1.53 ドルは判定役 12 回(手元の MCP と設定を読んでいた時)。判定に `--strict-mcp-config --setting-sources project` を付けた後は、①〜⑥ の判定 12 回で 0.11 ドルだった。
- check_all は GPU で全部 OK(描画役は GPU の D3D11)。話す確かめは仮の頭脳・声なしで OK(口 0.69、表情 happy・think、動き wave・bow)。
- 残った見た目の差: 口が元の絵の開いた笑い口より小さく、判定役に「鼻に見える」と言われた。つやと皮のつぶつぶは 3D に無い。
- 同じ夜に直した(r2、19:25〜19:41): builder の口と目を、元の SVG を変換込みで測った寸法にした(口 幅 88.2・深さ 45.9px、目 81.9×111.3px)。作り直し 26 秒・check_all 15 秒・話す確かめ 13 秒(GPU)。判定の「鼻」「口が無い」は 6/6 → 0/6。口の形の問い(`--part 口`)は Sonnet 3/3 はい・Haiku 0/3(「元より大きい」)。正面の絵で測ると、口の幅÷目の間は 元 0.518・後 0.521 で、ほぼ同じ。直し方は `hand-built-character` の「部品の寸法は元の SVG から」。

## 作例の判定のやり直し(2026-11-06 夜。結果の表は `creator/skilltest/結果表.md` の末尾)
- 撮り方: `creator/viewer/serve.py <空いた番号> --mount=/trial=<リポジトリ>/characters` を自分で起こし、`node creator/skilltest/shot_browser.mjs <番号> /trial/<id>/character.json <出力>/<id>/browser` を体ごとに流す。5 体を機械の札 1 本(`--minutes 10`)の中で撮って 13 秒。判定役(claude -p)は札の外で流す。404 は favicon だけで、絵には関係ない。
- 判定は `j01_judge.py` の `prepare` と `judge_many` を 5 体まとめて呼ぶと、Haiku は並べて Sonnet は 1 つずつ流れ、5 体で 146 秒・定価に直した目安 0.30 ドル。
- **「色」で落ちたら、まず D の行を読む。** 作例では、元の色そのものより、光(画面の目の発光・中から光るグラデーション)・つや・縁(ベゼル)の差を、判定役が「色」と答えていた。直すなら発光・つや・縁から。
- **比べの絵の並べ方(元の絵の余白)は、合否を変えなかった。** 元の絵の余白を切ってブラウザの正面と同じ割合で写しても、5 体の合否は全部同じで、動いたのは Haiku の数が 1 つずつだけ。みかんの「口が大きい」は余白を切っても残った。大きさの言い分は、目の間を物差しにした数字で確かめる(上の r2 の記録)。
- 同じ撮った絵を 2 回流すと、Haiku の数は 0〜1 動くことがある(robo の色 1→0 など)。合否の境目(2/3)にいる軸は、2 回流して両方を書く。

## 守ること
- 描く・作る・判定・調べものは Claude だけ。画像の取り込み(`<image>`)・ほかの AI・Megascans は使わない。
- 大きな PC で GPU を使うときは、命令ごとに機械の札で包む: `python <機械の札の道具>/machine_lock.py run --machine <機械> --kind gpu --who <流れ> --job "<中身>" --minutes <見込み> --wait <待てる分> -- <命令>`。終われば自動で返り、GPU の鍵も札が写す(11-06 夜、これで GPU の仕事を 3 本流した)。考えている間・判定を待つ間は札を持たない。今夜の順番は板の `GPUの順番.md`。ブラウザの道具は CPU の描画なら止まる。
- サーバーは自分で起こした PID だけを止める。claude と node を名前で止めない。
- できないことを、できると言わない。測った数字と、確かめていない事を分けて書く。
