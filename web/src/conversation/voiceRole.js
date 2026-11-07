// 声の役(男の子・女の子)。どのキャラにも 1 つあり、キャラから自動で決まる。性格の画面で「おまかせ / 男の子 / 女の子」に替えられる
// (11-07 第 11 波。主役ノリーは執事見習いの男の子の役。本人が声の分け方を任せ、司令塔が決めた)。
// サーバー(web/server/tts.mjs・fillers.mjs)と画面(speaker.js・S4 の性格の画面)が同じ決まりで読む小さな部品。DOM も通信も使わない。
// - 役: 選んだ値(男の子・女の子)> 人格の文の「- 声: 男の子」「- 声: 女の子」の行 > 一人称などからの見当 > 女の子
// - 声の id: 人格の文の「- 声の id: <id>」(話す役がその子の役と同じ時だけ)> 役の既定(サーバーは環境変数で替えられる)> ELEVEN_VOICE_ID

export const VOICE_CHOICES = Object.freeze(['auto', 'male', 'female']);
export const VOICE_LABELS = Object.freeze({ auto: 'おまかせ', male: '男の子', female: '女の子' });

/**
 * 役ごとの既定の声(ElevenLabs の声の id。日本語の声)。あいづちの声も、この声で作る。
 * 男の子は、本人がノリーの声に選んだ声(司令室 Q-0103。11-07 に A を選んだ後、「ノリーの声は 4 番目がいい」と言い直した = D)。
 * 替える時は、この表の 1 行と、ノリーの人格の文の「声の id」の行(あいづちの声は、声の id ごとに作り直される)
 */
export const ROLE_DEFAULT_VOICES = Object.freeze({
  male: 'GKDaBI8TKSBJVhsCLD6n', // Asahi(Q-0103 = D。11-07 本人の言い直し)
  female: 'fUjY9K2nAIwlALOwSiwc', // Yui(11-07 までのサーバーの既定と同じ)
});

/** 声のモデル。ノリーの声の候補(11-07)を作ったのと同じモデル */
export const VOICE_MODEL_ID = 'eleven_v4_turbo';

const VOICE_ID = /^[A-Za-z0-9]{8,40}$/;
/** 声の id の形か(英数字 8〜40 字。URL の中に入るので、ほかの文字は通さない) */
export const isVoiceId = (v) => typeof v === 'string' && VOICE_ID.test(v);

const isRole = (v) => v === 'male' || v === 'female';

/** 選んだ値を 3 つのどれかにする。知らない値・空は 'auto'(保存した値を読む時に通す) */
export function normalizeVoiceChoice(value) {
  return VOICE_CHOICES.includes(value) ? value : 'auto';
}

// 画面(S4 の性格の画面)が人格の文の後ろに足す節。その子の役は、この節より前だけで決める
const SETTINGS_HEAD = /^#\s*性格と話し方/u;
const BULLET = '^(?:[-*・]\\s*)?';
const ROLE_LINE = new RegExp(`${BULLET}声\\s*[::]\\s*(男の子|女の子)`, 'u');
const ID_LINE = new RegExp(`${BULLET}声の\\s*id\\s*[::]\\s*([A-Za-z0-9]{8,40})\\s*$`, 'iu');
const FIRST_PERSON = /一人称\s*(?:は|[::])?\s*[「『"]?([^」』"、。,，\s()()]+)/u;
const MALE_PRONOUNS = new Set(['ぼく', 'ボク', '僕', 'おれ', 'オレ', '俺', 'わし', 'ワシ', 'おいら', 'オイラ', '拙者', 'わい', 'ワイ']);
const FEMALE_PRONOUNS = new Set(['わたし', 'ワタシ', 'あたし', 'アタシ', 'うち', 'ウチ', 'あたい', 'わらわ']);
// 役どころの言葉。見るのは、見出し・役どころなどの行・最初の説明の行だけ(好きなことの行の「お姫さまごっこ」などで決めない)
const ROLE_KEY_LINE = new RegExp(`${BULLET}(役どころ|役|生まれ|仕事|職業|立場|正体)\\s*[::]`, 'u');
const MALE_ROLE_WORDS = /(執事|王子|少年|男の子|お兄さん|おにいさん|おじいさん|おじさん|王様|王さま|紳士|侍)/u;
const FEMALE_ROLE_WORDS = /(メイド|王女|お姫|姫さま|少女|女の子|お姉さん|おねえさん|おばあさん|おばさん|女王|魔女|淑女)/u;

/** 人格の文のうち、その子の物(画面が足した節より前)。行の頭と終わりの空白は外す。CRLF・CR でもよい */
function ownLines(persona) {
  const lines = String(persona ?? '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim());
  const end = lines.findIndex((l) => SETTINGS_HEAD.test(l));
  return end < 0 ? lines : lines.slice(0, end);
}

/** 一人称の言葉から(男の子・女の子・決めない)。わたくし・私・自分・名前(ノリー など)は決めない */
function roleFromPronoun(lines) {
  for (const l of lines) {
    const m = FIRST_PERSON.exec(l);
    if (!m) continue;
    if (MALE_PRONOUNS.has(m[1])) return 'male';
    if (FEMALE_PRONOUNS.has(m[1])) return 'female';
    return null;
  }
  return null;
}

const TITLE = /^#(?!#)\s*\S/u; // 1 段目の見出し(その子の名前)

/** 役どころの言葉から。見るのは見出し・最初の説明の行(「##」の節より前)・役どころなどの行。両方の言葉がある時は決めない */
function roleFromWords(lines) {
  const heading = lines.find((l) => TITLE.test(l)) ?? '';
  const firstSection = lines.findIndex((l) => /^##/.test(l));
  const head = firstSection < 0 ? lines : lines.slice(0, firstSection);
  const description = head.find((l) => l && !/^#/.test(l) && !/^[-*・]/.test(l)) ?? '';
  const text = [heading, description, ...lines.filter((l) => ROLE_KEY_LINE.test(l))].join('\n');
  const male = MALE_ROLE_WORDS.test(text);
  const female = FEMALE_ROLE_WORDS.test(text);
  if (male !== female) return male ? 'male' : 'female';
  return null;
}

/** 見出しの名前の終わり(〜くん → 男の子、〜ちゃん → 女の子) */
function roleFromName(lines) {
  const heading = lines.find((l) => TITLE.test(l));
  if (!heading) return null;
  const name = heading.replace(/^#+\s*/, '').replace(/[((].*$/u, '').trim();
  if (/(くん|君|クン)$/u.test(name)) return 'male';
  if (/(ちゃん|チャン)$/u.test(name)) return 'female';
  return null;
}

/**
 * 人格の文に書いてある、その子の声。
 * @param {string} persona persona.md の文(画面が足した「# 性格と話し方」の節が後ろにあってもよい)
 * @returns {{role: 'male'|'female', source: 'line'|'guess'|'default', voiceId: string|null}}
 *   source: line = 「- 声: 」の行、guess = 一人称・役どころ・名前からの見当、default = どれも無い(女の子)
 */
export function personaVoice(persona) {
  const lines = ownLines(persona);
  const idLine = lines.map((l) => ID_LINE.exec(l)).find(Boolean);
  const voiceId = idLine && isVoiceId(idLine[1]) ? idLine[1] : null;
  const roleLine = lines.map((l) => ROLE_LINE.exec(l)).find(Boolean);
  if (roleLine) return { role: roleLine[1] === '男の子' ? 'male' : 'female', source: 'line', voiceId };
  const guess = roleFromPronoun(lines) ?? roleFromWords(lines) ?? roleFromName(lines);
  if (guess) return { role: guess, source: 'guess', voiceId };
  return { role: 'female', source: 'default', voiceId };
}

/** その子の「おまかせ」の役('male' | 'female')。性格の画面に「おまかせ(男の子)」と出す時に使う */
export function voiceRoleOf(persona) {
  return personaVoice(persona).role;
}

/**
 * 話す声を決める。
 * @param {object} o
 * @param {string} [o.choice] 性格の画面で選んだ値('auto' | 'male' | 'female')
 * @param {string} [o.persona] その子の人格の文
 * @param {string|null} [o.ownVoiceId] その子の声の id(人格の文に「声の id」が無い時だけ使う。キャラの設計図の声など)
 * @param {{male?: string, female?: string}} [o.defaults] 役の既定(サーバーの環境変数)。無い・形が違う時は ROLE_DEFAULT_VOICES
 * @param {string} [o.fallback] 最後の控え(サーバーの ELEVEN_VOICE_ID)
 * @returns {{choice: string, role: 'male'|'female', source: string, voiceId: string, ownVoiceId: string|null}}
 *   ownVoiceId: その子自身の声を使う時の id(使わない時は null。サーバーへ送るのはこれだけ)
 */
export function resolveVoice({ choice = 'auto', persona = '', ownVoiceId = null, defaults = {}, fallback = '' } = {}) {
  const own = personaVoice(persona);
  const c = normalizeVoiceChoice(choice);
  const role = c === 'auto' ? own.role : c;
  const ownId = own.voiceId ?? (isVoiceId(ownVoiceId) ? ownVoiceId : null);
  // その子の声は、その子の役で話す時だけ(ノリーに「女の子」を選んだら、ノリーの男の子の声は使わない)
  const usesOwn = Boolean(ownId) && role === own.role;
  const voiceId = [usesOwn ? ownId : null, defaults?.[role], ROLE_DEFAULT_VOICES[role], fallback].find(isVoiceId);
  return { choice: c, role, source: c === 'auto' ? own.source : 'choice', voiceId, ownVoiceId: usesOwn ? ownId : null };
}

/**
 * 性格の画面(S4)が呼ぶ口: 声の選び方を、舞台の読み上げ(speaker)に渡す。
 * speaker に setVoiceChoice が無い(古い・試しの偽物)時も、決まりどおりに計算した同じ形を返す(止まらない)。
 * @param {{setVoiceChoice?: Function}|null|undefined} speaker app.speaker
 * @param {string} choice 'auto' | 'male' | 'female'(ほかの値は 'auto')
 * @param {{persona?: string}} [o] その子の人格の文。省くと、speaker が前に受け取った文のまま
 * @returns {{choice: string, role: 'male'|'female', voiceId: string}}
 */
export function applyVoiceChoice(speaker, choice, { persona } = {}) {
  const c = normalizeVoiceChoice(choice);
  if (typeof speaker?.setVoiceChoice === 'function') {
    const r = speaker.setVoiceChoice(c, persona === undefined ? {} : { persona });
    if (r && isRole(r.role)) return { choice: c, role: r.role, voiceId: r.voiceId };
  }
  const r = resolveVoice({ choice: c, persona: persona ?? '' });
  return { choice: c, role: r.role, voiceId: r.voiceId };
}
