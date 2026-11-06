// 動きの意図(契約 K2)を、CharacterBase の呼び方に流す「受け手」の S2 側の仮の版。
// K2 の正本は S5 の web/src/character/intent.js(金 20:00 に固める)。それが出来たら、そちらを使う。
// この版は、K2 の下書き(d_streams 4 章)の形だけを前提にする:
//   { emotion: 7 つのどれか, intensity: 0〜1, gesture: 動きの名前|none, gaze: 'user'|'away'|{x,y,z}|[x,y,z]|null, mouth: 0〜1 }
// 知らない名前は近い物へ落とすのは、キャラの側(setExpression・play)の仕事。ここは形をそろえるだけ。

const clamp01 = (v, d) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

/** 意図の形をそろえる。足りない欄は既定の値にする(例外は出さない) */
export function normalizeIntent(intent = {}) {
  const i = intent && typeof intent === 'object' ? intent : {};
  return {
    emotion: typeof i.emotion === 'string' && i.emotion ? i.emotion : 'neutral',
    intensity: clamp01(i.intensity, 1),
    gesture: typeof i.gesture === 'string' && i.gesture ? i.gesture : 'none',
    gaze: i.gaze ?? null,
    mouth: clamp01(i.mouth, 0),
  };
}

/**
 * 意図を 1 つ、キャラに流す。返り値は、実際に何が起きたか(試験と記録用)。
 * @param {import('../character/characterBase.js').CharacterBase} character
 * @param {object} intent
 * @param {{userPosition?: number[]}} ctx 'user' を見るときの相手の位置(ワールド座標)
 */
export function applyIntent(character, intent, ctx = {}) {
  const n = normalizeIntent(intent);
  character.setEmotion(n.emotion, n.intensity);
  character.setMouth(n.mouth);
  let played = false;
  if (n.gesture !== 'none') played = character.play(n.gesture);
  if (n.gaze === 'user') character.lookAt(ctx.userPosition ?? [0, 1.4, 2]);
  else if (n.gaze === 'away' || n.gaze === null) character.lookAt(null);
  else if (Array.isArray(n.gaze)) character.lookAt(n.gaze);
  else if (typeof n.gaze === 'object') character.lookAt([n.gaze.x ?? 0, n.gaze.y ?? 1.4, n.gaze.z ?? 2]);
  return { ...n, played };
}
