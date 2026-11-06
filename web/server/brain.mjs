// 会話の頭脳。Haiku を呼んで、1 行ずつの JSON を onEvent に渡す。
// 鍵が無いときは、同じ形で返す仮の頭脳(固定の台本)を使う。
// どちらの頭脳でも、安全の層(safety.mjs)を先に通す: つらい話には決まった案内、出力も確かめる。
import { config } from './env.mjs';
import { buildSystemBlocks, buildUserTurn, MOTIONS } from './prompt.mjs';
import { nearestExpression, oneCustomPerReply } from '../src/character/expressionNames.js';
import { classifyInput, distressDetail, fixedReply, guardOutput, mentionsChild, turnGuard, SAFETY_VERSION } from './safety.mjs';
import { summarize } from './memory/reflect.mjs';
import { firstGreeting } from './greeting.mjs';

export const HANDOFF_REASONS = ['emergency', 'unknown'];
const GREETING_MOTIONS = ['bow', 'nod']; // 初めてのあいさつの 1 文目はおじぎ、2 文目はうなずき(無いキャラは none に落ちる)
// 「人間なの?」「AI なの?」など、相手が何者かを聞く言葉
const ASKS_IF_HUMAN = /(人間なの|人間なん|人間ですか|にんげんなの|人なの\?|本物の人|AI\s*なの|AI\s*ですか|ロボットなの|中の人)/i;

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
  // system は段の列(1 段目 = 安全の決まり)。1 つの文が来たときも、そのまま 1 段にする
  const blocks = (Array.isArray(system) ? system : [system]).map((text) => ({ type: 'text', text }));
  // キャッシュの印は最後の段に付ける(1 段目は固定なので、前から順に再利用される)
  blocks[blocks.length - 1].cache_control = { type: 'ephemeral' };
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
      // 考える時間を使わない(短い返事には要らず、最初の文字まで約 0.6 秒縮む。2026-11-02 に測った)
      thinking: { type: 'disabled' },
      system: blocks,
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

/**
 * 仮の頭脳。鍵が無いときと、画面だけ確かめたいときに使う(固定の言い回し。お金はかからない)。
 * 覚えていること(memory)があれば、名前を呼んで話の続きにふれる。目印の名前が話に出たら案内する。
 * 人格の文(persona)に「初めてのあいさつ」の節があれば、はじめての「こんにちは」「はじめまして」にその文で名乗る。
 */
export function* mockReply({ text, trigger, landmarks = [], seen, memory = null, learned = [], history = [], persona = '' }) {
  const { name, topic } = summarize(memory?.items ?? []);
  const san = name ? `${name}さん` : '';
  if (trigger === 'approach') {
    yield { type: 'thought', seen: seen || '人が近づいてきた', intent: '未確認', stage: 'greet', handoff: false };
    yield { type: 'say', text: san ? `${san}、また会えたね。` : 'こんにちは。', expression: 'happy', motion: 'wave', gaze: 'person' };
    yield { type: 'say', text: topic ? `${topic}の話の続き、しようか。` : 'どんなお話をしようか。', expression: 'happy', motion: 'tilt', gaze: 'person' };
    return;
  }
  // 人間か AI かを聞かれたら、AI のキャラクターだと正直に答える(安全の決まり 5。仮の頭脳でも守る)
  if (ASKS_IF_HUMAN.test(text)) {
    yield { type: 'thought', seen: seen || '', intent: '人間かどうか', stage: 'chat', handoff: false };
    yield { type: 'say', text: 'AI のキャラクターだよ。人間じゃないんだ。', expression: 'happy', motion: 'nod', gaze: 'person' };
    yield { type: 'say', text: 'でも、お話はちゃんと聞くよ。', expression: 'happy', motion: 'tilt', gaze: 'person' };
    return;
  }
  const hit = landmarks.find((l) => text.includes(l.name));
  if (hit) {
    yield { type: 'thought', seen: seen || '', intent: `${hit.name}への案内`, stage: 'guide', handoff: false };
    yield { type: 'say', text: `${hit.name}だね。`, expression: 'happy', motion: 'nod', gaze: 'person' };
    yield { type: 'say', text: `${hit.where ?? 'あちら'}だよ。`, expression: 'happy', motion: 'point', gaze: `landmark:${hit.name}` };
    return;
  }
  const learnedName = learned.find((f) => f.kind === 'name')?.text.replace(/^名前: /, '');
  const learnedLike = learned.find((f) => f.kind === 'like')?.text.replace(/^好きなもの: /, '');
  if (learnedName || learnedLike) {
    yield { type: 'thought', seen: seen || '', intent: '自己紹介', stage: 'chat', handoff: false };
    if (learnedName) yield { type: 'say', text: `${learnedName}さんっていうんだね。`, expression: 'happy', motion: 'nod', gaze: 'person' };
    if (learnedLike) yield { type: 'say', text: `${learnedLike}が好きなんだ。覚えておくね。`, expression: 'happy', motion: 'nod', gaze: 'person' };
    return;
  }
  // 会話の始め(履歴が無い)で、覚えている事があれば、続きから話す
  if (!history.length && (san || topic)) {
    yield { type: 'thought', seen: seen || '', intent: '続きの会話', stage: 'chat', handoff: false };
    yield { type: 'say', text: san ? `${san}、また会えたね。` : 'また会えたね。', expression: 'happy', motion: 'wave', gaze: 'person' };
    if (topic) yield { type: 'say', text: `${topic}の話の続きだね。`, expression: 'happy', motion: 'tilt', gaze: 'person' };
    return;
  }
  if (/こんにちは|はじめまして|おはよう|こんばんは|やあ/.test(text)) {
    // はじめての会話(履歴も覚えている事も無い)で、人格に初めてのあいさつがあれば、その子の言葉で名乗る
    const hello = history.length ? [] : firstGreeting(persona);
    if (hello.length) {
      yield { type: 'thought', seen: seen || '', intent: '初めてのあいさつ', stage: 'greet', handoff: false };
      for (const [i, line] of hello.entries()) yield { type: 'say', text: line, expression: 'happy', motion: GREETING_MOTIONS[i] ?? 'none', gaze: 'person' };
      return;
    }
    yield { type: 'thought', seen: seen || '', intent: '未確認', stage: 'need', handoff: false };
    yield { type: 'say', text: 'こんにちは。', expression: 'happy', motion: 'wave', gaze: 'person' };
    yield { type: 'say', text: '今日は、どんなお話をしようか。', expression: 'happy', motion: 'tilt', gaze: 'person' };
    return;
  }
  yield { type: 'thought', seen: seen || '', intent: '雑談', stage: 'chat', handoff: false };
  yield { type: 'say', text: 'そうなんだ。', expression: 'think', motion: 'nod', gaze: 'person' };
  yield { type: 'say', text: 'もう少し聞かせてくれる?', expression: 'happy', motion: 'tilt', gaze: 'person' };
}

export const MOCK_PACE_MS = 120; // 仮の頭脳の 1 文ごとの間(画面で流れて見えるように)。まとめて返す公開の関数は 0 にする

/**
 * 会話 1 ターンを実行する。onEvent には thought / say が順に渡る。memory は { text, items }(覚えていること)、learned はこの回に覚えた事。
 * 仮の頭脳を強制するときは brain: 'mock'(forceMock: true と同じ)。鍵があっても本物を呼ばず、安全の層はいつも通す。
 * paceMs は仮の頭脳の 1 文ごとの間(既定 120ms)。
 */
export async function runTurn(body, { onEvent, signal, hedge = { afterMs: 0, take: () => false }, memory = null, learned = [], forceMock = false, brain: want = 'auto', paceMs = MOCK_PACE_MS }) {
  const { history = [], text = '', trigger = null, scene = '', character = {}, place = {} } = body;
  const expressions = body.expressions?.length ? body.expressions : ['neutral', 'happy', 'surprised', 'sad', 'think'];
  // そのキャラが実際に使える動き(rig は、動きのファイルがある物だけ)
  const motions = Array.isArray(body.motions) && body.motions.length ? body.motions.filter((m) => typeof m === 'string').slice(0, 24) : MOTIONS;
  const limitCustom = oneCustomPerReply(expressions); // 特別な表情は、1 回の返事で 1 つまで
  const mockOnly = forceMock || want === 'mock';
  const brain = config.anthropicKey && !mockOnly ? 'haiku' : 'mock'; // 上限に当たった回・合言葉が無い回は、仮の頭脳で動き続ける
  let handoffFlagged = false;
  const emit = (obj) => {
    // 引き継ぎの印: 1 行目(用件つき)の物は「考え」として届く。2 行目以降の say に付いた handoff は届かないので、ここで別に知らせる
    const carriesThought = obj.type === 'say' && (obj.intent !== undefined || obj.stage !== undefined);
    if (obj.type === 'thought' && obj.handoff === true) handoffFlagged = true;
    if (obj.type === 'say' && !handoffFlagged && obj.handoff === true) {
      handoffFlagged = true;
      if (!carriesThought) onEvent({ type: 'handoff', reason: HANDOFF_REASONS.includes(obj.reason) ? obj.reason : 'unknown' });
    }
    // 最初の say に用件・段階が付いているときは、画面の「考え」にも先に渡す
    if (carriesThought) {
      const thought = normalizeEvent({ type: 'thought', intent: obj.intent, stage: obj.stage, handoff: obj.handoff, reason: obj.reason }, { expressions, motions });
      if (thought) onEvent(obj.safety ? { ...thought, safety: obj.safety } : thought);
    }
    // 出力の確かめ(恋人役・独り占めの言葉は、決まった文に差し替える)
    const ev = guardOutput(normalizeEvent(obj, { expressions, motions }));
    if (ev) {
      if (ev.type === 'say') ev.expression = limitCustom(ev.expression);
      onEvent(ev);
    }
  };

  // 安全の層(1 段目): つらい話・命の危険は、頭脳を呼ばずに決まった一般の案内を返す(診断しない)
  const kind = trigger === 'approach' ? null : classifyInput(text);
  const fixed = kind === 'emergency' || kind === 'distress' || (brain === 'mock' && (kind === 'romance' || kind === 'dependency'));
  if (fixed) {
    onEvent({ type: 'meta', brain, safety: kind, safetyVersion: SAFETY_VERSION });
    for (const obj of fixedReply(kind, { child: mentionsChild(text) || mentionsChild(character.persona), detail: distressDetail(text) })) emit(obj);
    return;
  }

  if (brain === 'mock') {
    onEvent({ type: 'meta', brain: 'mock' });
    const landmarks = (place.landmarks ?? []).map((l) => ({ name: l.name, where: l.where }));
    for (const obj of mockReply({ text, trigger, landmarks, seen: scene, memory, learned, history, persona: character.persona ?? '' })) {
      if (paceMs > 0) await new Promise((r) => setTimeout(r, paceMs));
      emit(obj);
    }
    return;
  }

  onEvent({ type: 'meta', brain: 'haiku', model: config.model, ...(kind ? { safety: kind } : {}) });
  const system = buildSystemBlocks({ character, place, expressions, expressionHints: body.expressionHints, motions, interview: body.interview === true });
  const messages = [
    ...history.slice(-12).map((m) => ({ role: m.role, content: String(m.content) })),
    { role: 'user', content: buildUserTurn({ text, scene, trigger, memory: memory?.text ?? '', guard: turnGuard(kind) }) },
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
    const sentences = (raw.replace(/[{}\[\]"]/g, '').match(/[^。！？!?\n]+[。！？!?]?/g) ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 3);
    for (const [i, line] of sentences.entries()) {
      emit(i === 0 ? { type: 'say', text: line, expression: 'neutral', motion: 'none', gaze: 'person', intent: '未確認', stage: 'chat', handoff: false } : { type: 'say', text: line, expression: 'neutral', motion: 'none', gaze: 'person' });
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
