// RoomPlan から出した landmarks_hint.json(ドア・窓・物の名前と中心の位置と寸法)を、
// place.json の landmarks と spawn に変える。three.js にも Blender にも依存しない(node で試せる)。
//
// 入力の形(place/ios/RoomScan/ScanExporter.swift の Hint):
//   { kind: 'floor'|'door'|'window'|'opening'|'wall'|'object', name, position:[x,y,z], dimensions:[幅,高さ,奥行き], confidence }
// 座標は部屋を撮った座標(y が上、m)。GLB も同じ座標で出るので、床の高さ floor_y だけ引いて y=0 を床にする。

const OBJECT_NAMES_JA = {
  bathtub: '浴槽', bed: 'ベッド', chair: '椅子', dishwasher: '食洗機', fireplace: '暖炉',
  oven: 'オーブン', refrigerator: '冷蔵庫', sink: '流し', sofa: 'ソファ', stairs: '階段',
  storage: '収納棚', stove: 'コンロ', table: 'テーブル', television: 'テレビ', toilet: 'トイレ',
  washerDryer: '洗濯機',
};

const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

/** 床の高さ(撮った座標の y)。floor の面があればその平均、無ければ壁の下端のいちばん低い所。 */
export function floorHeight(hints) {
  const floors = hints.filter((h) => h.kind === 'floor');
  if (floors.length > 0) return floors.reduce((s, f) => s + f.position[1], 0) / floors.length;
  const walls = hints.filter((h) => h.kind === 'wall');
  if (walls.length > 0) return Math.min(...walls.map((w) => w.position[1] - w.dimensions[1] / 2));
  return 0;
}

function japaneseBase(hint) {
  if (hint.kind === 'door') return 'ドア';
  if (hint.kind === 'window') return '窓';
  if (hint.kind === 'object') return OBJECT_NAMES_JA[hint.name] ?? hint.name;
  return null; // 壁・床・開口は landmark にしない
}

/**
 * @returns {{landmarks: object[], floor_y: number}}
 * 同じ名前が複数あれば、撮った座標の x の小さい順に 1, 2, ... を付ける(決まった順になるように)。
 */
export function buildLandmarks(hints) {
  const floorY = floorHeight(hints);
  const named = hints
    .map((h) => ({ h, base: japaneseBase(h) }))
    .filter((e) => e.base !== null)
    .sort((a, b) => a.h.position[0] - b.h.position[0] || a.h.position[2] - b.h.position[2]);

  const counts = {};
  named.forEach((e) => { counts[e.base] = (counts[e.base] ?? 0) + 1; });
  const seen = {};
  const landmarks = named.map(({ h, base }) => {
    seen[base] = (seen[base] ?? 0) + 1;
    const name = counts[base] > 1 ? `${base}${seen[base]}` : base;
    const [w, hh] = h.dimensions;
    return {
      name,
      position: [round(h.position[0]), round(h.position[1] - floorY), round(h.position[2])],
      note: `${base}。幅 ${round(w)} m、高さ ${round(hh)} m(RoomPlan が名前をつけた)`,
    };
  });
  return { landmarks, floor_y: round(floorY, 3) };
}

/**
 * 床の面があればその中心、無ければ範囲(Box)の中心の x, z。
 * 向きは最初のドア(x の小さい順)のほうへ。ドアが無ければ 0 度。
 */
export function buildSpawn(hints, boundsXZ) {
  const floors = hints.filter((h) => h.kind === 'floor');
  const cx = floors.length > 0 ? floors.reduce((s, f) => s + f.position[0], 0) / floors.length : (boundsXZ.minX + boundsXZ.maxX) / 2;
  const cz = floors.length > 0 ? floors.reduce((s, f) => s + f.position[2], 0) / floors.length : (boundsXZ.minZ + boundsXZ.maxZ) / 2;
  const door = hints
    .filter((h) => h.kind === 'door')
    .sort((a, b) => a.position[0] - b.position[0] || a.position[2] - b.position[2])[0];
  // loadPlace の約束: yaw 0 は +z を向き、正が左回り(+x のほうへ回る)
  const yaw = door ? (Math.atan2(door.position[0] - cx, door.position[2] - cz) * 180) / Math.PI : 0;
  return { position: [round(cx), 0, round(cz)], yaw_deg: round(yaw, 1) };
}

export function buildPlaceJson({ id, name, hints, boundsXZ }) {
  const { landmarks, floor_y } = buildLandmarks(hints);
  return {
    id,
    name,
    model: 'room.glb',
    scale_m: 1,
    floor_y,
    spawn: buildSpawn(hints, boundsXZ),
    landmarks,
  };
}
