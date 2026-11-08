// /api/chat の中身。標準の Request を受けて Response を返す(契約 K5)。
// 返事は流さず、1 回でまとめて返す(関数の時間を短く、数えやすくするため)。
// 順番: 本文の点検 → 頭脳を選ぶ(合言葉・回数。記憶の置き場を使う前に見る。CRITsec2 N3)→
//       記憶(接続元ごとの数えの後。「わすれて」はここで、その子の言葉で答える)→
//       本物の頭脳、または仮の頭脳(どちらも runTurn。安全の層・人格・記憶を同じ道で通す)
import { decideBrain, readJson, takeImageSlot } from './gate.mjs';
import { json } from './http.mjs';
import { CAMERA_CAP_NOTICE } from '../../server/camera.mjs'; // BCV: カメラの絵の 1 日の枚数に届いた時の知らせ

// 仮の頭脳にした理由を、画面に出す一言にする
export const FALLBACK_NOTICE = {
  'no-key': '仮の頭脳です(本物の頭脳の鍵が入っていません)',
  'no-passphrase-set': '仮の頭脳です(合言葉が決まっていないので、本物の頭脳は使いません)',
  'weak-passphrase': '仮の頭脳です(合言葉の設定が短いので、本物の頭脳は使いません)',
  passphrase: '仮の頭脳です(合言葉が無いか、違います)',
  'passphrase-wait': '仮の頭脳です(合言葉の間違いが続いたので、しばらく本物の頭脳を止めています)',
  'per-minute': '仮の頭脳です(少し間をあけてから、もう一度どうぞ)',
  'daily-cap': '仮の頭脳です(今日の上限に届きました)',
  'counter-unavailable': '仮の頭脳です(回数を数えられないので、本物の頭脳を止めています)',
  'brain-error': '仮の頭脳です(本物の頭脳が答えられませんでした)',
};

const NO_MEMORY = async () => ({ handled: false, events: [], memory: null, learned: [] });

/**
 * @param {Request} request
 * @param {object} deps
 * @param {object} deps.cfg readConfig() の値
 * @param {object} deps.store 置き場(store.mjs)
 * @param {(body:object, o:object) => Promise<void>} deps.runTurn 頭脳(web/server/brain.mjs)。仮の頭脳は brain: 'mock' で呼ぶ
 * @param {(raw:object) => object} deps.sanitize 本文の点検(形が違えば status 400 の Error を投げる)
 * @param {(request:Request, text:string, o:object) => Promise<object>} [deps.remember] 記憶(memoryChat.mjs の rememberForChat。o に cfg・store・now・persona)
 */
export async function handleChat(request, { cfg, store, runTurn, sanitize, remember = NO_MEMORY, now = Date.now }) {
  const started = now();
  if (request.method !== 'POST') return json(405, { error: 'POST だけを受けます' });
  // BCV: カメラの絵がついた本文だけ、絵 1 枚の分(maxImageBytes)まで大きくてよい。絵の無い本文は、元の上限(maxBodyBytes)のまま
  const read = await readJson(request, cfg.maxBodyBytes + (cfg.maxImageBytes ?? 0));
  if (read.error === 'too-large') return json(413, { error: '本文が大きすぎます' });
  if (read.error) return json(400, { error: '本文が JSON ではありません' });
  if (read.bytes > cfg.maxBodyBytes && !read.body?.image) return json(413, { error: '本文が大きすぎます' });
  let body;
  try {
    body = { ...sanitize(read.body), useShop: false };
  } catch (err) {
    return json(err.status === 400 ? 400 : 500, { error: err.status === 400 ? err.message : '本文を読めませんでした' });
  }

  // 合言葉と回数の上限を、記憶の置き場を使う前に見る(当て試しも置き場の使いすぎも、先に数える)
  const pick = await decideBrain(request, { cfg, store, now });
  // 記憶は頭脳を呼ぶ前に 1 回(契約 K4)。「わすれて」は全部消して、頭脳を呼ばずに、その子の言葉で答える
  const mem = await remember(request, body.text, { cfg, store, now, persona: body.character?.persona ?? '', memoryOff: body.memory === 'off' });
  if (mem.handled) return json(200, { brain: 'none', fallback: false, reason: '', notice: '', events: mem.events, ms: now() - started });

  const events = [];
  const onEvent = (ev) => events.push(ev);
  const recall = { memory: mem.memory, learned: mem.learned };
  let { brain, reason } = pick;
  // BCV: 本物の頭脳へ絵を送る回は、絵の枚数も 1 日の上限で数える。届いたら絵を外して言葉だけで話す(仮の頭脳は絵を見ないので数えない)
  if (brain === 'real' && body.image && !(await takeImageSlot({ cfg, store, now }))) {
    const { image: _notSent, ...rest } = body;
    body = rest;
    events.push({ type: 'meta', camera: 'capped', cameraNotice: CAMERA_CAP_NOTICE });
  }
  if (brain === 'real') {
    try {
      await runTurn(body, { onEvent, signal: request.signal, ...recall });
    } catch {
      events.length = 0; // 途中の返事は混ぜない
      brain = 'fallback';
      reason = 'brain-error';
    }
  }
  if (brain === 'fallback') {
    try {
      // 仮の頭脳も runTurn を通す: 安全の決まった返事・人格の言葉(あいさつ・話し方の例・あいづち)・覚えていること
      await runTurn(body, { onEvent, brain: 'mock', paceMs: 0, ...recall });
    } catch {
      return json(500, { error: '返事を作れませんでした' });
    }
  }
  return json(200, {
    brain,
    fallback: brain === 'fallback',
    reason,
    notice: brain === 'fallback' ? FALLBACK_NOTICE[reason] ?? FALLBACK_NOTICE['no-key'] : '',
    events: [...mem.events, ...events],
    ms: now() - started,
  });
}
