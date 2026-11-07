// 話しかけた回だけ、カメラの「いまの絵」を 1 枚、小さな JPEG にする(BCV。11-08 本人「カメラは使う人が決める・カメラの中身にも答える」)。
// ここが、カメラの絵を画面の外へ出せる形にする、ただ 1 つの場所(web/test/privacy.test.mjs が見張る)。
// - 呼ぶのは main.js の getImage だけ: 使う人がカメラを入れて(知らせを読んで)、声か文字で話しかけた回に 1 回。ずっと送らない
// - 保存しない: localStorage・sessionStorage・IndexedDB・ファイル・記録に書かない。作った文字は、その回の会話の本文にだけ入る
// - 顔の追従と同じカメラの流れ(<video>)から取る。新しくカメラを開かない。描いた後は下書きの絵を消す
// - 通信しない(送るのは会話の側)

export const FRAME_LONG_SIDE = 512; // 長い辺(px)。頭脳が読む量の目安は 幅 × 高さ ÷ 750 = 4:3 で約 262
export const FRAME_QUALITY = 0.7;
export const FRAME_MAX_BASE64 = 150_000; // これを超えたら画質を下げて作り直す(サーバーの上限は 160,000 字)
const LOWER_QUALITY = [0.55, 0.4];
const JPEG_PREFIX = 'data:image/jpeg;base64,';
let shared = null; // 使い回す 1 枚の下書き(iOS の Safari は canvas のメモリに厳しいので、回ごとに作らない。使った後は 1x1 に縮めて手放す)

/**
 * 縦横の比を保って、長い辺を longSide にした大きさ(元が小さければ、そのまま)。
 * @returns {{width:number, height:number}}
 */
export function frameSize(width, height, longSide = FRAME_LONG_SIDE) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const scale = Math.min(1, longSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * カメラの <video> の今のコマを 1 枚、JPEG(base64)にする。まだ映っていない・作れない時は null。
 * @param {HTMLVideoElement|null|undefined} video 顔の追従が使っている <video>
 * @param {{canvas?: HTMLCanvasElement, longSide?: number, quality?: number, maxBase64?: number}} [o]
 * @returns {{type:'jpeg', data:string, width:number, height:number}|null}
 */
export function takeFrame(video, { canvas, longSide = FRAME_LONG_SIDE, quality = FRAME_QUALITY, maxBase64 = FRAME_MAX_BASE64 } = {}) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  const { width, height } = frameSize(video.videoWidth, video.videoHeight, longSide);
  const c = canvas ?? (shared ??= document.createElement('canvas'));
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, width, height);
    for (const q of [quality, ...LOWER_QUALITY.filter((v) => v < quality)]) {
      const url = c.toDataURL('image/jpeg', q);
      if (!url.startsWith(JPEG_PREFIX)) return null; // JPEG を作れないブラウザ(送らない)
      const data = url.slice(JPEG_PREFIX.length);
      if (data.length <= maxBase64) return { type: 'jpeg', data, width, height };
    }
    return null; // 小さくできなかった(送らない)
  } catch {
    return null; // 描けなかった(送らない)
  } finally {
    ctx.clearRect(0, 0, width, height); // 下書きの絵を残さない
    c.width = 1; // 下書きのメモリを手放す(大きさを変えると中身も消える)
    c.height = 1;
  }
}
