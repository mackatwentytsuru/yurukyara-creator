// 性格の画面の「声」(おまかせ / 男の子 / 女の子)。どのキャラにも声の役(男の子・女の子)があり、キャラから自動で決まる(おまかせ)。
// 主役ノリーは執事見習いの男の子の役(11/7 本人。声の分け方は司令塔の決め)。
// 役の決まり(人格の文の「- 声: 男の子」の行 → 一人称などの見当 → 女の子)と、どの声で話すかは、会話の流れ(S3)の
// conversation/voiceRole.js と舞台の読み上げ(app.speaker.setVoiceChoice)が持つ。ここは呼ぶだけの小さな仲立ち。
// S3 の部品は import しない(S4 の線だけでも組み立てと試験が通るように)。約束: board の work\S3\voice_api_w11.md(S3 の applyVoiceChoice と同じ呼び方)

export const VOICE_ROLE_ORDER = ['auto', 'male', 'female'];
export const VOICE_ROLES = {
  auto: { label: 'おまかせ', hint: 'この子に合う声' },
  male: { label: '男の子', hint: '男の子の声' },
  female: { label: '女の子', hint: '女の子の声' },
};
const ROLE_WORD = { male: '男の子', female: '女の子' };

/** 選んだ値を 3 つのどれかにする。知らない値・空は 'auto'(保存した値を読む時に通す) */
export function normalizeVoiceRole(value) {
  return VOICE_ROLE_ORDER.includes(value) ? value : 'auto';
}

/**
 * 舞台の読み上げ(S3 の Speaker)に、声の役を渡す。
 * @param {{setVoiceChoice?: Function}|null|undefined} speaker app.speaker
 * @param {string} choice 'auto' | 'male' | 'female'
 * @param {string} [persona] その子の人格の文(persona.md の文。おまかせの役はここから決まる)。省くと読み上げが前に受けた文のまま
 * @returns {{choice: string, role: 'male'|'female'|null, own: 'male'|'female'|null}|null} own はその子のおまかせの役。
 *   読み上げが無い・古い(setVoiceChoice が無い)時は null(画面は止まらない)
 */
export function applyVoiceRole(speaker, choice, persona) {
  const c = normalizeVoiceRole(choice);
  if (typeof speaker?.setVoiceChoice !== 'function') return null;
  const opts = typeof persona === 'string' ? { persona } : {};
  try {
    const own = speaker.setVoiceChoice('auto', opts)?.role ?? null; // その子のおまかせの役(画面の「おまかせ(男の子)」)
    const role = c === 'auto' ? own : (speaker.setVoiceChoice(c, opts)?.role ?? c);
    return { choice: c, role: ROLE_WORD[role] ? role : null, own: ROLE_WORD[own] ? own : null };
  } catch {
    return null;
  }
}

/** 性格の画面の「声」の下の一言(今どちらの声で話すか) */
export function voiceRoleNote(result, choice = 'auto', provider = 'elevenlabs') {
  const base = roleNoteBase(result, choice);
  // 文字とレトロ音の間は、男の子・女の子を選んでも声は変わらない(鍵なしでは聞こえ方が同じ。CRITux3 低 2)
  return provider === 'none' ? `${base} いまは「文字とレトロ音」なので、声は変わりません(ElevenLabs かこの端末の声の時に使います)。` : base;
}

function roleNoteBase(result, choice) {
  const c = normalizeVoiceRole(result?.choice ?? choice);
  if (!result?.own) {
    return c === 'auto' ? 'おまかせ: この子に合う声(男の子か女の子)で話します。声は ElevenLabs の声の時に使います。' : `${ROLE_WORD[c]}の声で話します。声は ElevenLabs の声の時に使います。`;
  }
  if (c === 'auto') return `おまかせ: この子は${ROLE_WORD[result.own]}の声で話します。`;
  return `${ROLE_WORD[result.role ?? c]}の声で話します(この子のおまかせは${ROLE_WORD[result.own]}の声)。`;
}
