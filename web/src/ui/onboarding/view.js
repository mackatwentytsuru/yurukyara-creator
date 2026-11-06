// 初めての会話の画面(下から出る札。PC では下の真ん中の札)。台本(script.js)の present と offer を DOM で行う。
// - 案内役(主役の猫)とできた子の文は、1 字ずつ出す(文字送り)。本物の声が無いときは、レトロな効果音を鳴らす
// - できた子の文は、本物の声があれば、その声で話す(7 歩目の「声が出せるようになったよ、ありがとう!」)
// - 文字は textContent だけで入れる。鍵の欄の文字は、押したらすぐ消し、画面のどこにも残さない
import { injectStyles } from './styles.js';
import { STEPS, countChars } from './script.js';
import { crawl } from './voice.js';

const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return n;
};
const PICTURE_MAX = 20 * 1024 * 1024;
const initial = (name) => [...String(name || '?')][0];

/**
 * @param {object} o
 * @param {string} o.guideName
 * @param {object} o.voice voice.js の createVoice の戻り値
 * @param {(id:string, payload?:object)=>Promise<boolean>} o.onAct 台本の act
 * @param {(onSave:(settings:object)=>void)=>void} o.openPersona 性格の画面を開く
 * @param {(reason:string)=>void} [o.onClose]
 * @param {()=>object|null} [o.stage] 舞台のキャラ(口と表情を動かす)。{ character, speaker, guideId }
 */
export function createSheet({ guideName, voice, onAct, openPersona, onClose = () => {}, stage = () => null, parent = document.body }) {
  injectStyles(parent.ownerDocument);
  const urls = new Set();
  const stats = { lines: 0, crawled: 0, voiced: [], actionsShown: 0 };
  let skip = null;
  let closed = false;

  const steps = el('ol', { className: 'fr-steps', ariaLabel: '7 つの歩み' });
  const stepItems = STEPS.map((s) => {
    const li = el('li', {}, el('span', { textContent: String(s.n) }), el('b', { textContent: s.label }));
    li.dataset.n = String(s.n);
    steps.append(li);
    return li;
  });
  const closeBtn = el('button', { type: 'button', className: 'fr-close', textContent: 'あとで' });
  const log = el('div', { className: 'fr-log' });
  const live = el('p', { className: 'fr-sr', ariaLive: 'polite' });
  const actions = el('div', { className: 'fr-actions', role: 'group', ariaLabel: 'えらぶ' });
  const sheet = el(
    'section',
    { className: 'fr-sheet', role: 'dialog', ariaLabel: 'はじめての会話' },
    el('header', { className: 'fr-head' }, el('div', { className: 'fr-title' }, el('h2', { textContent: 'はじめての会話' }), closeBtn), steps),
    log,
    live,
    actions,
  );
  parent.append(sheet);
  closeBtn.addEventListener('click', () => close('later'));
  log.addEventListener('click', () => skip?.abort()); // 押すと、文字送りを飛ばす

  const scroll = () => {
    log.scrollTop = log.scrollHeight;
  };

  function setStep(n, { skipped = [] } = {}) {
    sheet.dataset.step = String(n);
    for (const li of stepItems) {
      const k = Number(li.dataset.n);
      li.className = skipped.includes(k) && k < n ? 'skip' : k < n ? 'done' : k === n ? 'now' : '';
      li.ariaCurrent = k === n ? 'step' : null;
    }
  }

  function row(who, name) {
    const text = el('p', { className: 'fr-text' });
    const bubble = el('div', { className: 'fr-bubble' }, who === 'user' ? null : el('b', { className: 'fr-name', textContent: name }), text);
    const r = el('div', { className: `fr-line ${who}` }, who === 'user' ? null : el('span', { className: 'fr-who', ariaHidden: 'true', textContent: initial(name) }), bubble);
    log.append(r);
    scroll();
    return { r, text, bubble };
  }

  /** 舞台のキャラの口を、文字送りの間だけ動かす(声が無いときの口。読み上げの部品の fakeUntil を使う) */
  function mouth(onStage, ms) {
    const sp = stage()?.speaker;
    if (onStage && sp && 'fakeUntil' in sp) sp.fakeUntil = performance.now() + ms;
  }

  async function showLine(line, ctx) {
    stats.lines += 1;
    if (line.who === 'note') {
      log.append(el('p', { className: 'fr-note', textContent: line.text }));
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
      return;
    }
    const isChar = line.who === 'char';
    const name = isChar ? (ctx?.character?.name ?? 'この子') : guideName;
    const { text } = row(line.who, name);
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
      text.textContent = line.text;
      live.textContent = line.text;
      scroll();
      const way = await voice.speak(line.text, settings);
      stats.voiced.push({ text: line.text, way });
      if (way === 'browser') mouth(onStage, 0);
      return;
    }
    const ac = new AbortController();
    skip = ac;
    const rate = isChar ? (settings?.voice?.rate ?? 1) : 1.1;
    const pitch = isChar ? (settings?.voice?.pitch ?? 1) : 0.85;
    const cps = 24 * rate;
    mouth(onStage, (countChars(line.text) / cps) * 1000 + 400);
    await crawl(text, line.text, {
      cps,
      signal: ac.signal,
      onChar: () => {
        voice.blipper.blip({ pitch, who: line.who });
        scroll();
      },
    });
    mouth(onStage, 0);
    stats.crawled += 1;
    live.textContent = line.text;
    skip = null;
    scroll();
  }

  /** 台本の present: 文を順に出し、全部出し終わったら解決する */
  async function present(lines, ctx) {
    for (const line of lines) {
      if (closed) return;
      await showLine(line, ctx);
    }
  }

  function button(a) {
    const b = el('button', { type: 'button', className: `fr-btn${a.primary ? ' primary' : ''}`, textContent: a.label });
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
    const label = el('label', { className: `fr-btn${a.primary ? ' primary' : ''}` }, input, a.label);
    label.dataset.act = a.id;
    label.addEventListener('click', () => voice.unlock());
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) return;
      if (!/^image\//.test(f.type) || f.size > PICTURE_MAX) {
        log.append(el('p', { className: 'fr-note', textContent: '画像(20MB まで)を選んでね。' }));
        scroll();
        return;
      }
      const url = URL.createObjectURL(f); // この端末の中だけの、絵の仮の住所(外には送らない)
      urls.add(url);
      onAct(a.id, { url, name: f.name });
    });
    return label;
  }

  /** 手元の PC の「作る画面」(1〜3 歩の入力と絵)を、札の中の枠に出す。絵と通信は枠の中だけで、この画面は知らせだけを受ける */
  function frameAction(a) {
    const f = el('iframe', { className: 'fr-frame', title: a.label ?? 'PC の作る画面', src: a.url });
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    f.addEventListener('load', scroll, { once: true });
    return el('div', { className: 'fr-wide fr-frame-wrap' }, f);
  }

  function textAction(a) {
    const input = el('input', { type: 'text', placeholder: a.placeholder ?? '', autocomplete: 'off', enterKeyHint: 'send', ariaLabel: a.label });
    const count = el('p', { className: 'fr-count', textContent: a.max ? `0 / ${a.max}` : '' });
    const submit = el('button', { type: 'submit', className: 'fr-btn primary', textContent: a.submit ?? '送る' });
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
      onAct(a.id, { text });
    });
    return el('div', { className: 'fr-wide' }, el('p', { className: 'fr-field-label', textContent: a.label }), form, a.max ? count : null);
  }

  function keyAction(a) {
    const input = el('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: 'ElevenLabs の鍵', ariaLabel: 'ElevenLabs の鍵' });
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('data-1p-ignore', '');
    input.setAttribute('data-lpignore', 'true');
    const remember = el('input', { type: 'checkbox' });
    const submit = el('button', { type: 'submit', className: 'fr-btn primary', textContent: a.label });
    const form = el('form', { className: 'fr-field', autocomplete: 'off' }, input, submit);
    form.dataset.act = a.id;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      voice.unlock();
      const key = input.value;
      input.value = ''; // 鍵の文字は、すぐ画面から消す
      if (!key.trim()) return;
      onAct(a.id, { key, remember: a.remember ? remember.checked : false });
    });
    return el(
      'div',
      { className: 'fr-wide' },
      el('p', { className: 'fr-field-label', textContent: '鍵(この欄の文字は、押したらすぐ消えます)' }),
      form,
      a.remember ? el('label', { className: 'fr-remember' }, remember, 'この端末に覚えておく(しない方が安全)') : null,
    );
  }

  /** 台本の offer: 選べる物を出す(空なら消す) */
  function offer(list) {
    actions.replaceChildren(
      ...list.map((a) => (a.kind === 'file' ? fileAction(a) : a.kind === 'text' ? textAction(a) : a.kind === 'key' ? keyAction(a) : a.kind === 'frame' ? frameAction(a) : button(a))),
    );
    if (list.length) stats.actionsShown += 1;
    sheet.dataset.actions = list.map((a) => a.id).join(' ');
    scroll(); // 選択肢の高さが変わると、会話の欄の見える高さも変わる。いつも最後の文が見えるようにする
  }

  function close(reason = 'done') {
    if (closed) return;
    closed = true;
    skip?.abort();
    sheet.remove();
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
    onClose(reason);
  }

  return { element: sheet, present, offer, setStep, close, stats, get closed() { return closed; } };
}
