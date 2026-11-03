// 「誰が話しているか」を、映像と音の両方から出す。純粋なロジック(node --test で確かめる)。
//
// 映像: 人ごとの口の動き(activity)。音: ステレオのマイクが出した声の向き(角度の測定値と、その揺れ σ)。
// どちらか片方でも動く: 音が無ければ映像だけ、映像に口の情報が無ければ音の向きに近い人、人が映っていなければ音の向きだけを返す。
// 考え方は、「話しているのは誰か」の仮説(各人 / 映っていない誰か)の確率を、映像の証拠と音の証拠の掛け算で更新する(ベイズ)。
//   映像の証拠: 口がよく動く人は、話している確率が高い。
//   音の証拠: 測った向きが、その人の向き(映像の位置から計算)に近いほど高い。外れ値(反射・雑音)の分は、一様な分布で受ける。
// 向き: マイクの正面を 0、マイクから見て右を正(−90〜90 度)。キャラの座標(+x が お客さんから見て右、+z が正面)からは bearingOf で直す。

export const FUSION_DEFAULTS = {
  personSigmaDeg: 4, // 映像の位置から出した、その人の向きの誤差
  outlierProb: 0.15, // 測定値が誰にも当たらない(反射・雑音)確率
  priorNobody: 0.2, // 映像に映っていない人が話している(または誰も話していない)事前確率
  activityHalf: 0.012, // 口の動きがこの値なら、話している確率が 1/2(attention.js の speakMin に合わせた)
  minVideoActivity: 0.004, // これ未満なら、映像は「口の情報なし」とみなす(全員が動かない)
  acceptP: 0.55, // この確率以上で、話している人とする
  acceptRatio: 1.6, // 2 番目の人より、この倍率以上
  minAudioConfidence: 0.25,
  mic: { x: 0, z: 0, yawDeg: 0 }, // マイクの位置(キャラの座標)と向き
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** キャラの座標の位置から、マイクから見た向き(正面 0、右が正)を出す。マイクは +z を向いている(+x は、そこから見て左) */
export function bearingOf(position, mic = FUSION_DEFAULTS.mic) {
  const dx = position[0] - mic.x;
  const dz = position[2] - mic.z;
  return (Math.atan2(-dx, dz) * 180) / Math.PI - (mic.yawDeg ?? 0);
}

const gaussian = (d, sigma) => Math.exp(-0.5 * (d / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
const UNIFORM = 1 / 180; // 向き(−90〜90 度)が一様なときの密度

/**
 * @param {{id:number|string, bearingDeg:number, activity?:number}[]} tracks 映っている人
 * @param {{voiced:boolean, measurements:{bearingDeg:number, sigmaDeg:number, confidence?:number}[]}|null} audio マイクの見立て
 * @returns {{speakerId:number|string|null, confidence:number, source:'audio+video'|'audio'|'video'|'none', posterior:Record<string,number>, nobody:number, audioBearingDeg:number|null, unseenBearingDeg:number|null}}
 */
export function fuseSpeaker(tracks, audio, options = {}) {
  const o = { ...FUSION_DEFAULTS, ...options };
  const ms = (audio?.voiced ? audio.measurements : []).filter((m) => (m.confidence ?? 1) >= o.minAudioConfidence);
  const audioInformative = ms.length > 0;
  const audioBearingDeg = audioInformative ? ms[0].bearingDeg : null;
  const videoInformative = tracks.some((t) => (t.activity ?? 0) >= o.minVideoActivity);

  const n = tracks.length;
  if (!audioInformative && !videoInformative) {
    return { speakerId: null, confidence: 0, source: 'none', posterior: {}, nobody: 1, audioBearingDeg, unseenBearingDeg: null };
  }

  // 仮説 0..n-1 = その人が話している、n = 映っていない誰か(または誰も話していない)
  const prior = tracks.map(() => (1 - o.priorNobody) / Math.max(1, n));
  prior.push(o.priorNobody);
  const w = prior.map((p) => Math.log(p));

  if (videoInformative) {
    const s = tracks.map((t) => clamp((t.activity ?? 0) / ((t.activity ?? 0) + o.activityHalf), 0.02, 0.98));
    const allQuiet = s.reduce((acc, v) => acc + Math.log(1 - v), 0);
    for (let i = 0; i < n; i++) w[i] += allQuiet - Math.log(1 - s[i]) + Math.log(s[i]);
    w[n] += allQuiet;
  }
  if (audioInformative) {
    for (let i = 0; i < n; i++) {
      for (const m of ms) {
        const sigma = Math.hypot(m.sigmaDeg, o.personSigmaDeg);
        const d = m.bearingDeg - tracks[i].bearingDeg;
        w[i] += Math.log((1 - o.outlierProb) * gaussian(d, sigma) + o.outlierProb * UNIFORM);
      }
    }
    for (const _ of ms) w[n] += Math.log(UNIFORM); // 映っていない誰かなら、向きはどこでもありうる
  }

  const top = Math.max(...w);
  const e = w.map((x) => Math.exp(x - top));
  const z = e.reduce((a, b) => a + b, 0);
  const p = e.map((x) => x / z);
  const posterior = Object.fromEntries(tracks.map((t, i) => [t.id, p[i]]));

  let bi = -1;
  let second = 0;
  for (let i = 0; i < n; i++) {
    if (bi < 0 || p[i] > p[bi]) {
      if (bi >= 0) second = Math.max(second, p[bi]);
      bi = i;
    } else second = Math.max(second, p[i]);
  }
  const accepted = bi >= 0 && p[bi] >= o.acceptP && p[bi] >= second * o.acceptRatio;
  return {
    speakerId: accepted ? tracks[bi].id : null,
    confidence: accepted ? p[bi] : 0,
    source: audioInformative && videoInformative ? 'audio+video' : audioInformative ? 'audio' : 'video',
    posterior,
    nobody: p[n],
    audioBearingDeg,
    // 音は確かに聞こえるが、映っている誰の向きとも合わない: 映っていない人が話している
    unseenBearingDeg: audioInformative && p[n] >= 0.6 ? audioBearingDeg : null,
  };
}
