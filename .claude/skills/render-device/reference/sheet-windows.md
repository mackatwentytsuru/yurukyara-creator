# 小窓(「マイクと スピーカー」・アプリのアップデート)と上の段の印(第 12 波 b)

(元の文のまま)

- 窓は `web/src/ui/sheet.js` の `createSheet()`。**body の直下に置いて浮かせる**: 幅 1100 未満は画面の上(上の段にかぶせる。幅 min(100% - 24px, 560px))、幅 1100 以上は右(幅 380。キャラは真ん中なので横の範囲に重ならない)。
- 開いている間は、main.js の頭の線(`stage.state.topGuard`)を専用の塊で包み、`sheetGuard(left, right)`(キャラの横の範囲に重なる開いた窓の下の端 + 14px)を足す。窓が開いた・閉じた・中身の大きさが変わった・画面の大きさが変わった時に `reframe()` するので、キャラは窓の下へ置き直され、縦横の比は変わらない。
- **窓の高さには上限がある**: キャラの置き方(scene.js の placeCamera → framing.js の fitBand)は、上の線と下の帯を引いた残りが画面の高さの `MIN_USABLE`(30%)より少ないと、30% でキャラを描くので、キャラが窓と下の帯にはみ出す。窓の下の端は `画面の高さ × (1 - MIN_USABLE) - bottomInset` まで(`setSheetRoom`。中身は窓の中で動かして見る)。本物の iPhone の Safari(見える所 390x699)で、窓の高さ 200px・キャラの縦横そのまま・重なり 0 になった。
- **窓を下の帯(.bottom)の中に入れる案はだめだった**: 帯の高さが増えて fitBottom がキャラを置き直す、と読んだが、本物の iPhone の Safari では、帯の上の注意書き(カメラは使っていません…)と字幕の場所の「仮の頭脳です」まで押し上げてキャラの顔に重なり、上の段が 4 段で残りが 30% を割ってキャラは小さくならなかった(重なり 10,420 px²)。GPU の Chrome のまねより先に、本物の Safari で見たので気づけた。
- 開くのは 1 つずつ。Esc と「とじる」で閉じ、開いたボタンへ目印を戻す。**文字の入力欄に触れたら窓を閉じる**(その時は目印を戻さない。戻すと入力欄から外れてキーボードが閉じる)。
- 上の段の印「あたらしい はんが あります」は `.top .top-row` の最後に足す(main.js の TOP_BAR が数えるので、出ている時は頭がその下に入る)。隠れている間は 0 の四角で、`guardBottom` が数えない。幅 640 までは「あたらしい はん」の短い字。この PC の中(localhost)で、確かめが「新しい版がある」と答えた時だけ出るので、合わせの門の大きさの確かめ(新しい版が無い写し)には出ない。気になる時は `YURU_UPDATE_UI=0` で起こす。
- 歯車(`#ycAudioBtn`)は「声で話す」のすぐ後ろ(入力の列の中、幅 44。幅 390 の iPhone でも列に収まる)。テレビ表示では入力の列ごと隠れる。印・窓・知らせは `html.tv-mode` で `display: none`。音が来ない知らせは字幕の場所(.subs)に、ボタンを横に並べて低く出す(2 行 + ボタンを縦に積むと、キャラの足元に届いた)。
- **画面のコードに SVG の名前空間の住所(`http://www.w3.org/2000/svg`)を書くと、privacy の試験の「外の住所」に数えられる。** 印の SVG は、index.html の「声で話す」の SVG を `cloneNode(false)` で写して、形(d)だけ替える。
- 開き直した後の知らせ: 開き直すと入口(ゲート)から始まり、字幕の上の知らせは入口の裏で見えない。入口の札(.gate-card)の中に 1 行足し、入口を閉じた後(html から gate-up が外れた時)に字幕の上へも出す。
- iPhone の Safari では、押した瞬間(待つ前)に作らなかった AudioContext は止まったままで、メーターが動かない。メーターの音の部品は、歯車・許可・選び直しのボタンを押した瞬間に作って resume する。
- 確かめの道具 `web/scripts/audio-update-check.mjs`(GPU の Chrome): 390x670・390x844・1280x720・1920x1080・2D の見た目・テレビ表示で、窓・上の段・知らせがキャラの外の四角に重ならないか、キャラの縦横が 1280x720 の窓なしの 3% 以内か、字 14px 以上・押す所 40px 以上かを見る。偽のマイク(`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`)、無音の WAV で「音が来ない」、`--speech <WAV>` で「はなしてみてね」、Quest の UA のまね、`--host-resolver-rules=MAP yc-lan.test 127.0.0.1` で「PC の名前でない住所」。キャラの外の四角は、動きを止めて(update・lookAt・setMouth を空に)描いた絵の不透明な所(readPixels の α > 160)から取る(stage_size_browser の試験と同じ)。テレビ表示の「出ていない」は、要素の display ではなく `getClientRects()` が空かで見る(親ごと隠れる物があるため)。
- 本物の iOS Safari の確かめ: シミュレーターを作って boot し(iPhone 14・iOS 26.5 で幅 390)、`safaridriver` に WebDriver(`platformName: iOS`・`safari:useSimulator`・`safari:deviceUDID`)でつなぐ。押すのは JS の click、計りは execute/sync で上と同じ readPixels。終わったら safaridriver を番号で止め、端末を shutdown・delete。人の作ったシミュレーターは使わない。
- 0.0.0.0 で待つ試験は、防火壁の確認の窓を出すことがある(node の許しがあれば出ない)。「同じ Wi-Fi から開いた」まねは、Chrome の名前の付け替えで頁の名前と Host だけを替える(つないで来る所は 127.0.0.1 のまま。受け口は Host で断る)。
