// 会話の本体。キャラを出し、カメラで人を見つけて目と首で追い、話しかけられたら Claude に聞いて、声で答える。
import * as THREE from 'three';
import { createStage } from './scene.js';
import { loadFirstCharacter, loadCharacter, availableLooks, motionChoices, MAIN_CHARACTER } from './character/index.js';
import { writeRemembered } from './character/looks.js'; // このタブで選んだ見た目(3D・2D)を覚える
import { guardBottom } from './stage/framing.js'; // キャラを上の段の下に収める
import { pickSpec, isLoopbackPage, SPEC_NOTICE } from './character/urlSpec.js'; // ?character= ?place= は公開の URL では id だけ(CRITsec F5)
import { shouldOpenFirstRun, FIRST_RUN_DONE_KEY } from './stage/firstVisit.js'; // 初めての訪問なら、入口の後に 7 歩を出す(CRITux 2)
// 入力の差し替え口(tracking/sources/index.js の約束)。カメラの顔の部品(mediapipeSource.js)は重いので、ここでは読まず、
// 「はじめる」を押した時に読む(最初の読み込みを軽くする。重さの表 L3)
import { SimSource } from './tracking/sources/simSource.js';
import { PoseSource } from './tracking/sources/poseSource.js';
import { BridgeSource } from './tracking/sources/bridgeSource.js';
import { AttentionPicker } from './tracking/attention.js';
import { describeScene } from './tracking/geometry.js';
import { Speaker } from './conversation/speaker.js';
import { Dialogue } from './conversation/dialogue.js';
import { Listener, webSpeechSupported } from './conversation/listener.js';
import { StereoMic } from './tracking/audio/stereoMic.js';
import { MisheardTracker, SHOP_CHOICES, RETRY_LINE, CHOICES_LINE } from './conversation/misheard.js';
import { createUi, FALLBACK_BRAIN_NOTICE } from './ui/panel.js';
import { getDemoPass, setDemoPass } from './conversation/demoPass.js'; // 合言葉(S3。会話と記憶の通信に見出し x-demo-pass で付く)
import { mountMemoryPanel } from './ui/memoryPanel.js'; // 記憶の札(S3。覚えていることの一覧・番号・わすれる)
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
// このタブだけで覚える所(見た目の切り替え)。使えないブラウザ(プライベートの設定など)では覚えないだけ
const tabMemory = (() => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
})();
// このブラウザで覚える所(初めての会話を終えたか「あとで」を押した印。書くのは S4 の初めての会話)。読むだけ
const siteMemory = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
// 指で触る端末(スマホ・タブレット)か。ボタンと説明の言葉を「マウス」でなく「指」にする(CRITux 15)
const TOUCH = (() => {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
})();
// 初めての会話(S4 の mountFirstRun の返り値)。読み込みは下の import。入口を閉じた後に、初めての訪問なら出す
let firstRunReady = Promise.resolve(null);
let firstRunDoneKey = FIRST_RUN_DONE_KEY;
const firstRunWanted = () => shouldOpenFirstRun({ params, storage: siteMemory, doneKey: firstRunDoneKey, headset: IS_HEADSET });
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
  firstFrameAt: null, // キャラの入った最初のコマを描き終えた時刻(ms。?perf=1 の first_frame_ms)
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
  if (Array.isArray(spec)) {
    // 動きの意図(K2)の gaze: ワールド座標の点。キャラから見た位置を返す(指さしに使う)
    gazeOverride = { pos: spec, until };
    return toLocal(spec);
  }
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

/* ---------- 会話のイベント(記憶の札・仮の頭脳の知らせ) ---------- */
let memory = null; // 記憶の札(S3 の mountMemoryPanel の返り値)
let brainNoticeText = null; // イベントで届いた「仮の頭脳です(理由)」
let eventBrain = null; // 会話のイベントで分かった頭脳('haiku' | 'mock')。公開の関数の fallback も mock

/** サーバーの会話のイベントを 1 つ受ける。Dialogue の onEvent で、手元のサーバー(流れる形)も公開の関数(まとめた JSON)も全部届く */
function onChatEvent(ev) {
  memory?.onChatEvent(ev); // 覚えた({type:'memory', added})・消したの知らせで一覧を読み直す
  if (ev?.type === 'meta') {
    if (ev.brain) eventBrain = ev.brain;
    else if (ev.fallback) eventBrain = 'mock'; // 公開の関数の先頭の知らせ(brain が来る前に、仮の頭脳だと分かる)
    if (ev.notice) brainNoticeText = ev.notice; // 上限・合言葉など、理由つきの知らせ(K5)
    else if (ev.brain === 'haiku') brainNoticeText = null;
    updateBrainNotice();
  }
}

/** いま話している頭脳。手元のサーバーは /api/status、公開の URL は会話のイベントから */
function currentBrain() {
  if (app.status?.brain) return app.status.brain;
  if (eventBrain) return eventBrain;
  return dialogue.brain && dialogue.brain !== 'unknown' ? dialogue.brain : null;
}

/** 仮の頭脳で話している間は、字幕の上に知らせを出す(契約 K5: 断らずに話し続け、そうだと分かるようにする) */
function updateBrainNotice() {
  ui.brainNotice(currentBrain() === 'mock' ? (brainNoticeText ?? FALLBACK_BRAIN_NOTICE) : null);
}

// 記憶の引き出しを開いた時は、合鍵を確かめて一覧を読み直す(別の端末で消した・番号で受け取った後でも合うように)。
// forgotten の形で渡すと、札は合鍵を確かめ(消えていれば作り直し)、一覧を読む(memoryPanel.js の onChatEvent)
const resyncMemory = () => memory?.onChatEvent({ type: 'memory', forgotten: true });

/** 会話を 1 回送る。どの入口(文字・声・ボタン・近づいた人・VR)も、ここを通す。記憶の一覧は会話のイベントで読み直される */
function talk(turn) {
  return dialogue.send(turn).then(updateBrainNotice);
}

/* ---------- 会話 ---------- */
const dialogue = new Dialogue({
  character: null, // 読み込み後に入れる
  speaker,
  ui,
  setGaze,
  motionChoices,
  onEvent: onChatEvent, // サーバーのイベントが全部届く(記憶の札・仮の頭脳の知らせ)
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
    // 分かる言葉で(CRITux 18): 「返事まで 281ms(参考: 頭脳か声が仮)・目標 1200ms」は読めなかった
    const sec = (ms) => `${(ms / 1000).toFixed(1)} 秒`;
    ui.foot(
      `返事が始まるまで ${sec(entry.totalMs)}${entry.valid ? '' : '(仮の頭脳か声なしなので、参考の値)'}` +
        `${med !== null ? ` ・ ふだん ${sec(med)}(${valid.length} 回の真ん中)` : ''}` +
        ` ・ 目安は 1.2 秒以内`,
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
      void talk({ text: q, mode: 'text' });
    },
    emphasis,
  );
}
const pickChoice = (q) => {
  speaker.unlock();
  void talk({ text: q, mode: 'text' });
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
        void talk({ text, t0, mode: 'voice' });
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
    sim: TOUCH ? 'カメラは使っていません(画面を指でなぞった向きに、人がいることにしています)。' : 'カメラは使っていません(マウスの向きに、人がいることにしています)。',
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
    const res = await fetch('/api/status');
    app.status = res.ok ? await res.json() : null; // 公開の URL には /api/status が無い(null のまま)
  } catch {
    app.status = null;
  }
}

function updateChips() {
  const s = app.status;
  const chips = [];
  const brain = currentBrain();
  chips.push(['頭脳', brain === 'haiku' ? 'Claude Haiku' : brain === 'mock' ? '仮の頭脳' : '—', brain === 'haiku' ? 'ok' : 'warn']);
  const ttsOk = s?.tts?.available && !speaker.ttsError;
  chips.push(['声', ttsOk ? `あり(今日の残り ${s.tts.remainingToday} 字)` : '字幕のみ', ttsOk ? 'ok' : 'warn']);
  // 分かる言葉で(CRITux 18): カメラの道は「GPU 60fps」でなく「オン」、カメラなしは「マウスで試し中」でなく「なし」。位置・床のカメラはその入力の言葉
  const info = app.source?.info() ?? { label: 'なし', ok: false };
  const noCamera = app.mode === 'sim' || !app.source;
  const camera = app.mode === 'camera' ? (info.ok ? 'オン' : '準備中') : noCamera ? 'なし' : info.label;
  chips.push([app.mode === 'pose' ? '位置' : 'カメラ', camera, noCamera ? '' : info.ok ? 'ok' : 'warn']);
  chips.push(['見えている人', `${app.lastAttention.tracks.length} 人`, '']);
  if (listener?.listening) chips.push(['聞き取り', listener.provider === 'server' ? 'この PC' : 'ブラウザ', 'ok']);
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
      void talk({ trigger: 'approach', mode: 'text' });
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
  if (app.firstFrameAt === null) app.firstFrameAt = performance.now();

  if (nowMs - chipClock > 500) {
    chipClock = nowMs;
    updateChips();
    updateBrainNotice();
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
  if (!dialogue.busy && !speaker.speaking) void talk({ text: VR_HELLO, mode: 'text' });
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

/* ---------- キャラの見せ方(上の段と下の帯の間に収める) ---------- */
// 上の段: 上の札・見せ方のボタン・覚えていること・見た目の切り替え・「Claude の考え」の見出し。
// 「Claude の考え」を開いている間は、窓の全体も数える(CRITux 21: スマホで開くと顔に重なった。キャラを窓の下へ置き直す)
const TOP_GUARD = '.top .chip, .top .top-row > *, #thoughtToggle, #thought:not(.collapsed)';
const TOP_GAP_PX = 8; // 上の段とキャラの頭のすき間

/** 画面の横の範囲 [left, right] に重なる上の段の、下の端(px)。scene.js の frameCharacter が、頭と耳を段の下に収めるのに使う */
function topGuard(left, right) {
  return guardBottom([...document.querySelectorAll(TOP_GUARD)].map((el) => el.getBoundingClientRect()), left, right, TOP_GAP_PX);
}
stage.state.topGuard = topGuard;

/** 今の見せ方で、キャラを置き直す(画面の大きさ・上の段・下の帯が変わった時)。AR・VR の間は端末が決めるので何もしない */
function reframe() {
  if (app.character && !stage.state.immersive) stage.frameCharacter(app.character, undefined, app.place?.loaded?.object3d);
}

/* ---------- 見た目の切り替え(3D と 2D。両方あるキャラだけ。このタブだけで覚える) ---------- */
const lookCache = new Map(); // 見た目 → 読み込んだキャラ(捨てずに持つ。2 回目からはすぐ替わる)
let lookBusy = false;

/** 両方の見た目があるキャラなら、上の段に切り替えを出す */
async function setupLookSwitch() {
  const box = $('lookSwitch');
  if (!box || IS_HEADSET || ['led', 'autostart'].some((k) => params.get(k) === '1') || params.get('perf') === '1') return;
  const looks = await availableLooks(app.character).catch((err) => {
    console.warn('見た目の種類を調べられませんでした:', err.message);
    return [];
  });
  if (!(looks.includes('3d') && looks.includes('2d'))) return;
  lookCache.set(app.character.look, app.character);
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-look]');
    if (btn) void switchLook(btn.dataset.look);
  });
  syncLookSwitch();
  box.hidden = false;
}

function syncLookSwitch() {
  const box = $('lookSwitch');
  for (const b of box.querySelectorAll('button[data-look]')) {
    b.setAttribute('aria-pressed', String(b.dataset.look === app.character.look));
    b.disabled = lookBusy;
  }
}

/** 見た目を替える。読み込めなければ、今の見た目のまま理由を出す */
async function switchLook(look) {
  if (lookBusy || !app.character || look === app.character.look) return;
  if (modes && modes.mode !== 'screen') return; // AR・VR の間は替えない(位置合わせと舞台がキャラを持っている)
  lookBusy = true;
  syncLookSwitch();
  try {
    let next = lookCache.get(look);
    if (!next) {
      next = await loadCharacter(app.character.lookSource.url, { ...app.tierOverrides, look });
      if (next.look !== look) throw new Error(`${look === '2d' ? '2D' : '3D'} の形を読めませんでした`);
      lookCache.set(look, next);
    }
    swapCharacter(next);
    writeRemembered(tabMemory, next.lookSource?.json?.id ?? next.id ?? app.characterId, look); // 読む側(loadCharacter)と同じ id
    // URL に ?look= があれば、選んだ方に書き換える(読み込み直しても、選んだ見た目のまま)
    if (params.has('look')) {
      const url = new URL(location.href);
      url.searchParams.set('look', look);
      history.replaceState(history.state, '', url);
    }
  } catch (err) {
    console.error(err);
    ui.error(`見た目を替えられませんでした(${err.message})`);
  } finally {
    lookBusy = false;
    syncLookSwitch();
  }
}

/** 舞台のキャラを入れ替える。位置・向き・会話はそのまま */
function swapCharacter(next) {
  const prev = app.character;
  if (app.place?.loaded) app.place.loaded.placeCharacter(next.object3d);
  else {
    next.object3d.position.copy(prev.object3d.position);
    next.object3d.quaternion.copy(prev.object3d.quaternion);
  }
  stage.scene.remove(prev.object3d);
  stage.scene.add(next.object3d);
  app.character = next;
  dialogue.character = next;
  document.documentElement.dataset.look = next.look ?? '3d';
  stage.frameCharacter(next, characterView(next), app.place?.loaded?.object3d);
}

/**
 * キャラの人格の文(persona.md)を読む。無い(404・頁の代わり・JSON)時は空(届いた 404 の文や頁を、人格として頭脳に渡さない)。
 * 初めての会話(S4)が、見本の子を読み込み直しなしで舞台に出す時にも使う(app.readPersona)
 */
async function readPersona(character) {
  if (!character?.personaUrl) return '';
  const res = await fetch(character.personaUrl).catch(() => null);
  const text = res?.ok && !/html|json/i.test(res.headers.get('content-type') ?? '') ? await res.text() : '';
  if (!text) console.warn(`人格の文を読めませんでした(${res?.status ?? '通信できない'}): ${character.personaUrl}`);
  return text;
}
// 初めての会話(S4)が、7 歩の途中で見本の子を読み込み直しなしで出し、終わったら主役に戻すための入口(S4 の頼み。司令塔の決め D2・D4)
app.swapCharacter = swapCharacter;
app.readPersona = readPersona;

/** 人型でないキャラ(rig)と 2D の板は、上半身でなく全身を見せる(?view= で決め打ち) */
function characterView(character) {
  const view = params.get('view') ?? (character.kind === 'vrm' ? 'bust' : 'full');
  return view === 'full' ? 'full' : 'bust';
}

/* ---------- 入口の文(CRITux 2・10・15・24) ---------- */
// 製品の名前と案内役(主役ノリー。ほかの子なら、その子の名前)・本当にできる事(声は、声の鍵がある時だけ)・押すボタンの言葉(指かマウスか)・
// 初めての訪問なら、入口の後に 7 歩が始まる事。文字は textContent だけで入れる
function fillGate() {
  const c = app.character;
  const guide = $('gateGuide');
  if (guide && c && (app.characterId ?? c.id) !== MAIN_CHARACTER.id) guide.textContent = `案内するのは「${c.name ?? app.characterId ?? 'この子'}」です。`;
  const lead = $('gateLead');
  const voice = Boolean(app.status?.tts?.available);
  if (lead) lead.textContent = voice ? 'キャラがあなたの方を見て、声と文字で答えます。' : 'キャラがあなたの方を見て、文字で答えます。声は、声の鍵があるときだけ出ます。';
  const first = $('gateFirst');
  if (first) first.hidden = !firstRunWanted();
  const simSub = $('simSub');
  if (simSub) simSub.textContent = TOUCH ? '画面を指でなぞると、その向きを見ます' : 'マウスを動かすと、その向きを見ます';
}

/** 入口を閉じた(どの入力でも)。上の段を出し、初めての訪問なら「はじめての会話」(7 歩)を出す */
function gateClosed() {
  $('gate').classList.add('hidden');
  document.documentElement.classList.remove('gate-up');
  if (!firstRunWanted()) return;
  void firstRunReady.then((api) => {
    if (api && !(api.sheet && !api.sheet.closed)) api.start();
  });
}

/* ---------- 合言葉(契約 K5) ---------- */
// 公開の URL(手元のサーバーの /api/status が無い)か ?askpass=1 のときだけ、ゲートに合言葉の欄を出す。
// 合言葉は URL に入れない。このタブの中だけに持ち、会話の見出し(x-demo-pass)で送る(送るのは会話の側)。
function setupPass() {
  const field = $('passField');
  const input = $('passInput');
  if (!field || !input) return;
  field.hidden = Boolean(app.status) && params.get('askpass') !== '1';
  input.value = getDemoPass();
  input.addEventListener('input', () => {
    setDemoPass(input.value);
    syncMemoryPass();
  });
}

/** 記憶の札の「番号を出す」にも同じ合言葉を使う(札の合言葉の欄は隠したまま、値だけ入れる) */
function syncMemoryPass() {
  const el = memory?.root.querySelector('.mem-pass');
  if (el) el.value = getDemoPass();
}

/* ---------- 記憶の札(S3 の mountMemoryPanel) ---------- */
// 覚えていることの一覧・1 つずつ消す・全部わすれる・別の端末へ渡す番号。上の段の「覚えていること」の引き出しに入れる。
// ?memory=0 と、重さを測る時(?perf=1)は付けない(測るたびに合鍵を作らない)
function setupMemory() {
  if (params.get('memory') === '0' || params.get('perf') === '1') return;
  const drawer = $('memoryDrawer');
  const slot = $('memorySlot');
  if (!drawer || !slot) return;
  memory = mountMemoryPanel(slot, { askPass: false });
  app.memory = memory;
  drawer.hidden = false;
  syncMemoryPass();
  drawer.addEventListener('toggle', () => {
    if (drawer.open) resyncMemory(); // 開くたびに、合鍵を確かめて一覧を読み直す
  });
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
    reframe();
  };
  new ResizeObserver(fitBottom).observe(bottomBar);
  fitBottom();
  // 上の段(札・ボタン)の高さが変わったら(始めると札が 2 行になる・ボタンが増える)、「Claude の考え」をその下へ下げ(--top-h)、
  // キャラを置き直す(頭と耳が段の下に入らないように)。幅 390 で、考えの見出しが「覚えていること」に重なって押せなかった
  const topBar = document.querySelector('.top');
  const fitTop = () => {
    document.documentElement.style.setProperty('--top-h', `${topBar.offsetHeight}px`);
    reframe();
  };
  new ResizeObserver(fitTop).observe(topBar);
  fitTop();
  // 「Claude の考え」を開く・閉じる(大きさが変わる)と、キャラを置き直す(開いた窓の下へ。CRITux 21)
  new ResizeObserver(reframe).observe($('thought'));
  // ?character= と ?place= は、公開の URL では id だけを読む(外の URL のキャラ・人格・場所の文を、公式の画面に出さない。CRITsec F5)。
  // パスや URL は、この PC の中(localhost など)で開いた時だけ(開発の確かめ)
  const allowPath = isLoopbackPage(location);
  const charPick = pickSpec(params.get('character') ?? params.get('char'), { allowPath });
  const placePick = pickSpec(params.get('place'), { allowPath });
  app.urlNotices = [...(charPick.rejected ? [SPEC_NOTICE.character] : []), ...(placePick.rejected ? [SPEC_NOTICE.place] : [])];
  if (app.urlNotices.length) console.warn(app.urlNotices.join(' '));
  let readyAt = null;
  let loopStartAt = null;
  try {
    app.place = await loadPlaceData(placePick.spec);
    // 毛の層は重ね描きで、ソフト描画で 20 倍遅かった(実測)。端末の段で、スマホ・弱い端末・ヘッドセットは減らす(PC は今のまま)。?fur= で決め打ち
    const tierOverrides = applyTier(stage, app.tier, window.devicePixelRatio);
    if (Number(params.get('fur')) > 0) tierOverrides.furLayers = Number(params.get('fur'));
    app.tierOverrides = tierOverrides; // 見た目を切り替える時も同じ段で読む
    // ?character= は id(公開の URL)か、この PC の中ならパス・URL も。無ければ主役ノリー → ようこそくんの順に、出せるキャラ。
    // 見た目の方式は ?look=2d|3d → このタブで選んだ物 → looks.default の順
    const { character, id } = await loadFirstCharacter(charPick.spec, { ...tierOverrides, look: params.get('look') ?? '', lookMemory: tabMemory });
    app.character = character;
    app.characterId = id;
    dialogue.character = character;
    speaker.setVoice({ seed: character.name ?? id ?? '' }); // 声が無い時の「ピッ」の高さと音色をキャラごとに(S3 の speaker)
    document.documentElement.dataset.look = character.look ?? '3d';
    if (app.place.loaded) {
      stage.scene.add(app.place.loaded.object3d);
      app.place.loaded.placeCharacter(character.object3d); // 場所が決めた位置・向きに立たせる
    }
    stage.scene.add(character.object3d);
    // 人型でないキャラ(rig)と 2D の板は、上半身でなく全身を見せる
    stage.frameCharacter(character, characterView(character), app.place.loaded?.object3d);
    readyAt = performance.now(); // キャラを舞台に置いた時刻(?perf=1 で使う)
    // 置いたらすぐ描き始める。人格の文・見せ方の用意(VR の有無を調べる)・/api/status を待たない。
    // 待つと、初めて開いたブラウザで最初のコマが 0.6〜1 秒遅れた(重さの表 L3)。frame() は、まだ無い物(見せ方・入力)を飛ばす
    loopStartAt = performance.now();
    stage.renderer.setAnimationLoop(frame); // XR(Quest)の中でも回るよう、requestAnimationFrame でなくこちらを使う
    if (character.personaUrl) app.persona = await readPersona(character);
    status.textContent = app.urlNotices.join(' '); // 読まなかった ?character= ?place= の知らせ(無ければ空)
  } catch (err) {
    console.error(err);
    status.textContent = `キャラを読み込めませんでした: ${err.message}`;
    return;
  }
  await setupPresentation().catch((e) => console.warn('見せ方の切りかえを用意できませんでした:', e.message));
  await refreshStatus();
  setInterval(refreshStatus, 15000);
  setupPass();
  setupMemory();
  void setupLookSwitch(); // 3D と 2D の両方があるキャラだけ、上の段に切り替えを出す(待たない)
  if (app.status?.shop?.available) showShopChoices(); // 店のデータがあるときだけ、よくある質問のボタンを出す
  speaker.loadFillers().then((n) => console.info(`あいづちの声: ${n} 種類`));
  updatePrivacy();
  fillGate(); // 入口の文(声があるか・初めての訪問か・指かマウスか)は、状態を読んだ後に決める
  buttons.forEach((b) => (b.disabled = false));
  // ?perf=1: いまの重さを測る(L0。数字は window.__perf。測りの部品は、このときだけ読む)
  if (params.get('perf') === '1') import('./stage/perf.js').then(({ startPerf }) => startPerf({ stage, character: app.character, params, readyAt, tier: app.tier, firstFrameAt: () => app.firstFrameAt, loopStartAt }));

  /** 入力を選んで始める。失敗したら理由を出して、ゲートに戻る */
  async function startSource(kind, pending) {
    speaker.unlock(); // 音を出す許可は、最初のタップの中で取る
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = pending;
    try {
      // カメラの顔の部品は、押した時に読む(最初の読み込みに入れない)
      const MediapipeSource = kind === 'camera' ? (await import('./tracking/sources/mediapipeSource.js')).MediapipeSource : null;
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
      gateClosed(); // 上の段を出す・初めての訪問なら 7 歩を出す
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
    void talk({ text, mode: 'text' });
  });
  if (!listenProvider()) {
    $('micBtn').disabled = true;
    $('micBtn').title = 'このブラウザは声の聞き取りに対応していません';
  }
}

boot();
// 初めての会話(7 歩)と性格の画面(S4)。#modes に「性格」「はじめての会話」を出す。?onboard=1 で初めての会話を出す。案内役は主役ノリー。
// 初めての訪問なら、入口を閉じた後に main.js が出す(gateClosed)。印の名前は S4 の DONE_KEY を使う
firstRunReady = import('./ui/onboarding/index.js')
  .then((m) => {
    if (typeof m.DONE_KEY === 'string' && m.DONE_KEY) firstRunDoneKey = m.DONE_KEY;
    return m.mountFirstRun({ app, buttonHost: $('modes'), guide: MAIN_CHARACTER });
  })
  .catch((err) => {
    console.warn('初めての会話を用意できませんでした:', err.message);
    return null;
  });
