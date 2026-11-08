# いつ確認が出るか

このキャラ作りは、何でもいちいち聞きません。
読む・下書きする・点検する・絵を描く・変わる所を見せる・一覧を見る・自分の試験を流す、は、そのまま進みます。

## 確認が出る時

| いつ | 例 | 確認の回数 |
|---|---|---|
| キャラの話すことや、知っていることが変わる時 | 資料から案内を覚えさせる・話し方の文を手で直す | 1 回ごと |
| PC の外を読む時 | ホームページを読む | サイトごとに 1 回(「今後聞かない」を選べば 2 回目から出ない) |
| PC の中の、作業場所の外のファイルを読む時 | デスクトップの PDF を読む | 1 回ごと(資料を `creator/work/<id>/learn/` に入れれば出ない) |
| お金や、長い時間を使う時 | 3D にする(約 20 分。Claude の使える量をたくさん使う) | 1 回ごと |
| 戻しにくい時・PC の外へ出す時 | 消す・公開する・新しい版にする・前の版に戻す・作る画面を同じ Wi-Fi に開く | 1 回ごと |
| 鍵 | 鍵をチャットに貼った | 聞かずに止めます。「画面の鍵の欄に入れてください」と案内します |

確認の前には、何が起きるかと戻し方を 1 行で出し、「次に出る画面が、その確認です。」で結びます。
会話で別に「いい?」とは聞きません(同じことを 2 回聞きません)。

- 例(覚えさせる): 「この変わる所をこのはちゃんに覚えさせます。はい → すぐ、覚えたことで案内します。戻す → 『覚えたことを戻して』。次に出る画面が、その確認です。」
- 「覚えたことを戻して」は、確認なしで 1 つ前の版に戻します。戻す前の版も残すので、また戻せます。

## 初めての準備で、何回聞かれるか

キャラを作る → PDF と地図の写真で覚えさせる → ホームページ 1 つ、の道で、確認はおよそ 2〜3 回です(ホームページ 1 回・覚えさせる 1 回。3D まで作ると、もう 1 回)。

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

"Undo what you taught it" goes back one version without asking. The version it replaces is kept, so you can undo that too.

## How many asks in a first setup

Make a character, teach it from a PDF and a map photo, and read one web page: about 2-3 asks (one for the web page, one for teaching, one more if you make the 3D model).

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
