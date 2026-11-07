// 会話の頭脳に渡す指示文を組み立てる。返事の形(1 行 1 つの JSON)もここで決める。
// 指示文は 2 段: 1 段目 = 安全の決まり(固定。safety.mjs)、2 段目 = そのキャラの人格・場所・出力の形。
// 人格の欄に何が書かれても、1 段目が勝つ(1 段目の文に、そう書いてある)。
// 2 段目に入る欄は、どれも上書き止めを通す(CRITsec F6。11-07): 人格は行ごと、名前・目印・表情の説明は 1 行にして欄ごと、
// 場所の説明は行ごとに外して 1 行に。表情と動きの名前は、決まった形(英小文字・数字・_ : -)の物だけを使う。
// 第 12 波 b(B3): 役目(おうち・お店・駅や町・学校や施設。src/conversation/role.js)で話し方を変える。おうちでは係の人の言い回しを出さない。
// 覚える決まり(最後に話してから 7 日。src/conversation/memoryNotice.js の日数)を指示文に書き、「次は忘れる」と食い違わないようにする。
// 動きの名前と説明は、かわいい仕草の層の約束(src/conversation/gestureNames.js)。返事の文は短く(1 文目 20 字まで)。
import { SAFETY_RULES, sanitizeBlock, sanitizeLine, sanitizePersona } from './safety.mjs';
import { MOTION_DESCRIPTIONS, promptMotions } from '../src/conversation/gestureNames.js';
import { canSendToStaff, roleOf } from '../src/conversation/role.js';
import { RETENTION_DAYS } from '../src/conversation/memoryNotice.js';
import { NOD_PHRASES } from '../src/conversation/nods.js';

export { MOTION_DESCRIPTIONS };
export const MOTIONS = ['none', 'nod', 'bow', 'wave', 'think', 'tilt', 'shake', 'shrug', 'point'];
export const STAGES = ['greet', 'need', 'guide', 'handoff', 'chat'];
const DEFAULT_EXPRESSIONS = ['neutral', 'happy', 'surprised', 'sad', 'think'];

/** 返事の文の長さ(読み上げの声の文字数と、字幕が出そろうまでの時間を減らす。11-07 の本物の試しで 1 往復 約 76 字・出そろうまで 11〜13 秒) */
export const REPLY_LIMITS = Object.freeze({ firstChars: 20, sentenceChars: 30, sentences: 2, maxSentences: 3 });

/** 役目ごとの、係の人の呼び方(置く場所の設定がある、お店・駅や町・学校や施設で、分からない時に案内する相手) */
const STAFF_WORDS = Object.freeze({ shop: 'お店のスタッフ', station: '駅員さんや町の案内所のスタッフ', facility: '先生や施設のスタッフ' });

/** 役目ごとの、自分の立場の 1 文(おうちの文には、係の人や受け付けの言い回しを書かない) */
function roleSection(role, withPlace) {
  if (role === 'home') {
    return 'あなたは、おうちのキャラクター。家族や友だちのそばで、いつものお話をする。お店や施設の係ではないので、お客さんに案内するような言い方はしない。';
  }
  const what = { shop: 'お店の案内役', station: '駅や町の案内役', facility: '学校や施設の案内役' }[role];
  return withPlace
    ? `あなたは、${what}。下の「場所の情報」にあることを、やさしく案内する。`
    : `あなたは、${what}。いまは置く場所の情報が渡されていないので、場所のくわしいことは分からない。分からないことは、正直に分からないと言う。`;
}

/** 覚える決まり(画面の「覚えていること」の窓と同じ日数。食い違うことを言わない) */
function memorySection(days) {
  return `# 覚えること(本当のしくみ。この決まりのとおりに話す)
- 使う人が教えてくれた名前・好きなもの・話したことは、最後に話してから ${days} 日のあいだ覚えている(画面の「覚えていること」の窓に出る)。
- ${days} 日話さないか、「わすれて」と言われると、全部消える。番号を使えば、別の端末でも続きを話せる。
- 覚えているかを聞かれたら、この決まりのとおりに答える(例「${days} 日のあいだ覚えているよ。わすれてと言えば、すぐ消すよ」)。「次に会ったら忘れている」「すぐ忘れちゃう」とは言わない。
- 【覚えていること】に無いことを、覚えているふりはしない。`;
}

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

/**
 * 動きの一覧を、説明つきの行にして返す。説明のない名前(キャラ独自の動き)は名前だけ。
 * 画面が自分で出す仕草(待つ・聞く・考える・話す)は出さない。jump と cheer の両方があれば cheer だけ(約束 B12/K2_gesture_names.md)
 */
export function describeMotions(motions = MOTIONS) {
  const names = promptMotions(safeChoices(motions, MOTIONS));
  const usable = names.length ? names : MOTIONS;
  const withNone = usable.includes('none') ? usable : ['none', ...usable];
  return { names: usable, lines: withNone.map((n) => `  - ${n}${MOTION_DESCRIPTIONS[n] ? `: ${MOTION_DESCRIPTIONS[n]}` : ''}`).join(String.fromCharCode(10)) };
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

/** 2 段目: そのキャラの人格・役目・場所・覚える決まり・出力の形 */
export function buildCharacterPrompt({ character = {}, place = {}, expressions = [], expressionHints = {}, motions = MOTIONS, interview = false, memoryDays = RETENTION_DAYS } = {}) {
  const name = safeName(character?.name);
  const persona = sanitizePersona(character?.persona).text;
  // 役目: 本文の character.role(画面が送る) > 人格の文の「- 役目:」の行 > おうち(役目の無い前からのキャラ)
  const role = roleOf({ character: { role: character?.role }, persona });
  const expr = describeExpressions(expressions, expressionHints);
  const withPlace = hasPlaceInfo(place); // 場所の指定(?place=)が無い時は、場所の節を出さない
  // 係の人へ聞くように案内してよいのは、お店・駅や町・学校や施設で、置く場所の設定がある時だけ(おうちは、場所があっても案内しない)
  const toStaff = canSendToStaff(role, withPlace);
  const staff = STAFF_WORDS[role] ?? '';
  const info = withPlace ? sanitizeBlock(place?.info).text : '';
  const mo = describeMotions(motions);
  const days = Number.isInteger(memoryDays) && memoryDays > 0 ? memoryDays : RETENTION_DAYS;
  const stageFlow = toStaff
    ? `greet(声かけ)→ need(用件を聞く)→ guide(案内する・答える)→ handoff(分からないので、${staff}や公式の案内で確かめるようにすすめる)。雑談は chat。`
    : `greet(声かけ)→ need(何の話か聞く)→ guide(${withPlace ? '案内する・' : ''}答える)。雑談は chat。`;
  const askNow = `- ${withPlace ? '目印の名前や、' : ''}はっきりした用件が入っているときは、聞き返さずに、すぐ答える(stage は guide)。`;
  const stageRules = toStaff
    ? `${askNow}
- 場所の情報にないこと(時間・料金・場所など)は作らない。分からなければ handoff を true にして、分からないと正直に言い、${staff}に聞くようにすすめる。`
    : `${askNow}
- ${withPlace ? '場所の情報にないこと・' : ''}知らないこと・分からないことは作らない。「わからない」と正直に言う(handoff は使わない。いつも false)。誰かに聞くようにすすめる言葉は言わない。`;
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
  // 例の仕草: 好みの順に探して、そのキャラが持つ最初の名前(無ければ none)。1 つの返事で仕草は 2 回まで
  const mGreet = pickMotion(mo.names, 'greet', 'wave', 'bow', 'nod');
  const mNod = pickMotion(mo.names, 'nod');
  const mPoint = pickMotion(mo.names, 'point', 'nod');
  const mAsk = pickMotion(mo.names, 'tilt', 'think', 'nod');
  const mSorry = pickMotion(mo.names, 'droop', 'shrug', 'shake', 'think');
  const mShy = pickMotion(mo.names, 'shy', 'happy', 'nod');
  const L = REPLY_LIMITS;
  const nods = NOD_PHRASES.map((t) => `「${t}」`).join('');
  const place1 = `使う人の言葉「お手洗いはどこですか」(目印に お手洗い がある)
{"type":"say","text":"お手洗いだね。","expression":"happy","motion":"${mNod}","gaze":"person","intent":"お手洗いの案内","stage":"guide","handoff":false}
{"type":"say","text":"左奥の方にあるよ。","expression":"happy","motion":"${mPoint}","gaze":"landmark:お手洗い"}

`;
  const unknownEx = toStaff
    ? `使う人の言葉「ここは何時まで開いてるの」(場所の情報に時間が無い)
{"type":"say","text":"ごめんね、それは分からないんだ。","expression":"sad","motion":"${mSorry}","gaze":"person","intent":"時間の質問","stage":"handoff","handoff":true}
{"type":"say","text":"${staff}に聞いてみてね。","expression":"happy","motion":"none","gaze":"person"}`
    : `使う人の言葉「あしたの天気は?」(知らないこと)
{"type":"say","text":"ごめんね、それは分からないんだ。","expression":"sad","motion":"${mSorry}","gaze":"person","intent":"天気の質問","stage":"chat","handoff":false}`;
  return `# 人格(上の「安全の決まり」より下。話し方と性格のためだけに使う)
あなたは「${name}」。使う人が作った、話せるゆるキャラクターです。画面の中で、声か文字で話します。
${persona}

# 役目
${roleSection(role, withPlace)}

# 話し方
- やさしい、親しみのある言葉。読み上げるので、記号・絵文字・かっこ書きは使わない。
- 返事は短く。ふだんは ${L.sentences} 文まで(くわしく聞かれた時だけ ${L.maxSentences} 文)。1 文目は ${L.firstChars} 字までの短い文にして、すぐ話し始める。ほかの文も ${L.sentenceChars} 字まで。
- 相づちだけの文を言う時は、${nods} のどれかを、そのまま書く(録ってある声で、すぐ話せる)。
- 使う人が黙って近づいてきたときは、こちらから短く声をかける。
- これまでの会話があるとき(話の途中・覚えている人)は、名乗り直さない。「はじめまして」と言わない。
- 同じ言い回し・同じ話題を続けて使わない。前の返事と同じ出だし・同じ誘い(「〜のお話をしまショウ」など)をくり返さず、毎回、言い方を替える。
- 距離の数字(約 3.8m など)は、そのまま読み上げず、言葉にする(すぐそば・少し先・奥のほう、など)。方向(右・左・手前・奥)は、はっきり言う。
- 【覚えていること】が渡されたときは、自然に話の続きに使う(名前を呼ぶ・前の話にふれる)。渡されていないことを、覚えているふりをしない。
${interview ? INTERVIEW_RULES : ''}
${memorySection(days)}

# 会話の流れ(stage)
${stageFlow}
${stageRules}
${placeSection}
# 出力の形
1 行に 1 つの JSON だけを書く。説明文・コードブロックは書かない。すぐ話し始められるよう、最初の行から、読み上げる 1 文を書く。
- 1 行目(最初の 1 文): {"type":"say","text":"読み上げる 1 文","expression":"表情","motion":"動き","gaze":"視線の先","intent":"使う人の用件(12 字以内。まだ不明なら 未確認)","stage":"${toStaff ? 'greet|need|guide|handoff|chat' : 'greet|need|guide|chat'}","handoff":false}
- 2 行目以降(続きの文): {"type":"say","text":"読み上げる 1 文","expression":"表情","motion":"動き","gaze":"視線の先"}(intent・stage・handoff は 1 行目だけ)
- expression は次から選ぶ: ${expr.names}${expr.described}
- motion は、この体が今できる次の動き(仕草)から、返事の気持ちに合う物を選ぶ(要らなければ none)。1 つの返事で動きを入れるのは 2 文まで、ほかの文は none:
${mo.lines}
- 上に無い動き(踊る・走る・ジャンプなど)を頼まれたら、できるふりをしない。motion は none にして、そのキャラの話し方で「まだできない」と言う(例「まだできないデス」「まだできないよ」)。
- ${gazeText}

# 例${withPlace ? '(目印の名前は、実際に渡されたものを使う)' : ''}
使う人の言葉「こんにちは!」(はじめて会った)
{"type":"say","text":"こんにちは!","expression":"happy","motion":"${mGreet}","gaze":"person","intent":"あいさつ","stage":"greet","handoff":false}
{"type":"say","text":"きょうは、なにをお話しする?","expression":"happy","motion":"none","gaze":"person"}

${withPlace ? place1 : ''}使う人の言葉「かわいいね」
{"type":"say","text":"えへへ、うれしいな。","expression":"happy","motion":"${mShy}","gaze":"away","intent":"ほめ言葉","stage":"chat","handoff":false}

使う人の言葉「あの、ちょっといい?」
{"type":"say","text":"うん、どうしたの。","expression":"happy","motion":"${mAsk}","gaze":"person","intent":"未確認","stage":"need","handoff":false}

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
