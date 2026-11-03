// スマホの確認。カメラ・マイク・スピーカー・画面ロックを、端末のブラウザで確かめる(iPhone の Safari / Pixel の Chrome)。
// 音も映像も、この画面の中で数字にするだけ(保存・送信しない)。
import { StereoMic } from '/kiosk/lib/stereoMic.js';

const $ = (id) => document.getElementById(id);
const log = (id, s) => ($(id).textContent = s);
const fmt = (o) => JSON.stringify(o, null, 1);

log('env', [`UA: ${navigator.userAgent}`, `安全なページか(isSecureContext): ${window.isSecureContext}`, `getUserMedia: ${Boolean(navigator.mediaDevices?.getUserMedia)}`, `AudioWorklet: ${Boolean(window.AudioWorkletNode)}`, `Wake Lock: ${Boolean(navigator.wakeLock)}`, `setSinkId(出力先の指定): ${Boolean(HTMLMediaElement.prototype.setSinkId)}`, `画面: ${screen.width}×${screen.height} @${devicePixelRatio}`].join('\n'));

let camStream = null;
$('camList').onclick = async () => {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach((t) => t.stop());
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    $('camSel').replaceChildren(...cams.map((d, i) => Object.assign(document.createElement('option'), { value: d.deviceId, textContent: d.label || `カメラ ${i + 1}` })));
    log('camOut', `${cams.length} 台: ${cams.map((d) => d.label).join(' / ')}`);
  } catch (e) {
    log('camOut', `失敗: ${e.name} ${e.message}`);
  }
};
$('camStart').onclick = async () => {
  try {
    camStream?.getTracks().forEach((t) => t.stop());
    const id = $('camSel').value;
    camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } } });
    const tr = camStream.getVideoTracks()[0];
    $('vid').srcObject = camStream;
    await $('vid').play();
    const caps = tr.getCapabilities?.() ?? {};
    log('camOut', `選んだ: ${tr.label}\n実際の設定: ${fmt(tr.getSettings())}\n能力: 幅 ${fmt(caps.width)} 高さ ${fmt(caps.height)} fps ${fmt(caps.frameRate)} zoom ${fmt(caps.zoom)}\n→ 映像を見て、広く写っているか(超広角か)を目で確かめる。zoom の最小が 0.5 なら、0.5 倍に下げられる`);
  } catch (e) {
    log('camOut', `失敗: ${e.name} ${e.message}`);
  }
};

let mic = null;
$('micList').onclick = async () => {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
    const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    $('micSel').replaceChildren(...mics.map((d, i) => Object.assign(document.createElement('option'), { value: d.label, textContent: d.label || `マイク ${i + 1}` })));
    log('micOut', `${mics.length} 個: ${mics.map((d) => d.label).join(' / ')}`);
  } catch (e) {
    log('micOut', `失敗: ${e.name} ${e.message}`);
  }
};
$('micStart').onclick = async () => {
  mic?.stop();
  mic = new StereoMic({ deviceHint: $('micSel').value || undefined, micSpacingM: 0.06 });
  window.__mic = mic;
  const st = await mic.start();
  const track = mic.stream?.getAudioTracks()[0];
  const set = track?.getSettings?.() ?? {};
  log('micOut', `状態: ${st}${mic.error ? ' ' + mic.error : ''}\n入力: ${mic.info.label}\nチャンネル(Chrome/Safari の報告): ${mic.info.channels} / サンプルレート ${mic.info.sampleRate}\n設定: ${fmt({ channelCount: set.channelCount, echoCancellation: set.echoCancellation, noiseSuppression: set.noiseSuppression, autoGainControl: set.autoGainControl })}\n→ 左右で別々に動けば 2ch(片方を指で触る・左右から声を出して、メーターを見る)`);
  clearInterval(window.__mt);
  window.__mt = setInterval(() => {
    const lv = mic.levels ?? { l: 0, r: 0 };
    $('mL').style.width = `${Math.min(100, Math.round(lv.l * 600))}%`;
    $('mR').style.width = `${Math.min(100, Math.round(lv.r * 600))}%`;
  }, 80);
};

$('tone').onclick = async () => {
  const ctx = new AudioContext();
  await ctx.resume();
  const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.9;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const out = (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind === 'audiooutput');
  log('spkOut', `ノイズを出しました(端末の音量を最大にして、店の入口で聞こえるか・どの距離まで聞こえるかを、耳で確かめてください)。\n出力先の一覧: ${out.length ? out.map((x) => x.label).join(' / ') : '(このブラウザは出力先を出さない)'}`);
};
$('beep').onclick = async () => {
  if (!mic?.ctx) return log('spkOut', '先に 2 の「2ch で聞く」を押してください');
  const ctx = mic.ctx;
  const t0 = ctx.currentTime + 0.4;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = 1000;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.9, t0 + 0.005);
  g.gain.setValueAtTime(0.9, t0 + 0.15);
  g.gain.linearRampToValueAtTime(0, t0 + 0.16);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.2);
  // マイクの大きさが、鳴らす前の 4 倍を超えた最初の時刻(コンテキストの時計)を、鳴らした時刻と比べる
  const base = [];
  let hit = null;
  const timer = setInterval(() => {
    const lv = Math.max(mic.levels?.l ?? 0, mic.levels?.r ?? 0);
    if (ctx.currentTime < t0) base.push(lv);
    else if (hit === null && base.length && lv > Math.max(0.02, 4 * (base.reduce((a, b) => a + b, 0) / base.length))) hit = ctx.currentTime;
    if (ctx.currentTime > t0 + 1) {
      clearInterval(timer);
      log('spkOut', hit === null ? 'ビープがマイクに戻ってきませんでした(音量が小さい・近くにない・エコー除去が効いている)' : `往復の遅れ(出す→マイクで検知): 約 ${Math.round((hit - t0) * 1000)} ms(画面の更新が 16〜80 ms の誤差。出力の遅れ + 音の空間の移動 + 入力の遅れ)`);
    }
  }, 8);
};

let lock = null;
$('wake').onclick = async () => {
  const t0 = Date.now();
  const show = (s) => log('wakeOut', `${s}\n開始から ${Math.round((Date.now() - t0) / 1000)} 秒`);
  try {
    lock = await navigator.wakeLock.request('screen');
    show('Wake Lock: 取れました。画面が消えないはずです(放置して確かめる)');
    lock.addEventListener('release', () => show('Wake Lock: 解除されました(電池・タブ切り替え・OS の判断)'));
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && (!lock || lock.released)) {
        try {
          lock = await navigator.wakeLock.request('screen');
          show('Wake Lock: 画面に戻ったので、取り直しました');
        } catch (e) {
          show(`取り直せません: ${e.name}`);
        }
      }
    });
  } catch (e) {
    show(`取れません: ${e.name} ${e.message}`);
  }
};
