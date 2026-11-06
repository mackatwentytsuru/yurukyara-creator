// 声が無いとき(鍵なし・枠切れ・公開のリンク)の、レトロ RPG 風の効果音と文字送り。音は WebAudio で作る(音のファイルは使わない)。
// - 文字を 1 字ずつ出し、字ごとに短い「ピッ」を鳴らす。句読点では少し止まる。空白・記号は鳴らさない
// - キャラごとに声の高さと音色が変わる(名前から決まる。同じキャラはいつも同じ)
// - 音は口の動きの分析器(analyser)へつなぐので、口が「ピッ」に合わせて開く
// 時間の計算(crawlSchedule・blipHz)は WebAudio が無くても動く(試験で使う)。

export const RETRO = { cps: 16, punctPauseMs: 170, blipMs: 42, tailMs: 150 };

const NO_BLIP = /[\s、。,.!?！？…「」『』()（）・~〜ー\-]/u;
const PAUSE = /[、。,.!?！？…]/u;
const PENTA = [0, 2, 4, 7, 9]; // 字ごとの高さの差(半音)。5 音の並びで、耳ざわりにしない

export const isBlipChar = (ch) => !NO_BLIP.test(ch);
export const isPause = (ch) => PAUSE.test(ch);

/**
 * 文字送りの予定。steps[k] は k+1 字目を出す時刻と、その時に見えている文字。
 * @returns {{steps:{n:number, ch:string, shown:string, atMs:number, blip:boolean}[], totalMs:number}}
 */
export function crawlSchedule(text, { cps = RETRO.cps, punctPauseMs = RETRO.punctPauseMs } = {}) {
  const chars = Array.from(String(text ?? ''));
  const step = 1000 / Math.max(1, cps);
  const steps = [];
  let t = 0;
  let shown = '';
  for (const [k, ch] of chars.entries()) {
    shown += ch;
    steps.push({ n: k + 1, ch, shown, atMs: Math.round(t), blip: isBlipChar(ch) });
    t += isPause(ch) ? punctPauseMs : step;
  }
  return { steps, totalMs: Math.round(t) };
}

/** キャラの名前などから、声の高さと音色を決める(同じ名前なら同じ) */
export function voiceFor(seed = '') {
  let h = 2166136261;
  for (const c of String(seed)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const wave = (h >>> 9) % 2 ? 'square' : 'triangle';
  return { baseHz: 360 + (h % 300), wave, gain: wave === 'square' ? 0.06 : 0.11 };
}

/** その字の高さ(Hz) */
export function blipHz(voice, ch) {
  const code = String(ch).codePointAt(0) ?? 0;
  const semi = PENTA[code % PENTA.length] - 2;
  return Math.round(voice.baseHz * 2 ** (semi / 12) * 10) / 10;
}

/**
 * 「ピッ」を予定どおりに鳴らす。作った発振器の一覧を返す(止めるとき・鳴っているかの判定に使う)。
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest つなぐ先(口の分析器)
 */
export function scheduleRetro(ctx, dest, steps, voice, startAt, { blipMs = RETRO.blipMs } = {}) {
  const nodes = [];
  const len = blipMs / 1000;
  for (const s of steps) {
    if (!s.blip) continue;
    const t = startAt + s.atMs / 1000;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = voice.wave;
    osc.frequency.setValueAtTime(blipHz(voice, s.ch), t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(voice.gain, t + 0.005);
    g.gain.setValueAtTime(voice.gain, t + len - 0.01);
    g.gain.linearRampToValueAtTime(0, t + len);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + len + 0.01);
    nodes.push(osc);
  }
  return nodes;
}
