// キオスクの画面。文字で質問して、見本のキャラの返事が 1 文ずつ出る。声の入出力は、あとから差し込む(window.KioskIO)。
//   window.KioskIO = { stt: { start(), stop(), onText(cb) }, tts: { speak(text) → Promise, stop() } } を、このファイルより前に置くと、
//   声のボタンが使え、返事が読み上げられる。何も置かなければ文字だけ(試作)。
import { REASON_LABEL, buildChatBody, parseEvents, resolveIO, shouldReset, sourceTag } from './core.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const log = $('log');
const field = $('field');
const send = $('send');
const toast = $('toast');
const SAMPLE_QUESTIONS = ['営業時間を教えてください', '入場料はいくらですか?', '行き方を教えてください', '今日のショーは何時からですか?', '写真を撮ってもいいですか?', '応援するには、どうしたらいいですか?'];

const state = { config: null, character: null, persona: '', venue: '', history: [], busy: false, lastActive: Date.now(), io: resolveIO(window.KioskIO) };

function showToast(message, ms = 3500) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => (toast.hidden = true), ms);
}
const touch = () => {
  state.lastActive = Date.now();
};
['pointerdown', 'keydown', 'input'].forEach((ev) => window.addEventListener(ev, touch, { passive: true }));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // 返事は textContent だけで入れる(HTML として読ませない)
  return e;
}
const toBottom = () => (log.scrollTop = log.scrollHeight);

function addMe(text) {
  const m = el('li', 'msg me');
  m.append(el('div', 'bubble', text));
  log.append(m);
  toBottom();
}
function addBot() {
  const m = el('li', 'msg bot');
  const typing = el('div', 'bubble typing', '考え中');
  m.append(typing);
  log.append(m);
  toBottom();
  return { m, typing };
}

const GREETING = 'こんにちは、見本のキャラです。営業時間・料金・行き方・ショーのこと、なんでも聞いてくださいね。';
function setMode(mode) {
  stage.dataset.mode = mode;
  if (mode === 'talk') {
    // 最初のあいさつは、頭脳に聞かずに出す(固定の文。お金も時間もかからない)
    if (!log.children.length) {
      const m = el('li', 'msg bot');
      m.append(el('div', 'bubble', GREETING));
      log.append(m);
    }
    setTimeout(() => field.focus(), 50);
  }
}
function resetConversation() {
  state.history = [];
  log.replaceChildren();
  state.io.tts?.stop?.();
  setMode('attract');
}

async function ask(text) {
  if (state.busy || !text.trim()) return;
  state.busy = true;
  send.disabled = true;
  touch();
  addMe(text);
  const bot = addBot();
  const spoken = [];
  const avatar = $('avatar');
  let first = true;
  let thought = null;
  try {
    const body = buildChatBody({ text, history: state.history, config: state.config, character: state.character, persona: state.persona, venue: state.venue });
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { events, rest } = parseEvents(buf);
      buf = rest;
      for (const ev of events) {
        if (ev.type === 'say') {
          if (first) {
            bot.typing.remove();
            first = false;
            avatar.dataset.talking = '1';
          }
          bot.m.append(el('div', 'bubble', ev.text));
          spoken.push(ev.text);
          state.io.tts?.speak(ev.text);
          toBottom();
        } else if (ev.type === 'thought') thought = ev;
        else if (ev.type === 'handoff') thought = { ...(thought ?? {}), handoff: true, reason: thought?.reason || ev.reason };
        else if (ev.type === 'error') throw new Error(ev.message || '返事を作れませんでした');
      }
    }
    if (first) throw new Error('返事が空でした');
    if (thought?.sources?.length) {
      const src = el('div', 'src');
      for (const s of thought.sources) {
        const t = sourceTag(s);
        const tag = el('span', 'tag', t.text);
        if (t.warn) tag.dataset.warn = '1';
        src.append(tag);
      }
      bot.m.append(src);
    }
    if (thought?.handoff) {
      bot.m.append(el('div', 'handoff', `スタッフにつなぎます(${REASON_LABEL[thought.reason] ?? 'ご案内'})。画面の「スタッフを呼ぶ」も押せます。`));
    }
    state.history.push({ role: 'user', content: text }, { role: 'assistant', content: spoken.join('') });
  } catch (err) {
    bot.typing.remove();
    bot.m.append(el('div', 'bubble', 'すみません、うまくお答えできませんでした。もう一度お話しいただくか、スタッフにお声がけください。'));
    showToast(String(err.message ?? err));
  } finally {
    avatar.dataset.talking = '0';
    state.busy = false;
    send.disabled = false;
    toBottom();
    touch();
    field.focus();
  }
}

$('compose').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = field.value;
  field.value = '';
  ask(text);
});
$('start').addEventListener('click', () => setMode('talk'));
$('staff').addEventListener('click', () => showToast('スタッフを呼びました(試作: スタッフへの通知は、まだつながっていません)', 5000));

// 声の入力(あとから差し込む)。文字が届いたら、そのまま質問として送る
if (state.io.stt) {
  const mic = $('mic');
  mic.disabled = false;
  mic.title = '声で話す';
  mic.addEventListener('click', () => {
    setMode('talk');
    state.io.stt.start();
    showToast('聞いています…', 2500);
  });
  state.io.stt.onText?.((text) => ask(text));
}

// 待ち受けに戻る(触られないまま一定時間)
setInterval(() => {
  if (stage.dataset.mode === 'talk' && !state.busy && shouldReset(state.lastActive, Date.now(), state.config?.idleResetSeconds ?? 90)) resetConversation();
}, 2000);
// 確認・試験用: ?idle=5 で待ち受けに戻る時間を秒で変える(本番の設定は kiosk/config.json)
const idleOverride = Number(new URLSearchParams(location.search).get('idle'));

async function boot() {
  try {
    const [config, status] = await Promise.all([fetch('/kiosk/config.json').then((r) => r.json()), fetch('/api/status').then((r) => r.json())]);
    if (Number.isFinite(idleOverride) && idleOverride > 0) config.idleResetSeconds = idleOverride;
    state.config = config;
    state.character = await fetch(`/characters/${config.characterId}/character.json`).then((r) => r.json());
    state.persona = await fetch(`/characters/${config.characterId}/${state.character.persona}`).then((r) => r.text());
    state.venue = status.shop?.venue || '';
    $('venue').textContent = state.venue ? `${state.venue}の入口` : '入口の案内';
    const brain = $('brainBadge');
    brain.textContent = status.brain === 'haiku' ? `Claude ${status.model.replace('claude-', '')}` : '仮の頭脳(鍵なし)';
    brain.dataset.ok = status.brain === 'haiku' ? '1' : '0';
    const mem = $('memBadge');
    if (status.shop?.memory) {
      const n = status.shop.memory.categories.reduce((s, c) => s + c.count, 0);
      mem.textContent = `${status.shop.memory.label}(${n} 件)`;
      mem.hidden = false;
    }
    const chips = $('chips');
    for (const q of SAMPLE_QUESTIONS) {
      const b = el('button', 'chip', q);
      b.type = 'button';
      b.addEventListener('click', () => ask(q));
      chips.append(b);
    }
    if (new URLSearchParams(location.search).has('talk')) setMode('talk');
  } catch (err) {
    $('brainBadge').textContent = '会話サーバーにつながりません';
    $('brainBadge').dataset.ok = '0';
    showToast(String(err.message ?? err), 6000);
  }
}
boot();
