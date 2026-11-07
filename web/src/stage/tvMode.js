// テレビ表示の決まり(11/7 本人「iPhone にあるものを AirPlay で、テレビにすぐパンって映せるようにしたい」)。
// three も DOM も読まない小さな部品(node の試験で読む。画面の部品は main.js・ui/panel.js)。
// ウェブの頁は、画面ミラーリング(AirPlay)を自分では始められない。画面がするのは次の 2 つ:
//   ① テレビ表示: 16:9 の画面いっぱいに、キャラを大きく真ん中に(上のすき間は画面の高さの 6% のまま)・3 m 先から読める字幕・
//      小さな窓(上の段・考え・入力の帯)を隠し、隅の小さな「もどる」だけを残す。?tv=1 でも始まる
//   ② iPhone・iPad では「テレビに映す」: 押すと画面ミラーリングの 3 つの手順(コントロールセンター → 画面ミラーリング → テレビをえらぶ)と、
//      大きな「テレビ表示にする」。手順は Apple の公式の手助けの頁(AirPlay で画面をミラーリングする)の言葉に合わせた。
//      画面のコードには外の住所を書かない決まり(web/test/privacy.test.mjs)なので、頁の住所は書かない
// ヘッドセットの中・入口の LED・自動で始める画面・重さを測る時は、入口を出さず、?tv=1 も読まない。

/** URL でテレビ表示から始める印(?tv=1) */
export const TV_PARAM = 'tv';
/** テレビ表示の間、<html> に付ける印(style.css が見る) */
export const TV_CLASS = 'tv-mode';

/**
 * テレビ表示の字幕の字の大きさ(画面の高さに対する割合)。3 m 先の 50 型のテレビ(画面の高さ 約 62cm)で 約 3.7cm、
 * 見る角度で 約 0.7 度(放送の字幕の 1 行 = 画面の高さの 1/15〜1/16 と同じくらい)。字幕の箱はこの大きさのまま 3 行まで見せる
 */
export const TV_CAPTION_FRACTION = 0.06;
/** 字幕の字の大きさの下限と上限(px)。横向きの iPhone(高さ 390px 前後)でも 24px */
export const TV_CAPTION_MIN_PX = 24;
export const TV_CAPTION_MAX_PX = 120;
/**
 * 縦長の画面(幅 < 高さ。縦持ちの iPhone・iPad)の字幕: 画面の高さの 6% では 1 行が 7 文字ほどで 3 行で切れた(QA 中 12)ので、
 * 字の大きさは画面の幅の割合で抑え、行は 5 行まで見せる(キャラの下に空ける高さも 5 行分)。横長の画面(テレビ・PC)は今のまま
 */
export const TV_PORTRAIT_CAPTION_WIDTH_FRACTION = 0.08;
export const TV_PORTRAIT_CAPTION_MIN_PX = 20;
export const TV_PORTRAIT_ROWS = 5;
/** 字幕の行の高さ(字の大きさの倍) */
export const TV_CAPTION_LINE = 1.3;
/** キャラの下に、字幕のために空けておく行の数。長い返事は字幕の箱の中で送り、3 行目はキャラの足に重なってよい */
export const TV_CAPTION_ROWS = 2;

/** 上の段のボタン(iPhone・iPad 以外)の名前。押すとすぐテレビ表示になる */
export const TV_LABEL = 'テレビ表示';
/** 上の段のボタンに見せる短い言葉(幅 390 で上の段を 1 行増やさない。名前は aria-label と title) */
export const TV_SHORT = 'テレビ';
/** 上の段のボタン(iPhone・iPad)の名前。押すと画面ミラーリングの手順が出る */
export const CAST_LABEL = 'テレビに映す';
/** 手順の下の大きなボタン */
export const TV_ENTER_LABEL = 'テレビ表示にする';
export const TV_ENTER_SUB = 'よこむきにすると、大きくうつります';
/** テレビ表示の隅の小さなボタン(見せる言葉と、読み上げの名前) */
export const TV_EXIT_LABEL = 'もどる';
export const TV_EXIT_NAME = 'テレビ表示をやめる';
/** テレビ表示で、指で触る端末を縦に持っている時の一言 */
export const ROTATE_HINT = 'よこむきにすると、テレビに大きくうつります';
/** 手順の箱を閉じるボタン */
export const CAST_CLOSE_LABEL = 'とじる';

/** ?tv=1 か */
export function wantsTv(params) {
  return params?.get?.(TV_PARAM) === '1';
}

/**
 * iPhone か iPad か(どちらでもなければ '')。iPadOS 13 から、iPad の Safari は Mac と同じ名乗りをするので、
 * 指で触れる点が 2 つ以上ある「Mac」は iPad とみなす。iPhone の中のほかのブラウザも、画面ミラーリングは同じ手順(コントロールセンター)
 * @param {{userAgent?: string, platform?: string, maxTouchPoints?: number}} nav navigator の 3 つの値
 * @returns {'iPhone'|'iPad'|''}
 */
export function appleMobile({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const ua = String(userAgent ?? '');
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if ((platform === 'MacIntel' || /Macintosh/.test(ua)) && Number(maxTouchPoints) > 1) return 'iPad';
  return '';
}

/**
 * テレビ表示の入口を出すか・どの形で出すか・?tv=1 で始めるか。
 * - 出さない(?tv=1 も読まない): ヘッドセット・入口の LED(?led=1)・自動で始める画面(?autostart=1)・重さを測る時(?perf=1)
 * - iPhone・iPad: 'cast'(「テレビに映す」。押すと画面ミラーリングの 3 つの手順と「テレビ表示にする」)
 * - ほか(PC・Android・Mac): 'toggle'(「テレビ表示」。押すとすぐ)
 * @param {{params: URLSearchParams, nav?: {userAgent?: string, platform?: string, maxTouchPoints?: number}, headset?: boolean}} o
 * @returns {{show: boolean, kind: 'cast'|'toggle'|'none', device: 'iPhone'|'iPad'|'', start: boolean}}
 */
export function tvPlan({ params, nav = {}, headset = false }) {
  const flag = (k) => params?.get?.(k) === '1';
  if (headset || flag('led') || flag('autostart') || flag('perf')) return { show: false, kind: 'none', device: '', start: false };
  const device = appleMobile(nav);
  return { show: true, kind: device ? 'cast' : 'toggle', device, start: wantsTv(params) };
}

const isPortrait = (w, h) => Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0 && w < h;

/**
 * テレビ表示の字幕の字の大きさ(px)。画面の高さの 6% を切り上げ(下限 24・上限 120)。
 * 縦長の画面(viewW を渡した時)は、画面の幅の 8% までに抑える(下限 20)
 */
export function tvCaptionPx(viewH, viewW) {
  const h = Number.isFinite(viewH) && viewH > 0 ? viewH : 0;
  const base = Math.min(TV_CAPTION_MAX_PX, Math.max(TV_CAPTION_MIN_PX, Math.ceil(h * TV_CAPTION_FRACTION)));
  if (!isPortrait(viewW, h)) return base;
  return Math.min(base, Math.max(TV_PORTRAIT_CAPTION_MIN_PX, Math.floor(viewW * TV_PORTRAIT_CAPTION_WIDTH_FRACTION)));
}

/** 字幕の箱が見せる行の数(横長 = 3 行、縦長 = 5 行) */
export function tvCaptionRows(viewH, viewW) {
  return isPortrait(viewW, viewH) ? TV_PORTRAIT_ROWS : 3;
}

/**
 * テレビ表示で、キャラの下に字幕のために空ける高さ(px。下の端に残る物(カメラの注意書き)の高さは別に足す)。
 * 字幕 TV_CAPTION_ROWS 行 + 箱の上下の余白(画面の高さの 2.4%)+ 下の端からの間(画面の高さの 3%)。縦長の画面は TV_PORTRAIT_ROWS 行分
 */
export function tvBottomReserve(viewH, viewW) {
  const h = Number.isFinite(viewH) && viewH > 0 ? viewH : 0;
  const cap = tvCaptionPx(h, viewW);
  const rows = isPortrait(viewW, h) ? TV_PORTRAIT_ROWS : TV_CAPTION_ROWS;
  return Math.ceil(rows * TV_CAPTION_LINE * cap + Math.max(16, h * 0.024) + Math.max(10, h * 0.03));
}

/**
 * 画面ミラーリングの 3 つの手順(子どもにも読める言葉。手順の名前は iPhone の画面に出る言葉のまま「画面ミラーリング」)。
 * コントロールセンターの開き方: ホームボタンの無い iPhone と iPad は右上から下へ、ホームボタンのある iPhone は下から上へ。
 * テレビに AirPlay の数字(パスコード)が出たら、iPhone・iPad に入れる
 * @param {'iPhone'|'iPad'|string} [device]
 * @returns {{main: string, sub: string}[]}
 */
export function castSteps(device = 'iPhone') {
  const d = device === 'iPad' ? 'iPad' : 'iPhone';
  return [
    {
      main: 'コントロールセンターをひらく',
      sub: d === 'iPad' ? 'がめんの みぎうえの はしから、したへ なぞる' : 'みぎうえの はしから、したへ なぞる(ホームボタンの ある iPhone は、したから うえへ)',
    },
    { main: '「画面ミラーリング」をおす', sub: '四角が 2 つ かさなった マーク' },
    { main: 'テレビをえらぶ', sub: `テレビに 数字が でたら、${d} に 入れる` },
  ];
}

/** 手順の上の 1 行 */
export function castLead() {
  return 'この がめんを、AirPlay で テレビに うつせます。';
}

/**
 * 手順の下の注意(同じ Wi-Fi・声で話すならマイクを先に・やめ方)。1 つずつ改行で区切る(style.css の .tv-cast-note は pre-line)。
 * テレビ表示では入力の帯(マイクのボタン)を隠すので、声で話すなら先にマイクのボタンを押す(マイクは押した時だけ使う約束のまま。勝手に入れない)
 */
export function castNote(device = 'iPhone') {
  const d = device === 'iPad' ? 'iPad' : 'iPhone';
  return [
    `テレビと ${d} は、おなじ Wi-Fi に つないでね。`,
    'こえで はなす ときは、さきに マイクの ボタンを おしてね。',
    'やめる ときは、もう一度「画面ミラーリング」→「ミラーリングを停止」。',
  ].join('\n');
}
