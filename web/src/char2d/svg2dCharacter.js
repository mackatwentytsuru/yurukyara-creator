import * as THREE from 'three';
import { CharacterBase } from '../character/characterBase.js';
import { STANDARD_EXPRESSIONS } from '../character/expressionNames.js';
import { FACE_SLOTS, MOUTH_SHAPES, availableExpressions, faceVariants, listGroupIds, mouthShape, partSvg, pickFaceId, validateParts } from './parts.js';
import { DEFAULT_GAINS, pose2d } from './pose2d.js';

const LAYER_GAP = 0.002; // 板どうしの前後の間(メートル)
const EMOTION_MIN = 0.25; // これより弱い表情は neutral にする
const ARM_FRONT = 1.0; // 腕がこれ(ラジアン)より上がったら頭の前に描く(parts.json の arms.front で変えられる。false なら前に出さない)
const FACE_LAYER_ORDER = 0.3; // 顔の上の動かない部品(鼻など)は、頭の板の上・目と口の下
// 向こうを向く動き 'turn'(後ろ姿の板があるキャラだけ): 0.55 秒で後ろを向き、1.4 秒そのまま、0.65 秒で前へ戻る(1 回り)
const TURN = { out: 0.55, hold: 1.4, back: 0.65 };
const TURN_TOTAL = TURN.out + TURN.hold + TURN.back;
const FACING_TAU = 0.12; // setFacing で向きを変える速さ(秒)
const easeInOut = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** 向こうを向く動きの、その時の向き(ラジアン。0 = 正面、π = 後ろ、2π = 1 回りして正面) */
export function turnAngle(t) {
  if (t <= TURN.out) return Math.PI * easeInOut(t / TURN.out);
  if (t <= TURN.out + TURN.hold) return Math.PI;
  return Math.PI * (1 + easeInOut((t - TURN.out - TURN.hold) / TURN.back));
}

/** 親のある部品(前腕など)が、親より後に作られる順にする。ほかは z の順 */
function partOrder(parts) {
  const names = Object.keys(parts).sort((a, b) => (parts[a].z ?? 0) - (parts[b].z ?? 0));
  const out = [];
  const seen = new Set();
  const visit = (n, depth = 0) => {
    if (seen.has(n) || depth > 8) return;
    const parent = parts[n]?.parent;
    if (parent && parent !== 'root' && parts[parent]) visit(parent, depth + 1);
    seen.add(n);
    out.push(n);
  };
  for (const n of names) visit(n);
  return out;
}

/**
 * SVG の部品を板(平面)に描いて動かす 2D のキャラ。CharacterBase を継ぐので、
 * lookAt・setExpression・setEmotion・setMouth・play・update は 3D と同じ呼び方で動く。
 *   まばたき = 目の板を縦につぶす / 口 = 3 形を開きの値で切り替える / 表情 = 目・眉・口の板を差し替える
 *   腕が 2 枚(parts.json の forearm_* に parent)なら、上腕を肩で回し、前腕をひじで曲げる
 *   後ろ姿の板(parts.json の back)があれば、向こうを向いた時(後ろから見た時・play('turn')・setFacing('back'))に後ろ姿が出る
 * 画像にする所(rasterize)は外から渡す。ブラウザでは SVG → canvas、試験では偽物を渡す。
 */
export class Svg2DCharacter extends CharacterBase {
  /**
   * @param {object} o
   * @param {object} o.spec parts.json の中身
   * @param {string} o.svg 部品を <g id> で分けた SVG
   * @param {(svgText:string, size:{w:number,h:number}) => THREE.Texture} o.rasterize
   */
  constructor({ spec, svg, rasterize, id = spec?.id ?? 'char2d', name = id, expressionFallback = {}, pxPerUnit = 1 } = {}) {
    const problems = validateParts(spec, svg);
    if (problems.length) throw new Error(`2D の部品に問題があります: ${problems.join(' / ')}`);
    const variants = faceVariants(listGroupIds(svg));
    super({ id, name, expressions: availableExpressions(variants), motions: {}, heightM: spec.heightM ?? 1 });
    this.kind = '2d';
    this.spec = spec;
    this.variants = variants;
    this.expressionFallback = { ...(spec.expressionFallback ?? {}), ...expressionFallback };
    this.noBlink = new Set(spec.blink?.noBlink ?? []);
    // キャラごとの動きの効き(腕の大きさ・顔の部品のずれ)と、腕を頭の前に出す角度
    this.gains = { ...DEFAULT_GAINS, ...(spec.gains ?? {}) };
    const front = spec.arms?.front;
    this.armFront = front === false ? Infinity : Number.isFinite(front) ? front : ARM_FRONT;
    // 腕が 2 枚の時: 前腕をこの角度より大きく曲げたら、上腕の後ろへ回す(ひじの丸を前に出し、前腕の線の元を隠す)
    const behind = spec.arms?.foreBehind;
    this.foreBehind = Number.isFinite(behind) ? behind : Infinity;
    this.state2d = { emotion: 'neutral', mouthShape: 'mouth_closed', eyesScaleY: 1, faceIds: {}, facing: 'front' };
    // 後ろ姿の板があるキャラは、前の板を表だけ描く(後ろから見ると前の板は消え、後ろ姿の板が見える)
    this.side = spec.back ? THREE.FrontSide : THREE.DoubleSide;
    this.turnT = null; // 向こうを向く動きの経過(秒)。null なら動いていない
    this.facingTarget = 0; // setFacing の向き(0 = 正面、π = 後ろ)
    const [vx, vy, vw, vh] = spec.viewBox;
    this.unit = this.heightM / vh; // 元の座標 1 → メートル
    this.origin = { x: vx + vw / 2, y: vy + vh }; // 足もとの真ん中を原点にする
    this._build(svg, rasterize, pxPerUnit);
  }

  /** 元の SVG の座標 → この板の親の中の座標(メートル) */
  _toLocal(x, y, parentPivot = null) {
    const px = parentPivot ? parentPivot[0] : this.origin.x;
    const py = parentPivot ? parentPivot[1] : this.origin.y;
    return new THREE.Vector3((x - px) * this.unit, (py - y) * this.unit, 0);
  }

  _plane(svg, gid, box, rasterize, pxPerUnit, order, parentPivot) {
    const [x, y, w, h] = box;
    const text = partSvg(svg, gid, box, pxPerUnit);
    const map = rasterize(text, { w: Math.round(w * pxPerUnit), h: Math.round(h * pxPerUnit) });
    const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: this.side ?? THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * this.unit, h * this.unit), mat);
    mesh.name = `2d:${gid}`;
    mesh.position.copy(this._toLocal(x + w / 2, y + h / 2, parentPivot));
    mesh.position.z = order * LAYER_GAP;
    mesh.renderOrder = order;
    mesh.userData.order = order;
    return mesh;
  }

  _build(svg, rasterize, pxPerUnit) {
    const { parts, face } = this.spec;
    this.rig = new THREE.Group(); // 弾み
    this.rig.name = '2d:rig';
    this.upper = new THREE.Group(); // おじぎで縦につぶす上半身(腰から上)
    this.upper.name = '2d:upper';
    const waist = this.spec.waist ?? parts.body?.pivot ?? [this.origin.x, this.origin.y];
    this.upper.position.copy(this._toLocal(waist[0], waist[1]));
    this.object3d.add(this.rig);
    this.rig.add(this.upper);

    this.groups = {};
    for (const name of partOrder(parts)) {
      const p = parts[name];
      const pivot = p.pivot ?? [p.box[0] + p.box[2] / 2, p.box[1] + p.box[3] / 2];
      const g = new THREE.Group();
      g.name = `2d:${name}:pivot`;
      const parent = p.parent && p.parent !== 'root' ? this.groups[p.parent] : null;
      const inUpper = p.upper !== false;
      // 親のある部品(前腕)は、親の回る中心から見た位置に置く(親と一緒に回る)
      g.position.copy(parent ? this._toLocal(pivot[0], pivot[1], parent.userData.pivot) : this._toLocal(pivot[0], pivot[1], inUpper ? waist : null));
      g.userData.base = g.position.clone();
      g.userData.pivot = pivot;
      g.add(this._plane(svg, name, p.box, rasterize, pxPerUnit, p.z ?? 0, pivot));
      (parent ?? (inUpper ? this.upper : this.rig)).add(g);
      this.groups[name] = g;
    }
    // 後ろ姿の板: 後ろ向き(y で半回り)に置く。前の板と同じ大きさ・同じ足もと
    if (this.spec.back) {
      const b = this.spec.back;
      this.back = new THREE.Group();
      this.back.name = '2d:back:pivot';
      this.back.rotation.y = Math.PI;
      const mesh = this._plane(svg, b.id ?? 'back', b.box, rasterize, pxPerUnit, 0, null);
      mesh.position.z = LAYER_GAP; // 後ろ向きの板の手前 = 体の後ろ
      this.back.add(mesh);
      this.rig.add(this.back);
    }

    // 顔の枠: 表情ごとの板を全部先に作り、出す物だけ見せる(差し替えは見える・見えないの切り替えだけ)
    const head = this.groups.head;
    const headPivot = head.userData.pivot;
    const headZ = parts.head.z ?? 0;
    this.headOrder = headZ;
    this.face = new THREE.Group();
    this.face.name = '2d:face';
    head.add(this.face);
    this.facePlanes = new Map(); // gid → mesh
    this.slotGroups = {};
    // 顔の上の動かない部品(parts.json の faceLayers。鼻など)。表情では替えず、目と口と一緒に動く
    // (頭が横を向いて顔の部品がずれた時に、口と鼻がはなれない)
    this.faceLayers = {};
    for (const layer of this.spec.faceLayers ?? []) {
      const mesh = this._plane(svg, layer.id, layer.box, rasterize, pxPerUnit, headZ + FACE_LAYER_ORDER, headPivot);
      this.face.add(mesh);
      this.faceLayers[layer.id] = mesh;
    }
    for (const slot of FACE_SLOTS) {
      const boxKey = MOUTH_SHAPES.includes(slot) ? 'mouth' : slot;
      const box = face[boxKey]?.box;
      if (!box) continue;
      const sg = new THREE.Group();
      sg.name = `2d:slot:${slot}`;
      // まばたきで縦につぶす中心は、枠の真ん中
      const c = [box[0] + box[2] / 2, box[1] + box[3] / 2];
      sg.position.copy(this._toLocal(c[0], c[1], headPivot));
      this.face.add(sg);
      this.slotGroups[slot] = sg;
      const order = headZ + 1 + FACE_SLOTS.indexOf(slot) * 0.1;
      for (const [emotion, slots] of this.variants) {
        if (!slots.has(slot)) continue;
        const gid = `face.${emotion}.${slot}`;
        const mesh = this._plane(svg, gid, box, rasterize, pxPerUnit, order, c);
        mesh.visible = false;
        sg.add(mesh);
        this.facePlanes.set(gid, mesh);
      }
    }
    this.headSize = { w: parts.head.box[2] * this.unit, h: parts.head.box[3] * this.unit };
    this._showFace('neutral', 'mouth_closed');
  }

  _headWorld(out) {
    return this.groups.head.getWorldPosition(out);
  }

  /** 動きを始める。'turn' は後ろ姿の板があるキャラだけ(向こうを向いて、1 回りして戻る) */
  play(name, opts = {}) {
    if (name === 'turn') {
      if (!this.back) return false;
      this.turnT = 0;
      return true;
    }
    return super.play(name, opts);
  }

  get playing() {
    return this.turnT !== null ? 'turn' : super.playing;
  }

  /** 'back' で向こうを向いたまま、'front' で正面へ戻る(後ろ姿の板があるキャラだけ。無ければ false) */
  setFacing(which) {
    if (!this.back) return false;
    this.facingTarget = which === 'back' ? Math.PI : 0;
    return true;
  }

  /** そのキャラが 2D で出せる表情か */
  canShow(name) {
    return this.variants.has(name);
  }

  isCustomExpression(name) {
    return this.variants.has(name) && !STANDARD_EXPRESSIONS.includes(name);
  }

  /** いちばん強い表情を 1 つ選ぶ(弱ければ neutral)。2D は混ぜずに差し替える */
  _dominantEmotion(expr) {
    let best = 'neutral';
    let bestV = EMOTION_MIN;
    for (const [name, v] of expr) {
      if (v > bestV) {
        best = name;
        bestV = v;
      }
    }
    return best;
  }

  _showFace(emotion, shape) {
    const want = new Set();
    const ids = {};
    for (const slot of ['eyes', 'brows', shape]) {
      const gid = pickFaceId(this.variants, emotion, slot, this.expressionFallback);
      if (gid) want.add(gid);
      ids[slot === shape ? 'mouth' : slot] = gid;
    }
    for (const [gid, mesh] of this.facePlanes) mesh.visible = want.has(gid);
    this.state2d.faceIds = ids;
  }

  _apply(s) {
    const emotion = this._dominantEmotion(s.expr);
    const shape = mouthShape(s.mouth, this.state2d.mouthShape);
    if (emotion !== this.state2d.emotion || shape !== this.state2d.mouthShape) this._showFace(emotion, shape);
    this.state2d.emotion = emotion;
    this.state2d.mouthShape = shape;

    // まばたき(目を閉じた絵の表情ではしない)
    const eyesShown = this.state2d.faceIds.eyes?.split('.')[1];
    const blink = this.noBlink.has(eyesShown) ? 0 : s.blink;
    const eyesScaleY = Math.max(0.08, 1 - blink);
    if (this.slotGroups.eyes) this.slotGroups.eyes.scale.y = eyesScaleY;
    this.state2d.eyesScaleY = eyesScaleY;

    // 体の動き
    const m = pose2d(s.pose, { headYaw: s.headYaw, headPitch: s.headPitch, time: this.time }, this.gains);
    this.rig.position.y = m.rootY * this.heightM;
    this.upper.scale.y = m.upperSquash;
    const head = this.groups.head;
    head.position.set(head.userData.base.x + m.headX * this.headSize.w, head.userData.base.y + m.headY * this.headSize.h, head.userData.base.z);
    head.rotation.z = m.headRot;
    // 上半身のつぶしを頭では打ち消す(頭は丸いまま、少し手前へ大きく)
    head.scale.set(m.headGrow, (m.headSquash * m.headGrow) / this.upper.scale.y, 1);
    this.face.position.set(m.faceX * this.headSize.w, m.faceY * this.headSize.h, 0);
    for (const side of ['r', 'l']) {
      const arm = this.groups[`arm_${side}`];
      if (!arm) continue;
      // 腕が 2 枚なら、上腕は肩で回し、前腕はひじで曲げる。1 枚なら腕全体を肩で回す
      const fore = this.groups[`forearm_${side}`];
      const rot = fore ? (side === 'r' ? m.upperR : m.upperL) : side === 'r' ? m.armR : m.armL;
      arm.rotation.z = rot;
      if (fore) {
        fore.rotation.z = side === 'r' ? m.foreR : m.foreL;
        const fm = fore.children[0];
        const am = arm.children[0];
        const back = Math.abs(fore.rotation.z) > this.foreBehind;
        const order = back ? am.userData.order - 0.05 : fm.userData.order;
        fm.renderOrder = order;
        fm.position.z = order * LAYER_GAP;
      }
      // 腕を高く上げたら、頭の前に出す(後ろのままだと、手を振る手が頭に隠れる)
      const mesh = arm.children[0];
      const front = Math.abs(rot) > this.armFront;
      mesh.renderOrder = front ? this.headOrder + 0.5 : mesh.userData.order;
      mesh.position.z = (front ? this.headOrder + 0.5 : mesh.userData.order) * LAYER_GAP;
    }
    this.state2d.motion = m;
    this._applyFacing(s.dt ?? 0);
  }

  /** 向こうを向く動き(turn)と setFacing の向き。後ろ姿の板が無いキャラは何もしない */
  _applyFacing(dt) {
    if (!this.back) return;
    let yaw;
    if (this.turnT !== null) {
      this.turnT += dt;
      if (this.turnT >= TURN_TOTAL) {
        this.turnT = null;
        yaw = this.facingTarget;
      } else yaw = turnAngle(this.turnT);
    } else {
      const cur = this.rig.rotation.y % (Math.PI * 2);
      yaw = cur + (this.facingTarget - cur) * (dt > 0 ? 1 - Math.exp(-dt / FACING_TAU) : 0);
    }
    this.rig.rotation.y = yaw;
    this.state2d.facing = Math.cos(yaw) >= 0 ? 'front' : 'back';
  }

}
