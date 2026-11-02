import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { CharacterBase } from './characterBase.js';
import { REST_POSE } from './gestures.js';
import { nearestExpression } from './expressionNames.js';

/** VRM の表情の別名。character.json の expressions にある名前を、VRM の名前に直す。 */
const EXPRESSION_ALIAS = {
  neutral: 'neutral',
  happy: 'happy',
  sad: 'sad',
  angry: 'angry',
  surprised: 'surprised',
  relaxed: 'relaxed',
  think: 'think', // 無ければ relaxed を弱く使う(_resolve)
};
const MOUTH_EXPRESSIONS = ['aa', 'ih', 'ou', 'ee', 'oh'];
const EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'relaxed'];
// 口・まばたき・目線は感情ではない(別の所で動かす)。それ以外の表情は、感情として毎コマ決める
const NOT_EMOTION = new Set([...MOUTH_EXPRESSIONS, 'blink', 'blinkLeft', 'blinkRight', 'lookUp', 'lookDown', 'lookLeft', 'lookRight']);
const STANDARD_PRESETS = new Set(['neutral', ...EMOTIONS]);

// 視線の回転を骨に配る割合(足して 1)。目は VRM の lookAt が別に受け持つ
const GAZE_SPLIT = { chest: 0.1, neck: 0.4, head: 0.5 };

export class VrmCharacter extends CharacterBase {
  constructor(vrm, config) {
    super(config);
    this.vrm = vrm;
    this.object3d.add(vrm.scene);
    this.gazeTarget = new THREE.Object3D();
    if (vrm.lookAt) vrm.lookAt.target = this.gazeTarget;
    this.bones = new Map();
    for (const name of [
      'hips', 'spine', 'chest', 'neck', 'head',
      'leftShoulder', 'rightShoulder',
      'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
    ]) {
      const node = vrm.humanoid?.getNormalizedBoneNode(name);
      if (node) this.bones.set(name, node);
    }
    this.available = new Set(vrm.expressionManager ? Object.keys(vrm.expressionManager.expressionMap) : []);
    this.emotionKeys = [...this.available].filter((k) => !NOT_EMOTION.has(k));
    this.customKeys = this.emotionKeys.filter((k) => !STANDARD_PRESETS.has(k)); // そのキャラだけの表情(ウインク・照れ など)
    this.expressionFallback = config.expressionFallback ?? {};
    this._warned = new Set();
    if (!config.expressions?.length) {
      this.expressions = ['neutral', ...EMOTIONS.filter((e) => this.available.has(e))];
    }
    this._headTmp = new THREE.Vector3();
  }

  _headWorld(out) {
    const head = this.bones.get('head');
    if (head) return head.getWorldPosition(out);
    return super._headWorld(out);
  }

  /** そのキャラだけの表情か(漫符の板が値に比例して大きくなる物があるので、出すときは 1.0 で使う) */
  isCustomExpression(name) {
    return this.customKeys.includes(name);
  }

  /** 名前を VRM の表情に直す。この VRM に無い名前は、近い表情に落とす(think は relaxed を弱く) */
  _resolve(name, value, out) {
    const key = EXPRESSION_ALIAS[name] ?? name;
    if (this.available.has(key)) {
      out.set(key, Math.max(out.get(key) ?? 0, value));
      return;
    }
    const near = nearestExpression(key, (n) => this.available.has(n), this.expressionFallback);
    if (!near) return;
    if (key !== 'think' && !this._warned.has(key)) {
      this._warned.add(key);
      console.warn(`この VRM に表情 ${key} が無いので ${near} で出します`);
    }
    out.set(near, Math.max(out.get(near) ?? 0, key === 'think' ? value * 0.5 : value));
  }

  _apply(s) {
    const { pose, expr } = s;
    // 視線: 頭・首・胸に配る。yaw は +Y 回り、pitch は上を向くと X が負
    for (const [bone, k] of Object.entries(GAZE_SPLIT)) {
      pose.add(bone, -s.headPitch * k, s.headYaw * k, 0);
    }
    // 基本の姿勢 + 足し込み
    const names = new Set([...this.bones.keys()]);
    for (const name of names) {
      const node = this.bones.get(name);
      const rest = REST_POSE[name] ?? [0, 0, 0];
      const add = pose.map.get(name) ?? [0, 0, 0];
      node.rotation.set(rest[0] + add[0], rest[1] + add[1], rest[2] + add[2]);
    }

    // 目: VRM の lookAt に任せる(頭が回るほど、目は中央に戻る)
    this.gazeTarget.position.copy(s.eyeTarget);
    this.gazeTarget.updateMatrixWorld(true);

    // 表情
    const em = this.vrm.expressionManager;
    if (em) {
      const out = new Map();
      for (const [name, value] of expr) this._resolve(name, value, out);
      for (const key of this.emotionKeys) em.setValue(key, out.get(key) ?? 0);
      // 口: 母音は aa を主に、少しだけ oh を混ぜる
      const m = s.mouth;
      const wob = 0.5 + 0.5 * Math.sin(this.time * 9);
      for (const key of MOUTH_EXPRESSIONS) em.setValue(key, 0);
      em.setValue('aa', m * (0.65 + 0.35 * wob));
      em.setValue('oh', m * 0.35 * (1 - wob));
      // 笑顔などで目が細くなっているときは、まばたきを弱める
      // そのキャラだけの表情(ウインク・泣き顔 など)も、目の形が変わるので、まばたきを弱める
      const emotional = Math.max(out.get('happy') ?? 0, out.get('relaxed') ?? 0, ...this.customKeys.map((k) => out.get(k) ?? 0));
      em.setValue('blink', s.blink * (1 - 0.7 * emotional));
    }
    this.vrm.update(s.dt);
  }
}

/** ブラウザで VRM を読み込む */
export async function loadVrm(url, config = {}) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('VRM として読めませんでした: ' + url);
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // VRM 0.x は後ろ向きなので回す。1.0 では何もしない
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
  });
  const character = new VrmCharacter(vrm, config);
  if (config.heightM) {
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const h = box.max.y - box.min.y;
    // 大きさは中身に掛ける。object3d の座標は、いつもメートルのまま(場所に立たせるときに合わせやすい)
    if (h > 0) vrm.scene.scale.multiplyScalar(config.heightM / h);
  }
  return character;
}
