// 初めての会話(7 歩)と性格の画面を、会話の画面に付ける入口。main.js(S5)に 1 行で付ける:
//   import('./ui/onboarding/index.js').then((m) => m.mountFirstRun({ app, buttonHost: $('modes'), guide: MAIN_CHARACTER }));
// - 案内役(guide)の既定は主役 MAIN_CHARACTER。主役の決まりは web/src/character/defaults.js(S5)の 1 か所だけに置き、ここでは写さない
// - 「性格」と「はじめての会話」のボタンを buttonHost に足す(無ければ右上に浮かべる)
// - ?onboard=1 で初めての会話を出す。auto: true なら、この端末で初めての時も出す(既定は出さない。ほかの試験を邪魔しない)
// - 性格の設定は、キャラの id ごとに、この端末の中に覚える。会話の頭脳に渡す人格の文(app.persona)に足す
// - おまかせ(初めの性格・もう一度ひく・性格の画面のおまかせ)は、人格の文で話し方が決まっている子(主役を含む)には
//   語尾も口調も足さない(口調は「この子の話し方」)。11/7 の録画で、主役が「ノリーと申しマスぽよ」になったため
// - 声の鍵(BYOK)の部品は、会話の流れ(S3)の物を byok で受け取る。無ければ 7 歩目は「まだつながっていない」と正直に言う
// - 作る道: 既定は見本の道。URL の # に yc-make=<PC の作る道のサーバー>&yc-key=<合言葉> があれば(PC の serve_review.py --make の
//   /qr の画面のリンク)、1〜3 歩を本当の作る道にする(言葉か絵 → PC のゆるキャラチェック → 段 0 の絵 → C0)。入力と絵は PC が配る
//   作る画面(枠)の中だけで扱い、この画面は枠からの知らせだけを受ける。合言葉は # の後ろなので会話の画面のサーバーには送られない。
//   読んだらこのタブの中だけに覚え(sessionStorage)、アドレスの欄から消す
import { FirstRun } from './script.js';
import { createSheet } from './view.js';
import { createVoice, crawl } from './voice.js';
import { createLocalCreator, createSampleCreator, isLocalBase } from './creators.js';
import { injectStyles } from './styles.js';
import { openPersonaPanel } from '../persona/panel.js';
import { composePersona, loadSettings, normalize, ownSpeechFor, randomSettings, saveSettings } from '../persona/settings.js';
import { MOCK_NOTICE_SHORT, styleLines } from '../persona/preview.js';
import { streamChat } from '../../conversation/brainClient.js';
// 主役で案内役(協力者が手で描いた、セスジキノボリカンガルーの執事見習い。自分のことは「ノリ」と呼ぶ)。three を読まない小さな部品
import { MAIN_CHARACTER } from '../../character/defaults.js';

export const DONE_KEY = 'yc.onboarded.v1';
export const RESUME_KEY = 'yc.onboarding.resume.v1';
export const MAKE_KEY = 'yc.make.v1';
const TALK_TIMEOUT_MS = 20000;

function storageOf(kind) {
  try {
    const s = globalThis[kind];
    s.setItem('__yc_probe', '1');
    s.removeItem('__yc_probe');
    return s;
  } catch {
    return null; // 内緒のウインドウなど。覚えられないだけで、画面は動く
  }
}

/**
 * 作る道のサーバーの場所と合言葉を、URL の # から読む(読んだら # を消し、このタブの中だけに覚える)。無ければ覚えた物。
 * 手元の場所(isLocalBase)でなければ使わない(よその場所へ絵と合言葉を送らない)。
 * @returns {{base:string, key:string}|null}
 */
export function readLocalMake({ loc = globalThis.location, session = null, history = globalThis.history } = {}) {
  let found = null;
  const hash = String(loc?.hash ?? '').replace(/^#/, '');
  if (hash) {
    const h = new URLSearchParams(hash);
    const base = h.get('yc-make');
    const key = h.get('yc-key');
    if (base || key) {
      if (base && key && isLocalBase(base) && key.length <= 128) found = { base: base.replace(/\/$/, ''), key };
      try {
        history?.replaceState?.(history.state, '', `${loc.pathname}${loc.search}`); // 合言葉をアドレスの欄と履歴に残さない
      } catch {
        // 消せなくても続ける
      }
      if (found) session?.setItem(MAKE_KEY, JSON.stringify(found));
    }
  }
  if (!found) {
    try {
      const s = JSON.parse(session?.getItem(MAKE_KEY) ?? 'null');
      if (s && isLocalBase(s.base) && s.key) found = { base: s.base, key: s.key };
    } catch {
      found = null;
    }
  }
  return found;
}

/**
 * @param {object} [o]
 * @param {object} [o.app] main.js の app(character・persona・status・speaker)。無くても動く(試しの画面)
 * @param {URLSearchParams} [o.params]
 * @param {HTMLElement} [o.buttonHost] 「性格」ボタンを置く所(main.js の #modes)
 * @param {boolean} [o.auto] 初めての端末で、自動で初めての会話を出すか
 * @param {object|'auto'} [o.byok] 使う人の鍵の部品。'auto'(既定)は、舞台の読み上げがあれば S3 の部品を読む(s3voice.js)
 * @param {object} [o.creator] 作る道(既定は見本の道)
 * @param {(made:object)=>Promise<boolean>} [o.showCharacter] できた子を舞台に出す(既定は ?character= で読み込み直す)
 */
export function mountFirstRun({
  app = globalThis.__app ?? null,
  params = new URLSearchParams(globalThis.location?.search ?? ''),
  buttonHost = null,
  auto = false,
  guide = MAIN_CHARACTER,
  byok = 'auto',
  creator = null,
  showCharacter = null,
  parent = document.body,
  random = Math.random,
} = {}) {
  injectStyles(document);
  const local = storageOf('localStorage');
  const session = storageOf('sessionStorage');
  const localMake = creator ? null : readLocalMake({ session });
  const voice = createVoice({ app, byok: byok === 'auto' ? null : byok });
  // 声の鍵の部品: 'auto'(既定)なら、舞台の読み上げがあるときに、会話の流れ(S3)の部品を読む。読めなければ鍵は入れられない
  const byokReady =
    byok === 'auto' && app?.speaker
      ? import('./s3voice.js').then(
          (m) => voice.setByok(m.createByok({ app })),
          () => null,
        )
      : Promise.resolve();
  // 見本の道の絵の入口は、主役が舞台に出せるときだけ主役にする(舞台が無い試しの画面では出せるとみなす)。通信はしない
  const mainOnStage = async (id) => !app || app.characterId === id || app.character?.id === id;
  const made = creator ?? (localMake ? createLocalCreator(localMake) : createSampleCreator({ main: guide, exists: mainOnStage }));
  const stageId = () => params.get('character') ?? params.get('char') ?? app?.character?.id ?? null;
  let basePersona = null; // persona.md の文(main.js が読んだ物)。足す前の元
  let stopListen = null;
  let engine = null;
  let sheet = null;
  let pendingNav = null;

  const guideName = () => (app?.character?.id === guide.id && app.character.name) || guide.name;
  /**
   * その子の話し方が人格の文で決まっているか。決まっていれば、おまかせは語尾も口調も足さない(口調は「この子の話し方」)。
   * 舞台の子は persona.md の文で見る。主役は、人格の文がまだ届いていない時も決まっているとみなす(主役の決まりは defaults.js)
   */
  const ownSpeechOf = (id) => ownSpeechFor(id, { persona: id && id === stageId() ? (basePersona ?? app?.persona ?? '') : '', mainId: MAIN_CHARACTER.id });
  const randomFor = (id) => randomSettings(random, { ownSpeech: ownSpeechOf(id) });
  const personaStore = {
    get: (id) => loadSettings(local, id),
    set: (id, s) => saveSettings(local, id, s),
    random: (character) => randomFor(character?.id ?? stageId()),
  };

  /** 舞台のキャラなら、頭脳に渡す人格の文(app.persona)に設定を足す */
  function applyPersona(settings, character = null) {
    if (!app || !settings) return;
    const id = character?.id ?? stageId();
    if (id !== stageId()) return;
    if (basePersona === null) basePersona = app.persona ?? '';
    app.persona = composePersona(basePersona, settings);
    app.personaSettings = normalize(settings);
  }

  // main.js がキャラと persona.md を読み終えたら、覚えている設定を足す(読み込みは非同期なので、少し待つ)
  if (app) {
    let waited = 0;
    const wait = setInterval(() => {
      waited += 1;
      if (app.character || waited > 200) {
        clearInterval(wait);
        const id = stageId();
        const saved = id ? loadSettings(local, id) : null;
        if (saved) applyPersona(saved);
      }
    }, 300);
  }

  /** 頭脳に 1 回話しかける(仮の頭脳でも本物でも同じ道。/api/chat) */
  async function talk(text, { character, settings, history = [] }) {
    const base = character?.id && character.id === stageId() ? (basePersona ?? app?.persona ?? '') : '';
    const persona = settings ? composePersona(base, settings) : base;
    const lines = [];
    let brain = 'unknown';
    let safety = null;
    let notice = null;
    let error = null; // streamChat は、受け手の中の例外を飲み込むので、ここで覚えて後で投げる
    await streamChat(
      {
        text,
        history,
        trigger: null,
        scene: '',
        character: { name: character?.name ?? 'ゆるキャラ', persona },
        place: {},
        ...(app?.character?.expressions?.length ? { expressions: app.character.expressions } : {}),
      },
      (ev) => {
        if (ev.type === 'meta') {
          if (ev.brain) brain = ev.brain;
          if (ev.safety) safety = ev.safety;
          if (ev.notice) notice = ev.notice;
        }
        if (ev.type === 'say') lines.push({ text: ev.text, expression: ev.expression, motion: ev.motion });
        if (ev.type === 'error') error = ev.message ?? '頭脳のエラー';
      },
      AbortSignal.timeout(TALK_TIMEOUT_MS),
    );
    if (error && !lines.length) throw new Error(error);
    return { lines, brain, safety, notice };
  }

  /** 性格の画面の「返事を試す」 */
  async function previewReply(character, settings, text) {
    const r = await talk(text, { character, settings, history: [] });
    const raw = r.lines.map((l) => l.text);
    if (r.brain === 'mock' && !r.safety) return { text: styleLines(raw, settings).join(''), brain: 'mock', notice: r.notice ?? MOCK_NOTICE_SHORT };
    return { text: raw.join(''), brain: r.brain, notice: r.notice ?? (r.brain === 'haiku' ? 'Claude Haiku の返事です。' : '') };
  }

  /** 文を出す(本物の声があれば声で、無ければ文字送りとレトロな音) */
  async function play(text, settings, target) {
    if (voice.realVoice(settings?.voice?.provider)) {
      target.textContent = text;
      await voice.speak(text, settings);
      return;
    }
    await crawl(target, text, { cps: 24 * (settings?.voice?.rate ?? 1), onChar: () => voice.blipper.blip({ pitch: settings?.voice?.pitch ?? 1 }) });
  }

  function brainNow() {
    return app?.status?.brain === 'haiku' ? 'haiku' : lastBrain;
  }
  let lastBrain = 'mock';

  function openPersona({ character = null, initial = null, onSave = () => {}, onCancel = () => {} } = {}) {
    voice.unlock();
    const ch = character ?? { id: stageId() ?? 'unknown', name: app?.character?.name ?? 'この子' };
    const start = initial ?? loadSettings(local, ch.id) ?? randomFor(ch.id);
    return openPersonaPanel({
      initial: start,
      characterName: ch.name,
      random: () => randomFor(ch.id),
      preview: async (s, text) => {
        const r = await previewReply(ch, s, text);
        lastBrain = r.brain === 'haiku' ? 'haiku' : 'mock';
        return r;
      },
      play,
      brain: brainNow,
      parent,
      onSave: (s) => {
        saveSettings(local, ch.id, s);
        applyPersona(s, ch);
        onSave(s);
      },
      onCancel,
    });
  }

  async function defaultShow(c) {
    if (!app || !c?.id || c.id === stageId()) return true; // 舞台が無い(試しの画面)か、もう出ている
    if (c.local) return true; // 手元で描いたばかりの子は、まだ形(3D)が無い。舞台は案内役のまま、絵で話す
    const url = new URL(location.href);
    url.searchParams.set('character', c.id);
    url.searchParams.delete('char');
    url.searchParams.set('onboard', '1');
    pendingNav = url.href;
    return false; // 続きは読み込み直しの後(save で状態を残してから移る)
  }

  /**
   * スマホでは札が画面の下の半分ほどを隠すので、舞台(app.stage)の「下の余白」を札の高さにして、キャラを札の上に収める。
   * 閉じたら元の余白に戻す。舞台の形が違う・PC(札は右下)・AR/VR の間は何もしない。
   */
  let savedInset = null;
  function fitStage(open) {
    const st = app?.stage;
    if (!st?.state || typeof st.frameCharacter !== 'function' || !app.character || st.state.immersive) return;
    if (open && (window.innerWidth >= 720 || !sheet || sheet.closed)) return;
    if (open) {
      if (savedInset === null) savedInset = st.state.bottomInset ?? 0;
      st.state.bottomInset = Math.max(savedInset, sheet.element.offsetHeight + 8);
    } else if (savedInset !== null) {
      st.state.bottomInset = savedInset;
      savedInset = null;
    } else return;
    try {
      st.frameCharacter(app.character, st.state.view, st.state.obstacles);
    } catch {
      // 見せ方を取り直せなくても、会話は続ける
    }
  }

  function startOnboarding({ resume = null } = {}) {
    if (sheet && !sheet.closed) return engine;
    let finishTimer = null;
    let sizeWatch = null;
    sheet = createSheet({
      guideName: guideName(),
      voice,
      parent,
      onAct: (id, payload) => engine.act(id, payload),
      openPersona: (onSave) => openPersona({ character: engine.character, initial: engine.settings, onSave }),
      stage: () => (app?.character ? { character: app.character, speaker: app.speaker, guideId: guide.id } : null),
      onClose: (reason) => {
        clearTimeout(finishTimer);
        sizeWatch?.disconnect();
        document.documentElement.classList.remove('fr-open');
        fitStage(false);
        if (reason === 'later') local?.setItem(DONE_KEY, 'later');
      },
    });
    document.documentElement.classList.add('fr-open'); // 入口のゲートを消して、舞台のキャラを見せる(styles.js)
    if (typeof ResizeObserver === 'function') {
      sizeWatch = new ResizeObserver(() => fitStage(true));
      sizeWatch.observe(sheet.element);
    }
    engine = new FirstRun({
      guide: { id: guide.id, name: guideName() },
      creator: made,
      persona: personaStore,
      talk,
      voice,
      present: (lines, ctx) => sheet.present(lines, ctx),
      offer: (actions) => sheet.offer(actions),
      showCharacter: showCharacter ?? defaultShow,
      onPersona: (s, c) => applyPersona(s, c),
      onStep: (n, info) => sheet.setStep(n, info),
      save: (snap) => {
        session?.setItem(RESUME_KEY, JSON.stringify(snap));
        if (pendingNav) location.assign(pendingNav);
      },
      onDone: () => {
        local?.setItem(DONE_KEY, 'done');
        finishTimer = setTimeout(() => sheet.close('done'), 1600);
      },
    });
    api.engine = engine;
    api.sheet = sheet;
    stopListen?.();
    stopListen = typeof made.listen === 'function' ? made.listen((ev) => engine.makeEvent(ev)) : null; // 作る画面(枠)からの知らせ
    if (resume) engine.resume(resume);
    else engine.start();
    return engine;
  }

  // ---- ボタン ----
  const host = buttonHost ?? parent;
  const personaBtn = Object.assign(document.createElement('button'), { type: 'button', textContent: '性格', className: buttonHost ? 'place-mode-button fr-launch' : 'fr-launch floating' });
  personaBtn.dataset.firstrun = 'persona';
  personaBtn.addEventListener('click', () => openPersona());
  const startBtn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'はじめての会話', className: buttonHost ? 'place-mode-button fr-launch' : 'fr-launch floating' });
  startBtn.dataset.firstrun = 'start';
  startBtn.addEventListener('click', () => startOnboarding());
  if (buttonHost) host.append(personaBtn, startBtn);
  else {
    startBtn.style.right = '84px';
    host.append(personaBtn, startBtn);
  }

  const api = { engine: null, sheet: null, voice, byokReady, creator: made, start: startOnboarding, openPersona, applyPersona, talk };

  // ---- 出すかどうか ----
  const kiosk = ['led', 'autostart', 'headset'].some((k) => params.get(k) === '1');
  const wanted = params.get('onboard');
  let snap = null;
  try {
    snap = JSON.parse(session?.getItem(RESUME_KEY) ?? 'null');
  } catch {
    snap = null;
  }
  session?.removeItem(RESUME_KEY);
  if (wanted === '1') startOnboarding({ resume: snap });
  else if (wanted !== '0' && auto && !kiosk && !local?.getItem(DONE_KEY)) startOnboarding();

  globalThis.__firstRun = api; // 試験と開発の確かめ用(main.js の window.__app と同じ考え)
  return api;
}
