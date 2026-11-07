// 初めての会話(7 歩)と性格の画面を、会話の画面に付ける入口。main.js(S5)に 1 行で付ける:
//   import('./ui/onboarding/index.js').then((m) => m.mountFirstRun({ app, buttonHost: $('modes'), guide: MAIN_CHARACTER }));
// - 案内役(guide)の既定は主役 MAIN_CHARACTER。主役の決まりは web/src/character/defaults.js(S5)の 1 か所だけに置き、ここでは写さない
// - ?character=<id> で開いた時は、舞台のその子が案内役(入口の「案内するのは〜」と同じ子。舞台を主役に替えない)。
//   閉じると舞台はその子に戻り、アドレスの ?character=<id> も残す(README の ?character=mikan が初めての訪問でも効く。CRITux2 高 1)
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
import { FirstRun, README_SECTION } from './script.js';
import { createSheet } from './view.js';
import { createVoice, crawl } from './voice.js';
import { createDrawCreator, createLocalCreator, createSampleCreator, isLocalBase, pageIsLocal, sampleName } from './creators.js';
import { injectStyles } from './styles.js';
import { openPersonaPanel } from '../persona/panel.js';
import { composePersona, fixesOwnSpeech, loadSettings, normalize, ownSettings, ownSpeechFor, personalityOf, randomSettings, saveSettings } from '../persona/settings.js';
import { MOCK_NOTICE_SHORT, styleLines } from '../persona/preview.js';
import { applyVoiceRole } from '../persona/voiceChoice.js';
import { streamChat } from '../../conversation/brainClient.js';
// 主役で案内役(協力者が手で描いた、セスジキノボリカンガルーの執事見習い。自分のことは「ノリー」と呼ぶ)。three を読まない小さな部品
import { MAIN_CHARACTER } from '../../character/defaults.js';
// ?character= の id の形(英小文字・数字・_ の 32 字まで。main.js と同じ決まり。three を読まない小さな部品)
import { isSpecId } from '../../character/urlSpec.js';

export const DONE_KEY = 'yc.onboarded.v1';
/** 作る入口のボタンの名前(UIR 16) */
export const START_LABEL = 'あたらしい子を つくる';
export const RESUME_KEY = 'yc.onboarding.resume.v1';
export const MAKE_KEY = 'yc.make.v1';
export const PROGRESS_KEY = 'yc.onboarding.progress.v1'; // 歩みごとの途中経過(この端末の中だけ。読み込み直しても続きから。高 1)
const PROGRESS_TTL_MS = 12 * 60 * 60 * 1000;
/** 残した途中経過(3 歩目以降で、子を決めた物か、言葉を入れて見本を待つ 3 歩目だけ。古い物・形の違う物は捨てる) */
export function readProgress(store, now = Date.now()) {
  try {
    const p = JSON.parse(store?.getItem(PROGRESS_KEY) ?? 'null');
    if (!p || p.v !== 1 || !(p.character?.id || (p.step === 3 && p.from === 'words' && p.words)) || !(p.step >= 3 && p.step <= 7) || !(now - (p.t ?? 0) < PROGRESS_TTL_MS)) return null;
    return { ...p, reload: true };
  } catch {
    return null;
  }
}
/** 舞台から捨てる見本の子の 3D の形と絵を、確実に捨てる(入れ替えのたびに GPU の物が積もらないように。高 1) */
export function freeCharacter(ch) {
  try {
    ch?.dispose?.();
    ch?.object3d?.traverse?.((o) => {
      o.geometry?.dispose?.();
      for (const m of [].concat(o.material ?? [])) {
        for (const v of Object.values(m ?? {})) if (v && v.isTexture) v.dispose?.();
        m?.dispose?.();
      }
    });
  } catch {
    // 捨てられなくても、会話は続ける
  }
}
export const CLOSED_EVENT = 'yc:firstrun-closed'; // 閉じた時に window へ投げる(detail.reason = done | later)。S5 が使ってよい
const TALK_TIMEOUT_MS = 20000;
const STAGE_WAIT_MS = 15000; // 舞台のキャラが読み終わるのを待つ長さ(入れ替えの前)
const GATE_HOLD_MS = 3000; // 閉じた後、入口を消しておく長さ(カメラなしの入力が始まるまで。始まれば入口は main.js が隠す)
// PC と iPad で札(右)が開いている間、舞台の絵を札の左に収める(幅の広い見本の右の端が札に隠れていた。CRITux2 低 13)。
// 札の左に残る幅がこれより狭い画面では、舞台を狭めない(iPad の縦 768 で 396px 残る)
const SIDE_MIN_STAGE_PX = 300;
/** 札を右の横に置く幅(これより狭いスマホは、下の札か重ねる形) */
const SIDE_MIN_WIDTH = 720;
/**
 * スマホの会話の形(11/8 本人「LINE のように」「キャラの上に重ねた方が見やすいかも」)。2 つとも作り、1 か所で切り替える:
 *   'sheet'   = キャラの下に会話の札(キャラは札の上に全身で立つ。舞台の絵を札の上だけにする)
 *   'overlay' = キャラの下の方に会話を重ねる(吹き出しの後ろは上へ向かって薄くなる。顔と上半身は見えたまま。押す札は不透明)
 * 既定は 'sheet'(390×670 の比べで、字の後ろにキャラの体が透けず読みやすく、キャラも全身が見えた。比べの絵は OL1 の札)。
 * URL の ?chat=overlay / ?chat=sheet で替えられる
 */
export const PHONE_LAYOUTS = ['sheet', 'overlay'];
export const DEFAULT_PHONE_LAYOUT = 'sheet';
/** 形 B で、キャラの立つ帯の下に空ける高さ(画面の高さに対する割合)。キャラの腰から下に吹き出しが重なる */
const OVERLAY_BOTTOM = 0.36;
/** 形 A で、札の上の舞台の絵の、いちばん下に空けるすき間(px) */
const SHEET_STAGE_GAP = 6;

/** スマホの会話の形を決める(?chat= があればそれ、無ければ既定) */
export function phoneLayout(params) {
  const asked = params?.get?.('chat');
  return PHONE_LAYOUTS.includes(asked) ? asked : DEFAULT_PHONE_LAYOUT;
}

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

/**
 * 日本語の README の作り方の節の見出しから、GitHub が付ける節の印(# の後ろ)。
 * 日本語の README は、第 9 波から README.md(S6。英語は README.en.md。前は README.ja.md)。
 * 見出しの文字は script.js の README_SECTION(S6 の README.md の見出しと同じ。試験 onboarding_readme_ja が見る)。
 * 名前の README_JA_FILE・README_JA_ANCHOR は前のまま(S6 の節の印の点検の道具が読む)
 */
export const README_JA_FILE = 'README.md';
export const README_JA_ANCHOR = githubSlug(README_SECTION);

/** GitHub の見出しの印の作り方(英字は小文字・記号を消す・空白は「-」。日本語の字はそのまま) */
export function githubSlug(heading) {
  return String(heading ?? '')
    .trim()
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/**
 * README の作り方の節(index.html の <link rel="help">)。画面のコードには外の住所を書かない(privacy の試験)ので、頁から読む。
 * 画面は日本語だけ(Q-0092 A)なので、日本語の README の節を開く(CRITux2 低 12):
 *   ① 頁に <link rel="help" hreflang="ja"> があれば、それ(S5 の index.html。印は S6 と合わせる)
 *   ② 無ければ、<link rel="help"> がリポジトリの入口(GitHub の /<持ち主>/<名前>)の時、同じリポジトリの README.md(日本語)の節にする
 *   ③ それも無理なら、<link rel="help"> のまま
 */
export function readGuideUrl(doc = globalThis.document) {
  const https = (href) => {
    try {
      return href && new URL(href).protocol === 'https:' ? href : null;
    } catch {
      return null;
    }
  };
  try {
    const ja = https(doc?.querySelector?.('link[rel="help"][hreflang="ja"][href]')?.href ?? '');
    if (ja) return ja;
    const href = https(doc?.querySelector?.('link[rel="help"][href]')?.href ?? '');
    if (!href) return null;
    const u = new URL(href);
    const repo = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (u.hostname !== 'github.com' || repo.length !== 2) return href;
    u.pathname = `/${repo[0]}/${repo[1]}/blob/HEAD/${README_JA_FILE}`;
    u.search = '';
    u.hash = README_JA_ANCHOR;
    return u.href;
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
  // この回の案内役(7 歩を始める時に pickLead で決める)。見本の道の「〜で続きを試す」も、この子
  let lead = guide;
  // B4(12b): サーバーが「ブラウザから描く」設定の時(/api/status の draw.on。既定は切ってある)だけ、見本の道に描く道を足す
  const made = creator ?? (localMake ? createLocalCreator(localMake) : createDrawCreator({ sample: createSampleCreator({ main: () => lead }), enabled: () => Boolean(app?.status?.draw?.on) }));
  // 舞台の子の id。入れ替えた後は app.characterId(main.js と同じ欄)が正
  const stageId = () => app?.characterId ?? app?.character?.id ?? params.get('character') ?? params.get('char') ?? null;
  // ?character=<id> で開いた時の、その子の id(id の形の時だけ。パスは開発の確かめなので、前のまま主役が案内する)
  const askedRaw = params.get('character') ?? params.get('char');
  const askedId = isSpecId(askedRaw) ? askedRaw : null;
  let stopListen = null;
  let engine = null;
  let sheet = null;
  let pendingNav = null;

  const guideName = () => (app?.character?.id === lead.id && app.character.name) || lead.name;

  /**
   * この回の案内役。?character=<id> で開いて、舞台(入れ替える前の子)がその子なら、その子(入口の「案内するのは〜」と同じ。
   * 舞台を主役に替えない。CRITux2 高 1)。そうでなければ、渡された案内役(主役)
   * @returns {{id:string, name:string}}
   */
  function pickLead() {
    if (!askedId || askedId === guide.id) return guide;
    const homeId = home?.id ?? stageId(); // 舞台が読み終わる前は ?character= の id(main.js はその子を読む。読めなければ画面が止まる)
    if (homeId !== askedId) return guide; // 舞台に別の子が出ている
    const c = home?.character ?? app?.character ?? null;
    return { id: askedId, name: (c?.id === askedId && c.name) || sampleName(askedId) || askedId };
  }

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
        if (id) applyVoiceRole(app.speaker, saved?.voice?.role ?? 'auto', rawPersona(id)); // 声の役(おまかせ = この子の役)
      }
    }, 300);
  }

  /* ---------- 舞台(その場で入れ替える。D2・D4) ---------- */
  let home = null; // 初めて入れ替える前の舞台 { character, id }(主役に戻す時、同じ物を戻す。舞台にいる間に見た目を替えたら、次に入れ替える前に控え直す)

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
    } else if (stageId() === home.id) {
      // 案内役が舞台にいる間に見た目(3D/2D)を替えていたら、その見た目を控え直す(前は最初の見た目に戻した。S5 の返事 w9)
      home = { ...home, character: app.character };
    }
    let next;
    if (id === home.id) next = home.character;
    else {
      const mod = await import('../../character/index.js');
      next = await mod.loadCharacter(mod.characterUrl(id), { ...(app.tierOverrides ?? {}) });
    }
    const prevChar = app.character;
    swapIn(next);
    // 見本の子から別の子に替えた時、前の見本の子は 3D の形と絵を捨てる(主役 = home は、戻す時に使うので捨てない)
    if (prevChar && prevChar !== next && prevChar !== home.character) freeCharacter(prevChar);
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
    applyVoiceRole(app.speaker, saved?.voice?.role ?? 'auto', text); // 声の役もその子の物に(おまかせ = その子の役)
    root.classList.toggle('fr-guest', id !== home.id); // 見本の子がいる間の印(切り替えは main.js が舞台の子ごとに作り直すので、隠さない)
    return true;
  }

  /** できた子を舞台に出す(既定)。その場で入れ替えて、続きはそのまま(読み込み直さない) */
  async function defaultShow(c) {
    if (!app || !c?.id) return true; // 舞台が無い(試しの画面)
    // 手元で描いたばかりの子: パソコンが 2D を組むまで(twod)は、舞台は案内役のまま(D5)。2D ができたら、その場で 2D を出す(B4 12b)
    if (c.local && !c.twod) return true;
    try {
      const ok = await putOnStage(c.id);
      if (!ok && stageId() !== c.id) {
        await sheet?.present([{ who: 'note', text: `${c.name}は、いま舞台に出せません。札の中で続けます。` }], {});
        return 'failed'; // 出せなかった印(true と同じく続けるが、「舞台に でたよ」とは言わせない。B4 直し)
      }
    } catch (err) {
      console.warn('見本の子を舞台に出せませんでした:', err?.message ?? err);
      await sheet?.present([{ who: 'note', text: `${c.name}を舞台に出せませんでした。札の中で続けます。` }], {});
      return 'failed';
    }
    return true;
  }

  /**
   * 閉じた時: 舞台をこの回の案内役(主役か、?character=<id> の子)に戻し、アドレスから onboard=1 を消し、入口を出し直さない(D4)。
   * ?character= は、戻した子を指していれば残す(CRITux2 高 1)。指していない時(開発のパスで開いて主役が案内した時)だけ消す
   */
  async function afterClose(reason) {
    const back = lead;
    // 最後まで行った時(done): 選んだ子は舞台に立ったまま。重い入れ替えをしない(Q-0111)。小さな「〜にもどす」ボタンを出す
    const stay = reason === 'done';
    try {
      if (!stay && app && (await whenStageReady()) && stageId() !== back.id) await putOnStage(back.id);
    } catch (err) {
      console.warn('舞台を案内役に戻せませんでした:', err?.message ?? err);
    }
    if (stageId() === back.id || !app) root.classList.remove('fr-guest');
    else if (stay) showReturn(back);
    try {
      const url = new URL(location.href);
      url.searchParams.delete('onboard');
      const asked = url.searchParams.get('character') ?? url.searchParams.get('char');
      if (asked && asked !== back.id && stageId() === back.id) {
        url.searchParams.delete('character');
        url.searchParams.delete('char');
      }
      if (url.href !== location.href) history.replaceState(history.state, '', url.href); // 読み込み直しても 7 歩を始めない
    } catch {
      // 消せなくても続ける
    }
    session?.removeItem(RESUME_KEY);
    try {
      local?.removeItem(PROGRESS_KEY);
    } catch {
      // 消せなくても続ける
    }
    globalThis.dispatchEvent?.(new CustomEvent(CLOSED_EVENT, { detail: { reason, character: stageId() } }));
  }

  /** 選んだ子が舞台に残っている間、小さな「〜にもどす」ボタンを出す(押すと案内役に戻して、ボタンを消す) */
  let returnBtn = null;
  function hideReturn() {
    returnBtn?.remove();
    returnBtn = null;
  }
  /** 上の段が変わった時に、キャラを置き直す(頭のすき間の決まりは上の段の下から測る) */
  function reframeStage() {
    try {
      const st = app?.stage;
      if (st?.state && !st.state.immersive && app.character) st.frameCharacter(app.character, st.state.view, st.state.obstacles);
    } catch {
      // 置き直せなくても続ける
    }
  }
  function showReturn(back) {
    hideReturn();
    const name = (app?.character?.id === back.id && app.character.name) || back.name;
    // 上の段のボタンの列があれば、そこに並べる(下に浮かべると、仮の頭脳の知らせ・字幕に重なった。OL1 の写真)
    const b = Object.assign(document.createElement('button'), { type: 'button', className: buttonHost ? 'place-mode-button fr-launch fr-return fr-return-inline' : 'fr-return', textContent: `${name}にもどす` });
    b.setAttribute('aria-label', `${name}にもどす(いまの子から、${name}に かわります)`);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await putOnStage(back.id);
        root.classList.remove('fr-guest');
        hideReturn();
        reframeStage();
      } catch {
        b.disabled = false;
      }
    });
    returnBtn = b;
    (buttonHost ?? parent).append(b);
    reframeStage();
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
      // おまかせ(ぜんぶ じどう)のおすすめ = その子の人格の文の性格(主役ノリーはおっとり)
      recommended: () => ownSettings(rawPersona(ch.id), { ownSpeech: own }),
      preview: async (s, text) => {
        const r = await previewReply(ch, s, text);
        lastBrain = r.brain === 'haiku' ? 'haiku' : 'mock';
        return r;
      },
      play,
      brain: brainNow,
      parent,
      // 声の役は、舞台にいる子の時だけ読み上げに渡す(舞台にいない子は覚えるだけ。舞台に出た時に putNow が渡す)
      onVoiceRole: (role) => (app && ch.id === stageId() ? applyVoiceRole(app.speaker, role, rawPersona(ch.id)) : null),
      onSave: (s) => {
        saveSettings(local, ch.id, s);
        applyPersona(s, ch);
        onSave(s);
      },
      onCancel,
    });
  }

  /**
   * 舞台の下の余白(st.state.bottomInset)を、札が開いている間だけ、この札の値に止めておく。main.js も同じ欄を書く(下の帯と札の高さ)が、
   * その値は画面ぜんたいの高さで測った物で、形 A の短くした舞台の絵には合わない。書かれた値は覚えておき、閉じたら戻す
   */
  let held = null; // { st, stored, value }
  function holdInset(st, value) {
    if (!held || held.st !== st) {
      releaseInset();
      const h = { st, stored: st.state.bottomInset ?? 0, value };
      try {
        Object.defineProperty(st.state, 'bottomInset', {
          configurable: true,
          enumerable: true,
          get: () => h.value,
          set: (v) => {
            h.stored = v;
          },
        });
      } catch {
        st.state.bottomInset = value; // 止められない形なら、そのまま書く
        return;
      }
      held = h;
    }
    held.value = value;
  }
  function releaseInset() {
    if (!held) return;
    const { st, stored } = held;
    held = null;
    try {
      delete st.state.bottomInset;
    } catch {
      // 消せなくても続ける
    }
    st.state.bottomInset = stored;
  }

  /**
   * 札が開いている間の舞台の見せ方。閉じたら元に戻す。舞台の形が違う・AR/VR の間は何もしない。
   * - PC と iPad(幅 720px から): 札が右に立つので、舞台の絵(canvas)を札の左までにして、キャラを札の左に収める(html.fr-side)
   * - スマホの形 A(sheet): 舞台の絵を札の上だけにする(html.fr-stack と --fr-stage-h)。キャラは札の上に全身で立つ(頭のすき間の決まりはそのまま)
   * - スマホの形 B(overlay): 舞台の絵は画面いっぱいのまま。キャラの帯の下を画面の 36% 空け、腰から下に吹き出しが重なる
   * キーボードが出ている間は、札が見える範囲に重なるので、舞台は替えない(下がったら最初の見え方のまま)
   */
  let side = false;
  let stack = null;
  let stageH = 0;
  function fitStage(open) {
    const st = app?.stage;
    if (!st?.state || typeof st.frameCharacter !== 'function' || !app.character || st.state.immersive) return;
    if (open && sheet?.typing) return;
    const live = Boolean(open && sheet && !sheet.closed);
    const wide = window.innerWidth >= SIDE_MIN_WIDTH;
    const wantSide = Boolean(live && wide && sideRoom() >= SIDE_MIN_STAGE_PX);
    const wantStack = live && !wide ? sheet.layout : null;
    let resized = false;
    let changed = false;
    if (wantSide !== side) {
      side = wantSide;
      root.classList.toggle('fr-side', side);
      resized = true;
    }
    if (wantStack === 'sheet') {
      const top = Math.round(sheet.element.getBoundingClientRect().top);
      const h = Math.max(120, top);
      if (stack !== 'sheet' || Math.abs(h - stageH) > 1) {
        stageH = h;
        root.style.setProperty('--fr-stage-h', `${h}px`);
        root.classList.add('fr-stack');
        resized = true;
      }
      holdInset(st, SHEET_STAGE_GAP);
      changed = true;
    } else if (stack === 'sheet') {
      root.classList.remove('fr-stack');
      root.style.removeProperty('--fr-stage-h');
      stageH = 0;
      resized = true;
    }
    if (wantStack === 'overlay') {
      holdInset(st, Math.round(window.innerHeight * OVERLAY_BOTTOM));
      changed = true;
    }
    if (!wantStack && held) {
      releaseInset();
      changed = true;
    }
    stack = wantStack;
    if (resized) {
      try {
        st.resize?.(); // canvas の大きさが変わったので、描く大きさと画角の縦横を取り直す(main.js は窓の大きさの変化でしか呼ばない)
      } catch {
        // 取り直せなくても、会話は続ける
      }
    }
    if (!changed && !resized) return;
    try {
      st.frameCharacter(app.character, st.state.view, st.state.obstacles);
    } catch {
      // 見せ方を取り直せなくても、会話は続ける
    }
  }

  /** PC の札の左に残る幅(px)。札の左の端から 16px 空ける */
  function sideRoom() {
    const left = sheet?.element?.getBoundingClientRect?.().left ?? window.innerWidth;
    return Math.round(left - 16);
  }

  function startOnboarding({ resume = null } = {}) {
    if (sheet && !sheet.closed) return engine;
    hideReturn();
    let finishTimer = null;
    let sizeWatch = null;
    lead = pickLead(); // ?character=<id> で開いた時は、その子が案内する(CRITux2 高 1)
    const onResize = () => fitStage(true); // 窓の大きさが変わった時も、PC の舞台を札の左に収め直す
    sheet = createSheet({
      guideName: guideName(),
      guideId: lead.id,
      layout: phoneLayout(params),
      onTyping: (on) => {
        if (!on) setTimeout(() => fitStage(true), 60); // キーボードが下がったら、最初の見え方で測り直す(値は同じ)
      },
      voice,
      parent,
      onAct: (id, payload) => engine.act(id, payload),
      onAuto: () => engine.omakase(), // おまかせ(ぜんぶ じどう): どの歩みからでも、おすすめで最後まで(本人 11/7)
      openPersona: (onSave) => openPersona({ character: engine.character, initial: engine.settings, onSave }),
      stage: () => (app?.character ? { character: app.character, speaker: app.speaker, guideId: lead.id } : null),
      onClose: (reason) => {
        clearTimeout(finishTimer);
        sizeWatch?.disconnect();
        globalThis.removeEventListener?.('resize', onResize);
        if (reason === 'later') local?.setItem(DONE_KEY, 'later');
        if (reason === 'done') local?.setItem(DONE_KEY, 'done');
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
    globalThis.addEventListener?.('resize', onResize);
    engine = new FirstRun({
      guide: { id: lead.id, name: guideName() },
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
      // 歩みごとに途中経過を残す(読み込み直しても続きから)
      progress: (snap) => {
        try {
          local?.setItem(PROGRESS_KEY, JSON.stringify({ ...snap, t: Date.now() }));
        } catch {
          // 覚えられなくても、会話は続ける
        }
      },
      // 最後まで行った: 札は自動で閉じない(決めたことと「はじめる」を見せる)。閉じるのは「はじめる」を押した時
      onDone: () => {
        local?.setItem(DONE_KEY, 'done');
        try {
          local?.removeItem(PROGRESS_KEY);
        } catch {
          // 消せなくても続ける
        }
      },
      onBegin: () => sheet.close('done'),
    });
    api.engine = engine;
    api.sheet = sheet;
    stopListen?.();
    stopListen = typeof made.listen === 'function' ? made.listen((ev) => engine.makeEvent(ev)) : null; // 作る画面(枠)からの知らせ
    // 案内役が舞台にいなければ、その場で呼ぶ(舞台と案内の文がずれないように。CRITux 6)。?character=<id> で開いた時は、
    // その子が案内役なので替えない(CRITux2 高 1)。舞台が読み終わる前に札が開いた時も、読み終わったら札に合わせて置き直す
    if (app) {
      void whenStageReady()
        .then(async (ok) => {
          if (ok && !resume && !showCharacter && stageId() !== lead.id) await putOnStage(lead.id);
          // 読み込み直した後の続き: 決めてあった見本の子を、舞台に出し直す(3D のまだない手元の子は、案内役のまま)
          const rc = resume?.character;
          if (ok && rc?.id && rc.sample && !rc.local && !showCharacter && stageId() !== rc.id) await putOnStage(rc.id);
          if (ok && sheet && !sheet.closed) fitStage(true);
        })
        .catch(() => null);
    }
    if (resume) engine.resume(resume);
    else engine.start();
    return engine;
  }

  // ---- ボタン ----
  const host = buttonHost ?? parent;
  const personaBtn = Object.assign(document.createElement('button'), { type: 'button', textContent: '性格', className: buttonHost ? 'place-mode-button fr-launch' : 'fr-launch floating' });
  personaBtn.dataset.firstrun = 'persona';
  personaBtn.addEventListener('click', () => openPersona());
  // 作る入口の名前は「あたらしい子を つくる」(UIR 16。前の「はじめての会話」は、押すと何が起きるか分からなかった)
  const startBtn = Object.assign(document.createElement('button'), { type: 'button', textContent: START_LABEL, className: buttonHost ? 'place-mode-button fr-launch' : 'fr-launch floating' });
  startBtn.dataset.firstrun = 'start';
  startBtn.addEventListener('click', () => startOnboarding());
  if (buttonHost) host.append(personaBtn, startBtn);
  else {
    startBtn.style.right = '84px';
    host.append(personaBtn, startBtn);
  }

  const api = { engine: null, sheet: null, voice, byokReady, creator: made, start: startOnboarding, openPersona, applyPersona, talk, putOnStage, get lead() { return lead; } };

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
  // 別の端末から続けた(6 桁の番号で合鍵を受け取った)端末では、7 つのステップは済みにする(1 歩目から始めない。低 14)。
  // 合鍵は会話の記憶の部品(S3 の memoryKey.js。保存の名前 yc.memoryKey)が持つ。会話で覚える事が出た後にだけ作られる物なので、
  // 合鍵がある端末は、この 7 歩を見たか、別の端末から続けたかのどちらか
  try {
    if (local && !local.getItem(DONE_KEY) && /^[A-Za-z0-9_-]{43}$/.test(local.getItem('yc.memoryKey') ?? '')) local.setItem(DONE_KEY, 'paired');
  } catch {
    // 覚えられなくても続ける
  }
  // 途中で読み込み直した時は、?onboard=1 が無くても続きから(歩みごとに残した途中経過。高 1)
  const saved = !kiosk && wanted !== '0' && local?.getItem(DONE_KEY) !== 'done' ? readProgress(local) : null;
  if (wanted === '1') startOnboarding({ resume: snap ?? saved });
  else if (saved) startOnboarding({ resume: saved });
  else if (wanted !== '0' && auto && !kiosk && !local?.getItem(DONE_KEY)) startOnboarding();

  globalThis.__firstRun = api; // 試験と開発の確かめ用(main.js の window.__app と同じ考え)
  return api;
}
