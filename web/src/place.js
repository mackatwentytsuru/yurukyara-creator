// 場所の目印。本物の場所データ(places/<id>/place.json)が無いときの、試し用の場所。
// 単位はメートル、y が上、キャラは原点で +z を向く。お客さんから見て右が +x、手前が +z。
import { landmarksForPrompt } from './tracking/geometry.js';

export const SAMPLE_PLACE = {
  id: 'sample',
  name: '試しの場所',
  info: '入口を入ると、すぐ前に受付があります。',
  landmarks: [
    { name: '入口', position: [0, 0, 2.5], note: '来た道。外へ出る' },
    { name: 'お手洗い', position: [-3.5, 0, -1.5], note: '左奥の突き当たり' },
    { name: '休憩スペース', position: [3, 0, -2], note: 'ソファがある。自由に使える' },
    { name: 'スタッフの部屋', position: [2.5, 0, 1], note: '用事があるときはスタッフが対応する' },
  ],
};

/** ?place=<place.json の URL> があれば読む。無ければ試しの場所 */
export async function loadPlaceData(url) {
  if (!url) return SAMPLE_PLACE;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`place.json を読めません: ${url}`);
  const json = await res.json();
  return { info: '', ...json };
}

/** 目印の場所(ワールド座標)。視線の先は目の高さに上げる */
export function landmarkWorld(place, name) {
  const l = place.landmarks?.find((x) => x.name === name);
  if (!l) return null;
  return [l.position[0], Math.max(l.position[1], 1.1), l.position[2]];
}

export function promptPlace(place, origin = [0, 0, 0]) {
  const wheres = landmarksForPrompt(place.landmarks ?? [], origin);
  return { name: place.name, info: place.info ?? '', landmarks: wheres };
}
