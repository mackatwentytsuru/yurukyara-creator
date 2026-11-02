import * as THREE from 'three';

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
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60);

  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x2a2540, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(1.2, 2.4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 0.8);
  rim.position.set(-2, 1.6, -1.5);
  scene.add(rim);
  scene.add(makeFloorGlow());

  const state = { view: 'bust', height: 1.5, headY: 1.35, immersive: false };

  /**
   * キャラの大きさ・位置・向きに合わせてカメラを置く。bust は腰から上、full は全身。
   * state.headY と state.camZ は、キャラの座標(足元が原点・+z が正面)での値。
   */
  function frameCharacter(character, view = state.view, obstacles = state.obstacles) {
    state.view = view;
    state.obstacles = obstacles;
    character.object3d.updateWorldMatrix(true, true);
    const base = character.object3d.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(character.object3d);
    const height = Math.max(0.3, box.max.y - box.min.y);
    const floor = box.min.y - base.y; // キャラの原点から見た足元の高さ
    state.height = height;
    state.headY = floor + height * 0.9;
    const aspect = camera.aspect;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const visibleH = view === 'full' ? height * 1.18 : height * 0.62;
    const centerY = floor + (view === 'full' ? height * 0.5 : height * 0.67);
    // 横が狭い画面(スマホ)でも、肩と腕が入るようにする
    const neededH = Math.max(visibleH, (height * (view === 'full' ? 0.55 : 0.4)) / aspect);
    let dist = neededH / (2 * Math.tan(fov / 2));
    camera.fov = 28;
    if (obstacles) {
      // 部屋の中では、壁の手前までしか下がれない。足りない分は画角を広げて収める
      const origin = character.object3d.localToWorld(new THREE.Vector3(0, centerY, 0));
      const dir = character.object3d.localToWorld(new THREE.Vector3(0, centerY, 1)).sub(origin).normalize();
      const hit = new THREE.Raycaster(origin, dir, 0.1, dist + 1).intersectObject(obstacles, true)[0];
      if (hit && hit.distance - 0.2 < dist) {
        dist = Math.max(0.8, hit.distance - 0.2);
        camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(neededH / 2 / dist)), 28, 75);
      }
    }
    camera.updateProjectionMatrix();
    camera.position.copy(character.object3d.localToWorld(new THREE.Vector3(0, centerY, dist)));
    camera.lookAt(character.object3d.localToWorld(new THREE.Vector3(0, centerY, 0)));
    state.camZ = dist;
    return state;
  }

  function resize() {
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
