// 作る道(1〜3 歩目)の受け口。台本(script.js)はこの形だけを使う:
//   creator.mode            'sample'(見本を出す)| 'local'(手元の PC の作る道具へ渡す)
//   creator.check(input, o)  → { class: 'yuru'|'human'|'complex', by: 'claude'|'pixels'|'person', message }(絵のときだけ)
//   creator.make(input, o)   → { id, name, sample: boolean, note, local?, picture?, round? }(できた子。見本なら sample: true)
//   creator.review(id, 'ok'|'redo', 一言, o) → { ok, message }(手元で作った子だけ。K3 の request.json へ)
//   creator.redrawn(id, o)   → できた子(やり直しの次の回の絵。手元で作った子だけ)
//   o = { signal, onProgress(text) }。待つ間の様子は onProgress で伝え、signal で待つのをやめられる
// 'sample': Claude Code で作ってある子を、言葉に近い順に出す。絵はこの端末の外に送らない。
// 'local' : 言葉か絵 1 枚を、手元の PC の確認画面のサーバー(creator/review/serve_review.py --make)へ渡す。
//           PC で /yuru-next を打つと、ゆるキャラチェック → 段 0 の絵 → C0 に出る。OK・やり直し+一言は K3 の request.json。

/** 見本の子(characters/<id>/ にある物)。words は Claude が絵を描いた元の言葉(記録のある物だけ書く) */
export const SAMPLE_CHARACTERS = [
  { id: 'mikan', name: 'みかんちゃん', note: '言葉「みかんの子。まるくて元気。頭に葉っぱが 1 枚」から Claude が描いて作った子', keys: ['みかん', 'オレンジ', 'くだもの', '果物', '葉っぱ'] },
  { id: 'd_lantern', name: 'ちょうちんくん', note: 'Claude が描いた絵から作った子', keys: ['ちょうちん', '提灯', 'あかり', '明かり', '灯り', 'お祭り'] },
  { id: 'robo', name: 'ロボくん', note: 'Claude が描いた絵から作った子', keys: ['ロボ', 'ろぼ', 'ロボット', '機械', 'メカ'] },
  { id: 'f_led', name: 'パネルくん', note: 'Claude が描いた絵から作った子', keys: ['パネル', '画面', 'LED', 'テレビ', 'モニター'] },
  { id: 'yokoso', name: 'ようこそくん', note: 'Claude が描いた絵から作った子', keys: ['ようこそ', '受付', '案内', 'いらっしゃい', 'みどり', '緑'] },
];

/** 言葉にいちばん近い見本(当たる言葉が無ければ、言葉から作った見本) */
export function pickSample(words, samples = SAMPLE_CHARACTERS) {
  const w = String(words ?? '').normalize('NFKC').toLowerCase();
  let best = null;
  let bestHits = 0;
  for (const s of samples) {
    const hits = s.keys.filter((k) => w.includes(k.normalize('NFKC').toLowerCase())).length;
    if (hits > bestHits) {
      best = s;
      bestHits = hits;
    }
  }
  return best ?? samples[0];
}

/**
 * 見本の道。絵の入口では、主役(協力者が手で描いた絵から作った子)を出す。主役がまだ舞台に無ければ、言葉の見本にする。
 * @param {object} [o]
 * @param {{id:string, name:string}} [o.main] 主役。絵から作った見本として出す(無ければ見本の 1 番目)
 * @param {object[]} [o.samples]
 * @param {(id:string)=>Promise<boolean>} [o.exists] 主役が舞台に出せるか(入口 index.js が舞台のキャラで答える。通信はしない)
 */
export function createSampleCreator({ main = null, samples = SAMPLE_CHARACTERS, exists = async () => true } = {}) {
  return {
    mode: 'sample',
    async check() {
      // Claude の確かめは手元の PC だけ。見本の道では、使う人に選んでもらう(台本がそう伝える)
      return { class: 'complex', by: 'person', message: '' };
    },
    async make(input) {
      if (input?.from === 'picture' && main?.id && (await exists(main.id))) {
        return { id: main.id, name: main.name, sample: true, note: '協力者が手で描いた絵から、Claude Code で作った子' };
      }
      const s = pickSample(input?.words ?? '', samples);
      return { id: s.id, name: s.name, sample: true, note: s.note };
    },
  };
}

/* ---------- 手元の PC の作る道('local') ---------- */

export const LOCAL_HINT = 'PC の Claude Code で /yuru-next と打つと、描き始めます(描くのに数分かかります)。';
const LOCAL_NOTE = '手元の PC の Claude Code が描いた絵';
const PRIVATE_HOST = /^(127\.0\.0\.1|localhost|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|[a-z0-9-]+(\.[a-z0-9-]+)*\.(ts\.net|local))$/i;

/**
 * 作る道のサーバーの場所が、手元(この PC か家の中のネットワーク)か。よその場所へ絵と合言葉を送らないための確かめ。
 * @param {string} base 例 http://127.0.0.1:8796
 */
export function isLocalBase(base) {
  try {
    const u = new URL(base);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash && PRIVATE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

const MAKE_EVENTS = new Set(['ready', 'sent', 'progress', 'checked', 'chose', 'drawn', 'decided', 'restart', 'error']);
const clipText = (s, n) => [...String(s ?? '')].slice(0, n).join('');

/** 作る画面からの知らせを、決めた欄と形だけにする(知らない物は捨てる) */
export function cleanMakeEvent(d) {
  if (!d || typeof d !== 'object' || d.src !== 'yc-make' || !MAKE_EVENTS.has(d.ev)) return null;
  const e = { ev: d.ev };
  if (d.ev === 'sent') {
    e.from = d.from === 'picture' ? 'picture' : 'words';
    if (e.from === 'words') e.words = clipText(d.words, 60);
  }
  if (d.ev === 'progress' || d.ev === 'error') e.text = clipText(d.text ?? d.message, 120);
  if (d.ev === 'checked') {
    if (!['yuru', 'human', 'complex'].includes(d.class)) return null;
    Object.assign(e, { class: d.class, message: clipText(d.message, 120), by: d.by === 'claude' ? 'claude' : 'pixels' });
  }
  if (d.ev === 'chose') e.choice = d.choice === 'redraw' ? 'redraw' : 'yurufy';
  if (d.ev === 'drawn' || d.ev === 'decided') {
    if (d.id !== undefined && !/^[a-z0-9_]{1,32}$/.test(String(d.id))) return null;
    if (d.id !== undefined) e.id = String(d.id);
    if (d.name !== undefined) e.name = clipText(d.name, 40) || '新しい子';
    e.round = Number.isInteger(d.round) && d.round > 0 ? d.round : 1;
  }
  if (d.ev === 'decided') {
    e.decision = d.decision === 'ok' ? 'ok' : 'redo';
    if (e.decision === 'redo') e.note = clipText(d.note, 40);
  }
  return e;
}

/**
 * 手元の PC の作る道。1〜3 歩の入力と絵は、PC のサーバーが配る「作る画面」(/m/)を札の中の枠に出して、その中だけで扱う。
 * この画面のコードは、絵にも通信にも触らない(test/privacy.test.mjs の約束のまま)。受け取るのは、枠からの状態の知らせ(postMessage)だけ。
 * @param {object} o
 * @param {string} o.base 作る道のサーバー(例 http://127.0.0.1:8796)。手元の場所だけ(isLocalBase)
 * @param {string} o.key 合言葉(枠の URL の # の後ろで渡す。サーバーには送られない。画面・記録に出さない)
 * @param {string} [o.parentOrigin] この画面の元(枠は、ここにだけ知らせを送る)
 * @param {Window} [o.win]
 */
export function createLocalCreator({ base, key, parentOrigin = globalThis.location?.origin ?? '', win = globalThis } = {}) {
  if (!isLocalBase(base)) throw new Error('作る道のサーバーは、この PC か家の中のネットワークの場所だけです');
  if (!key) throw new Error('作る道の合言葉がありません');
  const origin = new URL(base).origin;
  const frameUrl = `${origin}/m/#k=${encodeURIComponent(key)}&p=${encodeURIComponent(parentOrigin)}`;
  const listeners = new Set();
  const onMessage = (msg) => {
    if (msg?.origin !== origin) return; // 作る画面の元からの知らせだけ
    const e = cleanMakeEvent(msg.data);
    if (!e) return;
    for (const f of listeners) f(e);
  };
  win.addEventListener?.('message', onMessage);
  return {
    mode: 'local',
    base: origin,
    frameUrl,
    note: LOCAL_NOTE,
    /** 枠からの知らせを受ける。戻り値で受けるのをやめる */
    listen(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    close() {
      listeners.clear();
      win.removeEventListener?.('message', onMessage);
    },
  };
}
