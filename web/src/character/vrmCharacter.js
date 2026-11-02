import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { CharacterBase } from './characterBase.js';
import { REST_POSE } from './gestures.js';

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

  /** 名前を VRM の表情に直す。think が無いモデルでは relaxed を弱く使う */
  _resolve(name, value, out) {
    const key = EXPRESSION_ALIAS[name] ?? name;
    if (this.available.has(key)) {
      out.set(key, Math.max(out.get(key) ?? 0, value));
    } else if (key === 'think' && this.available.has('relaxed')) {
      out.set('relaxed', Math.max(out.get('relaxed') ?? 0, value * 0.5));
    }
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
      for (const key of EMOTIONS) em.setValue(key, out.get(key) ?? 0);
      if (this.available.has('neutral')) em.setValue('neutral', out.get('neutral') ?? 0);
      // 口: 母音は aa を主に、少しだけ oh を混ぜる
      const m = s.mouth;
      const wob = 0.5 + 0.5 * Math.sin(this.time * 9);
      for (const key of MOUTH_EXPRESSIONS) em.setValue(key, 0);
      em.setValue('aa', m * (0.65 + 0.35 * wob));
      em.setValue('oh', m * 0.35 * (1 - wob));
      // 笑顔などで目が細くなっているときは、まばたきを弱める
      const emotional = Math.max(out.get('happy') ?? 0, out.get('relaxed') ?? 0);
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
    if (h > 0) character.object3d.scale.setScalar(config.heightM / h);
  }
  return character;
}
