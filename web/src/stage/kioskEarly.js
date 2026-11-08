// 接客モードの端末なら、最初の絵が出る前に html.is-kiosk を付ける(main.js は重い部品を読んでから動くので、それまでふつうの入口が見えてしまう)。
// 見つけ方は main.js と同じ(stage/kioskMode.js の resolveKiosk)。使えない端末では何もしない。
import { KIOSK_CLASS, resolveKiosk } from './kioskMode.js';

try {
  if (resolveKiosk({ search: location.search, storage: window.localStorage }).on) document.documentElement.classList.add(KIOSK_CLASS);
} catch {
  // 控えが読めない端末: URL に ?kiosk= があれば main.js が付ける
}
