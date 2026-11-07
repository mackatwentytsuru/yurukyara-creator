// 見せ方の 3 つ(screen / ar / vr)を、ページから 1 か所で切りかえる入口。web/ はこれだけ呼べばよい。
//   const modes = await createPresentation({ renderer, scene, camera, place, background, onViewer, onChange });
//   modes.available   … { screen, ar, vr, ar_kind: 'webxr'|'native'|null, reason }
//   await modes.enter('ar' | 'vr')   … 入る(いまのモードは先に終わらせる)。失敗したら例外(日本語)。
//                                       頼んでいる途中(ブラウザの「許可する」を待つ間)に呼んでも、2 回目は頼まず同じ約束を返す
//   modes.pending                     … 頼んでいる途中の見せ方('ar' | 'vr')。無ければ null
//   await modes.exit()                … screen に戻る
//   modes.mode / modes.viewerPeople() … いまのモード / 見ている人(会話の柱の getPeople と同じ形)
//
// 背景: AR は現実が背景なので、ページの CSS の背景も消す。<html> に data-presentation="screen|ar|vr" と
// クラス presentation-ar / presentation-vr を付ける。AR のとき html と body の背景を透明にする。
// AR で隠したい要素には data-hide-in-ar を付ける。
//
// 見ている人の頭: iPhone の殻は毎フレーム onViewer(camera) が呼ばれる。WebXR(Quest)は
// renderer.setAnimationLoop の中で modes.viewerPeople() を呼ぶか、onViewer を使う(下の frame())。
import { applyPresentation, detectXR, startXR, viewerPerson } from './xr.js';
import { createNativeAR } from './nativeAR.js';

const STYLE_ID = 'place-presentation-style';
const STYLE = `
html[data-presentation="ar"], html[data-presentation="ar"] body { background: transparent !important; }
html[data-presentation="ar"] [data-hide-in-ar] { display: none !important; }
`;

function setDocumentMode(win, mode) {
  const doc = win.document;
  const root = doc?.documentElement;
  if (!root) return;
  if (doc.head && !doc.getElementById?.(STYLE_ID)) {
    const el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = STYLE;
    doc.head.appendChild(el);
  }
  root.dataset.presentation = mode;
  for (const m of ['ar', 'vr']) root.classList.toggle(`presentation-${m}`, m === mode);
}

export async function createPresentation({
  renderer, scene, camera, place, background,
  onViewer, onChange, onFloor, onHit,
  nav = globalThis.navigator, win = globalThis,
}) {
  const available = await detectXR({ nav, win });
  const viewer = viewerPerson(camera);
  let mode = 'screen';
  let session = null; // WebXR の session の情報
  let native = null; // iPhone の殻
  let restore = null;
  setDocumentMode(win, 'screen');

  const listeners = new Set();
  function setMode(next) {
    mode = next;
    setDocumentMode(win, next);
    onChange?.(next);
    for (const fn of listeners) fn(next);
  }

  async function exit() {
    const wasSession = session;
    session = null;
    if (wasSession) await wasSession.end().catch(() => {});
    if (native) {
      native.stop();
      native = null;
    }
    restore?.();
    restore = null;
    if (mode !== 'screen') setMode('screen');
  }

  // 頼んでいる途中の入り方({ mode, promise })。実機の Quest は requestSession の間にブラウザの「許可する」の帯を出し、答えるまで返さない。
  // その間にもう一度頼むと InvalidStateError(already an active, immersive XRSession)になったので、2 回目は頼まずに同じ約束を返す
  let pending = null;
  function enter(next) {
    if (pending) return pending.promise;
    const promise = enterNow(next).finally(() => {
      if (pending?.promise === promise) pending = null;
    });
    pending = { mode: next, promise };
    return promise;
  }

  async function enterNow(next) {
    if (next === 'screen') return exit();
    if (next !== 'ar' && next !== 'vr') throw new Error(`mode は screen・ar・vr のどれか: ${next}`);
    if (!available[next]) throw new Error(available.reason || `この端末では ${next} を使えない`);
    await exit();
    if (next === 'ar' && available.ar_kind === 'native') {
      restore = applyPresentation({ mode: 'ar', scene, renderer, place, background });
      native = createNativeAR({ camera, win, onHit, onFloor, onPose: onViewer });
      native.start();
    } else {
      session = await startXR({ renderer, mode: next, scene, place, background, nav });
      // 入ったあと、ユーザーがヘッドセットの操作で終わらせたら、画面に戻る
      session.session.addEventListener('end', () => {
        if (session) {
          session = null;
          restore = null;
          if (mode !== 'screen') setMode('screen');
        }
      }, { once: true });
    }
    setMode(next);
  }

  return {
    available,
    get mode() { return mode; },
    get nativeAR() { return native; },
    get session() { return session; },
    get pending() { return pending?.mode ?? null; },
    enter,
    exit,
    /** モードが変わるたび fn(mode) を呼ぶ(ボタンの表示の更新など)。戻り値で解除。 */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    viewerPeople: () => viewer.getPeople(),
    /** WebXR のとき、毎フレームの中で呼ぶと onViewer(camera) が届く(殻では nativeAR が自分で呼ぶ)。 */
    frame() {
      if (session) onViewer?.(camera);
    },
  };
}
