---
name: mac-ios-build
description: PC から ssh で Mac の Xcode を使い、iPhone 用の小さな自作アプリ(SwiftUI + xcodegen)を署名なしで型確認し、署名つきで本人の iPhone に入れる手順と、実際にはまった所。iOS アプリ(場所スキャン・ARステージなど)を作る・直す・入れ直すときに使う。
---

# Mac で iOS アプリを作って iPhone に入れる

2026-11-02 に `place/ios/`(場所スキャン・ARステージ)で実際に通した手順。Mac は `ssh pc3`(Xcode 27.0、xcodegen あり)。

## 手順
1. ソースは `project.yml`(xcodegen)+ Swift のフォルダ。PC から `tar` で `~/sample_work/place_ios` へ送る(Mac の空きは少ないので、アプリのソースだけ)。
2. **型確認(署名なし、約 1 分)**: `sh place/ios/tools/mac_check.sh [RoomScan|ARStage]`。`xcodebuild … -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`。これで Swift のエラーは全部分かる。
3. **署名つきで iPhone へ**: 署名つきの組み立ては GUI のセッションでないと通らない。Mac の `~/sample_work/place_ios/` に `team.txt`・`device_id.txt`・`scheme.txt`(・ARStage は `url.txt`)を置き、`ssh pc3 'open ~/sample_work/place_ios/mac_install.command'`。`install.done` が `0` なら成功(約 1 分。`install.log` に全文)。
   - チーム ID: `security find-certificate -c "Apple Development: …" -p | openssl x509 -noout -subject` の `OU=`。
   - iPhone の UDID: `xcrun devicectl list devices` の `available (paired)` の行。**ケーブルなし(ネットワーク経由)でも入った**。ロック中・圏外だと `available` にならず、組み立てが終了コード 70(destination が見つからない)で止まる → 本人がロックを解いて同じ Wi-Fi にいるときにやり直す。
4. 入れたあと初回は、iPhone で カメラなどの許可と、必要なら 設定→一般→VPN とデバイス管理→開発元を信頼。

## はまった所と直し方
- `simd_float4x4` が「scope に無い」→ `import simd` を足す(RoomPlan だけでは足りない)。
- `RoomCaptureViewDelegate` を満たす入れ子のクラスで「nested class … has an unstable name when archiving via 'NSCoding'」→ クラスを外(トップレベル)に出す。
- Info.plist に自作のキー(`ARStageURL` など)を入れたいとき、`INFOPLIST_KEY_` では足りない → project.yml の `info: {path, properties}` に書き、値は `$(ARSTAGE_URL)` にして `xcodebuild ARSTAGE_URL=…` で渡す。
- 日本語の表示名・使用目的の文は project.yml の `INFOPLIST_KEY_CFBundleDisplayName` / `INFOPLIST_KEY_NS…UsageDescription` に直接書ける。
- Bash の heredoc で Swift を書くと、引用符で途中で止まることがある → ファイルは Write ツールで書く。

## 試し方
- 実機が無いうちは、型確認が通った所までを「できた」と書き、実機で見るまで「未確認」と書く。
- アプリが実際に動くかは、本人が iPhone で開いて見る。画面の手順は、スマホで読める短さの番号つきで司令塔へ送る。
