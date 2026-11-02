import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CharacterBase } from './characterBase.js';

/**
 * 人型の骨でないキャラ(type: "rig")。GLB の骨とシェイプキーで動かす。
 * character.json の look / mouth の形は、キャラの柱が最終的に決める。ここで読めるのは仮の形:
 *   "look":  { "head": "骨の名前", "eyes": ["骨の名前", ...], "eye_morphs": {...} (未対応), "max_deg": 35 }
 *   "mouth": { "morph": "シェイプキーの名前" }  または  { "bone": "骨の名前", "axis": "x", "max_deg": 18 }
 * 表情は、シェイプキーの名前が表情の名前と同じものを動かす。
 * 動きは、GLB の中のアニメーション名が play(name) の name と同じものを流す。無ければ首と体の手続きの動き。
 */
export class RigCharacter extends CharacterBase {
  constructor(gltf, config) {
    super(config);
    this.gltf = gltf;
    this.object3d.add(gltf.scene);
    this.look = config.look ?? {};
    this.mouthCfg = config.mouth ?? {};
    this.maxLook = THREE.MathUtils.degToRad(this.look.max_deg ?? 35);

    this.headBone = this.look.head ? gltf.scene.getObjectByName(this.look.head) : null;
    this.eyeBones = (this.look.eyes ?? []).map((n) => gltf.scene.getObjectByName(n)).filter(Boolean);
    this.mouthBone = this.mouthCfg.bone ? gltf.scene.getObjectByName(this.mouthCfg.bone) : null;
    this.restQuat = new Map();
    for (const b of [this.headBone, this.mouthBone, ...this.eyeBones]) {
      if (b) this.restQuat.set(b, b.quaternion.clone());
    }

    // シェイプキーを持つメッシュを集める
    this.morphMeshes = [];
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary) this.morphMeshes.push(o);
    });

    // GLB の中のアニメーション
    this.mixer = new THREE.AnimationMixer(gltf.scene);
    this.clips = new Map(gltf.animations.map((c) => [c.name, c]));
    this.motionNames = [...new Set([...this.motionNames, ...this.clips.keys()])];
    this.currentAction = null;
  }

  _headWorld(out) {
    if (this.headBone) return this.headBone.getWorldPosition(out);
    return super._headWorld(out);
  }

  play(name) {
    const clip = this.clips.get(name);
    if (clip) {
      const action = this.mixer.clipAction(clip);
      action.reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
      action.play();
      this.currentAction = action;
      return true;
    }
    return super.play(name);
  }

  _setMorph(name, value) {
    for (const mesh of this.morphMeshes) {
      const i = mesh.morphTargetDictionary[name];
      if (i !== undefined) mesh.morphTargetInfluences[i] = value;
    }
  }

  _hasMorph(name) {
    return this.morphMeshes.some((m) => m.morphTargetDictionary[name] !== undefined);
  }

  _apply(s) {
    this.mixer.update(s.dt);
    const lim = this.maxLook;
    const yaw = THREE.MathUtils.clamp(s.headYaw, -lim, lim);
    const pitch = THREE.MathUtils.clamp(s.headPitch, -lim, lim);
    const add = s.pose.map.get('head') ?? [0, 0, 0];
    const neck = s.pose.map.get('neck') ?? [0, 0, 0];

    if (this.headBone) {
      const q = this.restQuat.get(this.headBone);
      const e = new THREE.Euler(-pitch + add[0] + neck[0], yaw + add[1] + neck[1], add[2] + neck[2]);
      this.headBone.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(e));
    }
    // 目の骨: 目標の向きをそのまま(頭が回った分は引く)
    if (this.eyeBones.length) {
      const wantYaw = this.debug.wantYaw ?? 0;
      const wantPitch = this.debug.wantPitch ?? 0;
      const ey = THREE.MathUtils.clamp(wantYaw - yaw, -0.6, 0.6);
      const ep = THREE.MathUtils.clamp(wantPitch - pitch, -0.4, 0.4);
      for (const bone of this.eyeBones) {
        const q = this.restQuat.get(bone);
        bone.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-ep, ey, 0)));
      }
    }
    // 体の前かがみ(お辞儀)は、根元を少し傾けて表す
    const spine = s.pose.map.get('spine');
    this.object3d.rotation.x = spine ? spine[0] : 0;

    // 口
    if (this.mouthCfg.morph) this._setMorph(this.mouthCfg.morph, s.mouth);
    if (this.mouthBone) {
      const q = this.restQuat.get(this.mouthBone);
      const ang = THREE.MathUtils.degToRad(this.mouthCfg.max_deg ?? 18) * s.mouth;
      const axis = this.mouthCfg.axis ?? 'x';
      const e = new THREE.Euler(axis === 'x' ? ang : 0, axis === 'y' ? ang : 0, axis === 'z' ? ang : 0);
      this.mouthBone.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(e));
    }
    // 表情とまばたき(同じ名前のシェイプキーがあれば)
    for (const [name, value] of s.expr) {
      if (this._hasMorph(name)) this._setMorph(name, value);
    }
    if (this._hasMorph('blink')) this._setMorph('blink', s.blink);
  }
}

export async function loadRig(url, config = {}) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const character = new RigCharacter(gltf, config);
  if (config.heightM) {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const h = box.max.y - box.min.y;
    if (h > 0) character.object3d.scale.setScalar(config.heightM / h);
  }
  return character;
}
