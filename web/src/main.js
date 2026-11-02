// 会話の本体。キャラを出し、カメラで人を見つけて目と首で追い、話しかけられたら Claude に聞いて、声で答える。
import * as THREE from 'three';
import { createStage } from './scene.js';
import { loadCharacter } from './character/index.js';
import { MediapipeSource, SimSource, PoseSource } from './tracking/sources/index.js';
import { AttentionPicker } from './tracking/attention.js';
import { describeScene } from './tracking/geometry.js';
import { Speaker } from './conversation/speaker.js';
import { Dialogue } from './conversation/dialogue.js';
import { Listener, webSpeechSupported } from './conversation/listener.js';
import { createUi } from './ui/panel.js';
import { loadPlaceData, landmarkWorld, promptPlace } from './place.js';
import { createArPlacement } from './arPlacement.js';
// 見せ方(画面・AR・VR)の切りかえは、場所の柱が出している入口(docs/共通の決まり.md)
import { createPresentation } from '../../place/web/modes.js';
import { mountModeButtons } from '../../place/web/modeButtons.js';

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

const app = {
  character: null,
  place: null,
  persona: '',
  source: null, // 人の位置を返す入力(tracking/sources)。選ぶ前は null
  mode: 'none', // 'camera' | 'sim' | 'pose'
  autoGreet: params.get('auto') !== '0',
  status: null,
  metrics: [],
  lastAttention: { tracks: [], primaryId: null, speakerId: null },
};
window.__app = app; // 試験と開発の確認用
app.speaker = speaker;
app.stage = stage;
app.picker = picker;

/* ---------- 視線 ---------- */
// 視線の先は、キャラの座標(足元が原点・+z が正面・+x がお客さんから見て右)で考えて、世界の座標に直す。
// こうすると、場所の中でキャラが spawn の位置・向きに立っていても、同じ式で合う。
const toWorld = (local) => app.character.object3d.localToWorld(new THREE.Vector3(...local)).toArray();
const toLocal = (world) => app.character.object3d.worldToLocal(new THREE.Vector3(...world)).toArray();
const frameInfo = () => ({ toWorld, headY: stage.state.headY, camZ: stage.state.camZ });
let gazeOverride = null; // { pos:[x,y,z](世界), until:ms }
/** @returns {number[]|null} 目印を見るときは、キャラから見たその場所(指さしに使う) */
function setGaze(spec, ms = 2000) {
  if (!spec || spec === 'person') {
    gazeOverride = null;
    return null;
  }
  const until = performance.now() + ms + 600;
  if (spec === 'away') {
    gazeOverride = { pos: toWorld([-0.8, stage.state.headY + 0.3, stage.state.camZ * 0.8]), until };
    return null;
  }
  if (spec.startsWith('landmark:')) {
    const pos = landmarkWorld(app.place, spec.slice('landmark:'.length));
    if (!pos) return null;
    gazeOverride = { pos, until };
    return app.character.object3d.worldToLocal(new THREE.Vector3(...pos)).toArray();
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
  return describeScene(a.tracks, { primaryId: a.primaryId, speakerId: a.speakerId });
}

/* ---------- 声 ---------- */
let listener = null;
let lastInterimAt = 0; // 聞き取りの途中の文字が最後に届いた時刻(何か話した、の目印)
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
      onInterim: (t) => {
        lastInterimAt = performance.now();
        ui.caption(t, 0, 'user');
      },
      onFinal: (text, info) => {
        const t0 = info.lastVoicedAt || performance.now();
        dialogue.send({ text, t0, mode: 'voice' });
      },
      onVoice: (active) => {
        $('micBtn').classList.toggle('hearing', active);
        // 話している最中に声が出たら、止まって聞く
        if (active && speaker.speaking) dialogue.cancel();
        // 声が止まった(話し終わりらしい)ら、確定した文字を待たずに、あいづちの声を先に出す
        if (!active && performance.now() - lastInterimAt < 2500) dialogue.preFiller(listener.lastVoicedAt);
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
  const texts = {
    camera: 'カメラの映像は、この端末の中で人の位置を調べるだけに使います。保存も、送信もしません。',
    pose: 'カメラの映像は使っていません。この端末の位置だけで、あなたのいる方向を知っています。',
    sim: 'カメラは使っていません(マウスで人の位置を動かしています)。',
  };
  let text = texts[app.mode] ?? texts.sim;
  if (listener?.listening) text += ' 声の聞き取りには、ブラウザの聞き取りのサービスに音が送られます。';
  ui.privacy(text, app.mode !== 'camera');
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
  const info = app.source?.info() ?? { label: 'なし', ok: false };
  chips.push([app.mode === 'pose' ? '位置' : 'カメラ', info.label, info.ok ? 'ok' : 'warn']);
  chips.push(['人', String(app.lastAttention.tracks.length), '']);
  if (listener?.listening) chips.push(['聞き取り', 'ブラウザ', 'ok']);
  if (speaker.fillers.length) chips.push(['あいづち', `${speaker.fillers.length} 種類`, 'ok']);
  ui.chips(chips);
}

/* ---------- 毎フレーム ---------- */
let prevT = performance.now();
let presence = { since: 0, greetedAt: -1e9, lastSeen: 0 };
let chipClock = 0;

function frame(nowMs) {
  const dt = (nowMs - prevT) / 1000;
  prevT = nowMs;
  const c = app.character;
  if (!c) return;
  const nowS = nowMs / 1000;

  modes?.frame(); // Quest の中なら、見ている人の頭の位置が onViewer で届く

  // 1. 人の位置(入力から。ワールド座標)を、キャラの座標に直す
  const people = (app.source?.getPeople(nowMs) ?? []).map((p) => ({
    ...p,
    position: toLocal(p.position),
    gaze: p.gaze ? toLocal(p.gaze) : undefined,
  }));

  // 2. 誰を見るか
  const att = picker.update(people, nowS, { voiceActive: Boolean(listener?.voiceActive) });
  app.lastAttention = att;
  const primary = att.tracks.find((t) => t.id === att.primaryId);

  // 3. キャラの目と首
  if (gazeOverride && nowMs < gazeOverride.until) {
    c.lookAt(gazeOverride.pos);
  } else if (primary) {
    c.lookAt(toWorld(primary.gaze ?? primary.position));
  } else {
    c.lookAt(null);
  }

  // 4. 近づいた人に、こちらから声をかける
  if (primary) {
    const dist = Math.hypot(primary.position[0], primary.position[2]);
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
/* ---------- 外から位置を受け取る口(AR の殻アプリ・VR) ---------- */
// 座標は place.json と同じ(ワールド、m、y が上、右手系)。?source=pose で始めると、この位置の先を見る。
const poseSource = new PoseSource();
window.conversation = {
  /** 見ている人の頭のワールド座標(1 人)。null なら誰もいない */
  setViewer: (position) => poseSource.setViewer(position),
  /** 複数人: [{ id, position, speaking? }] */
  setPeople: (people) => poseSource.setPeople(people),
};
app.poseSource = poseSource;

/* ---------- 見せ方(画面・AR・VR) ---------- */
let modes = null;
let arPlacement = null;
let screenSource = null; // AR/VR に入る前の入力(戻るときに使う)
const headTmp = new THREE.Vector3();

/** 入力を替える。MediaPipe のカメラは、AR(殻のカメラ)と競合するので、離れるときに止める */
async function useSource(next, mode) {
  if (app.source === next) {
    app.mode = mode;
    return;
  }
  try {
    await app.source?.stop?.();
  } catch (err) {
    console.warn('入力を止められませんでした:', err.message);
  }
  await next.start();
  app.source = next;
  app.mode = mode;
  updatePrivacy();
}

async function onPresentationChange(mode) {
  stage.state.immersive = mode === 'ar' && Boolean(modes.nativeAR); // 殻のあいだは、射影行列を殻に任せる
  const place = app.place?.loaded;
  if (mode === 'screen') {
    arPlacement?.restore();
    arPlacement = null;
    if (place) place.object3d.visible = true;
    stage.resize();
    stage.frameCharacter(app.character, undefined, place?.object3d);
    if (screenSource) await useSource(screenSource, screenSource.kind === 'mediapipe' ? 'camera' : screenSource.kind).catch((e) => ui.error(e.message));
    screenSource = null;
    return;
  }
  if (!screenSource) screenSource = app.source && app.source !== poseSource ? app.source : null;
  if (mode === 'ar') {
    // AR の世界は、撮った部屋と重ならない。部屋は隠し、キャラは現実の床に立たせる
    if (place) place.object3d.visible = false;
    arPlacement = createArPlacement({ object3d: app.character.object3d, camera: stage.camera });
  }
  await useSource(poseSource, 'pose').catch((e) => ui.error(e.message));
}

async function setupPresentation() {
  modes = await createPresentation({
    renderer: stage.renderer,
    scene: stage.scene,
    camera: stage.camera,
    place: app.place.loaded ?? undefined,
    background: null, // 背景は、ページの CSS(AR のときは場所の柱が透明にする)
    onViewer: (cam) => {
      cam.getWorldPosition(headTmp);
      poseSource.setViewer(headTmp.toArray()); // 見ている人の頭 = カメラの位置
      arPlacement?.onPose();
    },
    onChange: (mode) => void onPresentationChange(mode),
    onHit: (p) => arPlacement?.onHit(p),
    onFloor: (y) => arPlacement?.onFloor(y),
  });
  mountModeButtons({ modes, container: $('modes'), onError: (e) => ui.error(e.message) });
  // iPhone の殻の中なら、すぐ AR に入る(殻は、入ったあとに姿勢を送り始める)
  if (modes.available.ar_kind === 'native') await modes.enter('ar').catch((e) => ui.error(e.message));
  app.modes = modes;
}

async function boot() {
  const status = $('gateStatus');
  const buttons = [$('startCam'), $('startSim')];
  buttons.forEach((b) => (b.disabled = true));
  status.textContent = 'キャラを読み込んでいます…';
  stage.resize();
  window.addEventListener('resize', () => {
    stage.resize();
    if (app.character) stage.frameCharacter(app.character, undefined, app.place?.loaded?.object3d);
  });
  try {
    const url = params.get('char') ?? '/characters/_test/character.json';
    app.place = await loadPlaceData(params.get('place'));
    const character = await loadCharacter(url);
    app.character = character;
    dialogue.character = character;
    if (app.place.loaded) {
      stage.scene.add(app.place.loaded.object3d);
      app.place.loaded.placeCharacter(character.object3d); // 場所が決めた位置・向きに立たせる
    }
    stage.scene.add(character.object3d);
    stage.frameCharacter(character, params.get('view') === 'full' ? 'full' : 'bust', app.place.loaded?.object3d);
    if (character.personaUrl) app.persona = await (await fetch(character.personaUrl)).text();
    status.textContent = '';
  } catch (err) {
    console.error(err);
    status.textContent = `キャラを読み込めませんでした: ${err.message}`;
    return;
  }
  await setupPresentation().catch((e) => console.warn('見せ方の切りかえを用意できませんでした:', e.message));
  await refreshStatus();
  setInterval(refreshStatus, 15000);
  speaker.loadFillers().then((n) => console.info(`あいづちの声: ${n} 種類`));
  updatePrivacy();
  buttons.forEach((b) => (b.disabled = false));
  stage.renderer.setAnimationLoop(frame); // XR(Quest)の中でも回るよう、requestAnimationFrame でなくこちらを使う

  /** 入力を選んで始める。失敗したら理由を出して、ゲートに戻る */
  async function startSource(kind, pending) {
    speaker.unlock(); // 音を出す許可は、最初のタップの中で取る
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = pending;
    try {
      const source =
        kind === 'camera'
          ? new MediapipeSource({ getFrame: frameInfo, gain: GAIN, hfovDeg: HFOV })
          : kind === 'pose'
            ? poseSource
            : new SimSource({ element: $('stage'), getFrame: frameInfo, gain: GAIN, hfovDeg: HFOV });
      await source.start();
      app.source = source;
      app.mode = kind;
      $('gate').classList.add('hidden');
      updatePrivacy();
    } catch (err) {
      console.error(err);
      status.textContent = `${kind === 'camera' ? 'カメラ' : '入力'}を使えませんでした(${err.message})。「カメラなしで試す」なら動かせます。`;
      buttons.forEach((b) => (b.disabled = false));
    }
  }
  const wantPose = params.get('source') === 'pose'; // AR(iPhone の殻アプリ)・VR(Quest)では、位置を外から受け取る
  $('startCam').addEventListener('click', () => (wantPose ? startSource('pose', '準備しています…') : startSource('camera', 'カメラとモデルを準備しています…')));
  $('startSim').addEventListener('click', () => startSource('sim', ''));
  if (wantPose) {
    $('startCam').textContent = 'はじめる';
    document.querySelector('.gate .fine').textContent = 'カメラの映像は使いません。この端末の位置だけで、あなたのいる方向を知ります。';
  }

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
