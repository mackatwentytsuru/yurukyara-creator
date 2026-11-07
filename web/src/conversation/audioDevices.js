// マイクとスピーカーの選び(第 12 波 b・BUX。本人の案「特に PC だと、オーディオインターフェースが選ばれていなくて使えないこともある」)。
// - 選んだ物は、このブラウザだけで覚える(localStorage の yc.audio.v1。端末の id と名前。音は入れない)。
// - ブラウザの聞き取り(Web Speech)は、OS かブラウザの既定のマイクしか使えない。既定でないマイクを選んだ時は、
//   そのマイクの音を PC の聞き取り(このページを配っているサーバーの /api/stt。?stt=server と同じ道)へ送る。
//   PC の聞き取りが無い所(公開の版など)では、既定のマイクで聞き、そうと知らせる。
// - 押してから何秒か音がまったく来ない時は「こえが とどいていないみたい」と知らせる(画面は ui/audioPanel.js)。
// DOM も three も読まない小さな部品(node の試験で読む)。
export const AUDIO_KEY = 'yc.audio.v1';
export const SILENCE_MS = 7000; // 押してからこの間、音がまったく来なければ知らせる
export const SILENCE_RMS = 0.0025; // これより大きい音が 1 回でも来たら「届いている」(部屋の小さな音でも越える。消音・違うマイクではほぼ 0)
export const SILENT_EVENT = 'yc-mic-silent'; // 画面へ知らせる出来事の名前(window に出す)
export const NOTE_EVENT = 'yc-audio-note'; // 聞き取りの道を替えた時などの一言

export const AUDIO_WORDS = Object.freeze({
  silent: 'こえが とどいていないみたい。マイクを えらびなおしてね',
  pick: 'マイクを えらぶ',
  noServer: 'えらんだ マイクは、PC の ききとりが ないと つかえないよ。いまは いつもの マイクで きくね',
  gone: 'えらんだ マイクが みつからないので、いつもの マイクで きくね',
});

let serverStt = () => false;
/** PC の聞き取り(/api/stt)が使えるかを返す関数を入れる(main.js の app.status を読む) */
export function setServerSttCheck(fn) {
  serverStt = typeof fn === 'function' ? fn : () => false;
}
export function serverSttAvailable() {
  try {
    return Boolean(serverStt());
  } catch {
    return false;
  }
}

function storageOf(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// def: 選んだ時に既定のマイクだったか(許可の前で一覧に id と名前が無い時に使う)
const cleanDevice = (d) => (d && typeof d.id === 'string' && d.id.length <= 300
  ? { id: d.id, label: String(d.label ?? '').slice(0, 120), groupId: String(d.groupId ?? '').slice(0, 300), ...(typeof d.def === 'boolean' ? { def: d.def } : {}) }
  : null);

/** 覚えている選び。{mic, speaker}(無ければ null)。読めない・形が違う時は何も選んでいない */
export function loadChoice(storage) {
  const s = storageOf(storage);
  try {
    const v = JSON.parse(s?.getItem(AUDIO_KEY) ?? 'null');
    return { mic: cleanDevice(v?.mic), speaker: cleanDevice(v?.speaker) };
  } catch {
    return { mic: null, speaker: null };
  }
}

/** 選びを覚える(覚えられない端末では、開いている間だけ) */
export function saveChoice(choice, storage) {
  const s = storageOf(storage);
  const v = { mic: cleanDevice(choice?.mic), speaker: cleanDevice(choice?.speaker) };
  try {
    s?.setItem(AUDIO_KEY, JSON.stringify(v));
  } catch {
    // 覚えられない端末でも、選んだ物はこの画面の間は使う
  }
  return v;
}

/** enumerateDevices の結果を、種類ごとの {id, label, groupId} の列に */
export function splitDevices(list = []) {
  const pick = (kind) => list.filter((d) => d && d.kind === kind && typeof d.deviceId === 'string').map((d) => ({ id: d.deviceId, label: String(d.label ?? ''), groupId: String(d.groupId ?? '') }));
  return { mics: pick('audioinput'), speakers: pick('audiooutput') };
}

/** 覚えた物を、今の一覧の中で探す(id が変わっていたら名前で)。見つからなければ null */
export function resolveDevice(devices, chosen) {
  if (!chosen) return null;
  return devices.find((d) => d.id === chosen.id) ?? (chosen.label ? devices.find((d) => d.label === chosen.label) : null) ?? null;
}

/**
 * 選んだマイクが、ブラウザの既定のマイクか。
 * Chrome は一覧に id 'default'(既定)と、同じ groupId の本物を出す。'default' が無いブラウザは、一覧の最初が既定。
 */
export function isDefaultMic(mics, chosen) {
  if (!chosen || !chosen.id || chosen.id === 'default') return true;
  if (!mics.some((d) => d.id)) return chosen.def !== false; // 許可の前(一覧に id が無い): 選んだ時の印で決める
  const def = mics.find((d) => d.id === 'default');
  if (def) return Boolean(chosen.groupId) && chosen.groupId === def.groupId && !/^communications$/.test(chosen.id);
  return mics.length === 0 || mics[0].id === chosen.id;
}

/** getUserMedia の音の決まりに、選んだマイクを足す(既定なら足さない) */
export function micConstraints(base, chosen, isDefault) {
  return chosen && !isDefault ? { ...base, deviceId: { exact: chosen.id } } : { ...base };
}

/**
 * 聞き取りの道。ブラウザの聞き取りのはずでも、既定でないマイクを選び、PC の聞き取りがあれば PC へ。
 * @returns {{provider:'web'|'server', useChosen:boolean, note:string}}
 */
export function decideListening(baseProvider, { chosen, isDefault, serverOk }) {
  if (!chosen || isDefault) return { provider: baseProvider, useChosen: false, note: '' };
  if (baseProvider === 'server') return { provider: 'server', useChosen: true, note: '' };
  if (serverOk) return { provider: 'server', useChosen: true, note: '' };
  return { provider: baseProvider, useChosen: false, note: AUDIO_WORDS.noServer };
}

/**
 * 押してからの音を見張る。feed(rms, 今の ms, キャラが話している間か) が 'silent' を返すのは、1 回だけ。
 * キャラが話している間(聞き取りを止めている間)の時間は数えない(話し終えた直後に、まちがえて知らせないように)
 */
export function createSilenceWatch({ ms = SILENCE_MS, rms = SILENCE_RMS, startedAt = 0 } = {}) {
  let heard = false;
  let told = false;
  let last = startedAt;
  let listened = 0;
  return {
    feed(level, now, busy = false) {
      if (!busy) listened += Math.max(0, now - last);
      last = now;
      if (!busy && level > rms) heard = true;
      if (heard || told || listened < ms) return 'ok';
      told = true;
      return 'silent';
    },
    get heard() {
      return heard;
    },
  };
}

/** 音を出す先を選べるか(Web Audio の setSinkId。Chrome・Edge は 110 から。Safari・Firefox には無い) */
export function canPickSpeaker(AC = globalThis.AudioContext) {
  return Boolean(AC && AC.prototype && typeof AC.prototype.setSinkId === 'function');
}

/** 画面へ出来事を知らせる(window が無い所では何もしない) */
export function tell(name, detail) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(name, { detail }));
  } catch {
    // 知らせられなくても、聞き取りは止めない
  }
}
