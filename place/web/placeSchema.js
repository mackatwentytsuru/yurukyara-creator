// place.json の読み取りと検査。three.js に依存しない(node でそのまま試せる)。
// 形は docs/共通の決まり.md の「場所の渡し方」のとおり。

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);

export class PlaceFormatError extends Error {
  constructor(problems) {
    super(`place.json の形がおかしい:\n- ${problems.join('\n- ')}`);
    this.name = 'PlaceFormatError';
    this.problems = problems;
  }
}

/**
 * place.json の中身(読み込んだ JSON)を検査して、足りない値を補った新しい物を返す。
 * 元の物は書きかえない。
 */
export function parsePlaceJson(raw) {
  const problems = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PlaceFormatError(['中身がオブジェクトではない']);
  }

  if (typeof raw.id !== 'string' || raw.id === '') problems.push('id が文字列ではない');
  if (typeof raw.model !== 'string' || raw.model === '') problems.push('model(GLB のファイル名)がない');

  const scale = raw.scale_m ?? 1;
  if (!isNum(scale) || scale <= 0) problems.push('scale_m は 0 より大きい数');

  const floorY = raw.floor_y ?? 0;
  if (!isNum(floorY)) problems.push('floor_y は数');

  const spawnRaw = raw.spawn ?? { position: [0, 0, 0], yaw_deg: 0 };
  if (!isVec3(spawnRaw.position)) problems.push('spawn.position は [x, y, z] の数');
  if (!isNum(spawnRaw.yaw_deg ?? 0)) problems.push('spawn.yaw_deg は数');

  const landmarksRaw = raw.landmarks ?? [];
  if (!Array.isArray(landmarksRaw)) {
    problems.push('landmarks は配列');
  } else {
    landmarksRaw.forEach((lm, i) => {
      if (typeof lm?.name !== 'string' || lm.name === '') problems.push(`landmarks[${i}].name がない`);
      if (!isVec3(lm?.position)) problems.push(`landmarks[${i}].position は [x, y, z] の数`);
    });
    const names = landmarksRaw.map((lm) => lm?.name);
    const dup = names.find((n, i) => n && names.indexOf(n) !== i);
    if (dup) problems.push(`landmarks の名前がかぶっている: ${dup}`);
  }

  if (problems.length > 0) throw new PlaceFormatError(problems);

  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : raw.id,
    model: raw.model,
    scale_m: scale,
    floor_y: floorY,
    spawn: {
      position: [...spawnRaw.position],
      yaw_deg: spawnRaw.yaw_deg ?? 0,
    },
    landmarks: landmarksRaw.map((lm) => ({
      name: lm.name,
      position: [...lm.position],
      note: typeof lm.note === 'string' ? lm.note : '',
    })),
  };
}

/**
 * from から見た landmark の距離(m)と向き。
 * 向きは「正面(yaw_deg の向き)から左に何度か」。-180〜180、左が正。
 * キャラの正面は yaw 0 のとき +z。
 */
export function bearingFrom(fromPosition, fromYawDeg, targetPosition) {
  const dx = targetPosition[0] - fromPosition[0];
  const dz = targetPosition[2] - fromPosition[2];
  const distance = Math.hypot(dx, dz);
  // +z を向いた人の左は +x。atan2(x, z) は +z から +x 側(= 左)へ測る
  let angle = (Math.atan2(dx, dz) * 180) / Math.PI - fromYawDeg;
  angle = ((((angle + 180) % 360) + 360) % 360) - 180;
  return { distance_m: distance, left_deg: angle };
}
