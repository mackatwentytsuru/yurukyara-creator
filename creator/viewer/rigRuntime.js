import * as THREE from 'three';
import { createGltfLoader } from '../../web/src/character/gltfLoader.js'; // meshopt で縮めた GLB も読める
import { CharacterBase } from '../../web/src/character/characterBase.js';
import { applyFur } from './furShell.js';

/**
 * 人型でないキャラ(type: "rig")を動かす。キャラの柱が決めた形で character.json を読む。
 *
 *   "look":  { "bone": "body", "max_deg": [yaw, pitch], "face_shift": [u, v], "head_bone": "頭の骨の名前", "head_y_ratio": 0.6 }
 *   "mouth": { "kind": "atlas", "mesh": "Face", "cols": 4, "levels": [0.08, 0.3, 0.6] }
 *   "face":  { "mesh": "Face", "cols": 4, "rows": ["neutral", ...], "blink_row": "blink" }
 *   "motions": { "idle": "motions/idle.glb", ... }   // 1 つの GLB に 1 つの動き(骨の名前は model.glb と同じ)
 *
 * - 顔は、体の表面に貼った面(Face)の表から 1 マスを選んで見せる。表情 = 縦、口の開き = 横。まばたきは専用の行。
 * - 視線は、顔の絵を少しずらして目が先に動き、体(look.bone)が少し遅れて向く。
 * - 動き: idle をいつも流し、play(name) で一回きりの動きを重ねる。しゃべっている間は talk を混ぜる。
 */
const HEAD_Y_RATIO = 0.6; // 頭の高さの既定(全身の高さに対する割合)
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();

export class RigCharacterV2 extends CharacterBase {
  constructor(gltf, clips, json, base) {
    super({
      id: json.id,
      name: json.name,
      expressions: json.expressions ?? [],
      motions: json.motions ?? {},
      heightM: json.height_m ?? null,
    });
    this.json = json;
    this.gltf = gltf;
    this.object3d.add(gltf.scene);
    this.personaUrl = json.persona ? new URL(json.persona, base).href : null;

    const look = json.look ?? {};
    this.lookBone = look.bone ? gltf.scene.getObjectByName(look.bone) : null;
    this.lookRest = this.lookBone ? this.lookBone.quaternion.clone() : null;
    this.lookBase = this.lookRest ? this.lookRest.clone() : null; // 視線を重ねる前の、動きだけの値
    this.headBone = look.head_bone ? gltf.scene.getObjectByName(look.head_bone) : null;
    const ml = look.max_deg ?? [22, 14];
    this.maxYaw = THREE.MathUtils.degToRad(ml[0]);
    this.maxPitch = THREE.MathUtils.degToRad(ml[1]);
    this.faceShift = look.face_shift ?? [0.03, 0.025];

    const face = json.face ?? {};
    this.face = null;
    const mesh = gltf.scene.getObjectByName(face.mesh ?? 'Face');
    // 光る顔(led)は発光の絵、紙に描いた顔(paper)は色の絵に表がある。縁を消すアルファのために両方に同じ絵が付くこともある
    const mat = mesh?.material;
    const slots = ['emissiveMap', 'map'].filter((k) => mat?.[k]);
    if (mesh && slots.length) {
      const tex = mat[slots[0]].clone();
      tex.needsUpdate = true;
      this.faceCols = face.cols ?? 4;
      this.faceRows = face.rows ?? ['neutral'];
      this.blinkRow = face.blink_row ?? null;
      this.mouthLevels = json.mouth?.levels ?? [0.08, 0.3, 0.6];
      tex.repeat.set(1 / this.faceCols, 1 / this.faceRows.length);
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      for (const k of slots) mat[k] = tex; // 同じ 1 枚(同じ offset)を全部に使う
      mat.needsUpdate = true;
      this.face = { mesh, tex };
      this._cell = { col: -1, row: -1, sx: 0, sy: 0 };
    }

    // 紙のあかり: 頂点の色で濃淡をつけた材質には、発光の色を足して内側から光らせる
    if (json.glow) {
      const g = json.glow;
      gltf.scene.traverse((o) => {
        if (o.isMesh && o.material && o.material.name === g.material) {
          o.material.emissive = new THREE.Color(...(g.color ?? [1, 0.85, 0.6]));
          o.material.emissiveIntensity = g.intensity ?? 0.4;
        }
      });
    }

    // 明るさの持ち上げ: three.js の光は Blender より暗く(強さ 1 で白い面が約 0.32)、絵の色が沈む。
    // 色の絵(map)を発光にも貼って、絵の色に近づける。character.json の lift(0〜1、既定 0.55)。
    this.applyLift(json.lift ?? 0.55);
    if (json.fur) applyFur(gltf.scene, json.fur); // 毛の殻(furShell.js)。持ち上げの後に足す

    // シェイプキー(目・口)。character.json: mouth.kind = "morph"、blink = {morph}、morphs = {表情: {キー: 重み}}、look.eyes = [骨]
    this.morphMeshes = [];
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary) this.morphMeshes.push(o);
    });
    this.morphCfg = json.morphs ?? {};
    this.eyeBones = (look.eyes ?? []).map((n) => gltf.scene.getObjectByName(n)).filter(Boolean);
    this.eyeRest = new Map(this.eyeBones.map((b) => [b, b.quaternion.clone()]));

    this.mixer = new THREE.AnimationMixer(gltf.scene);
    this.actions = new Map();
    for (const [name, clip] of clips) {
      const a = this.mixer.clipAction(clip);
      a.setEffectiveWeight(0);
      this.actions.set(name, a);
    }
    this.motionNames = [...this.actions.keys()];
    this.emotion = 'neutral';
    this.shot = null;
    this._startLoop('idle', 1);
    this._startLoop('talk', 0);
    this._talkW = 0;
  }

  _startLoop(name, w) {
    const a = this.actions.get(name);
    if (!a) return;
    a.setLoop(THREE.LoopRepeat, Infinity).reset().play();
    a.setEffectiveWeight(w);
  }

  _headWorld(out) {
    // 人物のように頭の位置が割合で決まらないキャラは、look.head_bone の骨の位置を使う
    if (this.headBone) return this.headBone.getWorldPosition(out);
    // 床から頭までの高さ(世界の座標の箱の高さ)を使う。物の置き場所(床の y)を二重に足さない
    const box = new THREE.Box3().setFromObject(this.gltf.scene);
    const h = (box.max.y - box.min.y) * (this.json.look?.head_y_ratio ?? HEAD_Y_RATIO);
    const sy = this.object3d.getWorldScale(_s).y || 1;
    return out.set(0, h / sy, 0).applyMatrix4(this.object3d.matrixWorld);
  }

  /** 一回きりの動きを重ねる。ない名前は false */
  play(name) {
    const a = this.actions.get(name);
    if (!a || name === 'idle') return false;
    if (name === 'talk') return true; // しゃべりは口の大きさで自動
    if (this.shot) this.shot.fadeOut(0.15);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    a.reset().setEffectiveWeight(1).fadeIn(0.12).play();
    this.shot = a;
    this.active = { name, t: 0, def: { duration: a.getClip().duration + 0.1, apply() {} } };
    return true;
  }

  _pickRow(expr, blink) {
    if (blink > 0.5 && this.blinkRow) return this.faceRows.indexOf(this.blinkRow);
    let best = 'neutral';
    let bw = 0;
    for (const [k, v] of expr) {
      if (v > bw && this.faceRows.includes(k)) {
        best = k;
        bw = v;
      }
    }
    return Math.max(0, this.faceRows.indexOf(best));
  }

  _apply(s) {
    // 動き: しゃべっている間は talk を混ぜ、一回きりの動きの間は薄める
    const shotOn = this.shot && this.shot.isRunning();
    const talkTarget = shotOn ? 0 : THREE.MathUtils.clamp(s.mouth * 3, 0, 1);
    this._talkW += (talkTarget - this._talkW) * Math.min(1, s.dt * 8);
    const idle = this.actions.get('idle');
    const talk = this.actions.get('talk');
    if (idle) idle.setEffectiveWeight(shotOn ? 0.0 : 1 - this._talkW);
    if (talk) talk.setEffectiveWeight(this._talkW);
    // ミキサーは値が前と同じだと骨に書き直さない。視線を重ねたままにすると、毎コマ積み上がる。
    // 先に「動きだけの値」へ戻す(動きが骨を動かすコマは、下の update が上書きする)
    if (this.lookBone) this.lookBone.quaternion.copy(this.lookBase);
    this.mixer.update(s.dt);

    // 体を視線の向きへ(遅れて追う)。回転はキャラの向きの軸で作り、骨の局所の軸へ直して重ねる
    if (this.lookBone) {
      this.lookBase.copy(this.lookBone.quaternion);
      const yaw = THREE.MathUtils.clamp(s.headYaw, -this.maxYaw, this.maxYaw);
      const pitch = THREE.MathUtils.clamp(s.headPitch, -this.maxPitch, this.maxPitch);
      const qc = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch * 0.6, yaw * 0.6, 0, 'YXZ'));
      const oq = this.object3d.getWorldQuaternion(_q1);
      const pq = this.lookBone.parent.getWorldQuaternion(_q2);
      const qd = pq.clone().invert().multiply(oq).multiply(qc).multiply(oq.clone().invert()).multiply(pq);
      this.lookBone.quaternion.premultiply(qd);
    }

    // シェイプキー: 口の開き・まばたき・表情ごとの口の形
    if (this.morphMeshes.length) {
      const w = new Map();
      const mc = this.json.mouth ?? {};
      if (mc.kind === 'morph') w.set(mc.morph ?? 'mouth_open', Math.min(1, s.mouth * (mc.gain ?? 1.4)));
      if (this.json.blink?.morph) w.set(this.json.blink.morph, s.blink);
      for (const [name, v] of s.expr) {
        const m = this.morphCfg[name];
        if (!m) continue;
        for (const [key, k] of Object.entries(m)) w.set(key, Math.max(w.get(key) ?? 0, v * k));
      }
      for (const mesh of this.morphMeshes) {
        for (const [key, idx] of Object.entries(mesh.morphTargetDictionary)) mesh.morphTargetInfluences[idx] = w.get(key) ?? 0;
      }
    }
    // 目の骨: 目標の向きのうち、体が回りきらない分だけ、黒目を動かす(目が先)
    if (this.eyeBones.length) {
      const ey = THREE.MathUtils.clamp((this.debug.wantYaw ?? 0) - s.headYaw * 0.6, -0.5, 0.5);
      const ep = THREE.MathUtils.clamp((this.debug.wantPitch ?? 0) - s.headPitch * 0.6, -0.4, 0.4);
      const qc = new THREE.Quaternion().setFromEuler(new THREE.Euler(-ep * 0.8, ey * 0.8, 0, 'YXZ'));
      const oq = this.object3d.getWorldQuaternion(_q1);
      for (const b of this.eyeBones) {
        b.quaternion.copy(this.eyeRest.get(b));
        const pq = b.parent.getWorldQuaternion(_q2);
        const qd = pq.clone().invert().multiply(oq).multiply(qc).multiply(oq.clone().invert()).multiply(pq);
        b.quaternion.premultiply(qd);
      }
    }

    // 顔の表から 1 マスを選ぶ
    if (this.face) {
      let level = 0;
      const m = s.mouth;
      for (let i = 0; i < this.mouthLevels.length; i++) if (m > this.mouthLevels[i]) level = i + 1;
      const row = this._pickRow(s.expr, s.blink);
      // 目が先: 目標との差のうち体が回りきらない分だけ、顔の絵をずらす
      const wy = (this.debug.wantYaw ?? 0) - s.headYaw * 0.0;
      const wp = (this.debug.wantPitch ?? 0);
      const sx = THREE.MathUtils.clamp(-wy * 0.5, -1, 1) * this.faceShift[0];
      const sy = THREE.MathUtils.clamp(-wp * 0.5, -1, 1) * this.faceShift[1];
      const tex = this.face.tex;
      // glTF の絵は上が v=0(flipY が偽)。上から row 番目の行を選ぶ
      const n = this.faceRows.length;
      const vBase = tex.flipY ? 1 - (row + 1) / n : row / n;
      const vShift = tex.flipY ? sy / n : -sy / n;
      tex.offset.set(level / this.faceCols + sx / this.faceCols, vBase + vShift);
    }
  }
}

/** @param {{furLayers?:number}} [options] furLayers: 毛の層の数を減らす(重ね描きなので、弱い GPU のヘッドセット用) */
export async function loadRigCharacter(url, options = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`character.json を読めません: ${url} (${res.status})`);
  const json = await res.json();
  if (json.fur && options.furLayers) json.fur = { ...json.fur, layers: options.furLayers };
  const base = new URL(url, location.href);
  const loader = createGltfLoader();
  const gltf = await loader.loadAsync(new URL(json.model, base).href);
  const clips = new Map();
  await Promise.all(
    Object.entries(json.motions ?? {}).map(async ([name, path]) => {
      const g = await loader.loadAsync(new URL(path, base).href);
      const clip = g.animations[0];
      if (clip) {
        clip.name = name;
        clips.set(name, clip);
      }
    }),
  );
  const c = new RigCharacterV2(gltf, clips, json, base);
  if (json.height_m) {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const h = box.max.y - box.min.y;
    // 大きさは gltf.scene に掛ける。object3d の座標はメートルのまま(場所に立たせる側が、そのまま使える)
    if (h > 0) gltf.scene.scale.setScalar(json.height_m / h);
  }
  const t0 = performance.now();
  const topPoints = [];
  // 画面の見せ方(web/src/scene.js)が、頭の上の余白(web/src/stage/framing.js の topPad)と、遠近で上へ出る分の確かめに使う
  c.motionRise = measureMotionRise(gltf.scene, clips, { topPoints });
  c.topPoints = topPoints.length ? topPoints : null; // 止まった形のいちばん上の点(キャラの座標)
  c.motionRiseMs = Math.round(performance.now() - t0); // 測るのにかかった時間(確かめ用)
  return c;
}

/**
 * 動き(idle・talk・一回きりの動き)の間に、止まった形のいちばん上より上へ出る分(止まった形の高さに対する割合。0 以上)。
 * 画面の見せ方(web/src/scene.js)が、上の段の下に頭を置く時の頭の上の余白に使う(S5w11c: 跳ねる動き jump で頭が上の段より上へ出た)。
 * 読み込みの直後(まだ動かしていない骨)に、動きごとに 12 の時刻を骨へ当て、形の点(止まった形の上の側の点と、全体から間引いた点)の高さを測る。
 * 測った後は骨と節を元の値に戻す(別の AnimationMixer を使い、終わったら止めて捨てる)。測れない時は null(見せ方は前の余白のまま)。
 */
export function measureMotionRise(root, clips, { samples = 12, topShare = 0.15, maxTop = 900, spread = 300, topPoints = null } = {}) {
  if (!root || !clips?.size) return null;
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
  });
  if (!meshes.length) return null;
  const saved = [];
  root.traverse((o) => saved.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  // 骨の行列(骨の世界の行列 × 骨の逆の行列)は、時刻ごとに骨の数だけ作り、点ごとには作らない(getVertexPosition より速い)。形の鍵(口など)は小さいので見ない
  const boneMats = new Map();
  const refresh = () => {
    root.updateMatrixWorld(true);
    for (const m of meshes) {
      if (!m.isSkinnedMesh) continue;
      const sk = m.skeleton;
      let arr = boneMats.get(m);
      if (!arr) boneMats.set(m, (arr = sk.bones.map(() => new THREE.Matrix4())));
      sk.bones.forEach((bone, i) => arr[i].multiplyMatrices(bone.matrixWorld, sk.boneInverses[i]));
    }
  };
  const v = new THREE.Vector3();
  const b = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const si = new THREE.Vector4();
  const sw = new THREE.Vector4();
  const heightOf = (m, i) => {
    v.fromBufferAttribute(m.geometry.attributes.position, i);
    if (m.isSkinnedMesh) {
      const arr = boneMats.get(m);
      si.fromBufferAttribute(m.geometry.attributes.skinIndex, i);
      sw.fromBufferAttribute(m.geometry.attributes.skinWeight, i);
      b.copy(v).applyMatrix4(m.bindMatrix);
      acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(k);
        if (w) acc.addScaledVector(v.copy(b).applyMatrix4(arr[si.getComponent(k)]), w);
      }
      v.copy(acc).applyMatrix4(m.bindMatrixInverse);
    }
    return v.applyMatrix4(m.matrixWorld).y;
  };
  // 測る点: 止まった形で高い方の topShare(多ければ maxTop 点に間引く)と、全体から間引いた spread 点(腕を上げる動きの手の先も拾う)
  refresh();
  const all = [];
  let restTop = -Infinity;
  let restBottom = Infinity;
  for (const m of meshes) {
    const n = m.geometry.attributes.position.count;
    const step = Math.max(1, Math.floor(n / 4000));
    for (let i = 0; i < n; i += step) {
      const y = heightOf(m, i);
      all.push([m, i, y]);
      if (y > restTop) restTop = y;
      if (y < restBottom) restBottom = y;
    }
  }
  const restH = restTop - restBottom;
  if (!(restH > 0)) return null;
  const cut = restBottom + restH * (1 - topShare);
  const high = all.filter(([, , y]) => y >= cut).sort((p, q) => q[2] - p[2]); // 高い順(いちばん上の点は必ず測る)
  // 止まった形のいちばん上の点(高い順に 40)の位置を返す(キャラの座標。見せ方が遠近の分まで画面へ写して確かめる)
  if (Array.isArray(topPoints)) {
    for (const [m, i] of high.slice(0, 40)) {
      heightOf(m, i);
      topPoints.push([v.x, v.y, v.z]);
    }
  }
  const highEvery = Math.max(1, Math.ceil(high.length / maxTop));
  const every = Math.max(1, Math.floor(all.length / spread));
  const probe = [...high.slice(0, 60), ...high.filter((_, k) => k % highEvery === 0), ...all.filter((_, k) => k % every === 0)];
  const mixer = new THREE.AnimationMixer(root);
  const topAt = (t) => {
    mixer.setTime(t);
    refresh();
    let best = -Infinity;
    for (const [m, i] of probe) {
      const y = heightOf(m, i);
      if (y > best) best = y;
    }
    return best;
  };
  let top = restTop;
  try {
    for (const clip of clips.values()) {
      const action = mixer.clipAction(clip);
      action.play();
      const step = clip.duration / samples;
      let bestT = 0;
      let bestY = -Infinity;
      for (let k = 0; k < samples; k++) {
        const y = topAt(step * k); // 0 から終わりの手前まで等しい間で(終わり = 始めに戻る)
        if (y > bestY) [bestY, bestT] = [y, step * k];
      }
      // いちばん高かった時刻のまわりを細かく(跳ねる動きは空中にいる間が短く、12 の時刻では頂点を外す。1 回目の確かめで 8px ほど低く出た)
      for (const f of [-0.75, -0.5, -0.25, 0.25, 0.5, 0.75]) {
        const t = bestT + f * step;
        if (t >= 0 && t < clip.duration) bestY = Math.max(bestY, topAt(t));
      }
      if (bestY > top) top = bestY;
      action.stop();
    }
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    for (const [o, p, q, s] of saved) {
      o.position.copy(p);
      o.quaternion.copy(q);
      o.scale.copy(s);
    }
    root.updateMatrixWorld(true);
  }
  return Math.max(0, (top - restTop) / restH);
}


/** 明るさの持ち上げ。色の絵(map)を発光(emissiveMap)にも使い、強さ v で足す。顔(光る顔・紙の顔)と glow 材質は触らない。 */
RigCharacterV2.prototype.applyLift = function (v) {
  const skip = new Set();
  if (this.face?.mesh?.material) skip.add(this.face.mesh.material);
  const glowName = this.json?.glow?.material;
  this.gltf.scene.traverse((o) => {
    const m = o.isMesh ? o.material : null;
    if (!m || skip.has(m) || (glowName && m.name === glowName) || !m.isMeshStandardMaterial) return;
    if (m._liftBase === undefined) m._liftBase = { map: m.emissiveMap, ei: m.emissiveIntensity, e: m.emissive.clone() };
    if (m._liftBase.map || (m._liftBase.e.r + m._liftBase.e.g + m._liftBase.e.b) > 0) return; // 元から発光のある材質は触らない
    if (v <= 0) { m.emissiveMap = null; m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 1; m.needsUpdate = true; return; }
    if (m.map) { m.emissive.setRGB(1, 1, 1); m.emissiveMap = m.map; }
    else if (m.color.r + m.color.g + m.color.b < 2.99) m.emissive.copy(m.color); // 色の絵が無ければ、地の色を発光にも使う(頬が茶色く沈むのを防ぐ)
    else return; // 地の色が白の材質は、色が頂点の色にある。発光に頂点の色は掛からないので触らない
    m.emissiveIntensity = v;
    m.needsUpdate = true;
  });
};
