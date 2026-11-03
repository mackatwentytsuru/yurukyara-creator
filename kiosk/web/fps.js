// 顔の検出の速さの確認。MediaPipe Face Landmarker(ブラウザ版)を、動画かカメラの映像に 30 秒かけて、1 コマあたりの時間と見つかった割合を出す。
// ミニ PC(Ryzen 5 3500U)で、スマホと同じ動画を使って比べるための物。映像は画面の中だけ(保存・送信しない)。
import { FaceLandmarker, FilesetResolver } from '/kiosk/mp/vision_bundle.mjs';

const $ = (id) => document.getElementById(id);
const out = (s) => ($('out').textContent = s);
let stream = null;

$('file').onchange = () => {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  const f = $('file').files[0];
  if (!f) return;
  $('vid').srcObject = null;
  $('vid').src = URL.createObjectURL(f);
  $('vid').play();
  out(`動画: ${f.name}`);
};
$('cam').onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } });
    $('vid').removeAttribute('src');
    $('vid').srcObject = stream;
    await $('vid').play();
    out(`カメラ: ${stream.getVideoTracks()[0].label} ${JSON.stringify(stream.getVideoTracks()[0].getSettings())}`);
  } catch (e) {
    out(`カメラを使えません: ${e.name} ${e.message}`);
  }
};

$('run').onclick = async () => {
  const v = $('vid');
  if (!v.src && !v.srcObject) return out('先に動画かカメラを選んでください');
  out('モデルを読み込んでいます…');
  const delegate = $('delegate').value;
  let lm;
  try {
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    lm = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 2, outputFaceBlendshapes: true });
  } catch (e) {
    return out(`読み込めません(${delegate}): ${e.message}`);
  }
  const times = [];
  let found = 0;
  let frames = 0;
  const t0 = performance.now();
  let lastVideoTime = -1;
  while (performance.now() - t0 < 30000) {
    if (v.readyState < 2 || v.currentTime === lastVideoTime) {
      await new Promise((r) => requestAnimationFrame(r));
      continue;
    }
    lastVideoTime = v.currentTime;
    const a = performance.now();
    const res = lm.detectForVideo(v, a);
    times.push(performance.now() - a);
    frames += 1;
    if (res.faceLandmarks?.length) found += 1;
    if (frames % 10 === 0) out(`測っています… ${frames} コマ(${Math.round((performance.now() - t0) / 1000)} 秒)`);
    await new Promise((r) => requestAnimationFrame(r));
  }
  lm.close();
  times.sort((x, y) => x - y);
  const q = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
  const avg = times.reduce((s, x) => s + x, 0) / times.length;
  out([`端末: ${navigator.userAgent}`, `映像: ${v.videoWidth}×${v.videoHeight} / 使った処理: ${delegate}`, `調べたコマ: ${frames}(30 秒)`, `1 コマの検出の時間: 平均 ${avg.toFixed(1)} ms / 中央値 ${q(0.5).toFixed(1)} ms / 90% ${q(0.9).toFixed(1)} ms / 最大 ${times[times.length - 1].toFixed(1)} ms`, `検出だけで出せる速さ: 約 ${(1000 / avg).toFixed(1)} コマ/秒`, `顔が見つかった割合: ${(found / frames * 100).toFixed(1)}%`, '※ 検出は画面の更新と同じスレッドで動かしている(速さの下限の目安)。カメラ・映像の取り込みの遅れは含まない'].join('\n'));
};
