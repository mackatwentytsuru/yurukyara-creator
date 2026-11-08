// iPhone の「音の使い方」(WebKit の Audio Session API。navigator.audioSession)の切りかえ。
// 11-08 本人の iPhone: 声の再生のために type を 'playback' にしたまま getUserMedia({audio}) を呼ぶと、
// 「InvalidStateError: AudioSession category is not compatible with audio capture」で、マイクが開けなかった(この種類はタブが閉じるまで残る)。
// 決まり:
//   - マイクを開く前に 'play-and-record' にする。聞いている間はそのまま(録音と再生を両方使う種類。スピーカーからも声は出る)
//   - マイクを閉じたら 'playback' に戻す(消音スイッチが入っていても声が出る、これまでの形)
//   - 聞いている間は、声を出す側(speaker.js)が 'playback' へ戻さない(マイクの音が途切れるため)
// 声の出口について(B13V 11-08。公式の資料で確かめた範囲):
//   - W3C Audio Session API(w3c.github.io/audio-session)は、'play-and-record' を「録音・マイク・ビデオ会議用」と定めるだけで、スピーカーかレシーバー(耳に当てる小さな口)かは決めていない。
//   - MDN は「端末が音量の割り当てを調整するかもしれない(モバイルでスピーカーでなくイヤピースを使うなど)」とだけ書く。ページから出口を選ぶ道は無い。
//   - WebKit の実装(Source/WebCore/platform/audio/ios/AudioSessionIOS.mm)は、PlayAndRecord で AVAudioSession に DefaultToSpeaker を付ける
//     (「レシーバーを優先」の状態のときだけ付けない)。なので ふつうは、聞いている間もスピーカーから出る。付く付かないは iOS の版と接続先(イヤホン・Bluetooth)で変わる。
//   - 実機の報告(WebKit Bugzilla 282939)では、getUserMedia のあとで出口が変わる・マイクを閉じても 'play-and-record' が残って音が悪くなることがある。
//   ここでできること = ①取る前に 'play-and-record' ②取った後にもう一度そろえる ③中断から戻った時・ページが前に戻った時にそろえ直す ④閉じたら 'playback' に戻す。それ以上は Web からは決められない。
// navigator.audioSession が無い端末(PC・Android・古い iOS)では、何もしない。
// DOM も three も読まない小さな部品(node の試験で、偽の audioSession を使って切りかえの順番を確かめる)。

export const RECORD_TYPE = 'play-and-record';
export const PLAYBACK_TYPE = 'playback';
export const AUTO_TYPE = 'auto';

let recording = 0; // マイクを開いている数(0 なら再生用)

function session(nav) {
  const s = (nav ?? globalThis.navigator)?.audioSession;
  return s && typeof s === 'object' ? s : null;
}

function setType(type, nav) {
  const s = session(nav);
  if (!s) return false;
  try {
    if (s.type !== type) s.type = type;
    return true;
  } catch {
    return false; // 許されない・対応していない端末は、そのまま
  }
}

let watched = null; // 'statechange' を見ている audioSession(1 つにつき 1 回だけ付ける)

/**
 * 電話・Siri・別のタブの音で「中断」されて戻った時、種類が変わっていたら 'play-and-record' に戻す。
 * マイクを開いている間だけ(数えが 0 なら何もしない)。声がスピーカーから出る形(下の注)を、聞き続ける間たもつため。
 */
function watchSession(nav) {
  const s = session(nav);
  if (!s || watched === s || typeof s.addEventListener !== 'function') return;
  watched = s;
  try {
    s.addEventListener('statechange', () => {
      if (recording > 0 && s.state === 'active' && s.type === PLAYBACK_TYPE) setType(RECORD_TYPE, nav);
    });
  } catch {
    // 付けられない端末は、そのまま
  }
}

/** マイクを開く直前に呼ぶ(開けなくても、閉じる側で endRecording を呼ぶ)。type を変えられたら true */
export function beginRecording(nav) {
  recording += 1;
  watchSession(nav);
  return setType(RECORD_TYPE, nav);
}

/**
 * 聞いている間に、ページが前に戻った時などに呼ぶ。マイクを開いていて、種類が 'play-and-record' でなければ戻す
 * ('auto' は端末に任せた状態なので、そのまま。開いていない時は何もしない)。
 */
export function reassertRecording(nav) {
  if (recording <= 0) return false;
  const s = session(nav);
  if (!s || s.type === AUTO_TYPE) return false;
  return setType(RECORD_TYPE, nav);
}

/** マイクを閉じた時に呼ぶ。最後のマイクが閉じたら、声を出す側の 'playback' に戻す */
export function endRecording(nav) {
  recording = Math.max(0, recording - 1);
  if (recording > 0) return false;
  return setType(PLAYBACK_TYPE, nav);
}

/** マイクを開き直す直前(取り直し)に、種類をもう一度そろえる(数えは増やさない) */
export function ensureRecordType(nav) {
  return setType(RECORD_TYPE, nav);
}

/**
 * マイクの音を取る(getUserMedia)。種類をそろえてから取り、「この音の使い方では取れない」(InvalidStateError)と断られたら、
 * 種類を 'auto'(端末に任せる)にして 1 回だけ取り直す。'play-and-record' で通るかは実機でしか分からない保険(11-08 見直し)。
 * 取り直しても、数えは増やさない(閉じる側の endRecording が 'playback' に戻す)。
 * @param {(constraints: object) => Promise<MediaStream>} getUserMedia
 * @param {object} constraints
 */
export async function getMicWithSession(getUserMedia, constraints, nav) {
  ensureRecordType(nav);
  try {
    return await getUserMedia(constraints);
  } catch (err) {
    if (err?.name !== 'InvalidStateError' || !session(nav)) throw err;
    setType(AUTO_TYPE, nav);
    return getUserMedia(constraints);
  }
}

/**
 * 1 回の「開く → 閉じる」を数えちがえずに持つ小さな入れ物(歯車の窓のメーターなど、何度も開き直す所用)。
 * begin() を何度呼んでも数えは 1 つ・end() は持っている時だけ 1 つ返す。
 */
export function createRecordingHold(nav) {
  let held = false;
  return {
    begin() {
      if (held) return;
      held = true;
      beginRecording(nav);
    },
    end() {
      if (!held) return;
      held = false;
      endRecording(nav);
    },
    get held() {
      return held;
    },
  };
}

/** 声を出す側(speaker.js)が、タップのたびに呼ぶ。聞いている間は、マイクの種類を壊さないよう何もしない */
export function usePlayback(nav) {
  if (recording > 0) return false;
  return setType(PLAYBACK_TYPE, nav);
}

/** 試験用: 数えを戻す */
export function resetAudioSessionState() {
  recording = 0;
}

export function isRecordingSession() {
  return recording > 0;
}
