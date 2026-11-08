// 作る道(1〜3 歩目)の受け口。台本(script.js)はこの形だけを使う:
//   creator.mode            'sample'(見本を出す)| 'local'(手元の PC の作る道具へ渡す)
//   creator.check(input, o)  → { class: 'yuru'|'human'|'complex', by: 'claude'|'pixels'|'person', message }(絵のときだけ)
//   creator.make(input, o)   → { id, name, sample: boolean, note, exact?, local?, picture?, round? }(できた子。見本なら sample: true)
//                              見本の道では、いつも いちばん近い見本(言葉の意味・色・形。絵は使う人が教えた色と形)。exact が無ければ
//                              台本が「ぴったりではないけど、この子はどう?」と言う(B4 12b。行き止まりにしない)
//   creator.review(id, 'ok'|'redo', 一言, o) → { ok, message }(手元で作った子だけ。K3 の request.json へ)
//   creator.redrawn(id, o)   → できた子(やり直しの次の回の絵。手元で作った子だけ)
//   o = { signal, onProgress(text) }。待つ間の様子は onProgress で伝え、signal で待つのをやめられる
// 'sample': Claude Code で作ってある子から、いちばん近い子を出す。絵はこの端末の外に送らない(この画面は絵を見ない)。
// 'local' : 言葉か絵 1 枚を、手元の PC の確認画面のサーバー(creator/review/serve_review.py --make)へ渡す。
//           PC で /yuru-next を打つと、ゆるキャラチェック → 段 0 の絵 → C0 に出る。OK・やり直し+一言は K3 の request.json。
// 主役の決まりは web/src/character/defaults.js(S5)の 1 か所だけ。ここでは写さずに読む
import { MAIN_CHARACTER } from '../../character/defaults.js';
import { SAMPLE_THUMBS } from './thumbs.js';

/**
 * 見本の子(characters/<id>/ にある物)。words は Claude が絵を描いた元の言葉(記録のある物だけ書く)。
 * 近い子を選ぶ手がかり(B4 12b。UIR 1・2): keys = その子そのものの言葉、means = 意味の仲間、colors = 色、shape = 形。
 */
export const SAMPLE_CHARACTERS = [
  { id: 'mikan', name: 'みかんちゃん', note: '言葉「みかんの子。まるくて元気。頭に葉っぱが 1 枚」から Claude が描いて作った子', keys: ['みかん', 'オレンジ', 'くだもの', '果物', '葉っぱ'],
    means: ['たべもの', '食べ物', 'やさい', '野菜', 'りんご', 'いちご', 'ぶどう', 'もも', 'パン', 'おにぎり', 'おかし', 'お菓子', 'ケーキ', 'まんじゅう', 'あまい', '甘い', 'たまご', 'すいか'], colors: ['orange', 'yellow'], shape: 'round' },
  { id: 'd_lantern', name: 'ちょうちんくん', note: 'Claude が描いた絵から作った子', keys: ['ちょうちん', '提灯', 'あかり', '明かり', '灯り', 'お祭り'],
    means: ['まつり', '祭', 'ひかり', '光', 'よる', '夜', 'なつ', '夏', 'ほし', '星', 'じんじゃ', '神社', 'おてら', 'お寺', 'はなび', '花火', 'ろうそく', 'ほのお', '炎', 'おばけ'], colors: ['red', 'pink'], shape: 'tall' },
  { id: 'robo', name: 'ロボくん', note: 'Claude が描いた絵から作った子', keys: ['ロボ', 'ろぼ', 'ロボット', '機械', 'メカ'],
    means: ['でんしゃ', '電車', 'くるま', '車', 'うちゅう', '宇宙', 'ロケット', 'でんき', '電気', 'コンピュータ', 'パソコン', 'てつ', '鉄', 'きんぞく', '金属', 'はかせ', '博士', 'かがく', '科学'], colors: ['blue', 'gray', 'white'], shape: 'box' },
  { id: 'f_led', name: 'パネルくん', note: 'Claude が描いた絵から作った子', keys: ['パネル', '画面', 'LED', 'テレビ', 'モニター'],
    means: ['ゲーム', 'おんがく', '音楽', 'スマホ', 'えいが', '映画', 'どうが', '動画', 'うた', '歌', 'ダンス', 'ステージ', 'ライブ', 'ひかる', '光る'], colors: ['black', 'purple', 'blue'], shape: 'flat' },
  { id: 'yokoso', name: 'ようこそくん', note: 'Claude が描いた絵から作った子', keys: ['ようこそ', '受付', '案内', 'いらっしゃい', 'みどり', '緑'],
    means: ['まち', '町', 'えき', '駅', 'おみせ', 'お店', '木', 'はな', '花', 'もり', '森', 'やま', '山', 'くさ', '草', 'しょくぶつ', '植物', 'あいさつ', 'げんき', '元気'], colors: ['green'], shape: 'round' },
];

/** 主役(ノリー)を近い子として選ぶ時の手がかり(ノリーは案内役なので一覧には入れず、ここで足す) */
export const MAIN_HINTS = {
  keys: ['カンガルー', 'かんがるー', 'しつじ', '執事'],
  means: ['どうぶつ', '動物', 'ねこ', '猫', 'いぬ', '犬', 'うさぎ', 'くま', '熊', 'とり', '鳥', 'しっぽ', 'もふもふ', 'ふわふわ', 'パンダ', 'きつね', 'たぬき', 'さる', '猿', 'りす', 'ねずみ', 'こあら', 'コアラ', 'ぺんぎん', 'ペンギン', 'ちょうネクタイ', '蝶ネクタイ', 'てぶくろ', '手袋'],
  colors: ['brown'],
  shape: 'tall',
};

/** 色の言葉(ひらがな・漢字・カタカナ)→ 色の名前。札の色の選びにも使う */
export const COLOR_WORDS = {
  red: ['あか', '赤', 'レッド', 'まっか', '真っ赤'], orange: ['オレンジ', 'だいだい', '橙'], yellow: ['きいろ', '黄', 'イエロー', 'きん', '金'],
  green: ['みどり', '緑', 'グリーン', 'きみどり'], blue: ['あお', '青', 'ブルー', 'みずいろ', '水色', 'そらいろ', '空色'],
  purple: ['むらさき', '紫', 'パープル'], pink: ['ピンク', 'ももいろ', '桃色'], brown: ['ちゃいろ', '茶', 'ブラウン'],
  black: ['くろ', '黒', 'ブラック'], white: ['しろ', '白', 'ホワイト'], gray: ['はいいろ', '灰色', 'グレー', 'ぎん', '銀', 'シルバー'],
};
/** 色の札(絵の道で、いちばん多い色を聞く。子どもに分かる 8 つ) */
export const COLOR_CHIPS = [
  { id: 'red', label: 'あか' }, { id: 'orange', label: 'オレンジ' }, { id: 'yellow', label: 'きいろ' }, { id: 'green', label: 'みどり' },
  { id: 'blue', label: 'あお' }, { id: 'brown', label: 'ちゃいろ' }, { id: 'pink', label: 'ピンク' }, { id: 'black', label: 'くろ・はいいろ' },
];
/** 形の言葉 → 形の名前 */
export const SHAPE_WORDS = {
  round: ['まるい', 'まる', '丸', 'ころころ', 'ぷにぷに', 'ボール'], box: ['しかく', '四角', 'はこ', '箱', 'カクカク', 'かくかく'],
  tall: ['ほそながい', '細長', 'たかい', '背が高', 'のっぽ', 'たて'], flat: ['ひらたい', '平ら', 'うすい', '薄い', 'いた', '板'],
};
/** 形の札(絵の道) */
export const SHAPE_CHIPS = [{ id: 'round', label: 'まるい' }, { id: 'tall', label: 'たてに ながい' }, { id: 'box', label: 'しかく' }, { id: 'any', label: 'わからない' }];

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase();
const hasAny = (w, list) => (list ?? []).filter((k) => w.includes(norm(k))).length;
const wordsColors = (w) => Object.entries(COLOR_WORDS).filter(([, ks]) => hasAny(w, ks)).map(([c]) => c);
const wordsShapes = (w) => Object.entries(SHAPE_WORDS).filter(([, ks]) => hasAny(w, ks)).map(([s]) => s);

/** 1 体の点(その子そのもの 6・意味 3・色 2・形 1)。keys に当たった時だけ「ぴったり」 */
function scoreOf(s, w, colors, shapes) {
  const keys = hasAny(w, s.keys);
  const means = hasAny(w, s.means);
  const color = colors.filter((c) => (s.colors ?? []).includes(c)).length;
  const shape = shapes.includes(s.shape) ? 1 : 0;
  return { score: keys * 6 + means * 3 + color * 2 + shape, exact: keys > 0, why: keys ? 'name' : means ? 'meaning' : color ? 'color' : shape ? 'shape' : null };
}

/** 決まった順の「いちばん近い子」(手がかりが 0 の時)。同じ言葉なら、いつも同じ子 */
function steadyPick(w, list) {
  let h = 0;
  for (const ch of w) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return list[h % list.length];
}

/**
 * 言葉か、絵の色と形に、いちばん近い見本を必ず 1 体返す(行き止まりにしない。UIR 1・2)。
 * @param {{words?:string, colors?:string[], shape?:string}} q
 * @param {object[]} [samples] 選べる子(主役を入れる時は MAIN_HINTS を足した物)
 * @returns {{sample:object, exact:boolean, why:'name'|'meaning'|'color'|'shape'|null}|null} 一覧が空の時だけ null
 */
export function nearestSample(q, samples = SAMPLE_CHARACTERS) {
  const list = (samples ?? []).filter(Boolean);
  if (!list.length) return null;
  const w = norm(q?.words);
  const colors = [...new Set([...(q?.colors ?? []), ...wordsColors(w)])];
  const shapes = [...new Set([...(q?.shape && q.shape !== 'any' ? [q.shape] : []), ...wordsShapes(w)])];
  let best = null;
  for (const s of list) {
    const r = scoreOf(s, w, colors, shapes);
    if (!best || r.score > best.score) best = { ...r, sample: s };
  }
  if (!best.score) return { sample: steadyPick(w || 'x', list), exact: false, why: null };
  return { sample: best.sample, exact: best.exact, why: best.why };
}

/** 言葉にぴったり当たる見本(その子そのものの言葉)。無ければ null(前からの形。試験と README の例で使う) */
export function pickSample(words, samples = SAMPLE_CHARACTERS) {
  const r = nearestSample({ words }, samples);
  return r?.exact ? r.sample : null;
}

/** 主役(案内役)の見本としての説明。主役も、協力者が手で描いた絵から作った子(UIR 21: 見た目の手がかりを添える) */
export const MAIN_NOTE = '木の上に すむ カンガルーの子。ながい しっぽと 緑の ちょうネクタイ。協力者が 手で描いた絵から 作った子';
/** 主役でも見本の一覧でもない子(?character=<id> で呼んだ、このリポジトリの子)の説明 */
export const OTHER_NOTE = 'Claude Code で作った子';

/** 見本の一覧にある子の名前(無ければ null)。?character=<id> で開いた時、舞台が読み終わる前の案内役の名前に使う */
export function sampleName(id, samples = SAMPLE_CHARACTERS) {
  return samples.find((s) => s.id === id)?.name ?? null;
}

/**
 * 見本の道。この画面では新しく描かない。言葉が見本の子に本当に当たる時だけ、その子を出す。
 * 当たらない言葉と絵(この画面では Claude が絵を見ない)は make が null を返し、台本が正直に「近い見本がいない」と言う。
 * 選べる見本の一覧(list)は、使う人が自分で選ぶ時だけ使う(だまって選ばない)。
 * @param {object} [o]
 * @param {{id:string, name:string}|(() => {id:string, name:string}|null)} [o.main] この回の案内役(既定は主役。?character=<id> で
 *   開いた時はその子)。「〜で続きを試す」に使う。関数なら、使う時に読む(案内役は 7 歩を始める時に決まる)
 * @param {object[]} [o.samples]
 */
export function createSampleCreator({ main = null, samples = SAMPLE_CHARACTERS } = {}) {
  const lead = () => (typeof main === 'function' ? main() : main);
  /** 案内役の説明: 見本の一覧の子ならその説明、主役なら主役の説明、ほかは「Claude Code で作った子」 */
  const leadNote = (g) => samples.find((s) => s.id === g.id)?.note ?? (g.id === MAIN_CHARACTER.id ? MAIN_NOTE : OTHER_NOTE);
  return {
    mode: 'sample',
    async check() {
      // Claude の確かめは手元の PC だけ。見本の道では、使う人に選んでもらう(台本がそう伝える)
      return { class: 'complex', by: 'person', message: '' };
    },
    /**
     * いちばん近い見本を必ず返す(UIR 1・2)。言葉は意味・色・形で、絵は使う人が教えた色と形で選ぶ(この画面は絵を見ない)。
     * 案内役(主役)も選べる子に入れる(動物の言葉ならノリー)。exact はその子そのものの言葉に当たった時だけ
     */
    async make(input) {
      const g = lead();
      const mainEntry = g?.id === MAIN_CHARACTER.id || !g?.id
        ? { id: MAIN_CHARACTER.id, name: MAIN_CHARACTER.name, note: MAIN_NOTE, ...MAIN_HINTS, keys: [...MAIN_HINTS.keys, MAIN_CHARACTER.name], guide: true }
        : { keys: [], means: [], colors: [], ...(samples.find((s) => s.id === g.id) ?? {}), id: g.id, name: g.name, note: leadNote(g), guide: true };
      const pool = [...samples.filter((s) => s.id !== mainEntry.id), mainEntry];
      const q = input?.from === 'picture' ? { colors: input?.colors ?? [], shape: input?.shape ?? 'any' } : { words: input?.words ?? '' };
      const r = nearestSample(q, pool);
      if (!r) return null;
      const s = r.sample;
      return { id: s.id, name: s.name, sample: true, note: s.note, exact: r.exact, why: r.why, ...(s.guide ? { guide: true } : {}), img: SAMPLE_THUMBS[s.id] ?? null };
    },
    /** おまかせで出す子: 案内役とは別の見本から 1 体(偽の完成にしない。UIR 4)。rnd は 0〜1 */
    surprise(rnd = Math.random) {
      const g = lead();
      const others = samples.filter((s) => s.id !== g?.id);
      if (!others.length) return null;
      const s = others[Math.min(others.length - 1, Math.floor(rnd() * others.length))];
      return { id: s.id, name: s.name, sample: true, note: s.note, img: SAMPLE_THUMBS[s.id] ?? null };
    },
    /**
     * 使う人が自分で選ぶ見本の一覧。案内役は「〜で続きを試す」で別に出すので入れない。
     * 案内役が主役でない時(?character=<id> で開いた時)は、主役も選べるように先頭に入れる
     */
    list() {
      const g = lead();
      const others = samples.filter((s) => s.id !== g?.id).map((s) => ({ id: s.id, name: s.name, sample: true, note: s.note, img: SAMPLE_THUMBS[s.id] ?? null }));
      if (!g?.id || g.id === MAIN_CHARACTER.id) return others;
      return [{ id: MAIN_CHARACTER.id, name: MAIN_CHARACTER.name, sample: true, note: MAIN_NOTE, img: SAMPLE_THUMBS[MAIN_CHARACTER.id] ?? null }, ...others];
    },
    /** 案内役を、見本の子として出す時の形 */
    main() {
      const g = lead();
      return g?.id ? { id: g.id, name: g.name, sample: true, note: leadNote(g), guide: true } : null;
    },
  };
}

/* ---------- ブラウザから描く(サーバーの設定 YC_BROWSER_DRAW=1 の時だけ。既定は切ってある。B4 12b) ---------- */

/**
 * 見本の道に「サーバーが Claude に描いてもらう」を足した作る道。切ってある時・描けなかった時は、見本の道(いちばん近い子)のまま。
 * 描けた子は、サーバーが動く 2D(characters/<id>/2d)にしてあるので、その場で舞台に出せる。
 * @param {object} o
 * @param {object} o.sample 見本の道(createSampleCreator)
 * @param {() => boolean} o.enabled いま描けるか(/api/status の draw.on)
 */
export function createDrawCreator({ sample, enabled }) {
  const on = () => Boolean(enabled?.());
  /** サーバーの /api/draw を 1 回呼ぶ。描けた子か、描けなかった理由(reason は daily・visitor・busy・fails など。サーバーの印) */
  const callDraw = async (input, note, o) => {
    try {
      // 絵の中身を持たないオリジナルの道(色と形だけ)は、その答えから作ったことば(originalWords)で描く
      const fromPicture = input?.from === 'picture';
      const baseWords = fromPicture ? (input.file ? '' : originalWords(input)) : String(input?.words ?? '');
      // 「なおしたい ところ」の一言は、ことばの前に足す(長い時は後ろの元のことばが切れる。一言は捨てない。QA8 #4)
      const words = note ? clipWords(`なおす: ${note}。${baseWords}`) : baseWords;
      const body = fromPicture && input.file ? { ...(note ? { words } : {}), picture: await pictureBody(input.file) } : { words };
      o.onProgress?.('Claude が 描いているよ。少し まってね(1 分くらい)');
      const r = await fetch('/api/draw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && /^[a-z0-9_]{1,32}$/.test(String(j.id ?? ''))) return { ok: true, character: { id: j.id, name: String(j.name ?? 'あたらしい子').slice(0, 20), sample: false, drawn: true, twod: true, note: 'Claude が描いた子' } };
      return { ok: false, reason: String(j.reason ?? 'fail'), message: String(j.error ?? '描けなかったよ').slice(0, 60), status: r.status };
    } catch {
      return { ok: false, reason: 'fail', message: '描けなかったよ', status: 0 };
    }
  };
  return {
    ...sample,
    mode: 'sample',
    get canDraw() {
      return on();
    },
    async make(input, o = {}) {
      if (!on()) return sample.make(input, o);
      const r = await callDraw(input, '', o);
      if (r.ok) return r.character;
      // 絵(と、絵の色と形のオリジナル)の道は、描けなかった時に見本の子を黙って出さない(failed を返す。台本が正直に言って選んでもらう)
      if (input?.from === 'picture') return pictureFailure(r.status, r.reason);
      const fallback = await sample.make(input, o);
      return fallback ? { ...fallback, drawFailed: r.message } : null;
    },
    /**
     * 描いた子の「なおしたい ところ」: 一言を足して、もう 1 回描く。見本の子に替えない(替えると、一言が捨てられる)。
     * @returns {Promise<{ok:boolean, character?:object, reason?:string, message?:string, status?:number}>}
     */
    async redraw(input, note, o = {}) {
      if (!on()) return { ok: false, reason: 'off', message: 'ここでは 描けないよ', status: 0 };
      return callDraw(input, String(note ?? '').trim(), o);
    },
  };
}

/** ことばの長さ(サーバーの上限 60 字と同じ。長い時は後ろを切る) */
const clipWords = (s) => [...String(s ?? '').trim()].slice(0, 60).join('');

/** 描けなかった(絵の道)。見本の子は入れない。status と reason から、台本が理由を言う */
export function pictureFailure(status, reason) {
  const why = ['daily', 'visitor', 'busy', 'fails'].includes(reason) ? reason : status === 400 ? 'unusable' : 'failed';
  return { failed: true, picture: true, reason: why, status: status || 0, drawFailed: '描けなかったよ' };
}

/** 絵を使わないで、色と形の答えから作る「オリジナルの子」のことば(サーバーの上限 60 字の中) */
export function originalWords(input) {
  const color = COLOR_CHIPS.find((c) => c.id === (input?.colors ?? [])[0])?.label;
  const shape = SHAPE_CHIPS.find((s) => s.id === input?.shape && s.id !== 'any')?.label;
  const parts = [color && `${color}の 色`, shape && `${shape} かたち`].filter(Boolean);
  return `${parts.length ? `${parts.join('で ')}の ` : ''}あたらしい オリジナルの ゆるキャラ`.slice(0, 60);
}

const toBase64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
/** 選んだ絵を、サーバーへ送る形(base64)にする。絵はこの時だけ、この PC のサーバーを通って Claude に送られる */
async function pictureBody(file) {
  return { type: file.type, data: toBase64(new Uint8Array(await file.arrayBuffer())) };
}

/* ---------- 手元の PC の作る道('local') ---------- */

export const LOCAL_HINT = 'PC の Claude Code で /yuru-next と打つと、描き始めます(描くのに数分かかります)。';
const LOCAL_NOTE = '手元の PC の Claude Code が描いた絵';
// この PC の中だけ(ループバック)。家の中の住所・*.ts.net・*.local は数えない(CRITsec F4: だれでも *.ts.net の名前を持てる)
const LOOPBACK_HOST = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\]|::1)$/i;

/** その名前がこの PC の中(ループバック)を指すか */
export function isLoopbackHost(hostname) {
  return LOOPBACK_HOST.test(String(hostname ?? ''));
}

/**
 * 作る道のサーバーの場所が、この PC の中か。よその場所へ絵と合言葉を送らないための確かめ。
 * @param {string} base 例 http://127.0.0.1:8796
 */
export function isLocalBase(base) {
  try {
    const u = new URL(base);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash && isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

/** この画面そのものが、この PC の中(ループバック)で開かれているか。作る道の # はこの時だけ読む(CRITsec F4) */
export function pageIsLocal(loc = globalThis.location) {
  return isLoopbackHost(loc?.hostname);
}

const MAKE_EVENTS = new Set(['ready', 'sent', 'progress', 'checked', 'chose', 'drawn', 'decided', 'restart', 'error', 'twod', 'converted']);
const clipText = (s, n) => [...String(s ?? '')].slice(0, n).join('');
const STAGE_WORDS = ['絵', '読む', '形', '色と材質', '模様', '骨', '動き', '話す'];
const GATE_WORDS = { 0: '絵', 2: '形', 3: '色と材質', 5: '話す' };

/** 作る画面からの文に、内部の言葉(段 0(絵)・C0 など)が残っていても、ふつうの言葉にして出す(D7。PC の側も直してある) */
export function plainWords(text) {
  return String(text ?? '')
    .replace(/段\s*(\d)\s*(?:[((][^))]*[))])?/gu, (_m, d) => STAGE_WORDS[Number(d)] ?? '')
    .replace(/(?<![A-Za-z0-9_])C([0235])(?![A-Za-z0-9_])\s*(絵|形|色と材質|話す)?/gu, (_m, d, label) => label || `${GATE_WORDS[d]}の確認`);
}

/** 作る画面からの知らせを、決めた欄と形だけにする(知らない物は捨てる) */
export function cleanMakeEvent(d) {
  if (!d || typeof d !== 'object' || d.src !== 'yc-make' || !MAKE_EVENTS.has(d.ev)) return null;
  const e = { ev: d.ev };
  if (d.ev === 'sent') {
    e.from = d.from === 'picture' ? 'picture' : 'words';
    if (e.from === 'words') e.words = clipText(d.words, 60);
  }
  if (d.ev === 'progress' || d.ev === 'error') e.text = plainWords(clipText(d.text ?? d.message, 120));
  if (d.ev === 'checked') {
    if (!['yuru', 'human', 'complex'].includes(d.class)) return null;
    Object.assign(e, { class: d.class, message: plainWords(clipText(d.message, 120)), by: d.by === 'claude' ? 'claude' : 'pixels' });
  }
  if (d.ev === 'chose') e.choice = d.choice === 'redraw' ? 'redraw' : 'yurufy';
  // 2D ができた(パソコンが characters/<id>/2d を組んだ)・変換の絵を OK した / 描き直したい(B4 12b)
  if (d.ev === 'twod' || d.ev === 'converted') {
    if (!/^[a-z0-9_]{1,32}$/.test(String(d.id ?? ''))) return null;
    e.id = String(d.id);
    if (d.ev === 'converted' && d.again === true) e.again = true;
    return e;
  }
  if (d.ev === 'drawn' || d.ev === 'decided') {
    if (d.id !== undefined && !/^[a-z0-9_]{1,32}$/.test(String(d.id))) return null;
    if (d.id !== undefined) e.id = String(d.id);
    if (d.name !== undefined) e.name = clipText(d.name, 40) || '新しい子';
    e.round = Number.isInteger(d.round) && d.round > 0 ? d.round : 1;
  }
  // 描き直しで頼んでいない所も変わった時の一言(PC の決まった確かめが書く。文字だけ・120 字まで)
  if (d.ev === 'drawn' && d.drift) e.drift = clipText(plainWords(clipText(d.drift, 120)), 120);
  // 眉の無い絵(作る画面が眉を足すおすすめを出した)・おまかせ(ぜんぶ じどう)で進めた印。どちらも true の時だけ(本人 11/7)
  if (d.ev === 'drawn' && d.noBrows === true) e.noBrows = true;
  if ((d.ev === 'sent' || d.ev === 'decided') && d.auto === true) e.auto = true;
  if (d.ev === 'decided') {
    e.decision = d.decision === 'ok' ? 'ok' : 'redo';
    if (e.decision === 'redo') e.note = clipText(d.note, 40);
  }
  return e;
}

/**
 * 手元の PC の作る道。1〜3 歩の入力と絵は、PC のサーバーが配る「作る画面」(/m/)を札の中の枠に出して、その中だけで扱う。
 * この画面のコードは、絵にも通信にも触らない(test/privacy.test.mjs の約束のまま)。受け取るのは、枠からの状態の知らせ(postMessage)だけ。
 * @param {object} o
 * @param {string} o.base 作る道のサーバー(例 http://127.0.0.1:8796)。この PC の中だけ(isLocalBase)
 * @param {string} o.key 合言葉(枠の URL の # の後ろで渡す。サーバーには送られない。画面・記録に出さない)
 * @param {string} [o.parentOrigin] この画面の元(枠は、ここにだけ知らせを送る)
 * @param {Window} [o.win]
 */
export function createLocalCreator({ base, key, parentOrigin = globalThis.location?.origin ?? '', win = globalThis } = {}) {
  if (!isLocalBase(base)) throw new Error('作る道のサーバーは、この PC の中(127.0.0.1・localhost)だけです');
  if (!key) throw new Error('作る道の合言葉がありません');
  const origin = new URL(base).origin;
  const frameUrl = `${origin}/m/#k=${encodeURIComponent(key)}&p=${encodeURIComponent(parentOrigin)}`;
  // 描いた絵だけを見せる小さな枠(「この子にする」の後、3D ができるまで札の上に出す。D5)。絵は枠の中だけで扱う
  const picUrl = `${frameUrl}&view=pic`;
  const listeners = new Set();
  const onMessage = (msg) => {
    if (msg?.origin !== origin) return; // 作る画面の元からの知らせだけ
    const e = cleanMakeEvent(msg.data);
    if (!e) return;
    for (const f of listeners) f(e);
  };
  win.addEventListener?.('message', onMessage);
  return {
    mode: 'local',
    base: origin,
    frameUrl,
    picUrl,
    note: LOCAL_NOTE,
    /** 枠からの知らせを受ける。戻り値で受けるのをやめる */
    listen(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    close() {
      listeners.clear();
      win.removeEventListener?.('message', onMessage);
    },
  };
}
