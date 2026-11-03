// 既存の動きを並べた 1 本(assemble_track.py の出力)を、VRM の正規化の骨へ毎コマ書く。状態を持たず、コマ番号だけで姿勢が決まる。
// show_vrm_dance.mjs と同じ形(createDance・danceInput)なので、差しかえて使える。
const base = '/show-data/dance_track';
const head = await (await fetch(`${base}.json`)).json();
const data = new Float32Array(await (await fetch(`${base}.bin`)).arrayBuffer());
const stride = 3 + 4 * head.bones.length;

export function danceInput(timeline, frame) {
  return { frame };
}

export function createDance(vrm) {
  const h = vrm.humanoid;
  const hips = h.getNormalizedBoneNode('hips');
  const hipsRest = hips.position.clone();
  const nodes = head.bones.map((name) => h.getNormalizedBoneNode(name));
  const initial = nodes.map((n) => (n ? n.quaternion.clone() : null));
  return {
    apply({ frame }) {
      const i = Math.min(Math.max(frame - head.first, 0), head.frames - 1);
      const at = i * stride;
      hips.position.set(hipsRest.x + data[at], hipsRest.y + data[at + 1], hipsRest.z + data[at + 2]);
      nodes.forEach((n, b) => {
        if (!n) return;
        const q = at + 3 + b * 4;
        n.quaternion.set(data[q], data[q + 1], data[q + 2], data[q + 3]);
      });
    },
    reset() {
      hips.position.copy(hipsRest);
      nodes.forEach((n, b) => n && n.quaternion.copy(initial[b]));
    },
  };
}
