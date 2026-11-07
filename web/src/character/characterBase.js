import * as THREE from 'three';
import { HeadFollower, IdleGaze, anglesToTarget, smoothingAlpha } from './gaze.js';
import { GESTURES, Pose } from './gestures.js';

const EYE_TAU = 0.045; // 目は速く追う
const EXPR_TAU = 0.09;
const _v = new THREE.Vector3();
const _origin = new THREE.Vector3();

/**
 * type が vrm でも rig でも、web/ から同じ呼び方で動かすための土台。
 * lookAt / setExpression / setMouth / play / update は共通。体に書き込む部分だけ、子クラスの _apply が受け持つ。
 */
export class CharacterBase {
  constructor({ id = 'character', name = id, expressions = [], motions = {}, heightM = null } = {}) {
    this.id = id;
    this.name = name;
    this.expressions = expressions;
    this.expressionHints = {}; // 名前 → いつ使うか(日本語)。character.json の expression_hints。頭脳への説明に使う
    this.motionNames = Object.keys(motions);
    this.heightM = heightM;
    this.object3d = new THREE.Group();
    this.object3d.name = `character:${id}`;

    this.pose = new Pose();
    this.head = new HeadFollower();
    this.idle = new IdleGaze();
    this.target = null; // ワールド座標の視線の先。null なら誰も見ていない
    this.eyeTarget = new THREE.Vector3(0, 1.4, 2);
    this.mouth = 0;
    this._mouthSm = 0;
    this.exprTarget = new Map();
    this.exprValue = new Map();
    this.active = null;
    this.time = 0;
    this.blinkTimer = 2 + Math.random() * 3;
    this.blinkT = -1;
    this.blink = 0;
    this._eyeInit = false;
    this.debug = { headYaw: 0, headPitch: 0, eyeYaw: 0, eyePitch: 0 };
  }

  /** 頭のワールド座標(子クラスが決める)。既定は 1.4m の高さ。 */
  _headWorld(out) {
    return out.set(0, 1.4, 0).applyMatrix4(this.object3d.matrixWorld);
  }

  lookAt(worldPosition) {
    if (!worldPosition) {
      this.target = null;
      return;
    }
    if (!this.target) this.target = new THREE.Vector3();
    if (Array.isArray(worldPosition)) this.target.set(...worldPosition);
    else this.target.copy(worldPosition);
  }

  setExpression(name, weight = 1) {
    this.exprTarget.set(name, THREE.MathUtils.clamp(weight, 0, 1));
  }

  /** 感情をひとつだけ選ぶ(ほかの表情は戻す) */
  setEmotion(name, weight = 1) {
    for (const key of this.exprTarget.keys()) {
      if (key !== name) this.exprTarget.set(key, 0);
    }
    this.setExpression(name, weight);
  }

  isCustomExpression() {
    return false;
  }

  setMouth(level) {
    this.mouth = THREE.MathUtils.clamp(level, 0, 1);
  }

  /** 動きを始める。知らない名前なら false */
  play(name, opts = {}) {
    if (!name || name === 'none') return false;
    const def = GESTURES[name];
    if (!def) return false;
    this.active = { def, t: 0, name, opts };
    return true;
  }

  get playing() {
    return this.active ? this.active.name : null;
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.object3d.updateWorldMatrix(true, false);

    // 1. 視線の先をキャラの向きの座標に直し、目と頭に分ける
    this._headWorld(_origin);
    const localOrigin = this.object3d.worldToLocal(_v.copy(_origin)).clone();
    let wantYaw;
    let wantPitch;
    let eyeWorld;
    if (this.target) {
      const localTarget = this.object3d.worldToLocal(this.target.clone());
      ({ yaw: wantYaw, pitch: wantPitch } = anglesToTarget(localOrigin, localTarget));
      eyeWorld = this.target;
    } else {
      ({ yaw: wantYaw, pitch: wantPitch } = this.idle.step(dt));
      const d = 2;
      const local = new THREE.Vector3(
        localOrigin.x + Math.sin(wantYaw) * Math.cos(wantPitch) * d,
        localOrigin.y + Math.sin(wantPitch) * d,
        localOrigin.z + Math.cos(wantYaw) * Math.cos(wantPitch) * d,
      );
      eyeWorld = this.object3d.localToWorld(local);
    }
    if (!this._eyeInit) {
      this.eyeTarget.copy(eyeWorld);
      this._eyeInit = true;
    } else {
      this.eyeTarget.lerp(eyeWorld, smoothingAlpha(dt, EYE_TAU));
    }
    const h = this.head.step(dt, wantYaw, wantPitch);
    this.debug.headYaw = h.yaw;
    this.debug.headPitch = h.pitch;
    this.debug.wantYaw = wantYaw;
    this.debug.wantPitch = wantPitch;

    // 2. 動き・呼吸・口
    this.pose.reset();
    this._idlePose();
    if (this.active) {
      this.active.t += dt;
      if (this.active.t >= this.active.def.duration) this.active = null;
      else this.active.def.apply(this.active.t, this.pose, this.active.opts);
    }
    this._mouthSm += (this.mouth - this._mouthSm) * smoothingAlpha(dt, 0.04);
    this.pose.add('head', 0.05 * this._mouthSm, 0, 0);

    // 3. まばたき
    this._updateBlink(dt);

    // 4. 表情をなめらかに
    const a = smoothingAlpha(dt, EXPR_TAU);
    for (const [key, target] of this.exprTarget) {
      const cur = this.exprValue.get(key) ?? 0;
      this.exprValue.set(key, cur + (target - cur) * a);
    }

    this._apply({
      dt,
      headYaw: h.yaw,
      headPitch: h.pitch,
      eyeTarget: this.eyeTarget,
      pose: this.pose,
      expr: this.exprValue,
      mouth: this._mouthSm,
      blink: this.blink,
    });
  }

  _idlePose() {
    const b = Math.sin((this.time / 4.2) * Math.PI * 2);
    this.pose.add('chest', 0.012 * b, 0, 0);
    this.pose.add('spine', 0.006 * b, 0.01 * Math.sin(this.time * 0.37), 0);
    this.pose.add('hips', 0, 0, 0.008 * Math.sin(this.time * 0.29));
  }

  _updateBlink(dt) {
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const u = this.blinkT / 0.16;
      this.blink = u >= 1 ? 0 : Math.sin(u * Math.PI);
      if (u >= 1) this.blinkT = -1;
    } else {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blinkT = 0;
        this.blinkTimer = 2 + Math.random() * 4;
      }
    }
  }

  _apply() {
    throw new Error('_apply は子クラスで書く');
  }

  /**
   * GPU に上げた物(形・材質・絵)を捨てる。舞台から外れた子が、スマホのメモリを持ち続けないように(QA 高 1)。
   * 中の形のデータは残すので、あとで舞台へ戻せば次の描画で作り直される(控えの子を切り替えで戻しても壊れない)。
   * 何度呼んでも大丈夫。
   */
  releaseGpu() {
    const seen = new Set();
    const drop = (m) => {
      if (!m || seen.has(m)) return;
      seen.add(m);
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose?.();
    };
    this.object3d.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh && !o.isPoints && !o.isLine) return;
      o.geometry?.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(drop);
      o.skeleton?.boneTexture?.dispose?.();
    });
  }

  /** もう使わない子の後片づけ(GPU の物を捨て、舞台から外す)。使い回す子には使わず、releaseGpu を使う */
  dispose() {
    this.releaseGpu();
    this.object3d.removeFromParent();
  }
}
