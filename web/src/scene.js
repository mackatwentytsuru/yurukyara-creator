import * as THREE from 'three';
// 上の段と下の帯の間に収める計算(three を読まない小さな部品)
import { fitBand, fullSpan, topPad, MOTION_TOLERANCE } from './stage/framing.js';

/** ふだんの画角(度)。部屋の中で下がれない時だけ広げる */
const BASE_FOV = 28;

/** 床にやわらかい丸い影を敷く(画像ファイルは使わず、その場で描く) */
function makeFloorGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,214,170,0.55)');
  grad.addColorStop(0.5, 'rgba(255,170,120,0.16)');
  grad.addColorStop(1, 'rgba(255,170,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1.1, 48),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  return mesh;
}

/**
 * 舞台。背景は透明にして、ページの色を見せる(AR や LED の背景に差し替えやすい)。
 * キャラは原点に +z を向いて立ち、カメラは +z 側から見る(docs/共通の決まり.md)。
 */
export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true; // Quest の VR/AR で使う(入らないときは、ふつうに描く)

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 60);

  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x2a2540, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(1.2, 2.4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 0.8);
  rim.position.set(-2, 1.6, -1.5);
  scene.add(rim);
  scene.add(makeFloorGlow());

  // bottomInset: 下の帯の高さ(px。main.js が測る)。topGuard(left, right): 画面の横の範囲に重なる上の段の下の端(px。main.js が渡す)。
  // topInset: いま避けている上の段の高さ(px。frameCharacter が書く。試験と確かめ用)
  const state = { view: 'bust', height: 1.5, headY: 1.35, immersive: false, bottomInset: 0, topGuard: null, topInset: 0 };

  /**
   * キャラの大きさ・位置・向きに合わせてカメラを置く。bust は腰から上、full は全身。
   * state.headY と state.camZ は、キャラの座標(足元が原点・+z が正面)での値。
   * 上の段(札・ボタン・「Claude の考え」の見出し)と下の帯の間に収める: 1 回置いてキャラの横の範囲を測り、
   * state.topGuard(left, right)(main.js が渡す。上の段の下の端 + 画面の高さの 6%。上の段は横の位置にかかわらず数える)より上に
   * キャラの上の端が来ていれば、その線から置き直す(スマホの幅で頭と耳が段の下に入った。11/7 PC で耳が画面の上の端で切れた)。
   * 2 回目はキャラが小さくなるだけなので、横に重なる段は増えない。
   */
  function frameCharacter(character, view = state.view, obstacles = state.obstacles) {
    state.view = view;
    state.obstacles = obstacles;
    character.object3d.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(character.object3d);
    const viewW = canvas.clientWidth || window.innerWidth;
    const viewH = canvas.clientHeight || window.innerHeight;
    // wScale: 遠近で手前の羽・腕が画面の横の端で切れる時に、横幅の見込みを広げる倍率(下の「横」の確かめ。L1 高: ちょうちんくんの羽が幅 390・430 で切れた)
    // 横に広い子(ちょうちんくんなど。幅が高さの 0.8 倍より大きい)は、羽が話す・跳ねる間に止まった箱の外へ振れるので、最初から 15% 広く見込む
    const wide = view === 'full' && (halfWidth(character, box, character.object3d.getWorldPosition(new THREE.Vector3())) * 2) / Math.max(0.3, box.max.y - box.min.y) > 0.8;
    let wScale = wide ? 1.15 : 1;
    const put = (px) => placeCamera(character, box, view, obstacles, viewH, px, wScale);
    put(0);
    let topPx = 0;
    if (typeof state.topGuard === 'function' && !state.immersive) {
      // 動きで上へ出る分(跳ねる・手を振る。rig の読み込みで測った割合)も含めて、上の段の線より上に出るかを見る
      const reach = box.clone();
      const rise = Number(character.motionRise);
      if (rise > 0) reach.max.y += rise * (box.max.y - box.min.y);
      const span = screenSpan(reach, viewW, viewH);
      const guard = Number(state.topGuard(span.left, span.right)) || 0;
      if (guard > 0 && span.top < guard) {
        topPx = guard;
        put(topPx);
        // 遠近: 頭がキャラの真ん中の面より前にあると、計算(真ん中の面)より上に写る。止まった形のいちばん上の点(+ 動きの分)を画面へ写し、
        // 線より上なら、その分だけ帯の上を下げて置き直す(rig だけ。点は読み込みで測る)。2 回で収まる
        for (let k = 0; k < 2; k++) {
          const t = pointsTop(character, box, viewH);
          if (!(t < guard - 0.5)) break;
          topPx += guard - t;
          put(topPx);
        }
      }
    }
    // 横: 全身で、遠近で手前に出た羽・腕の角が画面の横の端より外へ出る時は、見込みの幅を広げて置き直す(小さくなるだけなので、頭のすき間は広がる)
    if (view === 'full' && !state.immersive && viewW > 0) {
      const edge = Math.max(8, viewW * 0.05); // 羽は話す・跳ねる間に箱の外へ振れる(430×932 のちょうちんくんで、止まった箱は収まっても羽が両端で切れた)ので、片側 5% 空ける
      for (let k = 0; k < 3; k++) {
        const sp = screenSpan(box, viewW, viewH);
        if (sp.left >= edge && sp.right <= viewW - edge) break;
        wScale *= Math.min(1.6, (sp.right - sp.left + 2 * edge) / viewW);
        put(topPx);
      }
    }
    state.topInset = topPx;
    return state;
  }

  /** 止まった形のいちばん上の点(character.topPoints、キャラの座標)を、動きで上へ出る分だけ上げて画面へ写した、いちばん上(px)。点が無ければ Infinity */
  function pointsTop(character, box, viewH) {
    const pts = character.topPoints;
    if (!Array.isArray(pts) || !pts.length) return Infinity;
    camera.updateMatrixWorld(true);
    character.object3d.updateWorldMatrix(true, false);
    const sy = character.object3d.getWorldScale(new THREE.Vector3()).y || 1;
    const rise = Number(character.motionRise);
    if (!(rise >= 0)) return Infinity; // 測れていない子は確かめない(余白は前のまま)
    const lift = ((rise + MOTION_TOLERANCE) * (box.max.y - box.min.y)) / sy;
    const v = new THREE.Vector3();
    let top = Infinity;
    for (const [x, y, z] of pts) {
      v.set(x, y + lift, z);
      character.object3d.localToWorld(v).project(camera);
      top = Math.min(top, ((1 - v.y) / 2) * viewH);
    }
    return top;
  }

  /** 箱の 8 つの角を画面へ写した、横の範囲と上の端(px) */
  function screenSpan(box, viewW, viewH) {
    camera.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          v.set(x, y, z).project(camera);
          left = Math.min(left, ((v.x + 1) / 2) * viewW);
          right = Math.max(right, ((v.x + 1) / 2) * viewW);
          top = Math.min(top, ((1 - v.y) / 2) * viewH);
        }
      }
    }
    return { left, right, top };
  }

  /** キャラの正面にカメラを置く。topPx は避ける上の段の下の端(px) */
  function placeCamera(character, box, view, obstacles, viewH, topPx, wScale = 1) {
    const base = character.object3d.getWorldPosition(new THREE.Vector3());
    const height = Math.max(0.3, box.max.y - box.min.y);
    const floor = box.min.y - base.y; // キャラの原点から見た足元の高さ
    state.height = height;
    state.headY = floor + height * 0.9;
    const aspect = camera.aspect;
    const fov = THREE.MathUtils.degToRad(BASE_FOV);
    // 全身: 足元の下に FULL_PAD。頭の上は、動き(跳ねる・手を振る)で上へ出る分(character.motionRise、rig の読み込みで測る)+ 余り。
    // 上の段の線で置き直す時は、動かないキャラは余白を小さくして大きく見せる(framing.js の topPad)
    const span = fullSpan(topPad(character.motionRise, topPx > 0));
    const visibleH = view === 'full' ? height * span.visible : height * 0.62;
    const centerY = floor + (view === 'full' ? height * span.center : height * 0.67);
    // 横が狭い画面(スマホ)でも、肩と腕が入るようにする。全身のときは、キャラの実際の幅(真ん中から遠い側の 2 倍)も入れる
    const width = (view === 'full' ? Math.max(height * 0.55, halfWidth(character, box, base) * 2 * 1.04) : height * 0.4) * wScale;
    // 全身のときは、下の入力の帯(字幕・ボタン・入力欄)に足が隠れないよう、帯の上の範囲に全身を収める。上の段の下からにも収める
    const bottomPx = view === 'full' ? state.bottomInset ?? 0 : 0;
    const band = fitBand({ viewH, topPx, bottomPx, needH: visibleH, needW: width, aspect });
    let dist = band.neededH / (2 * Math.tan(fov / 2));
    camera.fov = BASE_FOV;
    if (obstacles) {
      // 部屋の中では、壁の手前までしか下がれない。足りない分は画角を広げて収める
      const origin = character.object3d.localToWorld(new THREE.Vector3(0, centerY, 0));
      const dir = character.object3d.localToWorld(new THREE.Vector3(0, centerY, 1)).sub(origin).normalize();
      const hit = new THREE.Raycaster(origin, dir, 0.1, dist + 1).intersectObject(obstacles, true)[0];
      if (hit && hit.distance - 0.2 < dist) {
        dist = Math.max(0.8, hit.distance - 0.2);
        camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(band.neededH / 2 / dist)), BASE_FOV, 75);
      }
    }
    camera.updateProjectionMatrix();
    // 画面の中心を、上の段と下の帯の差の分だけずらす(下の帯が高いとキャラは上へ、上の段が高いと下へ)。見える高さ × 帯の差の半分の割合
    const visible = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const lookY = centerY + band.shift * visible;
    camera.position.copy(character.object3d.localToWorld(new THREE.Vector3(0, lookY, dist)));
    camera.lookAt(character.object3d.localToWorld(new THREE.Vector3(0, lookY, 0)));
    state.camZ = dist;
  }

  /** キャラの真ん中(原点)から、横(キャラの左右)にいちばん遠い所までの長さ(世界の長さ)。しっぽなど片側だけ長くても、両側を同じだけ空ける */
  function halfWidth(character, box, base) {
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(character.object3d.getWorldQuaternion(new THREE.Quaternion()));
    const v = new THREE.Vector3();
    let half = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const z of [box.min.z, box.max.z]) {
        half = Math.max(half, Math.abs(v.set(x, base.y, z).sub(base).dot(side)));
      }
    }
    return half;
  }

  function resize() {
    if (renderer.xr.isPresenting) return; // VR の中の大きさは端末が決める
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // AR(殻)のあいだ、射影行列は殻が決める(上書きしない)
    if (!state.immersive) camera.updateProjectionMatrix();
  }

  return {
    renderer,
    scene,
    camera,
    state,
    frameCharacter,
    resize,
    render: () => renderer.render(scene, camera),
  };
}
