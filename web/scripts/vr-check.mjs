// 実機の Quest が無くても、VR の入口を端から端まで確かめる。Meta の IWER(WebXR の偽物)を入れた Chrome で、
// ページのボタンを押して VR に入り、頭を動かし、スティックとトリガーを使い、偽のマイクから声を流す。
//   npm run build && PORT=8799 npm run server
//   node scripts/vr-check.mjs --port 8799 --character <id> --out <フォルダ> [--mic 声.wav] [--gpu]
// --mic の WAV は、頭に長めの無音を入れておく(VR に入ったあとで声が流れるように)。
// 分かるのは、ページの作りが合っているか。Quest の本物のブラウザでの動き(マイク・音・速さ)は分からない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const PORT = opt('port', '8799');
const CHAR = opt('character', 'yokoso');
const OUT = opt('out', 'vr_check');
const MIC = opt('mic', null);
const MIC_WORD = opt('mic-word', null); // 偽のマイクの声に入っている言葉。字が崩れていないかを、これで見る
const QUEST_UA = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/40.4 Chrome/142.0.0.0 VR Safari/537.36';
const DIST_M = 1.6;

fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import(pathToFileURL(path.join(HERE, '../node_modules/playwright-core/index.mjs')).href);
const gpuArgs = argv.includes('--gpu') ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'];
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: [...gpuArgs, '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    ...(MIC ? [`--use-file-for-fake-audio-capture=${path.resolve(MIC).replaceAll('\\', '/')}%noloop`] : [])],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, userAgent: QUEST_UA, permissions: ['microphone'] });
const page = await context.newPage();
const problems = [];
const stt = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('console', (m) => {
  // 読み上げの鍵が無いときの 503 は、字幕だけで進む決まり(不具合でない)
  if (m.type() === 'error' && !m.text().includes('503')) problems.push(`console: ${m.text().slice(0, 200)}`);
});
page.on('response', async (r) => {
  if (!r.url().endsWith('/api/stt')) return;
  stt.push(await r.json().catch(() => ({ error: 'JSON でない' })));
  const wav = r.request().postDataBuffer();
  if (wav) fs.writeFileSync(path.join(OUT, `stt_${stt.length}.wav`), wav); // 聞き取りの字がおかしいときに、送った音で確かめる
});
await page.addInitScript({ path: path.join(HERE, '../node_modules/iwer/build/iwer.min.js') });
await page.addInitScript(() => {
  const d = new window.IWER.XRDevice(window.IWER.metaQuest3);
  d.stereoEnabled = false; // 確認の絵を 1 枚に
  // IWER 2.7.0 の getOffsetReferenceSpace は、XRRigidTransform を行列として受け取るので、ずれが効かない(仕様どおりの行列を渡す。試験の中だけの補い)
  const Ref = window.IWER.XRReferenceSpace.prototype;
  const original = Ref.getOffsetReferenceSpace;
  Ref.getOffsetReferenceSpace = function (offset) {
    return original.call(this, offset.matrix);
  };
  d.installRuntime({ forceInstall: true });
  window.__xr = d;
});

const checks = {};
const check = (name, ok, value) => {
  checks[name] = { ok: Boolean(ok), value };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** いまの立ち位置と視線を、世界の座標で測る */
const measure = () => page.evaluate(() => {
  const { THREE, character: c, stage, vrPanel } = window.__app;
  const head = stage.camera.getWorldPosition(new THREE.Vector3());
  const fwd = stage.camera.getWorldDirection(new THREE.Vector3());
  const base = c.object3d.getWorldPosition(new THREE.Vector3());
  const box = new THREE.Box3().setFromObject(c.object3d);
  const toChar = base.clone().sub(head).setY(0).normalize();
  const flat = fwd.clone().setY(0).normalize();
  return {
    head: head.toArray().map((v) => +v.toFixed(3)),
    dist: +Math.hypot(head.x - base.x, head.z - base.z).toFixed(3),
    facing_deg: +THREE.MathUtils.radToDeg(flat.angleTo(toChar)).toFixed(1),
    floor: +box.min.y.toFixed(3),
    height: +(box.max.y - box.min.y).toFixed(3),
    gaze_target_to_head: c.target ? +c.target.distanceTo(head).toFixed(3) : null,
    head_yaw_deg: +THREE.MathUtils.radToDeg(c.debug?.headYaw ?? 0).toFixed(1),
    eye_yaw_deg: +THREE.MathUtils.radToDeg(c.debug?.eyeYaw ?? 0).toFixed(1),
    panel: vrPanel ? { ...vrPanel.shown, visible: vrPanel.mesh.visible } : null,
    panel_x: vrPanel ? +vrPanel.mesh.position.x.toFixed(3) : null,
  };
});
const shot = (name) => page.screenshot({ path: path.join(OUT, name) }).catch((e) => problems.push(`撮れない: ${e.message.slice(0, 100)}`));
const finish = async () => {
  const failed = Object.entries(checks).filter(([, v]) => !v.ok).map(([k]) => k);
  const result = { character: CHAR, ok: failed.length === 0 && problems.length === 0, failed, checks, stt, problems };
  fs.writeFileSync(path.join(OUT, 'vr_check.json'), JSON.stringify(result, null, 1));
  await context.close();
  await browser.close();
  console.log(JSON.stringify({ character: CHAR, ok: result.ok, failed, stt, problems: problems.slice(0, 6) }));
  process.exit(result.ok ? 0 : 1);
};

await page.goto(`http://127.0.0.1:${PORT}/?character=${CHAR}`);
await page.waitForFunction(() => window.__app?.character && !document.getElementById('startCam').disabled, null, { timeout: 180000 });
const realVoice = await page.evaluate(async () => Boolean((await (await fetch('/api/status')).json()).tts?.available));
check('入る前: 入口がヘッドセット用になっている', await page.evaluate(() => document.getElementById('startSim').hidden && document.documentElement.classList.contains('is-headset')));
await page.click('#startCam');
await page.waitForFunction(() => document.getElementById('gate').classList.contains('hidden'), null, { timeout: 15000 });
await page.waitForFunction(() => window.__app.listener?.listening, null, { timeout: 15000 }).catch(() => {});
const listening = await page.evaluate(() => ({ listening: Boolean(window.__app.listener?.listening), provider: window.__app.listener?.provider ?? null, align: document.getElementById('align').textContent }));
check('入る前: マイクが 2D の画面で許可され、聞き取りはサーバー', listening.listening && listening.provider === 'server', listening);
await shot('vr_0_2d.png');

await page.click('.place-mode-vr');
await page.waitForFunction(() => window.__app.modes?.mode === 'vr' && window.__app.stage.renderer.xr.isPresenting && window.__app.vrStage?.rig, null, { timeout: 15000 });
// 声の大きさと口を、VR のあいだずっと見ておく
await page.evaluate(() => {
  const a = window.__app;
  a.__peak = { level: 0, mouth: 0, frames: 0, t0: performance.now() };
  a.__peakTimer = setInterval(() => {
    a.__peak.level = Math.max(a.__peak.level, a.speaker.level());
    a.__peak.mouth = Math.max(a.__peak.mouth, a.character.mouth ?? 0);
  }, 60);
  a.stage.renderer.xr.getSession().requestAnimationFrame(function tick(t, f) {
    a.__peak.frames += 1;
    f.session.requestAnimationFrame(tick);
  });
});
await sleep(800);
const start = await measure();
const heightWanted = await page.evaluate(async (id) => (await (await fetch(`/characters/${id}/character.json`)).json()).height_m ?? null, CHAR);
check('立ち位置: キャラの正面 1.6m', Math.abs(start.dist - DIST_M) < 0.05, start.dist);
check('立ち位置: 顔がキャラを向いている', start.facing_deg < 3, start.facing_deg);
check('床: 足元が y=0', Math.abs(start.floor) < 0.06, start.floor);
check('大きさ: character.json の height_m と合う', heightWanted === null || Math.abs(start.height - heightWanted) / heightWanted < 0.15, { 測った: start.height, 指定: heightWanted });
check('頭の高さ: 床の上 1.6m のまま', Math.abs(start.head[1] - 1.6) < 0.05, start.head[1]);
check('文字の板: 見えている', start.panel?.visible, start.panel);
check('文字の板: 見ている人から見て右', start.panel_x > 0.3, start.panel_x);
check('背景: 撮った部屋が無いので、空と床がある', await page.evaluate(() => Boolean(window.__app.stage.scene.getObjectByName('vrBackdrop'))));
await shot('vr_1_front.png');

// 視線: 頭を右へ、左へ
await page.evaluate(() => window.__xr.position.set(1, 1.6, 0));
await sleep(2500);
const right = await measure();
check('視線: 頭を右へ 1m → 的が頭に合う', right.gaze_target_to_head !== null && right.gaze_target_to_head < 0.08, right.gaze_target_to_head);
await page.evaluate(() => window.__xr.position.set(-1, 1.6, 0));
await sleep(2500);
const left = await measure();
check('視線: 頭を左へ 1m → 的が頭に合う', left.gaze_target_to_head !== null && left.gaze_target_to_head < 0.08, left.gaze_target_to_head);
check('視線: 左右で向きが変わる', Math.abs((right.head_yaw_deg + right.eye_yaw_deg) - (left.head_yaw_deg + left.eye_yaw_deg)) > 3, { 右: [right.head_yaw_deg, right.eye_yaw_deg], 左: [left.head_yaw_deg, left.eye_yaw_deg] });
await page.evaluate(() => window.__xr.position.set(0, 1.6, 0));
await sleep(500);

// 歩いて近づく(体で)
await page.evaluate(() => window.__xr.position.set(0, 1.6, -0.8));
await sleep(600);
const walked = await measure();
check('歩く: 0.8m 前へ出ると、キャラまで 0.8m', Math.abs(walked.dist - 0.8) < 0.08, walked.dist);
await shot('vr_2_near.png');
await page.evaluate(() => window.__xr.position.set(0, 1.6, 0));
await sleep(400);

// スティックで歩く
const beforeStick = await measure();
await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 0, -1));
await sleep(1500);
await page.evaluate(() => window.__xr.controllers.right.updateAxes('thumbstick', 0, 0));
await sleep(300);
const afterStick = await measure();
check('スティック: 前へ倒すと近づく', beforeStick.dist - afterStick.dist > 0.2, { 前: beforeStick.dist, 後: afterStick.dist });

// 話す: 近づいた人への声かけ(自動)か、トリガーで
const waitReply = (timeout) => page.waitForFunction(() => window.__app.vrPanel?.shown.reply, null, { timeout }).then(() => true).catch(() => false);
let replied = await waitReply(25000);
if (!replied) {
  await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 1));
  await sleep(300);
  await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 0));
  replied = await waitReply(25000);
}
check('返事: 文字の板に出る', replied, (await measure()).panel);
await page.waitForFunction(() => !window.__app.dialogue.busy && !window.__app.speaker.speaking, null, { timeout: 40000 }).catch(() => {});
await page.evaluate(() => {
  window.__app.vrPanel.set({ reply: '' });
  window.__xr.controllers.right.updateButtonValue('trigger', 1);
});
await sleep(300);
await page.evaluate(() => window.__xr.controllers.right.updateButtonValue('trigger', 0));
check('トリガー: 話しかけられる', await waitReply(25000), (await measure()).panel);
await shot('vr_3_reply.png');

if (MIC) {
  await page.waitForFunction(() => !window.__app.dialogue.busy && !window.__app.speaker.speaking, null, { timeout: 40000 }).catch(() => {});
  const heard = await page.waitForFunction(() => {
    const u = window.__app.vrPanel.shown.user;
    return u && u !== 'こんにちは' && u !== '…';
  }, null, { timeout: 120000 }).then(() => true).catch(() => false);
  await page.waitForFunction(() => !window.__app.dialogue.busy, null, { timeout: 40000 }).catch(() => {});
  check('声: 偽のマイクの声が文字になって、会話に入る', heard && stt.some((s) => s.text), { panel: (await measure()).panel, stt });
  if (MIC_WORD) {
    await page.waitForFunction((word) => window.__app.vrPanel.shown.user.includes(word), MIC_WORD, { timeout: 60000 }).catch(() => {});
    check(`声: 「${MIC_WORD}」が字になっている(音が欠けていない)`, stt.some((s) => s.text?.includes(MIC_WORD)), stt);
  }
  await shot('vr_4_voice.png');
}

const peak = await page.evaluate(() => {
  const p = window.__app.__peak;
  clearInterval(window.__app.__peakTimer);
  return { level: +p.level.toFixed(3), mouth: +p.mouth.toFixed(3), fps: +(p.frames / ((performance.now() - p.t0) / 1000)).toFixed(1) };
});
checks['参考: コマの速さ(ソフト描画なので実機の数字ではない)'] = { ok: true, value: peak.fps };
if (realVoice) check('声: 読み上げの音が出て、口が動く', peak.level > 0.01 && peak.mouth > 0.05, peak);

// 出る
await page.evaluate(() => window.__app.modes.exit());
await page.waitForFunction(() => window.__app.modes.mode === 'screen', null, { timeout: 8000 }).catch(() => {});
await sleep(500);
const back = await page.evaluate(() => ({
  mode: window.__app.modes.mode,
  presenting: window.__app.stage.renderer.xr.isPresenting,
  panel: window.__app.vrPanel?.mesh.visible,
  backdrop: Boolean(window.__app.stage.scene.getObjectByName('vrBackdrop')),
  listening: Boolean(window.__app.listener?.listening),
}));
check('出る: 画面に戻り、板と背景が消え、マイクは続く', back.mode === 'screen' && !back.presenting && !back.panel && !back.backdrop && back.listening, back);
await finish();
