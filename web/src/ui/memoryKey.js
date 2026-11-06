// 端末をまたぐ記憶の「合鍵」を、この端末に持つ。合鍵は URL に入れず、ヘッダー x-memory-key で送る。
// 合鍵が無いと、サーバーの記憶は読めない。別の端末へは 6 桁の番号で渡す(10 分・1 回だけ)。
// ブラウザの保存(localStorage)が使えない時は、この画面を開いている間だけ覚える。
import { demoHeaders } from '../conversation/demoPass.js';

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

/** 会話や記憶の API に付けるヘッダー(合鍵が無ければ空) */
export function memoryHeaders() {
  const k = getKey();
  return k ? { 'x-memory-key': k } : {};
}

/** 返事を読み、だめなら分かる言葉の例外にする */
async function read(res, what) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `${what} (${res.status})`), { status: res.status, reason: data.reason });
  return data;
}

const jsonHeaders = () => ({ 'content-type': 'application/json', ...memoryHeaders() });
// 宛先は、どれも文字で書く(画面の通信先の点検 privacy.test が見る)
const api = {
  list: async () => read(await fetch('/api/memory', { headers: memoryHeaders() }), '記憶を読めません'),
  create: async () => read(await fetch('/api/memory/new', { method: 'POST' }), '合鍵を作れません'),
  forget: async (body) => read(await fetch('/api/memory', { method: 'DELETE', headers: jsonHeaders(), body: JSON.stringify(body) }), '記憶を消せません'),
  pair: async (pass) => read(await fetch('/api/memory/pair', { method: 'POST', headers: { ...memoryHeaders(), ...(pass ? { 'x-demo-pass': pass } : demoHeaders()) } }), '番号を作れません'),
  claim: async (code) => read(await fetch('/api/memory/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }), '番号を受け取れません'),
};

/** 合鍵が無ければ作る。あれば、まだサーバーに記憶があるかを確かめ、無ければ作り直す */
export async function ensureKey() {
  if (getKey()) {
    try {
      return { key: getKey(), ...(await api.list()) };
    } catch (err) {
      if (err.status !== 404 && err.status !== 401) throw err;
      clearKey(); // 消えた・7 日たった合鍵は捨てる
    }
  }
  const made = await api.create();
  setKey(made.key);
  return made;
}

export const listMemory = () => api.list();
export const forgetItem = (id) => api.forget({ id: String(id) });

/** 全部消して、この端末の合鍵も捨てる */
export async function forgetAll() {
  const r = await api.forget({});
  clearKey();
  return r;
}

/** 別の端末へ渡す 6 桁の番号を作る。合言葉(公開のとき)は画面の入力欄から受け、見出し x-demo-pass で送る(空なら、会話の合言葉を使う) */
export const pairCode = ({ pass = '' } = {}) => api.pair(pass);

/** 番号を入れて、合鍵を受け取る。この端末の前の合鍵は置き換える */
export async function claimCode(code) {
  const clean = String(code ?? '').replace(/\D/g, '');
  if (clean.length !== 6) throw new Error('番号は 6 けたの数字です');
  const data = await api.claim(clean);
  setKey(data.key);
  return data;
}
