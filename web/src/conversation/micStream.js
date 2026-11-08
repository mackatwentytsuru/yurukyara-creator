// マイクの音を取る(getUserMedia)。カメラが入っている間に失敗したら、1 回だけ取り直す(11-08 本人の iPhone: カメラを入れたままだと話せなかった)。
// iPhone のブラウザは、カメラが動いている最中のマイクの取得を、音の設定の取り合いで断ることがある。少し待つ・カメラを一瞬だけ止める、で通ることがある。
// - 許可しなかった(NotAllowedError・SecurityError)時は、取り直さない(人の返事を覆さない)
// - 取り直しは 1 回だけ。カメラを止められる時は、止めてから取り、取れたら(取れなくても)すぐ戻す
// DOM も three も読まない小さな部品(node の試験で読む)。

export const RETRY_WAIT_MS = 350;
const DENIED = new Set(['NotAllowedError', 'SecurityError']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 取り直してよい失敗か(人が断った時は取り直さない) */
export function canRetryMic(err) {
  return !DENIED.has(String(err?.name ?? ''));
}

/**
 * @param {(constraints: object) => Promise<MediaStream>} getUserMedia
 * @param {object} constraints getUserMedia に渡す音の決まり
 * @param {object} [o]
 * @param {boolean} [o.cameraOn] カメラが入っているか(入っている時だけ取り直す)
 * @param {() => (() => void)} [o.holdCamera] カメラの映像を一瞬止める。戻す関数を返す(無ければ、待つだけ)
 * @param {(ms: number) => Promise<void>} [o.wait]
 * @param {(info: {error: unknown, held: boolean}) => void} [o.onRetry] 取り直す時(記録用)
 * @returns {Promise<MediaStream>}
 */
export async function openMicStream(getUserMedia, constraints, { cameraOn = false, holdCamera, wait = sleep, onRetry } = {}) {
  try {
    return await getUserMedia(constraints);
  } catch (first) {
    if (!cameraOn || !canRetryMic(first)) throw first;
    let release = null;
    try {
      release = holdCamera?.() ?? null;
    } catch {
      release = null; // 止められなくても、待つだけで取り直す
    }
    try {
      onRetry?.({ error: first, held: Boolean(release) });
      await wait(RETRY_WAIT_MS);
      return await getUserMedia(constraints);
    } finally {
      try {
        release?.();
      } catch {
        // 戻せなくても、声の失敗の知らせを優先する
      }
    }
  }
}
