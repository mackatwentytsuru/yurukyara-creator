// 会話の頭脳。Haiku を呼んで、1 行ずつの JSON を onEvent に渡す。
// 鍵が無いときは、同じ形で返す仮の頭脳(固定の台本)を使う。
import { config } from './env.mjs';
import { buildSystemPrompt, buildUserTurn, MOTIONS } from './prompt.mjs';

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
export function normalizeEvent(obj, { expressions }) {
  if (obj.type === 'thought') {
    return {
      type: 'thought',
      seen: String(obj.seen ?? ''),
      intent: String(obj.intent ?? ''),
      stage: String(obj.stage ?? 'chat'),
      handoff: Boolean(obj.handoff),
    };
  }
  if (obj.type === 'say') {
    const text = cleanSpeech(obj.text);
    if (!text) return null;
    const expression = expressions.includes(obj.expression) ? obj.expression : 'neutral';
    const motion = MOTIONS.includes(obj.motion) ? obj.motion : 'none';
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

async function callHaiku({ system, messages, signal, onText }) {
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
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') onText(ev.delta.text);
      if (ev.type === 'error') throw new Error(ev.error?.message ?? 'stream error');
    }
  }
}

/**
 * 仮の頭脳。鍵が無いときと、画面だけ確かめたいときに使う。
 * 目印の名前が話に出たら案内し、出なければ用件を聞く。分からない話は人につなぐ。
 */
export function* mockReply({ text, trigger, landmarks = [], seen }) {
  if (trigger === 'approach') {
    yield { type: 'thought', seen: seen || '人が近づいてきた', intent: '未確認', stage: 'greet', handoff: false };
    yield { type: 'say', text: 'いらっしゃいませ。', expression: 'happy', motion: 'bow', gaze: 'person' };
    yield { type: 'say', text: 'どんなご用件でしょうか。', expression: 'happy', motion: 'tilt', gaze: 'person' };
    return;
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
export async function runTurn(body, { onEvent, signal }) {
  const { history = [], text = '', trigger = null, scene = '', character = {}, place = {} } = body;
  const expressions = body.expressions?.length ? body.expressions : ['neutral', 'happy', 'surprised', 'sad', 'think'];
  const emit = (obj) => {
    const ev = normalizeEvent(obj, { expressions });
    if (ev) onEvent(ev);
  };

  if (!config.anthropicKey) {
    onEvent({ type: 'meta', brain: 'mock' });
    const landmarks = (place.landmarks ?? []).map((l) => ({ name: l.name, where: l.where }));
    for (const obj of mockReply({ text, trigger, landmarks, seen: scene })) {
      await new Promise((r) => setTimeout(r, 120));
      emit(obj);
    }
    return;
  }

  onEvent({ type: 'meta', brain: 'haiku', model: config.model });
  const system = buildSystemPrompt({ character, place, expressions });
  const messages = [
    ...history.slice(-12).map((m) => ({ role: m.role, content: String(m.content) })),
    { role: 'user', content: buildUserTurn({ text, scene, trigger }) },
  ];
  const splitter = lineSplitter((line) => {
    const obj = parseLine(line);
    if (obj) emit(obj);
  });
  await callHaiku({ system, messages, signal, onText: (t) => splitter.push(t) });
  splitter.flush();
}
