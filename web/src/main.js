// 会話の本体。キャラを出し、カメラで人を見つけて目と首で追い、話しかけられたら Claude に聞いて、声で答える。
import * as THREE from 'three';
import { createStage } from './scene.js';
import { characterUrl, loadCharacter, motionChoices } from './character/index.js';
import { MediapipeSource, SimSource, PoseSource, BridgeSource } from './tracking/sources/index.js';
import { AttentionPicker } from './tracking/attention.js';
import { describeScene } from './tracking/geometry.js';
import { Speaker } from './conversation/speaker.js';
import { Dialogue } from './conversation/dialogue.js';
import { Listener, webSpeechSupported } from './conversation/listener.js';
import { StereoMic } from './tracking/audio/stereoMic.js';
import { MisheardTracker, SHOP_CHOICES, RETRY_LINE, CHOICES_LINE } from './conversation/misheard.js';
import { createUi } from './ui/panel.js';
import { loadPlaceData, landmarkWorld, promptPlace } from './place.js';
import { createArPlacement } from './arPlacement.js';
import { createVrStage } from './vrStage.js';
import { createVrPanel } from './ui/vrPanel.js';
import { createAlignFlow } from './stage/alignFlow.js'; // 撮った部屋を現実に重ねる手順(場所の柱)
// 見せ方(画面・AR・VR)の切りかえは、場所の柱が出している入口(docs/共通の決まり.md)
import { createPresentation } from './stage/modes.js';
import { mountModeButtons } from './stage/modeButtons.js';
import { detectTierInBrowser, applyTier } from './stage/tiers.js'; // 端末の段(軽いのにきれい)

const params = new URLSearchParams(location.search);
const GAIN = Number(params.get('gain') ?? 2); // 視線の振れ幅の倍率
const HFOV = Number(params.get('hfov') ?? 65); // カメラの横の画角(度)
const APPROACH_DIST_M = 2.2; // この近さに来たら、声をかける
const APPROACH_HOLD_S = 1.2;
const GREET_COOLDOWN_S = 90;
// ヘッドセットのブラウザ。カメラは使えず、聞き取りはサーバーで行い、マイクの許可は VR に入る前に取る
const IS_HEADSET = params.get('headset') === '1' || /OculusBrowser|Quest/i.test(navigator.userAgent);
const VR_HELLO = 'こんにちは'; // コントローラーのトリガーで話しかける言葉(マイクが使えなくても、返事と声を確かめられる)

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
if (IS_HEADSET) document.documentElement.classList.add('is-headset');
if (params.get('led') === '1') document.documentElement.classList.add('is-led'); // 入口の LED: 顔にかぶる窓と操作の帯を隠す
app.speaker = speaker;
app.stage = stage;
app.THREE = THREE;
Object.defineProperty(app, 'listener', { get: () => listener });
app.picker = picker;
app.tier = detectTierInBrowser(stage.renderer, params); // 端末の段。数字の根拠は docs/重さの表.md

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
  motionChoices,
  interview: params.get('interview') === '1', // 入口のインタビューの型(返事 2 文まで)
  getContext: () => ({
    scene: sceneText(),
    character: { name: app.character.name, persona: app.persona },
    place: promptPlace(app.place, { character: app.character, arUnaligned: app.arUnaligned }),
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
// 声の向き(ステレオのマイク)。機材に依存しない: マイクの間隔などは URL で渡せる(?micspacing=0.06 ?mic=DVR ?micswap=1 ?ild=5)
let stereoMic = null;
function startStereoMic() {
  if (stereoMic && ['starting', 'stereo', 'mono'].includes(stereoMic.status)) return Promise.resolve(stereoMic.status);
  stereoMic = new StereoMic({
    deviceHint: params.get('mic') ?? undefined,
    micSpacingM: Number(params.get('micspacing')) || 0.06,
    swapLeftRight: params.get('micswap') === '1',
    ildDegPerDb: Number(params.get('ild')) || 0,
  });
  app.stereoMic = stereoMic;
  return stereoMic.start().then((st) => {
    updatePrivacy();
    return st;
  });
}
app.startStereo = startStereoMic;
let lastInterimAt = 0; // 聞き取りの途中の文字が最後に届いた時刻(何か話した、の目印)
let lastTextAt = 0; // 途中でも確定でも、文字が最後に届いた時刻
const misheard = new MisheardTracker();

/** よくある質問のボタン。押した言葉は、そのまま質問になる。店のデータがあるときだけ出す */
function showShopChoices(emphasis = false) {
  ui.choices(
    SHOP_CHOICES,
    (q) => {
      misheard.heard();
      speaker.unlock();
      ui.choices(SHOP_CHOICES, pickChoice); // 目立たせるのは、聞き取れなかった直後だけ
      dialogue.send({ text: q, mode: 'text' });
    },
    emphasis,
  );
}
const pickChoice = (q) => {
  speaker.unlock();
  dialogue.send({ text: q, mode: 'text' });
};

/** 声は出たのに文字にならなかった: 1 回目は聞き返し、2 回続けたら選択式 */
function onMisheard() {
  const step = misheard.miss();
  const line = step === 'choices' ? CHOICES_LINE : RETRY_LINE;
  ui.caption(line, 5000);
  speaker.enqueue(line, {}).catch(() => {});
  if (step === 'choices' && app.status?.shop?.available) showShopChoices(true);
}
/** 聞き取りをどの提供元でするか。ブラウザに無ければサーバー。どちらも無ければ null */
function listenProvider() {
  const serverOk = Boolean(app.status?.stt?.available);
  if (IS_HEADSET || params.get('stt') === 'server') return serverOk ? 'server' : null;
  if (webSpeechSupported()) return 'web';
  return serverOk ? 'server' : null;
}
async function toggleMic() {
  const btn = $('micBtn');
  if (listener?.listening) {
    listener.stop();
    listener = null;
    stereoMic?.stop();
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('hearing');
    updatePrivacy();
    return;
  }
  try {
    speaker.unlock();
    const provider = listenProvider();
    if (!provider) throw new Error('聞き取りを使えません(サーバーに faster-whisper が入っていないか、このブラウザが対応していません)');
    listener = new Listener({
      onInterim: (t) => {
        lastInterimAt = performance.now();
        lastTextAt = lastInterimAt;
        ui.caption(t, 0, 'user');
      },
      onFinal: (text, info) => {
        lastTextAt = performance.now();
        misheard.heard();
        const t0 = info.lastVoicedAt || performance.now();
        dialogue.send({ text, t0, mode: 'voice' });
      },
      onVoice: (active) => {
        $('micBtn').classList.toggle('hearing', active);
        // 話している最中に声が出たら、止まって聞く
        if (active && speaker.speaking) dialogue.cancel();
        // 声が止まった(話し終わりらしい)ら、確定した文字を待たずに、あいづちの声を先に出す
        if (!active && performance.now() - lastInterimAt < 2500) dialogue.preFiller(listener.lastVoicedAt);
        // 声は出たのに、しばらく待っても文字が 1 つも来ない: 聞き取れなかった(自分が話している間や返事の準備中は数えない)
        if (!active && !speaker.speaking && !dialogue.busy) {
          const endedAt = performance.now();
          setTimeout(() => {
            if (lastTextAt < endedAt && !speaker.speaking && !dialogue.busy && listener?.listening && !listener.transcribing) onMisheard();
          }, 2600);
        }
      },
      onError: (msg) => ui.error(msg),
      onEmpty: () => {
        if (!speaker.speaking && !dialogue.busy) onMisheard();
      },
    }, { provider, isBusy: () => speaker.speaking && params.get('bargein') !== '1' });
    await listener.start();
    // 声の向き。ステレオが取れなくても、聞き取りと映像はそのまま動く(ヘッドセットの中では、頭の位置が分かるので使わない)
    if (!IS_HEADSET) void startStereoMic();
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
    bridge: '床のカメラの機械が、あなたのいる向き(数字)だけをこの画面に送ります。映像は保存も、送信もしません。',
  };
  let text = texts[app.mode] ?? texts.sim;
  if (listener?.listening) text += listener.provider === 'server' ? ' 声は、この画面を配っている PC へ送って文字にします。音は保存しません。' : ' 声の聞き取りには、ブラウザの聞き取りのサービスに音が送られます。';
  if (stereoMic?.status === 'stereo') text += ' 声のする向きは、この端末の中で左右の音の差を調べるだけです(音は保存も、この仕組みからの送信もしません)。';
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
  if (listener?.listening) chips.push(['聞き取り', listener.provider === 'server' ? 'サーバー' : 'ブラウザ', 'ok']);
  if (stereoMic) {
    const sp = app.lastAttention?.speaker;
    const est = stereoMic.estimate();
    const m = est?.measurements?.[0];
    const label = stereoMic.status === 'stereo'
      ? (m ? `${m.bearingDeg >= 0 ? '右' : '左'} ${Math.abs(Math.round(m.bearingDeg))}°(確かさ ${m.confidence.toFixed(2)})${sp?.source && sp.source !== 'none' ? `・話し手 ${sp.source === 'audio+video' ? '音+映像' : sp.source === 'audio' ? '音' : '映像'}` : ''}` : 'ステレオ・待機')
      : stereoMic.status === 'mono' ? 'モノ(向きは出せない)' : stereoMic.status === 'error' ? 'マイクなし' : '準備中';
    chips.push(['声の向き', label, stereoMic.status === 'stereo' ? 'ok' : 'warn']);
  }
  if (speaker.fillers.length) chips.push(['あいづち', `${speaker.fillers.length} 種類`, 'ok']);
  ui.chips(chips);
}

/** VR の中の板に出す、いまの状態 */
function vrState() {
  if (speaker.speaking) return 'speaking';
  if (listener?.voiceActive) return 'hearing';
  if (listener?.transcribing) return 'transcribing';
  if (dialogue.busy) return 'thinking';
  return listener?.listening ? 'idle' : 'off';
}

/* ---------- 毎フレーム ---------- */
let prevT = performance.now();
let presence = { since: 0, greetedAt: -1e9, lastSeen: 0 };
let chipClock = 0;

function frame(rawMs) {
  // XR の時刻は、端末によって performance.now と基準が違うことがあるので、そろえる
  const nowMs = stage.renderer.xr.isPresenting ? performance.now() : rawMs;
  const dt = (nowMs - prevT) / 1000;
  prevT = nowMs;
  const c = app.character;
  if (!c) return;
  const nowS = nowMs / 1000;

  modes?.frame(); // Quest の中なら、見ている人の頭の位置が onViewer で届く
  vrStage?.update(dt);

  // 1. 人の位置(入力から。ワールド座標)を、キャラの座標に直す
  const people = (app.source?.getPeople(nowMs) ?? []).map((p) => ({
    ...p,
    position: toLocal(p.position),
    gaze: p.gaze ? toLocal(p.gaze) : undefined,
  }));

  // 2. 誰を見るか
  // 声の向き(ステレオのマイク)。キャラ自身が話している間は、自分の声を拾うので使わない
  const audio = speaker.speaking ? null : (stereoMic?.estimate() ?? null);
  const att = picker.update(people, nowS, { voiceActive: Boolean(listener?.voiceActive), audio });
  app.lastAttention = att;
  const primary = att.tracks.find((t) => t.id === att.primaryId);

  // 3. キャラの目と首
  if (gazeOverride && nowMs < gazeOverride.until) {
    c.lookAt(gazeOverride.pos);
  } else if (primary) {
    c.lookAt(toWorld(primary.gaze ?? primary.position));
  } else if (att.speaker.unseenBearingDeg !== null) {
    // 誰も映っていないが、声はする: 声のする向きへ顔を向ける(マイクから見て右が正 → キャラの座標では x が負)
    const b = (att.speaker.unseenBearingDeg * Math.PI) / 180;
    c.lookAt(toWorld([-1.8 * Math.sin(b), stage.state.headY, 1.8 * Math.cos(b)]));
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
  if (vrPanel?.mesh.visible) {
    vrPanel.set({ state: vrState() });
    vrPanel.place(c.object3d, stage.state.height, stage.camera);
  }
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

/* ---------- 入口の LED: 床のカメラの向きを、自分のサーバーから読む ---------- */
// 視線の橋(別の機械でもよい)→ UDP → サーバー(GAZE_UDP_PORT)→ ここ。届くのは向きの数字だけ。こちらからは何も送らない(GET)。
async function pollGaze(source) {
  const res = await fetch('/api/gaze/now', { cache: 'no-store' });
  if (!res.ok) throw new Error(`視線の受け口が答えません (${res.status})。サーバーを GAZE_UDP_PORT 付きで起動してください`);
  const g = await res.json();
  if (g) source.receive(g);
}
function startGazePolling(source, everyMs = 66) {
  const loop = async () => {
    if (app.source !== source) return; // 入力を替えたら止まる
    await pollGaze(source).catch(() => {});
    setTimeout(loop, everyMs);
  };
  setTimeout(loop, everyMs);
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
Object.defineProperty(app, 'alignFlow', { get: () => alignFlow }); // 確認用

/* ---------- 見せ方(画面・AR・VR) ---------- */
let modes = null;
let arPlacement = null;
let alignFlow = null; // AR で、撮った部屋を現実に重ねる手順(床を 2 回タップ)
let alignHits = 0;
let screenSource = null; // AR/VR に入る前の入力(戻るときに使う)
let vrStage = null; // VR の立ち位置と背景
let vrPanel = null; // VR の中の文字の板
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
  // ヘッドセットの中(WebXR)では、ページの文字が見えないので、状態を 3D の板に出す
  const webxr = mode !== 'screen' && Boolean(modes.session);
  if (webxr) {
    ui.align(null);
    vrPanel ??= createVrPanel({ scene: stage.scene });
    app.vrPanel = vrPanel;
    ui.setMirror((next) => vrPanel.set(next));
    vrPanel.set({ state: vrState() });
    vrPanel.setVisible(true);
    modes.session.session.addEventListener('select', onVrSelect);
  } else if (vrPanel) {
    vrPanel.setVisible(false);
    ui.setMirror(null);
  }
  if (mode === 'vr') {
    vrStage = createVrStage({ renderer: stage.renderer, scene: stage.scene, getCharacterObject: () => app.character.object3d });
    app.vrStage = vrStage;
    vrStage.start({ floor: modes.session.floor, showBackdrop: !place });
  } else if (vrStage) {
    vrStage.stop();
    vrStage = null;
    app.vrStage = null;
  }
  if (mode === 'screen') {
    arPlacement?.restore();
    arPlacement = null;
    alignFlow?.reset();
    alignFlow = null;
    app.arUnaligned = false;
    ui.align(null);
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
    if (modes.session?.floor) arPlacement.onFloor(0); // Quest の AR の床は、local-floor の y=0
    // 撮った部屋があれば、床を 2 回タップして現実に重ねる。重なるまで、部屋の目印は Claude に渡さない
    if (place && modes.nativeAR) {
      app.arUnaligned = true;
      alignHits = 0;
      alignFlow = createAlignFlow({ place });
      ui.align(alignFlow.prompt);
    }
  }
  await useSource(poseSource, 'pose').catch((e) => ui.error(e.message));
}

/** コントローラーのトリガー(手なら、つまむ): 話しかける。マイクが使えなくても、返事と声を確かめられる */
function onVrSelect() {
  speaker.unlock();
  if (!dialogue.busy && !speaker.speaking) dialogue.send({ text: VR_HELLO, mode: 'text' });
}

/** 殻で床をタップした点。位置合わせの途中ならそれに使い、終わったあとは、キャラをそこへ移す */
function handleHit(p) {
  const place = app.place?.loaded;
  if (alignFlow && !alignFlow.done) {
    // 床の高さが分かっていれば、1 回目のタップの前に作り直して渡す(床の高さは、あとから届くことがある)
    if (alignHits === 0 && arPlacement?.floor != null) alignFlow = createAlignFlow({ place, floorY: arPlacement.floor });
    alignHits += 1;
    alignFlow.submit(p);
    ui.align(alignFlow.prompt, alignFlow.done && !alignFlow.ok);
    if (alignFlow.done && alignFlow.ok) {
      place.placeCharacter(app.character.object3d); // 部屋の立ち位置(現実の中の)に立たせる
      arPlacement.markPlaced();
      place.object3d.visible = true; // 位置が合ったので、撮った部屋は、見えない遮蔽物として使う
      app.arUnaligned = false;
      setTimeout(() => ui.align(null), 3500);
    } else if (alignFlow.done) {
      // 食い違いが大きい。少し見せてから、やり直す
      setTimeout(() => {
        alignFlow?.reset();
        alignHits = 0;
        if (alignFlow) ui.align(alignFlow.prompt);
      }, 3000);
    }
    return;
  }
  arPlacement?.onHit(p);
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
    onHit: (p) => handleHit(p),
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
  // 下の帯(よくある質問のボタン・入力欄)の高さが変わったら、全身の見せ方を取り直す(足が帯に隠れないように)
  const bottomBar = document.querySelector('.bottom');
  const fitBottom = () => {
    document.documentElement.style.setProperty('--bottom-h', `${bottomBar.offsetHeight}px`);
    stage.state.bottomInset = bottomBar.offsetHeight + 8 + 80; // 80 は、帯の上に出る字幕と札の分(足に重ならないように)
    if (app.character && !stage.state.immersive) stage.frameCharacter(app.character, undefined, app.place?.loaded?.object3d);
  };
  new ResizeObserver(fitBottom).observe(bottomBar);
  fitBottom();
  let readyAt = null;
  try {
    const url = characterUrl(params.get('character') ?? params.get('char')); // id・URL のどちらでもよい
    app.place = await loadPlaceData(params.get('place'));
    // 毛の層は重ね描きで、ソフト描画で 20 倍遅かった(実測)。端末の段で、スマホ・弱い端末・ヘッドセットは減らす(PC は今のまま)。?fur= で決め打ち
    const tierOverrides = applyTier(stage, app.tier, window.devicePixelRatio);
    if (Number(params.get('fur')) > 0) tierOverrides.furLayers = Number(params.get('fur'));
    const character = await loadCharacter(url, tierOverrides);
    app.character = character;
    dialogue.character = character;
    if (app.place.loaded) {
      stage.scene.add(app.place.loaded.object3d);
      app.place.loaded.placeCharacter(character.object3d); // 場所が決めた位置・向きに立たせる
    }
    stage.scene.add(character.object3d);
    // 人型でないキャラ(rig)は、上半身でなく全身を見せる
    const view = params.get('view') ?? (character.kind === 'rig' ? 'full' : 'bust');
    stage.frameCharacter(character, view === 'full' ? 'full' : 'bust', app.place.loaded?.object3d);
    if (character.personaUrl) app.persona = await (await fetch(character.personaUrl)).text();
    status.textContent = '';
    readyAt = performance.now(); // キャラが出た時刻(?perf=1 で使う)
  } catch (err) {
    console.error(err);
    status.textContent = `キャラを読み込めませんでした: ${err.message}`;
    return;
  }
  await setupPresentation().catch((e) => console.warn('見せ方の切りかえを用意できませんでした:', e.message));
  await refreshStatus();
  setInterval(refreshStatus, 15000);
  if (app.status?.shop?.available) showShopChoices(); // 店のデータがあるときだけ、よくある質問のボタンを出す
  speaker.loadFillers().then((n) => console.info(`あいづちの声: ${n} 種類`));
  updatePrivacy();
  buttons.forEach((b) => (b.disabled = false));
  stage.renderer.setAnimationLoop(frame); // XR(Quest)の中でも回るよう、requestAnimationFrame でなくこちらを使う
  // ?perf=1: いまの重さを測る(L0。数字は window.__perf。測りの部品は、このときだけ読む)
  if (params.get('perf') === '1') import('./stage/perf.js').then(({ startPerf }) => startPerf({ stage, character: app.character, params, readyAt, tier: app.tier }));

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
            : kind === 'bridge'
              ? new BridgeSource({ getFrame: frameInfo }) // 入口の LED: 床のカメラの向きを、視線の橋 → サーバーから受ける
              : new SimSource({ element: $('stage'), getFrame: frameInfo, gain: GAIN, hfovDeg: HFOV });
      if (kind === 'bridge') await pollGaze(source); // 最初の 1 回で、受け口があるかを確かめる(無ければ理由を出す)
      await source.start();
      app.source = source;
      app.mode = kind;
      if (kind === 'bridge') startGazePolling(source);
      $('gate').classList.add('hidden');
      updatePrivacy();
      if (IS_HEADSET) {
        // マイクの許可は、VR に入る前のこの画面で取る(VR の中で許可の窓が出るとどうなるかは、資料が無い)
        await toggleMic();
        if (modes?.available.vr) ui.align(listener?.listening ? '左上の「VR で見る」を押してください' : 'マイクなしで進めます。左上の「VR で見る」を押してください');
      }
    } catch (err) {
      console.error(err);
      status.textContent = `${kind === 'camera' ? 'カメラ' : '入力'}を使えませんでした(${err.message})。「カメラなしで試す」なら動かせます。`;
      buttons.forEach((b) => (b.disabled = false));
    }
  }
  const wantPose = params.get('source') === 'pose' || IS_HEADSET; // AR(iPhone の殻アプリ)・VR(Quest)では、位置を外から受け取る
  const wantBridge = params.get('source') === 'bridge'; // 入口の LED: 床のカメラ(別の機械でもよい)の向きを、サーバー経由で受ける。この端末のカメラは使わない
  $('startCam').addEventListener('click', () =>
    wantBridge ? startSource('bridge', '床のカメラにつないでいます…') : wantPose ? startSource('pose', '準備しています…') : startSource('camera', 'カメラとモデルを準備しています…'),
  );
  $('startSim').addEventListener('click', () => startSource('sim', ''));
  if (wantBridge) {
    $('startCam').textContent = 'はじめる';
    document.querySelector('.gate .fine').textContent = 'この画面はカメラを使いません。床のカメラの機械から、あなたのいる向き(数字)だけを受け取ります。';
  }
  // 入口の LED は、人がボタンを押さない。?autostart=1 で、ゲートを飛ばして始める(音を出す許可は取れないので、口と字幕だけ)
  if (params.get('autostart') === '1') $('startCam').click();
  if (wantPose) {
    $('startCam').textContent = IS_HEADSET ? 'はじめる(マイクを使います)' : 'はじめる';
    document.querySelector('.gate .fine').textContent = 'カメラの映像は使いません。この端末の位置だけで、あなたのいる方向を知ります。';
    if (IS_HEADSET) $('startSim').hidden = true;
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
  if (!listenProvider()) {
    $('micBtn').disabled = true;
    $('micBtn').title = 'このブラウザは声の聞き取りに対応していません';
  }
}

boot();
