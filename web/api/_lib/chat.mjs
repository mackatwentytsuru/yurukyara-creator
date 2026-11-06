// /api/chat の中身。標準の Request を受けて Response を返す(契約 K5)。
// 返事は流さず、1 回でまとめて返す(関数の時間を短く、数えやすくするため)。
import { decideBrain, readJson } from './gate.mjs';
import { json } from './http.mjs';

// 仮の頭脳にした理由を、画面に出す一言にする
export const FALLBACK_NOTICE = {
  'no-key': '仮の頭脳です(本物の頭脳の鍵が入っていません)',
  'no-passphrase-set': '仮の頭脳です(合言葉が決まっていないので、本物の頭脳は使いません)',
  passphrase: '仮の頭脳です(合言葉が無いか、違います)',
  'per-minute': '仮の頭脳です(少し間をあけてから、もう一度どうぞ)',
  'daily-cap': '仮の頭脳です(今日の上限に届きました)',
  'counter-unavailable': '仮の頭脳です(回数を数えられないので、本物の頭脳を止めています)',
  'brain-error': '仮の頭脳です(本物の頭脳が答えられませんでした)',
};

/**
 * @param {Request} request
 * @param {object} deps
 * @param {object} deps.cfg readConfig() の値
 * @param {object} deps.store 置き場(store.mjs)
 * @param {(body:object, o:{onEvent:Function, signal?:AbortSignal}) => Promise<void>} deps.runTurn 本物の頭脳
 * @param {(o:object) => Iterable<object>} deps.mockReply 仮の頭脳
 * @param {(raw:object) => object} deps.sanitize 本文の点検(形が違えば status 400 の Error を投げる)
 */
export async function handleChat(request, { cfg, store, runTurn, mockReply, sanitize, now = Date.now }) {
  const started = now();
  if (request.method !== 'POST') return json(405, { error: 'POST だけを受けます' });
  const read = await readJson(request, cfg.maxBodyBytes);
  if (read.error === 'too-large') return json(413, { error: '本文が大きすぎます' });
  if (read.error) return json(400, { error: '本文が JSON ではありません' });
  let body;
  try {
    body = { ...sanitize(read.body), useShop: false };
  } catch (err) {
    return json(err.status === 400 ? 400 : 500, { error: err.status === 400 ? err.message : '本文を読めませんでした' });
  }

  const pick = await decideBrain(request, { cfg, store, now });
  const events = [];
  const onEvent = (ev) => events.push(ev);
  let { brain, reason } = pick;
  if (brain === 'real') {
    try {
      await runTurn(body, { onEvent, signal: request.signal });
    } catch {
      events.length = 0;
      brain = 'fallback';
      reason = 'brain-error';
    }
  }
  if (brain === 'fallback') {
    events.push({ type: 'meta', brain: 'mock' });
    const landmarks = (body.place?.landmarks ?? []).map((l) => ({ name: l.name, where: l.where }));
    for (const ev of mockReply({ text: body.text, trigger: body.trigger, landmarks, seen: body.scene })) events.push(ev);
  }
  return json(200, {
    brain,
    fallback: brain === 'fallback',
    reason,
    notice: brain === 'fallback' ? FALLBACK_NOTICE[reason] ?? FALLBACK_NOTICE['no-key'] : '',
    events,
    ms: now() - started,
  });
}
