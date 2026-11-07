// 初めての会話の台本(最初の設計の決めの 7 歩)。DOM を使わない進め方だけ(node の試験で、画面なしで最後まで通す)。
// 1 どんな子を生み出そうか? → 2 ゆるキャラチェック → 3 こんな子ができたよ → 4 性格 → 5 初めてのあいさつ
// → 6 声が無ければ文字送りとレトロ音 → 7 鍵を入れると「声が出せるようになったよ、ありがとう!」
// 画面・頭脳・声・作る道は、外から渡す(deps)。台本は「言う → 待つ → 選ばせる」をくり返すだけ。
// 作る道が 'local'(手元の PC)のときは、1〜3 歩が本当の作る道になる。入力と絵は PC が配る「作る画面」の枠の中だけで扱い
// (言葉か絵 → PC のゆるキャラチェック → 段 0 の絵 → C0 で「この子にする」か「直したい(一言)」= K3 の request.json → PC の /yuru-next)、
// 台本は枠からの知らせ(makeEvent)を受けて、案内役の言葉と歩みを進める。
// 見本の道(公開のリンクの既定)は新しく描かない。言葉が見本に本当に当たる時だけ見本を出し、当たらない言葉と絵には
// 「近い見本がいない」と正直に言って、PC の Claude Code での作り方を見せる(だまって見本を選ばない。司令塔の決め D1)。
import { PRESETS, summary, normalize } from '../persona/settings.js';
import { styleLines, MOCK_NOTICE } from '../persona/preview.js';
import { MAIN_CHARACTER } from '../../character/defaults.js'; // 主役の決まりは 1 か所(S5)。ここでは写さない

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
/** PC で新しい子を作る手順の短いまとめ(くわしくは README の節)。画面のコードに外の住所は書かない(privacy の試験) */
export const MAKE_STEPS = `PC での作り方: ① python creator/review/serve_review.py --make --web <会話の画面の元> を動かす ② PC のブラウザでその /qr の画面を開き、「この PC の初めての会話」のリンクから言葉か絵を入れる ③ Claude Code で /yuru-next と打つ(描くのに数分)。くわしくはリポジトリの README.md の「${README_SECTION}」。`;

const chars = (s) => [...String(s ?? '')].length;
const clip = (s, n) => [...String(s ?? '').trim()].slice(0, n).join('');

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
    this.log = []; // 試験と確かめのための、言った文の記録
  }

  /** 案内役。渡されなければ主役(MAIN_CHARACTER) */
  get guide() {
    return this.d.guide ?? MAIN_CHARACTER;
  }

  get guideName() {
    return this.guide.name || MAIN_CHARACTER.name;
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
    this.d.onStep?.(n, { skipped: [...this.skipped] });
  }

  /** 押された物を受け取る。今出している選択肢に無い物(古いボタン)と、動いている最中の 2 回押しは捨てる */
  async act(id, payload = {}) {
    if (this.busy || this.done) return false;
    if (!this.actions.some((a) => a.id === id)) return false;
    this.busy = true;
    this.d.offer([]); // 押した後は、次の選択肢が出るまでボタンを出さない
    try {
      await this._handle(id, payload);
      return true;
    } catch (err) {
      await this._say({ who: 'note', text: `うまく進めませんでした(${err?.message ?? err})` });
      this._offer(this._retryActions());
      return false;
    } finally {
      this.busy = false;
    }
  }

  _retryActions() {
    return [{ id: 'retry', label: 'もう一度', primary: true }, { id: 'finish', label: 'ここで終わる' }];
  }

  async start() {
    this._go(1);
    const sample = this.d.creator.mode === 'sample';
    // 案内役が主役のときは、主役(ノリー)の口調で名乗る。主役を替えたら、この 1 文も替える
    const nori = this.guide.id === MAIN_CHARACTER.id;
    await this._say(
      {
        who: 'guide',
        text: nori
          ? `はじめまして! 執事見習いの${this.guideName}デス。きみだけのゆるキャラを生み出すお手伝い、ノリー、がんばりマス!`
          : `はじめまして。${this.guideName}だよ。きみだけのゆるキャラを、いっしょに生み出そう。`,
      },
      { who: 'guide', text: 'どんな子を生み出そうか?' },
      sample ? { who: 'note', text: 'この画面では、もう作ってある見本の子を出します。新しく作るのは、手元の PC の Claude Code です。写真や絵は、この端末の外に送りません。' } : null,
      this.local ? { who: 'note', text: '下の「PC の作る画面」に、言葉か絵を入れてね。手元の PC の Claude Code が描きます(Claude が見るので、言葉と絵は Anthropic に送られます)。' } : null,
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
            this._say({ who: 'note', text: 'PC の作る画面が開けません。PC で serve_review.py --make --web <この画面の元> が動いているか確かめてね。' });
          }
        }, this.d.frameWaitMs ?? FRAME_WAIT_MS);
        this.frameTimer?.unref?.(); // node の試験で、待つ間に終われなくならないように
      }
      return;
    }
    this._offer([
      { id: 'photo', label: '写真を撮る', kind: 'file', capture: true },
      { id: 'pick', label: '絵を選ぶ', kind: 'file' },
      { id: 'words', label: '言葉で書く', kind: 'text', placeholder: '例: 赤い提灯の子', max: WORDS_MAX, submit: 'これで作る', primary: true },
      // 見本の道では、1 歩目から PC での作り方(README の節)へ 1 回で行けるようにする(CRITux 1)
      ...(this.d.creator.mode === 'sample' ? this._readmeAction() : []),
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
        return this._afterCheck({ class: id.slice(5), by: 'person' });
      case 'yurufy':
      case 'redraw':
        this.input = { ...this.input, yurufy: true };
        return this._meet();
      case 'next_meet':
        return this._meet();
      case 'use_guide':
        return this._useGuide();
      case 'choose_sample':
        return this._chooseSample();
      case 'other':
      case 'again':
        return this._restart();
      case 'keep':
        return this._persona();
      case 'fix':
        return this._fix(p);
      case 'persona_ok':
        return this._hello();
      case 'persona_edit': // 性格の画面で「これにする」を押した(payload.settings)
        return this._personaSaved(p);
      case 'persona_roll':
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
        return this._later();
      case 'close':
        return this._finish();
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
      await this._say({ who: 'note', text: '絵が選ばれていません。' });
      return this._offerStart();
    }
    this.input = { from: 'picture', kind, url: p.url, name: clip(p.name, 40) };
    // 選んだ絵は、札の上に出したままにする(会話の欄が流れても見える。司令塔の決め D3)。絵はこの端末の中だけ
    this.d.pin?.({ img: p.url, caption: kind === 'photo' ? '撮った写真' : '選んだ絵' });
    await this._say({ who: 'user', text: kind === 'photo' ? '(写真を撮った)' : '(絵を選んだ)', img: p.url });
    this._go(2);
    if (this.d.creator.mode === 'sample') {
      await this._say(
        { who: 'guide', text: '絵の確かめ(ゆるキャラチェック)は、手元の PC で Claude がするんだ。この画面では、かわりに教えてね。' },
        { who: 'guide', text: 'この絵は、どれに近い?' },
      );
      return this._offer([
        { id: 'kind_yuru', label: 'ゆるキャラ・マスコット', primary: true },
        { id: 'kind_human', label: '人の写真・人の絵' },
        { id: 'kind_complex', label: '景色・こまかい絵' },
      ]);
    }
    await this._say({ who: 'guide', text: '絵を見てみるね。ちょっと待ってて。' });
    const result = await this.d.creator.check(this.input);
    return this._afterCheck(result);
  }

  async _afterCheck(result) {
    this.check = { class: result?.class ?? 'complex', by: result?.by ?? 'claude', message: result?.message ?? '' };
    const sample = this.d.creator.mode === 'sample';
    if (this.check.class === 'yuru') {
      if (sample) {
        // この画面では絵から作れない。「この絵から作るよ」とは言わず、正直に言う(_meet → 見本の道は絵に null → _noMatch)
        await this._say({ who: 'guide', text: 'ゆるキャラにぴったりの絵だね。' });
        return this._meet();
      }
      await this._say({ who: 'guide', text: 'ゆるキャラにぴったりの絵だね。この絵から作るよ。' });
      return this._offer([{ id: 'next_meet', label: 'つぎへ', primary: true }]);
    }
    if (this.check.class === 'human') {
      await this._say(
        { who: 'guide', text: 'これはちょっとリアルな写真みたい。ゆるキャラにしてみる?' },
        {
          who: 'note',
          text: sample
            ? '手元の PC の Claude Code なら、髪や服の色などの特徴を生かして、ゆるキャラに描き直せます。どんな写真でもきれいに作れるわけではありません。'
            : '髪や服の色、目立つ物などの特徴を生かして、ゆるキャラに描き直します。どんな写真でもきれいに作れるわけではありません。',
        },
      );
      return this._offer([
        { id: 'yurufy', label: 'ゆるキャラにしてみる', primary: true },
        { id: 'other', label: '別の絵にする' },
      ]);
    }
    await this._say({ who: 'guide', text: 'いろんな物が描いてあるね。主役を 1 つ選んで、描き直してみる?' });
    return this._offer([
      { id: 'redraw', label: '主役を描き直してもらう', primary: true },
      { id: 'other', label: '別の絵にする' },
    ]);
  }

  /* ---------- 1 → 3: 言葉の入口(チェックは絵のときだけ) ---------- */
  async _fromWords(p) {
    const words = clip(p?.text, WORDS_MAX);
    if (!words) {
      await this._say({ who: 'note', text: 'どんな子か、言葉で書いてね。' });
      return this._offerStart();
    }
    this.input = { from: 'words', words };
    await this._say({ who: 'user', text: words });
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
        { who: 'guide', text: '見本の中に、近い子がいたよ。' },
        { who: 'note', text: `見本: ${made.name}(${made.note})。この画面では新しく描かずに、作ってある見本の子を出します。` },
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

  /** 近い見本がいない: 正直に言い、PC の Claude Code での作り方を見せる。だまって見本を選ばない(D1) */
  async _noMatch() {
    this._go(3);
    this.character = null;
    const picture = this.input?.from === 'picture';
    await this._say(
      { who: 'guide', text: picture ? 'ごめんね。この画面では、絵から新しい子を作れないんだ。' : 'ごめんね。見本の中に、近い子がいないんだ。' },
      {
        who: 'note',
        text: picture
          ? 'この画面は、作ってある見本の子を出すだけで、絵を Claude に見せません(絵はこの端末の外に送りません)。絵から新しい子を作るのは、手元の PC の Claude Code です。'
          : 'この画面は、作ってある見本の子を出すだけで、新しくは描きません。言葉から新しい子を作るのは、手元の PC の Claude Code です。',
      },
      { who: 'note', text: MAKE_STEPS },
    );
    this._offerNoMatch();
  }

  _readmeAction() {
    return this.d.guideUrl ? [{ id: 'readme', kind: 'link', label: 'PC での作り方を見る(README)', url: this.d.guideUrl }] : [];
  }

  _offerNoMatch() {
    const main = this.d.creator.main?.();
    const picture = this.input?.from === 'picture';
    this._offer([
      ...(main ? [{ id: 'use_guide', label: `${this.guideName}で続きを試す`, primary: true }] : []),
      { id: 'choose_sample', label: '見本の子から選ぶ', primary: !main },
      ...this._readmeAction(),
      { id: 'again', label: picture ? '別の絵にする' : '言葉を変える' },
    ]);
  }

  /** 見本の子を、使う人が自分で選ぶ(だまって選ばない) */
  async _chooseSample() {
    const list = this.d.creator.list?.() ?? [];
    await this._say({ who: 'guide', text: 'どの子に会ってみる?' });
    this._offer([...list.map((c) => ({ id: `s_${c.id}`, label: c.name })), { id: 'again', label: 'やり直す' }]);
  }

  async _pickSample(id) {
    const c = (this.d.creator.list?.() ?? []).find((x) => x.id === id);
    if (!c) return this._chooseSample();
    this._go(3);
    this.character = c;
    await this._say({ who: 'user', text: c.name }, { who: 'note', text: `見本: ${c.name}(${c.note})` });
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
      { who: 'guide', text: main.id === MAIN_CHARACTER.id ? 'じゃあ、ノリーで続けマス。性格やあいさつを、ためしてみてくだサイ!' : `じゃあ、${main.name}で続けるね。` },
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
    await this._say({ who: 'guide', text: c?.sample ? `${c.name}だよ。この子はどうかな?` : 'こんな子ができたよ。どうかな?' });
    this._offer([
      { id: 'keep', label: 'この子にする', primary: true },
      ...(c?.sample ? [{ id: 'fix', label: '直したい' }] : [{ id: 'fix', label: '直したい(一言)', kind: 'text', max: NOTE_MAX, placeholder: '例: 耳をもっと大きく', submit: '伝える' }]),
      { id: 'again', label: 'やり直す' },
    ]);
  }

  async _fix(p) {
    const c = this.character;
    if (c?.sample || typeof this.d.creator.review !== 'function') {
      // 行き止まりにしない: ここで変えられる物(性格と話し方)と、形や色を直せる道(PC の Claude Code)を言う(D2)
      await this._say(
        { who: 'guide', text: '見本の子の形や色は、この画面では直せないんだ。でも、性格と話し方は、次の歩みで変えられるよ。' },
        { who: 'note', text: '手元の PC の Claude Code で作った子なら、スマホの確かめる画面から「耳を大きく」のような一言で、形や色を直せます。' },
      );
      return this._offer([
        { id: 'keep', label: 'この子で性格を決める', primary: true },
        ...this._readmeAction(),
        { id: 'again', label: 'やり直す' },
      ]);
    }
    const note = clip(p?.text, NOTE_MAX);
    if (!note) return this._meetAsk();
    await this._say({ who: 'user', text: note });
    const r = await this.d.creator.review(c.id, 'redo', note);
    await this._say({ who: 'guide', text: r?.ok ? 'PC の Claude Code に伝えたよ。直ったら、また見せるね。' : `うまく伝えられなかったみたい(${r?.message ?? '理由は不明'})。` });
    return this._offer([
      { id: 'keep', label: 'この子にする', primary: true },
      { id: 'again', label: 'やり直す' },
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
      { id: 'persona_ok', label: 'このままでいい', primary: true },
      { id: 'persona_edit', label: '性格を変える', kind: 'persona' },
      { id: 'persona_roll', label: 'もう一度ひく' },
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
    await this._say({ who: 'guide', text: `じゃあ、${this.character?.name ?? 'この子'}にあいさつしてもらおう。` });
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
      await this._say({ who: 'note', text: MOCK_NOTICE });
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
    await this._say({ who: 'guide', text: 'まだ声が出せないから、文字とレトロな音で話すね。なにか話しかけてみて。' });
    this._offerRetro();
  }

  _offerRetro() {
    this._offer([
      { id: 'say', label: '話しかける', kind: 'text', placeholder: '例: 好きな食べ物はなに?', max: SAY_MAX, submit: '送る', primary: true },
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
        { who: 'guide', text: 'この画面には、もう声の準備があるよ。声で話してもらおう。' },
        { who: 'char', text: '声でも話せるよ。よろしくね!', voice: true },
      );
      return this._offer([{ id: 'close', label: 'はじめる', primary: true }]);
    }
    if (!v.canTakeKey()) {
      await this._say(
        { who: 'char', text: 'いつか、本物の声で話してみたいな。' },
        { who: 'guide', text: '声の鍵の受け口は、まだこの画面につながっていないんだ。つながったら、ここで鍵を入れられるよ。' },
      );
      return this._offer([{ id: 'close', label: 'はじめる', primary: true }]);
    }
    await this._say(
      { who: 'char', text: 'ねえ、本物の声で話してみたいな。' },
      { who: 'guide', text: 'ElevenLabs の鍵(API キー)を入れると、声が出せるようになるよ。' },
      { who: 'note', text: v.notice() },
    );
    this._offerKey();
  }

  _offerKey() {
    this._offer([
      { id: 'key', label: '鍵を入れる', kind: 'key', remember: Boolean(this.d.voice.canRemember?.()), primary: true },
      // 札の右上の「あとで」(初めての会話ごと閉じる)と同じ名前にしない(撮影の練習で、7 歩目に「あとで」が 2 つ並んでいた)
      { id: 'later', label: '鍵なしで続ける' },
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
    if (!key.trim()) return this._offerKey();
    const r = await this.d.voice.useKey(key.trim(), { remember: Boolean(p?.remember) });
    if (!r?.ok) {
      await this._say({ who: 'char', text: 'うまくいかなかったみたい。' }, { who: 'note', text: r?.message ?? '鍵を確かめてね。' });
      return this._offerKey();
    }
    this._useVoice();
    await this._say({ who: 'char', text: VOICE_THANKS, voice: true, expression: 'happy', motion: 'wave' });
    await this._say({ who: 'note', text: '本物の声で話しました。' });
    return this._offer([{ id: 'close', label: 'はじめる', primary: true }]);
  }

  async _later() {
    await this._say({ who: 'char', text: 'じゃあ、文字とレトロな音で話そうね。' });
    return this._offer([{ id: 'close', label: 'はじめる', primary: true }]);
  }

  async _finish() {
    this.done = true;
    clearTimeout(this.frameTimer);
    this._go(8);
    const c = this.character;
    const away = Boolean(c?.id) && c.id !== this.guide.id; // 舞台は案内役(主役)に戻る(D4)
    await this._say(
      { who: 'guide', text: '準備ができたよ。いっぱい話してあげてね。' },
      away && c.local ? { who: 'note', text: `${c.name}の形(3D)は、PC の Claude Code が作っています。できるまでは、舞台は${this.guideName}のままです。` } : null,
      away && !c.local ? { who: 'note', text: `舞台は${this.guideName}に戻ります。${c.name}には、また「はじめての会話」から会えます。` } : null,
    );
    this.d.offer([]);
    this.d.onDone?.();
  }

  /* ---------- 手元の PC の作る道: 作る画面(枠)からの知らせで進む ---------- */

  /** 作る画面からの知らせ(creators.js の cleanMakeEvent を通した物)を、順に受ける */
  makeEvent(ev) {
    this.makeQueue = this.makeQueue.then(() => this._onMake(ev)).catch(async (err) => {
      await this._say({ who: 'note', text: `うまく進めませんでした(${err?.message ?? err})` });
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
        if (ev.from === 'words') {
          this.input = { from: 'words', words: clip(ev.words, WORDS_MAX) };
          await this._say({ who: 'user', text: this.input.words });
          this.skipped.add(2);
          this._go(3);
        } else {
          this.input = { from: 'picture' };
          await this._say({ who: 'user', text: '(絵を渡した)' });
          this._go(2);
        }
        return this._say({ who: 'guide', text: 'PC の Claude Code に渡したよ。PC で /yuru-next と打つと、描き始めるよ(数分かかります)。' });
      case 'progress':
      case 'error':
        if (!ev.text || this.progressSeen.has(ev.text)) return undefined;
        this.progressSeen.add(ev.text);
        return this._say({ who: 'note', text: ev.text });
      case 'checked':
        return this._checkedLocal(ev);
      case 'chose':
        await this._say({ who: 'user', text: ev.choice === 'redraw' ? '主役を描き直してもらう' : 'ゆるキャラにしてみる' });
        return this._say({ who: 'guide', text: 'PC の Claude Code に伝えたよ。描けたら見せるね。' });
      case 'drawn':
        this._go(3);
        this.character = { id: ev.id, name: ev.name, sample: false, local: true, round: ev.round, note: this.d.creator.note ?? '' };
        return this._say(
          { who: 'guide', text: ev.round > 1 ? '直してみたよ。どうかな?' : 'こんな子ができたよ。どうかな?' },
          { who: 'note', text: '下の画面で「この子にする」か「直したい(一言)」を選んでね。' },
        );
      case 'decided':
        if (ev.decision === 'redo') {
          await this._say({ who: 'user', text: ev.note || '(直したい)' });
          return this._say({ who: 'guide', text: 'PC の Claude Code に伝えたよ。直ったら、また見せるね。' });
        }
        if (ev.id && this.character?.id !== ev.id) this.character = { id: ev.id, name: ev.name, sample: false, local: true, round: ev.round, note: this.d.creator.note ?? '' };
        {
          const name = this.character?.name ?? 'この子';
          // 描いた絵は札の上に出したまま(枠を小さくして絵だけ見せる)。3D ができるまでは案内役が代わりに舞台に立つ(D5)
          this.d.pin?.({ frame: this.d.creator.picUrl ?? null, caption: `${name}(PC の Claude Code が描いた絵。3D はこれから)` });
          await this._say(
            { who: 'guide', text: `${name}にけってい! OK を PC に伝えたよ。` },
            { who: 'note', text: `形・色・骨・動き(3D)は、PC の Claude Code がこれから作ります(数十分かかります)。3D ができるまでは、${this.guideName}がかわりに舞台に立って、${name}の言葉を話します。${name}の姿は、上の絵です。` },
          );
        }
        return this._persona();
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
    if (ev.by === 'pixels') await this._say({ who: 'note', text: '判定役の答えが割れたので、絵の数字で決めました。違うと思ったら「別の絵にする」を選べます。' });
    if (ev.class === 'yuru') return this._say({ who: 'guide', text: 'ゆるキャラにぴったりの絵だね。この絵から作るよ。' });
    if (ev.class === 'human') {
      return this._say(
        { who: 'guide', text: 'これはちょっとリアルな写真みたい。ゆるキャラにしてみる?' },
        { who: 'note', text: '髪や服の色、目立つ物などの特徴を生かして、ゆるキャラに描き直します。どんな写真でもきれいに作れるわけではありません。下の画面で選んでね。' },
      );
    }
    return this._say(
      { who: 'guide', text: 'いろんな物が描いてあるね。主役を 1 つ選んで、描き直してみる?' },
      { who: 'note', text: '下の画面で選んでね。' },
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
      character: this.character ? { id: this.character.id, name: this.character.name, sample: Boolean(this.character.sample), note: this.character.note ?? '' } : null,
      skipped: [...this.skipped],
    };
  }

  /** snapshot から続ける(3 歩目の「この子はどうかな?」から) */
  async resume(snap) {
    if (!snap || snap.v !== SNAPSHOT_VERSION || !snap.character?.id) return this.start();
    this.input = snap.from ? { from: snap.from, words: snap.words ?? '' } : null;
    this.check = snap.check ?? null;
    this.character = { ...snap.character };
    for (const n of snap.skipped ?? []) this.skipped.add(n);
    return this._meetAsk();
  }
}

/** 試験と画面で使う: 文字数の上限(一言 40 字など)。絵文字も 1 字 */
export const countChars = chars;
