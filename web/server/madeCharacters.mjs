// 使う人が作った子(ブラウザから Claude に描いてもらった子)の一覧・名前の変更・消す、の受け口。
// 作った子は characters/yb<日付>_<乱数>/ に残る(draw.mjs)。ここは、それをサーバーのフォルダから読んで画面に渡すだけ。
// - GET    /api/characters                   → { items: [{ id, name, at, look }] }(新しい順。見本の子・主役は入れない)
// - PATCH  /api/characters  { id, name }     → 名前を変える(character.json と persona.md の見出し)
// - DELETE /api/characters  { id }           → 消す。ほんとうに捨てずに creator/work/_deleted_characters/ へ移す(あとで戻せる)
// 名前の変更と消すは、ブラウザから作る設定(YC_BROWSER_DRAW=1)の時か、この PC の中からの時だけ(作る道と同じ信頼の範囲)。
// 一覧は YC_CHARACTER_LIST=0 で止められる。
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** ブラウザから描いた子の id の形(draw.mjs が付ける。見本の子と混ざらない) */
export const MADE_ID_RE = /^yb\d{6}_[0-9a-f]{6}$/;
export const NAME_MAX = 20;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const EDITS_PER_MINUTE = 60;

/** 名前を整える(制御文字・<>"`を外し、空白をつめ、20 字まで)。使えなければ '' */
export function cleanName(raw) {
  const s = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>"`\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...s].slice(0, NAME_MAX).join('').trim();
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** @param {{root:string, now?:()=>number}} o root = リポジトリの頭 */
export function createMadeCharacters({ root, now = Date.now }) {
  const base = join(root, 'characters');
  const dirOf = (id) => join(base, id);
  const jsonOf = (id) => join(dirOf(id), 'character.json');

  const createdAt = (id, json) => {
    const t = Date.parse(json?.origin?.created ?? '');
    if (Number.isFinite(t)) return t;
    try {
      return Math.round(statSync(jsonOf(id)).mtimeMs);
    } catch {
      return 0;
    }
  };

  return {
    /** 作った子の一覧(新しい順) */
    list() {
      let names = [];
      try {
        names = readdirSync(base);
      } catch {
        return [];
      }
      const items = [];
      for (const id of names) {
        if (!MADE_ID_RE.test(id)) continue;
        const json = readJson(jsonOf(id));
        if (!json || json.id !== id) continue;
        items.push({
          id,
          name: cleanName(json.name) || 'あたらしい子',
          at: createdAt(id, json),
          look: existsSync(join(dirOf(id), '2d', 'parts.json')) && !json.model ? '2d' : '3d',
        });
      }
      return items.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    },

    /** 名前を変える。変えた名前を返す。無い子・使えない名前は理由つきで投げる */
    rename(id, rawName) {
      if (!MADE_ID_RE.test(String(id))) throw Object.assign(new Error('この子は名前を変えられません'), { status: 404 });
      const json = readJson(jsonOf(id));
      if (!json || json.id !== id) throw Object.assign(new Error('その子は見つかりません'), { status: 404 });
      const name = cleanName(rawName);
      if (!name) throw Object.assign(new Error('名前を入れてね'), { status: 400 });
      const old = String(json.name ?? '');
      const next = { ...json, name };
      writeFileSync(`${jsonOf(id)}.tmp`, `${JSON.stringify(next, null, 2)}\n`);
      renameSync(`${jsonOf(id)}.tmp`, jsonOf(id)); // 書きかけを残さない
      // persona.md の見出し(# あたらしい子)も、新しい名前に
      const pFile = join(dirOf(id), String(json.persona ?? 'persona.md'));
      if (existsSync(pFile)) {
        const text = readFileSync(pFile, 'utf8');
        const lines = text.split('\n');
        const head = lines[0].replace(/\r$/, '');
        if (head === `# ${old}` || head === '# あたらしい子') {
          lines[0] = `# ${name}${lines[0].endsWith('\r') ? '\r' : ''}`;
          writeFileSync(pFile, lines.join('\n'));
        }
      }
      return name;
    },

    /** 消す: フォルダを creator/work/_deleted_characters/<id>_<時刻>/ へ移す(捨てない)。移した先の名前を返す */
    remove(id) {
      if (!MADE_ID_RE.test(String(id)) || !existsSync(jsonOf(id))) throw Object.assign(new Error('その子は見つかりません'), { status: 404 });
      const trash = join(root, 'creator', 'work', '_deleted_characters');
      mkdirSync(trash, { recursive: true });
      const stamp = new Date(now()).toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const to = join(trash, `${id}_${stamp}`);
      renameSync(dirOf(id), to);
      return `${id}_${stamp}`;
    },
  };
}

/**
 * 受け口。当たれば true(応答済み)。
 * @param {object} o
 * @param {string} o.root
 * @param {NodeJS.ProcessEnv} [o.env]
 * @param {(req:any, limit?:number)=>Promise<any>} o.readBody
 * @param {() => boolean} o.canEdit ブラウザから作る設定か(名前の変更と消すの許し)
 */
export function createMadeRoutes({ root, env = process.env, readBody, canEdit, now = Date.now }) {
  const made = createMadeCharacters({ root, now });
  const send = (res, status, obj) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(obj));
  const edits = new Map(); // 接続元 → { minute, n }

  const allowed = (req) => {
    const from = req.socket?.remoteAddress ?? 'unknown';
    if (!(canEdit() || LOOPBACK.has(from))) return { ok: false, status: 403, error: 'この設定では、名前を変えたり消したりできません' };
    const minute = Math.floor(now() / 60000);
    const e = edits.get(from);
    const n = e?.minute === minute ? e.n + 1 : 1;
    edits.set(from, { minute, n });
    if (edits.size > 500) edits.clear();
    if (n > EDITS_PER_MINUTE) return { ok: false, status: 429, error: '少し まってね' };
    return { ok: true };
  };

  return async function handle(req, res, path) {
    if (path !== '/api/characters') return false;
    try {
      if (req.method === 'GET') {
        if (env.YC_CHARACTER_LIST === '0') return send(res, 200, { items: [], off: true }), true;
        return send(res, 200, { items: made.list() }), true;
      }
      if (req.method !== 'PATCH' && req.method !== 'DELETE') return send(res, 405, { error: 'この方法は使えません' }), true;
      const ok = allowed(req);
      if (!ok.ok) return send(res, ok.status, { error: ok.error }), true;
      const body = await readBody(req, 4096);
      const id = String(body?.id ?? '');
      if (!MADE_ID_RE.test(id)) return send(res, 404, { error: 'その子は見つかりません' }), true;
      if (req.method === 'PATCH') return send(res, 200, { ok: true, id, name: made.rename(id, body?.name) }), true;
      return send(res, 200, { ok: true, id, removed: true, kept: made.remove(id) }), true;
    } catch (err) {
      const status = Number(err?.status) || 500;
      if (status >= 500) console.error(err);
      return send(res, status, { error: status >= 500 ? 'うまく いかなかったよ' : String(err.message ?? '') }), true;
    }
  };
}
