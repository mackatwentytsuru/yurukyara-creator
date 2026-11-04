---
name: talking-character
description: 絵 1 枚から、ブラウザで話すキャラを作る入口の手順。お店の受付や案内に立つ、ゆるキャラ・ぬいぐるみ・ロボットを、3D の部品から組み、骨・目と口・動きを付けて、声と字幕で話すところまで進める。「この絵を話すキャラにしたい」「うちの店の案内キャラを作りたい」「マスコットを動かして喋らせたい」と言われたときに使う。
---

# 絵 1 枚から、話すキャラを作る

このリポジトリを開いた Claude Code が、人の手をできるだけ借りずに、絵から話すキャラまでを作る手順です。形を作る細かい技は `hand-built-character` スキルに書いてあります。

## 向いている物、まだ確かめていない物

- 向いている: 丸い頭と胴に短い手足の物、球や箱の胴の物、帽子のある物。硬い物(ロボット)。確認の根拠は `docs/カバー率.md`。
- まだ通らない: 毛足のある布の質感は、判定が安定して通らない。耳・たすき・くちばしなどの細かい部分は、作れるが元の絵と差が残る。
- 人の顔や人型の体は、この手順では質が出ない。先に使う人に伝える。

できないことをできると言わない。測った数字と、確かめていないことを、最後に分けて報告する。

途中のひとことも報告も、使う人の言葉で書く(日本語で頼まれたら日本語)。

## 1. 聞くことは 1 回にまとめる

最初に次の 3 つだけを聞く。答えがなければ、( )の既定で進めて、報告に書く。

1. 絵のファイル。**使う人が権利を持つ絵か**を確かめる。権利が分からない絵(有名なキャラなど)では作らない。
2. キャラの名前と、性格を一言(絵から決める)。
3. どこで、誰を迎えるか(お店の入口で、はじめて来た人を迎える)。

**鍵は聞かない。** チャットに貼ってもらわない。声や頭脳の鍵が要るときは、使う人に、自分の環境変数に設定してもらう(`web/README.md`)。鍵がなくても、仮の返事と口パクで試せる。

## 2. 環境を調べて設定する

```bash
python creator/setup/doctor.py --write
```

足りない物と直し方が出る。自分で直せる物(`pip install pillow numpy`、`cd web && npm install`)は直して、もう一度流す。Blender が見つからないときだけ、入っている場所を聞いて `--blender <実行ファイル>` で渡す。入っていなければ、入れてもらう(自分で入れない)。

判定役は、何も設定しなければ新しい文脈の Claude を使う。別の AI を使いたい人は `creator/pipeline/j01_judge.py` の先頭を見る。

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
- `web/` の build は `place/web/` を読む(`../../place/web/...`)。リポジトリの一部だけを写すときは `place/web` も入れる。
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
