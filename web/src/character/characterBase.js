import * as THREE from 'three';
import { HeadFollower, IdleGaze, anglesToTarget, smoothingAlpha } from './gaze.js';
import { GESTURES, Pose } from './gestures.js';
// B5G かわいい仕草の層: どのキャラにも同じ名前で効く仕草(待つ・聞く・考える・話す の状態と、返事で頼む仕草)
import { CuteLayer } from './cuteLayer.js';

/** 腕と体の形は gestures.js(VRM・2D)か、キャラの動き clip(rig)が作る仕草。仕草の層は体の添え物だけを足す */
const ARM_BY_POSE = new Set(['bow', 'wave', 'point']);

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
    // 仕草の層。腕・首・耳・しっぽがあるかは、子クラスが骨を見て caps を直す
    this.cute = new CuteLayer();
    this.cuteOut = this.cute.out;
  }

  /** いまの状態('idle' | 'listening' | 'thinking' | 'talking')。画面(main.js)が毎コマ渡す */
  setActivity(name) {
    this.cute.setActivity(name);
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
    this.cute.onEmotion(name, weight); // 仕草が頼まれなければ、表情に合う小さな仕草が付く
  }

  isCustomExpression() {
    return false;
  }

  setMouth(level) {
    this.mouth = THREE.MathUtils.clamp(level, 0, 1);
  }

  /** 動きを始める。知らない名前なら false。仕草の層の名前(happy・greet・shy …)はどのキャラでも動く */
  play(name, opts = {}) {
    if (!name || name === 'none') return false;
    const key = String(name).trim().toLowerCase();
    const def = GESTURES[key];
    if (def && ARM_BY_POSE.has(key)) {
      // 腕と体の形は gestures.js。仕草の層は顔・体の添え物だけ(腕を二重に上げない)
      this.active = { def, t: 0, name: key, opts };
      this.cute.trigger(key, { clipArm: true, intensity: opts.intensity });
      return true;
    }
    if (this.cute.trigger(key, { intensity: opts.intensity, pointSide: opts.dx })) return true;
    if (!def) return false;
    this.active = { def, t: 0, name: key, opts };
    return true;
  }

  get playing() {
    return this.active ? this.active.name : this.cute.playing;
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.object3d.updateWorldMatrix(true, false);
    // 0. 仕草の層を 1 コマ進める(聞く時は、前のコマで見ていた人の向きへ体を少し向ける)
    const cute = this.cute.step(dt, { gazeYaw: this.target ? (this.debug.personYaw ?? 0) : 0, clipBusy: Boolean(this.active) });
    this.cuteOut = cute;

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
      eyeWorld = null;
    }
    this.debug.personYaw = wantYaw; // 仕草の層が「話す人の方へ向く」に使う(目線の足し分を入れる前)
    // 仕草の目線(考える時は上・てれる時は下とよそ)を足す
    if (cute.gazeX || cute.gazeY) {
      wantYaw += cute.gazeX;
      wantPitch += cute.gazeY;
      eyeWorld = null;
    }
    if (!eyeWorld) {
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
    // 首は、仕草の目線の足し分の 4 割だけ追う(残りは目が動く。考える時の上目・てれる時のよそ見で、首が回りすぎない)
    const h = this.head.step(dt, wantYaw - 0.6 * cute.gazeX, wantPitch - 0.6 * cute.gazeY);
    this.debug.headYaw = h.yaw;
    this.debug.headPitch = h.pitch;
    this.debug.wantYaw = wantYaw;
    this.debug.wantPitch = wantPitch;

    // 2. 動き・呼吸・口
    this.pose.reset();
    this._idlePose(cute);
    if (this.active) {
      this.active.t += dt;
      if (this.active.t >= this.active.def.duration) this.active = null;
      else this.active.def.apply(this.active.t, this.pose, this.active.opts);
    }
    this._mouthSm += (this.mouth - this._mouthSm) * smoothingAlpha(dt, 0.04);
    this.pose.add('head', 0.05 * this._mouthSm, 0, 0);

    // 3. まばたき(仕草の層が、間を毎回変えて決める。二度まばたきも)
    this.blink = cute.blink;

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
      cute,
    });
  }

  /** 仕草の層の数字を、人型の骨の名前(VRM・2D の板が読む Pose)に書く。rig は cuteRig.js が骨に直接書く */
  _idlePose(o = this.cuteOut) {
    const p = this.pose;
    p.add('head', o.headX * 0.6, o.headY * 0.6, o.headZ * 0.6);
    p.add('neck', o.headX * 0.4, o.headY * 0.4, o.headZ * 0.4);
    p.add('spine', o.spineX * 0.5, o.spineY * 0.5, o.spineZ * 0.5);
    p.add('chest', o.spineX * 0.5, o.spineY * 0.5, o.spineZ * 0.5);
    // 腕: 上げる(外へ 2.25 ラジアンまで)・外へ開く・ふる。右腕は z が −、左腕は +
    p.add('rightUpperArm', 0, 0, -(2.25 * o.armRaiseR + o.armOutR));
    p.add('leftUpperArm', 0, 0, 2.25 * o.armRaiseL + o.armOutL);
    p.add('rightLowerArm', 0, 0, -o.armSwingR * 1.4);
    p.add('leftLowerArm', 0, 0, o.armSwingL * 1.4);
    if (o.shoulderL || o.shoulderR) {
      p.add('leftShoulder', 0, 0, o.shoulderL * 12);
      p.add('rightShoulder', 0, 0, -o.shoulderR * 12);
    }
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

  dispose() {
    this.object3d.removeFromParent();
  }
}
