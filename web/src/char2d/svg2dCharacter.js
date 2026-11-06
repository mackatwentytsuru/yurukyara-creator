import * as THREE from 'three';
import { CharacterBase } from '../character/characterBase.js';
import { STANDARD_EXPRESSIONS } from '../character/expressionNames.js';
import { FACE_SLOTS, MOUTH_SHAPES, availableExpressions, faceVariants, listGroupIds, mouthShape, partSvg, pickFaceId, validateParts } from './parts.js';
import { DEFAULT_GAINS, pose2d } from './pose2d.js';

const LAYER_GAP = 0.002; // 板どうしの前後の間(メートル)
const EMOTION_MIN = 0.25; // これより弱い表情は neutral にする
const ARM_FRONT = 1.0; // 腕がこれ(ラジアン)より上がったら頭の前に描く(parts.json の arms.front で変えられる。false なら前に出さない)
const FACE_LAYER_ORDER = 0.3; // 顔の上の動かない部品(鼻など)は、頭の板の上・目と口の下

/**
 * SVG の部品を板(平面)に描いて動かす 2D のキャラ。CharacterBase を継ぐので、
 * lookAt・setExpression・setEmotion・setMouth・play・update は 3D と同じ呼び方で動く。
 *   まばたき = 目の板を縦につぶす / 口 = 3 形を開きの値で切り替える / 表情 = 目・眉・口の板を差し替える
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
    this.state2d = { emotion: 'neutral', mouthShape: 'mouth_closed', eyesScaleY: 1, faceIds: {} };
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
    const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
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
    const names = Object.keys(parts).sort((a, b) => (parts[a].z ?? 0) - (parts[b].z ?? 0));
    for (const name of names) {
      const p = parts[name];
      const pivot = p.pivot ?? [p.box[0] + p.box[2] / 2, p.box[1] + p.box[3] / 2];
      const g = new THREE.Group();
      g.name = `2d:${name}:pivot`;
      const inUpper = p.upper !== false;
      g.position.copy(this._toLocal(pivot[0], pivot[1], inUpper ? waist : null));
      g.userData.base = g.position.clone();
      g.userData.pivot = pivot;
      g.add(this._plane(svg, name, p.box, rasterize, pxPerUnit, p.z ?? 0, pivot));
      (inUpper ? this.upper : this.rig).add(g);
      this.groups[name] = g;
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
    for (const [name, rot] of [['arm_r', m.armR], ['arm_l', m.armL]]) {
      const arm = this.groups[name];
      if (!arm) continue;
      arm.rotation.z = rot;
      // 腕を高く上げたら、頭の前に出す(後ろのままだと、手を振る手が頭に隠れる)
      const mesh = arm.children[0];
      const front = Math.abs(rot) > this.armFront;
      mesh.renderOrder = front ? this.headOrder + 0.5 : mesh.userData.order;
      mesh.position.z = (front ? this.headOrder + 0.5 : mesh.userData.order) * LAYER_GAP;
    }
    this.state2d.motion = m;
  }

  dispose() {
    this.object3d.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    super.dispose();
  }
}
