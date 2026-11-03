// 会話の頭脳。Haiku を呼んで、1 行ずつの JSON を onEvent に渡す。
// 鍵が無いときは、同じ形で返す仮の頭脳(固定の台本)を使う。
import { config } from './env.mjs';
import { buildSystemPrompt, buildUserTurn, MOTIONS } from './prompt.mjs';
import { nearestExpression, oneCustomPerReply } from '../src/character/expressionNames.js';
import { createShop, renderShopData, renderShopNow, resolveSources } from './shop/index.mjs';
import { loadRules } from './shop/rules.mjs';

export const HANDOFF_REASONS = ['complaint', 'payment', 'emergency', 'age', 'booking', 'unknown'];
let defaultShop = null;

/** 1 行の JSON を直す。コードブロックや前後の文字が付いていても、できるだけ拾う */
export function parseLine(line) {
  let s = line.trim();
  if (!s) return null;
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const obj = JSON.parse(s.slice(a, b + 1));
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/** 読み上げに使えない文字を取り除く */
export function cleanSpeech(text) {
  return String(text ?? '')
    .replace(/[\p{Extended_Pictographic}‍️]/gu, '')
    .replace(/[*_`#>「」『』()（）]/g, '')
    .trim();
}

/** 受け取った 1 つの JSON を、画面に渡せる形にそろえる */
export function normalizeEvent(obj, { expressions, motions = MOTIONS }) {
  if (obj.type === 'thought') {
    return {
      type: 'thought',
      seen: String(obj.seen ?? ''),
      intent: String(obj.intent ?? ''),
      stage: String(obj.stage ?? 'chat'),
      handoff: Boolean(obj.handoff),
      // 店のデータを使った回: 使ったデータの名前(サーバーが、更新時刻つきの参照に直して画面へ渡す)と、人につなぐ理由
      cite: Array.isArray(obj.cite) ? obj.cite.filter((k) => typeof k === 'string').slice(0, 6) : [],
      reason: HANDOFF_REASONS.includes(obj.reason) ? obj.reason : '',
    };
  }
  if (obj.type === 'say') {
    const text = cleanSpeech(obj.text);
    if (!text) return null;
    // 一覧に無い表情は、近い物(ウインク → happy など)に落とす。無ければ neutral
    const expression = nearestExpression(String(obj.expression ?? ''), (n) => expressions.includes(n)) ?? 'neutral';
    const motion = motions.includes(obj.motion) ? obj.motion : 'none';
    return { type: 'say', text, expression, motion, gaze: String(obj.gaze ?? 'person') };
  }
  return null;
}

/** 文字の流れを行に分けて、1 行できるたびに onLine を呼ぶ */
export function lineSplitter(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        onLine(line);
      }
    },
    flush() {
      if (buf.trim()) onLine(buf);
      buf = '';
    },
  };
}

async function callHaiku({ system, messages, signal, onText, onUsage }) {
  const res = await fetch(config.anthropicUrl, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 700,
      stream: true,
      // 考える時間を使わない(受付の短い返事には要らず、最初の文字まで約 0.6 秒縮む。2026-11-02 に測った)
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Claude の呼び出しに失敗しました (${res.status}): ${detail}`);
  }
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split('\n').find((l) => l.startsWith('data:'));
      if (!data) continue;
      let ev;
      try {
        ev = JSON.parse(data.slice(5));
      } catch {
        continue;
      }
      if (ev.type === 'message_start' && ev.message?.usage) onUsage?.(ev.message.usage);
      if (ev.type === 'message_delta' && ev.usage) onUsage?.(ev.usage);
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') onText(ev.delta.text);
      if (ev.type === 'error') throw new Error(ev.error?.message ?? 'stream error');
    }
  }
}

/**
 * 最初の文字が hedgeMs たっても来なければ、同じ呼び出しをもう 1 本送り、先に文字が来た方を使う(もう一方は止める)。
 * 遅い回(API 側のばらつき)だけを狙う。費用が 2 倍になるのは、その遅い回だけ。
 * @param {object} o
 * @param {number} o.hedgeMs 0 なら送らない
 * @param {() => boolean} o.takeExtra 2 本目を送ってよいか(回数の上限を数える)。false なら送らない
 * @returns {Promise<{hedged:boolean, winner:'a'|'b'|null, usage:object}>}
 */
export async function callHaikuHedged({ system, messages, signal, onText, hedgeMs = 0, takeExtra = () => true }) {
  let winner = null;
  const controllers = {};
  const usage = {};
  const run = (id) => {
    const ac = new AbortController();
    controllers[id] = ac;
    signal?.addEventListener('abort', () => ac.abort(), { once: true });
    return callHaiku({
      system,
      messages,
      signal: ac.signal,
      onUsage: (u) => {
        if (winner === null || winner === id) Object.assign(usage, u);
      },
      onText: (t) => {
        if (winner === null) {
          winner = id;
          for (const [k, c] of Object.entries(controllers)) if (k !== id) c.abort();
        }
        if (winner === id) onText(t);
      },
    }).then(
      () => ({ id }),
      (error) => ({ id, error }),
    );
  };

  const a = run('a');
  let b = null;
  if (hedgeMs > 0) {
    const timer = new Promise((r) => setTimeout(r, hedgeMs, 'timeout'));
    const first = await Promise.race([a, timer]);
    if (first === 'timeout' && winner === null && !signal?.aborted && takeExtra()) b = run('b');
  }
  const results = await Promise.all([a, b ?? Promise.resolve(null)]);
  const winning = results.find((r) => r && r.id === winner);
  if (winner === null) {
    const err = results.find((r) => r?.error)?.error;
    if (err) throw err;
  } else if (winning?.error && !signal?.aborted) {
    throw winning.error;
  }
  return { hedged: b !== null, winner, usage };
}

const MOCK_HANDOFFS = [
  [/二重|返金|引き落と|支払い|決済|カード/, 'payment', '支払いのことですね。すぐスタッフにつなぎますね。'],
  [/倒れ|救急|けが|怪我|具合が悪|火事/, 'emergency', 'すぐスタッフを呼びます。'],
  [/未成年|高校生|中学生|年齢|お酒/, 'age', '年齢のことは、スタッフに確認しますね。'],
  [/クレーム|苦情|態度が悪/, 'complaint', 'ご不便をおかけしました。スタッフにつなぎますね。'],
  [/予約|キャンセル/, 'booking', '予約のことは、スタッフにつなぎますね。'],
];

/** 仮の頭脳の、店のデータを読んだ返事。鍵なしでも画面と参照の表示を確かめられる(固定の言い回し。中身はデータから) */
function* mockShopReply(text, snap) {
  const s = snap.sections;
  const think = (intent, cite) => ({ type: 'say', intent, stage: 'guide', handoff: false, cite });
  const say = (t, extra = {}) => ({ type: 'say', text: t, expression: 'happy', motion: 'nod', gaze: 'person', ...extra });
  for (const [re, reason, line] of MOCK_HANDOFFS) {
    if (!re.test(text)) continue;
    yield say(line, { motion: 'bow', intent: '人へつなぐ', stage: 'handoff', handoff: true, cite: [], reason });
    return;
  }
  if (s.performers && /出演|誰が出|演者|だれが/.test(text)) {
    yield say(`今日は ${s.performers.items.map((x) => x.name).join('さん、')}さんが出ます。`, think('今日の出演者', ['performers']));
  } else if (s.shows && /ショー|何時|時間|開演|見どころ/.test(text)) {
    yield say(`今日は ${s.shows.items.map((x) => x.start).join('、')} からです。`, think('ショーの時間', ['shows']));
  } else if (s.seats && /空席|空い|席/.test(text)) {
    yield say(`${s.seats.updatedHm} の時点で、空きは ${s.seats.available} 席です。`, think('空席の様子', ['seats']));
  } else if (s.pricing && /料金|いくら|値段|入場料|ドリンク/.test(text)) {
    const p = s.pricing.items[0];
    yield say(`${p.item}は ${p.amount}です。`, think('料金', ['pricing']));
  } else if (s.support && /応援|コール|ペンライト|メッセージ/.test(text)) {
    yield say(`${s.support.items[0].name}ができますよ。`, think('応援の仕方', ['support']));
  } else if (s.tips && /楽しみ|初めて|はじめて/.test(text)) {
    yield say(`${s.tips.items[0]}。`, think('楽しみ方', ['tips']));
  } else {
    return;
  }
}

/**
 * 仮の頭脳。鍵が無いときと、画面だけ確かめたいときに使う。
 * 目印の名前が話に出たら案内し、出なければ用件を聞く。分からない話は人につなぐ。
 */
export function* mockReply({ text, trigger, landmarks = [], seen, snap = null }) {
  if (trigger === 'approach') {
    yield { type: 'thought', seen: seen || '人が近づいてきた', intent: '未確認', stage: 'greet', handoff: false };
    yield { type: 'say', text: 'いらっしゃいませ。', expression: 'happy', motion: 'bow', gaze: 'person' };
    yield { type: 'say', text: 'どんなご用件でしょうか。', expression: 'happy', motion: 'tilt', gaze: 'person' };
    return;
  }
  if (snap) {
    const shopReply = [...mockShopReply(text, snap)];
    if (shopReply.length) {
      yield* shopReply;
      return;
    }
  }
  const hit = landmarks.find((l) => text.includes(l.name));
  if (hit) {
    yield { type: 'thought', seen: seen || '', intent: `${hit.name}への案内`, stage: 'guide', handoff: false };
    yield { type: 'say', text: `${hit.name}ですね。`, expression: 'happy', motion: 'nod', gaze: 'person' };
    yield { type: 'say', text: `${hit.where ?? 'あちら'}です。`, expression: 'happy', motion: 'point', gaze: `landmark:${hit.name}` };
    return;
  }
  if (/こんにちは|はじめまして|おはよう|こんばんは/.test(text)) {
    yield { type: 'thought', seen: seen || '', intent: '未確認', stage: 'need', handoff: false };
    yield { type: 'say', text: 'こんにちは。', expression: 'happy', motion: 'wave', gaze: 'person' };
    yield { type: 'say', text: '今日は、どんなご用件ですか。', expression: 'happy', motion: 'tilt', gaze: 'person' };
    return;
  }
  yield { type: 'thought', seen: seen || '', intent: '分からない話', stage: 'handoff', handoff: true };
  yield { type: 'say', text: 'うーん、わたしでは分からないようです。', expression: 'think', motion: 'think', gaze: 'away' };
  yield { type: 'say', text: 'スタッフを呼んできますね。', expression: 'happy', motion: 'bow', gaze: 'person' };
}

/** 会話 1 ターンを実行する。onEvent には thought / say が順に渡る */
export async function runTurn(body, { onEvent, signal, hedge = { afterMs: 0, take: () => false }, shop = null }) {
  const { history = [], text = '', trigger = null, scene = '', character = {}, place = {} } = body;
  const expressions = body.expressions?.length ? body.expressions : ['neutral', 'happy', 'surprised', 'sad', 'think'];
  // そのキャラが実際に使える動き(rig は、動きのファイルがある物だけ)
  const motions = Array.isArray(body.motions) && body.motions.length ? body.motions.filter((m) => typeof m === 'string').slice(0, 24) : MOTIONS;
  const limitCustom = oneCustomPerReply(expressions); // 特別な表情は、1 回の返事で 1 つまで
  // 店のデータ(読むだけ)。取れなければ null のまま動き、店のことはスタッフへ回す
  const useShop = body.useShop !== false;
  const shopSource = shop ?? (defaultShop ??= createShop());
  const nowMs = shopSource.now();
  const snap = useShop ? await shopSource.snapshot() : null;
  // 考えの知らせ。使ったデータを、ラベル・更新時刻・古いかどうかに直して画面へ(使っていない名前や、無いデータは落とす)
  const sendThought = (thought) => {
    const { cite, ...rest } = thought;
    onEvent({ ...rest, sources: resolveSources(snap, cite, nowMs), shopLabel: snap?.source.label ?? '' });
  };
  // 「スタッフにつなぎます」と言ったのに、引き継ぎの印(handoff)が立っていないとき、あとから印を足す(言葉と画面・通知をずらさない)
  let handoffFlagged = false;
  const STAFF_PROMISE = /スタッフ(に|を|へ|の方に).{0,6}(つな|呼|お呼び|おつな)/;
  const emit = (obj) => {
    if (obj.handoff === true) handoffFlagged = true;
    if (obj.type === 'say' && !handoffFlagged && STAFF_PROMISE.test(String(obj.text ?? ''))) {
      handoffFlagged = true;
      onEvent({ type: 'handoff', reason: 'unknown' });
    }
    // 最初の say に用件・段階が付いているときは、画面の「考え」にも先に渡す
    if (obj.type === 'say' && (obj.intent !== undefined || obj.stage !== undefined)) {
      const thought = normalizeEvent({ type: 'thought', intent: obj.intent, stage: obj.stage, handoff: obj.handoff, cite: obj.cite, reason: obj.reason }, { expressions, motions });
      if (thought) sendThought(thought);
    }
    const ev = normalizeEvent(obj, { expressions, motions });
    if (ev) {
      if (ev.type === 'say') ev.expression = limitCustom(ev.expression);
      if (ev.type === 'thought') sendThought(ev);
      else onEvent(ev);
    }
  };

  if (!config.anthropicKey) {
    onEvent({ type: 'meta', brain: 'mock' });
    const landmarks = (place.landmarks ?? []).map((l) => ({ name: l.name, where: l.where }));
    for (const obj of mockReply({ text, trigger, landmarks, seen: scene, snap })) {
      await new Promise((r) => setTimeout(r, 120));
      emit(obj);
    }
    return;
  }

  onEvent({ type: 'meta', brain: 'haiku', model: config.model });
  const shopPrompt = useShop ? { rules: loadRules(), data: renderShopData(snap) } : null;
  const system = buildSystemPrompt({ character, place, expressions, expressionHints: body.expressionHints, motions, shop: shopPrompt });
  const messages = [
    ...history.slice(-12).map((m) => ({ role: m.role, content: String(m.content) })),
    { role: 'user', content: buildUserTurn({ text, scene, trigger, shopNow: useShop ? renderShopNow(snap, nowMs) : '' }) },
  ];
  let raw = '';
  let said = 0;
  const splitter = lineSplitter((line) => {
    const obj = parseLine(line);
    if (obj) {
      if (obj.type === 'say') said += 1;
      emit(obj);
    }
  });
  const info = await callHaikuHedged({
    system,
    messages,
    signal,
    onText: (t) => {
      raw += t;
      splitter.push(t);
    },
    hedgeMs: hedge.afterMs,
    takeExtra: hedge.take,
  });
  splitter.flush();
  // 1 文も取り出せなかったときは、モデルの生の出力を、サーバーの画面に残す(直すための手がかり)
  if (!said) {
    console.warn(`[頭脳] 返事を取り出せませんでした。生の出力: ${JSON.stringify(raw.slice(0, 300))}`);
    // 文章で返ってきたときは、その文を読み上げる(表情・動きは既定)。何も言わないよりよい
    // 句点・感嘆符・疑問符(全角と半角)と改行で区切る
    const sentences = (raw.replace(/[{}\[\]"]/g, '').match(/[^。！？!?\n]+[。！？!?]?/g) ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 3);
    for (const [i, text] of sentences.entries()) {
      emit(i === 0 ? { type: 'say', text, expression: 'neutral', motion: 'none', gaze: 'person', intent: '未確認', stage: 'chat', handoff: false } : { type: 'say', text, expression: 'neutral', motion: 'none', gaze: 'person' });
    }
  }
  // 2 本目を送ったか・どちらが勝ったか・キャッシュを読めたか(記録と測定のため。画面は使わない)
  onEvent({
    type: 'meta',
    hedged: info.hedged,
    winner: info.winner,
    usage: {
      input: info.usage.input_tokens ?? null,
      cacheRead: info.usage.cache_read_input_tokens ?? null,
      cacheWrite: info.usage.cache_creation_input_tokens ?? null,
      output: info.usage.output_tokens ?? null,
    },
  });
}
