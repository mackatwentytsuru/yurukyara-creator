import * as THREE from 'three';
import { CUTE_RISE } from './cuteLayer.js';

// かわいい仕草の層(cuteLayer.js)の数字を、人型でないキャラ(type: "rig")の骨に書く(B5G)。
// 骨は決まった名前で探す(キャラごとの手付けはしない): root・body(spine・chest)・head・arm_L/arm_R・耳(ear_L/ear_R)・しっぽ(tail…)。
// 動き(clip)の上に重ねる: ミキサーが骨に書いた後に足し、次のコマの前に「動きだけの値」へ戻す
// (ミキサーは値が前と同じだと骨に書き直さないので、戻さないと足した分が毎コマ積み上がる)。
//
// 腕を上げた時の脇(本人「手を上げた時、脇がなくなる」): 読み込みの時に、腕を外へ上げる角度を変えながら、
// 袖と胴のつなぎ目(腕と体の両方に重みのある点)の三角形が、つぶれる・のびすぎる割合を数え、持ちこたえる角度(holdRad)を決める。
// 仕草で上げる腕も、キャラの動き(clip)が上げる腕も、この角度より上には上げない。腕が硬い部品(重みが腕だけ)のキャラは制限しない。

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const IDENT = new THREE.Quaternion();
/** 仕草の層が上げる腕のいちばん上(ラジアン。下ろした形から 120°) */
export const RAISE_MAX = (120 * Math.PI) / 180;

const NAMES = {
  root: [/^root$/i, /^hips?$/i, /^pelvis$/i],
  body: [/^body$/i, /^spine$/i, /^chest$/i, /^torso$/i],
  head: [/^head$/i],
  armL: [/^arm_?l$/i, /^left_?arm$/i, /^l_?arm$/i, /^upper_?arm_?l$/i, /^arm\.l$/i],
  armR: [/^arm_?r$/i, /^right_?arm$/i, /^r_?arm$/i, /^upper_?arm_?r$/i, /^arm\.r$/i],
  earL: [/^ear_?l$/i, /^left_?ear$/i, /^ear\.l$/i],
  earR: [/^ear_?r$/i, /^right_?ear$/i, /^ear\.r$/i],
};

function findBone(bones, list) {
  for (const re of list) {
    const b = bones.find((o) => re.test(o.name));
    if (b) return b;
  }
  return null;
}

/** しっぽの骨(tail・tail_1・tail.001 など)を根元から先の順に。無ければ空 */
function tailChain(bones) {
  const tails = bones.filter((b) => /tail/i.test(b.name));
  if (!tails.length) return [];
  const depth = (b) => {
    let d = 0;
    for (let p = b.parent; p; p = p.parent) d += 1;
    return d;
  };
  return tails.sort((a, b) => depth(a) - depth(b));
}

/**
 * しっぽの骨が無いのに、しっぽの部品(名前に tail。体の骨 1 本に付いた皮)があるキャラに、読み込みの時だけ骨を 1 本足す(B5G)。
 * 根元 = 部品のうち体の骨にいちばん近い端の点。根元から遠い点ほど、新しい骨の重みを大きくする(根元は体に付いたまま、先がしなる)。
 * 輪郭の殻(ol_tail など)も、同じ根元・同じ長さで重みを付ける(本体と殻が同じに動く)。足せなければ null。
 * @returns {{bone: THREE.Bone, wagAxis: THREE.Vector3, liftAxis: THREE.Vector3, rest: THREE.Quaternion, len: number}|null}
 */
export function autoTail(scene, body) {
  if (!body) return null;
  const meshes = [];
  scene.traverse((o) => {
    if (o.isSkinnedMesh && /tail/i.test(o.name) && o.geometry?.attributes?.skinIndex) meshes.push(o);
  });
  if (!meshes.length) return null;
  scene.updateMatrixWorld(true);
  const bodyW = body.getWorldPosition(new THREE.Vector3());
  // いちばん点の多い部品で、根元と先を決める
  const main = meshes.reduce((a, b) => (b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a));
  const pos = main.geometry.attributes.position;
  const p = new THREE.Vector3();
  let root = null;
  let rootD = Infinity;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(main.matrixWorld);
    const d = p.distanceTo(bodyW);
    if (d < rootD) [rootD, root] = [d, p.clone()];
  }
  let tip = root.clone();
  let len = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(main.matrixWorld);
    const d = p.distanceTo(root);
    if (d > len) [len, tip] = [d, p.clone()];
  }
  if (!(len > 1e-3)) return null;
  const bone = new THREE.Bone();
  bone.name = 'tail_auto';
  body.add(bone);
  bone.position.copy(body.worldToLocal(root.clone()));
  bone.updateMatrixWorld(true);
  const inv = bone.matrixWorld.clone().invert();
  const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  for (const m of meshes) {
    const sk = m.skeleton;
    if (!sk.bones.includes(bone)) {
      sk.bones.push(bone);
      sk.boneInverses.push(inv.clone());
      sk.boneMatrices = new Float32Array(sk.bones.length * 16);
      if (sk.boneTexture) {
        sk.boneTexture.dispose();
        sk.boneTexture = null;
      }
    }
    const ti = sk.bones.indexOf(bone);
    const si = m.geometry.attributes.skinIndex;
    const sw = m.geometry.attributes.skinWeight;
    const mp = m.geometry.attributes.position;
    for (let i = 0; i < mp.count; i++) {
      // 今いちばん重い骨(体)と、しっぽの骨の 2 本にする
      let bi = 0;
      for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, bi)) bi = k;
      const keep = si.getComponent(i, bi);
      p.fromBufferAttribute(mp, i).applyMatrix4(m.matrixWorld);
      const w = smooth((p.distanceTo(root) / len - 0.08) / 0.7);
      si.setXYZW(i, keep, ti, 0, 0);
      sw.setXYZW(i, 1 - w, w, 0, 0);
    }
    si.needsUpdate = true;
    sw.needsUpdate = true;
  }
  // 振る向き: 先がキャラの横(±x)へ動く軸。持ち上げる向き: キャラの横の軸(x)
  const dir = tip.clone().sub(root).normalize();
  const toLocal = body.getWorldQuaternion(new THREE.Quaternion()).invert();
  const wagAxis = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize().applyQuaternion(toLocal);
  const liftAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(toLocal);
  return { bone, wagAxis, liftAxis, rest: bone.quaternion.clone(), len, meshes: meshes.map((m) => m.name) };
}

/** 骨の世界の行列 × 逆の行列(点を動かす行列)を、骨ごとに作る */
function skinMatrices(mesh) {
  const sk = mesh.skeleton;
  return sk.bones.map((bone, i) => new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, sk.boneInverses[i]));
}

/** 骨に動かされた点の位置(世界の座標)。three の getVertexPosition と同じ計算を、作った行列で */
function skinned(mesh, mats, i, out) {
  const pos = mesh.geometry.attributes.position;
  const si = mesh.geometry.attributes.skinIndex;
  const sw = mesh.geometry.attributes.skinWeight;
  _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
  out.set(0, 0, 0);
  const tmp = new THREE.Vector3();
  for (let k = 0; k < 4; k++) {
    const w = sw.getComponent(i, k);
    if (w) out.addScaledVector(tmp.copy(_v).applyMatrix4(mats[si.getComponent(i, k)]), w);
  }
  return out.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
}

/**
 * 腕を外へ上げても、袖と胴のつなぎ目が持ちこたえる角度(ラジアン)。
 * つなぎ目 = 腕の骨と、それ以外の骨の両方に重みのある点を含む三角形。上げた時の面積が 0.4 倍より小さい(つぶれる)か 2.6 倍より大きい(のびる)
 * 三角形が 3% を超える手前の角度。つなぎ目が無い(腕が硬い部品)なら Infinity。骨は測った後に元へ戻す。
 * @returns {{holdRad:number, tris:number, rows:Array<[number, number]>}} rows は [度, 悪い三角形の割合]
 */
export function measureArmHold(root, arm, side, { steps = [40, 60, 80, 100, 120, 140, 160], bad = 0.03 } = {}) {
  const meshes = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton.bones.includes(arm)) meshes.push(o);
  });
  const sets = [];
  for (const m of meshes) {
    const ai = m.skeleton.bones.indexOf(arm);
    const si = m.geometry.attributes.skinIndex;
    const sw = m.geometry.attributes.skinWeight;
    if (!si || !sw) continue;
    const n = m.geometry.attributes.position.count;
    const blend = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      let wa = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === ai) wa += sw.getComponent(i, k);
      if (wa > 0.05 && wa < 0.95) {
        blend[i] = 1;
        any = true;
      }
    }
    if (!any) continue;
    const idx = m.geometry.index;
    const tri = [];
    const count = idx ? idx.count : n;
    for (let t = 0; t + 2 < count; t += 3) {
      const a = idx ? idx.getX(t) : t;
      const b = idx ? idx.getX(t + 1) : t + 1;
      const c = idx ? idx.getX(t + 2) : t + 2;
      if (blend[a] || blend[b] || blend[c]) tri.push(a, b, c);
    }
    if (tri.length) sets.push({ m, tri });
  }
  const total = sets.reduce((s, x) => s + x.tri.length / 3, 0);
  if (!total) return { holdRad: Infinity, tris: 0, rows: [] };
  const saved = arm.quaternion.clone();
  root.updateMatrixWorld(true);
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  const area = (set, mats) => {
    const out = new Float32Array(set.tri.length / 3);
    for (let t = 0; t < set.tri.length; t += 3) {
      skinned(set.m, mats, set.tri[t], A);
      skinned(set.m, mats, set.tri[t + 1], B);
      skinned(set.m, mats, set.tri[t + 2], C);
      out[t / 3] = B.sub(A).cross(C.sub(A)).length();
    }
    return out;
  };
  const rest = sets.map((s) => area(s, skinMatrices(s.m)));
  const rows = [];
  let holdRad = Infinity;
  try {
    for (const deg of steps) {
      const rad = (deg * Math.PI) / 180;
      // 体の向きの z 軸のまわりに、外へ上げる(左腕 +、右腕 −)。骨の親の座標に直して掛ける
      const pq = arm.parent.getWorldQuaternion(_q2);
      const rot = _q.setFromAxisAngle(Z, side * rad);
      const local = pq.clone().invert().multiply(rot).multiply(pq);
      arm.quaternion.copy(saved).premultiply(local);
      root.updateMatrixWorld(true);
      let badN = 0;
      sets.forEach((s, j) => {
        const now = area(s, skinMatrices(s.m));
        for (let k = 0; k < now.length; k++) {
          const r = rest[j][k] > 1e-12 ? now[k] / rest[j][k] : 1;
          if (r < 0.4 || r > 2.6) badN += 1;
        }
      });
      const frac = badN / total;
      rows.push([deg, Math.round(frac * 1000) / 1000]);
      if (frac > bad && holdRad === Infinity) holdRad = ((deg - (steps[1] - steps[0])) * Math.PI) / 180;
    }
  } finally {
    arm.quaternion.copy(saved);
    root.updateMatrixWorld(true);
  }
  return { holdRad: holdRad === Infinity ? Infinity : Math.max((30 * Math.PI) / 180, holdRad), tris: total, rows };
}

/** 動き(clip)の中で、その腕がいちばん大きく回った時の向きと位置(骨の局所の値)。無ければ null */
function clipPeak(clip, arm) {
  if (!clip || !arm) return null;
  const qt = clip.tracks.find((t) => t.name === `${arm.name}.quaternion`);
  if (!qt) return null;
  const pt = clip.tracks.find((t) => t.name === `${arm.name}.position`);
  let best = -1;
  let bestK = 0;
  for (let k = 0; k < qt.times.length; k++) {
    const w = Math.min(1, Math.abs(qt.values[k * 4 + 3]));
    const ang = 2 * Math.acos(w);
    if (ang > best) {
      best = ang;
      bestK = k;
    }
  }
  const q = new THREE.Quaternion().fromArray(qt.values, bestK * 4);
  let p = null;
  if (pt) {
    // 位置の鍵の時刻が違うことがあるので、いちばん近い時刻の鍵を使う
    const tq = qt.times[bestK];
    let kk = 0;
    for (let k = 0; k < pt.times.length; k++) if (Math.abs(pt.times[k] - tq) < Math.abs(pt.times[kk] - tq)) kk = k;
    p = new THREE.Vector3().fromArray(pt.values, kk * 3);
  }
  return { q, p, angle: best, time: qt.times[bestK] };
}

/** 左右を入れかえる(体の真ん中の面 x = 0 で写す) */
const mirrorQ = (q) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);

/** 回転の角度(ラジアン) */
const angleOf = (q) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));

/** 回転の角度を maxRad までに縮める(同じ向きのまま) */
function limitAngle(q, maxRad) {
  const ang = angleOf(q);
  if (!(ang > maxRad)) return false;
  q.slerp(IDENT, 1 - maxRad / ang);
  return true;
}

/**
 * rig のキャラに仕草の層をつなぐ。RigCharacterV2 が作る。
 *   beforeMixer(): ミキサーの前に、足した分を外す / afterMixer(out): ミキサーの後(視線の後)に、仕草の数字を足す
 */
export class CuteRig {
  /**
   * @param {THREE.Object3D} scene gltf.scene
   * @param {Map<string, THREE.AnimationClip>} clips
   * @param {object} json character.json
   * @param {THREE.Object3D|null} lookBone 視線で回す骨(rigRuntime が別に戻す)
   */
  constructor(scene, clips, json, lookBone) {
    const bones = [];
    scene.traverse((o) => {
      if (o.isBone) bones.push(o);
    });
    this.scene = scene;
    this.lookBone = lookBone;
    const look = json.look ?? {};
    this.root = findBone(bones, NAMES.root);
    this.body = findBone(bones, NAMES.body);
    this.head = (look.head_bone && scene.getObjectByName(look.head_bone)) || findBone(bones, NAMES.head);
    this.armL = findBone(bones, NAMES.armL);
    this.armR = findBone(bones, NAMES.armR);
    this.earL = findBone(bones, NAMES.earL);
    this.earR = findBone(bones, NAMES.earR);
    this.tail = tailChain(bones);
    // しっぽの骨が無く、しっぽの部品がある子は、読み込みの時に骨を 1 本足す(根元から先へしなる)
    this.tailAuto = this.tail.length ? null : autoTail(scene, this.body);
    const box = new THREE.Box3().setFromObject(scene);
    const sy = scene.getWorldScale(new THREE.Vector3()).y || 1;
    this.unit = (box.max.y - box.min.y) / sy || 1; // 背の高さ(骨の座標の長さ)
    const touched = [this.root, this.body, this.head, this.armL, this.armR, this.earL, this.earR, ...this.tail].filter(Boolean);
    this.bones = [...new Set(touched)];
    this.base = new Map(this.bones.map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
    this.restPos = new Map(this.bones.map((b) => [b, b.position.clone()]));
    // 腕: 動き wave の、腕がいちばん上がった形を「上げた形」にする(そのキャラの作り手が確かめた形)。反対の腕は写して使う
    const wave = clips.get('wave');
    const pr = clipPeak(wave, this.armR);
    const pl = clipPeak(wave, this.armL);
    this.waveArm = pr && pl ? (pr.angle >= pl.angle ? 'R' : 'L') : pr ? 'R' : pl ? 'L' : null;
    const peak = this.waveArm === 'R' ? pr : this.waveArm === 'L' ? pl : null;
    this.raise = { L: null, R: null };
    for (const side of ['L', 'R']) {
      const arm = side === 'L' ? this.armL : this.armR;
      if (!arm) continue;
      const out = side === 'L' ? 1 : -1;
      let q;
      let off = new THREE.Vector3();
      if (peak) {
        const own = side === this.waveArm;
        const src = own ? peak.q : mirrorQ(peak.q);
        q = src.clone();
        const other = side === 'L' ? this.armR : this.armL;
        if (peak.p) {
          const rest = own ? arm.position : other.position;
          off = peak.p.clone().sub(rest);
          if (!own) off.x = -off.x;
        }
      } else {
        q = new THREE.Quaternion().setFromAxisAngle(Z, out * 1.9); // clip が無い時: 外へ 109° 上げる
      }
      this.raise[side] = { q, off, out };
    }
    // 脇が持ちこたえる角度
    this.hold = { L: Infinity, R: Infinity };
    this.holdRows = {};
    for (const side of ['L', 'R']) {
      const arm = side === 'L' ? this.armL : this.armR;
      if (!arm) continue;
      const m = measureArmHold(scene, arm, side === 'L' ? 1 : -1);
      this.hold[side] = m.holdRad;
      this.holdRows[side] = m;
      const r = this.raise[side];
      if (!r) continue;
      const a0 = angleOf(r.q);
      if (Number.isFinite(m.holdRad)) limitAngle(r.q, m.holdRad);
      // 仕草で上げる腕(ばんざい・clip の無いキャラのあいさつ)は、そのキャラの wave の形より高くせず、120° まで(両腕を上げても頭とほおに当てない)
      limitAngle(r.q, RAISE_MAX);
      if (a0 > 1e-6) r.off.multiplyScalar(angleOf(r.q) / a0); // 肩のずらし(clip の形の補い)も、同じ割合で小さく
    }
    this.caps = { arms: Boolean(this.armL || this.armR), head: Boolean(this.head && this.head !== this.body), ears: Boolean(this.earL || this.earR), tail: this.tail.length > 0 || Boolean(this.tailAuto) };
    this.limited = { L: 0, R: 0 }; // 腕の角度を縮めたコマの数(確かめ用)
    // 頬の部品(名前か材質の名前に cheek・blush)。てれる・うれしい時に赤みを強くする(材質を差しかえられても、その時の材質で数える)
    this.blushMeshes = [];
    scene.traverse((o) => {
      if (o.isMesh && (/cheek|blush/i.test(o.name) || /cheek|blush/i.test(o.material?.name ?? ''))) this.blushMeshes.push(o);
    });
    this._blushBase = new WeakMap();
  }

  /** 頬の赤み(0〜1)。元の色から、少し濃く鮮やかなピンクへ寄せる */
  _blush(b) {
    for (const m of this.blushMeshes) {
      const mat = m.material;
      if (!mat?.color) continue;
      let base = this._blushBase.get(mat);
      if (!base) {
        base = { c: mat.color.clone(), e: mat.emissive ? mat.emissive.clone() : null, last: 0 };
        base.cs = base.c.clone().offsetHSL(0, 0.25, -0.12);
        base.es = base.e ? base.e.clone().offsetHSL(0, 0.25, -0.12) : null;
        this._blushBase.set(mat, base);
      }
      if (b < 0.005 && base.last < 0.005) continue;
      mat.color.copy(base.c).lerp(base.cs, b);
      if (base.e) mat.emissive.copy(base.e).lerp(base.es, b);
      base.last = b;
    }
  }

  /** ミキサーの前: 仕草で足した分を外して、動きだけの値へ戻す(視線の骨の回転は rigRuntime が戻す) */
  beforeMixer() {
    for (const b of this.bones) {
      const s = this.base.get(b);
      if (b !== this.lookBone) b.quaternion.copy(s.q);
      b.position.copy(s.p);
    }
  }

  /** ミキサーの後: 動きだけの値を覚える(視線を足す前) */
  captureBase() {
    for (const b of this.bones) {
      const s = this.base.get(b);
      if (b !== this.lookBone) s.q.copy(b.quaternion);
      s.p.copy(b.position);
    }
  }

  /** 親の向きの軸での回転を足す */
  _rot(bone, x, y, z) {
    if (!bone || (!x && !y && !z)) return;
    _e.set(x, y, z, 'YXZ');
    bone.quaternion.premultiply(_q.setFromEuler(_e));
  }

  /**
   * 仕草の数字を骨に足す。
   * @param {object} o cuteLayer の out
   */
  apply(o) {
    if (!o) return;
    const u = this.unit;
    if (this.root) this.root.position.add(_v.set(o.rootX * u, Math.min(o.rootY, CUTE_RISE) * u, o.rootZ * u));
    this._rot(this.body, o.spineX, o.spineY, o.spineZ);
    if (this.caps.head) this._rot(this.head, o.headX, o.headY, o.headZ);
    for (const side of ['L', 'R']) {
      const arm = side === 'L' ? this.armL : this.armR;
      const r = this.raise[side];
      if (!arm || !r) continue;
      const raise = side === 'L' ? o.armRaiseL : o.armRaiseR;
      const swing = side === 'L' ? o.armSwingL : o.armSwingR;
      const outA = side === 'L' ? o.armOutL : o.armOutR;
      const sh = side === 'L' ? o.shoulderL : o.shoulderR;
      const fwd = side === 'L' ? o.armFwdL : o.armFwdR;
      if (raise > 0.001) {
        _q2.copy(IDENT).slerp(r.q, raise);
        arm.quaternion.premultiply(_q2);
        arm.position.addScaledVector(r.off, raise);
      }
      // 外へ開く・ふる: 体の向きの z 軸のまわり(外が +)
      const z = r.out * (outA + swing);
      if (z || fwd) this._rot(arm, -fwd, 0, z); // 前へ寄せる(もじもじ・あごに手)は、体の向きの x 軸のまわり
      if (sh) arm.position.y += sh * u;
      // 脇が持ちこたえる角度より上には上げない(動き clip の腕も)
      const hold = this.hold[side];
      if (Number.isFinite(hold) && limitAngle(arm.quaternion, hold)) this.limited[side] += 1;
    }
    if (this.blushMeshes.length) this._blush(o.blush ?? 0);
    if (this.earL) this._rot(this.earL, -o.earL, 0, 0.3 * o.earL);
    if (this.earR) this._rot(this.earR, -o.earR, 0, -0.3 * o.earR);
    // 足したしっぽの骨: ミキサーは触らないので、毎コマ休みの形から作る(振る 0.3・持ち上げ 0.2 ラジアンまで)
    const ta = this.tailAuto;
    if (ta) {
      const wag = THREE.MathUtils.clamp(o.tailY, -0.3, 0.3);
      const lift = THREE.MathUtils.clamp(o.tailX, -0.2, 0.2);
      ta.bone.quaternion.copy(ta.rest).premultiply(_q.setFromAxisAngle(ta.wagAxis, wag)).premultiply(_q2.setFromAxisAngle(ta.liftAxis, -lift));
    }
    const n = this.tail.length;
    this.tail.forEach((b, i) => {
      const k = (0.6 + (0.8 * i) / Math.max(1, n - 1)) / n;
      this._rot(b, -o.tailX * k, o.tailY * k, 0);
    });
  }
}
