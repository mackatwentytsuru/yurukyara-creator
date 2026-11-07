// QR コード(ISO/IEC 18004)を、この画面の中だけで作る小さな部品。外の画像・npm の部品・通信を使わない(「VR(Quest)で開く」で使う)。
// できる事: バイトの形(文字は UTF-8。ECI は付けない)・誤りの直しは M・版 1〜10(21〜57 マス。入るのは 213 バイトまで)・マスクは自動。
// マスクの選び方は segno 1.6 と同じ: 形式の情報・版の情報・暗いマスの所を空けた(明るい)まま 8 つの点を数え、いちばん低い点の、番号の小さい方。
// 答え合わせ: web/test/vr_qr_segno.json(segno で 1 回だけ作った見本)。three も DOM も読まない(node の試験で読む)。

/** 版 10・誤りの直し M に入るバイトの数(これより長い文は QR にしない) */
export const QR_MAX_BYTES = 213;

/** 版ごとの誤りの直し M の組み方: [1 ブロックの直しの語の数, [ブロックの数, 1 ブロックのデータの語の数], …] */
const M_BLOCKS = [
  null,
  [10, [1, 16]],
  [16, [1, 28]],
  [26, [1, 44]],
  [18, [2, 32]],
  [24, [2, 43]],
  [16, [4, 27]],
  [18, [4, 31]],
  [22, [2, 38], [2, 39]],
  [22, [3, 36], [2, 37]],
  [26, [4, 43], [1, 44]],
];

/** 位置合わせの模様の中心(行と列に同じ値を使う) */
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

/** マスクの決まり(r = 行、c = 列。左上が 0, 0) */
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/* ---------- GF(256) と Reed-Solomon(原始多項式 0x11D) ---------- */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** 直しの語を作る式 g(x) = (x - α^0)(x - α^1)…(x - α^(n-1)) の係数(高い次数から。先頭は 1) */
function generatorPoly(degree) {
  let g = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j += 1) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** データの語から、誤りの直しの語(degree 個)を作る(多項式の割り算の余り) */
function errorWords(data, degree) {
  const gen = generatorPoly(degree);
  const rem = new Array(degree).fill(0);
  for (const d of data) {
    const factor = d ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i += 1) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

/* ---------- 語の並び ---------- */
const dataWordCount = (version) => M_BLOCKS[version].slice(1).reduce((n, [count, len]) => n + count * len, 0);

/** 版に入るバイトの数(バイトの形。文字の数の欄は版 1〜9 が 8 ビット、10 が 16 ビット) */
export function capacityBytes(version) {
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataWordCount(version) * 8 - 4 - countBits) / 8);
}

/**
 * バイトの形のデータの語(形の印 0100・文字の数・データ・終わりの 0 を 4 つまで・語の区切りまで 0・埋め草 0xEC 0x11)。
 * 区切りまでの 0 は segno 1.6 と同じく「ちょうど区切りの時も 8 つ」足し、入る数を超えた分は捨てる(読む側は終わりの 0 で止まるので、
 * どちらでも同じ文に読める。見本と同じマスにするため)
 */
function dataWords(bytes, version) {
  const total = dataWordCount(version);
  const bits = [];
  const put = (value, len) => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, total * 8 - bits.length));
  put(0, 8 - (bits.length % 8));
  const words = [];
  for (let i = 0; i < bits.length && words.length < total; i += 8) words.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  for (let pad = 0xec; words.length < total; pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

/** ブロックに分けて直しの語を足し、交互に並べた最後の並び */
function finalMessage(data, version) {
  const [ecLen, ...groups] = M_BLOCKS[version];
  const blocks = [];
  let k = 0;
  for (const [count, len] of groups) {
    for (let b = 0; b < count; b += 1) {
      const d = data.slice(k, k + len);
      k += len;
      blocks.push({ d, e: errorWords(d, ecLen) });
    }
  }
  const out = [];
  const longest = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < longest; i += 1) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecLen; i += 1) for (const b of blocks) out.push(b.e[i]);
  return out;
}

/* ---------- マスの並び ---------- */
/** 決まった模様(位置を探す模様と白い縁・時計の線・位置合わせ)を描き、形式と版の情報の所と暗いマスの所を空ける(明るいまま) */
function baseMatrix(version) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, dark) => {
    m[r][c] = dark ? 1 : 0;
    fixed[r][c] = true;
  };
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const ring = inside && (dr === 0 || dr === 6 || dc === 0 || dc === 6);
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        set(r, c, ring || core);
      }
    }
  }
  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const pos = ALIGN[version];
  const last = pos[pos.length - 1];
  for (const r of pos) {
    for (const c of pos) {
      if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
  for (let i = 0; i <= 8; i += 1) {
    if (!fixed[i][8]) set(i, 8, false);
    if (!fixed[8][i]) set(8, i, false);
  }
  for (let i = 0; i < 8; i += 1) {
    set(size - 1 - i, 8, false); // 下の形式の情報 7 つと暗いマスの所
    set(8, size - 1 - i, false); // 右上の形式の情報 8 つ
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        set(i, size - 11 + j, false);
        set(size - 11 + j, i, false);
      }
    }
  }
  return { size, m, fixed };
}

/** 語を、右下から 2 列ずつ上下に折り返して置く(時計の縦の線の列 6 は飛ばす。余りのマスは明るいまま) */
function placeWords(base, words) {
  const { size, m, fixed } = base;
  const total = words.length * 8;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < size; v += 1) {
      const r = upward ? size - 1 - v : v;
      for (let j = 0; j < 2; j += 1) {
        const c = right - j;
        if (fixed[r][c] || i >= total) continue;
        m[r][c] = (words[i >>> 3] >>> (7 - (i & 7))) & 1;
        i += 1;
      }
    }
  }
}

/** マスクをかける(決まった模様と空けた所にはかけない) */
const applyMask = ({ m, fixed }, mask) => m.map((row, r) => row.map((v, c) => (!fixed[r][c] && MASKS[mask](r, c) ? v ^ 1 : v)));

/* ---------- マスクの点数(ISO/IEC 18004:2015 7.8.3。数え方は segno 1.6 と同じ) ---------- */
const FINDER_LIKE = [1, 0, 1, 1, 1, 0, 1];

function findFinderLike(seq, from) {
  for (let s = Math.max(0, from); s <= seq.length - 7; s += 1) {
    let hit = true;
    for (let k = 0; k < 7 && hit; k += 1) hit = seq[s + k] === FINDER_LIKE[k];
    if (hit) return s;
  }
  return -1;
}

/** 1:1:3:1:1 の模様。前か後ろに明るいマスが 4 つ(端の外は明るいと数える)あれば 40 点。数えた後は 7 つ先、数えなかった時は 4 つ先から探す */
function finderLikeScore(seq) {
  const n = seq.length;
  let score = 0;
  let idx = findFinderLike(seq, 0);
  while (idx !== -1) {
    let next = idx + 7;
    const before = seq.slice(Math.max(idx - 4, 0), Math.min(idx, n));
    const after = seq.slice(Math.max(next, 0), Math.min(next + 4, n));
    if (idx === 0 || idx === n - 7 || !before.some((v) => v) || !after.some((v) => v)) score += 40;
    else next = idx + 4;
    idx = findFinderLike(seq, next);
  }
  return score;
}

/** マスクをかけた並びの点数(低いほど読み取りやすい) */
export function maskPenalty(m) {
  const n = m.length;
  let n1 = 0;
  let n2 = 0;
  let n3 = 0;
  let dark = 0;
  for (let i = 0; i < n; i += 1) {
    let rowRun = 0;
    let colRun = 0;
    let rowPrev = -1;
    let colPrev = -1;
    const col = new Array(n);
    for (let j = 0; j < n; j += 1) {
      const a = m[i][j];
      const b = m[j][i];
      col[j] = b;
      dark += a;
      if (a === rowPrev) rowRun += 1;
      else {
        if (rowRun >= 5) n1 += rowRun - 2;
        rowRun = 1;
      }
      if (b === colPrev) colRun += 1;
      else {
        if (colRun >= 5) n1 += colRun - 2;
        colRun = 1;
      }
      if (i > 0 && j > 0 && a === rowPrev && a === m[i - 1][j] && a === m[i - 1][j - 1]) n2 += 3;
      rowPrev = a;
      colPrev = b;
    }
    if (rowRun >= 5) n1 += rowRun - 2;
    if (colRun >= 5) n1 += colRun - 2;
    n3 += finderLikeScore(m[i]) + finderLikeScore(col);
  }
  const n4 = 10 * Math.trunc(Math.abs((dark / (n * n)) * 100 - 50) / 5);
  return n1 + n2 + n3 + n4;
}

/* ---------- 形式の情報・版の情報 ---------- */
/** 形式の情報 15 ビット(誤りの直し M = 00 とマスクの番号に BCH を付け、0x5412 を重ねる) */
export function formatBits(mask) {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
}

/** 版の情報 18 ビット(版 7 から) */
export function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | (rem & 0xfff);
}

function drawFormatAndVersion(m, version, mask) {
  const size = m.length;
  const f = formatBits(mask);
  const bit = (i) => (f >>> i) & 1;
  for (let i = 0; i <= 5; i += 1) m[i][8] = bit(i);
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i < 15; i += 1) m[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i += 1) m[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i += 1) m[size - 15 + i][8] = bit(i);
  m[size - 8][8] = 1; // 暗いマス
  if (version < 7) return;
  const v = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const b = (v >>> i) & 1;
    const a = size - 11 + (i % 3);
    const k = Math.floor(i / 3);
    m[k][a] = b;
    m[a][k] = b;
  }
}

/* ---------- 入口 ---------- */
/**
 * 文を QR にする(バイトの形・誤りの直し M・版 1〜10・マスクは自動)。長すぎる時は null。
 * @param {string} text
 * @returns {{version: number, size: number, mask: number, matrix: number[][]} | null} matrix は行の並び(1 = 暗い)。静かな縁は含まない
 */
export function encodeQr(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  let version = 0;
  for (let v = 1; v < M_BLOCKS.length; v += 1) {
    if (bytes.length <= capacityBytes(v)) {
      version = v;
      break;
    }
  }
  if (!version) return null;
  const words = finalMessage(dataWords(bytes, version), version);
  const base = baseMatrix(version);
  placeWords(base, words);
  let best = null;
  for (let mask = 0; mask < MASKS.length; mask += 1) {
    const m = applyMask(base, mask);
    const score = maskPenalty(m);
    if (!best || score < best.score) best = { mask, score, m };
  }
  drawFormatAndVersion(best.m, version, best.mask);
  return { version, size: base.size, mask: best.mask, matrix: best.m };
}

/**
 * QR を SVG の 1 本の path にする(暗いマスの横の並びごとに四角)。margin は静かな縁のマスの数(決まりは 4)。
 * @param {number[][]} matrix
 * @param {number} [margin]
 * @returns {{d: string, view: number}} view は縁を含む 1 辺のマスの数(viewBox は 0 0 view view)
 */
export function qrPath(matrix, margin = 4) {
  const parts = [];
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c += 1;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c += 1;
      parts.push(`M${start + margin} ${r + margin}h${c - start}v1h-${c - start}z`);
    }
  });
  return { d: parts.join(''), view: matrix.length + margin * 2 };
}
