// 会話の本体。キャラを出し、カメラで人を見つけて目と首で追い、話しかけられたら Claude に聞いて、声で答える。
import { createStage } from './scene.js';
import { loadCharacter } from './character/index.js';
import { FaceTracker } from './tracking/faceTracker.js';
import { AttentionPicker } from './tracking/attention.js';
import { faceToWorld, describeScene } from './tracking/geometry.js';
import { Speaker } from './conversation/speaker.js';
import { Dialogue } from './conversation/dialogue.js';
import { Listener, webSpeechSupported } from './conversation/listener.js';
import { createUi } from './ui/panel.js';
import { loadPlaceData, landmarkWorld, promptPlace } from './place.js';

const params = new URLSearchParams(location.search);
const GAIN = Number(params.get('gain') ?? 2); // 視線の振れ幅の倍率
const HFOV = Number(params.get('hfov') ?? 65); // カメラの横の画角(度)
const APPROACH_DIST_M = 2.2; // この近さに来たら、声をかける
const APPROACH_HOLD_S = 1.2;
const GREET_COOLDOWN_S = 90;

const $ = (id) => document.getElementById(id);
const ui = createUi();
const stage = createStage($('stage'));
const speaker = new Speaker();
const picker = new AttentionPicker();
const tracker = new FaceTracker();

const app = {
  character: null,
  place: null,
  persona: '',
  mode: 'none', // 'camera' | 'sim'
  autoGreet: params.get('auto') !== '0',
  simFaces: [],
  status: null,
  metrics: [],
  lastAttention: { tracks: [], primaryId: null, speakerId: null },
  world: new Map(),
};
window.__app = app; // 試験と開発の確認用
app.speaker = speaker;
app.stage = stage;
app.tracker = tracker;
app.picker = picker;

/* ---------- 視線 ---------- */
let gazeOverride = null; // { pos:[x,y,z], until:ms }
function setGaze(spec, ms = 2000) {
  if (!spec || spec === 'person') {
    gazeOverride = null;
    return null;
  }
  const until = performance.now() + ms + 600;
  if (spec === 'away') {
    gazeOverride = { pos: [-0.8, stage.state.headY + 0.3, stage.state.camZ * 0.8], until };
    return null;
  }
  if (spec.startsWith('landmark:')) {
    const pos = landmarkWorld(app.place, spec.slice('landmark:'.length));
    if (pos) gazeOverride = { pos, until };
    return pos;
  }
  return null;
}

/* ---------- 会話 ---------- */
const dialogue = new Dialogue({
  character: null, // 読み込み後に入れる
  speaker,
  ui,
  setGaze,
  getContext: () => ({
    scene: sceneText(),
    character: { name: app.character.name, persona: app.persona },
    place: promptPlace(app.place),
  }),
  onMetric: (entry) => {
    app.metrics.push(entry);
    fetch('/api/metrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => {});
    const valid = app.metrics.filter((m) => m.valid).map((m) => m.totalMs).sort((a, b) => a - b);
    const med = valid.length ? valid[Math.floor(valid.length / 2)] : null;
    ui.foot(
      `返事まで ${entry.totalMs}ms${entry.valid ? '' : '(参考: 頭脳か声が仮)'}` +
        `${med !== null ? ` ・ 中央値 ${med}ms (${valid.length}回)` : ''}` +
        ` ・ 目標 1200ms`,
    );
  },
});

app.dialogue = dialogue;

let lastSceneText = '';
function sceneText() {
  const a = app.lastAttention;
  return describeScene(a.tracks, { primaryId: a.primaryId, speakerId: a.speakerId, world: app.world });
}

/* ---------- 声 ---------- */
let listener = null;
async function toggleMic() {
  const btn = $('micBtn');
  if (listener?.listening) {
    listener.stop();
    listener = null;
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('hearing');
    updatePrivacy();
    return;
  }
  try {
    speaker.unlock();
    listener = new Listener({
      onInterim: (t) => ui.caption(t, 0, 'user'),
      onFinal: (text, info) => {
        const t0 = info.lastVoicedAt || performance.now();
        dialogue.send({ text, t0, mode: 'voice' });
      },
      onVoice: (active) => {
        $('micBtn').classList.toggle('hearing', active);
        // 話している最中に声が出たら、止まって聞く
        if (active && speaker.speaking) dialogue.cancel();
      },
      onError: (msg) => ui.error(msg),
    });
    await listener.start();
    btn.setAttribute('aria-pressed', 'true');
    updatePrivacy();
  } catch (err) {
    listener = null;
    ui.error(err.message);
  }
}

function updatePrivacy() {
  const cam = app.mode === 'camera';
  const mic = listener?.listening;
  let text = cam
    ? 'カメラの映像は、この端末の中で人の位置を調べるだけに使います。保存も、送信もしません。'
    : 'カメラは使っていません(マウスで人の位置を動かしています)。';
  if (mic) text += ' 声の聞き取りには、ブラウザの聞き取りのサービスに音が送られます。';
  ui.privacy(text, !cam);
}

/* ---------- 画面の状態 ---------- */
async function refreshStatus() {
  try {
    app.status = await (await fetch('/api/status')).json();
  } catch {
    app.status = null;
  }
}

function updateChips() {
  const s = app.status;
  const chips = [];
  chips.push(['頭脳', s ? (s.brain === 'haiku' ? 'Claude Haiku' : '仮(鍵なし)') : '—', s?.brain === 'haiku' ? 'ok' : 'warn']);
  const ttsOk = s?.tts?.available && !speaker.ttsError;
  chips.push(['声', ttsOk ? `ElevenLabs(残り ${s.tts.remainingToday}字)` : '字幕のみ', ttsOk ? 'ok' : 'warn']);
  chips.push([
    'カメラ',
    app.mode === 'camera' ? `${tracker.delegate} ${tracker.fps.toFixed(0)}fps` : app.mode === 'sim' ? 'マウスで試し中' : 'なし',
    app.mode === 'camera' ? 'ok' : 'warn',
  ]);
  chips.push(['人', String(app.lastAttention.tracks.length), '']);
  if (listener?.listening) chips.push(['聞き取り', 'ブラウザ', 'ok']);
  ui.chips(chips);
}

/* ---------- 毎フレーム ---------- */
let prevT = performance.now();
let presence = { since: 0, greetedAt: -1e9, lastSeen: 0 };
let chipClock = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = (nowMs - prevT) / 1000;
  prevT = nowMs;
  const c = app.character;
  if (!c) return;
  const nowS = nowMs / 1000;

  // 1. 顔の位置(カメラ or マウス)
  let faces = [];
  if (app.mode === 'camera') faces = tracker.step(nowMs);
  else if (app.mode === 'sim') faces = app.simFaces;

  // 2. 誰を見るか
  const att = picker.update(faces, nowS, { voiceActive: Boolean(listener?.voiceActive) });
  app.lastAttention = att;
  app.world = new Map(
    att.tracks.map((t) => [
      t.id,
      faceToWorld(t, { hfovDeg: HFOV, aspect: tracker.video ? tracker.video.videoWidth / tracker.video.videoHeight : 4 / 3, headY: stage.state.headY }),
    ]),
  );
  const primary = att.tracks.find((t) => t.id === att.primaryId);

  // 3. キャラの目と首
  if (gazeOverride && nowMs < gazeOverride.until) {
    c.lookAt(gazeOverride.pos);
  } else if (primary) {
    const [x, y] = app.world.get(primary.id);
    c.lookAt([x * GAIN, y, stage.state.camZ]);
  } else {
    c.lookAt(null);
  }

  // 4. 近づいた人に、こちらから声をかける
  if (primary) {
    const dist = app.world.get(primary.id)[2];
    if (!presence.since) presence.since = nowS;
    presence.lastSeen = nowS;
    if (
      app.autoGreet &&
      dist < APPROACH_DIST_M &&
      nowS - presence.since > APPROACH_HOLD_S &&
      nowS - presence.greetedAt > GREET_COOLDOWN_S &&
      !dialogue.busy &&
      !speaker.speaking
    ) {
      presence.greetedAt = nowS;
      dialogue.send({ trigger: 'approach', mode: 'text' });
    }
  } else if (nowS - presence.lastSeen > 3) {
    presence.since = 0; // いなくなって 3 秒たったら、次に来た人は新しい人
  }

  // 5. 口・描画
  c.setMouth(speaker.level());
  c.update(dt);
  stage.render();

  if (nowMs - chipClock > 500) {
    chipClock = nowMs;
    updateChips();
    const t = sceneText();
    if (t !== lastSceneText) {
      lastSceneText = t;
      ui.scene(t);
    }
  }
}

/* ---------- 起動 ---------- */
function setupSimInput() {
  const stageEl = $('stage');
  let width = 0.18;
  const set = (clientX, clientY) => {
    const r = stageEl.getBoundingClientRect();
    app.simFaces = [{ x: 1 - (clientX - r.left) / r.width, y: (clientY - r.top) / r.height, width, mouth: 0 }];
  };
  window.addEventListener('pointermove', (e) => {
    if (app.mode === 'sim' && e.target === stageEl) set(e.clientX, e.clientY);
  });
  stageEl.addEventListener('pointerleave', () => {
    if (app.mode === 'sim') app.simFaces = [];
  });
  stageEl.addEventListener(
    'wheel',
    (e) => {
      if (app.mode !== 'sim') return;
      width = Math.min(0.5, Math.max(0.04, width * (e.deltaY < 0 ? 1.1 : 0.9)));
      e.preventDefault();
    },
    { passive: false },
  );
}

async function boot() {
  const status = $('gateStatus');
  const buttons = [$('startCam'), $('startSim')];
  buttons.forEach((b) => (b.disabled = true));
  status.textContent = 'キャラを読み込んでいます…';
  stage.resize();
  window.addEventListener('resize', () => {
    stage.resize();
    if (app.character) stage.frameCharacter(app.character);
  });
  try {
    const url = params.get('char') ?? '/characters/_test/character.json';
    app.place = await loadPlaceData(params.get('place'));
    const character = await loadCharacter(url);
    app.character = character;
    dialogue.character = character;
    stage.scene.add(character.object3d);
    stage.frameCharacter(character, params.get('view') === 'full' ? 'full' : 'bust');
    if (character.personaUrl) app.persona = await (await fetch(character.personaUrl)).text();
    status.textContent = '';
  } catch (err) {
    console.error(err);
    status.textContent = `キャラを読み込めませんでした: ${err.message}`;
    return;
  }
  await refreshStatus();
  setInterval(refreshStatus, 15000);
  setupSimInput();
  updatePrivacy();
  buttons.forEach((b) => (b.disabled = false));
  requestAnimationFrame(frame);

  $('startCam').addEventListener('click', async () => {
    speaker.unlock(); // 音を出す許可は、最初のタップの中で取る
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = 'カメラとモデルを準備しています…';
    try {
      await tracker.start();
      app.mode = 'camera';
      $('gate').classList.add('hidden');
      updatePrivacy();
    } catch (err) {
      console.error(err);
      status.textContent = `カメラを使えませんでした(${err.message})。「カメラなしで試す」なら動かせます。`;
      buttons.forEach((b) => (b.disabled = false));
    }
  });
  $('startSim').addEventListener('click', () => {
    speaker.unlock();
    app.mode = 'sim';
    $('gate').classList.add('hidden');
    updatePrivacy();
  });

  $('micBtn').addEventListener('click', toggleMic);
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('textInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    speaker.unlock();
    dialogue.send({ text, mode: 'text' });
  });
  if (!webSpeechSupported()) {
    $('micBtn').disabled = true;
    $('micBtn').title = 'このブラウザは声の聞き取りに対応していません';
  }
}

boot();
