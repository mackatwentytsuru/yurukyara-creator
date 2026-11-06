---
name: make-character
description: 言葉か絵 1 枚から、ブラウザで話す 3D のゆるキャラを、7 段(⓪ 描く〜⑦ 話す)で作る入口。段の順・各段の命令・合格の確かめ・時間と費用の記録(run.jsonl)をまとめる。「言葉からキャラを作って」「この絵を話すキャラにして」「7 段を通して」と言われたとき、最初に読む。
---

# make-character: 言葉か絵から、話すゆるキャラまで(7 段の入口)

細かい手順は各段のスキルにある。ここは順番と、段の間で渡す物と、確かめの命令だけ。

| 段 | 何をする | 命令・スキル | 合格の確かめ |
|---|---|---|---|
| 入口(絵のとき) | ゆるキャラチェック | `yuru-check`(`c01_yuru_check.py`) | `class` が yuru なら ① へ。human は「ゆるキャラにしてみる?」→ ⓪、complex は別の絵か ⓪ |
| ⓪ 描く(言葉のとき) | 言葉 → SVG・PNG・設定 | `yc-0-draw`(`creator/draw/gen_<id>.py` → d01 → d02 → d04) | d02 が「不可 0」(部品は決まった `<g id>`)。PNG を 3 回以上見て直した |
| ① 見る | 部品・比率・色を読む | `hand-built-character` の 1〜2(PNG から測る。gen の座標をそのまま使わない) | 部品の一覧が builder の辞書 `D` になる |
| ②③④ 形・材質・模様 | Blender の Python で部品ごとに組む・色・顔 | `creator/builders/<id>.py`、`run_groups.sh`(目と口がシェイプキー)か `run_built.sh`(顔の表) | `check_all.sh` の ③ 埋まりと浮き・④ 抜け |
| ⑤⑥ 骨・動き | 部品ごとの骨、5 つの動き | `b07_rig_groups.py`(run_groups の中)、`pk01_package.py` → `pk02_check_character.py` | pk02 が OK、`check_all.sh` が「全部 OK」(GPU で) |
| 判定 | 作った担当以外の目 | `j01_judge.py`(Haiku・Sonnet 各 3 回)。直すのは 1 回だけ | 結果をそのまま記録(通らなくても) |
| ⑦ 話す | 取り付け・会話の画面で確かめ | `python creator/pipeline/t07_talk.py <pack> <id> --name … --out … --words "…"` | `web_check.json` の ok(読み込み・返事・口・表情か動き) |

## 時間と費用を残す(動画と README の数字の正本)
- 段を新しい文脈の Claude に頼むときは `creator/skilltest/stage_run.py claude …`、道具だけの段は `stage_run.py tool … -- <命令>`。1 段 = run.jsonl の 1 行。まとめは `stage_run.py sum --run <回>`。
- 置き場所(契約 K6): `creator/work/<id>/run.jsonl`(git に入らない)。重い途中の物はリポジトリの外の作業フォルダ。
- `cost_usd` は claude -p の `total_cost_usd`。**定額のプランで流したので、請求ではなく定価に直した目安**と必ず書く。主のセッションの中でした作業は測れないので数えない(null)。

## 実際に通した記録(2026-11-06、言葉から みかんちゃん)
- 言葉「みかんの子。まるくて元気。頭に葉っぱが 1 枚」。⓪ 215 秒(Sonnet 5.5、yc-0-draw だけ)→ ①〜⑥ 1,007 秒(Sonnet 5.5、talking-character と hand-built-character だけ)→ ⑦ 15 秒(t07_talk.py)。**合計 20.6 分・定価の目安 4.37 ドル**。
- ⓪ の 2.23 ドルのうち 1.53 ドルは判定役 12 回(手元の MCP と設定を読んでいた時)。判定に `--strict-mcp-config --setting-sources project` を付けた後は、①〜⑥ の判定 12 回で 0.11 ドルだった。
- check_all は GPU で全部 OK(描画役は GPU の D3D11)。話す確かめは仮の頭脳・声なしで OK(口 0.69、表情 happy・think、動き wave・bow)。
- 残った見た目の差: 口が元の絵の開いた笑い口より小さく、判定役に「鼻に見える」と言われた。つやと皮のつぶつぶは 3D に無い。

## 守ること
- 描く・作る・判定・調べものは Claude だけ。画像の取り込み(`<image>`)・ほかの AI・Megascans は使わない。
- 大きな PC で GPU を使う前に、機械の札(`machine_lock.py acquire --machine <名前> --kind gpu --vram 3`)と GPU の鍵(`gpu_lock.py acquire`)。ブラウザの道具は CPU の描画なら止まる。
- サーバーは自分で起こした PID だけを止める。claude と node を名前で止めない。
- できないことを、できると言わない。測った数字と、確かめていない事を分けて書く。
