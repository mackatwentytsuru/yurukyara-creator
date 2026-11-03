// 踊りの試し。node で動かすと配信と headless の Chrome を起こし、ブラウザの中では VRM と踊りだけを描く。
// 使い方: node show/check/dance_try.mjs --vrm <.vrm> --timeline <timeline.json> --out <フォルダ> [--probe]
//   --times 40,41,42     この秒のコマを撮る(絵は <秒>_front.png / <秒>_side.png)
//   --range 40,43        この秒の間を 60 コマ毎秒ぜんぶ撮る(mp4 の材料。seq_00000.png)
//   --view side          --range を斜めから撮る(既定は正面)
//   --lead 3             撮る前に揺れ物をならす秒
//   --dance-track <頭>   assemble_track.py の出力(<頭>.bin と <頭>.json)を /show-data/dance_track で渡す
//   --dance-file <.mjs>  踊りを別の写しに差しかえて試す(本体を書きかえずに済む)
const NOT_BODY = /arm|hand|thumb|index|middle|ring|little|hair|shoulder/i;

if (typeof window === 'undefined') await runNode();
else await runPage();

async function runNode() {
  const http = await import('node:http');
  const { spawn, spawnSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { extname, join, normalize, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[key] = argv[++i];
    else args[key] = true;
  }
  for (const key of ['vrm', 'timeline', 'out']) {
    if (!args[key]) throw new Error(`--${key} がありません`);
  }
  const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const ALLOW = ['/show/check/dance_try', '/show/led_browser/', '/web/node_modules/three/', '/web/node_modules/@pixiv/'];
  const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
  fs.mkdirSync(args.out, { recursive: true });
  const job = {
    probe: Boolean(args.probe),
    times: args.times ? String(args.times).split(',').map(Number) : [],
    range: args.range ? String(args.range).split(',').map(Number) : null,
    lead: Number(args.lead ?? 3),
    view: args.view ?? 'front',
  };
  let finish;
  const finished = new Promise((ok) => { finish = ok; });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);
    const body = () => new Promise((ok) => {
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => ok(Buffer.concat(parts)));
    });
    if (req.method === 'POST' && path === '/frame') {
      fs.writeFileSync(join(args.out, url.searchParams.get('name')), await body());
      res.writeHead(200).end();
      return;
    }
    if (req.method === 'POST' && path === '/result') {
      const message = JSON.parse((await body()).toString());
      res.writeHead(200).end();
      finish(message);
      return;
    }
    try {
      if (path === '/try/job.json') return res.writeHead(200, { 'content-type': TYPES['.json'] }).end(JSON.stringify(job));
      if (path === '/try/timeline.json') return res.writeHead(200, { 'content-type': TYPES['.json'] }).end(fs.readFileSync(args.timeline));
      if (path === '/try/character.vrm') return res.writeHead(200).end(fs.readFileSync(args.vrm));
      if (args['dance-track'] && path.startsWith('/show-data/dance_track')) return res.writeHead(200, { 'cache-control': 'no-store' }).end(fs.readFileSync(args['dance-track'] + path.slice('/show-data/dance_track'.length)));
      if (args['dance-file'] && path === '/show/led_browser/show_vrm_dance.mjs') return res.writeHead(200, { 'content-type': TYPES['.mjs'], 'cache-control': 'no-store' }).end(fs.readFileSync(args['dance-file']));
      if (!ALLOW.some((p) => path.startsWith(p)) || path.includes('..')) return res.writeHead(404).end();
      const file = normalize(join(ROOT, path));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(fs.readFileSync(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/show/check/dance_try.html`;
  const profile = fs.mkdtempSync(join(tmpdir(), 'dance-try-'));
  const chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-timer-throttling', '--window-size=1280,1240', `--user-data-dir=${profile}`, '--use-angle=d3d11', '--ignore-gpu-blocklist', url], { stdio: 'ignore' });
  const timer = setTimeout(() => finish({ kind: 'error', text: '時間切れ(10 分)' }), 600000);
  const result = await finished;
  clearTimeout(timer);
  spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  server.close();
  fs.writeFileSync(join(args.out, 'result.json'), JSON.stringify(result, null, 1));
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 一時フォルダが残っても絵には関係ない
  }
  if (result.kind !== 'done') console.error(result.text);
  process.exit(result.kind === 'done' ? 0 : 1);
}

async function runPage() {
  const report = (m) => fetch('/result', { method: 'POST', body: JSON.stringify(m) });
  window.addEventListener('error', (e) => report({ kind: 'error', text: `${e.message} ${e.filename}:${e.lineno}` }));
  window.addEventListener('unhandledrejection', (e) => report({ kind: 'error', text: String(e.reason?.stack ?? e.reason) }));

  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm');
  const job = await (await fetch('/try/job.json')).json();
  const timeline = await (await fetch('/try/timeline.json')).json();

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync('/try/character.vrm');
  const vrm = gltf.userData.vrm;
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });

  const W = 1280;
  const H = 1240;
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x30323a);
  scene.add(vrm.scene, new THREE.HemisphereLight(0xffffff, 0x555566, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.5, 3, 2.5);
  scene.add(sun, new THREE.GridHelper(4, 16, 0x8088a0, 0x505468));
  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const height = box.max.y - box.min.y;
  const camera = new THREE.PerspectiveCamera(16, W / H, 0.05, 50);
  const placeCamera = (view) => {
    const az = view === 'side' ? -0.75 : 0;
    const d = (height * 1.22) / (2 * Math.tan((16 * Math.PI) / 360));
    camera.position.set(Math.sin(az) * d, height * 0.5, Math.cos(az) * d);
    camera.lookAt(0, height * 0.5, 0);
  };
  const send = async (name) => {
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
    await fetch(`/frame?name=${name}`, { method: 'POST', body: blob });
  };

  if (job.probe) {
    await report({ kind: 'done', ...probe(THREE, vrm, box) });
    return;
  }

  const { createDance, danceInput } = await import('/show/led_browser/show_vrm_dance.mjs');
  const dance = createDance(vrm, timeline);
  const stats = { applyMs: 0, applyN: 0, applyMax: 0, jumpDeg: 0, jumpBone: '', jumpAt: 0, springCmPerFrame: 0, springAt: 0, springBone: '', footSlideCm: 0, hipsMinY: 9, hipsMaxY: -9 };
  const prev = new Map();
  const joints = [...(vrm.springBoneManager?.joints ?? [])].map((j) => ({ bone: j.bone, last: null }));
  const footL = vrm.humanoid.getRawBoneNode('leftFoot');
  const footStart = new THREE.Vector3();
  let footSet = false;
  const vv = new THREE.Vector3();
  const trackSpring = (t) => {
    for (const j of joints) {
      j.bone.getWorldPosition(vv);
      if (j.last) {
        const cm = vv.distanceTo(j.last) * 100;
        if (cm > stats.springCmPerFrame) Object.assign(stats, { springCmPerFrame: cm, springAt: t, springBone: j.bone.name });
        j.last.copy(vv);
      } else j.last = vv.clone();
    }
    footL.getWorldPosition(vv);
    if (!footSet) {
      footStart.copy(vv);
      footSet = true;
    }
    // 向きを変える場面は足が回るので、高さだけ数える
    stats.footSlideCm = Math.max(stats.footSlideCm, Math.abs(vv.y - footStart.y) * 100);
    const hy = vrm.humanoid.getNormalizedBoneNode('hips').position.y;
    stats.hipsMinY = Math.min(stats.hipsMinY, hy);
    stats.hipsMaxY = Math.max(stats.hipsMaxY, hy);
  };
  const trackJump = (t) => {
    for (const name of Object.keys(vrm.humanoid.humanBones)) {
      const n = vrm.humanoid.getNormalizedBoneNode(name);
      if (!n) continue;
      const p = prev.get(name);
      if (p) {
        const deg = THREE.MathUtils.radToDeg(p.angleTo(n.quaternion));
        if (deg > stats.jumpDeg) Object.assign(stats, { jumpDeg: deg, jumpBone: name, jumpAt: t });
        if (deg > 7) (stats.big ??= []).push([+t.toFixed(3), name, +deg.toFixed(1)]);
        p.copy(n.quaternion);
      } else prev.set(name, n.quaternion.clone());
    }
  };
  const step = (f) => {
    const a = performance.now();
    dance.apply(danceInput(timeline, f));
    const ms = performance.now() - a;
    stats.applyMs += ms;
    stats.applyN += 1;
    stats.applyMax = Math.max(stats.applyMax, ms);
    trackJump(f / 60);
    vrm.update(1 / 60);
    scene.updateMatrixWorld();
    if (job.lead < 99 || f > 1200) trackSpring(f / 60);
  };
  const shoot = async (name, view) => {
    placeCamera(view);
    renderer.render(scene, camera);
    await send(name);
  };
  const fps = 60;
  const stepsFrom = (t) => Math.max(0, Math.round((t - job.lead) * fps));
  const contact = [];
  if (job.range) {
    const [a, b] = job.range.map((t) => Math.round(t * fps));
    for (let f = stepsFrom(a / fps); f < a; f++) step(f);
    for (let f = a; f < b; f++) {
      step(f);
      await shoot(`seq_${String(f - a).padStart(5, '0')}.png`, job.view);
    }
  }
  if (job.times.length) {
    const frames = new Set(job.times.map((t) => Math.round(t * fps)));
    const first = Math.min(...frames);
    const last = Math.max(...frames);
    for (let f = stepsFrom(first / fps); f <= last; f++) {
      step(f);
      if (!frames.has(f)) continue;
      const tag = (f / fps).toFixed(2);
      await shoot(`${tag}_front.png`, 'front');
      await shoot(`${tag}_side.png`, 'side');
      contact.push({ t: f / fps, ...measureContact(THREE, vrm) });
    }
  }
  stats.applyAvgMs = stats.applyMs / Math.max(1, stats.applyN);
  // 同じ入力なら同じ姿勢か。間に別のコマを挟んでも変わらないことを確かめる
  const snapshot = () => Object.keys(vrm.humanoid.humanBones).map((name) => vrm.humanoid.getNormalizedBoneNode(name)?.quaternion.clone());
  dance.apply(danceInput(timeline, 2400));
  const first = snapshot();
  dance.apply(danceInput(timeline, 4600));
  dance.apply(danceInput(timeline, 2400));
  stats.repeatDiffDeg = Math.max(...snapshot().map((q, i) => (q ? THREE.MathUtils.radToDeg(q.angleTo(first[i])) : 0)));
  await report({ kind: 'done', stats, contact });
}

function topBoneName(mesh, names, i) {
  const si = mesh.geometry.attributes.skinIndex;
  const sw = mesh.geometry.attributes.skinWeight;
  let top = 0;
  let topW = 0;
  for (let k = 0; k < 4; k++) {
    if (sw.getComponent(i, k) > topW) {
      topW = sw.getComponent(i, k);
      top = si.getComponent(i, k);
    }
  }
  return names[top] ?? '';
}

/** 向きの約束と体の形を測る */
function probe(THREE, vrm, box) {
  const h = vrm.humanoid;
  const v = new THREE.Vector3();
  const bones = {};
  for (const name of Object.keys(h.humanBones)) {
    const n = h.getNormalizedBoneNode(name);
    if (n) bones[name] = n.getWorldPosition(v).toArray().map((x) => +x.toFixed(4));
  }
  const measure = (bone, tip, euler) => {
    const n = h.getNormalizedBoneNode(bone);
    n.rotation.set(...euler);
    n.parent.updateWorldMatrix(true, true);
    const out = h.getNormalizedBoneNode(tip).getWorldPosition(new THREE.Vector3()).sub(n.getWorldPosition(new THREE.Vector3()));
    n.rotation.set(0, 0, 0);
    n.parent.updateWorldMatrix(true, true);
    return out.toArray().map((x) => +x.toFixed(3));
  };
  const axisTest = {
    spinePitchPlus: measure('spine', 'head', [0.5, 0, 0]),
    spineRollPlus: measure('spine', 'head', [0, 0, 0.5]),
    leftArmZminus: measure('leftUpperArm', 'leftLowerArm', [0, 0, -1]),
    rightArmZplus: measure('rightUpperArm', 'rightLowerArm', [0, 0, 1]),
    leftElbowYminus: measure('leftLowerArm', 'leftHand', [0, -1, 0]),
    rightElbowYplus: measure('rightLowerArm', 'rightHand', [0, 1, 0]),
    leftKneeXplus: measure('leftLowerLeg', 'leftFoot', [1, 0, 0]),
  };
  const profile = {};
  const meshes = [];
  vrm.scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push({ name: o.name, verts: o.geometry.attributes.position.count, skinned: !!o.isSkinnedMesh });
    if (!o.isSkinnedMesh) return;
    const names = o.skeleton.bones.map((b) => b.name);
    for (let i = 0; i < o.geometry.attributes.position.count; i += 3) {
      if (NOT_BODY.test(topBoneName(o, names, i))) continue;
      o.getVertexPosition(i, v);
      o.localToWorld(v);
      const key = (Math.round(v.y / 0.05) * 0.05).toFixed(2);
      const p = profile[key] ?? (profile[key] = { x: 0, zF: -9, zB: 9 });
      p.x = Math.max(p.x, Math.abs(v.x));
      p.zF = Math.max(p.zF, v.z);
      p.zB = Math.min(p.zB, v.z);
    }
  });
  const rows = Object.keys(profile).sort((a, b) => a - b).map((k) => [k, +profile[k].x.toFixed(3), +profile[k].zF.toFixed(3), +profile[k].zB.toFixed(3)]);
  return {
    metaVersion: vrm.meta?.metaVersion,
    box: [box.min.toArray(), box.max.toArray()],
    lookAt: vrm.lookAt?.applier?.constructor?.name,
    springs: vrm.springBoneManager?.joints?.size,
    bones,
    axisTest,
    meshes,
    profileYXzFzB: rows,
  };
}

/** 手・肘と、胴・スカートの頂点の距離の一番近い値(m)。腕・手・指・髪についた頂点は数えない */
function measureContact(THREE, vrm) {
  const h = vrm.humanoid;
  const points = {};
  const v = new THREE.Vector3();
  for (const bone of ['leftHand', 'rightHand', 'leftLowerArm', 'rightLowerArm', 'leftMiddleDistal', 'rightMiddleDistal']) {
    const raw = h.getRawBoneNode(bone);
    if (raw) points[bone] = raw.getWorldPosition(new THREE.Vector3());
  }
  const best = {};
  vrm.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const names = o.skeleton.bones.map((b) => b.name);
    for (let i = 0; i < o.geometry.attributes.position.count; i += 5) {
      if (NOT_BODY.test(topBoneName(o, names, i))) continue;
      o.getVertexPosition(i, v);
      o.localToWorld(v);
      for (const key in points) {
        const d = v.distanceTo(points[key]);
        if (best[key] === undefined || d < best[key]) best[key] = d;
      }
    }
  });
  for (const key in best) best[key] = +best[key].toFixed(3);
  return best;
}
