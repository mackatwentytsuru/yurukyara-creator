// 初めての会話(fr-)と性格の画面(yp-)の見た目。JS の文字にして <style> で 1 回だけ入れる(vite でも、そのままのブラウザでも同じに動く)。
// 色は会話の画面(ui/style.css)の変数を使い、無いときの色も書く。幅 390px のスマホと PC の両方で、横にはみ出さない・押す所は 44px 以上。

export const CSS = `
.fr-sheet, .yp-panel { --fr-ink: var(--ink-2, #1d1a2e); --fr-text: var(--text, #f4f1fb); --fr-muted: var(--muted, #b2abc9);
  --fr-line: var(--line, rgba(255,255,255,0.12)); --fr-lav: var(--lav, #b7a8ff); --fr-coral: var(--coral, #ff8f7a);
  --fr-mint: var(--mint, #7be0c3); --fr-warn: var(--warn, #ffd37a);
  font-family: var(--font, "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", Meiryo, system-ui, sans-serif); color: var(--fr-text); }
.fr-sheet *, .yp-panel * { box-sizing: border-box; }
.fr-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto;
  max-height: min(80vh, max(58vh, 440px), 760px); width: 100%; background: rgba(23, 20, 38, 0.94);
  border: 1px solid var(--fr-line); border-bottom: 0; border-radius: 22px 22px 0 0; box-shadow: 0 -12px 40px rgba(0,0,0,0.45);
  padding-bottom: env(safe-area-inset-bottom, 0px); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
/* スマホ: 札は画面の 58%(最低 440px)まで。上の段と札の間に、案内役(主役)の顔が見えるように(CRITux 16。1 歩目は 72% を覆っていた) */
@supports (height: 1dvh) { .fr-sheet { max-height: min(80dvh, max(58dvh, 440px), 760px); } }
.fr-head { grid-row: 1; padding: 12px 14px 8px; display: grid; gap: 8px; border-bottom: 1px solid var(--fr-line); }
.fr-pin { grid-row: 2; margin: 0; padding: 8px 14px; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: center; border-bottom: 1px solid var(--fr-line); }
.fr-pin[hidden] { display: none; }
.fr-pin-img { display: block; width: 72px; height: 72px; object-fit: contain; border-radius: 12px; background: #fff; }
.fr-pin-frame { width: 96px; height: 96px; }
.fr-pin-frame .fr-frame { width: 96px; height: 96px; border-radius: 12px; }
.fr-pin-cap { font-size: 13px; line-height: 1.5; color: var(--fr-muted); overflow-wrap: anywhere; }
.fr-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.fr-title h2 { margin: 0; font-size: 16px; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fr-close { flex: none; font: inherit; font-size: 14px; min-height: 44px; min-width: 64px; padding: 0 14px; border-radius: 999px; cursor: pointer;
  color: var(--fr-muted); background: transparent; border: 1px solid var(--fr-line); }
.fr-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.fr-steps li { display: grid; justify-items: center; gap: 2px; min-width: 0; color: var(--fr-muted); }
.fr-steps li span { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700;
  border: 1px solid var(--fr-line); background: rgba(255,255,255,0.04); }
/* 行の高さを決めて下に 1px 空ける(幅 390 で「7 声」の「声」の下が切れて「芦」に見えた。CRITux2 低 9。行の高さが normal のままだと、
   字の形が行の箱からはみ出し、はみ出しを隠す設定で切れる) */
.fr-steps li b { font-size: 10px; font-weight: 500; line-height: 1.5; padding-bottom: 1px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fr-steps li.done span { background: rgba(123,224,195,0.2); border-color: var(--fr-mint); color: var(--fr-mint); }
.fr-steps li.now span { background: linear-gradient(135deg, #7d62ff, #c15bff); border-color: transparent; color: #fff; }
.fr-steps li.now { color: var(--fr-text); }
.fr-steps li.skip span { opacity: 0.45; text-decoration: line-through; }
.fr-log { grid-row: 3; overflow-y: auto; overscroll-behavior: contain; padding: 12px 14px; display: grid; align-content: start; gap: 10px; min-height: 96px; }
.fr-line { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 8px; align-items: start; }
.fr-who { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-size: 14px; font-weight: 700; color: #1b1630; }
.fr-line.guide .fr-who { background: var(--fr-coral); }
.fr-line.char .fr-who { background: var(--fr-mint); }
.fr-bubble { min-width: 0; padding: 9px 12px; border-radius: 4px 16px 16px 16px; background: rgba(255,255,255,0.07); border: 1px solid var(--fr-line); }
.fr-line.char .fr-bubble { border-color: rgba(123,224,195,0.45); }
.fr-name { display: block; font-size: 12px; color: var(--fr-muted); margin-bottom: 2px; }
.fr-text { margin: 0; font-size: 16px; line-height: 1.6; overflow-wrap: anywhere; min-height: 1.6em; }
.fr-line.user { grid-template-columns: minmax(0, 1fr); justify-items: end; }
.fr-line.user .fr-bubble { max-width: 85%; border-radius: 16px 4px 16px 16px; background: rgba(125,98,255,0.24); border-color: rgba(183,168,255,0.45); }
.fr-pic { display: block; max-width: 100%; max-height: 160px; margin-top: 6px; border-radius: 10px; object-fit: contain; background: #fff; }
.fr-frame-wrap { display: grid; }
.fr-frame { display: block; width: 100%; height: min(400px, 48vh); border: 1px solid var(--fr-line); border-radius: 14px; background: #1d1a2e; }
.fr-sheet[data-actions="frame"], .fr-sheet[data-actions="frame"][data-step] { max-height: min(88vh, 760px); }
@supports (height: 1dvh) { .fr-sheet[data-actions="frame"], .fr-sheet[data-actions="frame"][data-step] { max-height: min(88dvh, 760px); } .fr-frame { height: min(400px, 48dvh); } }
.fr-note { margin: 0 0 0 40px; font-size: 13px; line-height: 1.55; color: var(--fr-muted); overflow-wrap: anywhere; }
.fr-actions { grid-row: 4; padding: 10px 14px 14px; display: grid; gap: 8px; border-top: 1px solid var(--fr-line); }
/* 1 歩目: 写真と絵は 2 つ並べて、札を低くする(言葉の欄は 1 行に) */
.fr-sheet[data-actions^="photo pick words"] .fr-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.fr-sheet[data-actions^="photo pick words"] .fr-actions > .fr-wide, .fr-sheet[data-actions^="photo pick words"] .fr-actions > .fr-link { grid-column: 1 / -1; }
.fr-sheet[data-actions^="photo pick words"] .fr-link { min-height: 44px; font-size: 14px; padding: 6px 12px; }
.fr-link { text-decoration: none; }
/* スマホ: 選んだ絵は小さく、「近い見本がいない」の選択肢と見本の一覧は 2 つずつ並べて、会話の欄を広く残す
   (幅 390 で、絵と 4 つのボタンが札を埋め、「ごめんね…」が見えなかった。CRITux2 中 2) */
@media (max-width: 719px) {
  .fr-pin { padding: 6px 14px; gap: 8px; }
  .fr-pin-img { width: 52px; height: 52px; border-radius: 10px; }
  .fr-sheet[data-actions*="choose_sample"] .fr-actions, .fr-sheet[data-actions^="s_"] .fr-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .fr-sheet[data-actions*="choose_sample"] .fr-link { font-size: 14px; }
}
.fr-actions:empty { display: none; }
.fr-btn { position: relative; font: inherit; font-size: 16px; min-height: 48px; width: 100%; padding: 10px 14px; border-radius: 14px; cursor: pointer;
  color: var(--fr-text); background: rgba(255,255,255,0.06); border: 1px solid var(--fr-line); display: flex; align-items: center; justify-content: center;
  text-align: center; line-height: 1.35; overflow-wrap: anywhere; }
.fr-btn.primary, .yp-save { background: linear-gradient(135deg, #7d62ff, #c15bff); border: 0; font-weight: 700; color: #fff; }
.fr-btn:focus-visible, .fr-close:focus-visible, .fr-field input:focus-visible, .yp-panel button:focus-visible, .yp-panel input:focus-visible,
.fr-btn:focus-within { outline: 2px solid var(--fr-lav); outline-offset: 2px; }
.fr-btn:disabled { opacity: 0.5; cursor: wait; }
.fr-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; clip: rect(0 0 0 0); }
.fr-field { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: stretch; margin: 0; }
.fr-field input[type="text"], .fr-field input[type="password"], .yp-panel input[type="text"] { font: inherit; font-size: 16px; min-height: 48px; min-width: 0; width: 100%;
  padding: 10px 12px; border-radius: 12px; color: var(--fr-text); background: rgba(0,0,0,0.25); border: 1px solid var(--fr-line); }
.fr-field .fr-btn { width: auto; min-width: 88px; }
.fr-field-label { font-size: 13px; color: var(--fr-muted); margin: 2px 0 -2px; }
.fr-count { font-size: 12px; color: var(--fr-muted); text-align: right; margin: -4px 2px 0; }
.fr-count.over { color: var(--fr-warn); }
.fr-remember { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 14px; color: var(--fr-muted); }
.fr-remember input { width: 22px; height: 22px; }
.fr-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.fr-launch { font: inherit; font-size: 13px; padding: 9px 14px; min-height: 40px; border-radius: 999px; cursor: pointer; color: var(--text, #f4f1fb);
  background: var(--glass, rgba(24,21,40,0.62)); border: 1px solid var(--line, rgba(255,255,255,0.12)); }
.fr-launch.floating { position: fixed; top: max(12px, env(safe-area-inset-top)); right: 12px; z-index: 6; }
/* PC: 右の札にして、真ん中のキャラを隠さない。下の帯(会話の欄と「送る」。高さ --bottom-h は main.js が測る)の上に置き、
   上の段(--top-h)との間に収める(1280×720 で「送る」が札の下に隠れていた。CRITux 14) */
@media (min-width: 720px) {
  .fr-sheet, .fr-sheet[data-step], .fr-sheet[data-actions="frame"], .fr-sheet[data-actions="frame"][data-step] { left: auto; right: 16px;
    bottom: calc(var(--bottom-h, 0px) + 12px); width: min(460px, calc(100vw - 32px)); border-radius: 22px; border-bottom: 1px solid var(--fr-line);
    max-height: min(760px, calc(100vh - var(--top-h, 64px) - var(--bottom-h, 0px) - 48px)); }
  @supports (height: 1dvh) { .fr-sheet, .fr-sheet[data-step], .fr-sheet[data-actions="frame"], .fr-sheet[data-actions="frame"][data-step] {
    max-height: min(760px, calc(100dvh - var(--top-h, 64px) - var(--bottom-h, 0px) - 48px)); } }
  .fr-pin-img { width: 88px; height: 88px; }
  .fr-pin-frame, .fr-pin-frame .fr-frame { width: 120px; height: 120px; }
  /* 作る画面の枠は、札の高さの中に収める(1280×720 でも「直したい」まで見えるように。作る画面は横に並べる。CRITux 22) */
  .fr-sheet[data-actions="frame"] .fr-log { min-height: 64px; }
  .fr-actions .fr-frame { height: clamp(220px, calc(100vh - var(--top-h, 64px) - var(--bottom-h, 0px) - 250px), 400px); }
  .fr-actions { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
  .fr-actions > .fr-field, .fr-actions > form, .fr-actions > .fr-wide { grid-column: 1 / -1; }
  .fr-steps li b { font-size: 11px; }
}

/* 性格の画面 */
.yp-back { position: fixed; inset: 0; z-index: 40; background: rgba(12, 10, 22, 0.6); display: grid; place-items: end center; }
.yp-panel { position: relative; width: 100%; max-height: 92dvh; max-height: 92vh; overflow-y: auto; overscroll-behavior: contain; background: var(--fr-ink);
  border: 1px solid var(--fr-line); border-radius: 22px 22px 0 0; padding: 14px 14px calc(14px + env(safe-area-inset-bottom, 0px)); display: grid; gap: 14px; }
@supports (height: 1dvh) { .yp-panel { max-height: 92dvh; } }
.yp-panel h2 { margin: 0; font-size: 18px; letter-spacing: 0.04em; }
.yp-lead { margin: -8px 0 0; font-size: 13px; color: var(--fr-muted); line-height: 1.5; }
.yp-group { border: 0; margin: 0; padding: 0; display: grid; gap: 8px; min-width: 0; }
.yp-group legend, .yp-label { padding: 0; font-size: 14px; font-weight: 700; color: var(--fr-text); margin-bottom: 6px; }
.yp-presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.yp-choice { font: inherit; text-align: left; min-height: 56px; padding: 8px 10px; border-radius: 14px; cursor: pointer; color: var(--fr-text);
  background: rgba(255,255,255,0.05); border: 1px solid var(--fr-line); display: grid; gap: 2px; min-width: 0; }
.yp-choice b { font-size: 15px; }
.yp-choice small { font-size: 12px; color: var(--fr-muted); line-height: 1.4; overflow-wrap: anywhere; }
.yp-choice[aria-checked="true"], .yp-seg button[aria-checked="true"] { border-color: var(--fr-lav); background: rgba(125,98,255,0.28); }
.yp-seg { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.yp-seg.yp-tones { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.yp-seg[data-locked="true"] button { cursor: not-allowed; }
.yp-seg[data-locked="true"] button:not([aria-checked="true"]) { opacity: 0.4; }
.yp-tone-lock { color: var(--fr-text); }
.yp-tone-lock[hidden] { display: none; }
.yp-seg button { font: inherit; font-size: 14px; min-height: 44px; padding: 6px 4px; border-radius: 12px; cursor: pointer; color: var(--fr-text);
  background: rgba(255,255,255,0.05); border: 1px solid var(--fr-line); overflow-wrap: anywhere; }
.yp-ending { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; align-items: center; font-size: 14px; color: var(--fr-muted); }
.yp-ending[hidden] { display: none; }
.yp-energy-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 0; }
.yp-energy-head output { font-size: 14px; font-weight: 500; color: var(--fr-lav); }
.yp-energy input { display: block; width: 100%; min-height: 36px; margin: 0; accent-color: #9b7dff; }
.yp-voices { display: grid; gap: 6px; }
.yp-voices .yp-choice { min-height: 48px; }
.yp-sub { display: grid; grid-template-columns: 4.5em minmax(0, 1fr); gap: 8px; align-items: center; font-size: 13px; color: var(--fr-muted); }
.yp-try { position: sticky; top: -14px; z-index: 2; display: grid; gap: 6px; padding: 10px; border-radius: 16px; background: #15122a;
  border: 1px solid rgba(183,168,255,0.35); box-shadow: 0 8px 18px rgba(0,0,0,0.35); }
.yp-try-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.yp-try-row button { font: inherit; font-size: 15px; min-height: 48px; padding: 0 12px; border-radius: 12px; cursor: pointer; color: var(--fr-text);
  background: rgba(255,255,255,0.08); border: 1px solid var(--fr-lav); }
.yp-reply { margin: 0; min-height: 3.2em; font-size: 16px; line-height: 1.6; overflow-wrap: anywhere; }
.yp-reply-name { display: block; font-size: 12px; color: var(--fr-muted); }
.yp-note { margin: 0; font-size: 12px; line-height: 1.5; color: var(--fr-muted); }
.yp-panel details { font-size: 13px; color: var(--fr-muted); }
.yp-panel summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; }
.yp-panel pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.5; margin: 0; padding: 8px; border-radius: 10px; background: rgba(0,0,0,0.3); }
.yp-foot { position: sticky; bottom: -14px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; padding: 10px 0 2px; background: var(--fr-ink); }
.yp-foot button { font: inherit; font-size: 15px; min-height: 48px; border-radius: 14px; cursor: pointer; color: var(--fr-text); background: rgba(255,255,255,0.06); border: 1px solid var(--fr-line); }
.yp-foot .yp-save { background: linear-gradient(135deg, #7d62ff, #c15bff); border: 0; font-weight: 700; color: #fff; }
@media (min-width: 720px) {
  .yp-back { place-items: center; }
  .yp-panel { width: min(600px, calc(100vw - 32px)); border-radius: 22px; max-height: 88vh; }
  .yp-presets { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .yp-seg.yp-tones { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
/* 初めての会話の間は、会話の画面の入口(ゲート)を消して、舞台のキャラを見せる(本物の画面の写真で、ゲートがキャラを隠していた)。
   閉じた後も、カメラなしの入力が始まって main.js が入口を隠すまでは消したまま(fr-after。入口を出し直さない。D4) */
html.fr-open .gate, html.fr-after .gate { opacity: 0 !important; pointer-events: none !important; }
/* 初めての会話の間は「Claude の考え」を隠す(会話は札に出る)。スマホでは考えの欄が上の段のボタンに重なり、
   PC(1280×720)では札が考えの箱に重なっていた(CRITux 14) */
html.fr-open .thought { display: none !important; }
/* 見本の子が舞台にいる間も、見た目の切り替え(#lookSwitch)は隠さない。main.js が舞台の子ごとに作り直し、片方の見た目だけの子では隠す */
/* PC で札(右)が開いている間は、舞台の絵を札の左までにする(キャラは札の左の真ん中に立つ。幅の広い見本の右の端が札に隠れていた。
   CRITux2 低 13)。札の左の端 = 右から 16px + 札の幅 min(460px, 100% - 32px)、そこからさらに 16px 空ける。index.js の fitStage が付け外しする */
@media (min-width: 720px) { html.fr-side #stage { width: calc(100% - 32px - min(460px, 100% - 32px)); } }
@media (prefers-reduced-motion: reduce) { .fr-sheet *, .yp-panel * { transition: none !important; animation: none !important; } }
`;

/** <style> を 1 回だけ入れる */
export function injectStyles(doc = document) {
  if (doc.getElementById('yc-firstrun-style')) return;
  const s = doc.createElement('style');
  s.id = 'yc-firstrun-style';
  s.textContent = CSS;
  doc.head.append(s);
}
