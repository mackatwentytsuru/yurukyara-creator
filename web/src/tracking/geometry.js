// カメラの中の位置を、キャラのいる世界の座標に直す。純粋な関数(node --test で確かめる)。
//
// 世界の決まり(docs/共通の決まり.md): 単位はメートル、y が上、右手系。
// キャラは原点付近で +z を向いて立つ。お客さんはキャラの前(+z 側)にいて、お客さんから見た右が +x。
// カメラの絵は鏡ではなく、お客さんの右はカメラの絵の左に写る。

const FACE_WIDTH_M = 0.15; // 顔の幅の目安(頬から頬)

export const radians = (deg) => (deg * Math.PI) / 180;

/**
 * @param {{x:number,y:number,width:number}} face 画像の中の位置(0〜1)と顔の幅の割合
 * @param {{hfovDeg?:number,aspect?:number,headY?:number,minDist?:number,maxDist?:number}} opts
 * @returns {[number,number,number]} ワールド座標(メートル)
 */
export function faceToWorld(face, { hfovDeg = 65, aspect = 4 / 3, headY = 1.4, minDist = 0.4, maxDist = 6 } = {}) {
  const tanH = Math.tan(radians(hfovDeg) / 2);
  const tanV = tanH / aspect;
  const dist = clamp(FACE_WIDTH_M / (Math.max(face.width, 1e-3) * 2 * tanH), minDist, maxDist);
  const x = (0.5 - face.x) * 2 * tanH * dist;
  const y = headY + (0.5 - face.y) * 2 * tanV * dist;
  return [x, y, dist];
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** キャラから見た目印の方向。右・左はお客さん(キャラと向かい合う人)から見た向き。 */
export function describeDirection(dx, dz) {
  const dist = Math.hypot(dx, dz);
  if (dist < 0.3) return { text: 'すぐそば', dist };
  const lateral = Math.abs(dx) < dist * 0.25 ? '' : dx > 0 ? '右' : '左';
  const depth = Math.abs(dz) < dist * 0.25 ? '' : dz > 0 ? '手前' : '奥';
  const text = lateral || depth ? `${lateral}${depth}` : '正面';
  return { text, dist };
}

/**
 * place.landmarks に「where」を足して、Claude に渡す形にする。
 * origin はキャラの位置、yawDeg はキャラの向き(object3d.rotation.y の度。0 のとき +z を向く)。
 * 方向は、キャラと向かい合ったお客さんから見た右・左(キャラの左手側が、お客さんの右)。
 */
export function landmarksForPrompt(landmarks = [], origin = [0, 0, 0], yawDeg = 0) {
  const th = radians(yawDeg);
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  return landmarks.map((l) => {
    const p = Array.isArray(l.position) ? l.position : [l.position.x, l.position.y, l.position.z];
    const wx = p[0] - origin[0];
    const wz = p[2] - origin[2];
    // ワールド → キャラの座標(キャラは +z を向く)
    const lx = wx * cos - wz * sin;
    const lz = wx * sin + wz * cos;
    const { text, dist } = describeDirection(lx, lz);
    return { name: l.name, note: l.note ?? '', where: `${text}、約 ${dist.toFixed(1)}m` };
  });
}

/**
 * 見えている様子を、数字から言葉にする(Claude に渡す。絵は渡さない)。
 * tracks の position は、キャラの座標(+z が正面・+x がお客さんから見て右)。
 */
export function describeScene(tracks, { primaryId, speakerId }) {
  if (!tracks.length) return '人は見えていない';
  const lines = tracks.map((t) => {
    const [x, , z] = t.position;
    const dist = Math.hypot(x, z);
    const side = Math.abs(x) < 0.12 * Math.max(z, 0.3) ? '正面' : x > 0 ? '右寄り' : '左寄り';
    const mark = t.id === speakerId ? '(話している)' : '';
    return `${side} 約 ${dist.toFixed(1)}m${mark}`;
  });
  const head = tracks.length === 1 ? '1 人が見えている' : `${tracks.length} 人が見えている`;
  const primary = tracks.find((t) => t.id === primaryId);
  const focus = primary && tracks.length > 1 ? `。いま目を向けているのは${primary.id === speakerId ? '話している人' : 'いちばん近い人'}` : '';
  return `${head}: ${lines.join('、')}${focus}`;
}
