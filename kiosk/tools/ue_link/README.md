# ue_link: 会話側(web/)と UE の入口キオスクをつなぐ、小さな道具

- `ue_shims.mjs` — UE の声の中継(voice-lab)の「頭」(OpenAI 互換)と「声」(VOICEVOX 互換)の席に座る代役。頭は会話側の `/api/chat`(`interview: true`)へ渡し、声は Windows の日本語の声(`haruka_wav.ps1`)で 24 kHz の WAV を作る(鳴らさない)。127.0.0.1 だけで待つ。`--log` に 1 往復 1 行(文字と ms だけ。音声・鍵は書かない)。
  `node kiosk/tools/ue_link/ue_shims.mjs --chat http://127.0.0.1:<会話側のポート> [--brain-port 8096] [--voice-port 50032] [--log turns.jsonl]`
- `video_gaze.py` — 録画の人をキャラの目で追わせる・校正を確かめる(カメラなし)。`make`(床のカメラの合成の録画を作る)・`play`(録画 → 検出 → 視線の橋 v1 → UDP。`--port` で UE の 5321 か、会話側のサーバーの `GAZE_UDP_PORT`。`--with-pixels` で校正の記録用の画素も送る)・`calib`(床の 6 点で校正し、校正に使わない 25 点で前後の誤差)・`stand`(仮想の客を床の 1 点に立たせて送り続ける。校正の画面 `kiosk/web/aim.html` の通し用)・`truth`(その点の本当の向き)・`evaluate`(渡した幾何と仮の値の誤差を 25 点で比べる)。
- 送り先は 2 通り: UE の入口キオスク(UDP 5321)と、会話側のブラウザの VRM(`web/README.md` の「入口の LED」。サーバーの `GAZE_UDP_PORT`)。形は同じ v1。
- 文字の質問を UE に言わせる: 中継の `POST http://127.0.0.1:5288/api/realtime/inject {"text": "..."}`(中継の写しの機能)。
- キャラの差し替え: UE の箱(`LV_sampleKiosk_Box`)のキャラは、UE のプロジェクトの `MakeDefaultCharacters()` の 1 行で替わる(人型が来たら DA を 1 つと 1 行)。この道具の側は変えなくてよい(視線は向き、口は音で渡すので、キャラに依らない)。
