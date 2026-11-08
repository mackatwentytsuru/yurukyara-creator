// 「かえる」の中の「つくった子」の組。ブラウザで作った子(サーバーの characters/yb*)を並べて、選ぶ・なまえを かえる・けす、ができる。
// - 一覧はサーバーが持つ(GET /api/characters)。画面を読み込み直しても、サーバーを入れ直しても、同じサーバーを開いた別の端末でも出る
// - 選ぶ: 舞台をその子に替える(読み込み直さない)。舞台の子は、main.js が端末に覚えて、読み込み直しても同じ子で始める
// - なまえを かえる: その場で入力 → 「きめる」(PATCH /api/characters)。「ノリー」(いつもの子)の名前は変えられない
// - けす: 「けす?」と 1 回だけ確かめる(本当に困るのは、消すことだけ)。舞台にいる子を消す時は、先に主役に戻す。
//   その子が覚えた記憶と、その子の性格の設定も一緒に消す。サーバーでは捨てずに別の場所へ移す(あとで戻せる)
// - 通信は /api/characters と /api/memory だけ。この組は、作った子が 1 人もいなければ出さない
import { MAIN_CHARACTER } from '../character/defaults.js';
import { STORE_PREFIX } from './persona/settings.js';
import { forgetMemoryOf } from './memoryKey.js';

export const GROUP_LABEL = 'つくった子';
export const NAME_MAX = 20;
export const TEXT = Object.freeze({
  rename: 'なまえ',
  remove: 'けす',
  ok: 'きめる',
  cancel: 'やめる',
  ask: 'けす?',
  sure: 'けす',
  nameEmpty: 'なまえを いれてね',
  renameFail: 'なまえを かえられなかったよ',
  removeFail: 'けせなかったよ。もういちど おしてね',
  pickFail: 'いま 舞台に 出せないよ。あとで もういちど おしてね',
});

/** 名前を整える(サーバーと同じ決まり: 制御文字・<>"`\ を空白に、空白をつめ、20 字まで)。使えなければ '' */
export function cleanName(raw) {
  const s = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>"`\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...s].slice(0, NAME_MAX).join('').trim();
}

/** 作った時刻を「11/8 14:25」の形に(同じ名前の子を見分ける目印)。時刻が無ければ '' */
export function formatMade(at) {
  if (!Number.isFinite(at) || at <= 0) return '';
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const STYLE = `
#madeKids { pointer-events: auto; max-width: min(100%, 640px); max-height: 38vh; overflow-y: auto; padding: 8px 10px 10px; border-radius: 16px; background: var(--glass, rgba(24,21,40,.62)); border: 1px solid var(--line, rgba(255,255,255,.12)); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); color: var(--text, #f4f1fb); }
#madeKids[hidden] { display: none; }
#madeKids .mk-title { margin: 0 0 6px; font-size: 14px; font-weight: 600; color: var(--muted, #b2abc9); }
#madeKids .mk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
#madeKids .mk-kid { display: flex; align-items: center; gap: 4px; padding: 3px; border-radius: 999px; border: 1px solid var(--line, rgba(255,255,255,.12)); background: rgba(255,255,255,.04); }
#madeKids .mk-kid[data-now="1"] { border-color: var(--lav, #b7a8ff); background: rgba(183,168,255,.16); }
#madeKids button, #madeKids input { font: inherit; font-size: 14px; color: inherit; }
#madeKids button { min-height: 44px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
#madeKids button:focus-visible, #madeKids input:focus-visible { outline: 2px solid var(--lav, #b7a8ff); outline-offset: 2px; }
#madeKids button:disabled { opacity: .5; cursor: default; }
#madeKids .mk-pick { padding-left: 4px; }
#madeKids .mk-thumb { width: 36px; height: 36px; border-radius: 12px; object-fit: contain; background: #fff; flex: none; }
#madeKids .mk-thumb[hidden] { display: none; }
#madeKids .mk-text { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.2; text-align: left; }
#madeKids .mk-date { font-size: 11px; color: var(--muted, #b2abc9); }
#madeKids .mk-edit, #madeKids .mk-del, #madeKids .mk-cancel { font-size: 13px; color: var(--muted, #b2abc9); padding: 0 10px; }
#madeKids .mk-del, #madeKids .mk-ask { color: var(--coral, #ff8f7a); }
#madeKids .mk-ok, #madeKids .mk-sure { background: var(--lav, #b7a8ff); color: var(--ink, #14121f); font-weight: 600; }
#madeKids .mk-sure { background: var(--coral, #ff8f7a); }
#madeKids .mk-input { min-height: 44px; width: 11em; max-width: 52vw; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line, rgba(255,255,255,.2)); background: rgba(0,0,0,.25); }
#madeKids .mk-note { margin: 8px 2px 0; font-size: 13px; color: var(--warn, #ffd37a); }
#madeKids .mk-note:empty { display: none; }
html.top-simple #madeKids { display: none; }
html.top-simple.top-change:not(.top-more) #madeKids:not([hidden]) { display: block; }
`;

/** @param {Document} doc */
function injectStyle(doc) {
  try {
    if (!doc?.head || doc.getElementById?.('madeKidsStyle')) return;
    const el = doc.createElement('style');
    el.id = 'madeKidsStyle';
    el.textContent = STYLE;
    doc.head.append(el);
  } catch {
    // 見た目が付かなくても、働きは同じ
  }
}

/**
 * @param {object} o
 * @param {HTMLElement} o.root この組を入れる箱(index.html の #madeKids)
 * @param {() => string} o.getStageId いま舞台にいる子の id
 * @param {(id: string) => Promise<boolean>} o.putOnStage 舞台をその子にする(できたら true)
 * @param {(id: string) => void} [o.onPicked] 選んで、舞台が替わった後(「かえる」の段を閉じる)
 * @param {(id: string, name: string) => void} [o.onRenamed] 名前を変えた後
 * @param {(id: string) => void} [o.onRemoved] 消した後
 * @param {Storage|null} [o.storage] 消した子の性格の設定を消す場所(localStorage)
 * @param {Document} [o.doc]
 */
export function mountMadeKids({ root, getStageId, putOnStage, onPicked = () => {}, onRenamed = () => {}, onRemoved = () => {}, storage = null, doc = globalThis.document }) {
  injectStyle(doc);
  const el = (tag, props = {}) => Object.assign(doc.createElement(tag), props);
  const title = el('h3', { className: 'mk-title', textContent: GROUP_LABEL });
  const list = el('ul', { className: 'mk-list' });
  list.setAttribute?.('aria-label', GROUP_LABEL);
  const note = el('p', { className: 'mk-note' });
  note.setAttribute?.('role', 'status');
  root.hidden = true;
  root.replaceChildren(title, list, note);

  let items = [];
  const mode = new Map(); // id → 'rename' | 'ask'
  let busy = false;
  let refreshing = 0;

  const say = (text) => {
    note.textContent = text ?? '';
  };
  const button = (cls, text, label, onClick, disabled = false) => {
    const b = el('button', { type: 'button', className: cls, textContent: text, disabled });
    if (label) b.setAttribute?.('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  };

  function mainKid() {
    const now = getStageId() === MAIN_CHARACTER.id;
    const li = el('li', { className: 'mk-kid' });
    li.dataset.id = MAIN_CHARACTER.id;
    li.dataset.now = now ? '1' : '0';
    const pick = button('mk-pick', MAIN_CHARACTER.name, `${MAIN_CHARACTER.name}にする`, () => pick1(MAIN_CHARACTER.id, MAIN_CHARACTER.name), busy);
    pick.setAttribute?.('aria-pressed', String(now));
    li.append(pick);
    return li;
  }

  function kid(it) {
    const now = getStageId() === it.id;
    const li = el('li', { className: 'mk-kid' });
    li.dataset.id = it.id;
    li.dataset.now = now ? '1' : '0';
    const m = mode.get(it.id);
    if (m === 'rename') {
      const input = el('input', { type: 'text', className: 'mk-input', value: it.name, maxLength: NAME_MAX });
      input.setAttribute?.('aria-label', `${it.name}の なまえ`);
      const save = () => rename1(it, input.value);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault?.();
          save();
        } else if (e.key === 'Escape') {
          e.stopPropagation?.();
          setMode(it.id, null);
        }
      });
      li.append(input, button('mk-ok', TEXT.ok, `${it.name}の なまえを きめる`, save, busy), button('mk-cancel', TEXT.cancel, null, () => setMode(it.id, null)));
      globalThis.setTimeout?.(() => input.focus?.(), 0);
      return li;
    }
    if (m === 'ask') {
      const q = el('span', { className: 'mk-ask', textContent: `${it.name}を ${TEXT.ask}` });
      li.append(q, button('mk-sure', TEXT.sure, `${it.name}を けす(もとには もどせません)`, () => remove1(it), busy), button('mk-cancel', TEXT.cancel, null, () => setMode(it.id, null)));
      return li;
    }
    const pick = button('mk-pick', '', `${it.name}にする`, () => pick1(it.id, it.name), busy);
    pick.setAttribute?.('aria-pressed', String(now));
    if (it.look === '2d') {
      const img = el('img', { className: 'mk-thumb', alt: '', loading: 'lazy', src: `/characters/${it.id}/2d/body.svg` });
      img.addEventListener('error', () => {
        img.hidden = true;
      });
      pick.append(img);
    }
    const text = el('span', { className: 'mk-text' });
    text.append(el('span', { className: 'mk-name', textContent: it.name }));
    const when = formatMade(it.at);
    if (when) text.append(el('span', { className: 'mk-date', textContent: when }));
    pick.append(text);
    li.append(pick, button('mk-edit', TEXT.rename, `${it.name}の なまえを かえる`, () => setMode(it.id, 'rename'), busy), button('mk-del', TEXT.remove, `${it.name}を けす`, () => setMode(it.id, 'ask'), busy));
    return li;
  }

  function render() {
    root.hidden = items.length === 0;
    list.replaceChildren(mainKid(), ...items.map(kid));
  }
  function setMode(id, m) {
    if (m) mode.set(id, m);
    else mode.delete(id);
    say('');
    render();
  }

  async function pick1(id, name) {
    if (busy) return;
    if (id === getStageId()) return void onPicked(id);
    busy = true;
    say('');
    render();
    let ok = false;
    try {
      ok = await putOnStage(id);
    } catch {
      ok = false;
    }
    busy = false;
    if (ok) onPicked(id);
    else say(`${name}は、${TEXT.pickFail}`);
    render();
  }

  async function rename1(it, value) {
    if (busy) return;
    const name = cleanName(value);
    if (!name) return void say(TEXT.nameEmpty);
    if (name === it.name) return void setMode(it.id, null);
    busy = true;
    render();
    try {
      const r = await fetch('/api/characters', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: it.id, name }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j.error ?? TEXT.renameFail));
      it.name = cleanName(j.name) || name;
      mode.delete(it.id);
      say('');
      onRenamed(it.id, it.name);
    } catch (err) {
      say(String(err?.message || TEXT.renameFail).slice(0, 60));
    }
    busy = false;
    render();
  }

  async function remove1(it) {
    if (busy) return;
    busy = true;
    say('');
    render();
    try {
      // 舞台にいる子を消す時は、先に主役へ戻す(戻せなければ、消さない)
      if (getStageId() === it.id && !(await putOnStage(MAIN_CHARACTER.id))) throw new Error(TEXT.pickFail);
      // 先に子を消す。断られた時に、記憶だけが消えないように(記憶は、消せた後で)
      const r = await fetch('/api/characters', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: it.id }) });
      if (!r.ok && r.status !== 404) throw new Error(TEXT.removeFail);
      await forgetMemoryOf(it.id).catch(() => null); // その子が覚えた事も消す(消せなくても、子は消えている)
      try {
        storage?.removeItem(`${STORE_PREFIX}${it.id}`); // その子の性格の設定
      } catch {
        // 消せなくても続ける
      }
      items = items.filter((x) => x.id !== it.id);
      mode.delete(it.id);
      onRemoved(it.id);
    } catch (err) {
      say(String(err?.message || TEXT.removeFail).slice(0, 60));
      mode.delete(it.id);
    }
    busy = false;
    render();
  }

  /** サーバーから一覧を読み直す(「かえる」を開くたび・作り終わった時・起動の時)。読めなければ、いまの表示のまま */
  async function refresh() {
    const mine = ++refreshing;
    try {
      const r = await fetch('/api/characters');
      if (!r.ok) {
        if (r.status === 404 && mine === refreshing) {
          items = [];
          render();
        }
        return items;
      }
      const j = await r.json();
      if (mine !== refreshing) return items; // もっと新しい読み直しが走っている
      items = (Array.isArray(j.items) ? j.items : [])
        .filter((x) => x && /^[a-z0-9_]{1,32}$/.test(String(x.id)))
        .map((x) => ({ id: String(x.id), name: cleanName(x.name) || 'あたらしい子', at: Number(x.at) || 0, look: x.look === '2d' ? '2d' : '3d' }));
      for (const id of [...mode.keys()]) if (!items.some((x) => x.id === id)) mode.delete(id);
      if (!busy) render();
    } catch {
      // つながらない時は、いまの表示のまま
    }
    return items;
  }

  return {
    root,
    refresh,
    /** 舞台の子が替わった時の見た目の合わせ直し(選んだ印) */
    sync: () => render(),
    items: () => items.map((x) => ({ ...x })),
    /** 名前が変わった子を一覧にも反映する(別の入口から変えた時) */
    setName(id, name) {
      const it = items.find((x) => x.id === id);
      if (it) it.name = name;
      render();
    },
  };
}
