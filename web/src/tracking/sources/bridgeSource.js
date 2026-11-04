// 視線の橋(床のカメラ → 客の向き)から届く向きを、「人の位置」にする入力。入口の LED のページ(?source=bridge)で使う。
// サーバーの /api/gaze/now が、UDP で受けた最新の v1({present, az, el, dist, ageMs})を返す。ページ(main.js)が毎秒 15 回読んで receive() に渡す。
// az・el は「キャラの目から見た客の方向」(az は客から見て右が +、el は上が +)。キャラの座標(足元が原点・+z が正面・
// +x がお客さんから見て右)では、目の位置から dist だけ先の点になる。カメラがどこにあっても、ページは向きだけを使う。

const DEG = Math.PI / 180;

/**
 * v1 の向きを、キャラの座標の点にする(テストできるよう、外に出す)。
 * @param {{az:number, el:number, dist?:number|null}} g
 * @param {number} headY キャラの目の高さ(キャラの座標、m)
 * @param {number} [fallbackDist] 距離が無いときの距離(m)
 * @returns {[number, number, number]}
 */
export function gazeToLocal(g, headY, fallbackDist = 2) {
  const d = Number.isFinite(g.dist) && g.dist > 0 ? g.dist : fallbackDist;
  const az = g.az * DEG;
  const el = g.el * DEG;
  return [d * Math.sin(az) * Math.cos(el), headY + d * Math.sin(el), d * Math.cos(az) * Math.cos(el)];
}

export class BridgeSource {
  /**
   * 受け身の入力(PoseSource と同じ)。追従のコードは通信しない決まりなので、サーバーへの読み取りは main.js が行い、receive() に渡す。
   * @param {{getFrame:()=>{toWorld:(v:number[])=>number[], headY:number}, staleMs?:number}} opts
   */
  constructor({ getFrame, staleMs = 1500 } = {}) {
    this.kind = 'bridge';
    this.getFrame = getFrame;
    this.staleMs = staleMs;
    this.last = null; // { present, az, el, dist, aim, receivedAt }
    this.count = 0;
    this.started = false;
  }

  async start() {
    this.started = true;
  }

  /** 1 件を受ける(JSON の文字列か、オブジェクト)。ageMs(サーバーが受けてからの時間)の分だけ、受けた時刻を前にずらす */
  receive(data, nowMs = performance.now()) {
    let g = data;
    if (typeof data === 'string') {
      try {
        g = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!g || typeof g !== 'object' || typeof g.present !== 'boolean') return;
    if (g.present && (!Number.isFinite(g.az) || !Number.isFinite(g.el))) return;
    const age = Number.isFinite(g.ageMs) && g.ageMs > 0 ? g.ageMs : 0;
    this.last = { present: g.present, az: g.az, el: g.el, dist: g.dist ?? null, aim: g.aim === true, receivedAt: nowMs - age };
    this.count += 1;
  }

  stop() {
    this.started = false;
    this.last = null;
  }

  getPeople(nowMs = performance.now()) {
    const g = this.last;
    if (!g || !g.present || nowMs - g.receivedAt > this.staleMs) return [];
    const { toWorld, headY } = this.getFrame();
    const local = gazeToLocal(g, headY);
    const world = toWorld(local);
    return [{ id: 'guest', position: world, gaze: world, mouth: 0 }];
  }

  /** いまの向き(画面の表示・試験用) */
  current() {
    return this.last;
  }

  info() {
    const g = this.last;
    if (!g) return { label: '床のカメラを待っています', ok: false };
    if (g.aim) return { label: `向きを手で合わせ中 ${g.az.toFixed(1)}°, ${g.el.toFixed(1)}°`, ok: true };
    return g.present ? { label: '床のカメラで追跡中', ok: true } : { label: '床のカメラに人がいません', ok: false };
  }
}
