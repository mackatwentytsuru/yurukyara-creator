---
name: web-ar-vr-modes
description: 同じ three.js ページを、画面・iPhone の AR(自作の殻アプリ)・Quest 3 の AR/VR で動かす切りかえ(place/web/modes.js)の使い方と、実機が無くても試せるやり方、調べて分かった制約。web/ に AR/VR を足す・殻アプリを直す・偽の殻で通し試験を書くときに使う。
---

# 画面 / AR / VR の切りかえ

## 呼び方(web/ 側)
```js
const modes = await createPresentation({ renderer, scene, camera, place, background, onViewer, onHit, onFloor, onChange });
mountModeButtons({ modes, container });
renderer.setAnimationLoop(() => { modes.frame(); renderer.render(scene, camera); });
// 殻の中なら: if (modes.available.ar_kind === 'native') await modes.enter('ar');
```
- `modes.available` = `{screen, ar, vr, ar_kind: 'webxr'|'native'|null}`。iPhone の Safari では ar も vr も false(WebXR が無いため)。殻の中だけ `native`。
- 入ると `<html data-presentation="ar|vr|screen">` が付き、AR では html と body の背景が透明(紫のグラデーションなどが別の要素にあれば `data-hide-in-ar`)。
- 殻の AR は、撮った部屋を現実に重ねる手順 `createAlignFlow`(床を 2 回タップ)を通す → `place.setAlignment`。

## 調べて分かったこと(出どころは docs/devlog_場所.md)
- iPhone の Safari に WebXR は無い(iOS 27.2 でも)。殻 = ARKit の上の透明な WKWebView。**ARKit が背面カメラを使うので、殻の中は getUserMedia の前面カメラと競合する見込み**(実機未検証)→ `?source=pose`(カメラを使わない人の入力)にする。
- Quest 3 は three.js の `renderer.xr` で immersive-ar / immersive-vr。`requiredFeatures` は 1 つでも満たせないと requestSession ごと失敗するので、機能は全部 `optionalFeatures`、入ったあと `session.enabledFeatures` を見る。マイクは入る前の 2D 画面で許可(session 中の許可は資料が無い)。DOM overlay は使えない。
- 頭の位置は render に渡す camera の `getWorldPosition()`(AR でも VR でも同じ)。

## 実機が無くても試す(偽物で端から端まで)
- `node --test`(`place/test/`): 偽の `navigator.xr`・偽の renderer で、機能一覧・背景の戻し方・モードの切りかえ・ボタン。
- `python place/tools/native_ar_check.py`: ヘッドレス Chrome に `window.webkit.messageHandlers.arhost` を差し、姿勢(`window.__arhost.onPose`)を送って、AR に入る→床 2 回タップで部屋が重なる→タップでキャラが動く、背景が透明、エラー 0 を見る。
- はまった所: アニメーションのループが、あとで `let` する変数を参照して起動直後に落ちる(TDZ)→ 先に `let x = null` を宣言。`html` と `body` の背景は、`body.ar html` では効かない(`html.ar, html.ar body`)。
- 実機で確かめた物と、偽物でだけ確かめた物は、devlog で分けて書く。
