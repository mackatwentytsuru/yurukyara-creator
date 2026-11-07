// 初めての会話の画面。LINE のような会話の札(11/8 本人「会話の窓が小さくて読みづらい。チャットしながら選択肢を押すだけで決められる作りに」)。
// 台本(script.js)の present と offer を DOM で行う。
// - 案内役(主役の猫)・できた子の文は、左の吹き出し(顔つき)。使う人が押した物・書いた言葉は、右の吹き出し
// - 長い文は、文の切れ目で 2 つ以上の吹き出しに分け、少し間を空けて出す(1 つの吹き出しは 1〜2 行)
// - 選ぶ物は、いちばん新しい吹き出しのすぐ下に「すぐに押せる札」(44px 以上、2 段まで)。言葉が要る歩みだけ、入力欄と「送る」
// - 上の細い段(あと いくつ・あとで)は巻いても流れない。古い吹き出しは会話の欄の中で巻ける
// - スマホの形は 2 つ(layout): 'sheet' = キャラの下に札、'overlay' = キャラの下の方に会話を重ねる(上へ向かって薄くなる)
// - 文字は textContent だけで入れる。鍵の欄の文字は、押したらすぐ消し、画面のどこにも残さない
// - 選んだ絵(この端末の中の blob:)と、PC で描いた絵(作る画面の小さな枠)は、上の段の小さな絵の欄に出したままにする(D3・D5)
import { injectStyles } from './styles.js';
import { STEPS, countChars, progressText, OMAKASE_LABEL, OMAKASE_CHIP } from './script.js';
import { crawl } from './voice.js';
import { MAIN_CHARACTER } from '../../character/defaults.js';

const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return n;
};
const PICTURE_MAX = 20 * 1024 * 1024;
const initial = (name) => [...String(name || '?')][0];
/** 吹き出しと吹き出しの間(ms)。長い文を分けた時も、この間を空ける */
export const BUBBLE_GAP_MS = 320;
/** 1 つの吹き出しに入れる字数の目安(幅 390 で 2 行) */
export const BUBBLE_CHARS = 34;
/** すぐに押せる札は、この段数まで(越える時は 2 段のまま横に巻く) */
export const CHIP_ROWS = 2;
const KB_MIN = 80; // これより小さい見える範囲の差は、アドレスバーの出入り

/**
 * 長い文を、文の切れ目(。!?)で、1 つの吹き出しに入る長さに分ける。切れ目が無い時は、そのまま 1 つ
 * @param {string} text
 * @param {number} [max]
 * @returns {string[]}
 */
export function splitBubbles(text, max = BUBBLE_CHARS) {
  const s = String(text ?? '').trim();
  if (countChars(s) <= max) return s ? [s] : [];
  const parts = s.match(/[^。!?!?]+[。!?!?」』)]*|[^。!?!?]+$/gu) ?? [s];
  const out = [];
  let cur = '';
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (cur && countChars(cur + p) > max) {
      out.push(cur);
      cur = p;
    } else cur += p;
  }
  if (cur) out.push(cur);
  return out;
}

/** 主役の顔(CSS で描く小さな顔。外の絵を読まない) */
function mainFace() {
  const f = el('span', { className: 'fr-who fr-face' });
  f.setAttribute('aria-hidden', 'true');
  // 部品の名前は ff- で始める(札の頭 .fr-head と同じ名前にすると、札の頭の見た目が顔に移った)
  for (const c of ['ff-ear ff-l', 'ff-ear ff-r', 'ff-head', 'ff-muzzle', 'ff-eye ff-l', 'ff-eye ff-r', 'ff-nose', 'ff-bow']) f.append(el('i', { className: c }));
  return f;
}

/**
 * @param {object} o
 * @param {string} o.guideName
 * @param {string} [o.guideId] 案内役の id(主役なら、顔の絵を出す)
 * @param {'sheet'|'overlay'} [o.layout] スマホの形
 * @param {object} o.voice voice.js の createVoice の戻り値
 * @param {(id:string, payload?:object)=>Promise<boolean>} o.onAct 台本の act
 * @param {(onSave:(settings:object)=>void)=>void} o.openPersona 性格の画面を開く
 * @param {(reason:string)=>void} [o.onClose]
 * @param {()=>object|null} [o.stage] 舞台のキャラ(口と表情を動かす)。{ character, speaker, guideId }
 * @param {()=>Promise<boolean>} [o.onAuto] おまかせ。あれば、どの歩みの札にも出す
 * @param {(typing:boolean)=>void} [o.onTyping] キーボードが出た・下がった
 */
export function createSheet({ guideName, guideId = MAIN_CHARACTER.id, layout = 'sheet', voice, onAct, onAuto = null, openPersona, onClose = () => {}, onTyping = () => {}, stage = () => null, parent = document.body }) {
  injectStyles(parent.ownerDocument);
  const urls = new Set();
  const stats = { lines: 0, crawled: 0, voiced: [], actionsShown: 0, bubbles: 0 };
  let skip = null;
  let closed = false;

  // 7 つのステップ(読み上げと試験のため。目では上の細い線と「あと いくつ」で見せる)
  const steps = el('ol', { className: 'fr-steps', ariaLabel: '7 つのステップ' });
  const stepItems = STEPS.map((s) => {
    const li = el('li', {}, el('span', { textContent: String(s.n) }), el('b', { textContent: s.label }));
    li.dataset.n = String(s.n);
    steps.append(li);
    return li;
  });
  const closeBtn = el('button', { type: 'button', className: 'fr-close', textContent: 'あとで', ariaLabel: 'あとで(はじめての会話をとじる)' });
  const leftMain = el('b');
  const leftTime = el('span');
  const left = el('p', { className: 'fr-left', ariaLive: 'polite' }, leftMain, leftTime);
  const barFill = el('i');
  const bar = el('span', { className: 'fr-bar' }, barFill);
  bar.setAttribute('aria-hidden', 'true');
  const pinBox = el('figure', { className: 'fr-pin', hidden: true });
  const log = el('div', { className: 'fr-log', role: 'log', ariaLabel: `${guideName}との 会話` });
  log.setAttribute('aria-live', 'off'); // 読み上げは下の fr-sr が 1 回だけ言う(2 回言わない)
  const live = el('p', { className: 'fr-sr', ariaLive: 'polite' });
  const chips = el('div', { className: 'fr-chips', role: 'group', ariaLabel: 'へんじを えらぶ' });
  const fieldRow = el('div', { className: 'fr-input', hidden: true });
  const actions = el('div', { className: 'fr-actions' }, chips, fieldRow);
  const sheet = el(
    'section',
    { className: 'fr-sheet', role: 'dialog', ariaLabel: 'はじめての会話' },
    el('header', { className: 'fr-head' }, el('div', { className: 'fr-title' }, pinBox, el('h2', { textContent: 'はじめての会話' }), left, closeBtn), bar, steps),
    log,
    live,
    actions,
  );
  sheet.dataset.layout = layout === 'overlay' ? 'overlay' : 'sheet';
  // 前の作りの「まだ あるよ」の印(札の中で選ぶ所が巻ける時)。今の札は 2 段までなので出ないが、試験と道具のために残す
  const more = el('p', { className: 'fr-more', ariaHidden: 'true', hidden: true, textContent: '▼ したに まだ あるよ' });
  sheet.append(more);
  parent.append(sheet);

  /* ---------- すぐに押せる札: 2 段まで(越えたら、2 段のまま横に巻く) ---------- */
  function fitChips() {
    if (closed) return;
    chips.classList.remove('fr-chips-scroll');
    const tops = new Set([...chips.children].filter((c) => c.offsetParent !== null).map((c) => Math.round(c.offsetTop)));
    if (tops.size > CHIP_ROWS) chips.classList.add('fr-chips-scroll');
  }
  globalThis.addEventListener?.('resize', fitChips);

  /* ---------- キーボード ---------- */
  // iPhone の Safari・Chrome は、キーボードが出ると「見える範囲(visualViewport)」だけが縮む。入力している間は、札を見える範囲に
  // ぴったり重ね(上の細い段・会話・入力欄が全部見える。舞台は札の後ろに隠れてよい)、キーボードが下がったら最初の見え方へ戻す
  // (11/8 本人の iPhone: キーボードを閉じた後に札の頭が消えていた)
  const vv = globalThis.visualViewport ?? null;
  let typing = false;
  function fitKeyboard() {
    if (!vv || closed) return;
    const inner = globalThis.innerHeight ?? 0;
    const top = Math.max(0, Math.round(vv.offsetTop ?? 0));
    const kb = Math.round(inner - vv.height - top);
    const open = kb > KB_MIN;
    sheet.style.setProperty('--fr-vvh', `${Math.round(vv.height)}px`);
    if (open) {
      sheet.classList.add('fr-kb');
      sheet.style.top = `${top}px`;
      sheet.style.height = `${Math.round(vv.height)}px`;
      sheet.style.bottom = 'auto';
    } else {
      sheet.classList.remove('fr-kb');
      sheet.style.top = '';
      sheet.style.height = '';
      sheet.style.bottom = '';
    }
    if (open !== typing) {
      typing = open;
      if (!open) resetView();
      onTyping(open);
    }
    if (open) toEnd();
  }
  /** キーボードが下がった後: 札・ページの巻きを 0 に戻し、会話は最後の吹き出しへ */
  function resetView() {
    sheet.scrollTop = 0;
    const w = globalThis;
    if (w.scrollY || w.pageYOffset) w.scrollTo?.(0, 0);
    toEnd();
    fitChips();
  }
  vv?.addEventListener('resize', fitKeyboard);
  vv?.addEventListener('scroll', fitKeyboard);
  sheet.addEventListener('focusin', () => {
    for (const ms of [60, 320, 650]) setTimeout(fitKeyboard, ms); // iPhone はキーボードが上がり切ってから見える範囲を決める
  });
  sheet.addEventListener('focusout', () => {
    for (const ms of [120, 450, 900]) setTimeout(fitKeyboard, ms);
  });
  closeBtn.addEventListener('click', () => close('later'));
  log.addEventListener('click', () => skip?.abort()); // 押すと、文字送りと間を飛ばす

  // 今のまとまり(台本が 1 回に言う文。present 1 回分)の最初の行に印 fr-latest(試験と練習の道具が見る)
  let latest = null;
  let fresh = true;
  let lastSide = null; // 続けて同じ側が話す時は、顔と名前を最初の吹き出しだけに出す
  function add(node) {
    log.append(node);
    if (fresh) {
      latest?.classList.remove('fr-latest');
      latest = node;
      node.classList.add('fr-latest');
      fresh = false;
    }
    return node;
  }

  /** いちばん新しい吹き出しを見せる(会話の欄の下の端へ)。今のまとまりが欄に入る時は、まとまりの最初の行も見える */
  function toEnd() {
    log.scrollTop = log.scrollHeight;
    // 背の低い画面(札ぜんたいが巻ける時)は、札も下へ(押す札と、いちばん新しい吹き出しが見える。上の細い段は上に止まる)
    // (札が巻ける形の時だけ。巻けない札(overflow: hidden)を JS で巻くと、中の作る画面の枠が見える所から外れて止まった)
    if (!typing && sheet.scrollHeight > sheet.clientHeight + 1 && getComputedStyle(sheet).overflowY === 'auto') sheet.scrollTop = sheet.scrollHeight;
  }
  const scroll = () => {
    toEnd();
    requestAnimationFrame?.(toEnd);
  };

  function setStep(n, { skipped = [], local = false } = {}) {
    sheet.dataset.step = String(n);
    for (const li of stepItems) {
      const k = Number(li.dataset.n);
      li.className = skipped.includes(k) && k < n ? 'skip' : k < n ? 'done' : k === n ? 'now' : '';
      li.ariaCurrent = k === n ? 'step' : null;
    }
    const p = progressText(n, { skipped, local });
    leftMain.textContent = p.main;
    leftTime.textContent = p.time;
    const done = Math.min(STEPS.length, Math.max(0, n - 1));
    barFill.style.width = `${n > STEPS.length ? 100 : Math.round((done / STEPS.length) * 100)}%`;
  }

  /** 吹き出し 1 つ。side は guide(案内役)・char(できた子)・note(案内役の知らせ)・user(右) */
  function row(who, name) {
    const side = who === 'note' ? 'guide' : who;
    const cont = side === lastSide && side !== 'user';
    lastSide = side;
    const text = el('p', { className: 'fr-text' });
    const nameEl = who === 'user' ? null : el('b', { className: 'fr-name', textContent: name });
    const bubble = el('div', { className: 'fr-bubble' }, nameEl, text);
    let face = null;
    if (who !== 'user') face = side === 'guide' && guideId === MAIN_CHARACTER.id ? mainFace() : el('span', { className: 'fr-who', ariaHidden: 'true', textContent: initial(name) });
    const r = el('div', { className: `fr-line ${who}${cont ? ' cont' : ''}` }, face, bubble);
    add(r);
    stats.bubbles += 1;
    scroll();
    return { r, text, bubble };
  }

  /** 少し間を空ける(押せば飛ばす) */
  function pause(ms) {
    if (!ms || closed) return Promise.resolve();
    const ac = new AbortController();
    skip = ac;
    return new Promise((res) => {
      const t = setTimeout(res, ms);
      ac.signal.addEventListener('abort', () => {
        clearTimeout(t);
        res();
      });
    }).finally(() => {
      if (skip === ac) skip = null;
    });
  }

  /** 知らせの吹き出し(案内役の側。1 つのまとまりの外で出す時は、それだけで新しいまとまり) */
  function note(text, { alone = false } = {}) {
    if (alone) fresh = true;
    for (const part of splitBubbles(text)) {
      const { text: t } = row('note', guideName);
      t.textContent = part;
    }
    live.textContent = text;
    scroll();
  }

  /** 舞台のキャラの口を、文字送りの間だけ動かす(声が無いときの口。読み上げの部品の fakeUntil を使う) */
  function mouth(onStage, ms) {
    const sp = stage()?.speaker;
    if (onStage && sp && 'fakeUntil' in sp) sp.fakeUntil = performance.now() + ms;
  }

  async function showLine(line, ctx) {
    stats.lines += 1;
    if (line.who === 'note') {
      const parts = splitBubbles(line.text);
      for (let i = 0; i < parts.length; i++) {
        if (i) await pause(BUBBLE_GAP_MS);
        const { text } = row('note', guideName);
        text.textContent = parts[i];
      }
      live.textContent = line.text;
      scroll();
      return;
    }
    if (line.who === 'user') {
      const { bubble, text } = row('user', '');
      text.textContent = line.text;
      if (line.img) {
        const img = el('img', { className: 'fr-pic', alt: '選んだ絵' });
        img.src = line.img;
        img.addEventListener('load', scroll, { once: true });
        bubble.append(img);
      }
      live.textContent = line.text;
      return;
    }
    const isChar = line.who === 'char';
    const name = isChar ? (ctx?.character?.name ?? 'この子') : guideName;
    const st = stage();
    const onStage = Boolean(st?.character) && (isChar ? st.character.id === ctx?.character?.id : st.character.id === st.guideId);
    if (isChar && onStage) {
      try {
        if (line.expression) st.character.setEmotion?.(line.expression, 1);
        if (line.motion && line.motion !== 'none') st.character.play?.(line.motion);
      } catch {
        // 表情や動きが無いキャラでも、文字は出す
      }
    }
    const settings = ctx?.settings ?? null;
    // 舞台の読み上げが文字送りに対応していれば(会話の流れ S3 の speaker.js)、それに任せる:
    // 本物の声(使う人の鍵・サーバー)があれば声で、無ければレトロ音と文字送りで話し、口も音に合う
    const sp = st?.speaker;
    if (isChar && onStage && typeof sp?.setVoice === 'function' && typeof sp.enqueue === 'function') {
      const { text } = row(line.who, name);
      sp.setVoice({ seed: name });
      let crawled = false;
      await sp.enqueue(line.text, {
        onStart: (_t, info) => {
          if (info?.crawl) crawled = true;
          else text.textContent = line.text;
          scroll();
        },
        onCrawl: (shown) => {
          text.textContent = shown;
          scroll();
        },
      });
      text.textContent = line.text;
      live.textContent = line.text;
      if (crawled) stats.crawled += 1;
      else stats.voiced.push({ text: line.text, way: 'speaker' });
      scroll();
      return;
    }
    if (isChar && line.voice && voice.realVoice(settings?.voice?.provider)) {
      const { text } = row(line.who, name);
      text.textContent = line.text;
      live.textContent = line.text;
      scroll();
      const way = await voice.speak(line.text, settings);
      stats.voiced.push({ text: line.text, way });
      if (way === 'browser') mouth(onStage, 0);
      return;
    }
    // 案内役の長い文は、吹き出しを分ける(できた子の返事は 1 つのまま。声と口が 1 つの文で動くため)
    const parts = isChar ? [line.text] : splitBubbles(line.text);
    const rate = isChar ? (settings?.voice?.rate ?? 1) : 1.1;
    const pitch = isChar ? (settings?.voice?.pitch ?? 1) : 0.85;
    const cps = 24 * rate;
    for (let i = 0; i < parts.length; i++) {
      if (closed) return;
      if (i) await pause(BUBBLE_GAP_MS);
      const { text } = row(line.who, name);
      const ac = new AbortController();
      skip = ac;
      mouth(onStage, (countChars(parts[i]) / cps) * 1000 + 400);
      await crawl(text, parts[i], {
        cps,
        signal: ac.signal,
        onChar: () => {
          voice.blipper.blip({ pitch, who: line.who });
          scroll();
        },
      });
      mouth(onStage, 0);
      if (skip === ac) skip = null;
      scroll();
    }
    stats.crawled += 1;
    live.textContent = line.text;
    scroll();
  }

  /** 台本の present: 文を順に出し、全部出し終わったら解決する。1 回分の文が 1 つのまとまり(最初の行に印) */
  async function present(lines, ctx) {
    fresh = true;
    let first = true;
    for (const line of lines) {
      if (closed) return;
      if (!first && line.who !== 'user') await pause(BUBBLE_GAP_MS);
      first = false;
      await showLine(line, ctx);
    }
  }

  function chipButton(a) {
    const b = el('button', { type: 'button', className: `fr-btn fr-chip${a.primary ? ' primary' : ''}${a.id === 'again' ? ' fr-again' : ''}`, textContent: a.label, ariaLabel: a.aria ?? a.label });
    b.dataset.act = a.id;
    b.addEventListener('click', () => {
      voice.unlock();
      if (a.kind === 'persona') {
        openPersona((settings) => onAct(a.id, { settings }));
        return;
      }
      onAct(a.id);
    });
    return b;
  }

  function fileAction(a) {
    const input = el('input', { type: 'file', accept: 'image/*', className: 'fr-file' });
    if (a.capture) input.setAttribute('capture', 'environment');
    input.setAttribute('aria-label', a.label);
    const label = el('label', { className: `fr-btn fr-chip${a.primary ? ' primary' : ''}` }, input, a.label);
    label.dataset.act = a.id;
    label.addEventListener('click', () => voice.unlock());
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) return;
      if (!/^image\//.test(f.type) || f.size > PICTURE_MAX) {
        note('絵の ファイル(20MB まで)を えらんでね。', { alone: true });
        return;
      }
      const url = URL.createObjectURL(f); // この端末の中だけの、絵の仮の住所(外には送らない)
      urls.add(url);
      onAct(a.id, { url, name: f.name });
    });
    return label;
  }

  /** 手元の PC の「作る画面」(1〜3 歩の入力と絵)を、札の中の枠に出す。絵と通信は枠の中だけで、この画面は知らせだけを受ける */
  function frameEl(url, title) {
    const f = el('iframe', { className: 'fr-frame', title, src: url });
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    f.addEventListener('load', scroll, { once: true });
    return f;
  }
  function frameAction(a) {
    return el('div', { className: 'fr-wide fr-frame-wrap' }, frameEl(a.url, a.label ?? 'PC の作る画面'));
  }

  /** 押すと別のタブで開くだけのリンク(パソコンでの作り方)。台本は進まない */
  function linkAction(a) {
    const link = el('a', { className: `fr-btn fr-chip fr-link${a.primary ? ' primary' : ''}`, href: a.url, target: '_blank', rel: 'noopener noreferrer', textContent: a.label, ariaLabel: `${a.aria ?? a.label}(べつのタブでひらきます)` });
    link.dataset.act = a.id;
    return link;
  }

  /**
   * 絵の欄(上の細い段の左の、小さな絵)。{ img, caption } は選んだ絵(この端末の中の blob:)。
   * { frame: <作る画面の絵だけの住所>, caption } は PC で描いた絵(小さな枠)。null で消す。台本(script.js)の pin が呼ぶ
   */
  function pin(p) {
    if (!p) {
      pinBox.replaceChildren();
      pinBox.hidden = true;
      delete sheet.dataset.pin;
      return;
    }
    const cap = el('figcaption', { className: 'fr-pin-cap', textContent: p.caption ?? '' });
    if (p.img) {
      const img = el('img', { className: 'fr-pin-img', alt: p.caption || '選んだ絵' });
      img.src = p.img;
      pinBox.replaceChildren(img, cap);
      sheet.dataset.pin = 'img';
    } else if (p.frame) {
      pinBox.replaceChildren(el('div', { className: 'fr-pin-frame' }, frameEl(p.frame, p.caption || 'PC で描いた絵')), cap);
      sheet.dataset.pin = 'frame';
    } else return;
    pinBox.hidden = false;
    scroll();
  }

  /** 言葉の欄(言葉が要る歩みだけ)。入力欄と、はっきりした「送る」 */
  function textAction(a) {
    const input = el('input', { type: 'text', placeholder: a.placeholder ?? '', autocomplete: 'off', enterKeyHint: 'send', ariaLabel: a.label });
    const count = el('p', { className: 'fr-count', textContent: a.max ? `0 / ${a.max}` : '' });
    const submit = el('button', { type: 'submit', className: 'fr-btn fr-send primary', textContent: a.submit ?? '送る', ariaLabel: a.submit ?? '送る' });
    const form = el('form', { className: 'fr-field', autocomplete: 'off' }, input, submit);
    form.dataset.act = a.id;
    const over = () => a.max && countChars(input.value.trim()) > a.max;
    input.addEventListener('input', () => {
      if (!a.max) return;
      const n = countChars(input.value.trim());
      count.textContent = `${n} / ${a.max}`;
      count.classList.toggle('over', n > a.max);
      submit.disabled = n > a.max;
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      voice.unlock();
      const text = input.value.trim();
      if (!text || over()) return;
      input.value = '';
      input.blur(); // 送ったらキーボードを下げる(下がると最初の見え方へ戻る)
      onAct(a.id, { text });
    });
    return el('div', { className: 'fr-wide' }, el('p', { className: 'fr-field-label', textContent: a.label }), form, a.max ? count : null);
  }

  function keyAction(a) {
    const input = el('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'こえの かぎ', ariaLabel: 'こえの かぎ' });
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('data-1p-ignore', '');
    input.setAttribute('data-lpignore', 'true');
    const remember = el('input', { type: 'checkbox' });
    const submit = el('button', { type: 'submit', className: 'fr-btn fr-send primary', textContent: a.label, ariaLabel: a.label });
    const form = el('form', { className: 'fr-field', autocomplete: 'off' }, input, submit);
    form.dataset.act = a.id;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      voice.unlock();
      const key = input.value;
      input.value = ''; // 鍵の文字は、すぐ画面から消す
      input.blur();
      onAct(a.id, { key, remember: a.remember ? remember.checked : false }); // からっぽでも渡す(台本が「かぎが からっぽだよ」と言う)
    });
    return el(
      'div',
      { className: 'fr-wide' },
      el('p', { className: 'fr-field-label', textContent: 'かぎ(この欄の文字は、押したらすぐ消えます)' }),
      form,
      a.remember ? el('label', { className: 'fr-remember' }, remember, 'この端末に おぼえておく(しない方が あんぜん)') : null,
    );
  }

  /**
   * おまかせの札。残りの選びを全部おすすめで決めて、最後まで進む。
   * 出さない時: 選びが無い・最後の「はじめる」だけ・手元の PC の作る画面(枠の中に、作る画面のおまかせがある)
   */
  function autoChip(list) {
    if (!onAuto || !list.length || list.every((a) => a.id === 'close' || a.id === 'begin') || list.some((a) => a.kind === 'frame')) return null;
    const b = el('button', { type: 'button', className: 'fr-btn fr-chip fr-auto', textContent: OMAKASE_CHIP });
    b.dataset.act = 'omakase';
    b.setAttribute('aria-label', `${OMAKASE_LABEL}。のこりを ぜんぶ おすすめで きめて、さいごまで すすみます`);
    b.title = 'のこりを ぜんぶ おすすめで きめて、さいごまで すすみます。あとから かえられます';
    b.addEventListener('click', () => {
      voice.unlock();
      onAuto();
    });
    return b;
  }

  /** 台本の offer: 選べる物を出す(空なら消す)。押す札は上、言葉の欄は下(LINE の入力の欄と同じ所) */
  function offer(list) {
    const chipEls = [];
    const fields = [];
    for (const a of list) {
      if (a.kind === 'text') fields.push(textAction(a));
      else if (a.kind === 'key') fields.push(keyAction(a));
      else if (a.kind === 'frame') fields.push(frameAction(a));
      else if (a.kind === 'file') chipEls.push(fileAction(a));
      else if (a.kind === 'link') chipEls.push(linkAction(a));
      else chipEls.push(chipButton(a));
    }
    const auto = autoChip(list);
    if (auto) chipEls.push(auto);
    chips.replaceChildren(...chipEls);
    chips.hidden = !chipEls.length;
    fieldRow.replaceChildren(...fields);
    fieldRow.hidden = !fields.length;
    if (list.length) stats.actionsShown += 1;
    sheet.dataset.actions = list.map((a) => a.id).join(' ');
    sheet.dataset.input = fields.length ? (list.some((a) => a.kind === 'frame') ? 'frame' : 'field') : 'none';
    fitChips();
    requestAnimationFrame?.(fitChips);
    scroll(); // 選ぶ所の高さが変わると、会話の欄の見える高さも変わる。いつも最後の吹き出しが見えるようにする
  }

  function close(reason = 'done') {
    if (closed) return;
    closed = true;
    skip?.abort();
    globalThis.removeEventListener?.('resize', fitChips);
    vv?.removeEventListener('resize', fitKeyboard);
    vv?.removeEventListener('scroll', fitKeyboard);
    sheet.remove();
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
    if (typing) onTyping(false);
    onClose(reason);
  }

  return {
    element: sheet,
    present,
    offer,
    setStep,
    close,
    pin,
    stats,
    get closed() {
      return closed;
    },
    get typing() {
      return typing;
    },
    get layout() {
      return sheet.dataset.layout;
    },
  };
}
