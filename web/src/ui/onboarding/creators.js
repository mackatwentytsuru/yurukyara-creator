// 作る道(1〜3 歩目)の受け口。台本(script.js)はこの形だけを使う:
//   creator.mode            'sample'(見本を出す)| 'local'(手元の PC の作る道具へ渡す)
//   creator.check(input, o)  → { class: 'yuru'|'human'|'complex', by: 'claude'|'pixels'|'person', message }(絵のときだけ)
//   creator.make(input, o)   → { id, name, sample: boolean, note, local?, picture?, round? }(できた子。見本なら sample: true)
//                              見本の道では、言葉が本当に見本に当たる時だけ。当たらない言葉と絵は null(台本が正直に言う)
//   creator.review(id, 'ok'|'redo', 一言, o) → { ok, message }(手元で作った子だけ。K3 の request.json へ)
//   creator.redrawn(id, o)   → できた子(やり直しの次の回の絵。手元で作った子だけ)
//   o = { signal, onProgress(text) }。待つ間の様子は onProgress で伝え、signal で待つのをやめられる
// 'sample': Claude Code で作ってある子を、言葉に当たる時だけ出す(当たらなければ出さない)。絵はこの端末の外に送らない。
// 'local' : 言葉か絵 1 枚を、手元の PC の確認画面のサーバー(creator/review/serve_review.py --make)へ渡す。
//           PC で /yuru-next を打つと、ゆるキャラチェック → 段 0 の絵 → C0 に出る。OK・やり直し+一言は K3 の request.json。
// 主役の決まりは web/src/character/defaults.js(S5)の 1 か所だけ。ここでは写さずに読む
import { MAIN_CHARACTER } from '../../character/defaults.js';

/** 見本の子(characters/<id>/ にある物)。words は Claude が絵を描いた元の言葉(記録のある物だけ書く) */
export const SAMPLE_CHARACTERS = [
  { id: 'mikan', name: 'みかんちゃん', note: '言葉「みかんの子。まるくて元気。頭に葉っぱが 1 枚」から Claude が描いて作った子', keys: ['みかん', 'オレンジ', 'くだもの', '果物', '葉っぱ'] },
  { id: 'd_lantern', name: 'ちょうちんくん', note: 'Claude が描いた絵から作った子', keys: ['ちょうちん', '提灯', 'あかり', '明かり', '灯り', 'お祭り'] },
  { id: 'robo', name: 'ロボくん', note: 'Claude が描いた絵から作った子', keys: ['ロボ', 'ろぼ', 'ロボット', '機械', 'メカ'] },
  { id: 'f_led', name: 'パネルくん', note: 'Claude が描いた絵から作った子', keys: ['パネル', '画面', 'LED', 'テレビ', 'モニター'] },
  { id: 'yokoso', name: 'ようこそくん', note: 'Claude が描いた絵から作った子', keys: ['ようこそ', '受付', '案内', 'いらっしゃい', 'みどり', '緑'] },
];

/**
 * 言葉にいちばん近い見本。当たる言葉が 1 つも無ければ null(だまって別の子を出さない。司令塔の決め D1・CRITux 3)
 * @returns {object|null}
 */
export function pickSample(words, samples = SAMPLE_CHARACTERS) {
  const w = String(words ?? '').normalize('NFKC').toLowerCase();
  let best = null;
  let bestHits = 0;
  for (const s of samples) {
    const hits = s.keys.filter((k) => w.includes(k.normalize('NFKC').toLowerCase())).length;
    if (hits > bestHits) {
      best = s;
      bestHits = hits;
    }
  }
  return best;
}

/** 主役(案内役)の見本としての説明。主役も、協力者が手で描いた絵から Claude Code で作った子 */
export const MAIN_NOTE = '協力者が手で描いた絵から、Claude Code で作った子';
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
    /** 言葉に本当に当たる見本だけ。絵と、当たらない言葉は null */
    async make(input) {
      if (input?.from !== 'words') return null;
      const s = pickSample(input?.words ?? '', samples);
      return s ? { id: s.id, name: s.name, sample: true, note: s.note } : null;
    },
    /**
     * 使う人が自分で選ぶ見本の一覧。案内役は「〜で続きを試す」で別に出すので入れない。
     * 案内役が主役でない時(?character=<id> で開いた時)は、主役も選べるように先頭に入れる
     */
    list() {
      const g = lead();
      const others = samples.filter((s) => s.id !== g?.id).map((s) => ({ id: s.id, name: s.name, sample: true, note: s.note }));
      if (!g?.id || g.id === MAIN_CHARACTER.id) return others;
      return [{ id: MAIN_CHARACTER.id, name: MAIN_CHARACTER.name, sample: true, note: MAIN_NOTE }, ...others];
    },
    /** 案内役を、見本の子として出す時の形 */
    main() {
      const g = lead();
      return g?.id ? { id: g.id, name: g.name, sample: true, note: leadNote(g), guide: true } : null;
    },
  };
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

const MAKE_EVENTS = new Set(['ready', 'sent', 'progress', 'checked', 'chose', 'drawn', 'decided', 'restart', 'error']);
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
  if (d.ev === 'drawn' || d.ev === 'decided') {
    if (d.id !== undefined && !/^[a-z0-9_]{1,32}$/.test(String(d.id))) return null;
    if (d.id !== undefined) e.id = String(d.id);
    if (d.name !== undefined) e.name = clipText(d.name, 40) || '新しい子';
    e.round = Number.isInteger(d.round) && d.round > 0 ? d.round : 1;
  }
  // 描き直しで頼んでいない所も変わった時の一言(PC の決まった確かめが書く。文字だけ・120 字まで)
  if (d.ev === 'drawn' && d.drift) e.drift = plainWords(clipText(d.drift, 120));
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
