// 視線の校正の手伝い(スマホで開く)。矢印でキャラの向き(狙い)を動かし、「自分を見ている」と感じた所で記録する。
// 向きはサーバー(/api/gaze/aim)へ送り、入口のページ(?source=bridge)のキャラが、その向きを見る。
// 記録(/api/gaze/mark)は、いまの狙いの向き + いまのカメラの顔の画素(視線の橋を --with-pixels で動かす)を 1 点にする。
// 送るのは向きの数字だけ。この画面はカメラもマイクも使わない。
const $ = (id) => document.getElementById(id);
const state = { az: 0, el: 0, on: false };

const show = () => {
  $('az').textContent = state.on ? state.az.toFixed(1) : '—';
  $('el').textContent = state.on ? state.el.toFixed(1) : '—';
};
const say = (t) => ($('msg').textContent = t);

async function post(path, body = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `エラー ${res.status}`);
  return j;
}

async function sendAim() {
  try {
    await post('/api/gaze/aim', { az: state.az, el: state.el });
    state.on = true;
    show();
  } catch (e) {
    say(e.message);
  }
}

const step = () => Number(document.querySelector('input[name=step]:checked').value);

document.querySelectorAll('[data-d]').forEach((b) =>
  b.addEventListener('click', () => {
    const [dx, dy] = b.dataset.d.split(',').map(Number);
    state.az = Math.max(-80, Math.min(80, state.az + dx * step()));
    state.el = Math.max(-50, Math.min(50, state.el + dy * step()));
    say('');
    sendAim();
  }),
);

// いまのカメラの向き(校正前の値)から始めると、合わせる手数が少ない
$('fromCam').addEventListener('click', async () => {
  await post('/api/gaze/aim', { off: true }).catch(() => {});
  const g = await (await fetch('/api/gaze/now', { cache: 'no-store' })).json().catch(() => null);
  if (!g?.present) return say('カメラに顔が見えていません');
  state.az = Math.round(g.az * 2) / 2;
  state.el = Math.round(g.el * 2) / 2;
  sendAim();
});

$('mark').addEventListener('click', async () => {
  if (!state.on) await sendAim();
  try {
    const r = await post('/api/gaze/mark');
    if (!r.ok) return say(r.reason);
    $('count').textContent = r.count;
    say(`記録しました(${r.count} 点目)。次の印へ`);
  } catch (e) {
    say(e.message);
  }
});

$('undo').addEventListener('click', async () => {
  const r = await post('/api/gaze/unmark').catch((e) => say(e.message));
  if (r) $('count').textContent = r.count;
});

$('off').addEventListener('click', async () => {
  await post('/api/gaze/aim', { off: true }).catch((e) => say(e.message));
  state.on = false;
  show();
  say('カメラの向きに戻しました');
});

// 点を JSON のファイルにする(gaze_calib.py --points に、そのまま渡せる形)
$('save').addEventListener('click', async () => {
  const pts = await (await fetch('/api/gaze/points', { cache: 'no-store' })).json();
  if (pts.length < 5) say(`まだ ${pts.length} 点です(5 点以上で効きます)`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(pts, null, 1)], { type: 'application/json' }));
  a.download = 'gaze_points.json';
  a.click();
});

fetch('/api/gaze', { cache: 'no-store' })
  .then((r) => r.json())
  .then((s) => {
    $('count').textContent = s.points ?? 0;
    if (s.aim) Object.assign(state, { az: s.aim.az, el: s.aim.el, on: true });
    show();
  })
  .catch(() => say('サーバーに視線の受け口がありません(GAZE_UDP_PORT を付けて起動)'));
