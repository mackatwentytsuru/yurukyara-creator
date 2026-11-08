// 会話の本体。キャラを出し、カメラで人を見つけて目と首で追い、話しかけられたら Claude に聞いて、声で答える。
import * as THREE from 'three';
import { createStage } from './scene.js';
import { loadFirstCharacter, loadCharacter, availableLooks, motionChoices, MAIN_CHARACTER } from './character/index.js';
import { writeRemembered, characterKey, lookKey, hasBothLooks } from './character/looks.js'; // 見た目(3D・2D)の切り替えの決まり・このタブで選んだ見た目を覚える
import { topLimit, topClearance, tvTopLimit } from './stage/framing.js'; // キャラを上の段の下に収める(すき間は画面の高さの 6%。テレビ表示では画面の上の端から)
// テレビ表示(11/7 本人「iPhone にあるものを AirPlay で、テレビにすぐパンって映せるようにしたい」): 入口の形・字幕の大きさ・画面ミラーリングの手順の決まり
import { tvPlan, tvCaptionPx, tvCaptionRows, tvBottomReserve, castSteps, castLead, castNote, TV_CLASS, TV_LABEL, CAST_LABEL, canRequestFullscreen, isInstalledApp, fullscreenGuide, TV_GUIDE_KEY, TV_GUIDE_AUTO_HIDE_MS } from './stage/tvMode.js';
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
import { InterimSender } from './conversation/interimSend.js'; // 11-08 LF2: ブラウザの聞き取りの確定が遅い時は、途中の文字を先に送る
import { Reconnector, probeServer } from './conversation/reconnect.js'; // 11-08 LF3: サーバーが短く止まったあと、リロードなしでつながり直して送り直す
import { StereoMic } from './tracking/audio/stereoMic.js';
import { MisheardTracker, SHOP_CHOICES, RETRY_LINE, CHOICES_LINE } from './conversation/misheard.js';
import { createUi, FALLBACK_BRAIN_NOTICE, mountQuestLink, latencyNote } from './ui/panel.js';
import { questLinkPlan } from './stage/questLink.js'; // 「VR(Quest)で開く」: この画面の QR に入れてよい物の決まり
import { getDemoPass, setDemoPass } from './conversation/demoPass.js'; // 合言葉(S3。会話と記憶の通信に見出し x-demo-pass で付く)
import { mountMemoryPanel } from './ui/memoryPanel.js'; // 記憶の札(S3。覚えていることの一覧・番号・わすれる)
// ML1: 多言語(ことば)・聞く言葉の選び・お店の端末(次のお客さんに、前の人の名前を出さない)
import { langModeOf } from './conversation/lang.js';
import { effectiveHearLang, getHearLang, setHearLang } from './conversation/hearLang.js';
import { mountHearLangSelect } from './ui/hearLangSelect.js';
import { setAiNotice } from './ui/aiNotice.js';
import { homeScreenLine, isMacDesktop } from './stage/tvHome.js';
import { SHOP_IDLE_CLEAR_MS, createIdleClear, createShopDevice } from './conversation/shopDevice.js';
import { clearKey, forgetAll, getKey, setKey, setMemoryCharacter } from './ui/memoryKey.js';
import { forgetStageId, readStageId, stageMemoryWanted, writeStageId } from './character/stageMemory.js'; // いま舞台にいる子を端末が覚える(読み込み直しても同じ子)
import { loadPlaceData, landmarkWorld, promptPlace, SAMPLE_PLACE } from './place.js';
import { createArPlacement } from './arPlacement.js';
import { createVrStage } from './vrStage.js';
import { createVrPanel } from './ui/vrPanel.js';
import { micUnavailableText, micFailureText } from './stage/micNotice.js'; // 声で話せなかった時の、やさしい日本語の知らせ
import { createAlignFlow } from './stage/alignFlow.js'; // 撮った部屋を現実に重ねる手順(場所の柱)
// 見せ方(画面・AR・VR)の切りかえは、場所の柱が出している入口(docs/共通の決まり.md)
import { createPresentation } from './stage/modes.js';
import { mountModeButtons, XR_WAIT_TEXT } from './stage/modeButtons.js';
import { detectTierInBrowser, applyTier } from './stage/tiers.js'; // 端末の段(軽いのにきれい)
import { installKeyboardInset } from './ui/keyboardInset.js'; // 画面のキーボードで入力窓が隠れない(11/7 本人の iPhone)
import { installNoPinchZoom } from './ui/noPinchZoom.js'; // 11-08 本人の iPhone: 指で拡大縮小したら固まった。画面は指では拡大縮小しない
import { installComposerInput } from './ui/composerInput.js'; // 11-08 本人の iPhone: 文字の入力窓が小さすぎる。大きく・3 行まで伸びる
import { reportVoice } from './conversation/clientEvents.js'; // 声を始められなかった原因だけの報告(手元のサーバーの記録へ)
// 接客モード(店の端末。決まりは stage/kioskMode.js、設計は KD.md): QR で入り、来場者にはキャラ・AI の表示・マイク・文字の欄・質問ボタンだけを見せ、名前は覚えず、放っておくと空に戻る
import { KIOSK_CLASS, clearKiosk, kioskCharacterId, normalizeKioskConfig, resolveKiosk, saveKiosk, withoutKioskParam } from './stage/kioskMode.js';
import { createHandsFree, listenerAlive, streamAlive } from './conversation/handsFree.js';
import { createWakeLock } from './stage/wakeLock.js';
import { mountKioskExit } from './ui/kioskExit.js';
import { mountKioskSetup } from './ui/kioskQr.js';

const params = new URLSearchParams(location.search);
const GAIN = Number(params.get('gain') ?? 2); // 視線の振れ幅の倍率
const HFOV = Number(params.get('hfov') ?? 65); // カメラの横の画角(度)
const APPROACH_DIST_M = 2.2; // この近さに来たら、声をかける
const APPROACH_HOLD_S = 1.2;
const GREET_COOLDOWN_S = 90;
const GREET_QUIET_S = 60; // 最後の会話からこれだけの間は、こちらから声をかけない(会話の途中で名乗り直さない)
// ヘッドセットのブラウザ。カメラは使えず、聞き取りはサーバーで行い、マイクの許可は VR に入る前に取る
const IS_HEADSET = params.get('headset') === '1' || /OculusBrowser|Quest/i.test(navigator.userAgent);
const VR_HELLO = 'こんにちは'; // コントローラーのトリガーで話しかける言葉(マイクが使えなくても、返事と声を確かめられる)
// ヘッドセットの 2D の画面で、はじめた後に出す案内(マイクの答えを待たずに出し、マイクが使えなかった時だけ文を替える)
const VR_GUIDE = '左上の「VR で見る」を押してください';
const VR_GUIDE_NO_MIC = 'マイクなしで進めます。左上の「VR で見る」を押してください';

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
// 接客モード: ?kiosk=<札> で入る。札は控え(この端末の localStorage)へ移し、URL から消す(読み込み直しても接客のまま。札が古い・壊れていても接客のまま)
const KIOSK = resolveKiosk({ search: location.search, storage: siteMemory });
if (KIOSK.on) {
  document.documentElement.classList.add(KIOSK_CLASS);
  if (KIOSK.fromUrl) {
    saveKiosk(siteMemory, KIOSK);
    try {
      history.replaceState(history.state, '', withoutKioskParam(location.href));
    } catch {
      // 書き換えられなくても、接客モードのまま
    }
  }
}
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
const firstRunWanted = () => !KIOSK.on && shouldOpenFirstRun({ params, storage: siteMemory, doneKey: firstRunDoneKey, headset: IS_HEADSET }); // 接客モードでは、作る・はじめての会話は出さない
const ui = createUi();
// CU: 起動中・返事待ちの表示(出し入れの決まりは ui/waitBubble.js。画面の文字と「…」は index.html の #waitBubble と入口の #gateWake)
import { createWaitBubble, wakeHint, wakeLine } from './ui/waitBubble.js';
import { beginWork, configureWork } from './ui/work.js'; // はたらいている間のきらきらと小さな印(描く・舞台に出す・3D を待つ・1.5 秒より長い待ち)
import { mountWorkFx } from './ui/workFx.js';
const waitBubble = createWaitBubble({
  langOf: () => effectiveHearLang(currentLangMode()), // 待つ間の一言は、選んだことばで出す(日本語だけの時は今までどおり)
  track: beginWork, // 待っている間(1.5 秒を過ぎたら)舞台にきらきらを出す。文は下の吹き出しが出す
  // 舞台に立っている子の名前(作った子や入れ替えた子でも、その子の名前で「かんがえているよ」と出す。CU3 must 2)
  nameOf: () => app.character?.name || document.documentElement.dataset.guideName || 'ノリー',
  render: (visible, text) => {
    const box = $('waitBubble');
    if (!box) return;
    $('waitBubbleText').textContent = text;
    box.hidden = !visible;
  },
});
let waitSeq = 0; // 話しかけた回の通し番号(止められた前の回が、次の回の「…」を消さないため)
// 返事の最初の文字(字幕・先に見える文・失敗の知らせ)が出たら、「…」を消す。使う人の言葉(kind: user)の字幕では消さない
for (const [name, isText] of [['caption', (text, _ms, kind) => Boolean(text) && kind !== 'user'], ['sayAhead', () => true], ['say', () => true], ['error', () => true]]) {
  const base = ui[name];
  if (typeof base !== 'function') continue;
  ui[name] = (...args) => {
    if (isText(...args)) waitBubble.end();
    return base.apply(ui, args);
  };
}
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
// ML1: お店の端末(端末ごとの設定。性格の画面の「この端末」が使う)。お店の端末にした時は、この端末の合鍵を捨てる
app.shopDevice = createShopDevice({
  memoryApi: { getKey, setKey, clearKey, forgetAll },
  onChange: () => {
    idleClear.touch();
    memory?.resync?.();
  },
});
if (KIOSK.on) {
  // 接客モードの間は、いつも「お店の端末」(お客さんの名前を覚えない)。端末の設定(localStorage)は書き換えない(抜けたら元のまま)
  app.shopDevice.isOn = () => true;
  // ことば・お店のきまりは、サーバーの設定(店の人が PC で決めた物)を使う。画面の性格の設定は、この間は使わない
  let ownSettings = null;
  Object.defineProperty(app, 'personaSettings', {
    configurable: true,
    get: () => ({ ...(ownSettings ?? {}), lang: KIOSK.cfg.lang, facts: KIOSK.cfg.facts }),
    set: (v) => {
      ownSettings = v;
    },
  });
}
/** いまのことば(日本語だけ・多言語)。画面の設定 > 性格の画面の節 > persona.md の行 > 日本語だけ */
const currentLangMode = () => langModeOf({ settings: app.personaSettings, persona: app.persona });
// はたらいている間のきらきらと小さな印(ui/work.js・ui/workFx.js)。文は、いまのことばと舞台の子の名前に合わせる
configureWork({ lang: () => effectiveHearLang(currentLangMode()), name: () => app.character?.name || document.documentElement.dataset.guideName || '' });
mountWorkFx({ stage: $('stage') });
window.__app = app; // 試験と開発の確認用
if (IS_HEADSET) document.documentElement.classList.add('is-headset');
if (params.get('led') === '1') document.documentElement.classList.add('is-led'); // 入口の LED: 顔にかぶる窓と操作の帯を隠す
// テレビ表示の入口の形(iPhone・iPad は「テレビに映す」、ほかは「テレビ表示」。ヘッドセット・LED などでは出さない)。
// ?tv=1 なら、最初の置き方からテレビ表示(入口は出す。全画面は入口のボタンを押した時に頼む)
const TV = tvPlan({ params, nav: navigator, headset: IS_HEADSET });
if (TV.start) document.documentElement.classList.add(TV_CLASS);
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
let madeKids = null; // 「かえる」の中の「つくった子」(ui/madeKids.js の返り値。来場者の上の段の時だけ)
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
  idleClear.touch(); // ML1: お店の端末の、だれも操作しない時間の数え直し
  if (!turn?.retry) reconnector.supersede(); // 新しい言葉が先。止まっていた前の言葉は、つながり直しても送り直さない
  // どの入口の会話でも「声かけ済み」にする(本人が話した後に、すぐ名乗り直さない。V1-3)
  const t = performance.now() / 1000;
  presence.greetedAt = t;
  presence.lastTalkAt = t;
  // 声かけの回(trigger: 'approach')は、人が話した回ではないので、前の返事・「あなた:」の行が残って後ろにつながる(Q3 ②)。話し始めの前に空にする
  if (turn?.trigger === 'approach') ui.userSaid('');
  // CU: 返事の最初の文字が出るまで(0.4 秒たっても出ない時)「…」を出す。無視されているように見せない
  const waitId = ++waitSeq;
  waitBubble.begin({ immediate: turn?.trigger === 'approach' });
  return dialogue.send(turn).then(updateBrainNotice).finally(() => {
    if (waitId === waitSeq) waitBubble.end(); // 止められた前の回の終わりで、次の回の「…」を消さない
  });
}

/** 場所の情報を会話に渡すか。?place= が無い(試しの場所)・VR の中では渡さない(試しの目印が「スタッフの部屋」などを案内してしまうため) */
function placeForPrompt() {
  const real = app.place && app.place.id !== SAMPLE_PLACE.id;
  const inVr = modes?.mode === 'vr' || stage.renderer.xr.isPresenting;
  if (!real || inVr) return undefined;
  return promptPlace(app.place, { character: app.character, arUnaligned: app.arUnaligned });
}

/* ---------- 会話 ---------- */
const dialogue = new Dialogue({
  character: null, // 読み込み後に入れる
  speaker,
  ui,
  setGaze,
  motionChoices,
  onEvent: onChatEvent, // サーバーのイベントが全部届く(記憶の札・仮の頭脳の知らせ)
  // 通信が切れて返事が 1 つも来なかった回: つながり直したら送り直す(LF3)。送り直した回(info.retry)がまた失敗した時は、もう送り直さない(知らせだけ。同じ言葉を送り続けない)
  onOffline: (info) => reconnector.begin(info.retry ? null : info),
  // 返事の前に止められた回(言い直し・割り込み): 記録だけ残す(画面の「返事が始まるまで」の表示と、ふだんの数え方には混ぜない。LF4)
  onInterrupted: (entry) => {
    fetch('/api/metrics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry) }).catch(() => {});
  },
  interview: params.get('interview') === '1', // 入口のインタビューの型(返事 2 文まで)
  getContext: () => ({
    scene: sceneText(),
    character: { name: app.character.name, persona: app.persona },
    // ML1: ことば・聞く言葉・お店のきまり(画面の欄)・お店の端末。日本語だけ・欄が空・ふつうの端末なら、本文には何も足されない(mlBody.js)
    lang: currentLangMode(),
    hearLang: effectiveHearLang(currentLangMode()),
    facts: app.personaSettings?.facts ?? '',
    shopDevice: app.shopDevice.isOn(),
    // ?place= が無い時(試しの場所)と VR の中では、目印も案内文も送らない(「スタッフさんに聞いてみて」の元。V1)
    place: placeForPrompt(),
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
    // 分かる言葉で(CRITux 18): 「返事まで 281ms(参考: 頭脳か声が仮)・目標 1200ms」は読めなかった。
    // 「仮の頭脳」と付けるのは、仮の頭脳で話した回だけ(本物の頭脳が声なしで答えた回にも出ていた。11/7 の本物の Haiku の録画)
    const sec = (ms) => `${(ms / 1000).toFixed(1)} 秒`;
    ui.foot(
      `返事が始まるまで ${sec(entry.totalMs)}${latencyNote(entry, { fakeBrain: currentBrain() === 'mock' })}` +
        `${med !== null ? ` ・ ふだん ${sec(med)}(${valid.length} 回の真ん中)` : ''}` +
        ` ・ 目安は 1.2 秒以内`,
    );
  },
});

app.dialogue = dialogue;

// 11-08 LF3: サーバーが短く止まって「いま つながらないよ」が出たら、画面が自分で調べ続け、つながったら止まった言葉を 1 回だけ送り直す。
// 聞き取り(listener)には触らない = 聞き続ける。聞き取りが通信の切れで止まっていて、使う人が聞かせたい状態のままなら、つながった時に入れ直す
const reconnector = new Reconnector({
  probe: () => probeServer(),
  prepare: () => refreshStatus(), // 声・聞き取りの有無の記録を読み直す(切れている間に null になっている)。終わってから送り直す
  onBack: ({ pending, fresh }) => {
    if (micWanted && !listener) void toggleMic();
    if (pending && fresh && !dialogue.busy) {
      ui.notice('つながったよ。さっきの言葉を もう一度 送るね');
      void talk({ text: pending.text, mode: 'text', retry: true });
      return;
    }
    ui.clearError?.();
    ui.notice('つながったよ');
  },
});
window.addEventListener('online', () => reconnector.nudge());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reconnector.nudge();
});

// ML1: お店の端末で 3 分だれも操作しないと、会話の履歴・字幕・「覚えていること」の窓を空にする(次の人に、前の話を見せない)。ふつうの端末では動かない
const idleClear = createIdleClear({
  isOn: () => app.shopDevice.isOn(),
  ms: () => (KIOSK.on ? KIOSK.cfg.idleMs : SHOP_IDLE_CLEAR_MS), // 接客モードは、店の人が決めた「放っておく時間」(既定 90 秒)
  onClear: () => {
    dialogue.cancel();
    dialogue.history = [];
    dialogue.carry = null;
    ui.clearTalk();
    $('caption').textContent = ''; // 字幕の文字も空にする(隠れているだけで残さない)
    memory?.resync?.();
  },
});
for (const type of ['pointerdown', 'keydown', 'input', 'touchstart']) window.addEventListener(type, () => idleClear.touch(), { passive: true, capture: true });

let lastSceneText = '';
function sceneText() {
  const a = app.lastAttention;
  return describeScene(a.tracks, { primaryId: a.primaryId, speakerId: a.speakerId });
}

/** 声の原因の報告は、手元のサーバーがあるとき(/api/status が答えた)だけ送る。公開の URL では 404 を出さない */
function reportVoiceLocal(fields) {
  if (!app.status) return;
  void reportVoice(fields);
}

let composerInput = null; // 文字の入力窓(ui/composerInput.js)。送った後に 1 行へ戻す

/* ---------- 声 ---------- */
let listener = null;
let micWanted = false; // 使う人がマイクを入れたままにしたい状態(自分で止めたら false。通信の切れで勝手に止まった時は true のまま)
// ML1: マイクの横の「聞く言葉」の選び(多言語の時だけ出す)。選びを替えたら、聞き取りを始め直し、日本語以外の間は日本語のあいづちを出さない
const hearUi = mountHearLangSelect({
  box: $('hearLangBox'),
  select: $('hearLang'),
  getMode: currentLangMode,
  getLang: getHearLang,
  setLang: (lang) => {
    setHearLang(lang);
    applyHearLang();
  },
});
/** 「AI キャラクターの〈名前〉と話しています」を、舞台の子の名前と、いまのことばに合わせる(いつも見せる決まり。子が読み込まれた時・替わった時・ことばが替わった時) */
function updateAiNotice() {
  setAiNotice({ name: app.character?.name, lang: effectiveHearLang(currentLangMode()) });
}
function applyHearLang() {
  updateAiNotice();
  if (document.documentElement.classList.contains('gate-up')) setGateWake(wakeState); // 入口の一言も、選んだことばに替える
  speaker.setHearLang(effectiveHearLang(currentLangMode()));
  listener?.setLang();
  hearUi.refresh();
}
app.onPersonaChange = applyHearLang;
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
// 声が止まって 0.7 秒たっても確定が来ない時は、いちばん新しい途中の文字を、その言葉として送る(あとから同じ言葉の確定が来ても、2 回送らない)
const interimSender = new InterimSender({
  enabled: params.get('interimsend') !== 'off', // ?interimsend=off: 先送りを切る(前後の速さを比べる時だけ)
  send: (text, info) => {
    if (!listener?.listening) return false; // 送らなかった(マイクが止まっている): 部品に「送った」と覚えさせない
    lastTextAt = performance.now();
    misheard.heard();
    void talk({ text, t0: info.lastVoicedAt || performance.now(), mode: 'voice', via: 'interim' });
    return true;
  },
});

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
  // 接客モード: この PC の聞き取りを先に使う(声の区間だけを送る。ブラウザの聞き取りは、1 分ほどや無言で自分で終わり、始め直すたびに音が鳴る)
  if (IS_HEADSET || KIOSK.on || params.get('stt') === 'server') return serverOk ? 'server' : webSpeechSupported() && KIOSK.on ? 'web' : null;
  if (webSpeechSupported()) return 'web';
  return serverOk ? 'server' : null;
}
async function toggleMic() {
  const btn = $('micBtn');
  // QA8 ③: 許可の窓が開いている間(聞き始めの最中)の 2 回目のタップも「止める」。止めないと、答えが来た時に 2 本目が開いて、1 本目が開いたまま残る
  if (listener?.listening || listener?.starting) {
    micWanted = false;
    listener.stop();
    listener = null;
    interimSender.reset(); // 止めた時に、待ちと「送った」の覚えを捨てる(止めた後の同じ言葉の確定が、捨てられないように)
    stereoMic?.stop();
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('hearing');
    updatePrivacy();
    return;
  }
  const unavailable = micUnavailableText({ secure: window.isSecureContext, mediaDevices: navigator.mediaDevices });
  if (unavailable) {
    ui.notice(unavailable); // 押しても何も起きないように見えないよう、字幕の上に出す(P1 高)
    return;
  }
  let mine = null; // この押しで作った聞き取り(あとで別の押しが作った物と取り違えない)
  try {
    speaker.unlock();
    const provider = listenProvider();
    if (!provider) throw new Error('聞き取りを使えません(サーバーに faster-whisper が入っていないか、このブラウザが対応していません)');
    mine = new Listener({
      onInterim: (t) => {
        lastInterimAt = performance.now();
        lastTextAt = lastInterimAt;
        interimSender.interim(t);
        ui.caption(t, 0, 'user');
      },
      onFinal: (text, info) => {
        lastTextAt = performance.now();
        misheard.heard();
        const verdict = interimSender.final(text);
        if (verdict === 'drop') return; // 途中の文字で、もう送った言葉(2 回送らない)
        const t0 = info.lastVoicedAt || performance.now();
        void talk({ text, t0, mode: 'voice', ...(verdict === 'replace' ? { via: 'replace' } : {}) });
      },
      onVoice: (active) => {
        $('micBtn').classList.toggle('hearing', active);
        if (active) idleClear.touch(); // 接客モード・お店の端末: 話しかけている間は、放っておいたことにしない
        interimSender.voice(active, listener?.lastVoicedAt ?? 0);
        // 話している最中に声が出たら、止まって聞く
        if (active && speaker.speaking) dialogue.cancel();
        // 声が止まった(話し終わりらしい)ら、確定した文字を待たずに、あいづちの声を先に出す
        if (!active && performance.now() - lastInterimAt < 2500) dialogue.preFiller(mine.lastVoicedAt);
        // 声は出たのに、しばらく待っても文字が 1 つも来ない: 聞き取れなかった(自分が話している間や返事の準備中は数えない)
        if (!active && !speaker.speaking && !dialogue.busy) {
          const endedAt = performance.now();
          setTimeout(() => {
            if (lastTextAt < endedAt && !speaker.speaking && !dialogue.busy && listener?.listening && !listener.transcribing) onMisheard();
          }, 2600);
        }
      },
      // 11-08 本人の iPhone: ブラウザの聞き取りが使えない時の自動の切りかえ・カメラを入れたままのマイクの取り直し・原因だけの報告
      onNotice: (text) => ui.notice(text),
      onProvider: () => updatePrivacy(),
      // 前に戻った・マイクを取り直した後: 声を出す側の AudioContext も止まっていたら動かす(iPhone は戻ると止まっていることがある)
      onRevived: () => {
        const c = speaker.ctx;
        if (c && c.state !== 'running' && c.state !== 'closed') c.resume?.()?.catch?.(() => {});
      },
      onStopped: () => {
        if (listener === mine) {
          listener = null;
          interimSender.reset(); // 聞き取りが自分で止まった時も、待ちと覚えを捨てる
        }
        stereoMic?.stop();
        btn.setAttribute('aria-pressed', 'false');
        btn.classList.remove('hearing');
        updatePrivacy();
      },
      cameraOn: () => app.mode === 'camera',
      holdCamera: () => app.camera?.hold?.(),
      report: (event) => reportVoiceLocal({ ...event, cameraOn: app.mode === 'camera' }),
      onError: (msg) => ui.error(msg),
      onEmpty: () => {
        if (!speaker.speaking && !dialogue.busy) onMisheard();
      },
    }, { provider, isBusy: () => speaker.speaking && params.get('bargein') !== '1', lang: () => effectiveHearLang(currentLangMode()) });
    listener = mine;
    await mine.start();
    // 始めている最中に止められた(2 回目のタップ)・始めた後に自分で止まった: 続きはしない
    if (listener !== mine || !mine.listening) return;
    micWanted = true;
    // 声の向き。ステレオが取れなくても、聞き取りと映像はそのまま動く(ヘッドセットの中では、頭の位置が分かるので使わない)
    // 触る端末(スマホ)では始めない: iPhone は 2 本目のマイクの取得で 1 本目が止まることがあり、内蔵マイクは向きも出せない(11-08 見直し)
    if (!IS_HEADSET && !TOUCH) void startStereoMic();
    btn.setAttribute('aria-pressed', 'true');
    updatePrivacy();
  } catch (err) {
    // 原因だけの報告(名前・短い message・どの段か・提供元・カメラの入・https・ブラウザの分類。音も文字も入れない)
    reportVoiceLocal({ error: err, stage: err?.stage, provider: mine?.provider ?? 'web', cameraOn: app.mode === 'camera' });
    if (mine && listener === mine) listener = null;
    // 英語の err.message は出さない。字幕の上の知らせに、やさしい日本語で(P1 高)。VR の板にも同じ文
    const text = micFailureText(err);
    ui.notice(text);
    app.vrPanel?.set({ error: text });
  }
}

/* ---------- 接客モード: ハンズフリー(店の人が 1 回押したら、あとは来場者が話しかけるだけ)・画面を消さない・抜ける ---------- */
/** 聞き取りを(止まっていたら)始める。聞いている最中・マイクの線が切れていない時は何もしない。押しても止めない */
async function startMicIfIdle() {
  if (listener?.listening && streamAlive(listener.stream)) return;
  if (listener) {
    // 聞いているつもりで、マイクの線が切れていた: 古い聞き取りを片づけて、始め直す
    try {
      listener.stop();
    } catch {
      // すでに止まっている
    }
    listener = null;
    interimSender.reset(); // onStopped を通らない止め方なので、ここでも待ちと「送った」の覚えを捨てる(LF3)
    stereoMic?.stop();
  }
  await toggleMic();
}
const handsFree = createHandsFree({
  alive: () => listenerAlive(listener),
  start: startMicIfIdle,
  isBusy: () => speaker.speaking || dialogue.busy,
  isHidden: () => document.visibilityState !== 'visible',
});
const wakeLock = createWakeLock();
app.kiosk = { on: KIOSK.on, handsFree, wakeLock, get config() { return KIOSK.cfg; } };
if (KIOSK.on) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handsFree.nudge(); // 戻ったら、待たずに始め直す(画面を消す・裏に回ると、マイクが切れる)
  });
  // 角の長押し + 番号で出る。サーバーが番号を確かめた後だけ。出たら、聞くのも画面を消さないのもやめて、ふつうの画面へ読み直す
  mountKioskExit({
    getToken: () => KIOSK.token, // 端末ごとに、サーバーが間違いを数える
    onExit: () => {
      handsFree.disable();
      try {
        listener?.stop();
      } catch {
        // すでに止まっている
      }
      void wakeLock.stop();
      clearKiosk(siteMemory);
      location.replace(withoutKioskParam(location.href));
    },
  });
}

/** 接客モードの設定(ことば・お店のきまり・放っておく時間)をサーバーから取る。合わない札・つながらない時は、控えのまま。返事は 3 秒だけ待つ */
async function loadKioskConfig() {
  if (!KIOSK.on || !KIOSK.token) return;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    const res = await fetch('/api/kiosk/config', { cache: 'no-store', headers: { 'x-kiosk-token': KIOSK.token }, signal: ac.signal }).finally(() => clearTimeout(timer));
    const data = res.ok && /json/i.test(res.headers.get('content-type') ?? '') ? await res.json() : null;
    if (!data?.valid) return; // 古い・壊れた札: 控えのまま(設定が無ければ既定)。接客モードは続ける
    KIOSK.cfg = normalizeKioskConfig(data);
    saveKiosk(siteMemory, KIOSK);
    if (app.character) applyHearLang(); // ことばが替わったら、聞く言葉・AI の表示も合わせる
  } catch {
    // つながらない: 控えのまま
  }
}

function updatePrivacy() {
  const texts = {
    // BCV: 使う人がカメラを選んだ時は、話しかけた回に絵を 1 枚 Claude へ送る(保存しない)。自動で始める画面は今までどおり追従だけ
    camera: app.camera?.seeing?.() ? app.camera.privacy : 'カメラの映像は、この端末の中で人の位置を調べるだけに使います。保存も、送信もしません。',
    pose: 'カメラの映像は使っていません。この端末の位置だけで、あなたのいる方向を知っています。',
    sim: TOUCH ? 'カメラは使っていません(画面を指でなぞった向きに、人がいることにしています)。' : 'カメラは使っていません(マウスの向きに、人がいることにしています)。',
    bridge: '床のカメラの機械が、あなたのいる向き(数字)だけをこの画面に送ります。映像は保存も、送信もしません。',
  };
  // 始める前(app.mode が無い)は、ヘッドセットなら位置の文(実機の Quest で、入口の前に「マウスの向きに」と出ていた)
  let text = texts[app.mode] ?? (IS_HEADSET ? texts.pose : texts.sim);
  if (listener?.listening) text += listener.provider === 'server' ? ' 声は、この画面を配っている PC へ送って文字にします。音は保存しません。' : ' 声の聞き取りには、ブラウザの聞き取りのサービスに音が送られます。';
  if (stereoMic?.status === 'stereo') text += ' 声のする向きは、この端末の中で左右の音の差を調べるだけです(音は保存も、この仕組みからの送信もしません)。';
  ui.privacy(text, app.mode !== 'camera');
  // テレビ表示はカメラを使わない時の注意書きを隠すが、マイクで聞いている間は残す(style.css の .privacy.off:not(.listening))。
  // 印は .mic でなく .listening(QA8 #2: .mic を付けると、スマホの幅の「.mic span { display: none }」が注意書きの文字まで消し、声の送り先が読めなかった)
  $('privacy')?.classList.toggle('listening', Boolean(listener?.listening));
  app.camera?.sync?.(); // BCV: カメラの入・切のボタンの見た目を、今の入力に合わせる
}

/* ---------- 画面の状態 ---------- */
async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    app.status = res.ok ? await res.json() : null; // 公開の URL には /api/status が無い(null のまま)
  } catch {
    app.status = null;
  }
  // 声のサーバーが無い所(公開の URL・声の鍵の無いサーバー)では /api/tts を聞かない(console に 404 を出さない。S3 の頼み・CRITux 25)
  speaker.setServerVoice(Boolean(app.status?.tts?.available));
}

function updateChips() {
  const s = app.status;
  const chips = [];
  const brain = currentBrain();
  // UW5(UIR 12): 仮の頭脳の知らせは字幕の上の 1 か所だけ(札には出さない)
  if (brain !== 'mock') chips.push(['頭脳', brain === 'haiku' ? 'Claude Haiku' : '—', brain === 'haiku' ? 'ok' : 'warn']);
  const ttsOk = s?.tts?.available && !speaker.ttsError;
  chips.push(['声', ttsOk ? `あり(今日の残り ${s.tts.remainingToday} 字)` : '字幕のみ', ttsOk ? 'ok' : 'warn']);
  // 分かる言葉で(CRITux 18): カメラの道は「GPU 60fps」でなく「オン」、カメラなしは「マウスで試し中」でなく「なし」。位置・床のカメラはその入力の言葉
  const info = app.source?.info() ?? { label: 'なし', ok: false };
  const noCamera = app.mode === 'sim' || !app.source;
  const camera = app.mode === 'camera' ? (info.ok ? 'オン' : '準備中') : noCamera ? 'なし' : info.label;
  // BCV: 絵を送るカメラが入っている間は、いちばん前に赤い点の札(小さな印。高さ 500 未満でもこの札だけ残す = style.css)
  if (app.camera?.seeing?.()) chips.unshift(['', 'カメラ オン', 'cam-rec']);
  else chips.push([app.mode === 'pose' ? '位置' : 'カメラ', camera, noCamera ? '' : info.ok ? 'ok' : 'warn']);
  // UW5(UIR 23): 「見えている人 0 人」は意味が分からないので、カメラを使っている時だけ
  if (app.mode === 'camera') chips.push(['見えている人', `${app.lastAttention.tracks.length} 人`, '']);
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
  ui.chips(chips); // UW5(UIR 23): 「あいづち 5 種類」は意味が分からないので出さない
  uw5VoiceRest(ttsOk, s);
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
let presence = { since: 0, greetedAt: -1e9, lastSeen: 0, lastTalkAt: -1e9 };
let vrGreetPending = false; // VR に入った時だけ 1 回、声をかける(入り直したらまた 1 回)
let wasInVr = false;
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
    // VR では、見ている人がいつも 2.2 m 以内にいる。入った時の 1 回だけにする(90 秒ごとの名乗り直しの元。V1-3)
    const inVr = stage.renderer.xr.isPresenting && modes?.mode === 'vr';
    if (inVr !== wasInVr) {
      wasInVr = inVr;
      vrGreetPending = inVr;
    }
    const nowClock = performance.now() / 1000; // talk() が書く時計(XR でも同じ基準)
    if (
      app.autoGreet &&
      dist < APPROACH_DIST_M &&
      nowS - presence.since > APPROACH_HOLD_S &&
      nowClock - presence.greetedAt > GREET_COOLDOWN_S &&
      nowClock - presence.lastTalkAt > GREET_QUIET_S &&
      (!inVr || vrGreetPending) &&
      !dialogue.busy &&
      !speaker.speaking &&
      !listener?.voiceActive &&
      !listener?.transcribing
    ) {
      vrGreetPending = false;
      void talk({ trigger: 'approach', mode: 'text' });
    }
  } else if (nowS - presence.lastSeen > 3) {
    presence.since = 0; // いなくなって 3 秒たったら、次に来た人は新しい人
  }

  // 5. 口・描画
  c.setMouth(speaker.level());
  // ── B5G かわいい仕草の層(character/cuteLayer.js): いまの状態を渡す(話す > 聞く > 考える > 待つ)。文字を打っている間も「聞く」 ──
  const typing = document.activeElement?.id === 'textInput' && Boolean(document.activeElement.value.trim());
  c.setActivity?.(speaker.speaking ? 'talking' : listener?.voiceActive || listener?.transcribing || typing ? 'listening' : dialogue.busy ? 'thinking' : 'idle');
  // ── B5G ここまで ──
  c.update(dt);
  if (vrPanel?.mesh.visible) {
    vrPanel.set({ state: vrState() });
    vrPanel.place(c.object3d, stage.state.height, stage.camera);
  }
  syncStage(); // canvas の箱が変わっていたら(窓の resize が来ない変化も)、描く前に大きさと画角を合わせ、キャラを置き直す
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
    vrPanel.set({ state: vrState(), user: '', reply: '', error: '' }); // 入り直した時に、前の回の中身を残さない
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
  // マイクが聞いている間は、トリガーで勝手に「こんにちは」を送らない(本人の声だけが会話になる。V1-10)。
  // マイクが使えない時だけ、トリガーで「こんにちは」を送る(板に「トリガー = こんにちは」と出してある)
  if (listener?.listening) return;
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
  // VR・AR を頼んだら、入るか断られるまで、画面の真ん中に「ブラウザの下の『許可する』を押してください」(実機の Quest は、
  // ブラウザの下の帯に答えるまで何も起きなかった)。頼んでいる間は、どのボタンも押せない(2 回目の頼みで InvalidStateError になった)
  mountModeButtons({
    modes,
    container: $('modes'),
    onError: (e) => ui.error(e.message),
    onWait: (mode) => {
      if (mode) ui.align(null); // 「VR で見る」の案内は、頼んだら消す(真ん中の知らせだけにする)
      ui.xrWait(mode ? XR_WAIT_TEXT : null);
    },
  });
  // iPhone の殻の中なら、すぐ AR に入る(殻は、入ったあとに姿勢を送り始める)
  if (modes.available.ar_kind === 'native') await modes.enter('ar').catch((e) => ui.error(e.message));
  app.modes = modes;
}

/* ---------- キャラの見せ方(上の段と下の帯の間に収める) ---------- */
// 上の段: 上の札・見せ方のボタン・覚えていること・見た目の切り替え・「Claude の考え」の見出し。
// 「Claude の考え」を開いている間は、窓の全体も数える(CRITux 21: スマホで開くと顔に重なった。キャラを窓の下へ置き直す)。
// 「VR(Quest)で開く」の QR の箱も、開いている間は数える(キャラを箱の下へ。箱の下の端は style.css が画面の 45% より上で止める)
// 11/7 本人「頭が切れちゃってる」: PC では上の段がキャラの横に重ならず、耳が画面の上の端まで出ていた。
// 上の段(札・ボタン・見た目の切り替え)は横の位置にかかわらず数え、下の端から画面の高さの 6% 下にキャラのいちばん上を置く(framing.js の topLimit)
// 「テレビ」の入口(#tvBtn)は、幅 640 までは上の段の下の行(畳んだ見出しと同じ行)に置くので、横に重なる時だけ数える側へ
// (見た目の切り替えが無い子で、その行を横いっぱいに数えてキャラを下げないように)
const TOP_BAR = '.top .chip, .top .top-row > *:not(#tvBtn)'; // 上の段(横いっぱいに数える)
const TOP_SIDE = '#thoughtToggle, #tvBtn'; // スマホで上の段の下に並ぶ畳んだ見出しと「テレビ」(キャラの横に重なる時だけ。同じすき間)
const TOP_PANELS = '#thought:not(.collapsed), #questLinkBox:not([hidden])'; // 開いた窓(重なる時だけ)
const TOP_PANELS_UW5 = '#memoryDrawer[open] > .drawer-body'; // UW5(UIR 20): 「覚えていること」の中身も数える(開くとキャラを覆っていた)
const TOP_MAIN = '.top .top-main:not([hidden]) > *, .top .grown-up'; // UW5: 上の段の 3 つのボタン(と「おうちの人へ」の見出し)も横いっぱいに数える
const TOP_GAP_PX = 14; // 幅 320 で耳が上の段に 6px かかった(P1 低)ので 8 → 14。開いた窓とキャラの頭のすき間(上の段は topClearance = 画面の高さの 6%)
/** 舞台(#stage)の上端(px)。キーボードで舞台を見える範囲に縮めた時(上端がずれる時)だけ 0 でない。上の段などの線は、ここからの距離にする */
function stageTopPx() {
  if (!document.documentElement.classList.contains('kb-open')) return 0;
  return Math.max(0, document.getElementById('stage')?.getBoundingClientRect().top || 0);
}
const rectsOf = (sel) => {
  const dy = stageTopPx();
  return [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect();
    return dy ? { left: r.left, right: r.right, top: r.top - dy, bottom: r.bottom - dy, width: r.width, height: r.height } : r;
  });
};

/** キャラの頭を置いてよいいちばん上の線(px)。[left, right] はキャラの横の範囲。scene.js の frameCharacter が、頭と耳を段の下に収めるのに使う */
function topGuard(left, right) {
  // テレビ表示: 上の段は隠すので、画面の上の端から画面の高さの 6%(隅の「もどる」・縦持ちの一言がキャラの横に重なる時だけ、その下から)
  if (tvActive()) return tvTopLimit({ corner: rectsOf('#tvExit, #tvRotate, #tvCam:not([hidden])'), left, right, clear: topClearance(window.innerHeight, TOP_GAP_PX) }); // #tvCam: BCV
  return topLimit({
    bar: [...rectsOf(TOP_BAR), ...rectsOf(TOP_MAIN)],
    side: rectsOf(TOP_SIDE),
    panels: [...rectsOf(TOP_PANELS), ...rectsOf(TOP_PANELS_UW5)],
    left,
    right,
    clear: topClearance(window.innerHeight, TOP_GAP_PX),
    panelGap: TOP_GAP_PX,
  });
}
stage.state.topGuard = topGuard;

/** 今の見せ方で、キャラを置き直す(画面の大きさ・上の段・下の帯が変わった時)。AR・VR の間は端末が決めるので何もしない */
function reframe() {
  if (app.character && !stage.state.immersive) stage.frameCharacter(app.character, undefined, app.place?.loaded?.object3d);
}

/**
 * canvas の箱と、描く大きさ・画角の縦横がずれていたら合わせ、下の余白(画面の高さで決まる)を取り直してキャラを置き直す。
 * 毎フレーム(frame)と、箱が変わりうる時(canvas の ResizeObserver・回転・ページの復帰・見える範囲の変化)に呼ぶ。ずれていなければ何もしない。
 * 11/7 本人の iPhone の Chrome: 窓の resize が来ないまま箱が変わり、古い大きさの絵が縦長の箱へ引き伸ばされて、ノリーが約 3.8 倍細長く写った
 */
function syncStage() {
  if (stage.syncSize()) fitBottom();
}

/**
 * 下の帯(よくある質問のボタン・入力欄)の高さが変わったら、全身の見せ方を取り直す(足が帯に隠れないように)。
 * テレビ表示では帯を隠すので、字幕の 2 行分(字の大きさは画面の高さの 6%)と、下の端に残る物(カメラの注意書き)の高さを空ける
 */
/** スマホで「はじめての会話」の札(下から出る札 .fr-sheet)が開いている時の、札が覆う高さ(px)。見本の子を札の上に全身で出すために数える(P1 高。S4 と組)。出ていない・横に出る札(幅 720 以上)は 0 */
function cardInset() {
  const sheet = document.querySelector('.fr-sheet');
  if (!sheet || !document.documentElement.classList.contains('fr-open')) return 0;
  const r = sheet.getBoundingClientRect();
  if (!(r.height > 0) || r.width < window.innerWidth - 2) return 0;
  return Math.max(0, Math.round(window.innerHeight - r.top) + 8);
}
let observedSheet = null;
const sheetObserver = new ResizeObserver(() => fitBottom());
/** 札が出た・消えた・差し替わった時に、大きさを見る相手を付け替える */
function watchSheet() {
  const sheet = document.querySelector('.fr-sheet');
  if (sheet === observedSheet) return;
  if (observedSheet) sheetObserver.unobserve(observedSheet);
  observedSheet = sheet;
  if (sheet) sheetObserver.observe(sheet);
  fitBottom();
}
new MutationObserver(watchSheet).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

/**
 * 画面のキーボードが奪っている高さ(px。keyboardInset.js が html に入れた --kbh。出ていなければ 0)。
 * B13L: iOS がページごと上へずらした時(--kb が 0)も、キーボードは出ているので 0 より大きい。舞台(#stage)は style.css の layoutB13.css が
 * 見える範囲の高さに縮めるので、この値は「キーボードの時の見せ方にする」印で、字幕と下の帯の高さには足さない
 */
function keyboardPx() {
  if (!document.documentElement.classList.contains('kb-open')) return 0;
  return Math.max(1, parseFloat(document.documentElement.style.getPropertyValue('--kbh')) || 0);
}

/**
 * 字幕の箱(.subs)の高さの、今の返事の間の最大(px)。長い返事の字幕がキャラの体にかからないよう、下の余白を字幕の高さに合わせて取る(QA 低 13)。
 * 字幕が空になったら(次の会話の前)0 に戻す
 */
let subsPeak = 0;
let subsMode = '';
function subsHeight() {
  const el = document.querySelector('.subs');
  const h = el ? Math.ceil(el.getBoundingClientRect().height) : 0;
  const text = el ? [...el.querySelectorAll('.caption')].some((c) => c.textContent.trim()) : false;
  const mode = `${tvActive()}|${keyboardPx() > 0}`; // テレビ表示・キーボードの出入りで字幕の大きさが変わるので、前の最大は持ち越さない
  if (mode !== subsMode) {
    subsMode = mode;
    subsPeak = 0;
  }
  subsPeak = text ? Math.max(subsPeak, h) : 0;
  return subsPeak;
}

function fitBottom() {
  const bottomBar = document.querySelector('.bottom');
  if (!bottomBar) return;
  const h = bottomBar.offsetHeight;
  document.documentElement.style.setProperty('--bottom-h', `${h}px`);
  // UW5: 下から出る札の上に字幕を置く・横に出る札の時は字幕を札の左へ(style.css。class でなく data にするのは、class を見張る所を起こさないため)
  const inset = cardInset();
  document.documentElement.style.setProperty('--card-inset', `${inset}px`);
  document.documentElement.dataset.card = inset > 0 ? 'bottom' : '';
  if (tvActive()) {
    document.documentElement.style.setProperty('--tv-cap', `${tvCaptionPx(window.innerHeight, window.innerWidth)}px`);
    document.documentElement.style.setProperty('--tv-rows', String(tvCaptionRows(window.innerHeight, window.innerWidth)));
    stage.state.kbInset = 0;
    // 字幕の箱の実際の高さ(知らせの帯を含む)も数え、字幕が足にかからないようにする(縦長の画面)
    stage.state.bottomInset = Math.max(h + tvBottomReserve(window.innerHeight, window.innerWidth), h + subsHeight() + 10);
  } else {
    // 帯の上に出る字幕と札の分(足に重ならないように)。字幕は 2 行 + 知らせで画面の高さの 14〜16% ほど(L1: 80px 固定では、字幕がキャラの足元・体に 12 場面でかかった)
    // UW5: せまい画面で上の段の「かえる」「もっと」を開いている間は、字幕をしまう(style.css)ので、その分を空けない(キャラが段と字幕にはさまれて隠れない)
    const menuOpen = /\btop-(more|change)\b/.test(document.documentElement.className) && window.innerWidth <= 900;
    const estimate = menuOpen ? h + 8 : h + 8 + Math.round(Math.min(140, Math.max(96, window.innerHeight * 0.16)) + (window.innerHeight < 720 ? 14 : 0));
    const kb = keyboardPx();
    stage.state.kbInset = kb;
    if (kb > 0) {
      // 画面のキーボードが出ている間: 舞台(#stage)は見える範囲の高さに縮み、その下端(= キーボードの上)に入力欄と字幕 1 行が並ぶ。キャラは縮んだ舞台の中に置く
      stage.state.bottomInset = h + 8 + subsHeight() + 6;
    } else {
      // 返事が長くて、字幕の箱が見込みより高い時は、その分だけ下の余白を広げる(体にかけない)
      // ただし、キャラに残す高さが画面の 36% を割るほどは広げない(低い画面では、頭のすき間の決まりを先に守る)
      const room = Math.max(0, window.innerHeight * 0.64 - topGuard(0, window.innerWidth));
      stage.state.bottomInset = Math.max(estimate, Math.min(h + 8 + subsHeight() + 6, room), cardInset());
    }
  }
  reframe();
}

/* ---------- テレビ表示(11/7 本人「iPhone にあるものを AirPlay で、テレビにすぐパンって映せるようにしたい」。決まりは stage/tvMode.js) ---------- */
// ウェブの頁は画面ミラーリング(AirPlay)を自分では始められないので、画面は ① 大きく見せる「テレビ表示」(画面いっぱい・キャラを大きく真ん中・
// 3 m 先から読める字幕・小さな窓を隠して隅の「もどる」だけ)と、② iPhone・iPad の「テレビに映す」の 3 つの手順(と「テレビ表示にする」)を出す。
// 全画面は、使う人が押した時だけ頼む(iPhone の Safari には全画面の口が無いので、縦持ちなら「よこむきに」の一言)
let tvFull = false; // テレビ表示のために全画面にしたか(やめる時に戻す)
function tvActive() {
  return document.documentElement.classList.contains(TV_CLASS);
}

/* 完全な全画面の案内(11/8 本人「URL まで出ちゃったり、完全な全画面にもなってない」): 頁から全画面にできず、ホーム画面の頁としても開いていない時に、
   1 回だけ短く出す(文と決まりは stage/tvMode.js の fullscreenGuide)。閉じるボタンか、時間で消える */
let tvGuideShown = false; // 鍵(localStorage)が使えない時も、この頁の間は 1 回だけ
let tvGuideTimer = 0;
function hideTvGuide() {
  clearTimeout(tvGuideTimer);
  const box = $('tvGuide');
  if (box) box.hidden = true;
}
function showTvGuide() {
  const box = $('tvGuide');
  const text = $('tvGuideText');
  if (!box || !text) return;
  let seen = tvGuideShown;
  try {
    seen = seen || localStorage.getItem(TV_GUIDE_KEY) === '1';
  } catch {
    // 覚えられないブラウザ(この頁の間だけ 1 回)
  }
  const line = fullscreenGuide({ device: TV.device, canFullscreen: false, installed: isInstalledApp({ nav: navigator, matchMedia: window.matchMedia?.bind(window) }), seen, mac: isMacDesktop(navigator) });
  if (!line) return;
  tvGuideShown = true;
  try {
    localStorage.setItem(TV_GUIDE_KEY, '1');
  } catch {
    // 覚えられない時は、この頁の間だけ
  }
  text.textContent = line;
  box.hidden = false;
  clearTimeout(tvGuideTimer);
  tvGuideTimer = setTimeout(hideTvGuide, TV_GUIDE_AUTO_HIDE_MS);
}

function requestTvFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (typeof req !== 'function' || !canRequestFullscreen({ doc: document, el })) {
    showTvGuide(); // 全画面の口が無い(iPhone のブラウザなど)・頁に許されていない(別の頁の中など)
    return;
  }
  try {
    Promise.resolve(req.call(el, { navigationUI: 'hide' }))
      .then(() => {
        tvFull = true;
        return screen.orientation?.lock?.('landscape'); // 横に固定できる端末だけ(できなければ何もしない)
      })
      .catch(() => {});
  } catch {
    // 断られた時はそのまま(テレビ表示は続ける)
  }
}

function leaveTvFullscreen() {
  if (!tvFull) return;
  tvFull = false;
  try {
    screen.orientation?.unlock?.();
  } catch {
    // 固定していない
  }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
}

/** テレビ表示にする・やめる。fullscreen は押した時(使う人の操作の中)だけ真にする */
function setTvMode(on, { fullscreen = false } = {}) {
  if (on && (!TV.show || KIOSK.on)) return; // ヘッドセットの中・入口の LED・接客モードではしない
  const btn = $('tvBtn');
  if (on !== tvActive()) {
    document.documentElement.classList.toggle(TV_CLASS, on);
    if (TV.kind === 'toggle') btn?.setAttribute('aria-pressed', String(on));
    if (on) {
      app.questLink?.close(); // 開いた箱・札を残さない
      const drawer = $('memoryDrawer');
      if (drawer?.open) drawer.open = false;
    }
    closeTvCast();
    fitBottom(); // 字幕の大きさ・下の余白・キャラの置き直し
  }
  if (on && fullscreen) requestTvFullscreen();
  if (!on) {
    hideTvGuide();
    leaveTvFullscreen();
    if (btn && !btn.hidden) btn.focus({ preventScroll: true });
  }
}

/** 「テレビに映す」の箱の文(stage/tvMode.js の文を textContent で入れる。外の住所は書かない) */
function fillTvCast(device) {
  const lead = $('tvCastLead');
  if (lead) lead.textContent = castLead();
  const note = $('tvCastNote');
  // B13L(TV3 の should): ホーム画面に追加して開く手順も、箱を開くたびに書く(ホーム画面の頁として開いている時は書かない)
  const home = homeScreenLine({ installed: isInstalledApp({ nav: navigator, matchMedia: window.matchMedia?.bind(window) }) });
  if (note) note.textContent = home ? `${castNote(device)}\n${home}` : castNote(device);
  const steps = $('tvCastSteps');
  if (steps) {
    steps.replaceChildren(
      ...castSteps(device).map((s) => {
        const li = document.createElement('li');
        li.append(Object.assign(document.createElement('b'), { textContent: s.main }), Object.assign(document.createElement('small'), { textContent: s.sub }));
        return li;
      }),
    );
  }
}

function openTvCast() {
  const box = $('tvCast');
  if (!box) return;
  app.questLink?.close();
  box.hidden = false;
  $('tvBtn')?.setAttribute('aria-expanded', 'true');
  $('tvEnter')?.focus({ preventScroll: true });
}

function closeTvCast(focusButton = false) {
  const box = $('tvCast');
  if (!box || box.hidden) return;
  box.hidden = true;
  $('tvBtn')?.setAttribute('aria-expanded', 'false');
  if (focusButton) $('tvBtn')?.focus({ preventScroll: true });
}

/**
 * 幅 640 まで: 入口は、畳んだ「Claude の考え」の見出しと同じ行の右、見た目の切り替えの左(style.css)。
 * 切り替えの幅を測って --tv-right に入れる(切り替えが無ければ右の端から 12px)
 */
function placeTvButton() {
  const look = $('lookSwitch');
  const w = look && !look.hidden ? Math.ceil(look.getBoundingClientRect().width) : 0;
  document.documentElement.style.setProperty('--tv-right', `${12 + (w > 0 ? w + 8 : 0)}px`);
}

/** 上の段の入口と、隅の「もどる」・手順の箱の押す所を付ける。ヘッドセットの中・入口の LED・自動で始める画面・重さを測る時は出さない */
function setupTvMode() {
  const btn = $('tvBtn');
  $('tvExit')?.addEventListener('click', () => setTvMode(false));
  $('tvGuideClose')?.addEventListener('click', hideTvGuide);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('tvCast') && !$('tvCast').hidden) {
      e.preventDefault();
      closeTvCast(true);
    } else if (tvActive() && !document.fullscreenElement && !document.webkitFullscreenElement) {
      setTvMode(false);
    }
  });
  // 全画面の間の Escape は、ブラウザが全画面だけを戻して、Escape の知らせはページに届かない(QA 低 14: Esc を押してもテレビ表示が残った)。
  // テレビ表示のために全画面にした後で全画面が終わったら、テレビ表示も一緒にやめる
  const onFullscreenChange = () => {
    if (tvFull && tvActive() && !document.fullscreenElement && !document.webkitFullscreenElement) setTvMode(false);
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  if (!btn || !TV.show) return;
  const name = TV.kind === 'cast' ? CAST_LABEL : TV_LABEL;
  btn.setAttribute('aria-label', name);
  btn.title = name;
  const label = $('tvBtnLabel');
  if (label) label.textContent = name; // 見せる言葉(幅 640 までは style.css が「テレビ」だけにする)
  if (TV.kind === 'cast') {
    fillTvCast(TV.device);
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-controls', 'tvCast');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => ($('tvCast')?.hidden === false ? closeTvCast(true) : openTvCast()));
    $('tvEnter')?.addEventListener('click', () => setTvMode(true, { fullscreen: true }));
    $('tvCastClose')?.addEventListener('click', () => closeTvCast(true));
    $('tvCast')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeTvCast(true); // 札の外(暗い所)を押すと閉じる
    });
  } else {
    btn.setAttribute('aria-pressed', String(tvActive()));
    btn.addEventListener('click', () => setTvMode(!tvActive(), { fullscreen: true }));
  }
  app.tv = {
    plan: TV,
    get active() {
      return tvActive();
    },
    set: setTvMode,
  };
  const look = $('lookSwitch');
  if (look) new ResizeObserver(placeTvButton).observe(look); // 切り替えが出る・隠れる・幅が変わる時に置き直す
  placeTvButton();
  btn.hidden = false;
}

/* ---------- 見た目の切り替え(3D と 2D。両方あるキャラだけ。このタブだけで覚える) ---------- */
// 舞台の子が替わるたび(見た目の切り替え・初めての会話の見本の子・案内役に戻す)に、今の子に合わせて作り直す(S4 の頼み。CRITux2 高 1 の残り)。
// 前は最初の子で 1 回だけ作り、控えも見た目だけを鍵にしていたので、入れ替えた後に押すと最初の子の見た目が戻った
const lookCache = new Map(); // lookKey(キャラの id と見た目)→ 読み込んだキャラ(捨てずに持つ。2 回目からはすぐ替わる。ほかの子の控えと混ぜない)
const lookKinds = new Map(); // キャラの id → 出せる見た目(['3d', '2d'] など。調べるのは子ごとに 1 回)
let lookBusy = false;
let lookClicks = false; // 押した時の受け口を付けたか(付けるのは 1 回だけ)
let lookCheck = 0; // 何回目の作り直しか(調べている間に舞台の子が替わったら、古い答えは使わない)
let bootLookId = null; // 最初に出した子の id(URL の ?look= を書き換えるのは、この子の見た目を替えた時だけ)
const LOOK_SWITCH_OFF = IS_HEADSET || ['led', 'autostart'].some((k) => params.get(k) === '1') || params.get('perf') === '1';

/**
 * 舞台の子に合わせて、上の段の切り替えを出す・隠す・押された方を合わせる。両方の見た目がある子だけ出す
 * (片方だけの子・調べられない時は隠す)。swapCharacter と起動の最後に呼ぶ
 */
async function refreshLookSwitch(character = app.character) {
  const box = $('lookSwitch');
  if (!box || !character || LOOK_SWITCH_OFF) return;
  const check = ++lookCheck;
  const id = characterKey(character);
  const key = lookKey(id, character.look);
  const stale = lookCache.get(key);
  // 同じ子を読み直した(見本の子をもう一度選んだ)時、控えの古い方はもう誰も使わない。GPU の物とミキサーを捨てる(QA 高 1)
  if (stale && stale !== character && stale !== app.character) stale.dispose?.();
  lookCache.set(key, character);
  let looks = id ? lookKinds.get(id) : null;
  if (!looks) {
    box.hidden = true; // 調べ終わるまで、前の子の切り替えを出したままにしない
    looks = await availableLooks(character).catch((err) => {
      console.warn('見た目の種類を調べられませんでした:', err.message);
      return null;
    });
    if (looks && id) lookKinds.set(id, looks);
  }
  if (check !== lookCheck || app.character !== character) return; // 調べている間に舞台の子が替わった(新しい回が決める)
  const shown = hasBothLooks(looks);
  if (shown && !lookClicks) {
    lookClicks = true;
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-look]');
      if (btn) void switchLook(btn.dataset.look);
    });
  }
  syncLookSwitch();
  box.hidden = !shown;
}

function syncLookSwitch() {
  const box = $('lookSwitch');
  for (const b of box.querySelectorAll('button[data-look]')) {
    b.setAttribute('aria-pressed', String(b.dataset.look === app.character.look));
    b.disabled = lookBusy;
  }
}

/** 見た目を替える(今の舞台の子の、もう一方の見た目)。読み込めなければ、今の見た目のまま理由を出す */
async function switchLook(look) {
  if (lookBusy || !app.character || look === app.character.look) return;
  if (modes && modes.mode !== 'screen') return; // AR・VR の間は替えない(位置合わせと舞台がキャラを持っている)
  lookBusy = true;
  syncLookSwitch();
  const from = app.character;
  const id = characterKey(from);
  try {
    let next = lookCache.get(lookKey(id, look));
    if (!next) {
      next = await loadCharacter(from.lookSource.url, { ...app.tierOverrides, look });
      if (next.look !== look) throw new Error(`${look === '2d' ? '2D' : '3D'} の形を読めませんでした`);
      lookCache.set(lookKey(id, look), next);
    }
    if (app.character !== from) return; // 読んでいる間に舞台の子が替わった(初めての会話の見本の子など)。その子は替えない
    swapCharacter(next);
    writeRemembered(tabMemory, id || app.characterId, look); // 読む側(loadCharacter)と同じ id
    // URL に ?look= があれば、選んだ方に書き換える(読み込み直しても、選んだ見た目のまま)。最初に出した子の時だけ(見本の子の見た目は URL に書かない)
    if (params.has('look') && id === bootLookId) {
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
  // 舞台から外した子は、GPU の物(形・材質・絵)を捨てる(スマホのメモリを持ち続けない。QA 高 1)。控えの子として戻す時は、次の描画で作り直される
  if (prev !== next) prev.releaseGpu?.();
  app.character = next;
  dialogue.character = next;
  updateAiNotice();
  document.documentElement.dataset.look = next.look ?? '3d';
  stage.frameCharacter(next, characterView(next), app.place?.loaded?.object3d);
  void refreshLookSwitch(next); // 見た目の切り替えを、今の子に合わせて作り直す(両方ある子だけ出す・押された方を合わせる)
  // UW5(UIR 14): ほかの子に替わったら、前の子の字幕と「あたまの なか」を空にする(見た目だけの切り替えでは残す)
  if (characterKey(prev) !== characterKey(next)) ui.clearTalk?.();
  uw5ThoughtLabel();
  // 舞台の子が替わったら: 記憶はその子の分に切り替え(札も読み直す)、端末が「いまの子」として覚える(読み込み直しても同じ子で始める)
  const nowId = characterKey(next);
  setMemoryCharacter(nowId);
  if (!KIOSK.on && stageMemoryWanted(params, { headset: IS_HEADSET })) writeStageId(siteMemory, nowId); // 接客モードの端末は、舞台の子を覚えない
  if (characterKey(prev) !== nowId) {
    memory?.resync?.();
    madeKids?.sync();
  }
}

/* ---------- B5M: しつかん(3D の材質: いつもの・ぬの・け・つるつる)と光。ここから下の 1 塊だけが B5M(合わせ 12b) ----------
   決まりと数字は stage/shitsukan.js、描き方は stage/shitsukanLook.js、上の段の切り替えは stage/shitsukanSwitch.js。
   既定は全部の端末で「ぬの」(端末の段で変えない。本人 11/7 22:1x・22:5x)。GLB は作り直さず、描く直前に材質を差しかえる
   (舞台の子が替わった次のコマで当たる: 見た目の切り替え・見本の子・案内役に戻す、のどれでも)。選んだ物はこのブラウザでキャラごとに覚える。
   どれを当てるか: ?shitsukan=(試しと撮影。覚えない)→ このページで押した物 → このブラウザで覚えた物 → character.json の looks.3d.material → ぬの */
import { createShitsukanLook } from './stage/shitsukanLook.js'; // (B5M)
import { mountShitsukanSwitch } from './stage/shitsukanSwitch.js'; // (B5M)
import { pickShitsukan, readStored, writeStored, heavyNoteWanted, normalizeShitsukan, HEAVY_NOTICE } from './stage/shitsukan.js'; // (B5M)
app.shitsukan = (() => {
  const urlPick = normalizeShitsukan(params.get('shitsukan'));
  // キャラの id → 当てる物(このページで押した物か、初めて舞台に出た時に決めた物)。毎コマ保存先を読まない
  const chosen = new Map();
  const heavyNote = heavyNoteWanted(app.tier?.name);
  const idOf = (c) => characterKey(c) || app.characterId || '';
  const can = (c) => Boolean(c) && c.kind === 'rig' && c.look !== '2d';
  const wanted = (c) => {
    if (urlPick) return urlPick;
    const id = idOf(c);
    if (!chosen.has(id)) chosen.set(id, pickShitsukan({ stored: readStored(siteMemory, id), json: c?.lookSource?.json }).id);
    return chosen.get(id);
  };
  const look = createShitsukanLook(stage, {
    onFurReady: (_c, ok) => {
      if (!ok) ui.notice('け の じゅんびが できませんでした。ほかの しつかん を えらんでね');
    },
  });
  const root = $('shitsukan');
  const box = root && !LOOK_SWITCH_OFF
    ? mountShitsukanSwitch({
        root,
        heavyNote,
        onPick: (id) => {
          const c = app.character;
          if (!can(c)) return;
          chosen.set(idOf(c), id);
          writeStored(siteMemory, idOf(c), id);
          if (id === 'fur' && heavyNote) ui.notice(HEAVY_NOTICE);
        },
        onToggle: () => reframe(), // 開いた札の下へキャラを置き直す(閉じたら戻す)
      })
    : null;
  // 開いた札(せまい画面)も、上の段の線に数える(キャラの頭を札の下へ。札が横に重なる時だけ)
  const baseGuard = stage.state.topGuard;
  stage.state.topGuard = (left, right) => {
    const line = baseGuard(left, right);
    const r = box?.openRect();
    return r && r.right > left && r.left < right ? Math.max(line, r.bottom + TOP_GAP_PX) : line;
  };
  let shown = { character: null, id: null, visible: null };
  const plainRender = stage.render;
  stage.render = () => {
    const c = app.character;
    if (c) {
      const want = can(c) ? wanted(c) : 'drawn';
      if (shown.character !== c || shown.id !== want) {
        const got = look.apply(c, want); // 毛の準備中は前の見た目のまま(できた次のコマで替わる)
        if (got === want || look.failed(c, want)) shown = { ...shown, character: c, id: want };
        box?.set(want);
      }
      const visible = can(c);
      if (box && shown.visible !== visible) {
        box.show(visible);
        shown.visible = visible;
      }
      look.update(c, stage.camera);
    }
    plainRender();
  };
  return { look, wanted, current: () => shown.id, box };
})();
/* ---------- B5M ここまで ---------- */

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

/**
 * 案内役の 1 行。キャラを読んだすぐ後(app.character を入れたのと同じ流れの中)に書き、書いてから見せる(html.guide-ready)。
 * それまでは style.css が隠す: ?character=<id> で開いた時、遅い端末で HTML の初めの文「案内するのは主役のノリー…」が先に見えていた(M8b 4)
 */
function fillGuide() {
  const c = app.character;
  const guide = $('gateGuide');
  if (guide && c && (app.characterId ?? c.id) !== MAIN_CHARACTER.id) guide.textContent = `案内するのは「${c.name ?? app.characterId ?? 'この子'}」です。`;
  document.documentElement.dataset.guideName = c?.name || MAIN_CHARACTER.name; // CU: 入口の「〜が おきているよ」と「〜が かんがえているよ」の名前
  document.documentElement.classList.add('guide-ready');
  if (document.documentElement.classList.contains('gate-up')) setGateWake(wakeState);
}

/**
 * CU: 入口の「起動中」の表示。loading = 読み込んでいる間、ready = 押せる(ボタンが光る)、busy = 押した後(カメラやモデルを用意している間)。
 * 文の決まりは ui/waitBubble.js。小さな字の知らせ(gateStatus)とは別に、顔と動く点で「起きている途中」だと見せる(押せない間に、無視されているように見せない)
 */
let wakeState = 'loading';
function setGateWake(state) {
  wakeState = state;
  document.documentElement.classList.toggle('gate-ready', state === 'ready');
  document.documentElement.classList.toggle('gate-failed', state === 'failed');
  const text = $('gateWakeText');
  if (!text) return;
  const name = document.documentElement.dataset.guideName || 'ノリー';
  const lang = effectiveHearLang(currentLangMode()); // 選んだことばで(日本語だけの時は今までどおり)
  const line = wakeLine(state, { name, lang });
  if (text.textContent !== line) text.textContent = line;
  const hint = $('gateWakeHint');
  if (hint) {
    hint.textContent = wakeHint(lang);
    hint.hidden = state !== 'loading';
  }
}

function fillGate() {
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
  // CU: 押してから最初の一言が出るまで「ノリーが かんがえているよ …」を出す(スマホの遅い回線でも、無視されているように見せない)。
  // 初めての訪問は、はじめての会話の札が開いたら札の「…」に替わる(下の MutationObserver が消す)。声かけをしない設定(?auto=0)・ヘッドセットなどでは出さない
  if (app.autoGreet && UW5_SIMPLE) waitBubble.begin({ immediate: true });
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

/* ---------- 「かえる」の中の「つくった子」(ui/madeKids.js) ---------- */
// ブラウザで作った子(サーバーの characters/yb*)を、サーバーの一覧から並べる。選ぶと舞台がその子になり、端末が覚える。
// 来場者の上の段の時だけ。サーバーが一覧を持たない時(公開の関数・/api/status に made が無い)は、聞きにいかない
function setupMadeKids() {
  const root = $('madeKids');
  if (!root || !stageMemoryWanted(params, { headset: IS_HEADSET })) return;
  void import('./ui/madeKids.js')
    .then(({ mountMadeKids }) => {
      madeKids = mountMadeKids({
        root,
        getStageId: () => characterKey(app.character) || app.characterId || '',
        // 初めての会話の部品の「舞台に出す」(読み込み直さない)。まだ用意できていなければ、できるまで待つ
        putOnStage: (id) => firstRunReady.then((api) => (api?.putOnStage ? api.putOnStage(id) : false)),
        onPicked: () => uw5SetTop(null),
        onRenamed: (id, name) => {
          if (characterKey(app.character) !== id) return;
          // 舞台にいる子の名前が変わった: 札・見出し・声の種・会話に渡す名前を、新しい名前に
          const old = app.character.name;
          try {
            app.character.name = name;
          } catch {
            // 書けない形の子は、読み直した時に新しい名前になる
          }
          if (typeof app.persona === 'string' && old) app.persona = app.persona.replace(new RegExp(`^# ${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `# ${name}`);
          updateAiNotice();
          uw5ThoughtLabel();
          document.documentElement.dataset.guideName = name;
          try {
            speaker.setVoice({ seed: name });
          } catch {
            // 声の種を替えられなくても続ける
          }
        },
        onRemoved: (id) => {
          if (readStageId(siteMemory) === id) forgetStageId(siteMemory);
        },
        storage: siteMemory,
      });
      if (app.status?.made) void madeKids.refresh();
      // 「かえる」を開くたびに、サーバーの一覧を読み直す(別の端末で作った・変えた子も出る)
      $('changeBtn')?.addEventListener('click', () => {
        if (app.status?.made) void madeKids?.refresh();
      });
      // 作る画面を閉じた時にも読み直す(いま作った子が、すぐ並ぶ)
      globalThis.addEventListener('yc:firstrun-closed', () => {
        if (app.status?.made) void madeKids?.refresh();
      });
    })
    .catch((err) => console.warn('「つくった子」を用意できませんでした:', err.message));
}

/* ---------- VR(Quest)で開く(本人の案 11/7。決まりは stage/questLink.js、入口の部品は ui/panel.js) ---------- */
// PC やスマホの画面に、この画面の QR を出す(Quest 3・3S の QR コードスキャナーで読む)。Quest の中(immersive-vr が使える・
// ヘッドセットのブラウザ)では出さない。この PC・家の中のアドレスでは、QR の代わりに 1 行。QR に入れるのは、この画面の場所と、
// 舞台の子の id(主役でアドレスに ?character= が無い時は付けない)と見た目(両方ある子か、アドレスに ?look= がある時)だけ
function questLinkState() {
  const asked = new URLSearchParams(location.search);
  const id = characterKey(app.character) || app.characterId || '';
  const character = id === MAIN_CHARACTER.id && !asked.has('character') && !asked.has('char') ? '' : id;
  const look = hasBothLooks(lookKinds.get(id)) || asked.has('look') ? (app.character?.look ?? '') : '';
  return questLinkPlan({ loc: location, character, look, immersiveVr: Boolean(modes?.available?.vr), headset: IS_HEADSET });
}

function setupQuestLink() {
  const root = $('questLink');
  if (!root || LOOK_SWITCH_OFF || !questLinkState().show) return; // Quest の中・入口の LED・自動で始める画面・重さを測る時は出さない
  const drawer = $('memoryDrawer');
  const link = mountQuestLink({
    root,
    button: $('questLinkBtn'),
    box: $('questLinkBox'),
    plan: questLinkState,
    holdOpenFor: (t) => Boolean(t?.closest?.('#memoryDrawer')), // 「覚えていること」は、押し終わりで札が開き、その時に箱を閉じる(押し始めで閉じると上の段が動く)
    onToggle: (open) => {
      if (open && drawer?.open) drawer.open = false; // 「覚えていること」の札とは同時に開かない(重ねない)
      // 箱を開いている間は、上の段の入口のほかの物(おうちの人への一文・札・テレビ・あたまの なか)をしまい、上の段の高さを抑える
      // (「もっと」の段が何行にもなると、箱の高さの上限「画面の 45% − 上の段」が縮んで送るボタンが切れた)。閉じると戻る。
      // 箱を開いても「もっと」は閉じない(入口が残るので、Escape で閉じた後もフォーカスを入口へ戻せる)
      document.documentElement.classList.toggle('quest-open', open);
      reframe(); // 開く・閉じるで上の段の高さが変わる分も、キャラを置き直す(閉じた後に元の位置へ戻す)
    },
  });
  drawer?.addEventListener('toggle', () => {
    if (drawer.open) link.close();
  });
  // 初めての会話(7 歩の札)が出たら閉じる(入口は style.css が隠す)
  new MutationObserver(() => {
    if (document.documentElement.classList.contains('fr-open')) link.close();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(reframe).observe($('questLinkBox')); // 開く・閉じる・QR が出来た時に、キャラを箱の下へ置き直す(戻す)
  app.questLink = link;
  root.hidden = false;
}

/* ---------- 戻るボタン(QA 低 14) ---------- */
// 窓(覚えていること・Quest で開く・テレビに映す・テレビ表示)を開く時に履歴を 1 つ積み、戻るボタンはその窓を閉じる
// (積まないと、窓を開いたまま戻るを押すと、アプリごと前の頁へ出てしまった)。窓をボタンで閉じた時は、積んだ履歴を戻す
let panelPushed = false; // 窓のために履歴を積んでいるか
let panelPopQuiet = 0; // 自分で戻した時の popstate を、窓の閉じ直しに使わない回数
// UW5(UIR 9): 全部の窓を数える。上の段の「かえる」「もっと」・カメラの知らせ・マイクとアップデートの窓・しつかんの札・性格の窓・はじめての会話の札も
const openSheets = () => [...document.querySelectorAll('.yc-sheet:not([hidden])')];
const openPersona = () => [...document.querySelectorAll('.yp-panel')].filter((p) => p.isConnected && p.getClientRects().length > 0);
const frSheetOpen = () => document.documentElement.classList.contains('fr-open') && Boolean(document.querySelector('.fr-sheet .fr-close'));
function anyPanelOpen() {
  const root = document.documentElement.classList;
  return Boolean(
    $('memoryDrawer')?.open || ($('questLinkBox') && !$('questLinkBox').hidden) || ($('tvCast') && !$('tvCast').hidden) || tvActive() ||
      root.contains('top-more') || root.contains('top-change') || ($('camAsk') && !$('camAsk').hidden) || openSheets().length ||
      app.shitsukan?.box?.isOpen?.() || openPersona().length || frSheetOpen(),
  );
}
function closeAllPanels() {
  const drawer = $('memoryDrawer');
  if (drawer?.open) drawer.open = false;
  app.questLink?.close();
  closeTvCast();
  if (tvActive()) setTvMode(false);
  if ($('camAsk') && !$('camAsk').hidden) $('camAskNo')?.click(); // カメラは入れない(「やめる」と同じ)
  for (const s of openSheets()) s.querySelector('.yc-sheet-close')?.click();
  app.shitsukan?.box?.close?.();
  // 性格の窓(S4)は「もどす(閉じる)」と同じ(変えた所は戻す)。はじめての会話の札は「あとで」と同じ
  for (const p of openPersona()) p.querySelector('.yp-cancel')?.click();
  if (frSheetOpen()) document.querySelector('.fr-sheet .fr-close')?.click();
  uw5SetTop(null);
}
function syncPanelHistory() {
  const open = anyPanelOpen();
  if (open && !panelPushed) {
    try {
      history.pushState({ ...(history.state ?? {}), ycPanel: true }, '');
      panelPushed = true;
    } catch {
      // 履歴を積めない環境では何もしない(戻るは今まで通り)
    }
  } else if (!open && panelPushed) {
    panelPushed = false;
    if (history.state?.ycPanel) {
      panelPopQuiet += 1;
      history.back();
    }
  }
}
function installPanelHistory() {
  window.addEventListener('popstate', () => {
    if (panelPopQuiet > 0) {
      panelPopQuiet -= 1;
      return;
    }
    if (panelPushed) {
      panelPushed = false; // 戻るで積んだ履歴は無くなった。窓を閉じる(閉じた後の同期で、もう戻さない)
      closeAllPanels();
    }
  });
  const watch = new MutationObserver(syncPanelHistory);
  const opt = (el, attrs) => el && watch.observe(el, { attributes: true, attributeFilter: attrs });
  opt($('memoryDrawer'), ['open']);
  opt($('questLinkBox'), ['hidden']);
  opt($('tvCast'), ['hidden']);
  opt(document.documentElement, ['class']);
  // UW5: 後から body に足される窓(マイクとアップデートの窓・性格の窓)と、カメラの知らせ・しつかんの札も見る(まとめて 1 コマに 1 回)
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncPanelHistory();
    });
  };
  const bodyWatch = new MutationObserver(later);
  bodyWatch.observe(document.body, { childList: true });
  opt($('camAsk'), ['hidden']);
  opt($('shitsukan'), ['class']);
  new MutationObserver(later).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
}

/* ---------- BCV: カメラは使う人が決める・カメラの中身にも答える(11-08 本人)。中身は stage/cameraUse.js(部品は cameraSwitch.js・絵の 1 枚は conversation/cameraFrame.js) ---------- */
// どの端末でも、いつでも入・切。入れる前に 1 行の知らせ。入っている間は小さな印。使う人が選んだカメラで話しかけた回だけ、同じ流れから絵を 1 枚頭脳へ
import { createCameraUse } from './stage/cameraUse.js';
app.camera = createCameraUse({
  app,
  ui,
  dialogue,
  $,
  params,
  headset: IS_HEADSET,
  touch: TOUCH,
  sourceOptions: () => ({ getFrame: frameInfo, gain: GAIN, hfovDeg: HFOV }),
  inXr: () => Boolean(modes && modes.mode !== 'screen'),
  updatePrivacy: () => updatePrivacy(),
  isMock: () => currentBrain() === 'mock',
});
/* ---------- BCV ここまで ---------- */

async function boot() {
  const status = $('gateStatus');
  const buttons = [$('startCam'), $('startSim'), ...(KIOSK.on && $('kioskStart') ? [$('kioskStart')] : [])];
  buttons.forEach((b) => (b.disabled = true));
  if (KIOSK.on) {
    // 接客モードの入口: 説明 1 つと、大きな「接客を はじめる」1 つ
    $('kioskLead').hidden = false;
    $('kioskStart').hidden = false;
  }
  setGateWake('loading'); // CU: 入口の「ノリーが おきているよ…」(読み込みの間。小さな字の「読み込んでいます」は、これに替えた)
  installKeyboardInset();
  installNoPinchZoom(); // 指のつまみで拡大しない・拡大されたら 1 倍へ戻す(11-08 本人の iPhone)
  composerInput = installComposerInput({ input: $('textInput'), form: $('composer') });
  stage.resize();
  // 窓の resize が来ない箱の変化にも追いつく(毎フレームの確かめに加えて、描いていない間の変化も拾う)
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncStage).observe(stage.renderer.domElement);
  window.addEventListener('orientationchange', syncStage);
  window.addEventListener('pageshow', syncStage);
  document.addEventListener('visibilitychange', syncStage);
  window.visualViewport?.addEventListener('resize', syncStage);
  window.addEventListener('resize', () => {
    stage.resize();
    if (tvActive()) fitBottom(); // テレビ表示の字幕の大きさと下の余白は、画面の高さで決まる(置き直しも中で)
    else if (app.character) stage.frameCharacter(app.character, undefined, app.place?.loaded?.object3d);
  });
  // 下の帯(よくある質問のボタン・入力欄)の高さが変わったら、全身の見せ方を取り直す(足が帯に隠れないように。テレビ表示は字幕の分)
  new ResizeObserver(fitBottom).observe(document.querySelector('.bottom'));
  // 字幕の箱の高さが変わったら(長い返事・画面のキーボード中の 1 行)、下の余白を取り直す(字幕がキャラの体にかからないように。QA 低 13)
  new ResizeObserver(fitBottom).observe(document.querySelector('.subs'));
  window.addEventListener('yc-kb', fitBottom); // 画面のキーボードが出入りした時(keyboardInset.js)
  installPanelHistory();
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
    // 接客モード: 設定を先に取り(3 秒まで)、QR を作った PC の舞台の子(札に入っている id)を出す。?character= があればそちらが先
    await loadKioskConfig();
    const kioskSpec = KIOSK.on && !charPick.spec ? kioskCharacterId(KIOSK) : '';
    const firstOpts = { ...tierOverrides, look: params.get('look') ?? '', lookMemory: tabMemory };
    // アドレスに ?character= が無い時は、この端末が覚えている「いま舞台にいた子」から始める(作った子が、読み込み直すとノリーに戻らない)。
    // 読めなかった(消された・サーバーが替わった)時は、覚えを消して、いつもの子から。接客モードの端末は、覚えを使わない(札の子が先)
    let first = null;
    const remembered = !KIOSK.on && !charPick.spec && stageMemoryWanted(params, { headset: IS_HEADSET }) ? readStageId(siteMemory) : '';
    if (remembered) {
      try {
        first = await loadFirstCharacter(remembered, firstOpts);
      } catch (err) {
        console.info(`覚えていた子 ${remembered} は出せませんでした: ${err.message}`);
        forgetStageId(siteMemory);
      }
    }
    // 札の id の子がこのサーバーに無ければ、いつもの主役で出す(接客モードの入口を、読み込めない画面にしない)
    if (!first) {
      first = kioskSpec
        ? await loadFirstCharacter(kioskSpec, firstOpts).catch((err) => {
            console.info(`接客モード: 札の子 ${kioskSpec} は出せませんでした: ${err.message}`);
            return loadFirstCharacter(charPick.spec, firstOpts);
          })
        : await loadFirstCharacter(charPick.spec, firstOpts);
    }
    const { character, id } = first;
    app.character = character;
    app.characterId = id;
    bootLookId = characterKey(character);
    fillGuide(); // 入口の案内役の名前は、読んだすぐ後に書いてから見せる(状態を読むのを待たない)
    updateAiNotice();
    setMemoryCharacter(characterKey(character) || id); // 記憶は子ごとに分ける(会話と記憶の札が、この子の id を付けて送る)
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
    applyHearLang(); // ML1: persona.md の「- ことば: 多言語」の行でも、聞く言葉の選びを出す
    status.textContent = app.urlNotices.join(' '); // 読まなかった ?character= ?place= の知らせ(無ければ空)
  } catch (err) {
    console.error(err);
    status.textContent = `キャラを読み込めませんでした: ${err.message}`;
    setGateWake('failed'); // CU: 「おきているよ…」のまま止まらない(動く点を止めて、やさしく知らせる)
    return;
  }
  // 接客モード: VR・AR・テレビ・カメラ・記憶・見た目の切り替えは、用意もしない(隠すだけでなく、開く道も作らない)
  if (!KIOSK.on) await setupPresentation().catch((e) => console.warn('見せ方の切りかえを用意できませんでした:', e.message));
  await refreshStatus();
  setInterval(refreshStatus, 15000);
  setupPass();
  if (!KIOSK.on) {
    setupMemory();
    setupMadeKids(); // 「かえる」の中の「つくった子」(作った子の一覧はサーバーが持つ)
    setupQuestLink(); // 見せ方を調べた後(Quest の中なら出さない)
    setupTvMode(); // テレビ表示の入口(iPhone・iPad は「テレビに映す」。ヘッドセットの中では出さない)
    app.camera.setup(); // BCV: カメラの入・切(いつでも。入口だけでなく)
    void refreshLookSwitch(app.character); // 3D と 2D の両方があるキャラだけ、上の段に切り替えを出す(待たない。舞台の子が替わるたびにも作り直す)
    mountKioskSetup({ app, local: isLoopbackPage(location) && Boolean(app.status) }); // PC の「もっと」の中の「接客モード」(番号・設定・QR。この PC の中で開いた時だけ)
  } else {
    setInterval(() => void loadKioskConfig(), 5 * 60 * 1000); // 店の人が PC で設定を変えたら、数分で追いつく
  }
  if (app.status?.shop?.available) showShopChoices(); // 店のデータがあるときだけ、よくある質問のボタンを出す
  speaker.loadFillers().then((n) => console.info(`あいづちの声: ${n} 種類`));
  updatePrivacy();
  fillGate(); // 入口の文(声があるか・初めての訪問か・指かマウスか)は、状態を読んだ後に決める
  $('camSub').textContent = 'キャラがあなたの方を見ます。顔は保存しません'; // B4(12b): カメラの札に「顔は保存しません」(UIR 22) // index.html では「読み込んでいます…」で押せない(遅い回線で、押せそうで押せない時間を作らない。P1 中)
  buttons.forEach((b) => (b.disabled = false));
  setGateWake('ready'); // CU: 「じゅんび できたよ! おしてね」(ボタンが光る)
  // ?perf=1: いまの重さを測る(L0。数字は window.__perf。測りの部品は、このときだけ読む)
  if (params.get('perf') === '1') import('./stage/perf.js').then(({ startPerf }) => startPerf({ stage, character: app.character, params, readyAt, tier: app.tier, firstFrameAt: () => app.firstFrameAt, loopStartAt }));

  /** 入力を選んで始める。失敗したら理由を出して、ゲートに戻る */
  async function startSource(kind, pending) {
    speaker.unlock(); // 音を出す許可は、最初のタップの中で取る
    if (tvActive()) requestTvFullscreen(); // ?tv=1: 全画面も、このタップの中で頼む(待つ前に)
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = pending;
    setGateWake('busy'); // CU: 押した後、カメラやモデルを用意している間も「じゅんびしているよ…」(固まって見えない)
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
        // マイクの許可は、VR に入る前のこの画面で取る(VR の中で許可の窓が出るとどうなるかは、資料が無い)。
        // 「VR で見る」の案内は、マイクの答えを待たずに出す(実機の Quest で、マイクの許可の窓に答えないと案内が出なかった)。
        // 答えが来た時に、案内がまだ出ていて(VR を頼んでいない・入っていない)マイクが使えなかった時だけ、文を替える
        const guide = Boolean(modes?.available.vr);
        if (guide) ui.align(VR_GUIDE);
        await toggleMic();
        const align = $('align');
        if (guide && !listener?.listening && !align.hidden && align.textContent === VR_GUIDE && modes?.mode === 'screen' && !modes.pending) ui.align(VR_GUIDE_NO_MIC);
      }
    } catch (err) {
      console.error(err);
      // UW5(UIR 11): 英語の err.message は出さない。カメラが使えなかった時は、やさしい 1 行を出して、カメラなしで自動で始める
      if (kind === 'camera') {
        status.textContent = UW5_CAMERA_FALLBACK;
        status.scrollIntoView?.({ block: 'center' }); // 幅 390 の入口は知らせが画面の下に出る。見える所へ(UW5r 中 3)
        ui.notice(UW5_CAMERA_FALLBACK); // 画面の上の知らせでも同じ 1 行を出す
        setTimeout(() => {
          void startSource('sim', UW5_CAMERA_FALLBACK).then(() => ui.notice(UW5_CAMERA_FALLBACK));
        }, 1600);
        return;
      }
      status.textContent = 'うまく はじめられなかったよ。「カメラなしで試す」なら うごかせます。';
      buttons.forEach((b) => (b.disabled = false));
      setGateWake('ready');
    }
  }
  const wantPose = params.get('source') === 'pose' || IS_HEADSET; // AR(iPhone の殻アプリ)・VR(Quest)では、位置を外から受け取る
  const wantBridge = params.get('source') === 'bridge'; // 入口の LED: 床のカメラ(別の機械でもよい)の向きを、サーバー経由で受ける。この端末のカメラは使わない
  $('startCam').addEventListener('click', () =>
    wantBridge ? startSource('bridge', '床のカメラにつないでいます…') : wantPose ? startSource('pose', '準備しています…') : startSource('camera', 'カメラとモデルを準備しています…'),
  );
  $('startSim').addEventListener('click', () => startSource('sim', ''));
  // 接客モード: 店の人が 1 回押す = 音の許可(startSource の中)と、画面を消さない・聞き取りの見張りの開始。あとは来場者が話しかけるだけ。カメラは使わない
  $('kioskStart')?.addEventListener('click', async () => {
    void wakeLock.start();
    await startSource('sim', '');
    if (app.source) handsFree.enable();
  });
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

  $('micBtn').addEventListener('click', () => {
    if (KIOSK.on && listener?.listening) return; // 接客モード: 来場者が押しても聞くのは止まらない(止めるのは店の人の「出る」だけ)
    void toggleMic();
  });
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('textInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    composerInput?.fit(); // 1 行に戻す
    speaker.unlock();
    void talk({ text, mode: 'text' });
  });
  if (!listenProvider()) {
    $('micBtn').disabled = true;
    $('micBtn').title = 'このブラウザは声の聞き取りに対応していません';
  }
}

boot();
// ---- BUX(第 12 波 b): 「マイクと スピーカー」の窓(声で話すの横の歯車)と、画面のアップデート(この PC の中で開いた時だけ、上の段に小さな印)。
// 中身は ui/audioPanel.js・ui/updatePanel.js。ここではつなぐだけ(ほかの所は変えない) ----
import { mountAudioPicker } from './ui/audioPanel.js';
import { mountUpdate, startUpdateCheck } from './ui/updatePanel.js';
import { setSheetLayoutHook, setSheetRoom, sheetGuard } from './ui/sheet.js';
import { MIN_USABLE as YC_MIN_USABLE } from './stage/framing.js';
// 窓を開いている間は、頭の線に窓の下の端を足す(キャラを窓の下へ置き直す。窓が開いた・閉じた・大きさが変わった時に置き直す)。
// 窓の下の端は、キャラに画面の高さの MIN_USABLE が残る所まで(それより下だと、キャラが窓と下の帯にはみ出す)、かつ下の帯の高さまで
// (それより下だと、キャラが画面の真ん中より下へずれて写り、遠近で縦横の比が PC から 3% を超えた。390x844)
const ycBaseGuard = stage.state.topGuard;
stage.state.topGuard = (left, right) => Math.max(ycBaseGuard(left, right), sheetGuard(left, right));
setSheetRoom(() => Math.min(window.innerHeight * (1 - YC_MIN_USABLE) - (stage.state.bottomInset || 0), stage.state.bottomInset || Infinity));
setSheetLayoutHook(() => reframe());
// 接客モードでは、歯車(マイクとスピーカー)とアップデートは作らない(店の人の設定の入口は、PC の「接客モード」だけ)
const ycUpdate = KIOSK.on ? null : mountUpdate({ app });
if (ycUpdate) {
  startUpdateCheck(ycUpdate, app);
  mountAudioPicker({ app, update: ycUpdate });
}
// ---- BUX ここまで ----
// 初めての会話(7 歩)と性格の画面(S4)。#modes に「性格」「はじめての会話」を出す。?onboard=1 で初めての会話を出す。案内役は主役ノリー。
// 初めての訪問なら、入口を閉じた後に main.js が出す(gateClosed)。印の名前は S4 の DONE_KEY を使う
// 接客モードでは、作る画面・性格の画面は読み込まない(来場者に作る入口を出さない。開く関数ごと無い)
firstRunReady = KIOSK.on
  ? Promise.resolve(null)
  : import('./ui/onboarding/index.js')
      .then((m) => {
        if (typeof m.DONE_KEY === 'string' && m.DONE_KEY) firstRunDoneKey = m.DONE_KEY;
        return m.mountFirstRun({ app, buttonHost: $('modes'), guide: MAIN_CHARACTER });
      })
      .catch((err) => {
        console.warn('初めての会話を用意できませんでした:', err.message);
        return null;
      });

/* ---------- UW5(画面の見直し UIR 5・6・9・11・12・14・17・18): ここから下の 1 塊だけが UW5 ----------
   来場者の上の段は 3 つ(はなす・かえる・もっと。紫は「はなす」)。ヘッドセット・入口の LED・自動で始める画面・重さを測る時は今までの段のまま。
   開いたら(入口と はじめての会話が閉じたら)キャラが先に声をかけ、押すだけで話せる例を 2 つ出す。マイクのボタンは「はなす」、聞いている間は「きいているよ」。
   声の今日の分を使い切ったら「こえは おやすみ。もじで はなせるよ」。「あたまの なか」の見出しはキャラの名前で */
const UW5_CAMERA_FALLBACK = 'カメラが つかえなかったよ。カメラなしで はじめるね';
const UW5_VOICE_REST = 'こえは おやすみ。もじで はなせるよ';
const UW5_EXAMPLES = Object.freeze(['こんにちは!', 'なにが すき?']);
const UW5_LISTENING = 'きいているよ';
const UW5_TALK = 'はなす';
const UW5_SIMPLE = !(IS_HEADSET || ['led', 'autostart'].some((k) => params.get(k) === '1') || params.get('perf') === '1');
let uw5Greeted = false;
let uw5GreetWait = 0;
let uw5GreetForce = false;
let uw5Rested = false;

/** 上の段の「かえる」「もっと」を開く('change' | 'more')・閉じる(null)。開いた段はキャラの頭の線に数える(topGuard) */
function uw5SetTop(which) {
  if (!UW5_SIMPLE) return;
  const root = document.documentElement.classList;
  root.toggle('top-more', which === 'more');
  root.toggle('top-change', which === 'change');
  $('moreBtn')?.setAttribute('aria-expanded', String(which === 'more'));
  $('changeBtn')?.setAttribute('aria-expanded', String(which === 'change'));
  if (which !== 'more') {
    const drawer = $('memoryDrawer');
    if (drawer?.open) drawer.open = false;
    app.questLink?.close();
  }
  fitBottom(); // 字幕をしまう・戻す分も入れて、キャラを置き直す
}

/** 「あたまの なか」の見出し(UIR 18)。来場者の段では「(キャラの名前)の あたまの なか」 */
function uw5ThoughtLabel() {
  if (!UW5_SIMPLE) return;
  const name = app.character?.name ?? 'この子';
  const label = $('thoughtLabel');
  if (label) label.textContent = `${name}の あたまの なか`;
  $('thought')?.setAttribute('aria-label', `${name}の あたまの なか`);
}

/**
 * 押すだけで話せる例(UIR 5)。店のデータの質問が出ている時は出さない。話した後も出したまま(よくある質問と同じ。
 * 話した後に消すと下の帯が縮み、テレビ表示から戻った時にキャラの置き方が変わった)
 */
function uw5ShowExamples() {
  if (app.status?.shop?.available) return;
  ui.choices(UW5_EXAMPLES, (q) => {
    speaker.unlock();
    void talk({ text: q, mode: 'text' });
  });
  $('choices')?.classList.add('yc-examples');
}

/** 開いたら、キャラが先に声をかける(入口と はじめての会話が閉じた後に 1 回。?auto=0 では声をかけない) */
function uw5GreetOnOpen() {
  const root = document.documentElement.classList;
  if (uw5Greeted || root.contains('gate-up') || root.contains('fr-open') || !app.source || !UW5_SIMPLE) return;
  // 初めての訪問は、はじめての会話の札があいさつをする(札の前に字幕でも話すと 2 つ同時に出て、声も重なった。UW5r 高 1)。
  // 札が閉じて(しるしが残る)から、この関数がもう一度呼ばれて声をかける
  if (firstRunWanted() && !uw5GreetForce) {
    // 札が出なかった(読み込めない等)時だけ、2 秒後に自分で声をかける
    if (!uw5GreetWait) uw5GreetWait = setTimeout(() => { uw5GreetForce = true; uw5GreetOnOpen(); }, 2000);
    return;
  }
  clearTimeout(uw5GreetWait);
  uw5Greeted = true;
  uw5ShowExamples();
  if (!app.autoGreet || dialogue.busy || speaker.speaking || performance.now() / 1000 - presence.lastTalkAt < GREET_QUIET_S) {
    waitBubble.end(); // 声かけをしない回(もう話している・はじめての会話の後など)に、「…」だけ残さない
    return;
  }
  void talk({ trigger: 'approach', mode: 'text' });
}

/** マイクのボタンと上の「はなす」の言葉(UIR 17): 聞いている間は「きいているよ」 */
function uw5SyncTalkLabels() {
  const on = $('micBtn')?.getAttribute('aria-pressed') === 'true';
  const label = $('micLabel');
  if (label) label.textContent = on ? UW5_LISTENING : UW5_TALK;
  const top = $('talkBtn');
  if (top) {
    top.textContent = on ? UW5_LISTENING : UW5_TALK;
    top.classList.toggle('hearing', on);
  }
}

/** 上の「はなす」: マイクが使える時はマイクのボタンと同じ。使えない時は文字の欄へ */
function uw5Talk() {
  uw5SetTop(null);
  const mic = $('micBtn');
  if (mic && !mic.disabled && window.isSecureContext && navigator.mediaDevices) {
    mic.click();
    return;
  }
  $('textInput')?.focus();
}

/** 声の今日の分を使い切った時の 1 回の知らせ(UIR 6)。残りの字数の札は「もっと」の中の「おうちの人へ」だけ */
function uw5VoiceRest(ttsOk, s) {
  const out = Boolean(s?.tts) && (Number(s.tts.remainingToday) <= 0 || /cap|limit|上限|429/i.test(String(speaker.ttsError ?? '')));
  if (out && !uw5Rested) ui.notice(UW5_VOICE_REST);
  uw5Rested = out;
  return ttsOk;
}

(function uw5Setup() {
  if (!UW5_SIMPLE) return;
  document.documentElement.classList.add('top-simple');
  const nav = $('topMain');
  if (nav) nav.hidden = false;
  const grown = $('grownUp');
  if (grown) grown.hidden = false;
  $('talkBtn')?.addEventListener('click', uw5Talk);
  $('changeBtn')?.addEventListener('click', () => uw5SetTop(document.documentElement.classList.contains('top-change') ? null : 'change'));
  $('moreBtn')?.addEventListener('click', () => uw5SetTop(document.documentElement.classList.contains('top-more') ? null : 'more'));
  // 「かえる」の中で子を選ぶ・性格を開く(#modes のボタン)と、段を閉じる。見た目としつかんは、くらべられるように開いたまま(キャラは段の下に見えている)
  $('modes')?.addEventListener('click', (e) => e.target.closest('button') && setTimeout(() => uw5SetTop(null), 0));
  // Escape でも段を閉じる(ほかの窓が開いている時は、その窓が先に閉じる)
  document.addEventListener('keydown', (e) => {
    // いちばん上の層だけを閉じる: Quest の箱(箱の Escape が先に閉じて入口へ戻す)→ 覚えていること → 上の段(開いたボタンへ戻す)
    if (e.key !== 'Escape' || e.defaultPrevented || app.questLink?.isOpen) return;
    const root = document.documentElement.classList;
    if (!(root.contains('top-more') || root.contains('top-change')) || openSheets().length || app.shitsukan?.box?.isOpen?.()) return;
    const drawer = $('memoryDrawer');
    if (drawer?.open) {
      drawer.open = false;
      drawer.querySelector('summary')?.focus({ preventScroll: true });
      return;
    }
    const opener = $(root.contains('top-more') ? 'moreBtn' : 'changeBtn');
    uw5SetTop(null);
    opener?.focus({ preventScroll: true });
  });
  const mic = $('micBtn');
  if (mic) new MutationObserver(uw5SyncTalkLabels).observe(mic, { attributes: true, attributeFilter: ['aria-pressed'] });
  uw5SyncTalkLabels();
  new MutationObserver(() => {
    if (document.documentElement.classList.contains('fr-open')) waitBubble.end(); // CU: はじめての会話の札が開いたら、字幕の場所の「…」は札の中の「…」に替わる
    uw5GreetOnOpen();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  // キャラの名前が分かったら見出しを入れる(起動の後に 1 回。替わるたびは swapCharacter)
  const nameWait = setInterval(() => {
    if (!app.character) return;
    clearInterval(nameWait);
    uw5ThoughtLabel();
  }, 200);
})();
/* ---------- UW5 ここまで ---------- */
