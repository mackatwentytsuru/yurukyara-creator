// 性格の設定(画面で選ぶ物)と、Claude に渡す人格の文。DOM を使わない純粋な関数だけ(node の試験で確かめる)。
// 最初の設計の決め: 初めの性格はランダム。性格・口調・元気さ・返事の長さ・声を画面から変えられる。
// 安全の決まりは別の層(web/server/safety.mjs)。ここで作る文は、安全の決まりより下に置かれる(prompt.mjs)。

export const SETTINGS_VERSION = 1;
export const STORE_PREFIX = 'yc.persona.v1.'; // + キャラの id(この端末の中だけ)

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
  friendly: { label: 'フレンドリー', hint: '「〜だよ」「〜だね」' },
  polite: { label: 'ていねい', hint: '「〜です」「〜ます」' },
  ending: { label: '独特の語尾', hint: '文の終わりに決まった音' },
};
export const TONE_ORDER = ['friendly', 'polite', 'ending'];
/** おまかせで選ぶ語尾(どの文の終わりに付けても読める音だけ) */
export const ENDINGS = ['にゃ', 'ぽよ', 'ぴょん'];
export const ENDING_MAX = 4;

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
  elevenlabs: { label: 'ElevenLabs の声', hint: '鍵が要る。使った分の料金がかかる' },
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
  return { v: SETTINGS_VERSION, preset: 'calm', tone: 'friendly', ending: '', energy: PRESETS.calm.energy, length: 'normal', voice: { provider: 'none', pitch: 1.0, rate: 1.0 } };
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
    },
  };
}

/** おまかせ(初めの性格)。rnd は 0〜1 を返す関数。声の出し方は選ばない(鍵が要るので、使う人が決める) */
export function randomSettings(rnd = Math.random, { voice = 'none' } = {}) {
  const preset = pick(PRESET_ORDER, rnd);
  const r = rnd();
  const tone = r < 0.5 ? 'friendly' : r < 0.75 ? 'polite' : 'ending';
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
  return `${PRESETS[s.preset].label}・${tone}・元気さ ${s.energy}・${LENGTHS[s.length].label}・${VOICES[s.voice.provider].label}`;
}

/** Claude に渡す人格の文(設定の部分)。固定の文と、確かめた語尾だけで作る */
export function personaBlock(settings) {
  const s = normalize(settings);
  const p = PRESETS[s.preset];
  const tone =
    s.tone === 'polite'
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
