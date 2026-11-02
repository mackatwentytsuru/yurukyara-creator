import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CharacterBase } from '../../web/src/character/characterBase.js';

/**
 * 人型でないキャラ(type: "rig")を動かす。キャラの柱が決めた形で character.json を読む。
 *
 *   "look":  { "bone": "body", "max_deg": [yaw, pitch], "face_shift": [u, v] }
 *   "mouth": { "kind": "atlas", "mesh": "Face", "cols": 4, "levels": [0.08, 0.3, 0.6] }
 *   "face":  { "mesh": "Face", "cols": 4, "rows": ["neutral", ...], "blink_row": "blink" }
 *   "motions": { "idle": "motions/idle.glb", ... }   // 1 つの GLB に 1 つの動き(骨の名前は model.glb と同じ)
 *
 * - 顔は、体の表面に貼った面(Face)の表から 1 マスを選んで見せる。表情 = 縦、口の開き = 横。まばたきは専用の行。
 * - 視線は、顔の絵を少しずらして目が先に動き、体(look.bone)が少し遅れて向く。
 * - 動き: idle をいつも流し、play(name) で一回きりの動きを重ねる。しゃべっている間は talk を混ぜる。
 */
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

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
    const ml = look.max_deg ?? [22, 14];
    this.maxYaw = THREE.MathUtils.degToRad(ml[0]);
    this.maxPitch = THREE.MathUtils.degToRad(ml[1]);
    this.faceShift = look.face_shift ?? [0.03, 0.025];

    const face = json.face ?? {};
    this.face = null;
    const mesh = gltf.scene.getObjectByName(face.mesh ?? 'Face');
    if (mesh && mesh.material?.emissiveMap) {
      const tex = mesh.material.emissiveMap.clone();
      tex.needsUpdate = true;
      this.faceCols = face.cols ?? 4;
      this.faceRows = face.rows ?? ['neutral'];
      this.blinkRow = face.blink_row ?? null;
      this.mouthLevels = json.mouth?.levels ?? [0.08, 0.3, 0.6];
      tex.repeat.set(1 / this.faceCols, 1 / this.faceRows.length);
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      mesh.material.emissiveMap = tex;
      mesh.material.needsUpdate = true;
      this.face = { mesh, tex };
      this._cell = { col: -1, row: -1, sx: 0, sy: 0 };
    }

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
    const box = new THREE.Box3().setFromObject(this.gltf.scene);
    return out.set(0, box.max.y * 0.6, 0).applyMatrix4(this.object3d.matrixWorld);
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
    this.mixer.update(s.dt);

    // 体を視線の向きへ(遅れて追う)。回転はキャラの向きの軸で作り、骨の局所の軸へ直して重ねる
    if (this.lookBone) {
      const yaw = THREE.MathUtils.clamp(s.headYaw, -this.maxYaw, this.maxYaw);
      const pitch = THREE.MathUtils.clamp(s.headPitch, -this.maxPitch, this.maxPitch);
      const qc = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch * 0.6, yaw * 0.6, 0, 'YXZ'));
      const oq = this.object3d.getWorldQuaternion(_q1);
      const pq = this.lookBone.parent.getWorldQuaternion(_q2);
      const qd = pq.clone().invert().multiply(oq).multiply(qc).multiply(oq.clone().invert()).multiply(pq);
      this.lookBone.quaternion.premultiply(qd);
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

export async function loadRigCharacter(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`character.json を読めません: ${url} (${res.status})`);
  const json = await res.json();
  const base = new URL(url, location.href);
  const loader = new GLTFLoader();
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
    if (h > 0) c.object3d.scale.setScalar(json.height_m / h);
  }
  return c;
}
