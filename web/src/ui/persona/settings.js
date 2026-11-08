// 性格の設定(画面で選ぶ物)と、Claude に渡す人格の文。DOM を使わない純粋な関数だけ(node の試験で確かめる)。
// 最初の設計の決め: 初めの性格はランダム。性格・口調・元気さ・返事の長さ・声を画面から変えられる。
// 安全の決まりは別の層(web/server/safety.mjs)。ここで作る文は、安全の決まりより下に置かれる(prompt.mjs)。
// 声の役(voice.role: おまかせ・男の子・女の子。11/7 第 11 波)は、ほかの選びと同じ所に覚える。役の決まりは S3(voiceChoice.js)
// 人格の文で話し方が決まっている子(主役ノリーなど)は、おまかせで口調を「この子の話し方」(own)にし、語尾も口調も足さない。

// v2(11/7): 口調に own を足した。v1 のおまかせは、話し方の決まった主役にも語尾を付けていた(「ノリーと申しマスぽよ」)。
// v1 で覚えた設定は読まない(覚える場所の名前を替えた)。次に開いた時、v2 のおまかせで選び直す
import { VOICE_ROLES, normalizeVoiceRole } from './voiceChoice.js';

import { DEFAULT_ROLE, PLACE_MAX, ROLE_LABELS, normalizeRole, placeLine } from '../onboarding/roles.js';
import { DEFAULT_LANG_MODE, normalizeLangMode } from '../../conversation/lang.js'; // ML1: ことば(日本語だけ・多言語)
import { clipFactsText } from '../../conversation/facts.js'; // ML1: お店のきまり・お知らせ(その端末の欄)
import { READINGS_LINE, normalizeReadings, readingsText } from '../../conversation/readings.js'; // 名前の読み方(11-08 b13-yomi)
export const SETTINGS_VERSION = 2;
export const STORE_PREFIX = 'yc.persona.v2.'; // + キャラの id(この端末の中だけ)

/** 性格の型。lead は仮の頭脳の試しで最初の文の前に付ける一言、extra は「長め」のときに足す 1 文 */
export const PRESETS = {
  calm: {
    label: 'おっとり',
    short: 'おっとりさん',
    text: 'のんびり、やわらかく話す。あわてず、ゆっくり考えてから答える。',
    energy: 2,
    lead: ['えっとね、', 'ふわぁ、'],
    extra: { friendly: 'ゆっくりでいいからね。', polite: 'ゆっくりで大丈夫ですよ。' },
  },
  genki: {
    label: '元気',
    short: '元気いっぱい',
    text: '明るく、はずむように話す。うれしい気持ちを、はっきり出す。',
    energy: 5,
    lead: ['わあ、', 'やった、'],
    extra: { friendly: 'いっしょに遊ぼう。', polite: 'いっしょに遊びましょう。' },
  },
  mischief: {
    label: 'いたずら好き',
    short: 'いたずら好き',
    text: 'ちょっといたずらっぽく、楽しい冗談を言う。でも、相手をからかいすぎない。',
    energy: 4,
    lead: ['へへ、', 'ふふん、'],
    extra: { friendly: 'なにか、おもしろいことないかな?', polite: 'なにか、おもしろいことはありませんか?' },
  },
  shy: {
    label: '恥ずかしがり屋',
    short: '恥ずかしがり屋',
    text: 'はじめは少し照れて、ことばが短め。うちとけると、うれしそうに話す。',
    energy: 2,
    lead: ['あ、あの…', 'えっと…'],
    extra: { friendly: 'ちょっと、どきどきするね。', polite: 'ちょっと、どきどきします。' },
  },
};
export const PRESET_ORDER = ['calm', 'genki', 'mischief', 'shy'];

export const TONES = {
  own: { label: 'この子の話し方', hint: '人格の文のまま' },
  friendly: { label: 'フレンドリー', hint: '「〜だよ」「〜だね」' },
  polite: { label: 'ていねい', hint: '「〜です」「〜ます」' },
  ending: { label: '独特の語尾', hint: '文の終わりに決まった音' },
};
export const TONE_ORDER = ['own', 'friendly', 'polite', 'ending'];
/** おまかせで選ぶ語尾(どの文の終わりに付けても読める音だけ)。話し方の決まった子には選ばない */
export const ENDINGS = ['にゃ', 'ぽよ', 'ぴょん'];
export const ENDING_MAX = 4;

// 人格の文で「話し方」が決まっている印: 行の頭(「- 」や見出しの「#」の後)が、話し方・口調・語尾・一人称・口ぐせ
const OWN_SPEECH = /^(?:[-*・]\s*|#{1,6}\s*)?(?:話し方|口調|語尾|一人称|口ぐせ|口癖)/u;
// 画面が人格の文の後ろに足す設定の節(composePersona)。ここから後ろは、その子の話し方として数えない
const SETTINGS_HEAD = /^#\s*性格と話し方/u;

/**
 * 人格の文(persona.md)に、その子の話し方が書いてあるか(「- 話し方: …」「- 一人称は…」「## 話し方の例」など)。
 * 画面が後ろに足した設定の節は見ない。
 * @param {string} persona
 */
export function definesOwnSpeech(persona) {
  const lines = String(persona ?? '').split(/\r?\n/).map((l) => l.trim());
  const end = lines.findIndex((l) => SETTINGS_HEAD.test(l));
  return (end < 0 ? lines : lines.slice(0, end)).some((l) => OWN_SPEECH.test(l));
}

/**
 * その子の話し方が決まっているか(おまかせで、語尾と口調を足さない子か)。
 * 人格の文に書いてあるか、主役(mainId)か。主役は人格の文がまだ届いていない時(読み込みの途中・404)も、決まっているとみなす。
 * @param {string|null|undefined} id
 * @param {{persona?: string, mainId?: string|null}} [o]
 */
export function ownSpeechFor(id, { persona = '', mainId = null } = {}) {
  if (!id) return false;
  return definesOwnSpeech(persona) || (Boolean(mainId) && id === mainId);
}

export const ENERGY_LABELS = { 1: 'とても静か', 2: 'ひかえめ', 3: 'ふつう', 4: '元気', 5: 'とても元気' };

export const LENGTHS = {
  short: { label: '短め', text: '短め(1〜2 文)' },
  normal: { label: 'ふつう', text: 'ふつう(2〜3 文)' },
  long: { label: '長め', text: '長め(3 文。少しくわしく)' },
};
export const LENGTH_ORDER = ['short', 'normal', 'long'];

/** 声の出し方。キャラの設計図(K1)の voice.provider と同じ名前 */
export const VOICES = {
  none: { label: '文字とレトロ音', hint: '鍵なし・無料。文字送りと効果音' },
  browser: { label: 'この端末の声', hint: '無料。声は端末やブラウザで変わる' },
  elevenlabs: { label: 'ElevenLabs の声', hint: 'きれいな声。おうちの人の じゅんびが いるよ' },
};
export const VOICE_ORDER = ['none', 'browser', 'elevenlabs'];
/** 声の高さと速さ(K1 の voice.pitch・voice.rate は 0.5〜2.0 の数) */
export const PITCHES = { low: { label: '低め', value: 0.8 }, mid: { label: 'ふつう', value: 1.0 }, high: { label: '高め', value: 1.25 } };
export const RATES = { slow: { label: 'ゆっくり', value: 0.85 }, mid: { label: 'ふつう', value: 1.0 }, fast: { label: 'はやめ', value: 1.2 } };

// 語尾に入れさせない言葉(恋人役の言い回しなど。安全の層でも落とすが、画面でも先に止める)
const ENDING_BLOCK = /(こいびと|コイビト|かのじょ|カノジョ|かれし|カレシ|あいしてる|アイシテル|すきすき)/;

/** 何度呼んでも同じ並びになる乱数(試験とおまかせの再現のため) */
export function seededRandom(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (list, rnd) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
const clampInt = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const nearest = (table, value, d) => {
  const v = Number(value);
  if (!Number.isFinite(v)) return table[d].value;
  let best = d;
  for (const k of Object.keys(table)) if (Math.abs(table[k].value - v) < Math.abs(table[best].value - v)) best = k;
  return table[best].value;
};

/** 語尾の文字を確かめる。ひらがな・カタカナ・のばす記号だけ、4 字まで。だめなら null */
export function cleanEnding(raw) {
  const s = String(raw ?? '')
    .normalize('NFKC')
    .replace(/[~～]/g, '〜')
    .replace(/\s+/g, '');
  if (!s || [...s].length > ENDING_MAX) return null;
  if (!/^[ぁ-ゖァ-ヺー〜]+$/u.test(s)) return null;
  if (ENDING_BLOCK.test(s)) return null;
  return s;
}

export function defaults() {
  return { v: SETTINGS_VERSION, preset: 'calm', tone: 'friendly', ending: '', energy: PRESETS.calm.energy, length: 'normal', voice: { provider: 'none', pitch: 1.0, rate: 1.0, role: 'auto' }, role: DEFAULT_ROLE, lang: DEFAULT_LANG_MODE };
}

/** 足りない欄を埋め、知らない値を直した、新しい設定を返す(元は変えない) */
export function normalize(input) {
  const d = defaults();
  const s = input && typeof input === 'object' ? input : {};
  const preset = PRESETS[s.preset] ? s.preset : d.preset;
  let tone = TONES[s.tone] ? s.tone : d.tone;
  let ending = tone === 'ending' ? cleanEnding(s.ending) : '';
  if (tone === 'ending' && !ending) {
    tone = 'friendly';
    ending = '';
  }
  const v = s.voice && typeof s.voice === 'object' ? s.voice : {};
  return {
    v: SETTINGS_VERSION,
    preset,
    tone,
    ending,
    energy: clampInt(s.energy, 1, 5, PRESETS[preset].energy),
    length: LENGTHS[s.length] ? s.length : d.length,
    voice: {
      provider: VOICES[v.provider] ? v.provider : 'none',
      pitch: nearest(PITCHES, v.pitch, 'mid'),
      rate: nearest(RATES, v.rate, 'mid'),
      role: normalizeVoiceRole(v.role), // 声の役(おまかせ = その子の役)。知らない値は おまかせ
    },
    // 役目(この子は、どこで だれと。B4 12b)。知らない値は おうち。お店・駅は置く場所の名前と案内することを残す(30 字まで)
    role: normalizeRole(s.role),
    // ことば(ML1): 日本語だけ(既定)・多言語。知らない値は日本語だけ
    lang: normalizeLangMode(s.lang) ?? DEFAULT_LANG_MODE,
    // お店のきまり・お知らせ(ML1。お店・駅や町・学校や施設の時に、日本語で書く欄。その端末だけ。1000 字まで)。空なら欄ごと付けない
    ...(clipFactsText(s.facts).trim() ? { facts: clipFactsText(s.facts) } : {}),
    ...(placeLine(s.place) ? { place: { name: clipPlace(s.place?.name), about: clipPlace(s.place?.about) } } : {}),
    // 名前の読み方(11-08 b13-yomi。お店・駅の名前・その子の名前の漢字・英字を、声が正しく読むための { 字: かな })。空なら欄ごと付けない
    ...(Object.keys(normalizeReadings(s.readings)).length ? { readings: normalizeReadings(s.readings) } : {}),
  };
}
const clipPlace = (v) => [...String(v ?? '').trim()].slice(0, PLACE_MAX).join('');

/**
 * おまかせ(初めの性格)。rnd は 0〜1 を返す関数。声の出し方は選ばない(鍵が要るので、使う人が決める)。
 * ownSpeech: 人格の文で話し方が決まっている子(ownSpeechFor)。口調はいつも own(この子の話し方)で、語尾は付けない。
 *   型・元気さ・長さ・声の高さは、ほかの子と同じに選ぶ(同じ種なら、口調のほかは ownSpeech が無い時と同じ)。
 */
export function randomSettings(rnd = Math.random, { voice = 'none', ownSpeech = false } = {}) {
  const preset = pick(PRESET_ORDER, rnd);
  const r = rnd(); // ownSpeech の時も引く(ほかの欄の並びを変えない)
  const tone = ownSpeech ? 'own' : r < 0.5 ? 'friendly' : r < 0.75 ? 'polite' : 'ending';
  const energy = clampInt(PRESETS[preset].energy + pick([-1, 0, 0, 1], rnd), 1, 5, 3);
  const length = pick(['short', 'normal', 'normal', 'long'], rnd);
  const pitch = pick(Object.keys(PITCHES), rnd);
  return normalize({
    preset,
    tone,
    ending: tone === 'ending' ? pick(ENDINGS, rnd) : '',
    energy,
    length,
    voice: { provider: voice, pitch: PITCHES[pitch].value, rate: 1.0 },
  });
}

// 話し方を手本の文で決めている印(「## 話し方の例」の節)。この子の口調は、性格の画面で変えさせない(D6)
const SPEECH_EXAMPLES = /^#{1,6}\s*話し方の例/u;

/**
 * その子の話し方が、人格の文で「決まっている」(変えると別の子になる)か。主役(mainId)と、話し方の手本の節がある子。
 * 作例の「- 話し方: やさしく」のような説明だけの子は、使う人が口調を選べる(おまかせは own のまま。definesOwnSpeech)
 * @param {string|null|undefined} id
 * @param {{persona?: string, mainId?: string|null}} [o]
 */
export function fixesOwnSpeech(id, { persona = '', mainId = null } = {}) {
  if (!id) return false;
  if (mainId && id === mainId) return true;
  const lines = String(persona ?? '').split(/\r?\n/).map((l) => l.trim());
  const end = lines.findIndex((l) => SETTINGS_HEAD.test(l));
  return (end < 0 ? lines : lines.slice(0, end)).some((l) => SPEECH_EXAMPLES.test(l));
}

// 人格の文から性格の型を読む言葉(「- 性格:」の行を先に見て、無ければ文の全体。上から順に見る)
const PERSONALITY_WORDS = [
  ['shy', /恥ずかしがり|はずかしがり|照れ屋|てれや|人見知り|ひとみしり/u],
  ['mischief', /いたずら|イタズラ/u],
  ['genki', /元気|げんき|明るく|あかるく|はずむ|にぎやか/u],
  ['calm', /おっとり|のんびり|ぽやぽや|ゆっくり|やさし|おだやか|落ち着/u],
];
const PERSONALITY_LINE = /^(?:[-*・]\s*)?性格\s*[::]/u;

/**
 * 人格の文(persona.md)に書いてある性格の型(PRESETS の名前)。書いていなければ null。画面が足した設定の節は見ない。
 * @param {string} persona
 */
export function personalityOf(persona) {
  const lines = String(persona ?? '').split(/\r?\n/).map((l) => l.trim());
  const end = lines.findIndex((l) => SETTINGS_HEAD.test(l));
  const own = end < 0 ? lines : lines.slice(0, end);
  const find = (text) => PERSONALITY_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
  const line = own.find((l) => PERSONALITY_LINE.test(l));
  return (line && find(line)) || find(own.join('\n'));
}

/**
 * その子「本来の」設定(性格の画面を開いた時・初めての会話の 4 歩目の初め。くじ引きにしない。司令塔の決め D6)。
 * 型は人格の文の性格(無ければ fallback)、口調は話し方の決まった子なら own、ほかはフレンドリー。長さはふつう、声は文字とレトロ音。
 * @param {string} persona
 * @param {{ownSpeech?: boolean, fallback?: string|null}} [o] fallback: 性格が書いていない時の型(null なら null を返す)
 * @returns {object|null}
 */
export function ownSettings(persona, { ownSpeech = false, fallback = 'calm' } = {}) {
  const preset = personalityOf(persona) ?? fallback;
  if (!preset || !PRESETS[preset]) return null;
  return normalize({ preset, tone: ownSpeech ? 'own' : 'friendly', energy: PRESETS[preset].energy, length: 'normal' });
}

/** 型を選んだとき: 性格と、その型の元気さにそろえる(口調・長さ・声はそのまま) */
export function applyPreset(settings, preset) {
  const s = normalize(settings);
  if (!PRESETS[preset]) return s;
  return normalize({ ...s, preset, energy: PRESETS[preset].energy });
}

const labelOf = (table, value) => Object.values(table).find((x) => x.value === value)?.label ?? 'ふつう';

/** 画面に出す短いまとめ(1 行) */
export function summary(settings) {
  const s = normalize(settings);
  const tone = s.tone === 'ending' ? `語尾「${s.ending}」` : TONES[s.tone].label;
  const role = s.voice.role === 'auto' ? '' : `(${VOICE_ROLES[s.voice.role].label})`;
  return `${PRESETS[s.preset].label}・${tone}・元気さ ${s.energy}・${LENGTHS[s.length].label}・${VOICES[s.voice.provider].label}${role}`;
}

/** Claude に渡す人格の文(設定の部分)。固定の文と、確かめた語尾だけで作る */
export function personaBlock(settings) {
  const s = normalize(settings);
  const p = PRESETS[s.preset];
  const tone =
    s.tone === 'own'
      ? '上の人格の文に書いてある話し方のまま。一人称・文の終わり・言い回しを変えない。'
      : s.tone === 'polite'
        ? 'ていねい。「〜です」「〜ます」で話す。'
        : s.tone === 'ending'
          ? `文の終わりに「${s.ending}」を付けて話す(例: こんにちは${s.ending})。`
          : 'フレンドリー。「〜だよ」「〜だね」と、友だちのように話す。';
  return [
    // 見出しに「安全の決まり」と書くと、安全の層(sanitizePersona)が上書きの企てとして行ごと消す。書かない
    '# 性格と話し方(使う人が画面で選んだ設定。上の人格の文と違うときは、こちらを使う)',
    `- 性格: ${p.label}。${p.text}`,
    `- 口調: ${tone}`,
    `- 元気さ: 5 段階の ${s.energy}(${ENERGY_LABELS[s.energy]})。1 はとても静か、5 はとても元気。`,
    `- 返事の長さ: ${LENGTHS[s.length].text}。`,
    // 役目の行(会話の側 B3 がこの 1 行を読む。言葉は roles.js の ROLE_LABELS)。置く場所はお店・駅などで書いた時だけ
    `- 役目: ${ROLE_LABELS[s.role]}`,
    ...(s.place ? [`- 置く場所: ${placeLine(s.place)}`] : []),
    // 名前の読み方の行(声に渡す文だけが、この読みになる。画面の字幕と、文に書く字は、もとの字のまま。声の側は readings.js の readingsFromPersona がこの行を読む)
    ...(s.readings ? [`- ${READINGS_LINE}: ${readingsText(s.readings)}(声は この読みで 読む。文に書く時は、もとの字のまま)`] : []),
    // ことばの行(ML1。多言語の時だけ。日本語だけの時は、今までと同じで 1 行も足さない)。会話の側は lang.js の langModeFromPersona がこの行を読む
    ...(s.lang === 'multi' ? ['- ことば: 多言語(使う人の言葉に合わせて、日本語・English・中文・한국어で話す)'] : []),
  ].join('\n');
}

export const PERSONA_MAX = 6000; // サーバーの受け取りの上限(web/server/validate.mjs)と同じ

/** もとの人格(persona.md)に、設定の文を足す。長すぎるときは、もとの文の方を切る */
export function composePersona(base, settings) {
  const block = personaBlock(settings);
  const head = String(base ?? '').trim();
  if (!head) return block;
  const room = PERSONA_MAX - block.length - 2;
  return `${head.slice(0, Math.max(0, room))}\n\n${block}`;
}

/** 声の高さ・速さの今の名前(画面の押しボタン用) */
export const pitchKey = (s) => Object.keys(PITCHES).find((k) => PITCHES[k].value === normalize(s).voice.pitch) ?? 'mid';
export const rateKey = (s) => Object.keys(RATES).find((k) => RATES[k].value === normalize(s).voice.rate) ?? 'mid';
export const pitchLabel = (s) => labelOf(PITCHES, normalize(s).voice.pitch);

/** この端末に覚えた設定を読む・書く。保存が使えない端末(内緒のウインドウなど)でも止まらない */
export function loadSettings(storage, id) {
  try {
    const raw = storage?.getItem(STORE_PREFIX + id);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export function saveSettings(storage, id, settings) {
  try {
    storage?.setItem(STORE_PREFIX + id, JSON.stringify(normalize(settings)));
    return true;
  } catch {
    return false;
  }
}
