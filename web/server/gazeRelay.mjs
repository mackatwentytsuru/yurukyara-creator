// 視線の橋(kiosk/tools/eye_camera/gaze_bridge.py)の UDP の 1 行 JSON(v1)を受けて、ページに渡す(GET /api/gaze/now を、ページが毎秒 15 回読む)。
// 入口の LED に出すページ(?source=bridge)が、床のカメラの客の向きで、キャラの目と首を動かすための口。
// 受けるのは数字だけ(向き・距離・人数)。カメラの絵や音は、ここに来ない。
//
// v1: {"v":1,"present":bool,"az":度(キャラから見て、客が右なら +),"el":度(上が +),"dist":m,"n":人数,"facing":0〜1,"seq":番号}
//     視線の橋を with_pixels で動かすと、目の中点の画素 "u","v_px" と目の間隔の画素 "ipd_px" も付く(校正の点に使う)。
//
// 校正の手伝い(人が「自分を見ている」と感じる向きに合わせる)のために、向きを手で決める「狙い」も持つ。
// 狙いが有効な間は、カメラの向きの代わりに、狙いの向きをページへ流す。
import { createSocket } from 'node:dgram';

const LIMIT = { az: 90, el: 60, dist: 20 };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * 外から届いた 1 行を、信じてよい形に直す。おかしな物は null(捨てる)。
 * @param {unknown} raw
 * @returns {{present:boolean, az:number, el:number, dist:number|null, n:number, facing:number|null, seq:number|null}|null}
 */
export function sanitizeGaze(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.v !== 1 || typeof raw.present !== 'boolean') return null;
  if (!raw.present) return { present: false, az: 0, el: 0, dist: null, n: 0, facing: null, seq: finite(raw.seq) ? raw.seq : null };
  if (!finite(raw.az) || !finite(raw.el)) return null;
  const px = finite(raw.u) && finite(raw.v_px) && finite(raw.ipd_px) && raw.ipd_px > 0 ? { u: clamp(raw.u, -1e4, 1e4), v_px: clamp(raw.v_px, -1e4, 1e4), ipd_px: clamp(raw.ipd_px, 0, 1e4) } : {};
  return {
    ...px,
    present: true,
    az: clamp(raw.az, -LIMIT.az, LIMIT.az),
    el: clamp(raw.el, -LIMIT.el, LIMIT.el),
    dist: finite(raw.dist) && raw.dist > 0 ? clamp(raw.dist, 0.2, LIMIT.dist) : null,
    n: finite(raw.n) ? clamp(Math.round(raw.n), 0, 32) : 1,
    facing: finite(raw.facing) ? clamp(raw.facing, 0, 1) : null,
    seq: finite(raw.seq) ? raw.seq : null,
  };
}

/** 狙い(手で決める向き)を直す。{az, el} 度。off なら null */
export function sanitizeAim(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.off === true) return { off: true };
  if (!finite(raw.az) || !finite(raw.el)) return null;
  return { off: false, az: clamp(raw.az, -LIMIT.az, LIMIT.az), el: clamp(raw.el, -LIMIT.el, LIMIT.el), dist: finite(raw.dist) && raw.dist > 0 ? clamp(raw.dist, 0.2, LIMIT.dist) : 2 };
}

/**
 * @param {{port:number, host?:string, now?:()=>number}} opts
 */
export function createGazeRelay({ port, host = '127.0.0.1', now = () => Date.now() } = {}) {
  let last = null; // 最後に受けた向き(sanitize 済み)+ at
  let aim = null; // 手で決めた向き。null なら無効
  const points = []; // 校正の点(kiosk/tools/eye_camera/gaze_calib.py の points.json と同じ形)
  let received = 0;
  let dropped = 0;
  let socket = null;

  /** いまページに渡す向き。ageMs = 受けてからの時間(ページは古い物を「いない」とみなす)。狙いが有効なら狙い */
  const current = () => {
    if (aim) return { present: true, az: aim.az, el: aim.el, dist: aim.dist, n: 1, facing: 1, seq: null, aim: true, ageMs: 0 };
    if (!last) return null;
    const { u, v_px, ipd_px, at, ...rest } = last; // 画素は校正の記録にだけ使う(ページには渡さない)
    return { ...rest, ageMs: Math.max(0, now() - at) };
  };

  function accept(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      dropped += 1;
      return false;
    }
    const g = sanitizeGaze(raw);
    if (!g) {
      dropped += 1;
      return false;
    }
    received += 1;
    last = { ...g, aim: false, at: now() };
    return true;
  }

  function start() {
    return new Promise((resolve, reject) => {
      socket = createSocket('udp4');
      socket.on('message', (buf) => {
        if (buf.length > 2048) {
          dropped += 1;
          return;
        }
        accept(buf.toString('utf8'));
      });
      socket.once('error', reject);
      socket.bind(port, host, () => {
        socket.off('error', reject);
        socket.on('error', (e) => console.warn('視線の受け口:', e.message));
        resolve(socket.address().port);
      });
    });
  }

  function stop() {
    socket?.close();
    socket = null;
  }

  /** POST /api/gaze/aim {az, el, dist?} か {off:true} */
  function setAim(body) {
    const a = sanitizeAim(body);
    if (!a) return null;
    aim = a.off ? null : a;
    return { aim, last };
  }

  /**
   * POST /api/gaze/mark: いまの狙いの向き(人が「自分を見ている」と感じた向き)と、いまのカメラの顔の画素を、1 点として記録する。
   * 狙いが無い・画素が無い・古い(staleMs より前)ときは、理由を返して記録しない。
   */
  function mark({ staleMs = 1000 } = {}) {
    if (!aim) return { ok: false, reason: '先に向きを合わせてください(狙いが無効)' };
    if (!last?.present || !finite(last.ipd_px)) return { ok: false, reason: 'カメラに顔が見えていません(画素つきの視線が届いていない)' };
    if (now() - last.at > staleMs) return { ok: false, reason: 'カメラの値が古すぎます' };
    const p = { u: last.u, v: last.v_px, ipd_px: last.ipd_px, yaw_deg: aim.az, pitch_deg: aim.el };
    points.push(p);
    return { ok: true, point: p, count: points.length };
  }

  /** 最後の 1 点を取り消す / 全部消す */
  function unmark(all = false) {
    if (all) points.length = 0;
    else points.pop();
    return { ok: true, count: points.length };
  }

  const status = () => ({ port, received, dropped, last, aim, points: points.length });

  return { start, stop, setAim, mark, unmark, points: () => points.slice(), accept, status, current };
}
