// 初めての会話(7 歩)と性格の画面を、会話の画面に付ける入口。main.js(S5)に 1 行で付ける:
//   import('./ui/onboarding/index.js').then((m) => m.mountFirstRun({ app, buttonHost: $('modes'), guide: MAIN_CHARACTER }));
// - 案内役(guide)の既定は主役 MAIN_CHARACTER。主役の決まりは web/src/character/defaults.js(S5)の 1 か所だけに置き、ここでは写さない
// - 「性格」と「はじめての会話」のボタンを buttonHost に足す(無ければ右上に浮かべる)
// - ?onboard=1 で初めての会話を出す。auto: true なら、この端末で初めての時も出す(既定は出さない。ほかの試験を邪魔しない)
// - 性格の設定は、キャラの id ごとに、この端末の中に覚える。会話の頭脳に渡す人格の文(app.persona)に足す
// - おまかせ(初めの性格・もう一度ひく・性格の画面のおまかせ)は、人格の文で話し方が決まっている子(主役を含む)には
//   語尾も口調も足さない(口調は「この子の話し方」)。11/7 の録画で、主役が「ノリーと申しマスぽよ」になったため
// - 性格の画面は、覚えた設定か、その子の人格の文に書いてある性格で開く(くじ引きにしない)。話し方の決まった子は口調の列を止める(D6)
// - 声の鍵(BYOK)の部品は、会話の流れ(S3)の物を byok で受け取る。無ければ 7 歩目は「まだつながっていない」と正直に言う
// - 舞台: 見本の子を出す時も、7 歩の途中で画面を読み込み直さない(その場で入れ替える。札の説明が消えないように。D2)。
//   終わり・あとでの時は、舞台を主役に戻し、アドレスから onboard=1 を消し、入口(ゲート)を出し直さない(D4)
// - 作る道: 既定は見本の道。この画面を「この PC の中」(127.0.0.1・localhost)で開いた時だけ、URL の # の
//   yc-make=<この PC の作る道のサーバー>&yc-key=<合言葉>(PC の serve_review.py --make の /qr の画面のリンク)を読み、
//   1〜3 歩を本当の作る道にする(言葉か絵 → PC のゆるキャラチェック → 絵 → この子にする・直したい)。入力と絵は PC が配る
//   作る画面(枠)の中だけで扱い、この画面は枠からの知らせだけを受ける。合言葉は # の後ろなので会話の画面のサーバーには送られない。
//   読んだらこのタブの中だけに覚え(sessionStorage)、アドレスの欄から消す。公開の URL・*.ts.net では読まない(CRITsec F4)
import { FirstRun } from './script.js';
import { createSheet } from './view.js';
import { createVoice, crawl } from './voice.js';
import { createLocalCreator, createSampleCreator, isLocalBase, pageIsLocal } from './creators.js';
import { injectStyles } from './styles.js';
import { openPersonaPanel } from '../persona/panel.js';
import { composePersona, fixesOwnSpeech, loadSettings, normalize, ownSettings, ownSpeechFor, personalityOf, randomSettings, saveSettings } from '../persona/settings.js';
import { MOCK_NOTICE_SHORT, styleLines } from '../persona/preview.js';
import { streamChat } from '../../conversation/brainClient.js';
// 主役で案内役(協力者が手で描いた、セスジキノボリカンガルーの執事見習い。自分のことは「ノリ」と呼ぶ)。three を読まない小さな部品
import { MAIN_CHARACTER } from '../../character/defaults.js';

export const DONE_KEY = 'yc.onboarded.v1';
export const RESUME_KEY = 'yc.onboarding.resume.v1';
export const MAKE_KEY = 'yc.make.v1';
export const CLOSED_EVENT = 'yc:firstrun-closed'; // 閉じた時に window へ投げる(detail.reason = done | later)。S5 が使ってよい
const TALK_TIMEOUT_MS = 20000;
const STAGE_WAIT_MS = 15000; // 舞台のキャラが読み終わるのを待つ長さ(入れ替えの前)
const GATE_HOLD_MS = 3000; // 閉じた後、入口を消しておく長さ(カメラなしの入力が始まるまで。始まれば入口は main.js が隠す)

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
 * この画面そのものが、この PC の中(127.0.0.1・localhost)で開かれている時だけ読む。公開の URL や *.ts.net では、
 * # に作る道があっても使わずに消す(細工したリンクで、よその作る画面を公式の画面の中に出させない。CRITsec F4)。
 * サーバーの場所も、この PC の中だけ(isLocalBase)。
 * @returns {{base:string, key:string}|null}
 */
export function readLocalMake({ loc = globalThis.location, session = null, history = globalThis.history } = {}) {
  const here = pageIsLocal(loc);
  let found = null;
  const hash = String(loc?.hash ?? '').replace(/^#/, '');
  if (hash) {
    const h = new URLSearchParams(hash);
    const base = h.get('yc-make');
    const key = h.get('yc-key');
    if (base || key) {
      if (here && base && key && isLocalBase(base) && key.length <= 128) found = { base: base.replace(/\/$/, ''), key };
      try {
        history?.replaceState?.(history.state, '', `${loc.pathname}${loc.search}`); // 合言葉をアドレスの欄と履歴に残さない
      } catch {
        // 消せなくても続ける
      }
      if (found) session?.setItem(MAKE_KEY, JSON.stringify(found));
    }
  }
  if (!found && here) {
    try {
      const s = JSON.parse(session?.getItem(MAKE_KEY) ?? 'null');
      if (s && isLocalBase(s.base) && s.key) found = { base: s.base, key: s.key };
    } catch {
      found = null;
    }
  }
  return found;
}

/** README の作り方の節(index.html の <link rel="help">)。画面のコードには外の住所を書かない(privacy の試験)ので、頁から読む */
export function readGuideUrl(doc = globalThis.document) {
  try {
    const href = doc?.querySelector?.('link[rel="help"][href]')?.href ?? '';
    return href && new URL(href).protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} [o]
 * @param {object} [o.app] main.js の app(character・persona・status・speaker・stage・dialogue)。無くても動く(試しの画面)
 * @param {URLSearchParams} [o.params]
 * @param {HTMLElement} [o.buttonHost] 「性格」ボタンを置く所(main.js の #modes)
 * @param {boolean} [o.auto] 初めての端末で、自動で初めての会話を出すか
 * @param {object|'auto'} [o.byok] 使う人の鍵の部品。'auto'(既定)は、舞台の読み上げがあれば S3 の部品を読む(s3voice.js)
 * @param {object} [o.creator] 作る道(既定は見本の道)
 * @param {(made:object)=>Promise<boolean>} [o.showCharacter] できた子を舞台に出す(既定は、その場で入れ替える)
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
  const root = document.documentElement;
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
  const made = creator ?? (localMake ? createLocalCreator(localMake) : createSampleCreator({ main: guide }));
  // 舞台の子の id。入れ替えた後は app.characterId(main.js と同じ欄)が正
  const stageId = () => app?.characterId ?? app?.character?.id ?? params.get('character') ?? params.get('char') ?? null;
  let stopListen = null;
  let engine = null;
  let sheet = null;
  let pendingNav = null;

  const guideName = () => (app?.character?.id === guide.id && app.character.name) || guide.name;

  /* ---------- 人格の文(キャラごとの、設定を足す前の元) ---------- */
  const rawPersonas = new Map();
  /** その子の persona.md の文(設定を足す前)。舞台の子なら main.js が読んだ物、入れ替えた子なら読んだ物 */
  function rawPersona(id) {
    if (!id) return '';
    if (rawPersonas.has(id)) return rawPersonas.get(id);
    if (app && id === stageId()) {
      const t = app.persona ?? '';
      if (t) rawPersonas.set(id, t); // 空はまだ届いていないかもしれないので覚えない
      return t;
    }
    return '';
  }

  /**
   * その子の話し方が人格の文で決まっているか。決まっていれば、おまかせは語尾も口調も足さない(口調は「この子の話し方」)。
   * 主役は人格の文がまだ届いていない時も決まっているとみなす(主役の決まりは defaults.js)。見本の子は、どれも persona.md に
   * 話し方が書いてある(人格の文が読めない時もそうみなす。試験 onboarding_stage が全部の見本の persona.md を見る)
   */
  const ownSpeechOf = (id, character = null) => Boolean(character?.sample) || ownSpeechFor(id, { persona: rawPersona(id), mainId: MAIN_CHARACTER.id });
  const randomFor = (id, character = null) => randomSettings(random, { ownSpeech: ownSpeechOf(id, character) });
  /** その子の人格の文に書いてある性格(書いていなければ null。4 歩目はおまかせにする) */
  const initialFor = (character) => {
    const id = character?.id ?? stageId();
    const text = rawPersona(id);
    return personalityOf(text) ? ownSettings(text, { ownSpeech: ownSpeechOf(id, character) }) : null;
  };
  const personaStore = {
    get: (id) => loadSettings(local, id),
    set: (id, s) => saveSettings(local, id, s),
    random: (character) => randomFor(character?.id ?? stageId(), character),
    initial: (character) => initialFor(character),
  };

  /** 舞台のキャラなら、頭脳に渡す人格の文(app.persona)に設定を足す */
  function applyPersona(settings, character = null) {
    if (!app || !settings) return;
    const id = character?.id ?? stageId();
    if (id !== stageId()) return;
    const base = rawPersona(id);
    rawPersonas.set(id, base);
    app.persona = composePersona(base, settings);
    app.personaSettings = normalize(settings);
  }

  // main.js がキャラと persona.md を読み終えたら、覚えている設定を足す(読み込みは非同期なので、人格の文が届くまで少し待つ)
  if (app) {
    let waited = 0;
    const wait = setInterval(() => {
      waited += 1;
      if ((app.character && (app.persona || waited > 20)) || waited > 200) {
        clearInterval(wait);
        const id = stageId();
        const saved = id ? loadSettings(local, id) : null;
        if (saved) applyPersona(saved);
      }
    }, 300);
  }

  /* ---------- 舞台(その場で入れ替える。D2・D4) ---------- */
  let home = null; // 初めて入れ替える前の舞台 { character, id }(主役に戻す時、同じ物を戻す。見た目の切り替えの控えが合うまま)

  /** 舞台のキャラが読み終わるまで待つ(読み込みの途中に入れ替えると、2 体が並ぶ) */
  async function whenStageReady() {
    const start = Date.now();
    while (app && !(app.character && app.stage) && Date.now() - start < STAGE_WAIT_MS) await new Promise((r) => setTimeout(r, 150));
    return Boolean(app?.character && app?.stage);
  }

  /** 読んだキャラを舞台に入れる。main.js の swapCharacter があれば、それを使う(位置・向き・会話はそのまま) */
  function swapIn(next) {
    if (typeof app.swapCharacter === 'function') return app.swapCharacter(next);
    const prev = app.character;
    const st = app.stage;
    if (app.place?.loaded) app.place.loaded.placeCharacter(next.object3d);
    else if (prev) {
      next.object3d.position.copy(prev.object3d.position);
      next.object3d.quaternion.copy(prev.object3d.quaternion);
    }
    if (prev) st.scene.remove(prev.object3d);
    st.scene.add(next.object3d);
    app.character = next;
    if (app.dialogue) app.dialogue.character = next;
    root.dataset.look = next.look ?? '3d';
    const view = params.get('view') ?? (next.kind === 'vrm' ? 'bust' : 'full');
    st.frameCharacter(next, view === 'full' ? 'full' : 'bust', app.place?.loaded?.object3d);
    return undefined;
  }

  /**
   * 舞台に id の子を出す(読み込み直さない)。AR・VR の間は替えない(位置合わせと舞台がキャラを持っている)。
   * 人格の文は main.js の readPersona があれば読む(無ければ空。S4 のファイルからは変数の宛先へ fetch しない: privacy の試験)
   * @returns {Promise<boolean>} 舞台がその子になったか
   */
  let stageQueue = Promise.resolve();
  function putOnStage(id) {
    const run = stageQueue.then(() => putNow(id)); // 1 つずつ(主役を呼ぶ途中に見本を選んでも、2 体が並ばない)
    stageQueue = run.catch(() => null);
    return run;
  }
  async function putNow(id) {
    if (!app || !id || !(await whenStageReady())) return false;
    if (stageId() === id) return true;
    if (app.stage.state?.immersive || (app.modes && app.modes.mode && app.modes.mode !== 'screen')) return false;
    if (!home) {
      home = { character: app.character, id: stageId() };
      rawPersona(home.id); // 主役の persona.md の文を覚えておく(戻した時に、人格の文を失わないように。S4 からは読み直せない)
    }
    let next;
    if (id === home.id) next = home.character;
    else {
      const mod = await import('../../character/index.js');
      next = await mod.loadCharacter(mod.characterUrl(id), { ...(app.tierOverrides ?? {}) });
    }
    swapIn(next);
    app.characterId = id;
    let text = rawPersonas.get(id);
    if (text === undefined) {
      text = typeof app.readPersona === 'function' ? String((await app.readPersona(next).catch(() => '')) ?? '') : '';
      rawPersonas.set(id, text);
    }
    const saved = loadSettings(local, id);
    app.persona = saved ? composePersona(text, saved) : text;
    app.personaSettings = saved ? normalize(saved) : null;
    try {
      app.speaker?.setVoice?.({ seed: next.name ?? id });
    } catch {
      // 声の高さを替えられなくても続ける
    }
    root.classList.toggle('fr-guest', id !== home.id); // 見本の子がいる間は、見た目の切り替え(主役の控え)を隠す
    return true;
  }

  /** できた子を舞台に出す(既定)。その場で入れ替えて、続きはそのまま(読み込み直さない) */
  async function defaultShow(c) {
    if (!app || !c?.id) return true; // 舞台が無い(試しの画面)
    if (c.local) return true; // 手元で描いたばかりの子は、まだ形(3D)が無い。舞台は案内役のまま、描いた絵を札に出す(D5)
    try {
      const ok = await putOnStage(c.id);
      if (!ok && stageId() !== c.id) await sheet?.present([{ who: 'note', text: `${c.name}は、いま舞台に出せません。札の中で続けます。` }], {});
    } catch (err) {
      console.warn('見本の子を舞台に出せませんでした:', err?.message ?? err);
      await sheet?.present([{ who: 'note', text: `${c.name}を舞台に出せませんでした。札の中で続けます。` }], {});
    }
    return true;
  }

  /** 閉じた時: 舞台を主役に戻し、アドレスから onboard=1(と主役でない ?character=)を消し、入口を出し直さない(D4) */
  async function afterClose(reason) {
    try {
      if (app && (await whenStageReady()) && stageId() !== guide.id) await putOnStage(guide.id);
    } catch (err) {
      console.warn('舞台を主役に戻せませんでした:', err?.message ?? err);
    }
    if (stageId() === guide.id || !app) root.classList.remove('fr-guest');
    try {
      const url = new URL(location.href);
      url.searchParams.delete('onboard');
      const asked = url.searchParams.get('character') ?? url.searchParams.get('char');
      if (asked && asked !== guide.id && stageId() === guide.id) {
        url.searchParams.delete('character');
        url.searchParams.delete('char');
      }
      if (url.href !== location.href) history.replaceState(history.state, '', url.href); // 読み込み直しても 7 歩を始めない
    } catch {
      // 消せなくても続ける
    }
    session?.removeItem(RESUME_KEY);
    globalThis.dispatchEvent?.(new CustomEvent(CLOSED_EVENT, { detail: { reason } }));
  }

  /** 入口(ゲート)がまだ出ていれば、カメラなしで始める(閉じた後に入口が戻ってこないように。D4)。始まれば main.js が入口を隠す */
  function passGate() {
    const gate = document.getElementById('gate');
    if (!gate || gate.classList.contains('hidden')) return;
    root.classList.add('fr-after'); // 始まるまで入口を見せない(一瞬出て消えるのを防ぐ)
    const done = () => root.classList.remove('fr-after');
    const watch = typeof MutationObserver === 'function' ? new MutationObserver(() => gate.classList.contains('hidden') && (watch.disconnect(), done())) : null;
    watch?.observe(gate, { attributes: true, attributeFilter: ['class'] });
    setTimeout(() => {
      watch?.disconnect();
      done();
    }, GATE_HOLD_MS);
    const sim = document.getElementById('startSim');
    if (sim && !sim.disabled && !sim.hidden) sim.click();
  }

  /* ---------- 頭脳と声 ---------- */
  /** 頭脳に 1 回話しかける(仮の頭脳でも本物でも同じ道。/api/chat) */
  async function talk(text, { character, settings, history = [] }) {
    const base = character?.id && character.id === stageId() ? rawPersona(character.id) : '';
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

  /**
   * 性格の画面。覚えた設定 → その子の人格の文の性格、の順で開く(くじ引きにしない。D6)。
   * 話し方が人格の文で決まっている子(主役ノリーなど、話し方の手本の節がある子)は、口調の列を「この子の話し方」で止める。
   * 作例の見本の子は、口調を選べる(初めは「この子の話し方」)
   */
  function openPersona({ character = null, initial = null, onSave = () => {}, onCancel = () => {} } = {}) {
    voice.unlock();
    const ch = character ?? { id: stageId() ?? 'unknown', name: app?.character?.name ?? 'この子' };
    const own = ownSpeechOf(ch.id, ch);
    const start = initial ?? loadSettings(local, ch.id) ?? ownSettings(rawPersona(ch.id), { ownSpeech: own });
    return openPersonaPanel({
      initial: start,
      characterName: ch.name,
      lockTone: fixesOwnSpeech(ch.id, { persona: rawPersona(ch.id), mainId: MAIN_CHARACTER.id }),
      random: () => randomFor(ch.id, ch),
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
        if (reason === 'later') local?.setItem(DONE_KEY, 'later');
        passGate(); // 入口を消したまま(fr-after)にしてから、fr-open を外す
        root.classList.remove('fr-open');
        fitStage(false);
        void afterClose(reason);
      },
    });
    root.classList.add('fr-open'); // 入口のゲートを消して、舞台のキャラを見せる(styles.js)
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
      pin: (pic) => sheet.pin(pic),
      guideUrl: readGuideUrl(),
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
    // 案内役(主役)が舞台にいなければ、その場で呼ぶ(舞台と案内の文がずれないように。CRITux 6)
    if (app && !resume && !showCharacter) void whenStageReady().then((ok) => (ok && stageId() !== guide.id ? putOnStage(guide.id) : null)).catch(() => null);
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

  const api = { engine: null, sheet: null, voice, byokReady, creator: made, start: startOnboarding, openPersona, applyPersona, talk, putOnStage };

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
