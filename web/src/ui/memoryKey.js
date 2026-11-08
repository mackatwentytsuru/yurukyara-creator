// 端末をまたぐ記憶の「合鍵」を、この端末に持つ。合鍵は URL に入れず、ヘッダー x-memory-key で送る。
// 合鍵が無いと、サーバーの記憶は読めない。別の端末へは 6 桁の番号で渡す(10 分・1 回だけ)。
// ブラウザの保存(localStorage)が使えない時は、この画面を開いている間だけ覚える。
// 画面は合鍵を自分で作らない(11-07 CRITsec F8)。開いただけ・全部わすれた後は合鍵なしのまま。
// 合鍵は、会話で覚える事が出た最初の回に、サーバーが返事のイベント { type:'memory', key } で渡す(adoptKey で持つ)か、番号で受け取る。
import { demoHeaders } from '../conversation/demoPass.js';
import { MEMORY_NOTICE, RETENTION_DAYS } from '../conversation/memoryNotice.js';

const STORAGE = 'yc.memoryKey';
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
let memo = '';

export function getKey() {
  try {
    const k = localStorage.getItem(STORAGE) ?? '';
    if (KEY_RE.test(k)) return k;
  } catch {
    // 保存が使えない(private の窓など)
  }
  return KEY_RE.test(memo) ? memo : '';
}

export function setKey(key) {
  if (!KEY_RE.test(key)) throw new Error('合鍵の形が違います');
  memo = key;
  try {
    localStorage.setItem(STORAGE, key);
  } catch {
    // この画面の間だけ覚える
  }
}

export function clearKey() {
  memo = '';
  try {
    localStorage.removeItem(STORAGE);
  } catch {
    // 何もしない
  }
}

// 記憶は、話している子ごとに分ける(合鍵は端末で 1 つ。その中で、子の id ごとに覚える)。いま舞台にいる子の id(main.js が入れる)
const CHARACTER_RE = /^[a-z0-9_]{1,32}$/;
let character = '';

/** いま話している子の id を覚える(形の違う値は ''。'' の時は、子を分けずに送る) */
export function setMemoryCharacter(id) {
  character = typeof id === 'string' && CHARACTER_RE.test(id) ? id : '';
}

export const getMemoryCharacter = () => character;

const characterHeader = () => (character ? { 'x-yc-character': character } : {});

/** 会話や記憶の API に付けるヘッダー(合鍵が無ければ合鍵は付けない。話している子の id は、決まっていれば付ける) */
export function memoryHeaders() {
  const k = getKey();
  return { ...(k ? { 'x-memory-key': k } : {}), ...characterHeader() };
}

/** 返事を読み、だめなら分かる言葉の例外にする */
async function read(res, what) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `${what} (${res.status})`), { status: res.status, reason: data.reason });
  return data;
}

const jsonHeaders = () => ({ 'content-type': 'application/json', ...memoryHeaders() });
/** 合言葉の見出し: 札の欄に入っていればそれ、無ければ会話の合言葉(公開では、番号を作る時も受け取る時も要る) */
const passHeaders = (pass) => {
  const p = String(pass ?? '').trim();
  return p ? { 'x-demo-pass': p } : demoHeaders();
};
// 宛先は、どれも文字で書く(画面の通信先の点検 privacy.test が見る)
const api = {
  list: async (key = getKey()) => read(await fetch('/api/memory', { headers: { ...(key ? { 'x-memory-key': key } : {}), ...characterHeader() } }), '記憶を読めません'),
  create: async () => read(await fetch('/api/memory/new', { method: 'POST' }), '合鍵を作れません'),
  // everyone: この端末の合鍵の記憶を、どの子の分も全部消す(子の id を付けずに送る)。付ければ、いまの子が覚えた事だけ
  forget: async (body, { everyone = false } = {}) =>
    read(await fetch('/api/memory', { method: 'DELETE', headers: everyone ? { 'content-type': 'application/json', ...(getKey() ? { 'x-memory-key': getKey() } : {}) } : jsonHeaders(), body: JSON.stringify(body) }), '記憶を消せません'),
  pair: async (pass) => read(await fetch('/api/memory/pair', { method: 'POST', headers: { ...memoryHeaders(), ...passHeaders(pass) } }), '番号を作れません'),
  claim: async (code, pass) => read(await fetch('/api/memory/claim', { method: 'POST', headers: { 'content-type': 'application/json', ...characterHeader(), ...passHeaders(pass) }, body: JSON.stringify({ code }) }), '番号を受け取れません'),
};

/** 合鍵がまだ無い時の、空の一覧(サーバーに聞かない。知らせの文は同じ) */
export const emptyMemory = () => ({ items: [], notice: MEMORY_NOTICE, retentionDays: RETENTION_DAYS, expiresAt: null });

/** 番号を出そうとした時、まだ合鍵が無い(何も覚えていない)時の知らせ */
export const NOTHING_TO_PAIR = 'まだ何も覚えていないので、番号は出せません。先に、名前や好きなものを話しかけてね';

/**
 * 今の一覧を読む。合鍵が無ければ、サーバーに聞かずに空の一覧(合鍵は作らない。CRITsec F8)。
 * 合鍵が消えていた・7 日たっていた(404・401)時は、その合鍵を捨てて空の一覧。
 * 読んでいる間に会話のイベントで新しい合鍵が届いていたら、新しい方は捨てない。
 */
export async function loadMemory() {
  const key = getKey();
  if (!key) return emptyMemory();
  try {
    return { key, ...(await api.list(key)) };
  } catch (err) {
    if (err.status !== 404 && err.status !== 401) throw err;
    if (getKey() === key) clearKey();
    return emptyMemory();
  }
}

/**
 * 会話の返事のイベントで届いた合鍵を持つ(覚える事が出た最初の回に、サーバーが作って渡す)。
 * 形の違う値は持たない。もう合鍵を持っている時も持たない(その回を送った後に番号で受け取った合鍵を、上書きしない)。持ったら true
 */
export function adoptKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key) || getKey()) return false;
  setKey(key);
  return true;
}

/**
 * 合鍵を作って一覧を返す(道具・試しのための口。画面の札はもう呼ばない: 開いただけで合鍵を作らない。CRITsec F8)。
 * 合鍵があれば確かめ、消えていれば作り直す。
 */
export async function ensureKey() {
  const have = await loadMemory();
  if (have.key) return have;
  const made = await api.create();
  setKey(made.key);
  return made;
}

export const listMemory = () => api.list();
export const forgetItem = (id) => api.forget({ id: String(id) });

/** 全部消して、この端末の合鍵も捨てる。合鍵が無ければ、消す物も無いので聞かない(新しい合鍵も作らない) */
export async function forgetAll() {
  if (!getKey()) return { ok: true, forgotten: false };
  const r = await api.forget({}, { everyone: true });
  clearKey();
  return r;
}

/** 指した子(id)が覚えた事だけを消す(その子を消す時。合鍵とほかの子の記憶は残す)。合鍵が無ければ、消す物も無い */
export async function forgetMemoryOf(id) {
  if (!getKey() || !CHARACTER_RE.test(String(id))) return { ok: true, forgotten: false };
  return read(await fetch('/api/memory', { method: 'DELETE', headers: { 'content-type': 'application/json', 'x-memory-key': getKey(), 'x-yc-character': String(id) }, body: '{}' }), '記憶を消せません');
}

/**
 * 別の端末へ渡す 6 桁の番号を作る。合言葉(公開のとき)は画面の入力欄から受け、見出し x-demo-pass で送る(空なら、会話の合言葉を使う)。
 * まだ合鍵が無い(何も覚えていない)時は、サーバーに聞かずに知らせの文で断る(合鍵は作らない)
 */
export async function pairCode({ pass = '' } = {}) {
  if (!getKey()) throw Object.assign(new Error(NOTHING_TO_PAIR), { reason: 'no_memory' });
  return api.pair(pass);
}

/**
 * 番号を入れて、合鍵を受け取る。この端末の前の合鍵は置き換える。
 * 合言葉(公開のとき)は、札の欄の値か、会話の合言葉を見出し x-demo-pass で送る(手元のサーバーは見ない)
 */
export async function claimCode(code, { pass = '' } = {}) {
  const clean = String(code ?? '').replace(/\D/g, '');
  if (clean.length !== 6) throw new Error('番号は 6 けたの数字です');
  const data = await api.claim(clean, pass);
  setKey(data.key);
  return data;
}
