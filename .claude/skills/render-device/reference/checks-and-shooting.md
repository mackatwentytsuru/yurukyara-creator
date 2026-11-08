# 撮影の前の用意(2026-11-07 S5w7b。撮影サーバー 8799)

(元の文のまま。確かめと撮影の用意の節を 1 つにまとめた)

- 順: 自分の線へ `git merge yurukyara-dev`(**合わせの後も司令塔のスキルのコミットで先へ進む。取り込んだ id を報告に書く**)→ CPU の札で `npx.cmd vite build`(サーバーは web/dist を配る。組み立て直さないと古い画面のまま)→ 確かめ(下)→ 撮影サーバー → https の入口。
- **default_check・layout_check・first_visit_check はサーバーを起こさない。** 道具ごとに空いた番号(8841〜8844 など)で鍵なしのサーバーを `start_server.mjs` で起こし、終わったらその PID だけを止める(続けて同じサーバーを使うと記憶の合鍵の上限で 429)。撮影サーバー(8799)では確かめを流さない(撮影の記憶のフォルダに試しの合鍵が増える)。https の入口だけは 8799 を通るので、流すと合鍵が 1 文脈に 1 つ増える(中身は空。7 日で消える)。
- **layout_check と default_check は `?auto=0` で開くので、初めての訪問の 7 歩は出ない。** 撮影の端末と同じ「何も付けない URL・初めてのブラウザ」は `node work\S5\tools\first_visit_check.mjs <web> <port> <出力> [--origin https://<スマホの入口>:8444]` で見る: 入口(製品の名前・7 歩の知らせ・7 歩はまだ出ていない)→「カメラなしで試す」→ 7 歩(7 つ・案内役ノリー)→ あとで(入口に戻らない・印 later)→ 読み込み直して 2 回目は出ない、と `/api/tts` の回数・404 の数。合否を出す(2/2 で合格)。
- 撮影サーバーの札: `machine_lock.py acquire --kind cpu --procs 1 --minutes 180`(手動の札は 180 分が上限)。**同じ who と kind でもう一度 acquire すると、その時から延びる**(新しい札は増えない)。`hold --watch-pid` は札の道具が前で待ち続けるので、裏で流せない時は使わない。

## スマホの https の道を確かめる
- 会話サーバーを鍵なしで 127.0.0.1 に立て、Tailscale の https の入口(本人が決めた番号)から開く。PC から `curl -s -o NUL -w "%{http_code} %{size_download}"` で、ページ・`/assets/index-*.js`・`/characters/<id>/character.json`・`model.glb`・`/api/status` が 200 かを見る。
- さらに GPU の Chrome で同じ https の URL を `?perf=1` で開くと、`window.isSecureContext` が true(マイクとカメラが使える)・`__perf.k6.device` が mobile になるのを確かめられる。iPhone の実機は本人。
- 終わったら、自分で起こしたサーバーの PID だけを `taskkill /PID <番号> /T /F` で止める。

## 画面を GPU の Chrome で確かめる時の落とし穴
- 入口のゲート(.gate)が画面を覆っている間は、下のボタン(引き出しなど)を押せない(Playwright の click が 30 秒待って落ちる)。先に `#startSim` を押す。
- はみ出しを数える時、閉じた details の中身にも Chrome は位置を返すことがある。`n.closest('details:not([open])')` の中は数えない(summary は数える)。開いた時は別に数える。
- 公開の URL のまねは、Playwright の `page.route` で `/api/status` を 404、`/api/chat` を K5 のまとめた JSON(`{brain, fallback, reason, notice, events, ms}`)にする。合言葉の欄が出ること・会話の見出し x-demo-pass に打った値が付き URL に無いこと・理由つきの知らせが 1 行だけ・返事・記憶の一覧の読み直し(GET /api/memory)を見られる。
- 鍵らしい文字の試しは、偽の文字を実行のときに組み立てる(例 `['ab','cd'].join('').repeat(12)`、48 字の英字)。/api/chat の本文に入っていないこと・短い知らせが出て消えることを見る。
- 点検の道具を `python -I` で流すと PYTHONIOENCODING が効かず、日本語が化ける。`python -I -X utf8 tools/prepush_check.py` で読める。
- (第 5 波)鍵の無いサーバーでは、あいづちの声が 0 種類で「あいづち」の札が出ず、上の札が 1 行のまま。本物のサーバーでは 2 行になって重なる。確かめでは「カメラなしで試す」の後に `window.__app.speaker.fillers = Array.from({ length: 5 }, () => ({ text: '', samples: new Float32Array(1), ms: 1 }))` で札を出す(板の道具 `work\S5\tools\layout_check.mjs` の `--fillers 5`。既定で出す)。
- (第 5 波)キャラの「見えている上の端」は、箱の 8 つの角を写すと遠近で角が上へ出る(PC で 40px ほど上)。確かめでは形の点(`getVertexPosition` で骨の動きも入る)を間引いて写す。見せ方の計算(frameCharacter)は箱で控えめに測ってよい。
- (第 5 波)1 つのサーバーに新しい文脈を続けて 10 回ほど開くと、記憶の合鍵を作る回数の上限(1 分あたり)で 429 がコンソールに出る。記憶を見ない確かめは `?memory=0` で開く。
- (第 5 波)GPU の札(--kind gpu)は、ほかの流れの動画の生成(--kind video)と同時に使えない。待つ間に CPU だけの仕事(試験・点検・コミット・札)を進める。Bash の道具は 10 分で裏へ回るので、長く待つ命令は裏で流し、終わりを待ってから報告する。
- (第 5 波)重なりと頭の位置と切り替えの確かめ: `node work\S5\tools\layout_check.mjs <web> <port> <出力> [--switch] [--only single|switch|others]`。幅 390・400・480・PC × 2D・3D で「覚えていること」が開くか・押せない所・44px 未満・頭のすき間・切り替えの有無、切り替え(押す → 読み込み直し → 戻す → 別の文脈)、ほかのキャラ(ようこそくん あり・みかんちゃん なし・ロボくん なし)を見て、絵と layout_check.json を出す。

## GPU の機械が埋まっている時は、別の機械の確認台で確かめる(2026-11-07 S5w9)
- 確認台の repo は読むだけ。そこから自分の写しを作る(`git clone --no-checkout <確認台の repo> <写し>`、node_modules は確認台の物へジャンクション、`web\public\mediapipe` は写す)。新しいコミットは `git bundle create x.bundle <確認台にある頭>..<線>`(差分だけ。100KB ほど)→ scp → 写しで `git fetch <bundle> <ref>:refs/remotes/<名前>/tip` → checkout。直す前の木も別の写しにすると、同じ道具で前と後を比べられる(命令の形は板の S5 の第 9 波の道具: setup の ps1・run の py)。
- .ps1 は UTF-8 の BOM を付ける(Windows PowerShell 5.1 は BOM の無い日本語を化かす)。ssh の命令に `$` も `&` も書かない(確認台の ssh は PowerShell 5.1。台本の中に書き、scp で送って `-File` で動かす)。
- bundle の土台は、確認台の repo に本当にあるコミットにする(`git cat-file -e <id>^{commit}` を台本で確かめる。第 10 波では確認台の repo の頭が 1b2f906 で、8fd8920・bbd1531 は無かった → `1b2f906..<線>` で 160KB)。
- 札は `machine_lock.py run --machine <確認台> --kind cpu --procs 4 --who <流れ> --job <中身> --minutes 50 --wait 45 -- ssh -n -o BatchMode=yes <確認台> "python -X utf8 <台本>"`(ほかの流れが使っている間は順番を待つ。終わると自動で返る)。描画役は内蔵 GPU の D3D11(SwiftShader ではない)。所要: 組み立て 2 秒・w9_check 43 秒・layout_check 58 秒・`YC_BROWSER_TESTS=1 npm test` 65 秒。
- 遅い端末のまねは CDP の `Emulation.setCPUThrottlingRate`(6)。見え方の確かめは、開く前に `page.addInitScript` で requestAnimationFrame ごとに(描くたび)要素の visibility と textContent を記録する(MutationObserver は描く前にも動くので、人に見えた物と合わない)。直す前の木で落ちるのを先に見る(S5w9: ノリーが 806ms・838ms に見えた)。
- 3 本の仮の合わせ(参照を動かさない): `T1=$(git merge-tree --write-tree A B)` → `C1=$(git commit-tree $T1 -p A -p B -m tmp)` → `T2=$(git merge-tree --write-tree $C1 C)` → `git archive $T2 | tar -x -C <板の一時のフォルダ>` → node_modules をジャンクションで借りて `node --test`。**消す前にジャンクションを `cmd /c rmdir` で外す**(外さずに消すと、借りた先の中身まで消える)。
