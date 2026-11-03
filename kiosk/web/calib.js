// 校正の表示。モニター・テレビ・LED に、レンズ用の盤・キャラの目の位置の印・9 点・位置の番号・同期用のフラッシュを出す。
// 位置の表(床の印の番号・距離・左右・目の高さ)は POSITIONS。スペースで次の位置へ進むたびに、白いフラッシュ(0.4 秒)→ 番号(1 秒)→ 目の印、を出す。
// 録画の切れ目は、フラッシュ(客の顔が明るくなる)と番号(客役のカメラに映る)で見つける。音は使わない。
export const POSITIONS = (() => {
  const list = [];
  // 距離の遠い方から。1 つの距離の中で、左→中→右、立つ→しゃがむ(目の高さを変える)
  for (const d of [3.0, 2.0, 1.5]) for (const x of [-0.8, 0, 0.8]) for (const h of ['立つ', 'しゃがむ']) list.push({ d, x, h });
  return list.map((p, i) => ({ id: i + 1, ...p }));
})();

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const PERIOD = Number(q.get('period') ?? 25); // 自動で進めるときの 1 位置あたりの秒(移動 9 秒 + 止まって見る時間)
const MOVE_S = 9;
const state = { auto: null, mode: '2', idx: -1, eye: { x: Number(q.get('ex') ?? 0.5), y: Number(q.get('ey') ?? 0.3) }, scale: 1 };

function portrait() {
  return innerHeight >= innerWidth;
}
function setMode(m) {
  state.mode = m;
  $('board').style.display = m === '1' ? 'block' : 'none';
  if (m === '1') $('board').src = `/kiosk/calib/led_board_${portrait() ? 'portrait' : 'landscape'}.png`;
  $('eye').style.display = m === '2' ? 'block' : 'none';
  $('grid').style.display = m === '3' ? 'block' : 'none';
  render();
}
function render() {
  const e = $('eye');
  e.style.left = `${state.eye.x * 100}%`;
  e.style.top = `${state.eye.y * 100}%`;
  e.style.transform = `scale(${state.scale})`;
  if (!$('grid').childElementCount) {
    let n = 1;
    for (const y of [0.15, 0.5, 0.85]) for (const x of [0.15, 0.5, 0.85]) {
      const s = document.createElement('span');
      s.textContent = n++;
      s.style.left = `${x * 100}%`;
      s.style.top = `${y * 100}%`;
      $('grid').append(s);
    }
  }
  const p = POSITIONS[state.idx];
  const phase = state.auto ? (Date.now() - state.auto.t0 < MOVE_S * 1000 ? '移動してください → ' : '止まって、目の印を見る → ') : '';
  $('label').textContent = state.mode === '2' && p ? phase + `P${String(p.id).padStart(2, '0')}  距離 ${p.d} m  左右 ${p.x > 0 ? '右' : p.x < 0 ? '左' : '中'} ${Math.abs(p.x)} m  ${p.h}` : state.mode === '1' ? '盤(レンズの校正用)' : state.mode === '3' ? '9 点' : '';
  $('label').style.display = $('label').textContent ? 'block' : 'none';
}
function flash(ms = 400) {
  $('flash').style.display = 'block';
  setTimeout(() => ($('flash').style.display = 'none'), ms);
}
function go(delta) {
  const next = state.idx + delta;
  if (next < 0 || next >= POSITIONS.length) return;
  state.idx = next;
  const p = POSITIONS[next];
  setMode('2');
  flash(400);
  setTimeout(() => {
    $('numText').innerHTML = `P${String(p.id).padStart(2, '0')}<small>距離 ${p.d} m ・ ${p.x > 0 ? '右' : p.x < 0 ? '左' : '中'} ${Math.abs(p.x)} m ・ ${p.h}</small>`;
    $('num').style.display = 'grid';
    setTimeout(() => ($('num').style.display = 'none'), 1000);
  }, 450);
  render();
}
addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.05 : 0.01;
  if (['0', '1', '2', '3'].includes(e.key)) return e.key === '0' ? ((state.mode = '0'), ['board', 'eye', 'grid'].forEach((id) => ($(id).style.display = 'none')), render()) : setMode(e.key);
  if (e.key === ' ') return (e.preventDefault(), go(1));
  if (e.key === 'a') return toggleAuto();
  if (e.key === 'b') return go(-1);
  if (e.key === 'f') return flash(400);
  if (e.key === 'h') return ($('help').style.display = $('help').style.display === 'none' ? 'block' : 'none');
  if (e.key === 'ArrowLeft') state.eye.x -= step;
  else if (e.key === 'ArrowRight') state.eye.x += step;
  else if (e.key === 'ArrowUp') state.eye.y -= step;
  else if (e.key === 'ArrowDown') state.eye.y += step;
  else if (e.key === '[') state.scale = Math.max(0.3, state.scale - 0.1);
  else if (e.key === ']') state.scale = Math.min(3, state.scale + 0.1);
  else return;
  render();
});
function toggleAuto() {
  if (state.auto) {
    clearInterval(state.auto.timer);
    state.auto = null;
    return render();
  }
  state.idx = -1;
  const tick = () => {
    if (state.idx + 1 >= POSITIONS.length) return toggleAuto();
    state.auto.t0 = Date.now();
    go(1);
  };
  state.auto = { t0: Date.now(), timer: setInterval(tick, PERIOD * 1000) };
  tick();
  setInterval(() => state.auto && render(), 1000);
}
addEventListener('resize', () => state.mode === '1' && setMode('1'));
setMode('2');
window.__calib = { state, POSITIONS, go, setMode };

// 説明は 20 秒で消える(録画に映らないように)。h でまた出せる
setTimeout(() => ($('help').style.display = 'none'), 20000);
