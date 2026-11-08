// VR・ヘッドセットの AR の中の文字。ページの文字(DOM)は見えないので、いまの状態と話した言葉を、キャラの横の板に描く。
import * as THREE from 'three';
// 板の地と字・状態の色は「いろ」で替わる(theme.js が CSS の変数を読む)。下の VR_STATES の color は、読めない時の値(むらさき)
import { getTheme, onThemeChange, readVrColors, rgbCss } from '../theme.js';

const W = 1024;
const H = 480;
const PANEL_W_M = 0.8; // 実機の Quest で、右に寄りすぎて左目と撮影の外にはみ出した(Q3 ④)ので 1.0 → 0.8 m
const PADDING = 44;
const FONT = '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", Meiryo, sans-serif';

export const VR_STATES = {
  off: { label: 'マイクなし(トリガー = こんにちは)', color: '#8d86a8' },
  idle: { label: 'どうぞ、話しかけてください', color: '#9fd8ff' },
  hearing: { label: '聞いています', color: '#7fe3a8' },
  transcribing: { label: '文字にしています', color: '#ffd27f' },
  thinking: { label: '考えています', color: '#ffd27f' },
  speaking: { label: '話しています', color: '#ff9fc4' },
};

/** 日本語は語の切れ目が無いので、1 字ずつ測って折り返す。入りきらないときは、新しい行(文の後ろ)を残す */
export function wrapLines(text, measure, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of String(text ?? '')) {
    if (measure(line + ch) > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines.slice(-maxLines);
}

export function createVrPanel({ scene }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_W_M, (PANEL_W_M * H) / W),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
  );
  mesh.name = 'vrPanel';
  mesh.visible = false;
  scene.add(mesh);

  let drawn = '';
  const shown = { state: 'off', user: '', reply: '', error: '' };
  const toHead = new THREE.Vector3();
  const charPos = new THREE.Vector3();
  const head = new THREE.Vector3();

  function roundRect(x, y, w, h, r) {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  }

  function draw() {
    g.clearRect(0, 0, W, H);
    const vr = readVrColors();
    g.fillStyle = rgbCss(vr.panelRgb, 0.86);
    roundRect(0, 0, W, H, 36);
    g.fill();
    const st = VR_STATES[shown.state] ?? VR_STATES.idle;
    g.fillStyle = vr.states[shown.state === 'transcribing' ? 'thinking' : shown.state] ?? st.color;
    g.beginPath();
    g.arc(PADDING + 14, PADDING + 18, 14, 0, Math.PI * 2);
    g.fill();
    g.font = `600 40px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillText(st.label, PADDING + 44, PADDING + 18);
    g.textBaseline = 'alphabetic';
    let y = PADDING + 92;
    const max = W - PADDING * 2;
    const measure = (s) => g.measureText(s).width;
    const block = (text, color, size, lines) => {
      g.font = `${size}px ${FONT}`;
      g.fillStyle = color;
      for (const line of wrapLines(text, measure, max, lines)) {
        g.fillText(line, PADDING, y);
        y += size * 1.34;
      }
      y += 10;
    };
    if (shown.error) block(shown.error, vr.error, 36, 3);
    if (shown.user) block(`あなた: ${shown.user}`, vr.user, 34, 2);
    if (shown.reply) block(shown.reply, vr.reply, 42, 4);
    texture.needsUpdate = true;
  }

  onThemeChange(() => {
    drawn = '';
    draw();
  });

  return {
    mesh,
    shown,
    setVisible(v) {
      mesh.visible = v;
    },
    /** @param {{state?:string, user?:string, reply?:string, error?:string}} next 変わった時だけ描き直す(毎フレーム描くと、VR では重い) */
    set(next) {
      Object.assign(shown, next);
      const key = JSON.stringify(shown) + getTheme();
      if (key !== drawn) {
        drawn = key;
        draw();
      }
    },
    /** キャラの横、見ている人から見て右に置き、見ている人のほうへ向ける */
    place(characterObject, height, camera) {
      characterObject.getWorldPosition(charPos);
      camera.getWorldPosition(head);
      toHead.copy(head).sub(charPos).setY(0);
      if (toHead.lengthSq() < 1e-4) return;
      toHead.normalize();
      const side = Math.max(0.35, height * 0.28) + PANEL_W_M / 2; // 見ている人から見て右(板の外の端が、見ている人から 35° ほどに収まる近さ)
      mesh.position.set(charPos.x + toHead.z * side + toHead.x * 0.1, charPos.y + THREE.MathUtils.clamp(height * 0.75, 1.05, 1.5), charPos.z - toHead.x * side + toHead.z * 0.1);
      mesh.lookAt(head);
    },
  };
}
