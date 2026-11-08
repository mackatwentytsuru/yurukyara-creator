// カメラの入・切(BCV。11-08 本人「カメラを有効にするか無効にするかはユーザーが決められればいい。…こちらが決めず、ユーザーが責任を持って決める」)。
// - どの端末でも、いつでも入れたり切ったりできる(入口だけでなく。入力の列のボタンと、テレビ表示の隅のボタン)
// - 切っているのが基本。入口で「カメラを使って始める」を選んだ時と、ここで知らせを読んで「カメラを つかう」を押した時だけ入る
// - 入れる前に 1 行の知らせ(カメラの絵は、答えを作るために Claude に送られる・保存しない・使うかは自分で決める)
// - 入っている間は小さな印(main.js が上の札の先頭に赤い点の札を出す・ここはボタンの赤い点)。切ると、カメラの流れを止める(main.js)
// ここは決まりと画面の部品だけ。カメラを動かす(顔の追従を始める・止める)のは main.js が渡す関数。文字は textContent だけで入れる。

/** 入れる時の 1 行(本人の決め。言い換えない) */
export const CAMERA_NOTICE = 'カメラの えは、こたえを つくるために Claude に おくられます(ほぞんしません)。つかうかは あなたが きめてね';
/** 仮の頭脳の時の 1 行(UW3 11-08: 仮の頭脳では絵をどこにも送らない。Claude に送ると言わない) */
export const CAMERA_NOTICE_MOCK = 'カメラの えは、どこにも おくられません(ほぞんしません)。つかうかは あなたが きめてね';
/** 仮の頭脳の時に足す 1 行(絵は見ない。顔の向きを見るのには使う) */
export const CAMERA_MOCK_NOTE = 'いまは おためしモードなので、カメラの えは まだ みられません。かおの むきを みるのには つかいます';
export const CAMERA_LABEL_OFF = 'カメラ';
export const CAMERA_LABEL_ON = 'カメラ オン';
export const CAMERA_YES = 'カメラを つかう';
export const CAMERA_NO = 'やめる';
export const CAMERA_STARTING = 'カメラを じゅんびしています…';
export const CAMERA_TITLE_OFF = 'カメラを つかう(いまは きっています)';
export const CAMERA_TITLE_ON = 'カメラを きる(いまは つかっています)';
/** 下の注意書き(絵を送るカメラが入っている間) */
export const CAMERA_PRIVACY = 'カメラの映像で、この端末の中で人の位置を調べます。話しかけた時だけ、その時の絵を 1 枚、答えを作るために Claude に送ります(保存しません)。';
/** 下の注意書き(仮の頭脳の時。絵はどこにも送らない) */
export const CAMERA_PRIVACY_MOCK = 'カメラの映像で、この端末の中で人の位置を調べます。いまは おためしモードなので、絵はどこにも送りません(保存しません)。';
/** 下の注意書き(仮の頭脳の時のうしろのカメラ) */
export const CAMERA_PRIVACY_BACK_MOCK = 'うしろのカメラを使っています。いまは おためしモードなので、絵はどこにも送りません(保存しません)。';
/** 下の注意書き(うしろのカメラ。顔の向きは調べない) */
export const CAMERA_PRIVACY_BACK = 'うしろのカメラを使っています。話しかけた時だけ、その時の絵を 1 枚、答えを作るために Claude に送ります(保存しません)。';

/**
 * カメラの切り替えを出すか。この端末のカメラを、使う人が選んで使う入口の時だけ出す。
 * - ヘッドセット(Quest のブラウザ): VR は今のまま(ページにカメラの絵が来るかは未確認。docs は BCV の札)
 * - 入口の LED・自動で始める画面: 押す人がいないので出さない(顔の追従だけ。絵は送らない)
 * - 位置を外から受ける入口(?source=pose・bridge)・重さを測る時(?perf=1): この端末のカメラを使わない
 * @returns {{show: boolean, why: string}}
 */
export function cameraSwitchPlan({ headset = false, led = false, autostart = false, source = '', perf = false } = {}) {
  if (headset) return { show: false, why: 'headset' };
  if (led || autostart) return { show: false, why: 'kiosk' };
  if (source === 'pose' || source === 'bridge') return { show: false, why: 'external' };
  if (perf) return { show: false, why: 'perf' };
  return { show: true, why: '' };
}

/**
 * カメラを入れられなかった時の、やさしい日本語(英語の err.message は出さない)。
 * @param {unknown} err
 * @param {{secure?: boolean, mediaDevices?: object|null}} [env]
 */
export function cameraFailureText(err, { secure = true, mediaDevices = {} } = {}) {
  if (!secure) return 'カメラを つかうには、https の ページで ひらいてね。もじの おはなしは このまま できます'; // 声も https が要るので、文字だけを言う
  if (!mediaDevices?.getUserMedia) return 'この ブラウザでは カメラを つかえません。もじの おはなしは このまま できます';
  const name = String(err?.name ?? '');
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'カメラを つかえませんでした。ブラウザで カメラを「ゆるす」に してから、もう いちど おしてね';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'カメラが みつかりませんでした';
  if (name === 'NotReadableError' || name === 'AbortError') return 'ほかの アプリが カメラを つかっているみたい。とじてから、もう いちど おしてね';
  return 'カメラを つかえませんでした。もじの おはなしは このまま できます';
}

/**
 * 入力の列のボタン・テレビ表示の隅のボタン・知らせの窓を付ける。
 * @param {object} o
 * @param {HTMLButtonElement} o.button 入力の列のボタン(#camBtn)
 * @param {HTMLButtonElement|null} [o.tvButton] テレビ表示の隅のボタン(#tvCam)
 * @param {HTMLElement} o.ask 知らせの窓(#camAsk。中に #camAskText・#camAskMock・#camAskYes・#camAskNo・#camAskStatus・あれば #camAskBack)
 * @param {(facing: 'user'|'environment') => Promise<void>} o.turnOn カメラを入れる(まえ = user・うしろ = environment。失敗したら投げる。今の入力はそのまま)
 * @param {() => Promise<void>} o.turnOff カメラを切る(カメラの流れを止める)
 * @param {() => boolean} [o.isMock] いま仮の頭脳か(知らせに 1 行足す)
 * @param {boolean} [o.backCamera] 「うしろの カメラを つかう」を出すか(指で触る端末だけ。道案内で前の景色や看板を見せる)
 * @param {() => {secure: boolean, mediaDevices: object|null}} [o.env]
 * @returns {{set(on: boolean): void, readonly on: boolean, open(): void, close(focusButton?: boolean): void, readonly isOpen: boolean}}
 */
export function mountCameraSwitch({ button, tvButton = null, ask, turnOn, turnOff, isMock = () => false, backCamera = false, env = () => ({ secure: true, mediaDevices: {} }) }) {
  const q = (sel) => ask.querySelector(sel);
  const text = q('#camAskText');
  const mock = q('#camAskMock');
  const yes = q('#camAskYes');
  const no = q('#camAskNo');
  const back = backCamera ? q('#camAskBack') : null;
  const status = q('#camAskStatus');
  if (back) back.hidden = false;
  let on = false;
  let busy = false;
  let opener = button;
  text.textContent = CAMERA_NOTICE;
  yes.textContent = CAMERA_YES;
  no.textContent = CAMERA_NO;

  const paint = () => {
    for (const b of [button, tvButton]) {
      if (!b) continue;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
      b.title = on ? CAMERA_TITLE_ON : CAMERA_TITLE_OFF;
      b.setAttribute('aria-label', on ? CAMERA_TITLE_ON : CAMERA_TITLE_OFF);
      b.disabled = busy;
    }
    const label = button.querySelector('.cam-label');
    if (label) label.textContent = on ? CAMERA_LABEL_ON : CAMERA_LABEL_OFF;
    document.documentElement.classList.toggle('cam-on', on);
  };

  const close = (focusButton = false) => {
    if (ask.hidden) return;
    ask.hidden = true;
    for (const b of [button, tvButton]) b?.setAttribute('aria-expanded', 'false');
    if (focusButton) opener?.focus({ preventScroll: true });
  };

  const open = (from = button) => {
    opener = from;
    status.textContent = '';
    text.textContent = isMock() ? CAMERA_NOTICE_MOCK : CAMERA_NOTICE; // 開くたびに、今の頭脳に合わせる(仮の頭脳で「Claude に送る」と言わない)
    mock.hidden = !isMock();
    mock.textContent = CAMERA_MOCK_NOTE;
    for (const b of [yes, no, back]) if (b) b.disabled = false;
    ask.hidden = false;
    from?.setAttribute('aria-expanded', 'true');
    yes.focus({ preventScroll: true });
  };

  const press = async (from) => {
    if (busy) return;
    if (!on) {
      if (ask.hidden) open(from);
      else close(true);
      return;
    }
    busy = true;
    paint();
    try {
      await turnOff();
      on = false;
    } finally {
      busy = false;
      paint();
    }
  };

  const start = async (facing) => {
    if (busy) return;
    busy = true;
    for (const b of [yes, no, back]) if (b) b.disabled = true;
    status.textContent = CAMERA_STARTING;
    paint();
    try {
      await turnOn(facing);
      on = true;
      busy = false;
      paint();
      close(true);
    } catch (err) {
      busy = false;
      status.textContent = cameraFailureText(err, env());
      for (const b of [yes, no, back]) if (b) b.disabled = false;
      paint();
    }
  };
  yes.addEventListener('click', () => start('user'));
  back?.addEventListener('click', () => start('environment'));
  no.addEventListener('click', () => close(true));
  ask.addEventListener('click', (e) => {
    if (e.target === ask && !busy) close(true); // 窓の外(暗い所)を押すと閉じる
  });
  ask.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !busy) {
      e.preventDefault();
      e.stopPropagation(); // テレビ表示の Escape(もどる)と重ねない
      close(true);
    }
  });
  button.addEventListener('click', () => void press(button));
  tvButton?.addEventListener('click', () => void press(tvButton));
  for (const b of [button, tvButton]) {
    b?.setAttribute('aria-haspopup', 'dialog');
    b?.setAttribute('aria-controls', ask.id);
    b?.setAttribute('aria-expanded', 'false');
  }
  paint();

  return {
    /** 外で入・切が決まった時(入口で選んだ・VR から戻った・失敗して切れた)に、見た目だけ合わせる */
    set(next) {
      if (busy || next === on) return;
      on = Boolean(next);
      paint();
    },
    get on() {
      return on;
    },
    open,
    close,
    get isOpen() {
      return !ask.hidden;
    },
  };
}
