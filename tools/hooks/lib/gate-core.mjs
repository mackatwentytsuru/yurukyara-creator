// 段の関所の判定(契約 K3 版 1 に合わせる)。段 N(yc-<N>-…のスキル)を始めてよいのは、
// 前の段の記録 creator/work/<id>/review/<N-1>.json の decision が ok か auto の時だけ。
// これは creator/review/review_state.py の can-start と同じ決まり(フックは python を呼ばずに同じ物を読む)。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PASS = new Set(['ok', 'auto']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** スキルの名前から段の番号。「yc-3-material」「/yc-3-material」「plugin:yc-3-…」→ 3。段でなければ null */
export function stageOf(name) {
  const m = /^(?:[\w-]+:)?yc-(\d)(?:-|$)/.exec(String(name ?? '').trim().replace(/^\//, ''));
  return m ? Number(m[1]) : null;
}

const reviewDir = (root, id) => join(root, 'creator', 'work', id, 'review');

/** どのキャラか: 引数の中の作業フォルダの名前 → YC_CHAR_ID → いちばん新しく書かれた review の記録 */
export function pickId(root, argsText, env = process.env) {
  let ids = [];
  try {
    ids = readdirSync(join(root, 'creator', 'work'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && SAFE_ID.test(d.name) && !d.name.startsWith('_'))
      .map((d) => d.name);
  } catch {
    ids = [];
  }
  const tokens = String(argsText ?? '').split(/\s+/).map((t) => t.replace(/^--?id[=:]?/, '')).filter(Boolean);
  const hit = tokens.find((t) => ids.includes(t));
  if (hit) return hit;
  if (env.YC_CHAR_ID && SAFE_ID.test(env.YC_CHAR_ID)) return env.YC_CHAR_ID;
  let best = null;
  for (const id of ids) {
    let t = 0;
    try {
      for (const f of readdirSync(reviewDir(root, id))) t = Math.max(t, statSync(join(reviewDir(root, id), f)).mtimeMs);
    } catch {
      continue;
    }
    if (t && (!best || t > best.t)) best = { id, t };
  }
  return best?.id ?? null;
}

/** { gated: false } なら関所の外。{ gated: true, ok, id, stage, why } なら前の段が OK か */
export function checkGate(root, skillName, argsText, env = process.env) {
  const n = stageOf(skillName);
  if (n == null || n === 0) return { gated: false }; // 段 0(絵)は最初の段なので、前の段は無い
  const id = pickId(root, argsText, env);
  if (!id) return { gated: true, ok: false, id: null, stage: n, why: '作業中のキャラ(creator/work/<id>/review/)が見つからない' };
  let rec;
  try {
    rec = JSON.parse(readFileSync(join(reviewDir(root, id), `${n - 1}.json`), 'utf8'));
  } catch {
    return { gated: true, ok: false, id, stage: n, why: `前の段の記録 creator/work/${id}/review/${n - 1}.json が無い、または読めない` };
  }
  if (PASS.has(rec?.decision)) return { gated: true, ok: true, id, stage: n };
  const now = rec?.decision ? `今は「${rec.decision}」` : '決まっていない';
  return { gated: true, ok: false, id, stage: n, why: `前の段(${n - 1})が OK になっていない(${now})` };
}
