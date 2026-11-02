// 場所の目印。本物の場所データ(places/<id>/place.json)が無いときの、試し用の場所。
// 単位はメートル、y が上、キャラは原点で +z を向く。お客さんから見て右が +x、手前が +z。
import { loadPlace } from '../../place/web/loadPlace.js'; // 場所の柱が出している入口(docs/共通の決まり.md)
import * as THREE from 'three';
import { describeDirection, landmarksForPrompt } from './tracking/geometry.js';

export const SAMPLE_PLACE = {
  id: 'sample',
  spawn: { position: [0, 0, 0], yaw_deg: 0 },
  name: '試しの場所',
  info: '入口を入ると、すぐ前に受付があります。',
  landmarks: [
    { name: '入口', position: [0, 0, 2.5], note: '来た道。外へ出る' },
    { name: 'お手洗い', position: [-3.5, 0, -1.5], note: '左奥の突き当たり' },
    { name: '休憩スペース', position: [3, 0, -2], note: 'ソファがある。自由に使える' },
    { name: 'スタッフの部屋', position: [2.5, 0, 1], note: '用事があるときはスタッフが対応する' },
  ],
};

/**
 * 場所のデータを読む。
 *  - 指定なし: 試しの場所(3D の部屋は無し)
 *  - ?place=<id> または <place.json の URL>: 場所の柱の loadPlace で、部屋の 3D・立ち位置・目印を読む
 * @returns {Promise<{id:string,name:string,info:string,spawn:{position:number[],yaw_deg:number},landmarks:object[],loaded:object|null}>}
 */
export async function loadPlaceData(spec) {
  if (!spec) return { ...SAMPLE_PLACE, loaded: null };
  const url = /\.json($|\?)/.test(spec) ? spec : `/places/${spec}/place.json`;
  const loaded = await loadPlace(url);
  return {
    id: loaded.id,
    name: loaded.name,
    info: '',
    spawn: { position: loaded.spawn.position.toArray(), yaw_deg: loaded.spawn.yaw_deg },
    landmarks: loaded.landmarks.map((l) => ({ name: l.name, position: l.position.toArray(), note: l.note })),
    loaded,
  };
}

/**
 * 目印の場所(ワールド座標)。視線の先は目の高さに上げる。
 * AR で撮った部屋を現実に重ねたあと(位置合わせ済み)は、部屋の座標を世界の座標に直す。
 */
export function landmarkWorld(place, name) {
  const l = place.landmarks?.find((x) => x.name === name);
  if (!l) return null;
  const room = [l.position[0], Math.max(l.position[1], 1.1), l.position[2]];
  if (place.loaded?.alignment?.active) return place.loaded.worldFromRoom(new THREE.Vector3(...room)).toArray();
  return room;
}

/**
 * Claude に渡す場所の情報。
 *  - AR で、まだ位置合わせをしていないとき(arUnaligned): 部屋の目印は現実と合わないので、渡さない
 *  - 位置合わせ済み: キャラの世界の位置と向きから、場所の柱の describeLandmarksFromWorld で測る
 *  - それ以外: 部屋の座標のまま、spawn から測る
 * 方向の言葉は、キャラと向かい合ったお客さんから見た右・左(場所の柱の left_deg は、キャラの左が正)。
 */
export function promptPlace(place, { character = null, arUnaligned = false } = {}) {
  const base = { name: place.name, info: place.info ?? '' };
  if (arUnaligned) return { ...base, landmarks: [] };
  const loaded = place.loaded;
  if (loaded?.alignment?.active && character) {
    const pos = character.object3d.getWorldPosition(new THREE.Vector3());
    const yawDeg = THREE.MathUtils.radToDeg(character.object3d.rotation.y);
    const landmarks = loaded.describeLandmarksFromWorld(pos, yawDeg).map((l) => {
      const rad = THREE.MathUtils.degToRad(l.left_deg);
      const { text, dist } = describeDirection(l.distance_m * Math.sin(rad), l.distance_m * Math.cos(rad));
      return { name: l.name, note: l.note ?? '', where: `${text}、約 ${dist.toFixed(1)}m` };
    });
    return { ...base, landmarks };
  }
  return { ...base, landmarks: landmarksForPrompt(place.landmarks ?? [], place.spawn.position, place.spawn.yaw_deg) };
}
