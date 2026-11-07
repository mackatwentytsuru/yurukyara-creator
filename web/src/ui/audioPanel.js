// 「マイクと スピーカー」の窓(第 12 波 b・BUX。本人の案「特に PC だと、オーディオインターフェースが選ばれていなくて使えないこともある」)。
// - 入口は「声で話す」の横の歯車。許可の後に使えるマイクとスピーカーの一覧(enumerateDevices)・選ぶ・声の大きさのメーター・
//   「はなしてみてね」(聞こえた言葉を出す)・スピーカーの試しの音(Web Audio の setSinkId。無いブラウザでは、やさしい一言)。
// - 選んだ物は、このブラウザだけで覚える(conversation/audioDevices.js)。既定でないマイクは、PC の聞き取りへ自動で切り替わる。
// - 押してから何秒か音が来ない時(listener.js が知らせる)は「こえが とどいていないみたい」と、この窓への道を出す。文字で話す道はいつも残す。
// - 音は、この窓の中で大きさを測るだけ(保存しない)。「はなしてみてね」の文字は、ふだんの聞き取りと同じ道で作る。
import { Listener, webSpeechSupported } from '../conversation/listener.js';
import { AUDIO_WORDS, NOTE_EVENT, SILENT_EVENT, canPickSpeaker, decideListening, isDefaultMic, loadChoice, resolveDevice, saveChoice, serverSttAvailable, setServerSttCheck, splitDevices } from '../conversation/audioDevices.js';
import { micFailureText, micUnavailableText } from '../stage/micNotice.js';
import { createNote, createSheet, el } from './sheet.js';

const TEST_MS = 12000; // 「はなしてみてね」は 12 秒で自分で止まる
export const PICKER_WORDS = Object.freeze({
  button: 'マイクと スピーカー',
  lead: 'こえで はなす ときの マイクと、キャラの こえが でる スピーカーを えらべるよ。',
  allow: 'マイクを つかって いい?(リストを みる)',
  mic: 'マイク',
  speaker: 'スピーカー',
  meter: 'こえの おおきさ',
  test: 'はなしてみてね',
  testStop: 'とめる',
  testing: 'どうぞ、なにか はなしてみてね…',
  heard: 'きこえた ことば',
  noWords: 'こえは きこえたけど、ことばに ならなかったよ。もういちど はなしてみてね',
  chime: 'おとを ならす',
  noSpeakerPick: 'この ブラウザでは、スピーカーを えらべないよ。PC の おとの せっていで えらんでね(ためしの おとは いつもの スピーカーから でるよ)',
  routeWeb: 'この マイクの こえは、ブラウザの ききとりで もじに するよ。',
  routeServer: 'この マイクの こえは、この PC で もじに するよ(おとは のこさないよ)。',
  remember: 'えらんだ ものは、この ブラウザが おぼえるよ。もじで はなすのは いつでも できるよ。',
  update: 'アプリの アップデート',
  unnamedMic: 'マイク',
  unnamedSpeaker: 'スピーカー',
  defaultMark: '(いつもの)',
});

const GEAR = 'M8.6 1h2.8l.5 2.2a6.8 6.8 0 0 1 1.6.7l1.9-1.2 2 2-1.2 1.9c.3.5.5 1 .7 1.6l2.1.5v2.8l-2.1.5a6.8 6.8 0 0 1-.7 1.6l1.2 1.9-2 2-1.9-1.2c-.5.3-1 .5-1.6.7L11.4 19H8.6l-.5-2.2a6.8 6.8 0 0 1-1.6-.7l-1.9 1.2-2-2 1.2-1.9a6.8 6.8 0 0 1-.7-1.6L1 11.3V8.6l2.1-.5c.2-.6.4-1.1.7-1.6L2.6 4.6l2-2 1.9 1.2c.5-.3 1-.5 1.6-.7ZM10 6.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z';

/** 歯車の印。「声で話す」の SVG を写して形だけ替える(SVG の名前空間の住所を、画面のコードに書かないため) */
function gearIcon(micBtn) {
  const svg = micBtn.querySelector('svg')?.cloneNode(false);
  const path = micBtn.querySelector('svg path')?.cloneNode(false);
  if (!svg || !path) return document.createTextNode('⚙');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('d', GEAR);
  svg.append(path);
  return svg;
}

/** main.js の listenProvider と同じ決まり(ヘッドセットと ?stt=server はサーバー、ほかはブラウザ、無ければサーバー) */
export function baseProvider({ ua = navigator.userAgent, search = location.search, webOk = webSpeechSupported(), serverOk = serverSttAvailable() } = {}) {
  const p = new URLSearchParams(search);
  if (p.get('headset') === '1' || /OculusBrowser|Quest/i.test(ua) || p.get('stt') === 'server') return serverOk ? 'server' : null;
  if (webOk) return 'web';
  return serverOk ? 'server' : null;
}

/** 試しの音: 2 つの音(ド・ミ)をやわらかく。選んだスピーカーへ(選べないブラウザでは既定へ) */
async function playChime(sinkId) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  const ctx = new AC();
  let routed = false;
  if (sinkId && typeof ctx.setSinkId === 'function') {
    try {
      await ctx.setSinkId(sinkId === 'default' ? '' : sinkId);
      routed = true;
    } catch {
      routed = false;
    }
  }
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  const t0 = ctx.currentTime + 0.05;
  [[1046.5, 0], [1318.5, 0.2]].forEach(([hz, at]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0, t0 + at);
    gain.gain.linearRampToValueAtTime(0.18, t0 + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.5);
  });
  setTimeout(() => ctx.close().catch(() => {}), 1200);
  return routed;
}

/**
 * @param {object} o
 * @param {object} o.app main.js の app(speaker・listener・status を読む)
 * @param {{open:(from?:HTMLElement)=>void, report:()=>object|null}|null} [o.update] 画面のアップデート(手元の版だけ)
 */
export function mountAudioPicker({ app, update = null } = {}) {
  const micBtn = document.getElementById('micBtn');
  if (!micBtn || micBtn.dataset.ycAudio) return null;
  micBtn.dataset.ycAudio = '1';
  setServerSttCheck(() => Boolean(app?.status?.stt?.available));
  let choice = loadChoice();
  if (choice.speaker) app?.speaker?.setOutput?.(choice.speaker.id); // 声を出す所ができた時に、選んだスピーカーへ

  const gear = el('button', { type: 'button', id: 'ycAudioBtn', class: 'yc-audio-btn', 'aria-label': PICKER_WORDS.button, title: PICKER_WORDS.button, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'ycAudio' }, gearIcon(micBtn));
  micBtn.after(gear);
  const note = createNote('ycAudioNote');
  const sheet = createSheet({ id: 'ycAudio', title: PICKER_WORDS.button, onClose: () => closeAll() });

  const unavailable = el('p', { class: 'yc-au-msg', role: 'status', hidden: true });
  const allowBtn = el('button', { type: 'button', class: 'yc-btn', id: 'ycAudioAllow', text: PICKER_WORDS.allow, hidden: true });
  const micSelect = el('select', { id: 'ycMicSelect', class: 'yc-select' });
  const meterBar = el('span', { class: 'yc-meter-bar' });
  const meter = el('div', { class: 'yc-meter', role: 'meter', 'aria-label': PICKER_WORDS.meter, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, meterBar);
  const route = el('p', { class: 'yc-au-route' });
  const testBtn = el('button', { type: 'button', class: 'yc-btn yc-btn-main', id: 'ycMicTest', text: PICKER_WORDS.test });
  const heard = el('p', { class: 'yc-au-heard', id: 'ycMicHeard', 'aria-live': 'polite' });
  const speakerSelect = el('select', { id: 'ycSpeakerSelect', class: 'yc-select' });
  const chimeBtn = el('button', { type: 'button', class: 'yc-btn', id: 'ycSpeakerTest', text: PICKER_WORDS.chime });
  const speakerNote = el('p', { class: 'yc-au-msg', hidden: true, text: PICKER_WORDS.noSpeakerPick });
  const updateBtn = el('button', { type: 'button', class: 'yc-link-btn', id: 'ycAudioUpdate', hidden: true });
  const micField = el('label', { class: 'yc-field' }, el('span', { text: PICKER_WORDS.mic }), micSelect);
  const speakerField = el('label', { class: 'yc-field', hidden: true }, el('span', { text: PICKER_WORDS.speaker }), speakerSelect); // 一覧が取れてから出す
  const meterRow = el('div', { class: 'yc-meter-row' }, el('span', { class: 'yc-meter-label', text: PICKER_WORDS.meter }), meter);
  const testRow = el('div', { class: 'yc-au-actions' }, testBtn);
  sheet.body.append(
    el('p', { class: 'yc-au-lead', text: PICKER_WORDS.lead }),
    unavailable,
    allowBtn,
    micField,
    meterRow,
    route,
    testRow,
    heard,
    speakerField,
    speakerNote,
    el('div', { class: 'yc-au-actions' }, chimeBtn),
    el('p', { class: 'yc-au-foot', text: PICKER_WORDS.remember }),
    updateBtn,
  );

  let mics = [];
  let speakers = [];
  let meterStream = null;
  let meterCtx = null;
  let meterRaf = 0;
  let testListener = null;
  let testTimer = null;
  let mainWasOn = false;

  const canPick = canPickSpeaker(window.AudioContext);
  const chosenMic = () => resolveDevice(mics, choice.mic) ?? null;

  function routeText() {
    const mic = chosenMic();
    const base = baseProvider();
    if (!base) return '';
    const plan = decideListening(base, { chosen: mic, isDefault: isDefaultMic(mics, mic), serverOk: serverSttAvailable() });
    if (plan.note) return plan.note;
    return plan.provider === 'server' ? PICKER_WORDS.routeServer : PICKER_WORDS.routeWeb;
  }

  function fillSelect(select, list, chosen, unnamed) {
    select.replaceChildren(...list.map((d, i) => {
      const name = d.label || `${unnamed} ${i + 1}`;
      return el('option', { value: d.id, text: d.id === 'default' ? `${name.replace(/^(既定|Default)\s*-\s*/i, '')}${PICKER_WORDS.defaultMark}` : name });
    }));
    const found = resolveDevice(list, chosen);
    select.value = found ? found.id : (list.find((d) => d.id === 'default')?.id ?? list[0]?.id ?? '');
  }

  async function readDevices() {
    try {
      const all = splitDevices(await navigator.mediaDevices.enumerateDevices());
      mics = all.mics.filter((d) => d.id !== 'communications');
      speakers = all.speakers.filter((d) => d.id !== 'communications');
    } catch {
      mics = [];
      speakers = [];
    }
    const named = mics.some((d) => d.label);
    allowBtn.hidden = named || mics.length === 0 && !navigator.mediaDevices;
    micField.hidden = !named;
    fillSelect(micSelect, mics, choice.mic, PICKER_WORDS.unnamedMic);
    speakerField.hidden = !canPick || speakers.length === 0;
    speakerNote.hidden = canPick && speakers.length > 0;
    if (!speakerField.hidden) fillSelect(speakerSelect, speakers, choice.speaker, PICKER_WORDS.unnamedSpeaker);
    route.textContent = named ? routeText() : '';
    return named;
  }

  /** 音の部品は、押した瞬間(待つ前)に作って動かす(iPhone の Safari は、押した瞬間の外で作ると止まったままで、メーターが動かない) */
  function wakeMeterCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!meterCtx) meterCtx = new AC();
    if (meterCtx.state !== 'running') meterCtx.resume().catch(() => {});
  }

  function stopMeter({ keepCtx = false } = {}) {
    cancelAnimationFrame(meterRaf);
    meterStream?.getTracks().forEach((t) => t.stop());
    meterStream = null;
    if (!keepCtx) {
      meterCtx?.close().catch(() => {});
      meterCtx = null;
    }
    meterBar.style.transform = 'scaleX(0)';
    meter.setAttribute('aria-valuenow', '0');
  }

  async function startMeter() {
    stopMeter({ keepCtx: true });
    const mic = chosenMic();
    try {
      meterStream = await navigator.mediaDevices.getUserMedia({ audio: mic && mic.id !== 'default' ? { deviceId: { exact: mic.id } } : true });
    } catch (err) {
      unavailable.hidden = false;
      unavailable.textContent = micFailureText(err);
      return;
    }
    if (!sheet.isOpen()) return stopMeter(); // 待っている間に閉じた
    wakeMeterCtx();
    if (!meterCtx) return;
    const analyser = meterCtx.createAnalyser();
    analyser.fftSize = 1024;
    meterCtx.createMediaStreamSource(meterStream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const draw = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const level = Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length)) * 2.2); // 小さな声も見えるように、ゆるい曲線で
      meterBar.style.transform = `scaleX(${level.toFixed(3)})`;
      meter.setAttribute('aria-valuenow', String(Math.round(level * 100)));
      meterRaf = requestAnimationFrame(draw);
    };
    draw();
  }

  function stopTest() {
    clearTimeout(testTimer);
    testListener?.stop();
    testListener = null;
    testBtn.textContent = PICKER_WORDS.test;
  }

  function restoreMain() {
    if (mainWasOn && !app?.listener?.listening) micBtn.click(); // 「声で話す」を、選んだマイクで入れ直す
    mainWasOn = false;
  }

  async function startTest() {
    stopTest();
    if (app?.listener?.listening) {
      mainWasOn = true;
      micBtn.click(); // ふだんの聞き取りを止めてから試す(同じマイクを 2 つの聞き取りが取り合わないように)
    }
    const base = baseProvider();
    if (!base) {
      heard.textContent = micUnavailableText({ secure: window.isSecureContext, mediaDevices: navigator.mediaDevices }) ?? AUDIO_WORDS.noServer;
      return;
    }
    heard.textContent = PICKER_WORDS.testing;
    testBtn.textContent = PICKER_WORDS.testStop;
    const show = (t) => (heard.textContent = `${PICKER_WORDS.heard}: ${t}`);
    testListener = new Listener({
      onInterim: (t) => t && t !== '…' && show(t),
      onFinal: (t) => show(t),
      onVoice: () => {},
      onError: () => (heard.textContent = PICKER_WORDS.noWords),
      onEmpty: () => (heard.textContent = PICKER_WORDS.noWords),
    }, { provider: base, isBusy: () => false });
    try {
      await testListener.start();
      testTimer = setTimeout(() => stopTest(), TEST_MS);
    } catch (err) {
      stopTest();
      heard.textContent = micFailureText(err);
    }
  }

  function closeAll() {
    stopTest();
    stopMeter();
    restoreMain();
  }

  async function refreshUpdateLink() {
    const r = update?.report?.() ?? null;
    updateBtn.hidden = !update;
    updateBtn.textContent = r?.ours ? `${PICKER_WORDS.update}(いまの はん ${r.ours})` : PICKER_WORDS.update;
  }

  async function open(from) {
    sheet.show(from ?? gear);
    wakeMeterCtx(); // 押した瞬間に(待つ前に)
    const unav = micUnavailableText({ secure: window.isSecureContext, mediaDevices: navigator.mediaDevices });
    unavailable.hidden = !unav;
    unavailable.textContent = unav ?? '';
    heard.textContent = '';
    void refreshUpdateLink();
    // マイクが使えない頁(http など)では、マイクの一覧・メーター・「はなしてみてね」を出さない(押しても動かないので)
    meterRow.hidden = Boolean(unav);
    testRow.hidden = Boolean(unav);
    if (unav) {
      micField.hidden = true;
      allowBtn.hidden = true;
      speakerField.hidden = true; // 一覧が取れない(空の欄を出さない。iPhone の Safari の http で出ていた)
      speakerNote.hidden = false;
      return;
    }
    if (await readDevices()) void startMeter();
  }

  allowBtn.addEventListener('click', async () => {
    wakeMeterCtx();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      unavailable.hidden = true;
    } catch (err) {
      unavailable.hidden = false;
      unavailable.textContent = micFailureText(err);
      return;
    }
    if (await readDevices()) void startMeter();
  });

  micSelect.addEventListener('change', () => {
    wakeMeterCtx();
    const d = mics.find((m) => m.id === micSelect.value) ?? null;
    choice = saveChoice({ ...choice, mic: d ? { ...d, def: isDefaultMic(mics, d) } : null });
    route.textContent = routeText();
    stopTest();
    void startMeter();
    if (app?.listener?.listening) {
      mainWasOn = true; // 窓を閉じた時に、新しいマイクで入れ直す
      micBtn.click();
    }
  });
  speakerSelect.addEventListener('change', () => {
    const d = speakers.find((m) => m.id === speakerSelect.value) ?? null;
    choice = saveChoice({ ...choice, speaker: d });
    app?.speaker?.setOutput?.(d?.id ?? '');
  });
  testBtn.addEventListener('click', () => (testListener ? stopTest() : void startTest()));
  chimeBtn.addEventListener('click', () => void playChime(canPick ? (resolveDevice(speakers, choice.speaker)?.id ?? '') : ''));
  updateBtn.addEventListener('click', () => {
    sheet.hide();
    update?.open(gear);
  });
  gear.addEventListener('click', () => (sheet.isOpen() ? sheet.hide() : void open(gear)));
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    if (sheet.isOpen()) void readDevices();
  });
  window.addEventListener(SILENT_EVENT, () => note.show(AUDIO_WORDS.silent, { button: AUDIO_WORDS.pick, onClick: () => void open(gear), ms: 15000 }));
  window.addEventListener(NOTE_EVENT, (e) => note.show(String(e.detail?.text ?? ''), { ms: 8000 }));
  return { open, gear, sheet, note };
}
