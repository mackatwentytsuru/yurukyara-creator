// 初めての会話(fr-)と性格の画面(yp-)の見た目。JS の文字にして <style> で 1 回だけ入れる(vite でも、そのままのブラウザでも同じに動く)。
// 色は会話の画面(ui/style.css)の変数を使い、無いときの色も書く。幅 390px のスマホと PC の両方で、横にはみ出さない・押す所は 44px 以上。
// 初めての会話は LINE のような会話の札(11/8 本人): 左に案内役の吹き出し(顔つき)、右に使う人の吹き出し、いちばん下にすぐ押せる札。
//   スマホ(幅 720px まで)の形は 2 つ。data-layout="sheet" = キャラの下に札(舞台の絵は札の上に収める。html.fr-stack)、
//   data-layout="overlay" = キャラの下の方に会話を重ねる(上へ向かって薄くなる。押す札は不透明)。PC と iPad は右の横の札。

export const CSS = `
.fr-sheet, .yp-panel { --fr-ink: var(--ink-2, #1d1a2e); --fr-text: var(--text, #f4f1fb); --fr-muted: var(--muted, #b2abc9);
  --fr-line: var(--line, rgba(255,255,255,0.12)); --fr-lav: var(--lav, #b7a8ff); --fr-coral: var(--coral, #ff8f7a);
  --fr-mint: var(--mint, #7be0c3); --fr-warn: var(--warn, #ffd37a); --fr-bg: #171426;
  font-family: var(--font, "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", Meiryo, system-ui, sans-serif); color: var(--fr-text); }
.fr-sheet *, .yp-panel * { box-sizing: border-box; }
.fr-steps li b { line-height: 1.5; }
.fr-sr, .fr-steps, .fr-title h2, .fr-field-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: 0; padding: 0; }

/* ---------- 札(スマホ: 画面の下。高さは見える高さの 58%) ---------- */
.fr-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; flex-direction: column; width: 100%;
  height: clamp(300px, 62vh, 660px); background: var(--fr-bg); /* 不透明(WebKit で後ろの文字が透けた。P1) */
  border: 1px solid var(--fr-line); border-bottom: 0; border-radius: 22px 22px 0 0; box-shadow: 0 -12px 40px rgba(0,0,0,0.45); overflow: hidden; }
@supports (height: 1dvh) { .fr-sheet { height: clamp(300px, 62dvh, 660px); } }

/* 上の細い段: 絵の欄(小さな絵)・あと いくつ・あとで。巻いても流れない */
.fr-head { flex: none; position: relative; padding: 4px 10px 6px 14px; border-bottom: 1px solid var(--fr-line); background: var(--fr-bg); z-index: 2; }
/* 作る画面の頭(CU): 1 行目 = 見出し「キャラを つくる」と、右に「おしゃべりに もどる」。2 行目 = あと いくつ・何分 */
.fr-title { display: flex; flex-wrap: wrap; align-items: center; column-gap: 10px; row-gap: 0; min-width: 0; }
.fr-title h2 { position: static; width: auto; height: auto; clip: auto; overflow: visible; flex: 1 1 auto; min-width: 0; font-size: 17px; letter-spacing: 0.04em; white-space: nowrap; }
.fr-left { order: 3; flex: 1 1 100%; min-width: 0; margin: 0; display: flex; align-items: baseline; gap: 8px; font-size: 15px; line-height: 1.3; color: var(--fr-muted); white-space: nowrap; overflow: hidden; }
.fr-left b { font-weight: 800; color: var(--fr-mint); font-size: 16px; }
.fr-left span { font-size: 14px; }
.fr-left b:empty, .fr-left span:empty { display: none; }
.fr-bar { position: absolute; left: 14px; right: 14px; bottom: 3px; height: 3px; border-radius: 3px; background: rgba(255,255,255,0.10); overflow: hidden; }
.fr-bar i { display: block; height: 100%; width: 0; border-radius: 3px; background: linear-gradient(90deg, var(--fr-mint), #9b7dff); transition: width 0.4s ease; }
.fr-close { flex: none; font: inherit; font-size: 15px; min-height: 44px; min-width: 72px; padding: 0 16px; border-radius: 999px; cursor: pointer;
  color: var(--fr-text); background: rgba(255,255,255,0.06); border: 1px solid var(--fr-line); }
.fr-pin { flex: none; margin: 0; display: flex; align-items: center; gap: 8px; }
.fr-pin[hidden] { display: none; }
.fr-pin-img { display: block; width: 40px; height: 40px; object-fit: contain; border-radius: 10px; background: #fff; }
.fr-pin-frame { width: 48px; height: 48px; }
.fr-pin-frame .fr-frame { width: 48px; height: 48px; border-radius: 10px; }
.fr-pin-cap { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* 会話の欄: 吹き出しは下に寄せる(LINE のように、いちばん新しい吹き出しが押す札のすぐ上)。古い吹き出しは中で巻ける */
.fr-log { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 6px 12px 6px; display: flex; flex-direction: column; gap: 6px; }
.fr-log > :first-child { margin-top: auto; }
.fr-line { display: grid; grid-template-columns: 36px minmax(0, 1fr); column-gap: 8px; align-items: start; }
.fr-line.cont .fr-who { visibility: hidden; height: 0; }
.fr-line.cont .fr-name { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.fr-who { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 15px; font-weight: 800; color: #1b1630; background: var(--fr-mint); }
.fr-line.guide .fr-who:not(.fr-face), .fr-line.note .fr-who:not(.fr-face) { background: var(--fr-coral); }
.fr-bubble { justify-self: start; min-width: 0; max-width: min(100%, 520px); padding: 7px 14px 8px; border-radius: 6px 18px 18px 18px; background: #2c2845; border: 1px solid rgba(255,255,255,0.07); }
.fr-line.cont .fr-bubble { border-radius: 18px; }
.fr-line.char .fr-bubble { background: #213a37; border-color: rgba(123,224,195,0.40); }
.fr-line.note .fr-bubble { background: #26233b; border: 1px dashed rgba(183,168,255,0.40); }
.fr-name { display: block; font-size: 16px; font-weight: 700; color: var(--fr-muted); margin: 0 0 1px; }
.fr-text { margin: 0; font-size: 16px; line-height: 1.55; overflow-wrap: anywhere; min-height: 1.55em; }
.fr-text .wd { margin-left: 0; }
.fr-line.user { grid-template-columns: minmax(0, 1fr); justify-items: end; }
.fr-line.user .fr-bubble { justify-self: end; max-width: 82%; border-radius: 18px 6px 18px 18px; background: linear-gradient(135deg, #7d62ff, #a35bff); border: 0; color: #fff; }
.fr-pic { display: block; max-width: 100%; max-height: 120px; margin-top: 6px; border-radius: 10px; object-fit: contain; background: #fff; }
/* 主役の顔(CSS の小さな絵。案内役が主役の時の、吹き出しの左) */
.fr-face { position: relative; overflow: hidden; background: #3a3156; }
.fr-face i { position: absolute; display: block; }
.fr-face .ff-ear { top: 3px; width: 11px; height: 14px; border-radius: 50% 50% 40% 40%; background: #5b463c; }
.fr-face .ff-ear.ff-l { left: 6px; transform: rotate(-16deg); }
.fr-face .ff-ear.ff-r { right: 6px; transform: rotate(16deg); }
.fr-face .ff-head { left: 5px; top: 7px; width: 26px; height: 25px; border-radius: 50% 50% 46% 46%; background: #5b463c; }
.fr-face .ff-muzzle { left: 10px; top: 15px; width: 16px; height: 15px; border-radius: 50% 50% 46% 46%; background: #efe3d3; }
.fr-face .ff-eye { top: 13px; width: 4px; height: 4px; border-radius: 50%; background: #121018; }
.fr-face .ff-eye.ff-l { left: 12px; }
.fr-face .ff-eye.ff-r { right: 12px; }
.fr-face .ff-nose { left: 15px; top: 18px; width: 6px; height: 5px; border-radius: 50%; background: #f2a3b3; }
.fr-face .ff-bow { left: 12px; bottom: 2px; width: 12px; height: 5px; border-radius: 2px; background: #2fa36b; }

/* すぐに押せる札(いちばん新しい吹き出しのすぐ下。2 段まで。越える時は 2 段のまま横に巻く)と、言葉が要る時の入力欄 */
.fr-actions { flex: none; display: grid; gap: 8px; padding: 8px 12px calc(10px + env(safe-area-inset-bottom, 0px)); background: var(--fr-bg); border-top: 1px solid var(--fr-line); }
.fr-actions:not(:has(> :not([hidden]))) { display: none; }
.fr-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.fr-chips[hidden], .fr-input[hidden] { display: none; }
.fr-chips.fr-chips-scroll { display: grid; grid-auto-flow: column; grid-template-rows: repeat(2, auto); grid-auto-columns: max-content; overflow-x: auto;
  overscroll-behavior-x: contain; scrollbar-width: none; padding-bottom: 2px; -webkit-mask-image: linear-gradient(to right, #000 82%, transparent); mask-image: linear-gradient(to right, #000 82%, transparent); }
.fr-chips.fr-chips-scroll > .fr-auto, .fr-chips.fr-chips-scroll > .primary, .fr-chips.fr-chips-scroll > .fr-again { order: -1; } /* 横に巻く時も、おまかせと おすすめは最初に見える */
.fr-chips.fr-chips-scroll::-webkit-scrollbar { display: none; }
.fr-btn { position: relative; font: inherit; font-size: 16px; min-height: 44px; padding: 8px 16px; border-radius: 999px; cursor: pointer; color: var(--fr-text);
  background: rgba(125,98,255,0.14); border: 1.5px solid rgba(183,168,255,0.55); display: inline-flex; align-items: center; justify-content: center;
  text-align: center; line-height: 1.3; font-weight: 600; overflow-wrap: anywhere; text-decoration: none; -webkit-tap-highlight-color: transparent; }
.fr-chip { flex: 0 1 auto; max-width: 100%; font-size: 15px; padding: 6px 14px; }
/* 小さな絵つきの札(見本の子・ゆるキャラの形・しつかん。B4 12b)。絵の上に名前。押す所は 44px 以上 */
.fr-chip.fr-card { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; padding: 4px 8px; min-width: 64px; line-height: 1.2; border-radius: 16px; font-size: 14px; }
.fr-card-img { width: 34px; height: 34px; display: block; pointer-events: none; }
.fr-pic.fr-pic-small { width: 56px; height: 56px; object-fit: contain; }
.fr-btn.primary, .yp-save { background: linear-gradient(135deg, #7d62ff, #c15bff); border: 1.5px solid transparent; font-weight: 800; color: #fff; }
/* 全体のおまかせ(のこりを ぜんぶ おまかせ): 点線のふち・うすい色。問いごとの「おまかせ」(ふつうの札)と見分ける */
.fr-btn.fr-auto { border: 2px dashed rgba(123,224,195,0.75); background: rgba(123,224,195,0.06); color: var(--fr-muted); font-weight: 500; }
.fr-btn:active { transform: translateY(1px); filter: brightness(1.12); }
@media (hover: hover) { .fr-btn:hover { filter: brightness(1.15); } .fr-close:hover { background: rgba(255,255,255,0.12); } }
.fr-btn:focus-visible, .fr-close:focus-visible, .fr-field input:focus-visible, .yp-panel button:focus-visible, .yp-panel input:focus-visible,
.fr-btn:focus-within { outline: 3px solid #fff; outline-offset: 2px; }
.fr-btn:disabled { opacity: 0.5; cursor: wait; }
.fr-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; clip: rect(0 0 0 0); }
.fr-input { display: grid; gap: 4px; }
.fr-wide { display: grid; gap: 4px; min-width: 0; }
.fr-field { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: stretch; margin: 0; }
.fr-field input[type="text"], .fr-field input[type="password"], .yp-panel input[type="text"] { font: inherit; font-size: 16px; min-height: 48px; min-width: 0; width: 100%;
  padding: 10px 16px; border-radius: 24px; color: var(--fr-text); background: #0f0d1c; border: 1.5px solid rgba(183,168,255,0.55); }
.fr-field .fr-btn { min-width: 84px; border-radius: 24px; }
.fr-count { font-size: 14px; color: var(--fr-muted); text-align: right; margin: 0 4px; }
.fr-count:not(.over) { display: none; }
.fr-count.over { color: var(--fr-warn); }
.fr-remember { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 14px; color: var(--fr-muted); }
.fr-remember input { width: 22px; height: 22px; }
.fr-frame-wrap { display: grid; }
.fr-frame { display: block; width: 100%; height: min(400px, 48vh); border: 1px solid var(--fr-line); border-radius: 14px; background: #1d1a2e; }
@supports (height: 1dvh) { .fr-frame { height: min(400px, 48dvh); } }
.fr-more { display: none !important; }
.fr-launch { font: inherit; font-size: 14px; padding: 9px 14px; min-height: 40px; border-radius: 999px; cursor: pointer; color: var(--text, #f4f1fb);
  background: var(--glass, rgba(24,21,40,0.62)); border: 1px solid var(--line, rgba(255,255,255,0.12)); }
/* 作りかけがあるときの小さな「つづき」(かえる の中の あたらしい子を つくる の横。自動では開かない。CU) */
.fr-launch[data-resume="1"]::after { content: "つづき"; margin-left: 8px; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; color: #1b1630; background: var(--fr-mint, #7be0c3); }
.fr-launch.floating { position: fixed; top: max(12px, env(safe-area-inset-top)); right: 12px; z-index: 6; }

/* ---------- スマホの形 B: キャラの下の方に会話を重ねる(上へ向かって薄くなる。顔と上半身は見えたまま。押す札は不透明) ---------- */
@media (max-width: 719px) {
  .fr-sheet[data-layout="overlay"] { height: clamp(300px, 62vh, 660px); background: transparent; border: 0; border-radius: 0; box-shadow: none; }
  @supports (height: 1dvh) { .fr-sheet[data-layout="overlay"] { height: clamp(300px, 62dvh, 660px); } }
  .fr-sheet[data-layout="overlay"]::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
    background: linear-gradient(to bottom, rgba(20,18,31,0) 0%, rgba(20,18,31,0.42) 18%, rgba(20,18,31,0.74) 42%, rgba(20,18,31,0.9) 70%); }
  .fr-sheet[data-layout="overlay"] .fr-head { background: transparent; border-bottom: 0; }
  .fr-sheet[data-layout="overlay"] .fr-left { flex: 0 1 auto; padding: 6px 14px; border-radius: 999px; background: rgba(23,20,38,0.82); }
  .fr-sheet[data-layout="overlay"] .fr-title { justify-content: space-between; }
  .fr-sheet[data-layout="overlay"] .fr-close { background: rgba(23,20,38,0.82); }
  .fr-sheet[data-layout="overlay"] .fr-bar { left: auto; right: 100px; width: 0; }
  .fr-sheet[data-layout="overlay"] .fr-log { -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 48px); mask-image: linear-gradient(to bottom, transparent 0, #000 48px); }
  .fr-sheet[data-layout="overlay"] .fr-bubble { background: rgba(38,34,62,0.9); box-shadow: 0 2px 10px rgba(0,0,0,0.35); }
  .fr-sheet[data-layout="overlay"] .fr-line.char .fr-bubble { background: rgba(28,58,54,0.92); }
  .fr-sheet[data-layout="overlay"] .fr-line.note .fr-bubble { background: rgba(34,31,56,0.92); }
  .fr-sheet[data-layout="overlay"] .fr-actions { border-radius: 18px 18px 0 0; border: 1px solid var(--fr-line); border-bottom: 0; box-shadow: 0 -6px 20px rgba(0,0,0,0.35); }
  /* 手元の PC の作る画面の枠を出している間(この PC の中で開いた時だけ)は、札を高くして枠を入れる。78% まで(B4 12b: 88% だと舞台の子の足が札に 8〜10px かかった) */
  .fr-sheet[data-input="frame"] { height: min(78vh, 760px); }
  @supports (height: 1dvh) { .fr-sheet[data-input="frame"] { height: min(78dvh, 760px); } }
  .fr-sheet[data-input="frame"] .fr-log { min-height: 72px; }
  /* 形 A: 舞台の絵は札の上だけ(キャラが札の上に全身で立つ。高さは index.js の fitStage が測って入れる) */
  html.fr-stack #stage { height: var(--fr-stage-h, 100%); }
  /* 会話の間は、上の段の 2 行目(性格・はじめての会話・覚えていること・見た目の切り替えなど)と字幕を隠す。
     札がスマホの画面の 6 割を使うので、キャラの立つ所を空ける(上の段の 1 行目の札は残し、頭のすき間の決まりはそのまま) */
  html.fr-open .top .top-row, html.fr-open .subs { display: none !important; }
}

/* ---------- PC と iPad(幅 720px から): 右の横の札。キャラは札の左(html.fr-side。index.js の fitStage が付け外し) ---------- */
@media (min-width: 720px) {
  .fr-sheet, .fr-sheet[data-layout] { left: auto; right: 16px; bottom: calc(var(--bottom-h, 0px) + 12px); width: min(460px, max(340px, 44vw));
    height: min(680px, calc(100vh - var(--top-h, 64px) - var(--bottom-h, 0px) - 48px)); border-radius: 22px; border-bottom: 1px solid var(--fr-line); }
  @supports (height: 1dvh) { .fr-sheet, .fr-sheet[data-layout] { height: min(680px, calc(100dvh - var(--top-h, 64px) - var(--bottom-h, 0px) - 48px)); } }
  .fr-head { padding: 6px 10px 8px 16px; }
  .fr-pin-img { width: 48px; height: 48px; }
  .fr-pin-frame, .fr-pin-frame .fr-frame { width: 72px; height: 72px; }
  /* 作る画面の枠を出している間: 会話の欄を 48px まで縮め、枠(眉の札・この子にする・直したい・よく頼む直し・おまかせ)を巻かずに見せる */
  .fr-sheet[data-input="frame"] { height: min(760px, calc(100vh - var(--top-h, 64px) - var(--bottom-h, 0px) - 24px)); }
  .fr-sheet[data-input="frame"] .fr-log { min-height: 48px; }
  .fr-actions .fr-frame { height: clamp(220px, calc(100vh - var(--top-h, 64px) - var(--bottom-h, 0px) - 146px), 460px); }
  @supports (height: 1dvh) { .fr-sheet[data-input="frame"] { height: min(760px, calc(100dvh - var(--top-h, 64px) - var(--bottom-h, 0px) - 24px)); }
    .fr-actions .fr-frame { height: clamp(220px, calc(100dvh - var(--top-h, 64px) - var(--bottom-h, 0px) - 146px), 460px); } }
}
@media (min-width: 720px) { html.fr-side #stage { width: calc(100% - 32px - min(460px, max(340px, 44vw))); } }

/* ---------- 背の低い画面(高さ 500px まで。スマホの横向き): 札ぜんたいが巻ける(上の細い段は上に止まる) ---------- */
@media (max-height: 500px) {
  html .fr-sheet.fr-sheet { top: 8px; bottom: 8px; height: auto; max-height: none; overflow-y: auto; overscroll-behavior: contain; border-radius: 18px; border-bottom: 1px solid var(--fr-line); }
  html .fr-sheet.fr-sheet .fr-head { position: sticky; top: 0; }
  html .fr-sheet.fr-sheet .fr-log { flex: 1 1 auto; min-height: 140px; } /* 会話の欄が縮んで中で巻ける(いちばん新しい吹き出しが見える)。足りない時だけ札ぜんたいが巻ける */
  html .fr-sheet.fr-sheet .fr-frame { height: min(300px, 60vh); }
  html.fr-open .top .top-row, html.fr-open .subs { display: none !important; }
}
@media (max-height: 500px) and (max-width: 719px) { html .fr-sheet.fr-sheet { left: 8px; right: 8px; width: auto; } }

/* ---------- キーボードが出ている間(view.js の fitKeyboard が fr-kb と、見える範囲の top・height を入れる) ----------
   札は見える範囲にぴったり重なる(上の細い段・会話・入力欄が全部見える。舞台は札の後ろ)。下がったら最初の見え方に戻る */
html .fr-sheet.fr-sheet.fr-kb { max-height: none; border-radius: 0; overflow: hidden; display: flex; }
html .fr-sheet.fr-sheet.fr-kb .fr-log { flex: 1 1 auto; min-height: 0; }
html .fr-sheet.fr-kb[data-layout="overlay"] { background: var(--fr-bg); }
html .fr-sheet.fr-kb[data-layout="overlay"]::before { display: none; }

/* 札が開いている間は、後ろの知らせ(仮の頭脳です・カメラの説明)を隠す。札と重なって見えていた(WebKit) */
@media (max-width: 719px) { html.fr-open #brainNotice, html.fr-open #privacy { visibility: hidden; } }
/* 最後まで行った後に、選んだ子が舞台に立っている間だけ出る、小さな「〜にもどす」(Q-0111) */
.fr-return { position: fixed; left: 12px; bottom: calc(var(--bottom-h, 0px) + 12px + env(safe-area-inset-bottom, 0px)); z-index: 6; font: inherit; font-size: 15px;
  min-height: 44px; padding: 0 18px; border-radius: 999px; cursor: pointer; color: #fff; background: linear-gradient(135deg, #7d62ff, #c15bff); border: 0;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
.fr-return:disabled { opacity: 0.5; cursor: wait; }
.fr-return:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
/* 上の段のボタンの列(#modes)に入れる時は、ほかのボタンと同じ並び(浮かべない。字幕・知らせ・キャラに重ならない) */
.fr-return.fr-return-inline { position: static; left: auto; bottom: auto; z-index: auto; box-shadow: none; pointer-events: auto; }

/* 性格の画面 */
.yp-back { position: fixed; inset: 0; z-index: 40; background: rgba(12, 10, 22, 0.6); display: grid; place-items: end center; }
.yp-panel { position: relative; width: 100%; max-height: 92dvh; max-height: 92vh; overflow-y: auto; overscroll-behavior: contain; background: var(--fr-ink);
  border: 1px solid var(--fr-line); border-radius: 22px 22px 0 0; padding: 14px 14px calc(14px + env(safe-area-inset-bottom, 0px)); display: grid; gap: 14px; }
@supports (height: 1dvh) { .yp-panel { max-height: 92dvh; } }
.yp-panel h2 { margin: 0; font-size: 18px; letter-spacing: 0.04em; }
.yp-lead { margin: -8px 0 0; font-size: 13px; color: var(--fr-muted); line-height: 1.5; }
/* おまかせ(ぜんぶ じどう)と、えらぶ所の数(本人 11/7) */
.yp-auto-row { display: grid; gap: 4px; }
.yp-auto { font: inherit; font-size: 16px; font-weight: 700; min-height: 52px; border-radius: 14px; cursor: pointer; color: var(--fr-text);
  background: rgba(123,224,195,0.12); border: 2px solid var(--fr-mint); }
.yp-auto-note { margin: 0; }
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
.yp-energy input { display: block; width: 100%; min-height: 44px; margin: 0; accent-color: #9b7dff; }
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
@media (prefers-reduced-motion: reduce) { .fr-sheet *, .yp-panel * { transition: none !important; animation: none !important; } }
/* 画面のキーボード(ui/keyboardInset.js)。性格の画面は、見える範囲の下端へ持ち上げ(translate)、見える高さに収める。
   初めての会話の札は、自分で見える範囲に重なる(view.js の fitKeyboard。ここで持ち上げると 2 回分上がる) */
html.kb-open .yp-panel { translate: 0 calc(var(--kb, 0px) * -1); max-height: calc(var(--vvh, 100dvh) - 8px) !important; padding-bottom: 14px; }
`;

/** <style> を 1 回だけ入れる */
export function injectStyles(doc = document) {
  if (doc.getElementById('yc-firstrun-style')) return;
  const s = doc.createElement('style');
  s.id = 'yc-firstrun-style';
  s.textContent = CSS;
  doc.head.append(s);
}
