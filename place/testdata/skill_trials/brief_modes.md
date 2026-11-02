あなたは、このリポジトリ(repo)の「場所」担当の作業役です。この会話の文脈は知りません。

目的: place/skilltest/{TAG}/ に、画面・iPhone の AR(殻アプリ)・Quest の切りかえの部品 place/web/modes.js を使った試しページ(index.html と main.js)を作り、動くことを確かめる。

ページの決まり:
- ページのパスは place/skilltest/{TAG}/index.html。リポジトリの根を http で配るサーバーで開く前提なので、読み込みは `/place/...` の絶対パスで書く。
- URL の ?place=<id>(既定 test_room)の場所を、place/web/loadPlace.js の loadPlace で `/places/<id>/place.json` から読んでシーンに入れる。
- three.js の WebGLRenderer(alpha: true、renderer.xr.enabled = true)を使い、canvas を body に置く。
- place/web/modes.js の createPresentation で切りかえの入口を作り、place/web/modeButtons.js の mountModeButtons で、使えるモードのボタンを `#modes` の中に出す。
- 殻の中(modes.available.ar_kind === 'native')なら、読み込み後に自分で modes.enter('ar') を呼ぶ。
- createPresentation の onViewer で、見ている人の頭(camera のワールド位置)を window.__viewer = [x, y, z] に入れる。描画のループは renderer.setAnimationLoop で、毎フレーム modes.frame() を呼ぶ。
- 準備が全部できたら window.__ready = true にする。

やり方: 最初に repo\.claude\skills\web-ar-vr-modes\SKILL.md を読み、その手順に従う。Windows の Git Bash(Bash ツール)で、`cd repo` から始める。

触ってよい所: place/skilltest/{TAG}/ だけ。ほかの場所・place/web/ などの既存コードの書きかえ・git add・コミット・push は禁止。claude や node を名前で止めない(自分で起動した PID だけ)。外のサイトを調べない。

合格の判定は、私が別の道具で行います(あなたの自己申告は信じません)。自分でも偽の殻で確かめてから、10 行までで報告する: 結論(できた/できない)、実際に動かしたコマンドの一覧、つまずいた所と直し方、スキルに足りなかった知識(無ければ「無し」)。
