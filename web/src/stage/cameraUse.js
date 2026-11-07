// カメラを使う人が決める(BCV。11-08 本人「カメラを有効にするか無効にするかはユーザーが決められればいい。…ユーザーが責任を持って決める」)。
// main.js から 1 回だけ呼ばれ、次をまとめて受け持つ(main.js の手を広げないため。main.js が渡すのは、その中の物だけ):
// - 入・切: 入力の列のボタン・テレビ表示の隅のボタン・入れる前の 1 行の知らせ(画面の部品は cameraSwitch.js)
// - 入れる: 新しい顔の追従(MediapipeSource)を先に動かし、動いてから前の入力を止める。切る: カメラなしの入力を動かしてから、カメラの流れを止める
// - 勝手に止まった(許可の取り消し・抜いた)時は、切った形にそろえて知らせる
// - 絵の 1 枚: 使う人が選んだカメラ(入口で人が押した・知らせで「カメラを つかう」)が動いていて、声か文字で話しかけた回だけ(近づいた合図は除く)。
//   顔の追従と同じ <video> から取る(cameraFrame.js)。自動で始める画面(入口の LED など)は押す人がいないので、顔の追従だけ(絵は送らない)
// - サーバーの知らせ(cameraNotice): 「本物の頭脳の時だけ見られる」は入れている間に 1 回だけ、「今日の絵の上限」は毎回
import { cameraSwitchPlan, mountCameraSwitch, CAMERA_PRIVACY, CAMERA_PRIVACY_BACK } from './cameraSwitch.js';
import { takeFrame } from '../conversation/cameraFrame.js';
import { SimSource } from '../tracking/sources/simSource.js';

export const CAMERA_ENDED = 'カメラが とまりました。また つかう ときは、カメラの ボタンを おしてね';

/**
 * @param {object} o
 * @param {object} o.app main.js の app(mode・source を読み書きする)
 * @param {object} o.ui 画面の部品(notice を使う)
 * @param {object} o.dialogue 会話(getImage と onEvent を付ける)
 * @param {(id: string) => HTMLElement|null} o.$ 要素を id で取る
 * @param {URLSearchParams} o.params ?led= ?autostart= ?source= ?perf=
 * @param {boolean} o.headset Quest などのヘッドセットのブラウザか
 * @param {boolean} o.touch 指で触る端末か(「うしろの カメラ」を出す)
 * @param {() => {getFrame: Function, gain: number, hfovDeg: number}} o.sourceOptions 入力を作る時の決まり(main.js の frameInfo・GAIN・HFOV)
 * @param {() => boolean} o.inXr いま VR・AR の中か(その間は入れない)
 * @param {() => void} o.updatePrivacy 入力が替わった後に呼ぶ(注意書き・ボタンの見た目)
 * @param {() => boolean} o.isMock いま仮の頭脳か(知らせの窓に 1 行足す)
 * @param {() => Promise<{MediapipeSource: Function}>} [o.loadFace] 顔の追従の部品を読む(重いので、入れる時に読む)
 */
export function createCameraUse({ app, ui, dialogue, $, params, headset, touch, sourceOptions, inXr, updatePrivacy, isMock, loadFace = () => import('../tracking/sources/mediapipeSource.js') }) {
  const watchedTracks = new WeakSet(); // 流れ(track)ごとに 1 回(VR・AR から戻ると、同じ入力が新しい流れで始め直す)
  const use = {
    plan: cameraSwitchPlan({ headset, led: params.get('led') === '1', autostart: params.get('autostart') === '1', source: params.get('source') ?? '', perf: params.get('perf') === '1' }),
    consent: false, // 使う人がカメラを選んだか(入口の押し・知らせの「カメラを つかう」)
    ui: null,
    mockNoticeShown: false,
    facing: 'user', // 'user' = まえのカメラ / 'environment' = うしろのカメラ
    /** 下の注意書きの文(うしろのカメラは顔の向きを調べない) */
    get privacy() {
      return use.facing === 'environment' ? CAMERA_PRIVACY_BACK : CAMERA_PRIVACY;
    },
    /** 絵を送るカメラが入っているか(使う人が選んだ・顔の追従のカメラが動いている) */
    seeing: () => use.consent && app.mode === 'camera' && app.source?.kind === 'mediapipe',
    /** 入・切の見た目を今に合わせる(updatePrivacy から呼ばれる)。カメラが入っていれば、勝手に止まった時の見張りも付ける */
    sync: () => {
      const on = app.mode === 'camera' && app.source?.kind === 'mediapipe';
      use.ui?.set(on);
      if (on) watchCameraEnd(app.source);
    },
    on: cameraOn,
    off: cameraOff,
    setup,
  };

  /** カメラが勝手に止まったら、切った形にそろえて知らせる(絵も送らない) */
  function watchCameraEnd(source) {
    const track = source?.tracker?.stream?.getVideoTracks?.()[0];
    if (!track || watchedTracks.has(track)) return;
    watchedTracks.add(track);
    track.addEventListener('ended', () => {
      if (app.source !== source || !use.ui) return;
      void cameraOff()
        .then(() => ui.notice(CAMERA_ENDED))
        .catch((err) => console.warn('止まったカメラを片づけられませんでした:', err.message));
    });
  }

  /**
   * カメラを入れる。先に新しい入力を動かし、動いてから前の入力を止める(失敗したら今の入力のまま投げる)。
   * facing: 'user' = まえのカメラ(ふだん。顔の向きも見る)/ 'environment' = うしろのカメラ(スマホで前の景色や看板を見せる)
   */
  async function cameraOn(facing = 'user') {
    if (inXr()) throw new Error('xr');
    const { MediapipeSource } = await loadFace();
    const next = new MediapipeSource(sourceOptions());
    if (facing === 'environment') {
      // 顔の追従(FaceTracker)の向きの口を使う。絵は同じ流れから取る。VR・AR から戻って始め直す時も、うしろのまま
      next.start = () => next.tracker.start({ facingMode: 'environment' });
      next.getPeople = () => []; // うしろのカメラでは顔の向きを追わない(左右が鏡でないので、写った人の逆を見てしまう。顔の部品も回さない)
    }
    try {
      await next.start();
    } catch (err) {
      next.stop(); // 途中まで読んだ顔の部品を捨てる(許可しない・カメラが無い時)
      throw err;
    }
    use.facing = facing;
    const prev = app.source;
    app.source = next;
    app.mode = 'camera';
    use.consent = true;
    use.mockNoticeShown = false;
    try {
      await prev?.stop?.();
    } catch (err) {
      console.warn('前の入力を止められませんでした:', err.message);
    }
    updatePrivacy();
  }

  /** カメラを切る(カメラの流れを止める)。顔の向きは、カメラなしの入力(マウス・指でなぞる)へ */
  async function cameraOff() {
    const prev = app.source;
    const next = new SimSource({ element: $('stage'), ...sourceOptions() });
    await next.start();
    app.source = next;
    app.mode = 'sim';
    use.consent = false;
    try {
      await prev?.stop?.(); // MediapipeSource.stop → カメラの流れの全部の track を止める
    } catch (err) {
      console.warn('カメラを止められませんでした:', err.message);
    }
    updatePrivacy();
  }

  /** 入力の列のボタンと、テレビ表示の隅のボタンを付ける(出さない入口では隠したまま)。main.js の起動の終わりに 1 回 */
  function setup() {
    const button = $('camBtn');
    const ask = $('camAsk');
    if (!button || !ask || !use.plan.show) return;
    use.ui = mountCameraSwitch({
      button,
      tvButton: $('tvCam'),
      ask,
      turnOn: cameraOn,
      turnOff: cameraOff,
      isMock,
      backCamera: touch, // 指で触る端末(スマホ・タブレット)だけ「うしろの カメラを つかう」
      env: () => ({ secure: window.isSecureContext, mediaDevices: navigator.mediaDevices ?? null }),
    });
    button.hidden = false;
    const tv = $('tvCam');
    if (tv) tv.hidden = false;
    use.sync();
  }

  // 入口の「カメラを使って始める」を、人が押した時だけ「選んだ」にする(?autostart=1 の click() は人の押しではない = 絵は送らない)
  $('startCam')?.addEventListener('click', (e) => {
    if (e.isTrusted && use.plan.show) use.consent = true;
  });
  $('startSim')?.addEventListener('click', () => {
    use.consent = false;
  });
  // 話しかけた回(声・文字。近づいた合図は除く)だけ、絵を 1 枚。顔の追従と同じ <video> から取る
  dialogue.getImage = ({ trigger } = {}) => (trigger !== 'approach' && use.seeing() ? takeFrame(app.source.video) : null);
  // サーバーの知らせ(cameraNotice)。仮の頭脳の知らせは、入れている間に 1 回だけ
  const before = dialogue.onEvent;
  dialogue.onEvent = (ev) => {
    before?.(ev);
    if (ev?.type !== 'meta' || !ev.cameraNotice) return;
    if (ev.camera === 'mock' && use.mockNoticeShown) return;
    if (ev.camera === 'mock') use.mockNoticeShown = true;
    ui.notice(ev.cameraNotice);
  };
  return use;
}
