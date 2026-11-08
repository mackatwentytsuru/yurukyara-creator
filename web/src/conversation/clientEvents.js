// 声の聞き取りを始められなかった時の、原因だけの報告(11-08 本人の iPhone: 「カメラオンで試してるけど会話ができないよ」)。
// 送るのは、失敗の名前・短い message・提供元(web / server)・カメラが入っていたか・https か・ブラウザの種類(短い分類)だけ。
// 音も、話した文字も、ブラウザの UA の全文も送らない。受け口は手元のサーバー(POST /api/client-event。公開の版は受けなくてよい)。
// DOM も three も読まない小さな部品(node の試験で読む)。

export const CLIENT_EVENT_PATH = '/api/client-event';
// 'sheet-blank' = 作る札の中が見えなくなって、札が自分で立て直した時(11-08 本人の iPhone)。stage に「何が見えなかったか」だけを入れる
export const EVENT_KINDS = Object.freeze(['voice-start-failed', 'voice-fallback', 'sheet-blank']);
export const BROWSER_FAMILIES = Object.freeze(['ios-chrome', 'ios-safari', 'ios-other', 'android-chrome', 'android-other', 'quest', 'chrome', 'edge', 'firefox', 'safari', 'other']);

/** UA の文字列から、短いブラウザの分類だけを作る(UA の全文は外へ出さない) */
export function browserFamily(ua = '') {
  const s = String(ua);
  if (/OculusBrowser|Quest/i.test(s)) return 'quest';
  if (/iPhone|iPad|iPod/i.test(s)) {
    if (/CriOS/i.test(s)) return 'ios-chrome';
    if (/FxiOS|EdgiOS|OPiOS/i.test(s)) return 'ios-other';
    return 'ios-safari';
  }
  if (/Android/i.test(s)) return /Chrome\//i.test(s) && !/EdgA|OPR|SamsungBrowser/i.test(s) ? 'android-chrome' : 'android-other';
  if (/Edg\//i.test(s)) return 'edge';
  if (/Firefox\//i.test(s)) return 'firefox';
  if (/Chrome\//i.test(s)) return 'chrome';
  if (/Safari\//i.test(s)) return 'safari';
  return 'other';
}

const safeName = (v, max) => String(v ?? '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, max);
// message は 1 行・短く。改行と制御文字は空白に
const safeMessage = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

/**
 * 報告 1 件を作る。名前・message・段(どこで失敗したか)は長さを切る。何も推測しない。
 * @param {object} o
 * @param {'voice-start-failed'|'voice-fallback'} [o.kind]
 * @param {unknown} [o.error] 失敗(name・message を読む)
 * @param {'web'|'server'|string} [o.provider]
 * @param {boolean} [o.cameraOn]
 * @param {boolean} [o.secure]
 * @param {string} [o.ua]
 * @param {string} [o.stage] 失敗した段(例 'mic-open'・'recognition'・'capture')
 * @param {boolean} [o.fellBack] PC の聞き取りへ替えたか
 */
export function buildVoiceEvent({ kind = 'voice-start-failed', error, provider, cameraOn, secure, ua, stage, fellBack } = {}) {
  const e = error && typeof error === 'object' ? error : { name: '', message: String(error ?? '') };
  return {
    kind: EVENT_KINDS.includes(kind) ? kind : 'voice-start-failed',
    name: safeName(e.name || e.error, 60),
    message: safeMessage(e.message, 120),
    stage: safeName(stage, 24),
    provider: provider === 'server' ? 'server' : 'web',
    camera: cameraOn === true,
    secure: secure === true,
    browser: browserFamily(ua),
    fellBack: fellBack === true,
  };
}

/** 報告を送る。失敗しても何も起こさない(声の聞き取りの邪魔をしない)。送れたら true */
export async function sendClientEvent(event, { fetchFn = globalThis.fetch?.bind(globalThis) } = {}) {
  if (typeof fetchFn !== 'function') return false;
  try {
    const res = await fetchFn(CLIENT_EVENT_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    });
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

/** 画面から呼ぶ入口: 今の画面の事実(https・UA)を足して送る */
export function reportVoice(fields, deps = {}) {
  const env = {
    secure: globalThis.isSecureContext === true,
    ua: globalThis.navigator?.userAgent ?? '',
  };
  return sendClientEvent(buildVoiceEvent({ ...env, ...fields }), deps);
}
