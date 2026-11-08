// 初めての会話の台本(最初の設計の決めの 7 つのステップ)。DOM を使わない進め方だけ(node の試験で、画面なしで最後まで通す)。
// 1 どんな子を生み出そうか? → 2 ゆるキャラチェック → 3 こんな子ができたよ → 4 性格 → 5 初めてのあいさつ
// → 6 声が無ければ文字送りとレトロ音 → 7 鍵を入れると「声が出せるようになったよ、ありがとう!」
// 画面・頭脳・声・作る道は、外から渡す(deps)。台本は「言う → 待つ → 選ばせる」をくり返すだけ。
// 言う文は、子どもにも読める短い言葉(1 つの吹き出しに 1〜2 行。11/8 本人「読みづらい」)。開発の言葉(コマンド・ファイルの名前・
// スキルの名前・「API キー」・住所)は出さない。
// 作る道が 'local'(手元の PC)のときは、1〜3 歩が本当の作る道になる。入力と絵は PC が配る「作る画面」の枠の中だけで扱い
// (言葉か絵 → PC のゆるキャラチェック → 段 0 の絵 → C0 で「この子にする」か「直したい(一言)」= K3 の request.json → PC の Claude Code)、
// 台本は枠からの知らせ(makeEvent)を受けて、案内役の言葉と歩みを進める。
// 見本の道(公開のリンクの既定)は新しく描かない。言葉が見本に本当に当たる時だけ見本を出し、当たらない言葉と絵には
// 「近い見本がいない」と正直に言う(だまって見本を選ばない。司令塔の決め D1)。
import { PRESETS, LENGTHS, normalize } from '../persona/settings.js';
import { styleLines } from '../persona/preview.js';

import { MAIN_CHARACTER } from '../../character/defaults.js'; // 主役の決まりは 1 か所(S5)。ここでは写さない
import { ASKS_PLACE, DEFAULT_ROLE, PLACE_MAX, ROLES, ROLE_CHIPS, autoWords, normalizeRole } from './roles.js';
import { COLOR_CHIPS, SHAPE_CHIPS } from './creators.js';
import { MATERIAL_THUMBS, SHAPE_THUMBS } from './thumbs.js';

/**
 * 決めたことを、子どもが読める 1 つの文にする(UIR 15: 「元気さ 2・ふつう・文字とレトロ音」のような並びにしない)。
 * 声の出し方は書かない(7 つ目のステップで決まる。前は、まだ決めていない声の名前が出て、後の文と食い違った)
 */
const KID_PRESET = { calm: 'おっとり', genki: 'げんき いっぱい', mischief: 'いたずらずき', shy: 'はずかしがりや' };
const KID_PACE = (s) => (s.energy <= 2 ? 'ゆっくり' : s.energy >= 4 ? 'はきはき' : 'のんびり');
const KID_LEN = { short: 'みじかく', normal: '', long: 'たくさん' };
export function summary(settings) {
  const s = normalize(settings);
  const how = s.tone === 'ending' ? `「${s.ending}」を つけて` : s.tone === 'polite' ? 'ていねいに' : s.tone === 'own' ? 'この子らしく' : '';
  const talk = [KID_PACE(s), KID_LEN[s.length], how].filter(Boolean).join('、');
  return `${KID_PRESET[s.preset] ?? 'おっとり'}で、${talk} 話す 子`;
}

export const STEPS = [
  { n: 1, key: 'start', label: 'どんな子' },
  { n: 2, key: 'check', label: 'チェック' },
  { n: 3, key: 'meet', label: 'できた子' },
  { n: 4, key: 'persona', label: '性格' },
  { n: 5, key: 'hello', label: 'あいさつ' },
  { n: 6, key: 'retro', label: '文字と音' },
  { n: 7, key: 'voice', label: '声' },
];
export const VOICE_THANKS = '声が出せるようになったよ、ありがとう!';
export const WORDS_MAX = 60;
export const NOTE_MAX = 40; // 直してほしい一言(K3 と同じ 40 字)
export const SAY_MAX = 200;
export const SNAPSHOT_VERSION = 1;
export const FRAME_WAIT_MS = 10000; // 作る画面(枠)から「開いた」の知らせが来るのを待つ長さ
/**
 * 作り方の節の名前。画面は日本語だけ(Q-0092 A)なので、日本語の README の見出しと同じ文字。
 * 日本語の README は、第 9 波から README.md(S6。英語は README.en.md)。前は README.ja.md だった。
 * 画面のリンク(index.js の readGuideUrl)は、この見出しから GitHub の節の印を作る。見出しが変わると試験 onboarding_readme_ja が落ちる
 */
export const README_SECTION = '自分の PC で、Claude Code と自分のキャラを作る';
/** 新しい子の作り方(子どもにも分かる 1 文。くわしい手順は「パソコンでの つくりかた」のリンク先)。画面のコードに外の住所は書かない(privacy の試験) */
export const MAKE_STEPS = 'あたらしい子は、パソコンの Claude Code で つくれるよ。';
/** 写真や絵から作れない理由(見本の道)。正直で、やさしい 1 つの言い方にそろえる(写真の時は「写真」と言う) */
export const pictureLimit = (noun = '絵') => `${noun}からの 絵づくりは、パソコンの Claude Code で するよ。`;
export const PICTURE_TRY = 'ここでは、見本の子で ためしてみよう!';
/** 近い見本を出す時の一言(言葉がその子そのものに当たらない時。行き止まりにしない。UIR 1) */
export const NEAR_ENOUGH = 'ぴったりではないけど、この子はどう?';
/** 絵の道(見本の道)。この画面は絵を見られないので、色と形を聞いて近い子を選ぶ(UIR 2。正直に言う) */
export const PICTURE_ASK = 'この画面は 絵を 見られないんだ。いちばん 多い 色と、かたちを おしえてね。にた子を さがすよ。';
/** 3D にするかを聞く(2D は すぐ。B4 12b) */
export const ASK_3D = '3D にもする?(やく 20 ぷん)';
export const CONVERT_NOTE = '3D は、ゆるキャラの かたちに ととのえて つくるよ(もとの えと まったく おなじには ならないよ)';
/** 仮の頭脳で話している時の、子ども向けの知らせ(くわしい言い方は性格の画面) */
export const MOCK_NOTE = 'いまは おためしの あたまで 話しているよ。話し方だけ 性格に あわせているよ。';

const chars = (s) => [...String(s ?? '')].length;
/** 1 つ目のステップの入れ方の id(役目をとばして来ても受ける) */
const START_IDS = new Set(['words', 'pick', 'photo']);
const clip = (s, n) => [...String(s ?? '').trim()].slice(0, n).join('');

/** おまかせのくわしい名前(読み上げと、押した時の右の吹き出し)。どの歩みでも出す(本人 11/7: 全部オートでできるパターン) */
export const OMAKASE_LABEL = 'おまかせ(ぜんぶ じどう)';
/** 問いごとのおまかせの札(その問いだけを おまかせにする。役目・どんな子・ゆるキャラの形など) */
export const OMAKASE_CHIP = 'おまかせ';
/**
 * 全体のおまかせの札の名前。問いごとの「おまかせ」と間違えない言い方(本人 11/8: 駅の名前だけ おまかせのつもりが、全部おまかせになった)。
 * 押すと、まず「ここから さきを ぜんぶ おまかせに するよ。いい?」と確かめる
 */
export const OMAKASE_ALL = 'のこりを ぜんぶ おまかせ';
export const OMAKASE_ASK = 'ここから さきを ぜんぶ おまかせに するよ。いい?';
export const OMAKASE_YES = 'はい、ぜんぶ おまかせ';
export const OMAKASE_NO = 'やめる';
/** パソコンでの作り方(リンク)の札の名前 */
export const README_LABEL = 'つくりかた';
/** 歩みごとの、だいたいの秒(残りの時間の目安)。手元の PC で描く時は、3 歩目に描く時間を足す */
const STEP_SEC = { 1: 20, 2: 15, 3: 15, 4: 15, 5: 15, 6: 20, 7: 15 };
const DRAW_SEC = 240;
// 動いている(busy)まま、話してもいない・文字も増えない・長い仕事も無い状態が、この間つづいたら、札と入力欄を出し直す(BP1。止まって空の札のままになるのを防ぐ)
const STUCK_MS = 8000;

/**
 * いまの歩みから、あと いくつ・あと 何分 で おわるか(本人 11/7: すぐ終わるのに途中でやめる人がいるので、残りを見せる)。
 * 子どもにも分かる言葉で(上の細い段の「あと 4 つ」)。とばした歩み(言葉の時のチェックなど)は数えない
 * @returns {{left:number, main:string, time:string}}
 */
export function progressText(step, { skipped = [], local = false } = {}) {
  if (step > STEPS.length) return { left: 0, main: 'じゅんび OK!', time: '' }; // 「できあがり」は、本当に作った時だけ言う(UIR 4)
  const rest = STEPS.filter((s) => s.n >= Math.max(1, step) && !skipped.includes(s.n));
  const left = rest.filter((s) => s.n > step).length;
  const sec = rest.reduce((t, s) => t + STEP_SEC[s.n] + (local && s.n === 3 ? DRAW_SEC : 0), 0);
  return { left, main: left ? `あと ${left} つ` : 'これで さいご!', time: `${Math.max(1, Math.round(sec / 60))} 分くらい` };
}

/** 役目を聞く一言(1 つ目のステップの 2 文目。B4 12b) */
export const ROLE_ASK = 'この子は、どこで だれと?';
/** 役目を選んだ後に聞く一言 */
export const WHAT_ASK = 'どんな子を生み出そうか?';

/**
 * 1 歩目で案内役が最初に言う 2 文。案内役が主役(nori)のときは主役の口調で名乗る。主役を替えたら、この 1 文も替える。
 * 2 文目は、役目を聞く一言(B4 12b から。前は「どんな子を生み出そうか?」)。
 * サーバーの声の前もっての温め(S3 の ttsWarm)は、この関数の文を温める(文が食い違うと、最初の声が温め無しの +0.3〜0.5 秒になる)
 */
export function guideFirstLines(guideName, nori) {
  return [nori ? `はじめまして! ${guideName}デス。いっしょに ゆるキャラを 生み出しマス!` : `はじめまして。${guideName}だよ。いっしょに ゆるキャラを 生み出そう。`, ROLE_ASK];
}

/**
 * @typedef {{who:'guide'|'char'|'user'|'note', text:string, img?:string, expression?:string, motion?:string, voice?:boolean}} Line
 * @typedef {{id:string, label:string, kind?:'button'|'text'|'file'|'key'|'persona'|'frame', primary?:boolean, capture?:boolean,
 *   placeholder?:string, max?:number, submit?:string, remember?:boolean, url?:string}} Action
 *   kind 'link' は押すと url を別のタブで開くだけ(台本は進まない)。
 */
export class FirstRun {
  /**
   * @param {object} d
   * @param {{id:string, name:string}} d.guide 案内役(既定は主役 MAIN_CHARACTER = ノリー)
   * @param {object} d.creator 作る道(creators.js)
   * @param {{get:(id:string)=>object|null, set:(id:string, s:object)=>void, random:(character?:object)=>object, initial?:(character?:object)=>object|null}} d.persona
   *   random はおまかせ。今の子(character)を渡す(話し方の決まった子には、語尾も口調も足さないため)
   *   initial は、その子の人格の文に書いてある性格(あれば)。4 歩目は、覚えた設定 → この子の性格 → おまかせ、の順
   * @param {(text:string, ctx:object)=>Promise<{lines:{text:string,expression?:string,motion?:string}[], brain:string, safety?:string|null, notice?:string}>} d.talk
   * @param {object} d.voice 声(voice.js)
   * @param {(lines:Line[], ctx:object)=>Promise<void>} d.present 言った文を画面に出し、出し終わったら解決する
   * @param {(actions:Action[])=>void} d.offer 選べる物を出す
   * @param {(character:object)=>Promise<boolean>} [d.showCharacter] できた子を舞台に出す。false なら読み込み直し中(続きは resume)
   * @param {(settings:object, character:object)=>void} [d.onPersona]
   * @param {(step:number, info:object)=>void} [d.onStep]
   * @param {(snapshot:object)=>void} [d.save] 読み込み直しの前に、続きの状態を残す
   * @param {()=>void} [d.onDone]
   * @param {(pic:{img?:string, frame?:string|null, caption:string}|null)=>void} [d.pin] 選んだ絵・描いた絵を札に出したままにする(null で消す)
   * @param {string|null} [d.guideUrl] README の作り方の節の URL(画面の index.html の link rel="help")。無ければ文で手順だけ
   */
  constructor(d) {
    this.d = d;
    this.step = 0;
    this.skipped = new Set();
    this.input = null; // { from:'words'|'picture', words?, kind?:'photo'|'pick', url? }
    this.check = null;
    this.character = null;
    this.settings = null;
    this.history = [];
    this.actions = [];
    this._busy = false;
    this._busyTimer = null;
    this._longWork = 0; // 描く・調べる・返事を待つ、など本当に長くかかる仕事の数(その間は止まりと見ない)
    this._lastActivity = null;
    this._saying = 0; // 今 出している最中の文の数(台本が busy でない始まり・続きの文も見張る)
    this._releases = new Set(); // 止まった文の待ちを外す関数(出し直す時に全部呼ぶ)
    this.stuckCount = 0;
    this.done = false;
    this.freshNext = false; // 作りかけの続きから始めた最初の選びに、「はじめから」を 1 つ足す(CU3)
    this.mockNoted = false;
    this.makeQueue = Promise.resolve(); // 作る画面の知らせを 1 つずつ順に受ける
    this.progressSeen = new Set();
    this.auto = false; // おまかせ(ぜんぶ じどう)で進めている
    this.role = null; // 役目(この子は、どこで だれと。roles.js の id)。選ぶ前は null
    this.place = null; // お店・駅の時だけ { name, about }
    this.convert = null; // 3D 用のゆるキャラ変換の選び { shape, material }(手元の PC の道)
    this.log = []; // 試験と確かめのための、言った文の記録
  }

  /** 案内役。渡されなければ主役(MAIN_CHARACTER) */
  get guide() {
    return this.d.guide ?? MAIN_CHARACTER;
  }

  get guideName() {
    return this.guide.name || MAIN_CHARACTER.name;
  }

  /** 案内役が主役(ノリー)か。主役は自分を「ノリー」と呼び、「〜デス・〜マス」で話す */
  get nori() {
    return this.guide.id === MAIN_CHARACTER.id;
  }

  /** 1〜3 歩が手元の PC の本当の作る道で、入力を PC の作る画面(枠)でするか */
  get local() {
    return this.d.creator?.mode === 'local' && Boolean(this.d.creator.frameUrl);
  }

  async _say(...lines) {
    const list = lines.flat().filter(Boolean);
    this.log.push(...list);
    // 文を出す側(読み上げ)が止まって終わらない時、出し直す仕組み(_unstick)が待ちを外せるように、競争させる
    let release;
    const freed = new Promise((resolve) => {
      release = resolve;
    });
    this._releases.add(release);
    this._saying += 1;
    this._syncWatch();
    try {
      await Promise.race([this.d.present(list, { step: this.step, character: this.character, settings: this.settings }), freed]);
    } finally {
      this._releases.delete(release);
      this._saying -= 1;
      this._syncWatch();
    }
  }

  /** 動いている最中か。立てた時から、止まりの見張り(_watch)を回す */
  get busy() {
    return this._busy;
  }

  set busy(on) {
    this._busy = Boolean(on);
    this._stopWatch();
    this._syncWatch();
  }

  /** 動いている最中か、文を出している最中なら、見張りを回す(まだ回っていなければ始める) */
  _syncWatch() {
    const active = this._busy || this._saying > 0;
    if (!active) return this._stopWatch();
    if (this._busyTimer) return;
    this._lastActivity = this._activityKey();
    this._armWatch();
  }

  _armWatch() {
    const t = setTimeout(() => this._watch(), this.d.stuckMs ?? STUCK_MS);
    t.unref?.();
    this._busyTimer = t;
  }

  _stopWatch() {
    clearTimeout(this._busyTimer);
    this._busyTimer = null;
  }

  /** 今 話している・文字が増えている・長い仕事を待っている印。変われば「進んでいる」 */
  _activityKey() {
    let n;
    try {
      n = this.d.activity?.();
    } catch {
      n = null;
    }
    return `${n}|${this.log.length}|${this._longWork}`;
  }

  _isPlaying() {
    try {
      return Boolean(this.d.playing?.());
    } catch {
      return false;
    }
  }

  /** busy のまま止まっていないかを見る。話している間・長い仕事の間・何かが進んでいる間は待つ */
  _watch() {
    this._busyTimer = null;
    if (!(this._busy || this._saying > 0) || this.done) return;
    const key = this._activityKey();
    const moved = key !== this._lastActivity;
    this._lastActivity = key;
    if (moved || this._longWork > 0 || this._isPlaying()) return this._armWatch();
    this._unstick();
  }

  /**
   * 止まった時の出し直し: 待ちの文を外し、動いている印を下ろして、いまの選びと入力欄をもう一度出す。
   * 外された文の続きが進めば、その続きの選びが後から出て上書きする
   */
  _unstick() {
    this.stuckCount += 1;
    const waiting = this._releases.size;
    for (const release of [...this._releases]) release();
    this._releases.clear();
    this.busy = false;
    if (this.actions.length) this._offer(this.actions);
    else if (!waiting) this._offer(this._startActions()); // 外した文があれば、その続きが最初の選びを出す
    this.d.onStuck?.(this.stuckCount);
  }

  /** 長くかかる仕事(描く・調べる・返事を待つ)。待っている間は、止まりの見張りが出し直さない */
  async _long(promise) {
    this._longWork += 1;
    try {
      return await promise;
    } finally {
      this._longWork -= 1;
    }
  }

  _offer(actions) {
    // 続きから始めた後、最初の 1 つ目の答えを押すまで、選びに「はじめから」を足す(いつも続きからしか始まらないと、作り直せないため。CU3)
    if (this.freshNext && !actions.some((a) => a.id === 'begin' || a.id === 'fresh')) actions = [...actions, { id: 'fresh', label: 'はじめから' }];
    this.actions = actions;
    this.d.offer(actions);
  }

  _go(n) {
    if (this.step === n) return;
    this.step = n;
    this.d.onStep?.(n, { skipped: [...this.skipped], local: this.local });
    if (n <= STEPS.length) this.d.progress?.(this.snapshot()); // 歩みごとに途中経過を残す(読み込み直しても続きから。高 1)
  }

  /**
   * おまかせ(ぜんぶ じどう)。どの歩みからでも、残りの選びを全部おすすめで決めて、最後まで進む(本人 11/7)。
   * 子がまだいなければ案内役(主役)、性格はその子の性格(無ければおまかせ)、声の役はおまかせ、声の鍵は入れない。
   * あいさつと文字の歩みはとばす。決めたことと「あとから変えられる」を言ってから終わる
   */
  async omakase() {
    if (this.busy || this.done) return false;
    this.busy = true;
    this.d.offer([]);
    try {
      await this._say({ who: 'user', text: OMAKASE_LABEL });
      await this._omakaseRest();
      return true;
    } catch (err) {
      await this._say({ who: 'note', text: `うまく すすめなかったよ(${err?.message ?? err})` });
      this._offer(this._retryActions());
      return false;
    } finally {
      this.busy = false;
    }
  }

  /**
   * 全体のおまかせの札を押した時: すぐ進めず、まず確かめる(本人 11/8: 駅の名前だけ おまかせのつもりが、全部おまかせになった)。
   * 「はい」で今の選びから後を全部おすすめで決める(omakase_yes)。「やめる」は、今の問いにそのまま戻る(omakase_no)
   */
  async omakaseAsk() {
    if (this.busy || this.done) return false;
    this.busy = true;
    try {
      const back = this.actions;
      this.d.offer([]);
      await this._say({ who: 'user', text: OMAKASE_ALL }, { who: 'guide', text: OMAKASE_ASK });
      this.askBack = back;
      this._offer([
        { id: 'omakase_yes', label: OMAKASE_YES, primary: true, noAuto: true },
        { id: 'omakase_no', label: OMAKASE_NO, noAuto: true },
      ]);
      return true;
    } finally {
      this.busy = false;
    }
  }

  async _omakaseBack() {
    await this._echo('omakase_no');
    await this._say({ who: 'guide', text: 'じゃあ、さっきの つづきね。' });
    const back = this.askBack ?? [];
    this.askBack = null;
    return this._offer(back.length ? back : this._startActions());
  }

  /**
   * 子がまだいない時のおまかせ: 選んだ役目(と場所の名前)から短い説明を作り、言葉で作る道と同じ道で子を作る
   * (描ける設定なら描く。描けない時は、いちばん近い見本)。役目はそのまま残す。
   * 前は、役目と関係のない見本(surprise)を出していて、駅を選んだのにロボが出た(本人 11/8)。
   * @returns {Promise<'reload'|'ok'>} 'reload' は、舞台が読み込み直し中(続きは resume)
   */
  async _omakaseChild() {
    const creator = this.d.creator;
    const words = autoWords(this.role, this.place);
    let made = null;
    if (typeof creator.make === 'function') {
      this.input = { from: 'words', words };
      if (this.step < 2) this.skipped.add(2); // 1 歩目からのおまかせはチェックをしていない(歩みの丸は「とばした」に)
      this._go(3);
      await this._say({ who: 'note', text: `「${words}」で つくるよ。` });
      made = await creator.make(this.input, { onProgress: (text) => this._say({ who: 'note', text }) });
      // 近い見本が案内役そのものなら、別の子を出す(案内役のまま「できあがり!」と言わない。UIR 4)
      if (made?.sample && made.id === this.guide.id) made = creator.surprise?.() ?? made;
    }
    // 作れなかった(見本の一覧が空・手元の PC の道)時は、前のとおり見本から 1 体
    const pick = made ?? creator.surprise?.() ?? creator.main?.() ?? (creator.list?.() ?? [])[0] ?? null;
    if (!pick) return 'ok';
    this.character = pick;
    if (this.step < 2) this.skipped.add(2);
    this._go(3);
    const lines = [];
    if (pick.drawFailed) lines.push({ who: 'note', text: `${pick.drawFailed}。にた 見本の子を 出すね。` });
    if (pick.drawn) lines.push({ who: 'guide', text: `おまかせで 描いたのは、${pick.name}! うごく 2D で 舞台に 出すね。` });
    else if (pick.id === this.guide.id) lines.push({ who: 'guide', text: `${pick.name}で はじめるよ!` });
    else lines.push({ who: 'guide', text: `おまかせで えらんだのは、${pick.name}!`, ...(pick.img ? { img: pick.img } : {}) });
    await this._say(...lines);
    const stay = await (this.d.showCharacter?.(pick) ?? true);
    if (stay === false) {
      this.d.save?.(this.snapshot());
      return 'reload'; // 読み込み直しの後、resume がおまかせの続きをする
    }
    return 'ok';
  }

  async _omakaseRest() {
    this.auto = true;
    if (!this.role) this.role = DEFAULT_ROLE; // 役目もおまかせ(おうち)
    if (!this.character && (await this._omakaseChild()) === 'reload') return undefined;
    this._go(4);
    const id = this.character?.id ?? 'unknown';
    let s = this.d.persona.get(id);
    if (!s) s = this.d.persona.initial?.(this.character) ?? this.d.persona.random(this.character);
    this.settings = this._withRole(s);
    this.d.persona.set(id, this.settings);
    this.d.onPersona?.(this.settings, this.character);
    for (const n of [5, 6, 7]) if (this.step < n) this.skipped.add(n);
    await this._say(
      { who: 'guide', text: this.nori ? 'おまかせで、ぜんぶ きめマシタ!' : 'おまかせで、ぜんぶ きめたよ!' },
      { who: 'note', text: `${this.character?.name ?? 'この子'}は、${summary(this.settings)}に したよ。` },
      { who: 'note', text: 'ぜんぶ、あとから かえられるよ。' },
    );
    return this._finish();
  }

  /** 押された物を受け取る。今出している選択肢に無い物(古いボタン)と、動いている最中の 2 回押しは捨てる */
  async act(id, payload = {}) {
    if (this.busy || (this.done && id !== 'begin')) return false;
    // 役目を聞いている間に、ことばや絵が先に来た(呼ぶ側が役目をとばした): 役目は既定の おうち にして、そのまま受ける
    if (!this.role && this.step === 1 && START_IDS.has(id) && this.actions.some((a) => a.id.startsWith('role_'))) {
      this.role = DEFAULT_ROLE;
      this.actions = this._startActions();
    }
    if (!this.actions.some((a) => a.id === id)) return false;
    if (id !== 'fresh') this.freshNext = false; // 続きの答えを 1 つ押したら、「はじめから」は出さない
    this.busy = true;
    this.d.offer([]); // 押した後は、次の選択肢が出るまでボタンを出さない
    try {
      await this._handle(id, payload);
      return true;
    } catch (err) {
      await this._say({ who: 'note', text: `うまく すすめなかったよ(${err?.message ?? err})` });
      this._offer(this._retryActions());
      return false;
    } finally {
      this.busy = false;
    }
  }

  _retryActions() {
    return [{ id: 'retry', label: 'もう一度', primary: true }, { id: 'finish', label: 'ここで おわる' }];
  }

  /** 押した札を、右の吹き出しで見せる(LINE のように、何を選んだかが会話に残る) */
  async _echo(id) {
    const a = this.actions.find((x) => x.id === id);
    if (a?.label && !a.kind) await this._say({ who: 'user', text: a.label });
  }

  async start() {
    this._go(1);
    // 案内役が主役のときは、主役(ノリー)の口調で名乗る。主役を替えたら、この 1 文も替える。
    // 先に「どこで だれと」を聞く(本人の案: 何役かを、まず聞く。B4 12b)。名乗りと役目の問いは 1 回で言う
    // (2 文目の声を、1 文目を話している間に前もって取るため)。どんな子を…は、役目を選んだ後に言う
    await this._say(...guideFirstLines(this.guideName, this.nori).map((text) => ({ who: 'guide', text })));
    this._offerRole();
  }

  /** 役目を聞き直す */
  async _askRole() {
    this._go(1);
    await this._say({ who: 'guide', text: ROLE_ASK });
    this._offerRole();
  }

  _offerRole() {
    this._offer([
      ...ROLES.map((r) => ({ id: `role_${r}`, label: ROLE_CHIPS[r], primary: r === DEFAULT_ROLE })),
      { id: 'role_auto', label: OMAKASE_CHIP, aria: 'おまかせ(おうちに する)', noAuto: true },
    ]);
  }

  async _roleAnswer(r) {
    const role = r === 'auto' ? DEFAULT_ROLE : normalizeRole(r);
    await this._say({ who: 'user', text: r === 'auto' ? OMAKASE_CHIP : ROLE_CHIPS[role] });
    this.role = role;
    this.place = null;
    if (ASKS_PLACE.has(role)) {
      await this._say({ who: 'guide', text: role === 'shop' ? 'おみせの なまえは?' : 'えきや まちの なまえは?' });
      return this._offer([
        { id: 'place_name', label: 'なまえ', kind: 'text', placeholder: role === 'shop' ? '例: ひだまり パン' : '例: みどり駅', max: PLACE_MAX, submit: '送る', primary: true },
        { id: 'place_skip', label: 'なまえは とばす' },
      ]);
    }
    return this._askWhat();
  }

  async _placeAnswer(id, p) {
    const text = clip(p?.text, PLACE_MAX);
    if (id === 'place_name') {
      if (text) await this._say({ who: 'user', text });
      this.place = { name: text, about: '' };
      await this._say({ who: 'guide', text: this.role === 'shop' ? 'なにを あんないする?' : 'どんな ことを あんないする?' });
      return this._offer([
        { id: 'place_about', label: 'あんないする こと', kind: 'text', placeholder: this.role === 'shop' ? '例: パンの しゅるいと 店の 中' : '例: 出口と のりかえ', max: PLACE_MAX, submit: '送る', primary: true },
        { id: 'place_skip', label: 'このことは とばす' },
      ]);
    }
    if (id === 'place_about') {
      if (text) await this._say({ who: 'user', text });
      this.place = { ...(this.place ?? { name: '' }), about: text };
    } else await this._echo(id);
    return this._askWhat();
  }

  /** 役目の後: どんな子を生み出すか */
  async _askWhat() {
    const sample = this.d.creator.mode === 'sample';
    await this._say(
      { who: 'guide', text: WHAT_ASK },
      sample ? { who: 'note', text: this.d.creator.canDraw ? 'ことばと 絵は、この サーバーから Claude(Anthropic)に 送って、ゆるキャラの 絵に するよ。' : 'ここでは、にた 見本の子を 出して ためせるよ。' } : null,
      this.local ? { who: 'note', text: '下の 作る画面に、ことばか 絵を 入れてね。' } : null,
      this.local ? { who: 'note', text: 'パソコンの Claude Code が 描くよ。ことばと絵は Claude(Anthropic)に 送られるよ。' } : null,
    );
    this._offerStart();
  }

  /** 役目を性格の設定に足した、新しい設定(元は変えない) */
  _withRole(s) {
    const base = normalize(s);
    if (!this.role) return base;
    return normalize({ ...base, role: this.role, ...(this.place ? { place: this.place } : {}) });
  }

  _offerStart() {
    if (this.local) {
      // 役目は作る画面へ # の後ろで渡す(作る画面が make.json に書く。絵を描く段の「どこで だれと」になる)
      const role = this.role ? `&role=${encodeURIComponent(this.role)}` : '';
      const place = this.place?.name ? `&place=${encodeURIComponent(this.place.name)}` : '';
      this._offer([{ id: 'frame', kind: 'frame', label: 'PC の作る画面', url: `${this.d.creator.frameUrl}${role}${place}` }]);
      // 作る画面が開けない(PC のサーバーが止まっている・この画面の元が許されていない)ときは、黙らずに言う
      clearTimeout(this.frameTimer);
      if (!this.frameReady) {
        this.frameTimer = setTimeout(() => {
          if (!this.frameReady && !this.done && this.step <= 1) {
            this._say({ who: 'note', text: 'パソコンの 作る画面が ひらけないよ。パソコンの じゅんびを 見てもらってね。' });
          }
        }, this.d.frameWaitMs ?? FRAME_WAIT_MS);
        this.frameTimer?.unref?.(); // node の試験で、待つ間に終われなくならないように
      }
      return;
    }
    this._offer(this._startActions());
  }

  /** 1 つ目のステップの入れ方(見本の道)。ことばが主役。カメラの「写真を撮る」は最後(UIR 22) */
  _startActions() {
    if (this.local) return [{ id: 'frame', kind: 'frame', label: 'PC の作る画面', url: this.d.creator.frameUrl }];
    return [
      { id: 'pick', label: '絵を選ぶ', kind: 'file' },
      { id: 'photo', label: '写真を撮る', kind: 'file', capture: true },
      // 「どんな子?」だけを おまかせに(役目と場所から説明を作って、描く・近い見本を出す)。全体の「のこりを ぜんぶ おまかせ」(点線の札)とは
      // 名前も見た目も分けてあるので、この問いでは両方出す(本人 11/8: 問いごとと全体を間違えた)
      { id: 'what_auto', label: OMAKASE_CHIP, aria: 'おまかせ(えらんだ やくめから、どんな子かを きめる)' },
      { id: 'words', label: 'ことばで 書く', kind: 'text', placeholder: '例: 赤い ちょうちんの子', max: WORDS_MAX, submit: '送る', primary: true },
    ];
  }

  async _handle(id, p) {
    switch (id) {
      case 'retry':
        return this._resumeAt(this.step || 1);
      case 'finish':
        return this._finish();
      case 'photo':
      case 'pick':
        return this._fromPicture(id, p);
      case 'words':
        return this._fromWords(p);
      case 'what_auto': // 「どんな子?」だけを おまかせに(役目と場所から説明を作る。ほかの選びは自分で決める)
        await this._echo(id);
        return this._fromWords({ text: autoWords(this.role ?? DEFAULT_ROLE, this.place) }, { echo: false });
      case 'omakase_yes': // 全体のおまかせの確かめに「はい」
        await this._echo(id);
        this.askBack = null;
        return this._omakaseRest();
      case 'omakase_no':
        return this._omakaseBack();
      case 'kind_yuru':
      case 'kind_human':
      case 'kind_complex':
        await this._echo(id);
        return this._afterCheck({ class: id.slice(5), by: 'person' });
      case 'yurufy':
      case 'redraw':
        await this._echo(id);
        this.input = { ...this.input, yurufy: true };
        return this._meet();
      case 'next_meet':
        return this._meet();
      case 'use_guide':
        await this._echo(id);
        return this._useGuide();
      case 'choose_sample':
        await this._echo(id);
        return this._chooseSample();
      case 'fresh': // 続きの選びの「はじめから」: 決めたことを全部やめて、1 歩目から
        this.freshNext = false;
        await this._echo(id);
        this.role = null;
        this.place = null;
        this.settings = null;
        this.auto = false;
        this.askBack = null;
        this.convert = null;
        this.input = null;
        this.check = null;
        this.character = null;
        this.skipped.clear();
        this.d.pin?.(null);
        return this.start();
      case 'other':
      case 'again':
        await this._echo(id);
        return this._restart();
      case 'keep':
        await this._echo(id);
        return this._persona();
      case 'fix':
        if (!p?.text) await this._echo(id);
        return this._fix(p);
      case 'persona_ok':
        await this._echo(id);
        return this._hello();
      case 'persona_edit': // 性格の画面で「これにする」を押した(payload.settings)
        return this._personaSaved(p);
      case 'persona_roll':
        await this._echo(id);
        return this._personaRoll();
      case 'to_retro':
        return this._retro();
      case 'say':
        return this._retroSay(p);
      case 'to_voice':
        return this._voice();
      case 'key':
        return this._key(p);
      case 'later':
        await this._echo(id);
        return this._later();
      case 'close':
        return this._finish();
      case 'begin': // 最後の「はなしてみる」: 押すと、作る画面を閉じて話す画面へ(押さなくても 8 秒で閉じる。index.js の FINISH_AUTO_MS)
        this.d.onBegin?.();
        return undefined;
      case 'place_name':
      case 'place_about':
      case 'place_skip':
        return this._placeAnswer(id, p);
      case 'want3d':
      case 'no3d':
        await this._echo(id);
        return id === 'want3d' ? this._askShape() : this._after2d();
      case 'conv_auto':
        await this._echo(id);
        this.convert = { shape: 'atama', material: 'fabric', auto: true };
        return this._sendConvert();
      default:
        if (id.startsWith('s_')) return this._pickSample(id.slice(2));
        if (id.startsWith('role_')) return this._roleAnswer(id.slice(5));
        if (id.startsWith('col_')) return this._colorAnswer(id.slice(4));
        if (id.startsWith('shp_')) return this._shapeAnswer(id.slice(4));
        if (id.startsWith('cs_')) return this._convShape(id.slice(3));
        if (id.startsWith('cm_')) return this._convMaterial(id.slice(3));
        return undefined;
    }
  }

  async _restart() {
    this.convert = null;
    this.input = null;
    this.check = null;
    this.character = null;
    this.skipped.clear();
    this.d.pin?.(null);
    this._go(1);
    await this._say({ who: 'guide', text: 'じゃあ、もう一度。どんな子を生み出そうか?' });
    this._offerStart();
  }

  async _resumeAt(n) {
    if (n <= 1) return this._restart();
    if (n === 3) return this.character ? this._meetAsk() : this._restart();
    if (n === 4) return this._persona();
    if (n === 5) return this._hello();
    if (n === 6) return this._retro();
    if (n === 7) return this._voice();
    return this._restart();
  }

  /* ---------- 1 → 2: 絵の入口 ---------- */
  async _fromPicture(kind, p) {
    if (!p?.url) {
      await this._say({ who: 'note', text: '絵が えらばれていないよ。' });
      return this._offerStart();
    }
    this.input = { from: 'picture', kind, url: p.url, name: clip(p.name, 40), ...(p.file ? { file: p.file } : {}) };
    const noun = kind === 'photo' ? '写真' : '絵'; // 撮った写真を「絵」と呼ばない
    // 選んだ絵は、札の上に出したままにする(会話の欄が流れても見える。司令塔の決め D3)。絵はこの端末の中だけ
    this.d.pin?.({ img: p.url, caption: kind === 'photo' ? '撮った写真' : '選んだ絵' });
    await this._say({ who: 'user', text: kind === 'photo' ? '(写真を撮った)' : '(絵を選んだ)', img: p.url });
    this._go(2);
    if (this.d.creator.mode === 'sample' && this.d.creator.canDraw && this.input.file) {
      // ブラウザから描ける設定(サーバーの YC_BROWSER_DRAW=1): 絵を Claude に見せて描いてもらう。どこへ送るかを先に言う
      await this._say(
        { who: 'guide', text: `${noun}を ありがとう!` },
        { who: 'note', text: `${noun}は、この サーバーから Claude(Anthropic)に 送って、ゆるキャラの 絵に するよ。` },
      );
      return this._meet();
    }
    if (this.d.creator.mode === 'sample') {
      // 見本の道: この画面は絵を見られない(どこにも送らない)。正直に言い、色と形を聞いて、いちばん近い見本を出す(UIR 2)
      await this._say(
        { who: 'guide', text: `${noun}を ありがとう!` },
        { who: 'note', text: PICTURE_ASK.replace('絵を', `${noun}を`) },
        { who: 'note', text: `${noun}は どこにも 送らないよ。` },
        { who: 'guide', text: 'いちばん 多い 色は?' },
      );
      return this._offer(COLOR_CHIPS.map((c, i) => ({ id: `col_${c.id}`, label: c.label, primary: i === 0 })));
    }
    await this._say({ who: 'guide', text: `${noun}を 見てみるね。ちょっと まってて。` });
    const result = await this._long(this.d.creator.check(this.input));
    return this._afterCheck(result);
  }

  async _afterCheck(result) {
    this.check = { class: result?.class ?? 'complex', by: result?.by ?? 'claude', message: result?.message ?? '' };
    const sample = this.d.creator.mode === 'sample';
    const noun = this.input?.kind === 'photo' ? '写真' : '絵';
    if (this.check.class === 'yuru') {
      if (sample) {
        // この画面では絵から作れない。「この絵から作るよ」とは言わず、正直に言う(_meet → 見本の道は絵に null → _noMatch)
        // 絵は見ていない(この画面は見本を出すだけ)ので、ほめない。選んでくれた事だけ受け取る
        await this._say({ who: 'guide', text: 'ゆるキャラなんだね。教えてくれてありがとう。' });
        return this._meet();
      }
      await this._say({ who: 'guide', text: 'ゆるキャラに ぴったりの絵だね。この絵から 作るよ。' });
      return this._offer([{ id: 'next_meet', label: 'つぎへ', primary: true }]);
    }
    if (this.check.class === 'human') {
      await this._say(
        { who: 'guide', text: `人の${noun}なんだね。ゆるキャラに してみる?` },
        sample
          ? { who: 'note', text: 'パソコンの Claude Code なら、かみや 服の色を いかして 描きなおせるよ。' }
          : { who: 'note', text: 'かみや 服の色を いかして、ゆるキャラに 描きなおすよ。' },
        { who: 'note', text: 'どんな写真でも きれいに できるわけでは ないよ。' },
      );
      return this._offer([
        { id: 'yurufy', label: 'ゆるキャラに してみる', primary: true },
        { id: 'other', label: `べつの${noun}にする` },
      ]);
    }
    await this._say({ who: 'guide', text: 'いろんな物が うつってるね。主役を 1 つ えらんで 描きなおす?' });
    return this._offer([
      { id: 'redraw', label: '主役を 描きなおす', primary: true },
      { id: 'other', label: `べつの${noun}にする` },
    ]);
  }

  async _colorAnswer(c) {
    const chip = COLOR_CHIPS.find((x) => x.id === c);
    if (!chip) return undefined;
    await this._say({ who: 'user', text: chip.label });
    this.input = { ...(this.input ?? { from: 'picture' }), colors: c === 'black' ? ['black', 'gray'] : [c] };
    await this._say({ who: 'guide', text: 'かたちは?' });
    return this._offer(SHAPE_CHIPS.map((s, i) => ({ id: `shp_${s.id}`, label: s.label, primary: i === 0 })));
  }

  async _shapeAnswer(s) {
    const chip = SHAPE_CHIPS.find((x) => x.id === s);
    if (!chip) return undefined;
    await this._say({ who: 'user', text: chip.label });
    this.input = { ...(this.input ?? { from: 'picture' }), shape: s };
    return this._meet();
  }

  /* ---------- 1 → 3: 言葉の入口(チェックは絵のときだけ) ---------- */
  async _fromWords(p, { echo = true } = {}) {
    const words = clip(p?.text, WORDS_MAX);
    if (!words) {
      await this._say({ who: 'note', text: 'どんな子か、ことばで 書いてね。' });
      return this._offerStart();
    }
    this.input = { from: 'words', words };
    if (echo) await this._say({ who: 'user', text: words });
    else await this._say({ who: 'note', text: `「${words}」で つくるよ。` });
    this.skipped.add(2);
    return this._meet();
  }

  /* ---------- 3: できた子 ---------- */
  async _meet() {
    this._go(3);
    const made = await this._long(this.d.creator.make(this.input ?? { from: 'words', words: '' }, { onProgress: (text) => this._say({ who: 'note', text }) }));
    if (!made) return this._noMatch(); // 見本の一覧が空の時だけ
    this.character = made;
    if (made.drawn) {
      // ブラウザから描けた子: もう動く 2D になっている。その場で舞台に出す(B4 12b)
      await this._say({ who: 'guide', text: 'こんな子が できたよ! うごく 2D で 舞台に 出すね。' });
      return this._show();
    }
    if (made.drawFailed) await this._say({ who: 'note', text: `${made.drawFailed}。にた 見本の子を 出すね。` });
    if (made.sample) {
      // いつも いちばん近い子を出す。ぴったりの時だけ「近い子が いたよ」、ほかは「ぴったりではないけど」(UIR 1・2)
      await this._say(
        { who: 'guide', text: made.exact ? '見本の中に、近い子が いたよ!' : NEAR_ENOUGH },
        { who: 'note', text: `見本: ${made.name}`, ...(made.img ? { img: made.img } : {}) },
      );
    }
    return this._show();
  }

  /** できた子・選んだ見本を舞台に出して、3 歩目の「この子はどうかな?」へ。舞台はその場で替える(読み込み直さない。D2) */
  async _show() {
    const stay = await (this.d.showCharacter?.(this.character) ?? true);
    if (stay === false) {
      this.d.save?.(this.snapshot());
      return undefined; // 読み込み直しの後、resume が続ける(前の作り。今の入口は読み込み直さない)
    }
    return this._meetAsk();
  }

  /** 近い見本がいない: 正直に言い、ほかの道(案内役で続ける・見本から選ぶ・パソコンでの作り方)を出す。だまって見本を選ばない(D1) */
  async _noMatch() {
    this._go(3);
    this.character = null;
    const picture = this.input?.from === 'picture';
    // 写真・絵の道は、2 歩目で限界を言ってある(くり返さない)。言葉の道は、ここで初めて言う
    // 見本の一覧が空の時だけ来る(ふつうは make がいつも近い子を出す)。開発の言葉(Claude Code・つくりかた)は出さない(UIR 1)
    await this._say({ who: 'guide', text: picture ? `じゃあ、${PICTURE_TRY.replace(/^ここでは、/, '')}` : PICTURE_TRY });
    this._offerNoMatch();
  }

  _readmeAction() {
    return this.d.guideUrl ? [{ id: 'readme', kind: 'link', label: README_LABEL, aria: 'パソコンでの つくりかた', url: this.d.guideUrl }] : [];
  }

  _offerNoMatch() {
    const main = this.d.creator.main?.();
    const picture = this.input?.from === 'picture';
    this._offer([
      ...(main ? [{ id: 'use_guide', label: `${this.guideName}で ためす`, primary: true }] : []),
      { id: 'choose_sample', label: '見本から えらぶ', primary: !main },
      { id: 'again', label: 'やりなおす', aria: picture ? `やりなおす(べつの${this.input?.kind === 'photo' ? '写真' : '絵'}にする)` : 'やりなおす(ことばを かえる)' },
    ]);
  }

  /** 見本の子を、使う人が自分で選ぶ(だまって選ばない) */
  async _chooseSample() {
    const list = this.d.creator.list?.() ?? [];
    await this._say({ who: 'guide', text: 'どの子に 会ってみる?' });
    // 顔の小さな絵つきの札(UIR 10)。札は折り返して全部見せる(view の fr-cards)
    this._offer([...list.map((c) => ({ id: `s_${c.id}`, label: c.name, ...(c.img ? { img: c.img } : {}) })), { id: 'again', label: 'やりなおす' }]);
  }

  async _pickSample(id) {
    const c = (this.d.creator.list?.() ?? []).find((x) => x.id === id);
    if (!c) return this._chooseSample();
    this._go(3);
    this.character = c;
    await this._say({ who: 'user', text: c.name }, { who: 'note', text: `見本: ${c.name}`, ...(c.img ? { img: c.img } : {}) });
    return this._show();
  }

  /** 案内役(主役)で、4 歩目から続ける。主役も手で描いた絵から作った見本の子だと書く */
  async _useGuide() {
    const main = this.d.creator.main?.();
    if (!main) return this._chooseSample();
    this._go(3);
    this.character = main;
    await this._say(
      { who: 'note', text: `見本: ${main.name}(${main.note})` },
      { who: 'guide', text: main.id === MAIN_CHARACTER.id ? 'じゃあ、ノリーで つづけマス! 性格や あいさつを ためしてくだサイ。' : `じゃあ、${main.name}で つづけるね。` },
    );
    const stay = await (this.d.showCharacter?.(main) ?? true);
    if (stay === false) {
      this.d.save?.(this.snapshot());
      return undefined;
    }
    return this._persona();
  }

  async _meetAsk() {
    this._go(3);
    const c = this.character;
    await this._say({ who: 'guide', text: c?.sample ? `${c.name}だよ。この子は どうかな?` : c?.drawn ? 'この子で いい?' : 'こんな子が できたよ。どうかな?' });
    this._offer([
      { id: 'keep', label: 'この子にする', primary: true },
      ...(c?.sample ? [{ id: 'choose_sample', label: 'ほかの子を 見る' }] : [{ id: 'fix', label: 'なおしたい ところ', kind: 'text', max: NOTE_MAX, placeholder: '例: 耳を もっと 大きく', submit: '送る' }]),
      { id: 'again', label: 'やりなおす' },
    ]);
  }

  async _fix(p) {
    const c = this.character;
    if (c?.sample || typeof this.d.creator.review !== 'function') {
      // 行き止まりにしない: ここで変えられる物(性格と話し方)と、形や色を直せる道(PC の Claude Code)を言う(D2)
      await this._say(
        { who: 'guide', text: '見本の子の 形や色は、ここでは なおせないんだ。' },
        { who: 'guide', text: 'でも、性格と話し方は、次のステップで変えられるよ!' },
      );
      return this._offer([
        { id: 'keep', label: 'この子で 性格を きめる', primary: true },
        { id: 'choose_sample', label: 'ほかの子を 見る' },
        { id: 'again', label: 'やりなおす' },
      ]);
    }
    const note = clip(p?.text, NOTE_MAX);
    if (!note) return this._meetAsk();
    await this._say({ who: 'user', text: note });
    const r = await this._long(this.d.creator.review(c.id, 'redo', note));
    await this._say({ who: 'guide', text: r?.ok ? 'パソコンの Claude Code に つたえたよ。なおったら 見せるね。' : `うまく つたえられなかったみたい(${r?.message ?? 'りゆうは わからない'})。` });
    return this._offer([
      { id: 'keep', label: 'この子にする', primary: true },
      { id: 'again', label: 'やりなおす' },
    ]);
  }

  /* ---------- 4: 性格(初めはランダム) ---------- */
  async _persona() {
    this._go(4);
    const id = this.character?.id ?? 'unknown';
    let s = this.d.persona.get(id);
    // その子の人格の文に性格が書いてあれば、それで始める(主役ノリーはおっとり)。無ければおまかせ(最初の設計の決め)
    if (!s) s = this.d.persona.initial?.(this.character) ?? this.d.persona.random(this.character);
    this.settings = this._withRole(s); // 1 つ目のステップで選んだ役目を足す
    this.d.persona.set(id, this.settings);
    this.d.onPersona?.(this.settings, this.character);
    await this._say(
      { who: 'guide', text: `この子、少し${PRESETS[this.settings.preset].short}みたい!` },
      { who: 'note', text: `${summary(this.settings)}に したよ。` },
    );
    this._offerPersona();
  }

  _offerPersona() {
    this._offer([
      { id: 'persona_ok', label: 'このままで いい', primary: true },
      { id: 'persona_edit', label: '性格を かえる', kind: 'persona' },
      { id: 'persona_roll', label: 'もう一度 ひく' },
    ]);
  }

  async _personaSaved(p) {
    this.settings = normalize(p?.settings ?? this.settings);
    this.role = this.settings.role; // 性格の画面で役目を替えたら、それに合わせる
    this.d.persona.set(this.character?.id ?? 'unknown', this.settings);
    this.d.onPersona?.(this.settings, this.character);
    await this._say(
      { who: 'guide', text: `${PRESETS[this.settings.preset].short}にしたよ。` },
      { who: 'note', text: `${summary(this.settings)}に したよ。` },
    );
    this._offerPersona();
  }

  async _personaRoll() {
    const keepVoice = this.settings?.voice;
    this.settings = this._withRole({ ...this.d.persona.random(this.character), ...(keepVoice ? { voice: keepVoice } : {}) });
    this.d.persona.set(this.character?.id ?? 'unknown', this.settings);
    this.d.onPersona?.(this.settings, this.character);
    await this._say(
      { who: 'guide', text: `うーん…この子、${PRESETS[this.settings.preset].short}かも!` },
      { who: 'note', text: `${summary(this.settings)}に したよ。` },
    );
    this._offerPersona();
  }

  /* ---------- 5: 初めてのあいさつ(頭脳の返事。仮の頭脳なら話し方だけ設定に合わせる) ---------- */
  async _hello() {
    this._go(5);
    await this._say({ who: 'guide', text: `じゃあ、${this.character?.name ?? 'この子'}に あいさつ してもらおう。` });
    await this._talk('はじめまして');
    this._offer([{ id: 'to_retro', label: 'つぎへ', primary: true }]);
  }

  async _talk(text) {
    // 頭脳の返事を待つ間は「…」の吹き出し(遅い回線で、返事が来るまで何も無いと、無視されているように見える。CU)
    this.d.thinking?.(true, { who: 'char', name: this.character?.name ?? 'この子' });
    let r;
    try {
      r = await this._long(this.d.talk(text, { character: this.character, settings: this.settings, history: this.history }));
    } finally {
      this.d.thinking?.(false);
    }
    const raw = (r?.lines ?? []).map((l) => l.text);
    const lines = r?.brain === 'mock' && !r?.safety ? styleLines(raw, this.settings) : raw;
    const first = r?.lines?.[0] ?? {};
    this.history.push({ role: 'user', content: text }, { role: 'assistant', content: lines.join('') });
    this.history = this.history.slice(-12);
    await this._say({ who: 'char', text: lines.join('') || '……', expression: first.expression, motion: first.motion, voice: true });
    if (r?.notice) await this._say({ who: 'note', text: r.notice });
    else if (r?.brain === 'mock' && !r?.safety && !this.mockNoted) {
      this.mockNoted = true;
      await this._say({ who: 'note', text: MOCK_NOTE });
    }
    return lines;
  }

  /* ---------- 6: 声が無ければ、文字送りとレトロな音で話す ---------- */
  async _retro() {
    // 「声がまだなら」: ElevenLabs の声(サーバーか使う人の鍵)か、選んだ声の出し方で、本物の声が出せるなら、とばす
    const v = this.d.voice;
    if (v.realVoice('elevenlabs') || v.realVoice(this.settings?.voice?.provider)) {
      this.skipped.add(6);
      return this._voice();
    }
    this._go(6);
    await this._say(
      { who: 'guide', text: 'まだ 声が出せないから、文字と レトロな音で 話すね。' },
      { who: 'guide', text: 'なにか 話しかけてみて!' },
    );
    this._offerRetro();
  }

  _offerRetro() {
    this._offer([
      { id: 'say', label: '話しかける', kind: 'text', placeholder: '例: 好きな食べ物は なに?', max: SAY_MAX, submit: '送る', primary: true },
      { id: 'to_voice', label: 'つぎへ' },
    ]);
  }

  async _retroSay(p) {
    const text = clip(p?.text, SAY_MAX);
    if (!text) return this._offerRetro();
    await this._say({ who: 'user', text });
    await this._talk(text);
    this._offerRetro();
  }

  /* ---------- 7: 声。鍵を入れると、本物の声で「ありがとう」 ---------- */
  async _voice() {
    this._go(7);
    const v = this.d.voice;
    if (v.realVoice('elevenlabs')) {
      this._useVoice();
      await this._say(
        { who: 'guide', text: 'この画面は、もう 声が出せるよ。声で 話してもらおう。' },
        { who: 'char', text: '声でも話せるよ。よろしくね!', voice: true },
      );
      return this._offer([{ id: 'close', label: 'つぎへ', primary: true }]);
    }
    if (!v.canTakeKey()) {
      await this._say(
        { who: 'char', text: 'いつか、本物の声で 話してみたいな。' },
        { who: 'guide', text: 'こえの かぎは、まだこの画面につながっていないんだ。' },
      );
      return this._offer([{ id: 'close', label: 'つぎへ', primary: true }]);
    }
    await this._say(
      { who: 'char', text: 'ねえ、本物の声で 話してみたいな。' },
      { who: 'guide', text: 'こえの かぎを 入れると、本物の声に なるよ。' },
      { who: 'guide', text: 'かぎは、おうちの人や 係の人が 知っているよ。なくても 文字で 話せるよ。' },
      { who: 'note', text: 'かぎは この スマホの 中だけで 使うよ。声を だすと、文字が 声の会社に 送られて、お金が かかるよ。' },
    );
    this._offerKey();
  }

  _offerKey() {
    this._offer([
      { id: 'key', label: 'かぎを入れる', kind: 'key', remember: Boolean(this.d.voice.canRemember?.()), primary: true },
      // 札の右上の「あとで」(初めての会話ごと閉じる)と同じ名前にしない(撮影の練習で、7 歩目に「あとで」が 2 つ並んでいた)
      { id: 'later', label: 'かぎなしで つづける' },
    ]);
  }

  _useVoice() {
    if (!this.settings) return;
    this.settings = normalize({ ...this.settings, voice: { ...this.settings.voice, provider: 'elevenlabs' } });
    this.d.persona.set(this.character?.id ?? 'unknown', this.settings);
    this.d.onPersona?.(this.settings, this.character);
  }

  async _key(p) {
    const key = String(p?.key ?? '');
    if (!key.trim()) {
      await this._say({ who: 'note', text: 'かぎが からっぽだよ。かぎを入れてね。' });
      return this._offerKey();
    }
    const r = await this._long(this.d.voice.useKey(key.trim(), { remember: Boolean(p?.remember) }));
    if (!r?.ok) {
      await this._say({ who: 'char', text: 'うまくいかなかったみたい。' }, { who: 'note', text: r?.message ?? 'かぎを たしかめてね。' });
      return this._offerKey();
    }
    this._useVoice();
    await this._say({ who: 'char', text: VOICE_THANKS, voice: true, expression: 'happy', motion: 'wave' });
    await this._say({ who: 'note', text: '本物の声で 話したよ。' });
    return this._offer([{ id: 'close', label: 'つぎへ', primary: true }]);
  }

  async _later() {
    await this._say({ who: 'char', text: 'じゃあ、文字とレトロな音で話そうね。' });
    return this._offer([{ id: 'close', label: 'つぎへ', primary: true }]);
  }

  async _finish() {
    this.done = true;
    clearTimeout(this.frameTimer);
    this._go(8);
    const c = this.character;
    const away = Boolean(c?.id) && c.id !== this.guide.id; // 選んだ子は舞台に立ったまま(Q-0111)。「ノリーにもどす」で戻せる
    const lines = [{ who: 'guide', text: this.nori ? 'じゅんび できマシタ! いっぱい 話してあげてくだサイ。' : 'じゅんび できたよ! いっぱい 話してあげてね。' }];
    // 決めたことを見せる(おまかせの時は、おまかせの文で言い終わっている)
    if (!this.auto && c?.name) {
      lines.push({ who: 'note', text: this.settings ? `${c.name}は、${summary(this.settings)}だよ。` : `きめた子: ${c.name}` });
      lines.push({ who: 'note', text: 'ぜんぶ、あとから かえられるよ。' });
    }
    if (away && c.local && !c.twod) lines.push({ who: 'note', text: `${c.name}の 3D は、パソコンの Claude Code で つくれるよ(約 20 分)。それまでは、${this.guideName}が 舞台に 立つよ。` });
    if (away && c.local && c.twod) lines.push({ who: 'note', text: c.want3d ? `${c.name}は 2D で 舞台に いるよ。3D の ちゅうもんは 書いたよ。3D は まだ できていないよ。` : `${c.name}は 2D で 舞台に いるよ。` });
    if (away && !c.local) lines.push({ who: 'note', text: `${c.name}は、舞台に立ったままだよ。${this.guideName}にもどしたい時は、「${this.guideName}にもどす」を押してね。` });
    await this._say(...lines);
    this._offer([{ id: 'begin', label: 'はなしてみる', primary: true }]);
    this.d.onDone?.();
  }

  /* ---------- 手元の PC の作る道: 作る画面(枠)からの知らせで進む ---------- */

  /** 作る画面からの知らせ(creators.js の cleanMakeEvent を通した物)を、順に受ける */
  makeEvent(ev) {
    this.makeQueue = this.makeQueue.then(() => this._onMake(ev)).catch(async (err) => {
      await this._say({ who: 'note', text: `うまく すすめなかったよ(${err?.message ?? err})` });
    });
    return this.makeQueue;
  }

  async _onMake(ev) {
    if (!this.local || this.done || !ev) return;
    // 2D ができた・変換の絵の知らせは、性格のステップに進んだ後でも受ける(3D の選びは、どのステップの後でもよい)
    if (ev.ev === 'twod') return this._twodReady(ev);
    if (ev.ev === 'converted') return this._converted(ev);
    if (this.step > 3) return;
    switch (ev.ev) {
      case 'ready':
        this.frameReady = true;
        clearTimeout(this.frameTimer);
        return undefined;
      case 'sent':
        if (ev.auto) this.auto = true;
        if (ev.from === 'words') {
          this.input = { from: 'words', words: clip(ev.words, WORDS_MAX) };
          await this._say({ who: 'user', text: this.input.words });
          this.skipped.add(2);
          this._go(3);
        } else {
          this.input = { from: 'picture' };
          await this._say({ who: 'user', text: '(絵を わたした)' });
          this._go(2);
        }
        // 動かし方(パソコンで打つこと)は、作る画面の中に書いてある。ここでは子どもの言葉だけ
        return this._say({ who: 'guide', text: 'パソコンの Claude Code に わたしたよ。描きはじめるまで、少し まってね。' });
      case 'progress':
      case 'error':
        if (!ev.text || this.progressSeen.has(ev.text)) return undefined;
        this.progressSeen.add(ev.text);
        return this._say({ who: 'note', text: ev.text });
      case 'checked':
        return this._checkedLocal(ev);
      case 'chose':
        await this._say({ who: 'user', text: ev.choice === 'redraw' ? '主役を 描きなおす' : 'ゆるキャラに してみる' });
        return this._say({ who: 'guide', text: 'パソコンの Claude Code に つたえたよ。描けたら 見せるね。' });
      case 'drawn':
        this._go(3);
        this.character = { id: ev.id, name: ev.name, sample: false, local: true, round: ev.round, note: this.d.creator.note ?? '' };
        return this._say(
          { who: 'guide', text: ev.round > 1 ? 'なおしてみたよ。どうかな?' : 'こんな子が できたよ。どうかな?' },
          // 描き直しで、頼んでいない所も変わってしまった時は、隠さずに言う(N-0026)
          ...(ev.round > 1 && ev.drift ? [{ who: 'note', text: ev.drift }] : []),
          // 眉の無い絵: 作る画面のおすすめの札を、札の言葉でも知らせる(本人 11/7)
          ...(ev.noBrows ? [{ who: 'note', text: 'おすすめ: 眉を 足すと、気持ちが ぐっと つたわるよ。下の画面で えらべるよ。' }] : []),
          { who: 'note', text: '下の画面で「この子にする」か「直したい」を えらんでね。' },
        );
      case 'decided':
        if (ev.decision === 'redo') {
          await this._say({ who: 'user', text: ev.note || '(なおしたい)' });
          return this._say({ who: 'guide', text: 'パソコンの Claude Code に つたえたよ。なおったら 見せるね。' });
        }
        if (ev.id && this.character?.id !== ev.id) this.character = { id: ev.id, name: ev.name, sample: false, local: true, round: ev.round, note: this.d.creator.note ?? '' };
        {
          const name = this.character?.name ?? 'この子';
          // 描いた絵は札の上に出したまま。すぐに動く 2D にして舞台に出す(B4 12b。パソコンが部品から 2D を組む。数秒)
          this.d.pin?.({ frame: this.d.creator.picUrl ?? null, caption: `${name}(パソコンの Claude Code が描いた絵)` });
          if (ev.auto) this.auto = true;
          this.waiting2d = true;
          await this._say({ who: 'guide', text: `${name}に けってい! いま、うごく 2D に して 舞台に 出すよ。` });
          if (this.twodEarly) return this._twodReady(this.twodEarly);
          // 2D が来ない時(パソコンの作る道が止まっている)でも行き止まりにしない: 先に性格へ進める
          return this._offer([{ id: 'keep', label: 'さきに 性格を きめる' }]);
        }
      case 'restart':
        this.input = null;
        this.check = null;
        this.character = null;
        this.skipped.clear();
        this.d.pin?.(null);
        this._go(1);
        return this._say({ who: 'guide', text: 'じゃあ、もう一度。どんな子を生み出そうか?' });
      default:
        return undefined;
    }
  }

  /** パソコンが 2D を組んだ(characters/<id>/2d と looks.2d)。舞台に出して、3D にもするかを聞く */
  async _twodReady(ev) {
    if (!this.character || (ev.id && ev.id !== this.character.id)) {
      if (ev.id) this.twodEarly = ev; // 決める前に届いた(順番の入れ違い)。決めた時に使う
      return undefined;
    }
    if (this.character.twod) return undefined;
    this.character = { ...this.character, twod: true };
    const stay = await (this.d.showCharacter?.(this.character) ?? true);
    if (stay === false) {
      this.d.save?.(this.snapshot());
      return undefined;
    }
    const at3 = this.step <= 3;
    await this._say({ who: 'guide', text: stay === 'failed' ? `${this.character.name}は 舞台に まだ 出られないよ。ここで 先に すすめるね。` : `${this.character.name}が 舞台に でたよ! まばたきも するよ。` });
    this.waiting2d = false;
    if (this.auto) {
      // おまかせ: 2D のまま進む(3D は あとから えらべる)
      await this._say({ who: 'note', text: '3D は あとから えらべるよ。' });
      return at3 ? this._omakaseRest() : undefined;
    }
    if (!at3) return undefined; // 性格に進んだ後に届いた: 舞台に出すだけ(今の選びを消さない)
    await this._say({ who: 'guide', text: ASK_3D }, { who: 'note', text: '2D なら すぐ。3D は あとからでも えらべるよ。' });
    return this._offer([
      { id: 'want3d', label: '3D にも する', primary: true },
      { id: 'no3d', label: 'いまは 2D だけ' },
    ]);
  }

  /** 3D 用のゆるキャラ変換: 形を見本の絵で選ぶ(全国の調べの型。既定 あたまでっかち) */
  async _askShape() {
    await this._say({ who: 'note', text: CONVERT_NOTE }, { who: 'guide', text: 'どんな かたちに する?' });
    return this._offer([
      { id: 'cs_atama', label: 'あたまでっかち', img: SHAPE_THUMBS.atama, primary: true },
      { id: 'cs_maru', label: 'まるい どう', img: SHAPE_THUMBS.maru },
      { id: 'conv_auto', label: OMAKASE_CHIP, aria: 'おまかせ(あたまでっかちで ぬの)', noAuto: true },
    ]);
  }

  async _convShape(shape) {
    if (!['atama', 'maru'].includes(shape)) return this._askShape();
    await this._echo(`cs_${shape}`);
    this.convert = { shape, material: null };
    await this._say({ who: 'guide', text: 'さわった かんじ(しつかん)は?' });
    return this._offer([
      { id: 'cm_fabric', label: 'ぬの', img: MATERIAL_THUMBS.fabric, primary: true },
      { id: 'cm_fur', label: 'け', img: MATERIAL_THUMBS.fur },
      { id: 'cm_vinyl', label: 'つるつる', img: MATERIAL_THUMBS.vinyl },
      { id: 'conv_auto', label: OMAKASE_CHIP, aria: 'おまかせ(ぬの)', noAuto: true },
    ]);
  }

  async _convMaterial(material) {
    if (!['fabric', 'fur', 'vinyl'].includes(material)) return this._askShape();
    await this._echo(`cm_${material}`);
    this.convert = { shape: this.convert?.shape ?? 'atama', material };
    return this._sendConvert();
  }

  /** 選んだ形と しつかんを、パソコンの作る画面(枠)に渡す。枠が変換の絵を頼み、描けたら見せて OK を受ける */
  async _sendConvert() {
    const c = this.convert ?? { shape: 'atama', material: 'fabric' };
    if (!c.material) c.material = 'fabric';
    this.convert = c;
    await this._say({ who: 'guide', text: 'ゆるキャラの かたちの 絵を 1 まい 描くよ。描けたら 下で 見てね。' });
    const q = `&view=convert&cid=${encodeURIComponent(this.character?.id ?? '')}&shape=${c.shape}&mat=${c.material}`;
    return this._offer([
      { id: 'frame', kind: 'frame', label: 'ゆるキャラの かたちの 絵', url: `${this.d.creator.frameUrl}${q}` },
      { id: 'no3d', label: 'いまは 2D だけ' },
    ]);
  }

  /** 変換の絵を OK した(3D はパソコンで make-character)・描き直したい */
  async _converted(ev) {
    if (!this.character || (ev.id && ev.id !== this.character.id)) return undefined;
    if (ev.again) {
      await this._say({ who: 'user', text: 'ちがう かたちに する' });
      return this._askShape();
    }
    this.character = { ...this.character, want3d: true, convert: { ...this.convert } };
    await this._say(
      { who: 'user', text: 'この かたちで 3D に する' },
      { who: 'guide', text: 'この かたちで 3D の ちゅうもんを 書くね。3D は まだ できていないよ。' },
      { who: 'note', text: 'それまでは 2D で 話せるよ。' },
    );
    return this._after2d();
  }

  /** 2D のまま、性格のステップへ */
  async _after2d() {
    if (this.step > 3) return undefined;
    return this.auto ? this._omakaseRest() : this._persona();
  }

  async _checkedLocal(ev) {
    this._go(2);
    this.check = { class: ev.class, by: ev.by, message: ev.message };
    if (ev.by === 'pixels') await this._say({ who: 'note', text: 'きめるのが むずかしかったので、絵の 色や形で きめたよ。ちがったら「べつの絵にする」を えらんでね。' });
    if (ev.class === 'yuru') return this._say({ who: 'guide', text: 'ゆるキャラに ぴったりの絵だね。この絵から 作るよ。' });
    if (ev.class === 'human') {
      return this._say(
        { who: 'guide', text: '人の絵なんだね。ゆるキャラに してみる?' },
        { who: 'note', text: 'かみや 服の色を いかして、ゆるキャラに 描きなおすよ。' },
        { who: 'note', text: 'どんな写真でも きれいに できるわけでは ないよ。下の画面で えらんでね。' },
      );
    }
    return this._say(
      { who: 'guide', text: 'いろんな物が うつってるね。主役を 1 つ えらんで 描きなおす?' },
      { who: 'note', text: '下の画面で えらんでね。' },
    );
  }

  /** 読み込み直しをまたいで続けるための、小さな状態(絵そのものと、絵の URL は残さない) */
  snapshot() {
    return {
      v: SNAPSHOT_VERSION,
      step: this.step,
      from: this.input?.from ?? null,
      words: this.input?.from === 'words' ? this.input.words : null,
      check: this.check,
      character: this.character ? { id: this.character.id, name: this.character.name, sample: Boolean(this.character.sample), ...(this.character.local ? { local: true } : {}), ...(this.character.twod ? { twod: true } : {}), note: this.character.note ?? '' } : null,
      skipped: [...this.skipped],
      ...(this.settings ? { settings: this.settings } : {}),
      ...(this.auto ? { auto: true } : {}),
      ...(this.role ? { role: this.role } : {}),
      ...(this.place ? { place: this.place } : {}),
    };
  }

  /** snapshot から続ける(3 歩目の「この子はどうかな?」か、残した歩みから) */
  async resume(snap) {
    if (!snap || snap.v !== SNAPSHOT_VERSION) return this.start();
    this.input = snap.from ? { from: snap.from, words: snap.words ?? '' } : null;
    this.check = snap.check ?? null;
    if (snap.role) this.role = normalizeRole(snap.role);
    if (snap.place) this.place = { name: clip(snap.place.name, PLACE_MAX), about: clip(snap.place.about, PLACE_MAX) };
    for (const n of snap.skipped ?? []) this.skipped.add(n);
    if (!snap.character?.id) {
      // 子を選ぶ前でも、言葉を入れた後(3 歩目)なら、言葉は残っているので、同じ言葉で見本を出し直す。絵は残していないので 1 歩目から
      if (snap.reload && snap.step >= 3 && snap.from === 'words' && snap.words) {
        this._go(3);
        await this._say({ who: 'guide', text: this.nori ? 'おかえりなサイ! さっきの つづきからだよ。' : 'おかえり! さっきの つづきからだよ。' });
        this.freshNext = true;
        return this._meet();
      }
      return this.start();
    }
    this.character = { ...snap.character };
    if (snap.settings) this.settings = normalize(snap.settings);
    if (snap.auto === true) return this._omakaseRest(); // おまかせの途中で読み込み直した: 続きもおまかせ
    if (snap.reload) {
      const n = Math.min(STEPS.length, Math.max(3, snap.step || 3));
      this._go(n);
      await this._say({ who: 'guide', text: this.nori ? 'おかえりなサイ! さっきの つづきからだよ。' : 'おかえり! さっきの つづきからだよ。' });
      this.freshNext = true;
      return this._resumeAt(n);
    }
    return this._meetAsk();
  }
}

/** 試験と画面で使う: 文字数の上限(一言 40 字など)。絵文字も 1 字 */
export const countChars = chars;
