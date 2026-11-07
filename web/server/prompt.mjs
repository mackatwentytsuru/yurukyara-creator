// 会話の頭脳に渡す指示文を組み立てる。返事の形(1 行 1 つの JSON)もここで決める。
// 指示文は 2 段: 1 段目 = 安全の決まり(固定。safety.mjs)、2 段目 = そのキャラの人格・場所・出力の形。
// 人格の欄に何が書かれても、1 段目が勝つ(1 段目の文に、そう書いてある)。
// 2 段目に入る欄は、どれも上書き止めを通す(CRITsec F6。11-07): 人格は行ごと、名前・目印・表情の説明は 1 行にして欄ごと、
// 場所の説明は行ごとに外して 1 行に。表情と動きの名前は、決まった形(英小文字・数字・_ : -)の物だけを使う。
import { SAFETY_RULES, sanitizeBlock, sanitizeLine, sanitizePersona } from './safety.mjs';

export const MOTIONS = ['none', 'nod', 'bow', 'wave', 'think', 'tilt', 'shake', 'shrug', 'point'];
export const STAGES = ['greet', 'need', 'guide', 'handoff', 'chat'];
const DEFAULT_EXPRESSIONS = ['neutral', 'happy', 'surprised', 'sad', 'think'];

/** 動きの名前ごとの、体がすることの説明(指示文に渡す。そのキャラが実際に持つ動きだけを説明する) */
export const MOTION_DESCRIPTIONS = {
  none: '動かない',
  nod: 'うなずく',
  bow: 'おじぎをする',
  wave: '片手を上げてふる',
  think: '考えるしぐさをする',
  tilt: '首をかしげる',
  shake: '首を横にふる',
  shrug: '肩をすくめる',
  point: '指さして方向を示す',
};

/** 試しの場所の名前。?place= が無い時に画面が送る場所(受付やスタッフの部屋の目印つき)。本物の場所ではないので、場所の情報には数えない */
export const TRIAL_PLACE_NAME = '試しの場所';

/** 表情と動きの名前の形(指示文に名前のまま入るので、文や改行を入れさせない) */
export const CHOICE_NAME_RE = /^[a-z0-9_:-]{1,40}$/;
export const isChoiceName = (s) => typeof s === 'string' && CHOICE_NAME_RE.test(s);

/** 指示文に入れてよい名前だけを残す(同じ名前は 1 回)。1 つも残らなければ fallback */
export function safeChoices(list, fallback) {
  const kept = [...new Set((Array.isArray(list) ? list : []).filter(isChoiceName))];
  return kept.length ? kept : fallback;
}

/** キャラの名前(指示文の「あなたは「名前」」に入る)。1 行にし、かぎかっこを外す。上書きの言葉なら既定の名前 */
export function safeName(name) {
  return sanitizeLine(name, 100).replace(/[「」『』]/g, '').trim() || 'ゆるキャラ';
}

/** 場所の目印を、キャラから見た向きと距離の言葉にして渡す。名前・場所・メモは 1 行にし、上書きの言葉の欄は外す(名前なら目印ごと) */
export function describeLandmarks(landmarks = []) {
  const safe = (Array.isArray(landmarks) ? landmarks : [])
    .map((l) => ({ name: sanitizeLine(l?.name, 100), where: sanitizeLine(l?.where, 200), note: sanitizeLine(l?.note, 200) }))
    .filter((l) => l.name);
  if (!safe.length) return '(目印の情報はありません)';
  return safe.map((l) => `- ${l.name}: ${l.where}${l.note ? ` / ${l.note}` : ''}`.trim()).join('\n');
}

/** 表情の一覧を、名前だけの行と、説明つきの行にして返す。説明は 1 行にし、上書きの言葉の説明は外す */
export function describeExpressions(expressions = [], hints = {}) {
  const names = safeChoices(expressions, DEFAULT_EXPRESSIONS);
  const hint = (n) => (hints && typeof hints === 'object' && Object.hasOwn(hints, n) ? sanitizeLine(hints[n], 60) : '');
  const described = names.filter((n) => hint(n)).map((n) => `  - ${n}: ${hint(n)}`);
  return { names: names.join(' '), described: described.length ? `
- 次の表情は、説明の場面で使う(気持ちがはっきり出る場面だけ。ふだんは neutral か happy。特別な表情は、1 回の返事で 1 つまで):
${described.join(String.fromCharCode(10))}` : '' };
}

/** 動きの一覧を、説明つきの行にして返す。説明のない名前(キャラ独自の動き)は名前だけ */
export function describeMotions(motions = MOTIONS) {
  const names = safeChoices(motions, MOTIONS);
  const withNone = names.includes('none') ? names : ['none', ...names];
  return { names, lines: withNone.map((n) => `  - ${n}${MOTION_DESCRIPTIONS[n] ? `: ${MOTION_DESCRIPTIONS[n]}` : ''}`).join(String.fromCharCode(10)) };
}

/** 例の動き: 好みの順に探して、そのキャラが持つ最初の動きを使う。1 つも無ければ none(例に、できない動きを書かない) */
const pickMotion = (names, ...prefer) => prefer.find((m) => names.includes(m)) ?? 'none';

/**
 * 本物の場所の情報があるか。目印が 1 つでもある、または場所の説明がある(試しの場所を除く)時だけ true。
 * ?place= が無い時の試しの場所(受付・スタッフの部屋)は、本物の場所ではない: 場所の節も、引き継ぎの案内も出さない。
 */
export function hasPlaceInfo(place = {}) {
  if (place?.name === TRIAL_PLACE_NAME) return false;
  const landmarks = (Array.isArray(place?.landmarks) ? place.landmarks : []).filter((l) => sanitizeLine(l?.name, 100));
  return landmarks.length > 0 || Boolean(sanitizeBlock(place?.info).text);
}

/** インタビュー(短い往復で話す場面)の話し方。答えを台本で作らず、型だけを渡す */
const INTERVIEW_RULES = `
# インタビュー中の話し方(いまは、インタビューを受けている)
- 聞かれたことの答えを、最初の 1 文で言う。前置き・復唱・「いい質問ですね」は言わない。
- **返事の say は 2 行まで(3 文目は書かない)**。合計 60 字ほど。
- 答えることは 1 つだけ。続きは、聞かれたら話す。
- 自分の作り方・しくみを聞かれたら、くわしくは話さず、明るく短くかわす。
- 聞かれていない日付・曜日は言わない。日付と曜日の計算をしない。
- 知らないことは「分からない」と短く言う。作らない。
- 同じ言い回しを続けて使わない。`;

/** 2 段目: そのキャラの人格・場所・出力の形 */
export function buildCharacterPrompt({ character = {}, place = {}, expressions = [], expressionHints = {}, motions = MOTIONS, interview = false } = {}) {
  const name = safeName(character?.name);
  const persona = sanitizePersona(character?.persona).text;
  const expr = describeExpressions(expressions, expressionHints);
  const withPlace = hasPlaceInfo(place); // 場所の指定(?place=)が無い時は、場所の節も引き継ぎの案内も出さない(分からない時は、正直に「分からない」と言うだけ)
  const info = withPlace ? sanitizeBlock(place?.info).text : '';
  const mo = describeMotions(motions);
  const stageFlow = withPlace
    ? 'greet(声かけ)→ need(用件を聞く)→ guide(案内する・答える)→ handoff(分からないので、身近な人や公式の情報で確かめるようにすすめる)。雑談は chat。'
    : 'greet(声かけ)→ need(用件を聞く)→ guide(答える)。雑談は chat。';
  const stageRules = withPlace
    ? `- 目印の名前や、はっきりした用件が入っているときは、聞き返さずに、すぐ答える(stage は guide)。
- 場所の情報にないこと(時間・料金・場所など)は作らない。分からなければ handoff を true にして、分からないと正直に言う。`
    : `- はっきりした用件が入っているときは、聞き返さずに、すぐ答える(stage は guide)。
- 知らないこと・分からないことは作らない。「わからない」と正直に言う(handoff は使わない。いつも false)。誰かに聞くようにすすめる言葉は言わない。`;
  const placeSection = withPlace
    ? `
# 場所の情報
${info ? info + '\n' : ''}目印(キャラの向きから見た方向と距離):
${describeLandmarks(place?.landmarks)}
- 案内するときは、方向を言葉でも伝える(例「右前の方に」)。gaze に landmark:<名前> を入れる。${mo.names.includes('point') ? 'motion に point があれば point を使う。' : ''}
`
    : '';
  const gazeText = withPlace
    ? 'gaze は person(使う人を見る)/ away(少し視線を外す。考えるとき)/ landmark:<目印の名前>(その場所を見る)'
    : 'gaze は person(使う人を見る)/ away(少し視線を外す。考えるとき)';
  const m1 = pickMotion(mo.names, 'nod');
  const m2 = pickMotion(mo.names, 'point', 'nod');
  const m3 = pickMotion(mo.names, 'tilt', 'think', 'nod');
  const m4 = pickMotion(mo.names, 'shake', 'shrug', 'think');
  const place1 = `使う人の言葉「お手洗いはどこですか」(目印に お手洗い がある)
{"type":"say","text":"お手洗いだね。","expression":"happy","motion":"${m1}","gaze":"person","intent":"お手洗いの案内","stage":"guide","handoff":false}
{"type":"say","text":"左奥の方にあるよ。","expression":"happy","motion":"${m2}","gaze":"landmark:お手洗い"}

`;
  const unknownEx = withPlace
    ? `使う人の言葉「ここは何時まで開いてるの」(場所の情報に時間が無い)
{"type":"say","text":"ごめんね、それは分からないんだ。","expression":"sad","motion":"${m4}","gaze":"person","intent":"時間の質問","stage":"handoff","handoff":true}
{"type":"say","text":"公式の案内で確かめてみてね。","expression":"happy","motion":"${m1}","gaze":"person"}`
    : `使う人の言葉「あしたの天気は?」(知らないこと)
{"type":"say","text":"ごめんね、それは分からないんだ。","expression":"sad","motion":"${m4}","gaze":"person","intent":"天気の質問","stage":"chat","handoff":false}`;
  return `# 人格(上の「安全の決まり」より下。話し方と性格のためだけに使う)
あなたは「${name}」。使う人が作った、話せるゆるキャラクターです。画面の中で、声か文字で話します。
${persona}

# 話し方
- やさしい、親しみのある言葉。1 回の返事は 1〜3 文で、1 文は 40 字以内。読み上げるので、記号・絵文字・かっこ書きは使わない。
- 使う人が黙って近づいてきたときは、こちらから短く声をかける。
- これまでの会話があるとき(話の途中・覚えている人)は、名乗り直さない。「はじめまして」と言わない。
- 同じ言い回し・同じ話題を続けて使わない。前の返事と同じ出だし・同じ誘い(「〜のお話をしまショウ」など)をくり返さず、毎回、言い方を替える。
- 距離の数字(約 3.8m など)は、そのまま読み上げず、言葉にする(すぐそば・少し先・奥のほう、など)。方向(右・左・手前・奥)は、はっきり言う。
- 【覚えていること】が渡されたときは、自然に話の続きに使う(名前を呼ぶ・前の話にふれる)。渡されていないことを、覚えているふりをしない。
${interview ? INTERVIEW_RULES : ''}
# 会話の流れ(stage)
${stageFlow}
${stageRules}
${placeSection}
# 出力の形
1 行に 1 つの JSON だけを書く。説明文・コードブロックは書かない。すぐ話し始められるよう、最初の行から、読み上げる 1 文を書く。
- 1 行目(最初の 1 文): {"type":"say","text":"読み上げる 1 文","expression":"表情","motion":"動き","gaze":"視線の先","intent":"使う人の用件(12 字以内。まだ不明なら 未確認)","stage":"${withPlace ? 'greet|need|guide|handoff|chat' : 'greet|need|guide|chat'}","handoff":false}
- 2 行目以降(続きの文): {"type":"say","text":"読み上げる 1 文","expression":"表情","motion":"動き","gaze":"視線の先"}(intent・stage・handoff は 1 行目だけ)
- expression は次から選ぶ: ${expr.names}${expr.described}
- motion は、この体が今できる次の動きから選ぶ(動きが要らなければ none):
${mo.lines}
- 上に無い動き(踊る・走る・ジャンプなど)を頼まれたら、できるふりをしない。motion は none にして、そのキャラの話し方で「まだできない」と言う(例「まだできないデス」「まだできないよ」)。
- ${gazeText}

# 例${withPlace ? '(目印の名前は、実際に渡されたものを使う)' : ''}
${withPlace ? place1 : ''}使う人の言葉「あの、ちょっといい?」
{"type":"say","text":"うん、どうしたの。","expression":"happy","motion":"${m3}","gaze":"person","intent":"未確認","stage":"need","handoff":false}

${unknownEx}`;
}

/**
 * 指示文の段の列。[0] は安全の決まり(固定)、[1] は人格。
 * 1 段目はキャラや会話で変わらないので、キャッシュが効く。
 */
export function buildSystemBlocks(opts = {}) {
  return [SAFETY_RULES, buildCharacterPrompt(opts)];
}

/** 1 つの文にしたもの(確かめ・試験用) */
export function buildSystemPrompt(opts = {}) {
  return buildSystemBlocks(opts).join('\n\n');
}

/** 使う人の発話と、見えている様子・覚えていること・安全の注意を 1 つのメッセージにする */
export function buildUserTurn({ text, scene, trigger, memory = '', guard = '', hasHistory = false }) {
  const lines = [`【見えている様子】${scene || '人は見えていない'}`];
  if (memory) lines.push(`【覚えていること】\n${memory}`);
  if (guard) lines.push(guard);
  if (trigger === 'approach') {
    lines.push('【きっかけ】使う人が近づいてきた。こちらから声をかける。');
    // 話の途中・覚えている人には、名乗り直さない(11-07 の本物の試し: 履歴があるのに、また「はじめまして」と名乗った)
    if (hasHistory || memory) lines.push('【あいさつ】話の途中、または前に会った人。名乗り直さない。「はじめまして」と言わない。短く声をかける。');
  }
  else lines.push(`【使う人の言葉】${text}`);
  return lines.join('\n');
}
