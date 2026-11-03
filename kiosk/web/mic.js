// マイクの確認の画面。選んだ入力(録音機など)で、2 チャンネルが取れるか・声の向きが出るか・文字になるかを見る。
// 音はこのページの中で数字にするだけ(保存も送信もしない)。向きの計算は web/src/tracking/audio の物をそのまま使う(サーバーが /kiosk/lib/ で配る)。
import { StereoMic } from '/kiosk/lib/stereoMic.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const num = (k, d) => (Number.isFinite(Number(q.get(k))) && q.get(k) !== null ? Number(q.get(k)) : d);
let mic = null;
let timer = null;

async function listDevices() {
  // ラベルは、1 度マイクの許可を取ったあとに見える
  const tmp = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  tmp?.getTracks().forEach((t) => t.stop());
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const sel = $('dev');
  sel.replaceChildren(...devs.map((d) => Object.assign(document.createElement('option'), { value: d.label, textContent: d.label || '(名前なし)' })));
  const hint = q.get('hint')?.toLowerCase();
  const hit = hint ? devs.find((d) => d.label.toLowerCase().includes(hint)) : null;
  if (hit) sel.value = hit.label;
  return devs;
}

async function start() {
  mic?.stop();
  clearInterval(timer);
  mic = new StereoMic({ deviceHint: $('dev').value || undefined, micSpacingM: num('spacing', 0.06), ildDegPerDb: num('ild', 0), swapLeftRight: q.get('swap') === '1' });
  window.__mic = mic;
  $('status').textContent = '始めています…';
  const st = await mic.start();
  $('label').textContent = mic.info.label || '―';
  $('fmt').textContent = `${mic.info.channels} ch / ${mic.info.sampleRate} Hz`;
  $('status').textContent = st === 'stereo' ? 'ステレオで取れています' : st === 'mono' ? '1 チャンネルしか取れていません(向きは出せません)' : `失敗: ${mic.error}`;
  timer = setInterval(() => {
    const t = mic.tracker;
    if (!t) return;
    const e = mic.estimate();
    const f = t.current;
    $('level').style.width = `${Math.min(100, Math.round((e?.level ?? f?.level ?? 0) * 400))}%`;
    if (f) {
      $('ild').textContent = Number.isFinite(f.ildDb) ? `${f.ildDb.toFixed(1)} dB` : '―';
      $('itd').textContent = `${Number.isFinite(f.lagSamples) ? f.lagSamples.toFixed(2) : '―'} サンプル / ${Number.isFinite(f.coherence) ? f.coherence.toFixed(2) : '―'}`;
    }
    const m = e?.measurements?.find((x) => x.kind === 'itd');
    $('bearing').textContent = m ? `${m.bearingDeg.toFixed(0)}°(確かさ ${m.confidence.toFixed(2)})` : '(声が出ていない)';
    if (m) $('needle').style.left = `${50 + Math.max(-90, Math.min(90, m.bearingDeg)) / 90 * 46}%`;
  }, 100);
}

$('start').addEventListener('click', start);
$('stt').addEventListener('click', () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return ($('text').textContent = 'このブラウザには、声の聞き取りがありません');
  const r = new SR();
  r.lang = 'ja-JP';
  r.interimResults = true;
  r.onresult = (e) => ($('text').textContent = [...e.results].map((x) => x[0].transcript).join(''));
  r.onerror = (e) => ($('text').textContent = `エラー: ${e.error}`);
  r.start();
  $('text').textContent = '聞いています…';
});
listDevices().then((devs) => {
  $('status').textContent = devs.length ? `${devs.length} 個の入力が見えています` : '入力が見えません';
  if (q.get('auto') === '1') start();
});
