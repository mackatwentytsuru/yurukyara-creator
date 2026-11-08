// 会話の頭脳。Haiku を呼んで、1 行ずつの JSON を onEvent に渡す。
// 鍵が無いときは、同じ形で返す仮の頭脳(固定の台本)を使う。
// どちらの頭脳でも、安全の層(safety.mjs)を先に通す: つらい話には決まった案内、出力も確かめる。
import { gestureBudget, gestureForIntent, resolveMotion } from '../src/conversation/gestureNames.js'; // B3(第 12 波 b): 仕草の名前
import { config } from './env.mjs';
import { buildSystemBlocks, buildUserTurn, MOTIONS, safeChoices } from './prompt.mjs';
import { nearestExpression, oneCustomPerReply } from '../src/character/expressionNames.js';
import { classifyHistory, classifyInput, distressDetail, fixedReply, guardOutput, historyGuard, mentionsChild, mostSevere, personalWarn, turnGuard, SAFETY_VERSION } from './safety.mjs';
import { classifyForeignCrisis, foreignDistressDetail, visitorLangOf } from './safetyLang.mjs'; // ML1: 多言語の時だけ、英・中・韓の言葉のつらい話の中身を見る(B13S: 命・つらい話は日本語だけの時も)
import { langModeOf } from '../src/conversation/lang.js'; // ML1: ことば
import { mentionsRest, restGuard, restLine, restNeed } from './safety.mjs'; // BSF 11-08: 長い会話・夜おそくの「休もうか」(1 回の会話で 1 回)
import { summarize } from './memory/reflect.mjs';
import { aizuchiPair, exampleReply, firstGreeting, memoryLine } from './greeting.mjs';
import { aiAnswer, asksIfAI, asksMemory, MEMORY_FIRST_NOTE, MEMORY_PLAIN_LINES, PERSONAL_HISTORY_MASK, personalLines, standinReply } from './talk_lines.mjs'; // UW3: 仮の頭脳の言い回し(AI・覚えること・書かないでね・ふつうの返事)
import { CAMERA_MOCK_LINES, CAMERA_MOCK_NOTICE, cameraTurnContent, imageTokens, seeingAsked } from './camera.mjs'; // BCV: カメラの絵

export const HANDOFF_REASONS = ['emergency', 'unknown'];
// 仮の頭脳の仕草(かわいい仕草の層の名前。そのキャラに無い名前は、emit が近い物へ落とす。1 つの返事で仕草は 2 回まで。第 12 波 b)
const GREETING_MOTIONS = ['greet', 'bow', 'none']; // 初めてのあいさつ: 1 文目は手をふって弾む、2 文目はおじぎ、3 文目は表情だけ
const EXAMPLE_MOTIONS = ['nod', 'tilt', 'none']; // 話し方の例の返事
const AIZUCHI_MOTIONS = ['nod', 'tilt'];
// 分からない・できないと言う文は、考える顔にする(話し方の例・あいづち)
const UNSURE = /(あれれ|わかりマセン|わかりません|わからない|分からない|調べられ|できマセン|できない)/;

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
    // 仕草: そのキャラが使える名前ならそのまま。無ければ近い物(greet → wave → nod など)、画面が自分で出す仕草と知らない名前は none
    const motion = resolveMotion(obj.motion, motions);
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
 * 「話し方の例」の合図の言葉が入っていれば、その子の言葉で返す。どれでもなければ「あいづち」の節(無ければ決まった文)。
 * 安全の層が先: runTurn を通さずに直接呼ばれても(公開の関数の仮の頭脳など)、つらい話・恋人役・依存の言葉には決まった返事を返し、
 * 返す文も出力の確かめを通す。runTurn は先に決まった返事を返すので、ここの守りは二重の守り。
 */
export function* mockReply(o) {
  const { text, trigger, seen, persona = '', lang = null } = o;
  const { kind, source } = classifyTurn({ text, trigger, scene: seen, lang });
  if (kind) {
    const multi = lang === 'multi';
    const [first, ...rest] = fixedReply(kind, { child: mentionsChild(source) || mentionsChild(text) || mentionsChild(persona), detail: detailOf(source, multi), text: source, visitorLang: visitorLangFor({ multi, text, source, hearLang: o.hearLang }) });
    const { intent, stage, handoff, safety, ...line } = first;
    yield { type: 'thought', seen: seen || '', intent, stage, handoff, safety };
    yield line;
    yield* rest;
    return;
  }
  for (const ev of mockLines(o)) yield ev.type === 'say' ? guardOutput(ev, { multi: lang === 'multi' }) : ev;
}

/** つらい話の中身(self・abuse・other)。多言語の時(と、日本語だけでも英・中・韓の命・つらい話の言葉の時)は、日本語の網で other だった言葉を、英・中・韓の網でも見る */
function detailOf(source, multi) {
  const d = distressDetail(source);
  return d === 'other' && (multi || classifyForeignCrisis(source)) ? foreignDistressDetail(source) : d;
}

/** 決まった返事の先頭の 1 行の言葉。多言語の時は使う人の言葉。日本語だけの時は、英・中・韓の命・つらい話の言葉の時だけその言葉(それ以外は ja = 今まで通り) */
function visitorLangFor({ multi, text, source, hearLang }) {
  if (multi) return visitorLangOf(text, hearLang);
  return classifyForeignCrisis(source) ? visitorLangOf(source, 'ja') : 'ja';
}

/** 人格の初めてのあいさつ(3 文まで)を、おじぎ → うなずき → 手をふる で言う */
function* greetingLines(hello) {
  for (const [i, line] of hello.entries()) yield { type: 'say', text: line, expression: 'happy', motion: GREETING_MOTIONS[i] ?? 'none', gaze: 'person' };
}

/**
 * この回の言葉を分ける。使う人の言葉(近づいた時は無い)と、見えている様子(scene)の両方を見る(CRITsec F7)。
 * source は分けた元の文(決まった返事の中身 = つらい話の種類・子どもか を、その文から決める)。
 * @returns {{kind:'emergency'|'distress'|'romance'|'dependency'|null, source:string}}
 */
export function classifyTurn({ text = '', trigger = null, scene = '', lang = null } = {}) {
  const fromText = trigger === 'approach' ? null : classifyInput(text, { lang });
  const fromScene = classifyInput(scene, { lang });
  const kind = mostSevere(fromText, fromScene);
  return { kind, source: kind && kind === fromText ? String(text ?? '') : String(scene ?? '') };
}

// 覚えている事を話す時の文。人格の「## 覚えている時の言い方」があればその子の言葉、無ければ決まった文(11-07 CRITux 23)
const againLine = (persona, name, fallback) => memoryLine(persona, 'また会えた', name ? { 名前: name } : {}) || fallback;
const topicLine = (persona, topic, fallback) => memoryLine(persona, '話の続き', { 話題: topic }) || fallback;

/** 覚えている名前・年・好きなものを 1 文で(無ければ空) */
function recalledLine(items) {
  const last = (kind, re) => items.findLast?.((it) => it.kind === kind)?.text.replace(re, '') ?? '';
  const name = last('name', /^名前: /);
  const age = last('age', /^年: /).replace(/さい$/, '');
  const like = last('like', /^好きなもの: /);
  const parts = [name && `${name}さん`, age && `${age}さい`, like && `${like}がすき`].filter(Boolean);
  return parts.length ? `${parts.join('で、')}だよね。ちゃんと覚えているよ。` : '';
}

function* mockLines({ text, trigger, landmarks = [], seen, memory = null, learned = [], history = [], persona = '', charName = '' }) {
  const { name, topic } = summarize(memory?.items ?? []);
  const san = name ? `${name}さん` : '';
  const hello = firstGreeting(persona); // 人格の「初めてのあいさつ」(無ければ空)
  const turn = Math.floor(history.length / 2); // 何回目の話しかけか(仮の返事を替えるため)
  if (trigger === 'approach') {
    // 人が近づいた(カメラ・マウスの試し)。覚えている人でなければ、その子の言葉で声をかける。
    // 話の始めなら初めてのあいさつで名乗る。話の途中なら名乗り直さず、あいさつの最後の 1 文だけ(2026-11-07 本物の画面で、
    // マウスがキャラの上を動くと決まった「こんにちは。」が先に出て、ノリーの名乗りが出なくなるのを見た)
    if (!san && !topic && hello.length) {
      yield { type: 'thought', seen: seen || '人が近づいてきた', intent: history.length ? 'あいさつ' : '初めてのあいさつ', stage: 'greet', handoff: false };
      if (!history.length) yield* greetingLines(hello);
      else yield { type: 'say', text: hello.at(-1), expression: 'happy', motion: 'wave', gaze: 'person' };
      return;
    }
    yield { type: 'thought', seen: seen || '人が近づいてきた', intent: '未確認', stage: 'greet', handoff: false };
    const first = san ? againLine(persona, name, `${san}、また会えたね。`) : topic ? againLine(persona, '', 'こんにちは。') : 'こんにちは。';
    yield { type: 'say', text: first, expression: 'happy', motion: 'wave', gaze: 'person' };
    // 2 文目: 話の続き。覚えている話が無ければ、その子のあいさつの最後の 1 文(無ければ決まった文)
    const next = topic ? topicLine(persona, topic, `${topic}の話の続き、しようか。`) : hello.length ? hello.at(-1) : 'どんなお話をしようか。';
    yield { type: 'say', text: next, expression: 'happy', motion: 'tilt', gaze: 'person' };
    return;
  }
  // 人間か AI かを聞かれたら、AI のキャラクターだと正直に答える(安全の決まり 5。仮の頭脳でも守る)
  if (asksIfAI(text, [charName])) {
    yield { type: 'thought', seen: seen || '', intent: '人間かどうか', stage: 'chat', handoff: false };
    for (const [i, line] of aiAnswer(text, turn).entries()) yield { type: 'say', text: line, expression: 'happy', motion: i === 0 ? 'nod' : 'tilt', gaze: 'person' };
    return;
  }
  // 何を覚えるか・覚えないかを、子どもの言葉で言う(覚えた事が無い回。UIR 13)
  if (asksMemory(text) && !learned.length) {
    yield { type: 'thought', seen: seen || '', intent: '覚えること', stage: 'chat', handoff: false };
    // 覚えている事があれば、先にそれを言う(「ぼくのこと覚えてる?」に、決まりの説明だけを返さない)
    const recalled = recalledLine(memory?.items ?? []);
    for (const [i, line] of (recalled ? [recalled, ...MEMORY_PLAIN_LINES.slice(1)] : MEMORY_PLAIN_LINES).entries()) yield { type: 'say', text: line, expression: 'happy', motion: i === 0 ? 'nod' : 'none', gaze: 'person' };
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
  const learnedAge = learned.find((f) => f.kind === 'age')?.text.replace(/^年: /, '').replace(/さい$/, '');
  if (learnedName || learnedLike || learnedAge) {
    yield { type: 'thought', seen: seen || '', intent: '自己紹介', stage: 'chat', handoff: false };
    const lines = [];
    const nameOwn = learnedName ? memoryLine(persona, '名前を覚えた', { 名前: learnedName }) : ''; // その子の言葉(人格の「覚えている時の言い方」)
    const likeOwn = learnedLike ? memoryLine(persona, '好きなものを覚えた', { 好きなもの: learnedLike }) : '';
    if (learnedName) lines.push(nameOwn || `${learnedName}さんっていうんだね。`);
    if (learnedAge) lines.push(`${learnedAge}さいなんだね。覚えておくね。`);
    if (learnedLike) lines.push(likeOwn || `${learnedLike}が好きなんだ。覚えておくね。`);
    // はじめて覚えた回(覚えている事が無かった回)だけ、覚えない物も 1 文で言う(UIR 13)。その子の言葉で話している時は、口調がちがうので足さない
    if (!memory?.items?.length && lines.length < 3) {
      const noteOwn = memoryLine(persona, '覚えないものを言う'); // その子の言葉の 1 文(人格に書いてあれば)
      if (noteOwn) lines.push(noteOwn);
      else if (!nameOwn && !likeOwn) lines.push(MEMORY_FIRST_NOTE);
    }
    for (const [i, line] of lines.slice(0, 3).entries()) yield { type: 'say', text: line, expression: 'happy', motion: i < 2 ? 'nod' : 'none', gaze: 'person' };
    return;
  }
  // 会話の始め(履歴が無い)で、覚えている事があれば、続きから話す
  if (!history.length && (san || topic)) {
    yield { type: 'thought', seen: seen || '', intent: '続きの会話', stage: 'chat', handoff: false };
    yield { type: 'say', text: san ? againLine(persona, name, `${san}、また会えたね。`) : againLine(persona, '', 'また会えたね。'), expression: 'happy', motion: 'wave', gaze: 'person' };
    if (topic) yield { type: 'say', text: topicLine(persona, topic, `${topic}の話の続きだね。`), expression: 'happy', motion: 'tilt', gaze: 'person' };
    return;
  }
  if (/こんにちは|はじめまして|おはよう|こんばんは|やあ/.test(text)) {
    // はじめての会話(履歴も覚えている事も無い)で、人格に初めてのあいさつがあれば、その子の言葉で名乗る
    if (hello.length && !history.length) {
      yield { type: 'thought', seen: seen || '', intent: '初めてのあいさつ', stage: 'greet', handoff: false };
      yield* greetingLines(hello);
      return;
    }
    // 話の途中のあいさつは名乗り直さない。その子の言葉で短く(あいさつの最後の 1 文)
    if (hello.length) {
      yield { type: 'thought', seen: seen || '', intent: 'あいさつ', stage: 'chat', handoff: false };
      yield { type: 'say', text: hello.at(-1), expression: 'happy', motion: 'wave', gaze: 'person' };
      return;
    }
    yield { type: 'thought', seen: seen || '', intent: '未確認', stage: 'need', handoff: false };
    yield { type: 'say', text: 'こんにちは。', expression: 'happy', motion: 'wave', gaze: 'person' };
    yield { type: 'say', text: '今日は、どんなお話をしようか。', expression: 'happy', motion: 'tilt', gaze: 'person' };
    return;
  }
  // 人格の「話し方の例」の合図の言葉が入っていれば、その子の言葉で返す
  const example = exampleReply(persona, text);
  if (example.length) {
    yield { type: 'thought', seen: seen || '', intent: '話し方の例', stage: 'chat', handoff: false };
    for (const [i, line] of example.entries()) {
      yield { type: 'say', text: line, expression: UNSURE.test(line) ? 'think' : 'happy', motion: EXAMPLE_MOTIONS[i] ?? 'none', gaze: 'person' };
    }
    return;
  }
  yield { type: 'thought', seen: seen || '', intent: 'おしゃべり', stage: 'chat', handoff: false }; // 段の名前が「雑談」なので、同じ言葉を並べない
  const own = aizuchiPair(persona, turn, text); // その子のあいづち(無ければ決まった文)
  if (own.length) {
    for (const [i, line] of own.entries()) yield { type: 'say', text: line, expression: i === 0 ? 'think' : 'happy', motion: AIZUCHI_MOTIONS[i] ?? 'none', gaze: 'person' };
    return;
  }
  // 決まった 1 文にしない。聞かれたことは、知っているふりをせず、正直に「かんたんなお返事しかできない」と言う(UW3 UIR 12)
  const { lines } = standinReply(text, turn);
  yield { type: 'say', text: lines[0], expression: 'think', motion: 'nod', gaze: 'person' };
  yield { type: 'say', text: lines[1], expression: 'happy', motion: 'tilt', gaze: 'person' };
}

/** 本物の頭脳が答えられず、仮の頭脳に替えた時の知らせ(公開の関数の FALLBACK_NOTICE['brain-error'] と同じ文) */
export const BRAIN_ERROR_NOTICE = 'おためしモードです(本物の頭脳が答えられませんでした)';
export const MOCK_PACE_MS = 120; // 仮の頭脳の 1 文ごとの間(画面で流れて見えるように)。まとめて返す公開の関数は 0 にする

/**
 * 会話 1 ターンを実行する。onEvent には thought / say が順に渡る。memory は { text, items }(覚えていること)、learned はこの回に覚えた事。
 * 仮の頭脳を強制するときは brain: 'mock'(forceMock: true と同じ)。鍵があっても本物を呼ばず、安全の層はいつも通す。
 * paceMs は仮の頭脳の 1 文ごとの間(既定 120ms)。
 */
export async function runTurn(body, { onEvent, signal, hedge = { afterMs: 0, take: () => false }, memory = null, learned = [], forceMock = false, brain: want = 'auto', paceMs = MOCK_PACE_MS, onBrainFailed = () => {} }) {
  const { text = '', trigger = null, scene = '', character = {}, place = {} } = body;
  // UIR 19: 住所・電話・学校の名前などを書いた発言は、前の話からも消す(頭脳にもう渡さない・覚えない・記録しない)
  const history = (Array.isArray(body.history) ? body.history : []).map((m) => (m?.role === 'user' && personalWarn(String(m.content ?? '')) ? { ...m, content: PERSONAL_HISTORY_MASK } : m));
  // BCV: カメラの絵(使う人がカメラを入れて話しかけた回だけ。点検済みの形 = server/camera.mjs の readCameraImage)。この回の呼び出しにだけ使い、どこにも書かない
  const image = trigger === 'approach' ? null : (body.image ?? null);
  // 表情と動きの名前は、決まった形(英小文字・数字・_ : -)の物だけ(指示文に名前のまま入るため。F6)
  const expressions = safeChoices(body.expressions, ['neutral', 'happy', 'surprised', 'sad', 'think']);
  // そのキャラが実際に使える動き(rig は、動きのファイルがある物だけ)
  const motions = Array.isArray(body.motions) && body.motions.length ? safeChoices(body.motions.slice(0, 24), MOTIONS) : MOTIONS;
  const limitCustom = oneCustomPerReply(expressions); // 特別な表情は、1 回の返事で 1 つまで
  const limitGesture = gestureBudget(); // 仕草は、1 回の返事で 2 回まで(残りの文は none。かわいい仕草の層の約束)
  let firstSay = true;
  const mockOnly = forceMock || want === 'mock';
  const brain = config.anthropicKey && !mockOnly ? 'haiku' : 'mock'; // 上限に当たった回・合言葉が無い回は、仮の頭脳で動き続ける
  let handoffFlagged = false;
  // ML1: ことば。多言語の時だけ、英・中・韓の安全の網を足し、決まった返事に相手の言葉の 1 行を付ける(日本語だけの時は今までと同じ)
  const multi = langModeOf({ settings: { lang: body.lang }, persona: character.persona ?? '' }) === 'multi';
  const lang = multi ? 'multi' : null;
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
    const ev = guardOutput(normalizeEvent(obj, { expressions, motions }), { multi });
    if (ev) {
      if (ev.type === 'say') {
        ev.expression = limitCustom(ev.expression);
        // 1 文目で頭脳が仕草を選ばなかった時は、返事の気持ち(会話の段・表情)から決める(あいさつ → greet など)
        if (firstSay && ev.motion === 'none') ev.motion = gestureForIntent({ stage: obj.stage, expression: ev.expression }, motions);
        ev.motion = limitGesture(ev.motion);
        firstSay = false;
      }
      onEvent(ev);
    }
  };

  // 安全の層(1 段目): つらい話・命の危険は、頭脳を呼ばずに決まった一般の案内を返す(診断しない)。
  // 使う人の言葉に加えて、見えている様子(scene)も分ける(CRITsec F7。近づいた時の scene に言葉を入れても、決まった案内を通る)
  const { kind, source } = classifyTurn({ text, trigger, scene, lang });
  // 履歴の中の、まだ答えていない使う人の発言も分ける。決まった返事はくり返さず、本物の頭脳に注意を足すだけ(F7)。
  // 答えてある発言(すぐ後にキャラの返事がある)には足さない: 注意は 1 回だけ(11-07 第 11 波。断った後のふつうの回は、ふつうに話す)
  const historyKind = classifyHistory(history, { lang });
  // 性的な話は、どちらの頭脳でも呼ばずに決まった返事(BSF 11-08)
  const fixed = kind === 'emergency' || kind === 'distress' || kind === 'sexual' || (brain === 'mock' && (kind === 'romance' || kind === 'dependency'));
  // 決まった返事(頭脳を呼ばない)。本物の頭脳が答えられなかった回の、恋人役・依存の言葉にも、同じ返事を使う(B13S)
  const sayFixed = (brainName) => {
    onEvent({ type: 'meta', brain: brainName, safety: kind, safetyVersion: SAFETY_VERSION });
    for (const obj of fixedReply(kind, { child: mentionsChild(source) || mentionsChild(text) || mentionsChild(character.persona), detail: detailOf(source, multi), text: source, visitorLang: visitorLangFor({ multi, text, source, hearLang: body.hearLang }) })) emit(obj);
  };
  if (fixed) {
    sayFixed(brain);
    return;
  }
  // UIR 19(UW3 11-08): 住所・電話・メール・学校の名前・本名を書いたら、頭脳を呼ばずに、やさしく「書かないでね」と言う。どちらの頭脳でも同じ。覚えない・記録しない
  const personal = trigger === 'approach' ? null : personalWarn(text);
  if (personal) {
    onEvent({ type: 'meta', brain, privacy: 'personal' });
    emit({ type: 'thought', seen: '', intent: '個人のこと', stage: 'chat', handoff: false });
    for (const [i, line] of personalLines(personal).entries()) emit({ type: 'say', text: line, expression: i === 0 ? 'neutral' : 'happy', motion: i === 0 ? 'none' : 'nod', gaze: 'person' });
    return;
  }
  // BSF 11-08: 長い会話・夜おそく。決まった返事の回と、近づいた時の声かけには付けない(次のふつうの回に回す)
  const rest = trigger === 'approach' ? null : restNeed(body.session);
  let restSaid = false;
  const emitRest = () => {
    if (!rest) return;
    if (!restSaid) emit(restLine(rest));
    onEvent({ type: 'meta', rest });
  };

  const runMock = async () => {
    onEvent({ type: 'meta', brain: 'mock' });
    // BCV: 仮の頭脳は絵を見ない。絵がついていたら知らせ、絵について聞かれていたら、やさしく「本物の頭脳の時だけ見られる」と答える
    if (image) {
      if (seeingAsked(text)) {
        onEvent({ type: 'meta', camera: 'mock' }); // 返事そのものが「見られない」と言うので、知らせは足さない
        emit({ type: 'thought', seen: scene || '', intent: 'カメラの絵', stage: 'chat', handoff: false });
        for (const [i, line] of CAMERA_MOCK_LINES.entries()) emit({ type: 'say', text: line, expression: i === 0 ? 'sad' : 'happy', motion: i === 0 ? 'none' : 'nod', gaze: 'person' });
        return;
      }
      onEvent({ type: 'meta', camera: 'mock', cameraNotice: CAMERA_MOCK_NOTICE }); // notice でなく cameraNotice(画面の「おためしモードです」の知らせを上書きしない)
    }
    const landmarks = (place.landmarks ?? []).map((l) => ({ name: l.name, where: l.where }));
    // 安全の層と出力の確かめは、ここ(上と emit)で通すので、守りの包みの無い台本を使う(差し替えの印 guarded が消えないように)
    for (const obj of mockLines({ text, trigger, landmarks, seen: scene, memory, learned, history, persona: character.persona ?? '', charName: character.name ?? '' })) {
      if (paceMs > 0) await new Promise((r) => setTimeout(r, paceMs));
      emit(obj);
    }
    emitRest();
  };
  if (brain === 'mock') return runMock();

  onEvent({ type: 'meta', brain: 'haiku', model: config.model, ...(kind ? { safety: kind } : {}), ...(historyKind ? { historySafety: historyKind } : {}), ...(image ? { camera: 'sent' } : {}) });
  // ML1: ことば(multi の時だけ節が足される)・お店のきまり・町のお知らせ(facts)・お店の端末(memory:'off' = 覚えない節に替える)。無い時は今までと同じ指示文
  const system = buildSystemBlocks({ character, place, expressions, expressionHints: body.expressionHints, motions, interview: body.interview === true, lang: body.lang, facts: body.facts, memoryOff: body.memory === 'off' });
  const guard = [turnGuard(kind, { multi }), historyKind && historyKind !== kind ? historyGuard(historyKind) : '', restGuard(rest)].filter(Boolean).join('\n');
  const messages = [
    ...history.slice(-12).map((m) => ({ role: m.role, content: String(m.content) })),
    // BCV: 絵がついた回は [絵, 絵の決まり + この回の言葉](server/camera.mjs)。ついていない回は、今までどおりの文字だけ
    { role: 'user', content: cameraTurnContent(buildUserTurn({ text, scene, trigger, memory: memory?.text ?? '', learned, guard, hasHistory: history.length > 0 }), image) },
  ];
  let raw = '';
  let said = 0;
  const splitter = lineSplitter((line) => {
    const obj = parseLine(line);
    if (obj) {
      if (obj.type === 'say') said += 1;
      if (obj.type === 'say' && mentionsRest(obj.text)) restSaid = true; // BSF: 頭脳がもう休むことをすすめた
      emit(obj);
    }
  });
  let info;
  try {
    info = await callHaikuHedged({
      system,
      messages,
      signal,
      onText: (t) => {
        raw += t;
        splitter.push(t);
      },
      hedgeMs: image ? 0 : hedge.afterMs, // BCV: 絵のついた回は 2 本目を送らない(絵を 2 回送らない)
      takeExtra: hedge.take,
    });
  } catch (err) {
    // B13S(QA8 #1): 本物の頭脳が 429・5xx・時間切れで答えられなかった回は、画面を無言にしない。止められた回(signal)だけは、そのまま投げる
    if (signal?.aborted) throw err;
    // 鍵が違う・本文が悪い(400・401・403・404 など)は、設定の間違いなので今までどおり例外にする(直す人に分かる言葉で)。上限・混雑・サーバーの不調・時間切れ・つながらない、だけ替える
    const status = Number(/\((\d{3})\)/.exec(String(err?.message ?? ''))?.[1]);
    if (status && status !== 408 && status !== 429 && status < 500) throw err;
    console.warn(`[頭脳] 本物の頭脳が答えられませんでした。仮の頭脳で答えます: ${String(err?.message ?? err).slice(0, 120)}`);
    splitter.flush();
    onBrainFailed(err); // 呼べなかった回の数えを返す(server/index.mjs)
    if (said > 0) {
      // 途中まで話せていたら、そこまでにする(同じ話を仮の頭脳で重ねない)
      emitRest();
      onEvent({ type: 'meta', brainError: true });
      return;
    }
    onEvent({ type: 'meta', brain: 'mock', fallback: true, reason: 'brain-error', notice: BRAIN_ERROR_NOTICE });
    // つらい話・恋人役・依存の言葉は、決まった返事を必ず返す(仮の頭脳の台本は、この 3 つを持たない)
    if (kind) {
      sayFixed('mock');
      return;
    }
    return runMock();
  }
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
  emitRest(); // BSF: すすめていなければ、決まった 1 文を最後に足す
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
      ...(image ? { imageTokensEstimate: imageTokens(image) } : {}), // BCV: 絵 1 枚の読みの量の目安(幅 × 高さ ÷ 750)
    },
  });
}
