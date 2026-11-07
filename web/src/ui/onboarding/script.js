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

/** 決めたことを、子どもが読める言葉で 1 行にする(「元気さ」「レトロ音」「ElevenLabs」は使わない) */
const KID_TONE = { own: 'この子らしい 話し方', friendly: 'なかよしの 話し方', polite: 'ていねいな 話し方' };
const KID_VOICE = { none: '文字と おと', browser: 'この スマホの 声', elevenlabs: '本物の 声' };
function summary(settings) {
  const s = normalize(settings);
  const tone = s.tone === 'ending' ? `語尾「${s.ending}」` : KID_TONE[s.tone] ?? KID_TONE.friendly;
  return `${PRESETS[s.preset].label}・${tone}・げんき ${s.energy}・${LENGTHS[s.length].label}・${KID_VOICE[s.voice.provider] ?? KID_VOICE.none}`;
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
/** 仮の頭脳で話している時の、子ども向けの知らせ(くわしい言い方は性格の画面) */
export const MOCK_NOTE = 'いまは おためしの あたまで 話しているよ。話し方だけ 性格に あわせているよ。';

const chars = (s) => [...String(s ?? '')].length;
const clip = (s, n) => [...String(s ?? '').trim()].slice(0, n).join('');

/** おまかせのくわしい名前(読み上げと、押した時の右の吹き出し)。どの歩みでも出す(本人 11/7: 全部オートでできるパターン) */
export const OMAKASE_LABEL = 'おまかせ(ぜんぶ じどう)';
/** おまかせの札に出す短い名前(札を 2 段に収める) */
export const OMAKASE_CHIP = 'おまかせ';
/** パソコンでの作り方(リンク)の札の名前 */
export const README_LABEL = 'つくりかた';
/** 歩みごとの、だいたいの秒(残りの時間の目安)。手元の PC で描く時は、3 歩目に描く時間を足す */
const STEP_SEC = { 1: 20, 2: 15, 3: 15, 4: 15, 5: 15, 6: 20, 7: 15 };
const DRAW_SEC = 240;

/**
 * いまの歩みから、あと いくつ・あと 何分 で おわるか(本人 11/7: すぐ終わるのに途中でやめる人がいるので、残りを見せる)。
 * 子どもにも分かる言葉で(上の細い段の「あと 4 つ」)。とばした歩み(言葉の時のチェックなど)は数えない
 * @returns {{left:number, main:string, time:string}}
 */
export function progressText(step, { skipped = [], local = false } = {}) {
  if (step > STEPS.length) return { left: 0, main: 'できあがり!', time: '' };
  const rest = STEPS.filter((s) => s.n >= Math.max(1, step) && !skipped.includes(s.n));
  const left = rest.filter((s) => s.n > step).length;
  const sec = rest.reduce((t, s) => t + STEP_SEC[s.n] + (local && s.n === 3 ? DRAW_SEC : 0), 0);
  return { left, main: left ? `あと ${left} つ` : 'これで さいご!', time: `${Math.max(1, Math.round(sec / 60))} 分くらい` };
}

/**
 * 1 歩目で案内役が最初に言う 2 文。案内役が主役(nori)のときは主役の口調で名乗る。主役を替えたら、この 1 文も替える。
 * サーバーの声の前もっての温め(S3 の ttsWarm)は、この関数の文を温める(文が食い違うと、最初の声が温め無しの +0.3〜0.5 秒になる)
 */
export function guideFirstLines(guideName, nori) {
  return [nori ? `はじめまして! ${guideName}デス。いっしょに ゆるキャラを 生み出しマス!` : `はじめまして。${guideName}だよ。いっしょに ゆるキャラを 生み出そう。`, 'どんな子を生み出そうか?'];
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
    this.busy = false;
    this.done = false;
    this.mockNoted = false;
    this.makeQueue = Promise.resolve(); // 作る画面の知らせを 1 つずつ順に受ける
    this.progressSeen = new Set();
    this.auto = false; // おまかせ(ぜんぶ じどう)で進めている
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
    await this.d.present(list, { step: this.step, character: this.character, settings: this.settings });
  }

  _offer(actions) {
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

  async _omakaseRest() {
    this.auto = true;
    if (!this.character) {
      const pick = this.d.creator.main?.() ?? (this.d.creator.list?.() ?? [])[0] ?? null;
      if (pick) {
        this.character = pick;
        if (this.step < 2) this.skipped.add(2); // 1 歩目からのおまかせはチェックをしていない(歩みの丸は「とばした」に)
        this._go(3);
        await this._say({ who: 'note', text: `おまかせ: ${pick.name}` });
        const stay = await (this.d.showCharacter?.(pick) ?? true);
        if (stay === false) {
          this.d.save?.(this.snapshot());
          return undefined; // 読み込み直しの後、resume がおまかせの続きをする
        }
      }
    }
    this._go(4);
    const id = this.character?.id ?? 'unknown';
    let s = this.d.persona.get(id);
    if (!s) {
      s = this.d.persona.initial?.(this.character) ?? this.d.persona.random(this.character);
      this.d.persona.set(id, s);
    }
    this.settings = normalize(s);
    this.d.onPersona?.(this.settings, this.character);
    for (const n of [5, 6, 7]) if (this.step < n) this.skipped.add(n);
    await this._say(
      { who: 'guide', text: this.nori ? 'おまかせで、ぜんぶ きめマシタ!' : 'おまかせで、ぜんぶ きめたよ!' },
      { who: 'note', text: `きめたこと: ${this.character?.name ?? 'この子'}・性格「${summary(this.settings)}」` },
      { who: 'note', text: 'ぜんぶ、あとから かえられるよ。' },
    );
    return this._finish();
  }

  /** 押された物を受け取る。今出している選択肢に無い物(古いボタン)と、動いている最中の 2 回押しは捨てる */
  async act(id, payload = {}) {
    if (this.busy || (this.done && id !== 'begin')) return false;
    if (!this.actions.some((a) => a.id === id)) return false;
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
    const sample = this.d.creator.mode === 'sample';
    // 案内役が主役のときは、主役(ノリー)の口調で名乗る。主役を替えたら、この 1 文も替える
    await this._say(
      ...guideFirstLines(this.guideName, this.nori).map((text) => ({ who: 'guide', text })),
      sample ? { who: 'note', text: 'ここでは、見本の子で ためせるよ。' } : null,
      this.local ? { who: 'note', text: '下の 作る画面に、ことばか 絵を 入れてね。' } : null,
      this.local ? { who: 'note', text: 'パソコンの Claude Code が 描くよ。ことばと絵は Claude(Anthropic)に 送られるよ。' } : null,
    );
    this._offerStart();
  }

  _offerStart() {
    if (this.local) {
      this._offer([{ id: 'frame', kind: 'frame', label: 'PC の作る画面', url: this.d.creator.frameUrl }]);
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
    this._offer([
      { id: 'photo', label: '写真を撮る', kind: 'file', capture: true },
      { id: 'pick', label: '絵を選ぶ', kind: 'file' },
      { id: 'words', label: 'ことばで 書く', kind: 'text', placeholder: '例: 赤い ちょうちんの子', max: WORDS_MAX, submit: '送る', primary: true },
      // 「パソコンでの つくりかた」は、見本がいない時と「なおしたい」の時に出す(1 歩目の押す札を 1 段にして、会話を広く。OL1。前は CRITux 1 で 1 歩目にも出した)
    ]);
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
      case 'begin': // 最後の「はじめる」: 札を閉じるのは、使う人が押した時だけ
        this.d.onBegin?.();
        return undefined;
      default:
        if (id.startsWith('s_')) return this._pickSample(id.slice(2));
        return undefined;
    }
  }

  async _restart() {
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
    this.input = { from: 'picture', kind, url: p.url, name: clip(p.name, 40) };
    const noun = kind === 'photo' ? '写真' : '絵'; // 撮った写真を「絵」と呼ばない
    // 選んだ絵は、札の上に出したままにする(会話の欄が流れても見える。司令塔の決め D3)。絵はこの端末の中だけ
    this.d.pin?.({ img: p.url, caption: kind === 'photo' ? '撮った写真' : '選んだ絵' });
    await this._say({ who: 'user', text: kind === 'photo' ? '(写真を撮った)' : '(絵を選んだ)', img: p.url });
    this._go(2);
    if (this.d.creator.mode === 'sample') {
      // 見本の道の限界は、やさしく正直に、ここで 1 回だけ言う(この画面は写真を見ない・どこにも送らない。作れない時も、くり返さない)
      await this._say(
        { who: 'guide', text: `${noun}を ありがとう!` },
        { who: 'note', text: pictureLimit(noun) },
        { who: 'note', text: `この画面は ${noun}を見ないで、見本の子で ためすよ。どこにも 送らないよ。` },
        { who: 'guide', text: `この${noun}は、どれに近い?` },
      );
      return this._offer([
        { id: 'kind_yuru', label: 'ゆるキャラ', primary: true },
        { id: 'kind_human', label: '人' },
        { id: 'kind_complex', label: 'けしき・こまかい絵' },
      ]);
    }
    await this._say({ who: 'guide', text: `${noun}を 見てみるね。ちょっと まってて。` });
    const result = await this.d.creator.check(this.input);
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

  /* ---------- 1 → 3: 言葉の入口(チェックは絵のときだけ) ---------- */
  async _fromWords(p) {
    const words = clip(p?.text, WORDS_MAX);
    if (!words) {
      await this._say({ who: 'note', text: 'どんな子か、ことばで 書いてね。' });
      return this._offerStart();
    }
    this.input = { from: 'words', words };
    await this._say({ who: 'user', text: words }, { who: 'note', text: 'ことばから つくるから、チェックは とばすよ。' });
    this.skipped.add(2);
    return this._meet();
  }

  /* ---------- 3: できた子 ---------- */
  async _meet() {
    this._go(3);
    const made = await this.d.creator.make(this.input ?? { from: 'words', words: '' });
    if (!made) return this._noMatch(); // 見本の道で、言葉が見本に当たらない・絵(この画面では作れない)
    this.character = made;
    if (made.sample) {
      await this._say(
        { who: 'guide', text: '見本の中に、近い子が いたよ!' },
        { who: 'note', text: `見本: ${made.name}` },
        { who: 'note', text: 'ここでは 新しく描かずに、見本の子を 出すよ。' },
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
    await this._say(
      ...(picture
        ? [{ who: 'guide', text: `じゃあ、${PICTURE_TRY.replace(/^ここでは、/, '')}` }]
        : [{ who: 'guide', text: 'ごめんね。見本の中に、近い子が いないんだ。' }, { who: 'note', text: MAKE_STEPS }, { who: 'guide', text: PICTURE_TRY }]),
    );
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
      ...this._readmeAction(),
      { id: 'again', label: 'やりなおす', aria: picture ? `やりなおす(べつの${this.input?.kind === 'photo' ? '写真' : '絵'}にする)` : 'やりなおす(ことばを かえる)' },
    ]);
  }

  /** 見本の子を、使う人が自分で選ぶ(だまって選ばない) */
  async _chooseSample() {
    const list = this.d.creator.list?.() ?? [];
    await this._say({ who: 'guide', text: 'どの子に 会ってみる?' });
    this._offer([...list.map((c) => ({ id: `s_${c.id}`, label: c.name })), { id: 'again', label: 'やりなおす' }]);
  }

  async _pickSample(id) {
    const c = (this.d.creator.list?.() ?? []).find((x) => x.id === id);
    if (!c) return this._chooseSample();
    this._go(3);
    this.character = c;
    await this._say({ who: 'user', text: c.name }, { who: 'note', text: `見本: ${c.name}` });
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
    await this._say({ who: 'guide', text: c?.sample ? `${c.name}だよ。この子は どうかな?` : 'こんな子が できたよ。どうかな?' });
    this._offer([
      { id: 'keep', label: 'この子にする', primary: true },
      ...(c?.sample ? [{ id: 'fix', label: 'なおしたい' }] : [{ id: 'fix', label: 'なおしたい ところ', kind: 'text', max: NOTE_MAX, placeholder: '例: 耳を もっと 大きく', submit: '送る' }]),
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
        { who: 'note', text: 'パソコンの Claude Code で 作った子なら、ひとことで なおせるよ。' },
      );
      return this._offer([
        { id: 'keep', label: 'この子で 性格を きめる', primary: true },
        ...this._readmeAction(),
        { id: 'again', label: 'やりなおす' },
      ]);
    }
    const note = clip(p?.text, NOTE_MAX);
    if (!note) return this._meetAsk();
    await this._say({ who: 'user', text: note });
    const r = await this.d.creator.review(c.id, 'redo', note);
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
    if (!s) {
      // その子の人格の文に性格が書いてあれば、それで始める(主役ノリーはおっとり)。無ければおまかせ(最初の設計の決め)
      s = this.d.persona.initial?.(this.character) ?? this.d.persona.random(this.character);
      this.d.persona.set(id, s);
    }
    this.settings = normalize(s);
    this.d.onPersona?.(this.settings, this.character);
    await this._say(
      { who: 'guide', text: `この子、少し${PRESETS[this.settings.preset].short}みたい!` },
      { who: 'note', text: `性格: ${summary(this.settings)}` },
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
    this.d.persona.set(this.character?.id ?? 'unknown', this.settings);
    this.d.onPersona?.(this.settings, this.character);
    await this._say(
      { who: 'guide', text: `${PRESETS[this.settings.preset].short}にしたよ。` },
      { who: 'note', text: `性格: ${summary(this.settings)}` },
    );
    this._offerPersona();
  }

  async _personaRoll() {
    const keepVoice = this.settings?.voice;
    this.settings = normalize({ ...this.d.persona.random(this.character), ...(keepVoice ? { voice: keepVoice } : {}) });
    this.d.persona.set(this.character?.id ?? 'unknown', this.settings);
    this.d.onPersona?.(this.settings, this.character);
    await this._say(
      { who: 'guide', text: `うーん…この子、${PRESETS[this.settings.preset].short}かも!` },
      { who: 'note', text: `性格: ${summary(this.settings)}` },
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
    const r = await this.d.talk(text, { character: this.character, settings: this.settings, history: this.history });
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
    const r = await this.d.voice.useKey(key.trim(), { remember: Boolean(p?.remember) });
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
      lines.push({ who: 'note', text: `きめたこと: ${c.name}${this.settings ? `・性格「${summary(this.settings)}」` : ''}` });
      lines.push({ who: 'note', text: 'ぜんぶ、あとから かえられるよ。' });
    }
    if (away && c.local) lines.push({ who: 'note', text: `${c.name}の 3D は、パソコンの Claude Code で つくれるよ(約 20 分)。それまでは、${this.guideName}が 舞台に 立つよ。` });
    if (away && !c.local) lines.push({ who: 'note', text: `${c.name}は、舞台に立ったままだよ。${this.guideName}にもどしたい時は、「${this.guideName}にもどす」を押してね。` });
    await this._say(...lines);
    this._offer([{ id: 'begin', label: 'はじめる', primary: true }]);
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
    if (!this.local || this.done || !ev || this.step > 3) return;
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
          // 描いた絵は札の上に出したまま(枠を小さくして絵だけ見せる)。3D ができるまでは案内役が代わりに舞台に立つ(D5)
          this.d.pin?.({ frame: this.d.creator.picUrl ?? null, caption: `${name}(パソコンの Claude Code が描いた絵。3D はまだ)` });
          await this._say(
            { who: 'guide', text: `${name}に けってい! パソコンに つたえたよ。` },
            { who: 'note', text: '3D は、パソコンの Claude Code で つくれるよ(約 20 分)。' },
            { who: 'note', text: 'この画面からは まだ はじまらないよ。' },
            { who: 'note', text: `それまでは、${this.guideName}が かわりに 舞台に立って、${name}の ことばを 話すよ。` },
          );
        }
        // 作る画面で「おまかせ(ぜんぶ じどう)」を選んだ時は、性格から後もおすすめで決めて終わる
        return ev.auto || this.auto ? this._omakaseRest() : this._persona();
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
      character: this.character ? { id: this.character.id, name: this.character.name, sample: Boolean(this.character.sample), ...(this.character.local ? { local: true } : {}), note: this.character.note ?? '' } : null,
      skipped: [...this.skipped],
      ...(this.settings ? { settings: this.settings } : {}),
      ...(this.auto ? { auto: true } : {}),
    };
  }

  /** snapshot から続ける(3 歩目の「この子はどうかな?」か、残した歩みから) */
  async resume(snap) {
    if (!snap || snap.v !== SNAPSHOT_VERSION) return this.start();
    this.input = snap.from ? { from: snap.from, words: snap.words ?? '' } : null;
    this.check = snap.check ?? null;
    for (const n of snap.skipped ?? []) this.skipped.add(n);
    if (!snap.character?.id) {
      // 子を選ぶ前でも、言葉を入れた後(3 歩目)なら、言葉は残っているので、同じ言葉で見本を出し直す。絵は残していないので 1 歩目から
      if (snap.reload && snap.step >= 3 && snap.from === 'words' && snap.words) {
        this._go(3);
        await this._say({ who: 'guide', text: this.nori ? 'おかえりなサイ! さっきの つづきからだよ。' : 'おかえり! さっきの つづきからだよ。' });
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
      return this._resumeAt(n);
    }
    return this._meetAsk();
  }
}

/** 試験と画面で使う: 文字数の上限(一言 40 字など)。絵文字も 1 字 */
export const countChars = chars;
