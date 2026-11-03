// 箱の見え方: 座席の目の位置から、LED(A・B・C の面)に映像を貼った舞台を見る。演者は仮の円柱。
// 座標は show/ue/stage_layout.py と同じ(cm。x 右、y 客席、z 上)→ three(m)は (x, z, y)。
// URL: ?seat=seat1&perf=perf1&media=<LED の絵(5680x1240 の画像)>&details=<venue_details.json>&ui=0
import * as THREE from "three";

const q = new URLSearchParams(location.search);
const data = await (await fetch("./venue_data.json")).json();
const details = q.get("details") ? await (await fetch(q.get("details"))).json().catch(() => null) : null;
const M = 0.01; // cm → m
const toThree = ([x, y, z]) => new THREE.Vector3(x * M, z * M, y * M);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0c10);

// 床と舞台
const [sx0, sx1, sy0, sy1, sz0, sz1] = data.stage_box;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x15171c }));
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, 0, 8);
scene.add(floor);
const stage = new THREE.Mesh(
  new THREE.BoxGeometry((sx1 - sx0) * M, (sz1 - sz0) * M, (sy1 - sy0) * M),
  new THREE.MeshBasicMaterial({ color: 0x2a2d36 }));
stage.position.set((sx0 + sx1) / 2 * M, (sz0 + sz1) / 2 * M, (sy0 + sy1) / 2 * M);
scene.add(stage);
const edge = new THREE.LineSegments(new THREE.EdgesGeometry(stage.geometry), new THREE.LineBasicMaterial({ color: 0x555a68 }));
edge.position.copy(stage.position);
scene.add(edge);

// LED の板
const mediaUrl = q.get("media");
const tex = mediaUrl ? await new THREE.TextureLoader().loadAsync(mediaUrl).catch(() => null) : null;
if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; }
const [zb, zt] = data.led_z;
for (const p of data.plates) {
  const [x0, y0] = p.start, [x1, y1] = p.end;
  const a = toThree([x0, y0, zb]), b = toThree([x1, y1, zb]), c = toThree([x1, y1, zt]), d = toThree([x0, y0, zt]);
  const u0 = p.u_offset, u1 = p.u_offset + p.u_scale;
  const vTop = 1 - p.v_offset, vBot = 1 - (p.v_offset + p.v_scale);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray()], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([u0, vBot, u1, vBot, u1, vTop, u0, vTop], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const mat = new THREE.MeshBasicMaterial(tex ? { map: tex, side: THREE.DoubleSide } : { color: 0x335577, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(g, mat));
}

// 仮の演者(円柱+頭)。物の位置は venue_details.json の物も同じ形で出す
function marker(x, y, radius, height, color, label) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius * M, radius * M, height * M, 24), new THREE.MeshBasicMaterial({ color }));
  body.position.y = height * M / 2;
  g.add(body);
  g.position.copy(toThree([x, y, 0]));
  return g;
}
const stageZ = sz1;
const scenarioSeat = (id) => data.scenario.seats.find((s) => s.id === id) || data.scenario.seats[0];
const scenarioPerf = (id) => data.scenario.performer_sets.find((s) => s.id === id) || data.scenario.performer_sets[0];
const seat = scenarioSeat(q.get("seat"));
const perf = scenarioPerf(q.get("perf"));
for (const pr of perf.performers) {
  const m = marker(pr.x, pr.y, pr.radius || 30, pr.height || 160, 0xe8a33d);
  m.position.y = stageZ * M;
  scene.add(m);
}
// 箱の中の物(venue_details.json の objects、または試験用の置き物)。足元は床(z=0)。kind: pillar 柱 / pole ポール / speaker 箱形
function addObject(o) {
  const g = new THREE.Group();
  const add = (geo, color, y) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color })); m.position.y = y; g.add(m); };
  if (o.kind === "pillar") add(new THREE.CylinderGeometry(0.25, 0.25, 3.0, 24), 0x8a8f99, 1.5);
  else if (o.kind === "pole") { add(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 16), 0xf0c020, 0.5); add(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 24), 0x333333, 0.015); }
  else if (o.kind === "speaker") add(new THREE.BoxGeometry(0.6, 1.2, 0.6), 0x4a6fd0, 0.6);
  else add(new THREE.CylinderGeometry((o.radius_cm || 8) * M, (o.radius_cm || 8) * M, (o.height_cm || 100) * M, 16), 0xd06a6a, (o.height_cm || 100) * M / 2);
  g.position.copy(toThree([o.x_cm, o.y_cm, 0]));
  scene.add(g);
}
if (details) for (const o of details.objects || []) addObject(o);

// 座席のカメラ(35mm 換算の焦点距離から画角)
const aspect = innerWidth / innerHeight;
const hfov = 2 * Math.atan(18 / (seat.mm35 || 26));
const vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
const cam = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(vfov), aspect, 0.05, 200);
cam.position.copy(toThree(seat.eye));
cam.lookAt(toThree(seat.look_at));
renderer.render(scene, cam);

window.venueSim = {
  seat: seat.id, perf: perf.id,
  // ARKit と同じ約束のカメラ情報(T: カメラ→世界 4x4 の列順 16 個、世界は y 上・m。K: fx fy cx cy 画素)
  cameraInfo() {
    cam.updateMatrixWorld();
    const w = renderer.domElement.width, h = renderer.domElement.height;
    const f = (h / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    return { T: cam.matrixWorld.elements.slice(), K: [f, f, w / 2, h / 2], w, h };
  },
  render() { renderer.render(scene, cam); },
  // 撮影記録のカメラ(three の世界での 4x4 の列順 16 個)と縦の画角(度)で描く。縦横比は画面のまま
  setMatrix(elements, fovYDeg) {
    cam.matrixAutoUpdate = false;
    cam.matrixWorld.fromArray(elements);
    cam.matrix.copy(cam.matrixWorld);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.fov = fovYDeg; cam.updateProjectionMatrix();
    renderer.render(scene, cam);
  },
  setPose(eye, lookAt, mm35) {
    cam.position.copy(toThree(eye)); cam.lookAt(toThree(lookAt));
    const h = 2 * Math.atan(18 / mm35);
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / cam.aspect)); cam.updateProjectionMatrix();
    renderer.render(scene, cam);
  },
};
window.venueReady = true;

// ボタン(?ui=0 で隠す)
const bar = document.getElementById("bar");
const info = document.getElementById("info");
if (q.get("ui") === "0") { bar.style.display = "none"; info.style.display = "none"; }
else {
  const mk = (kind, items, cur) => items.forEach((it) => {
    const b = document.createElement("button");
    b.textContent = it.name; if (it.id === cur) b.className = "on";
    b.onclick = () => { q.set(kind, it.id); location.search = q.toString(); };
    bar.appendChild(b);
  });
  mk("seat", data.scenario.seats, seat.id);
  mk("perf", data.scenario.performer_sets, perf.id);
  info.textContent = `${seat.name} から見た LED。演者は仮の円柱(橙)。座席の位置は仮(未実測)。` + (tex ? "" : "\nLED の絵が未指定(?media=)");
}
