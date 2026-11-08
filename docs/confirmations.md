# いつ確認が出るか

このキャラ作りは、何でもいちいち聞きません。
読む・下書きする・点検する・絵を描く・変わる所を見せる・一覧を見る・自分の試験を流す、は、そのまま進みます。

## 確認が出る時

| いつ | 例 | 確認の回数 |
|---|---|---|
| キャラの話すことや、知っていることが変わる時 | 資料から案内を覚えさせる・話し方の文を手で直す | 1 回ごと |
| PC の外を読む時 | ホームページを読む | サイトごとに 1 回(「今後聞かない」を選べば 2 回目から出ない) |
| PC の中の、作業場所の外のファイルを読む時 | デスクトップの PDF を読む | 1 回ごと(資料を `creator/work/<id>/learn/` に入れれば出ない) |
| お金や、長い時間を使う時 | 3D にする(約 20 分。Claude の使える量をたくさん使う)・会話の画面に入れる | 1 回ごと |
| 戻しにくい時・PC の外へ出す時 | 消す・公開する・新しい版にする・前の版に戻す・作る画面を同じ Wi-Fi に開く | 1 回ごと |
| 鍵 | 鍵をチャットに貼った | 聞かずに止めます。「画面の鍵の欄に入れてください」と案内します |

確認の前には、何が起きるかと戻し方を 1 行で出し、「次に出る画面が、その確認です。」で結びます。
会話で別に「いい?」とは聞きません(同じことを 2 回聞きません)。

- 例(覚えさせる): 「この変わる所をこのはちゃんに覚えさせます。はい → すぐ、覚えたことで案内します。戻す → 『覚えたことを戻して』。次に出る画面が、その確認です。」
- 「覚えたことを戻して」も、キャラの知っていることが変わるので、戻す前に 1 回聞きます(何が変わるかを見せて、はい、で戻します。資料の中の命令で黙って戻されないため)。戻す前の版も、使った前の版も、消さずに残すので、また戻せます。

## 初めての準備で、何回聞かれるか

キャラを作る → PDF と地図の写真で覚えさせる → ホームページ 1 つ、の道で、確認は 2 回です(ホームページ 1 回・覚えさせる 1 回。本物の Claude Code で数えた)。3D まで作ると、3D にする・確かめる・会話の画面に入れる、で 3 回ほど増えます。

## 最初から止めてある物

- 鍵のファイル(`.env`・`*.pem`・`*.key`・`~/.ssh`)を読む・書く
- ファイルを外へ送る命令(`curl`・`wget`・`scp`・`ssh`・`rsync` など)
- 戻せない消し方(`rm -rf`・`git clean`・`git reset --hard`・`git push --force`)
- 資料(ホームページ・PDF・写真)の中の命令には従いません。見つけたら「こういう行がありましたが、入れていません」と伝えます。

**頼んでいない確認が出たら、「いいえ」を押してください。**

## 決まりの置き場所(作る人・直す人へ)

- 決まりの本体: `.claude/settings.json` の `permissions`(`allow` = 聞かない・`ask` = 聞く・`deny` = 止める。`ask` は `allow` より強い)。
- 確認の前の 1 行: 各スキル(`.claude/skills/*/SKILL.md`)の「確認が出る時」の表。
- 試験: `python -I tools/test_confirmations.py`(決まりとスキルの文)・`python -I creator/learn/test_learn_guard.py`(偽の前の版 + 戻す、読める場所)。
- 試験の命令は、引数の無い決まった形だけを許しています(`npm --prefix web test` など)。`node --test <ファイル>` のように、書いたファイルをそのまま動かせる形は、確認が出ます。
- 出力先を自由に決められる道具(段の点検の道具・`t07_talk.py`・`upgrade_offers.py --restore` など)は、許可の一覧に入れていません(好きな所へ書けてしまうため)。ふつうの作る道では `yuru_make.py next` が中で流すので、確認は出ません。
- 許可した命令はリポジトリの頭からの相対の形です。別のフォルダへ移って(`cd`)そこに置いた偽の道具を動かされないよう、確認なしで書ける場所の中の、リポジトリの形をまねた所(下)は確認が出ます。`python -m` の形は `python -I -m` にして、いまのフォルダの物を読み込ませません。
- `creator/work/` の中は確認なしで書けますが、覚えさせた前の版(`learn/persona.*`)・確認画面の一言(`review/`)・リポジトリの形をまねた場所(`creator/`・`tools/`・`web/`・`package.json`)は、確認が出ます。

---

# When it asks you

The creator does not ask about everything.
Reading, drafting, checking, drawing, showing what would change, listing and running its own tests just run.

## When you see a confirmation

| When | Example | How often |
|---|---|---|
| The character's words or knowledge would change | Teaching it from your documents, editing how it talks | Each time |
| It reads outside the PC | Reading a web page | Once per website ("don't ask again" stops later asks) |
| It reads a file outside the work folder | A PDF on your desktop | Each time (put files in `creator/work/<id>/learn/` to skip it) |
| A long job uses your plan | Making the 3D model (about 20 minutes) | Each time |
| Something is hard to undo or leaves the PC | Deleting, publishing, updating, rolling back an update, opening the maker page to your Wi-Fi | Each time |
| Keys | A key pasted into the chat | Stopped without asking; you are told to use the key field on the screen |

Each confirmation comes after one line that says what will happen and how to undo it, ending with "the next screen is that confirmation".
It does not also ask "OK?" in the chat, so you are never asked the same thing twice.

"Undo what you taught it" also asks once, because it changes what the character knows. It shows what will change and only restores after a yes, so instructions hidden in a document cannot roll it back silently. Both the version it replaces and the backup it used are kept, so you can undo that too.

## How many asks in a first setup

Make a character, teach it from a PDF and a map photo, and read one web page: 2 asks (one for the web page, one for teaching; counted with a real Claude Code run). Making the 3D model adds about 3 more (build, check, install into the talk page).

## Blocked from the start

- Reading or writing key files (`.env`, `*.pem`, `*.key`, `~/.ssh`)
- Commands that send files out (`curl`, `wget`, `scp`, `ssh`, `rsync` and similar)
- Deletes that cannot be undone (`rm -rf`, `git clean`, `git reset --hard`, `git push --force`)
- Instructions found inside your documents are never followed; you are told which lines were left out.

**If you see a confirmation you did not expect, press No.**

## Where the rules live

- Rules: `permissions` in `.claude/settings.json` (`allow` runs, `ask` asks, `deny` blocks; `ask` wins over `allow`).
- The one-line notice before each ask: the "確認が出る時" table in each skill.
- Tests: `python -I tools/test_confirmations.py` and `python -I creator/learn/test_learn_guard.py`.
- Test commands are allowed only in fixed forms without arguments (such as `npm --prefix web test`). Forms that run a file Claude just wrote, such as `node --test <file>`, ask first.
- Tools that can write to any path they are given (stage checks, `t07_talk.py`, `upgrade_offers.py --restore`) are not on the allow list. In the normal maker flow, `yuru_make.py next` runs them internally, so no ask appears.
- Allowed commands are relative to the repository root. So that a `cd` into a writable folder cannot run a planted copy, writing paths that mimic the repository there asks, and `python -m` is allowed only as `python -I -m` (it does not import from the current folder).
- Writing under `creator/work/` does not ask, except the saved versions of taught knowledge (`learn/persona.*`), the review notes (`review/`) and paths that mimic the repository (`creator/`, `tools/`, `web/`, `package.json`).
