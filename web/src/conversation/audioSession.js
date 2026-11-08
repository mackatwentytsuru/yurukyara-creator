// iPhone の「音の使い方」(WebKit の Audio Session API。navigator.audioSession)の切りかえ。
// 11-08 本人の iPhone: 声の再生のために type を 'playback' にしたまま getUserMedia({audio}) を呼ぶと、
// 「InvalidStateError: AudioSession category is not compatible with audio capture」で、マイクが開けなかった(この種類はタブが閉じるまで残る)。
// 決まり:
//   - マイクを開く前に 'play-and-record' にする。聞いている間はそのまま(録音と再生を両方使う種類。スピーカーからも声は出る)
//   - マイクを閉じたら 'playback' に戻す(消音スイッチが入っていても声が出る、これまでの形)
//   - 聞いている間は、声を出す側(speaker.js)が 'playback' へ戻さない(マイクの音が途切れるため)
// navigator.audioSession が無い端末(PC・Android・古い iOS)では、何もしない。
// DOM も three も読まない小さな部品(node の試験で、偽の audioSession を使って切りかえの順番を確かめる)。

export const RECORD_TYPE = 'play-and-record';
export const PLAYBACK_TYPE = 'playback';

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

/** マイクを開く直前に呼ぶ(開けなくても、閉じる側で endRecording を呼ぶ)。type を変えられたら true */
export function beginRecording(nav) {
  recording += 1;
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
