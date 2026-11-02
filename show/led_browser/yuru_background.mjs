// ゆるキャラのショーの背景。明るい昼の絵を、シェーダーの計算だけで描く(素材は使わない)。
// 出力は線形の色。中央の面は横につぶれて見えるので、丸が丸く見えるように座標を伸ばした空間(warp)で描く。
export const MAX_CHARACTERS = 6;
export const PALETTE_SIZE = 6;

export const BACKGROUND_VERTEX = `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const BACKGROUND_FRAGMENT = `
precision highp float;
#define N ${MAX_CHARACTERS}
#define P ${PALETTE_SIZE}
uniform vec2 uRes;
uniform float uCx, uStretch, uSeamL, uSeamR;
uniform float uBeat, uPulse, uDown, uEnergy, uKime;
uniform int uCount;
uniform vec4 uDisc[N];      // 丸の中心(絵の x, y)、半径、弾み
uniform vec3 uDiscColor[N];
uniform vec3 uFoot[N];      // 足元(絵の x, y)、跳ねの高さの割合
uniform vec3 uPalette[P];

const float PI = 3.14159265;
const float BUBBLE_COUNT = 13.0;
const float BUBBLE_SPAN = 5000.0;
const float DOT_SPACING = 150.0;
const float DOT_Y = 190.0;
const float CONFETTI_CELL = 118.0;
const float BACKGROUND_LEVEL = 0.62;

float warp(float x) {
  if (x < uSeamL) return x;
  if (x < uSeamR) return uSeamL + (x - uSeamL) / uStretch;
  return uSeamL + (uSeamR - uSeamL) / uStretch + (x - uSeamR);
}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float disc(float d, float r, float edge) { return 1.0 - smoothstep(r - edge, r + edge, d); }

vec3 sky(vec2 w, float cu) {
  float t = smoothstep(0.0, 1040.0, w.y);
  vec3 c = mix(vec3(0.030, 0.270, 0.690), vec3(0.200, 0.610, 0.830), t);
  // 中心から左右対称に広がる光の筋。拍でゆっくり回る
  vec2 q = vec2(abs(w.x - cu), 1120.0 - w.y);
  float a = atan(q.x, q.y) + uBeat * 0.035;
  float ray = smoothstep(-0.25, 0.25, sin(a * 18.0));
  return c * (1.0 + 0.22 * ray);
}

vec3 bubbles(vec3 c, vec2 w) {
  for (float i = 0.0; i < BUBBLE_COUNT; i += 1.0) {
    float s = hash(vec2(i, 3.0));
    float x = (i + 0.5 + 0.6 * (hash(vec2(i, 7.0)) - 0.5)) / BUBBLE_COUNT * BUBBLE_SPAN;
    float y = 120.0 + 700.0 * hash(vec2(i, 11.0));
    float beat = uBeat + i * 0.5;
    y += 40.0 * sin(beat * PI * 0.5) - 26.0 * abs(sin(beat * PI));
    float r = (130.0 + 170.0 * s) * (1.0 + 0.06 * uPulse);
    int idx = int(mod(i, float(P)));
    float d = length(w - vec2(x, y));
    c = mix(c, uPalette[idx], 0.20 * disc(d, r, 3.0));
    c = mix(c, uPalette[idx], 0.18 * disc(abs(d - r * 0.68), 12.0, 2.0));
  }
  return c;
}

vec3 bouncingDots(vec3 c, vec2 w) {
  float k = floor(w.x / DOT_SPACING);
  float phase = fract(uBeat - k * 0.08);
  float hop = 4.0 * phase * (1.0 - phase);
  vec2 center = vec2((k + 0.5) * DOT_SPACING, DOT_Y - 60.0 * hop);
  float d = length(w - center);
  int idx = int(mod(k, float(P)));
  return mix(c, uPalette[idx], disc(d, 30.0 + 8.0 * (1.0 - hop), 2.0));
}

vec3 hills(vec3 c, vec2 w) {
  float b = uBeat;
  float h1 = 960.0 + 46.0 * sin(w.x * 0.0023 + b * 0.39) + 14.0 * uPulse * sin(w.x * 0.011 + b * PI);
  c = mix(c, vec3(0.970, 0.480, 0.070), smoothstep(h1 - 2.0, h1 + 2.0, w.y));
  float h2 = 1020.0 + 36.0 * sin(w.x * 0.0031 - b * 0.53 + 1.7);
  c = mix(c, vec3(0.900, 0.130, 0.320), smoothstep(h2 - 2.0, h2 + 2.0, w.y));
  float h3 = 1078.0 + 24.0 * sin(w.x * 0.0041 + b * 0.27 + 4.1);
  c = mix(c, vec3(0.120, 0.470, 0.170), smoothstep(h3 - 2.0, h3 + 2.0, w.y));
  float stripes = step(0.5, fract((w.x + 70.0 * sin(w.y * 0.02)) / 180.0 + b * 0.125));
  c *= mix(1.0, 1.0 + 0.20 * stripes, smoothstep(h3, h3 + 6.0, w.y));
  return c;
}

vec3 confetti(vec3 c, vec2 w, float cell, float speed, float seed) {
  float fall = uBeat * speed;
  vec2 g = vec2(w.x, w.y - fall) / cell;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float r = hash(id + seed);
  float density = 0.08 + 0.12 * uEnergy + 0.40 * uKime;
  if (r > density) return c;
  float angle = hash(id + seed + 5.0) * PI + uBeat * (0.6 + 1.2 * r);
  float cs = cos(angle), sn = sin(angle);
  vec2 q = vec2(cs * f.x - sn * f.y, sn * f.x + cs * f.y);
  q += (vec2(hash(id + 2.0), hash(id + 9.0)) - 0.5) * 0.3;
  float piece = (1.0 - smoothstep(0.17, 0.19, abs(q.x))) * (1.0 - smoothstep(0.075, 0.095, abs(q.y)));
  int idx = int(mod(id.x + id.y * 3.0, float(P)));
  return mix(c, uPalette[idx], piece);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 w = vec2(warp(px.x), px.y);
  float cu = warp(uCx);
  vec3 c = sky(w, cu);
  c = bubbles(c, w);
  c = bouncingDots(c, w);
  c = hills(c, w);
  c = confetti(c, w, CONFETTI_CELL, 58.0, 1.0);
  for (int i = 0; i < uCount; i++) {
    vec2 center = vec2(warp(uDisc[i].x), uDisc[i].y);
    float d = length(w - center);
    float r = uDisc[i].z * (1.0 + 0.05 * uDisc[i].w);
    c = mix(c, uDiscColor[i], 0.92 * disc(d, r, 4.0));
    c = mix(c, uDiscColor[i] * 1.5, disc(abs(d - r - 26.0), 10.0, 3.0) * 0.8);
  }
  c = confetti(c, w, CONFETTI_CELL * 1.5, 82.0, 8.0);
  for (int i = 0; i < uCount; i++) {
    vec2 foot = vec2(warp(uFoot[i].x), uFoot[i].y);
    float spread = 1.0 / (1.0 + 2.2 * uFoot[i].z);
    vec2 e = (w - foot) / vec2(200.0 * spread, 30.0 * spread);
    c *= 1.0 - 0.55 * spread * (1.0 - smoothstep(0.35, 1.0, length(e)));
  }
  // LED の全面が真っ白に近づかないよう、全体を抑える。キャラはこの後に描くので暗くならない
  c *= BACKGROUND_LEVEL * (1.0 + 0.08 * uPulse + 0.08 * uDown + 0.06 * uKime);
  gl_FragColor = vec4(c, 1.0);
}`;
