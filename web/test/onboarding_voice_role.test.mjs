// 性格の画面の「声」(おまかせ / 男の子 / 女の子。11/7 第 11 波)の試験。画面なし。
// - 選んだ値は、ほかの性格の選びと同じ所(settings.voice.role)に覚える。知らない値は おまかせ
// - 舞台の読み上げ(S3 の Speaker.setVoiceChoice)に、選んだ値とその子の人格の文を渡す。おまかせ = その子の役
// - 読み上げが無い・古い時は止まらない(null)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, loadSettings, normalize, randomSettings, saveSettings, seededRandom, summary } from '../src/ui/persona/settings.js';
import { VOICE_ROLE_ORDER, VOICE_ROLES, applyVoiceRole, normalizeVoiceRole, voiceRoleNote } from '../src/ui/persona/voiceChoice.js';

/** S3 の Speaker.setVoiceChoice と同じ形の偽物。人格の文に「- 声: 男の子」があれば、おまかせは男の子 */
function fakeSpeaker() {
  const calls = [];
  return {
    calls,
    setVoiceChoice(choice, { persona } = {}) {
      calls.push([choice, persona]);
      const own = /-\s*声\s*[::]\s*男の子/u.test(persona ?? '') ? 'male' : 'female';
      return { choice, role: choice === 'auto' ? own : choice, voiceId: 'x'.repeat(20) };
    },
  };
}
const NORRIE = '# ノリー\n- 役どころ: 執事見習い\n- 声: 男の子\n';
const MIKAN = '# みかんちゃん\n- 声: 女の子\n';

test('並びと名前: おまかせ・男の子・女の子', () => {
  assert.deepEqual(VOICE_ROLE_ORDER, ['auto', 'male', 'female']);
  assert.deepEqual(VOICE_ROLE_ORDER.map((k) => VOICE_ROLES[k].label), ['おまかせ', '男の子', '女の子']);
  for (const [raw, want] of [['male', 'male'], ['female', 'female'], ['auto', 'auto'], ['boy', 'auto'], ['', 'auto'], [null, 'auto'], [undefined, 'auto']]) {
    assert.equal(normalizeVoiceRole(raw), want, String(raw));
  }
});

test('覚える: 声の役はほかの選びと同じ所に入り、読み直しても同じ', () => {
  assert.equal(defaults().voice.role, 'auto');
  assert.equal(normalize({ voice: { role: 'male' } }).voice.role, 'male');
  assert.equal(normalize({ voice: { role: '<b>' } }).voice.role, 'auto');
  assert.equal(normalize({ voice: { provider: 'elevenlabs' } }).voice.role, 'auto', '古い保存(役の無い声)は おまかせ');
  assert.equal(randomSettings(seededRandom(7)).voice.role, 'auto', '性格のおまかせは声の役を おまかせ のまま');
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.ok(saveSettings(storage, 'norrie', { ...defaults(), voice: { provider: 'elevenlabs', pitch: 1, rate: 1, role: 'female' } }));
  assert.equal(loadSettings(storage, 'norrie').voice.role, 'female');
  assert.match(summary(loadSettings(storage, 'norrie')), /ElevenLabs の声\(女の子\)$/);
  assert.doesNotMatch(summary(defaults()), /\((おまかせ|男の子|女の子)\)/, 'おまかせの時は、まとめの行を変えない');
});

test('舞台の読み上げに渡す: おまかせ = その子の役、選んだ役はその役。人格の文も渡す', () => {
  const sp = fakeSpeaker();
  assert.deepEqual(applyVoiceRole(sp, 'auto', NORRIE), { choice: 'auto', role: 'male', own: 'male' });
  assert.deepEqual(sp.calls, [['auto', NORRIE]]);
  assert.deepEqual(applyVoiceRole(sp, 'female', NORRIE), { choice: 'female', role: 'female', own: 'male' });
  assert.deepEqual(sp.calls.at(-1), ['female', NORRIE], '最後に渡すのは選んだ値(読み上げに残る)');
  assert.deepEqual(applyVoiceRole(sp, 'male', MIKAN), { choice: 'male', role: 'male', own: 'female' });
  assert.deepEqual(applyVoiceRole(sp, 'zzz', MIKAN), { choice: 'auto', role: 'female', own: 'female' }, '知らない値は おまかせ');
  const before = sp.calls.length;
  applyVoiceRole(sp, 'auto');
  assert.deepEqual(sp.calls.at(-1), ['auto', undefined], '人格の文を省くと、読み上げは前の文のまま');
  assert.equal(sp.calls.length, before + 1);
});

test('読み上げが無い・古い・こわれている時も止まらない', () => {
  assert.equal(applyVoiceRole(null, 'male', NORRIE), null);
  assert.equal(applyVoiceRole({ setVoice() {} }, 'male', NORRIE), null);
  assert.equal(applyVoiceRole({ setVoiceChoice() { throw new Error('x'); } }, 'male', NORRIE), null);
  assert.deepEqual(applyVoiceRole({ setVoiceChoice: () => ({}) }, 'male', NORRIE), { choice: 'male', role: 'male', own: null });
});

test('声の下の一言: 今どちらの声で話すか', () => {
  assert.equal(voiceRoleNote({ choice: 'auto', role: 'male', own: 'male' }), 'おまかせ: この子は男の子の声で話します。');
  assert.equal(voiceRoleNote({ choice: 'female', role: 'female', own: 'male' }), '女の子の声で話します(この子のおまかせは男の子の声)。');
  assert.match(voiceRoleNote(null, 'auto'), /^おまかせ: この子に合う声/);
  assert.match(voiceRoleNote(null, 'male'), /^男の子の声で話します。/);
});
