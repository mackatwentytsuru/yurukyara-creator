# マイクとスピーカーを選ぶ(第 12 波 b。本人の案「PC だと、オーディオインターフェースが選ばれていなくて使えないこともある」)

(yc-7-talk の SKILL.md から移した節。元の文のまま)

- 形: 決まりは `web/src/conversation/audioDevices.js`(DOM なし。試験 `web/test/audio_devices.test.mjs`)、窓は `web/src/ui/audioPanel.js`(「声で話す」の横の歯車)。選んだ物はこのブラウザだけで覚える(localStorage `yc.audio.v1`。端末の id・名前・groupId・選んだ時に既定だったか `def`。音は入れない)。
- **ブラウザの聞き取り(Web Speech)は、OS かブラウザの既定のマイクしか使えない。** 既定でないマイクを選んだ時は、Listener が押すたびに `micPlan()` で道を決め、そのマイクの音(`getUserMedia({audio:{deviceId:{exact}}})`)を PC の聞き取り(/api/stt。`?stt=server` と同じ道)へ送る。PC の聞き取りが無い所(公開の版・faster-whisper の無い PC)では、既定のマイクで聞き「えらんだ マイクは、PC の ききとりが ないと つかえないよ。いまは いつもの マイクで きくね」と出す。選んだマイクが抜かれていたら(OverconstrainedError・NotFoundError)、頼まれた道と既定のマイクに戻して「えらんだ マイクが みつからないので…」。
- 既定のマイクの見分け: Chrome は一覧に `default`(既定)・`communications`・本物を出す。`default` と同じ groupId の本物は既定(Web Speech のままでよい)。`default` の無いブラウザ(Safari)は一覧の最初が既定。許可の前は一覧に id も名前も無いので、選んだ時の印 `def` で決める。窓の一覧では `communications` を出さない。
- 音が来ない時: Listener が押してからの音を見張り(`createSilenceWatch`。RMS 0.0025 を 1 回も越えないまま 7 秒)、`window` に `yc-mic-silent` を出す。窓が「こえが とどいていないみたい。マイクを えらびなおしてね」と「マイクを えらぶ」のボタンを字幕の上に出す。**キャラが話している間(聞き取りを止めている間)は数えない**(話し終えた直後に間違えて出さない)。1 回押すごとに 1 回だけ。文字で話す道はいつも残る。
- サーバーの聞き取りは、0.3 秒以上で音がほぼ 0(16bit で 64 未満)の区間を係に渡さず `{ text: '', ms: 0, silent: true }` と答える(`isSilentWav`。Whisper は無音から「ご視聴ありがとうございました」などを作りがち)。Listener は `silent` を見て同じ知らせを出す。0.3 秒より短い物は今までどおり係へ(前からの試験の 0.1 秒の無音の WAV のため)。
- スピーカー: `Speaker.setOutput(id)` が声の AudioContext の `setSinkId` に渡す(Chrome・Edge は 110 から。声・あいづち・「ピッ」は全部その 1 つの AudioContext から出る)。無いブラウザ(Safari・Firefox)では覚えるだけで既定から出し、窓は「この ブラウザでは、スピーカーを えらべないよ。PC の おとの せっていで えらんでね」。試しの音は窓が別の AudioContext で 2 つの音(ド・ミ)を鳴らす。
- 「はなしてみてね」: 窓の中で、ふだんと同じ Listener(同じ道の決まり)を 12 秒だけ動かし、聞こえた言葉を出す。ふだんの聞き取りが動いていれば先に止め(同じマイクを 2 つが取り合わないように)、窓を閉じた時に選んだマイクで入れ直す。
- 試し方: GPU の Chrome に `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` を付けると、許可の窓なしで偽のマイク(既定と、ほかに 2 つ)が出る。`--use-file-for-fake-audio-capture=<無音の WAV>` で「音がまったく来ないマイク」をまねできる(`web/scripts/audio-update-check.mjs`)。窓の置き方・大きさの決まりは render-device の「小窓」の節。
