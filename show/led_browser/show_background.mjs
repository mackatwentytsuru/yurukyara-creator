// 背景の絵(GLSL)。時刻と音から決まる値だけを使い、乱数は座標と番号のハッシュなので、同じコマは同じ絵になる。
// 出力は明るさの線形の値。階調の変換は show_output.mjs がまとめてする。

export const BACKGROUND_VERTEX = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

export const BACKGROUND_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform vec2 uRes;
uniform float uCx, uStretch, uSeamL, uSeamR, uFloorY;
uniform float uT, uFlow, uBeatPos, uPulse, uDown, uEnergy, uDrive;
uniform float uBarIndex, uIgniteAge, uBeatSec;
uniform float uRingAge[4];
uniform float uCone, uConeDrop, uPool, uSong, uEmber, uWarm, uWash, uShadow;

const vec3 TEAL = vec3(0.02, 0.62, 0.66);
const vec3 AQUA = vec3(0.10, 0.92, 0.82);
const vec3 PINK = vec3(0.95, 0.07, 0.42);
const vec3 MAGENTA = vec3(0.62, 0.03, 0.72);
const vec3 INDIGO = vec3(0.012, 0.018, 0.06);

uint scramble(uint x) {
  x ^= x >> 15; x *= 0x2c1b3c6dU;
  x ^= x >> 12; x *= 0x297a2d39U;
  x ^= x >> 15;
  return x;
}
float rnd(float a, float b, float c) {
  uint h = scramble(uint(int(a) + 65536) * 73856093U ^ uint(int(b) + 65536) * 19349663U ^ uint(int(c) + 65536) * 83492791U);
  return float(h) / 4294967295.0;
}
float wave1(float x, float seed) {
  float i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(rnd(i, seed, 1.0), rnd(i + 1.0, seed, 1.0), f);
}
float wave2(vec2 p, float seed) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = rnd(i.x, i.y, seed), b = rnd(i.x + 1.0, i.y, seed);
  float c = rnd(i.x, i.y + 1.0, seed), d = rnd(i.x + 1.0, i.y + 1.0, seed);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float clouds(vec2 p, float seed) {
  return 0.55 * wave2(p, seed) + 0.3 * wave2(p * 2.1 + 3.7, seed + 1.0) + 0.15 * wave2(p * 4.3 + 9.1, seed + 2.0);
}

// 中心から外へ飛ぶ粒。対数の座標で流すので、遠いほど速く大きく見える
float flyingSparks(vec2 d, float cells, float speed, float seed, float density) {
  float r = length(d) + 1.0;
  float a = atan(d.y, d.x) / 6.283185 + 0.5;
  float n = floor(cells * 6.283);
  float lr = log(r) * cells - uFlow * speed;
  float cu = floor(a * n), cl = floor(lr);
  if (rnd(cu, cl, seed) > density) return 0.0;
  float ou = 0.2 + 0.6 * rnd(cu, cl, seed + 1.0);
  float ol = 0.25 + 0.5 * rnd(cu, cl, seed + 2.0);
  float across = (a * n - cu - ou) / n * 6.283185 * r;
  float along = (lr - cl - ol) / cells * r;
  float width = 1.3 + r * 0.0009 * (0.5 + rnd(cu, cl, seed + 3.0));
  float streakLength = width * (5.0 + 22.0 * uEnergy);
  // 先が明るく尾が消える光の点
  float tail = along > 0.0 ? exp(-along * along / (width * width * 4.0)) : exp(along / streakLength);
  float glow = exp(-across * across / (width * width)) * tail;
  float twinkle = 0.35 + 0.65 * rnd(cu, cl, seed + 4.0);
  return glow * twinkle * smoothstep(250.0, 1000.0, r);
}

// 全幅をゆっくり漂う小さな粒
float embers(vec2 px, float cell, float rise, float seed, float density) {
  vec2 p = vec2(px.x, px.y + uT * rise) / cell;
  vec2 c = floor(p);
  if (rnd(c.x, c.y, seed) > density) return 0.0;
  vec2 o = 0.25 + 0.5 * vec2(rnd(c.x, c.y, seed + 1.0), rnd(c.x, c.y, seed + 2.0));
  o.x += 0.08 * sin(uT * 0.7 + 6.28 * rnd(c.x, c.y, seed + 3.0));
  vec2 q = (p - c - o) * cell;
  float size = 2.0 + 4.0 * rnd(c.x, c.y, seed + 4.0);
  float blink = 0.55 + 0.45 * sin(uT * (0.8 + 1.5 * rnd(c.x, c.y, seed + 5.0)) + 6.28 * rnd(c.x, c.y, seed + 6.0));
  return exp(-dot(q, q) / (size * size)) * blink;
}

// 歌の間の全面の絵。線形の値なので、暗い所は 0.01 以下まで落とす(表示では十分に見える)
vec3 songPicture(vec2 px) {
  float dx = px.x - uCx;
  float ax = abs(dx);
  vec2 d = vec2(dx, 660.0 - px.y);
  float r = length(d);
  float slope = d.y / (ax + 260.0);
  float beat = uPulse;
  float lift = 0.25 + 1.05 * uEnergy;
  // 中央の面はキャラの色と重ならない青緑に寄せる。ピンクは外の 2 面に出す
  float inCenter = 1.0 - smoothstep(760.0, 980.0, ax);

  // 光の筋: 左右対称。太い筋と細い筋を重ね、小節ごとに筋の並びが入れ替わる
  float wide = wave1(slope * 5.5 + uFlow * 0.10 + uBarIndex * 2.37, 11.0);
  float thin = wave1(slope * 21.0 - uFlow * 0.26 + uBarIndex * 5.13, 12.0);
  float hair = wave1(slope * 67.0 + uFlow * 0.5 + uBarIndex * 3.3, 13.0);
  float rays = 0.8 * pow(wide, 4.0) + 1.1 * pow(thin, 9.0) + 0.7 * pow(hair, 22.0);
  // 拍ごとに中心から外へ走る明るさの波
  float front = fract(ax / 1900.0 - uBeatPos * 0.5);
  float travel = exp(-front * 7.0) + exp(-(1.0 - front) * 34.0);
  float reach = 1.0 / (1.0 + pow(r / 2800.0, 2.0));
  float rayGain = (0.08 + 0.62 * travel + 0.2 * beat + 0.42 * uDown * uDown) * reach * (1.0 + 1.3 * uDrive);
  float hueA = wave1(slope * 2.6 + ax * 0.00035 - uFlow * 0.05 + uBarIndex * 0.71, 21.0);
  float hueB = smoothstep(0.36, 0.64, hueA);
  vec3 rayColor = mix(mix(TEAL, AQUA, wide), mix(PINK, MAGENTA, thin), hueB * (1.0 - 0.85 * inCenter));
  vec3 col = rayColor * rays * rayGain * lift;

  // 暗い所を残す雲。雲の谷は深く落とす
  float cl = clouds(vec2(px.x * 0.00085 - uFlow * 0.05, px.y * 0.0021 + uFlow * 0.03), 31.0);
  col *= 0.04 + 0.96 * smoothstep(0.32, 0.66, cl);

  // サビで面全体に灯る、ゆっくり動く色の面。雲で谷を残すので、真っ白にはならない
  float fieldShape = clouds(vec2(ax * 0.00062 - uFlow * 0.13, px.y * 0.0019 + uFlow * 0.05), 35.0);
  float fieldHue = smoothstep(0.42, 0.66, clouds(vec2(ax * 0.00038 + uFlow * 0.04, px.y * 0.0009), 37.0)) * (1.0 - inCenter);
  float fieldPulse = 0.07 + 0.14 * travel + 0.14 * beat + 0.14 * uDown;
  col += mix(TEAL, PINK, fieldHue) * smoothstep(0.34, 0.78, fieldShape) * fieldPulse * uDrive;

  // 床と天井からの色の帯
  float floorGlow = exp(-(uRes.y - px.y) / 110.0);
  float topGlow = exp(-px.y / 70.0);
  float sweep = wave1(ax * 0.0011 - uFlow * 0.22, 41.0);
  float tone = smoothstep(0.38, 0.62, sweep) * (1.0 - inCenter);
  col += mix(TEAL, PINK, tone) * floorGlow * (0.035 + 0.16 * beat + 0.34 * uDown) * lift;
  col += mix(PINK, TEAL, tone) * topGlow * (0.018 + 0.08 * beat + 0.16 * uDown) * lift;

  // 外の 2 面: 面の境目から外へ、細い光の柱が拍で立つ。B 面には入らない
  float outer = px.x < uSeamL ? uSeamL - px.x : (px.x > uSeamR ? px.x - uSeamR : -1.0);
  if (outer > 0.0) {
    float pitch = 120.0;
    float cIndex = floor((outer + 30.0) / pitch);
    float cf = abs(fract((outer + 30.0) / pitch) - 0.5) * pitch;
    float core = exp(-cf * cf / 64.0);
    float halo = exp(-cf * cf / 1400.0);
    float now = rnd(cIndex, floor(uBeatPos), 51.0);
    float env = 0.12 + 0.88 * exp(-fract(uBeatPos) * 3.2);
    float height = (0.14 + 0.86 * now * now) * env * (0.25 + 0.95 * uEnergy) * (1.0 + 1.1 * uDrive);
    float yf = (uRes.y - px.y) / uRes.y;
    float body = smoothstep(height, height - 0.22, yf) * smoothstep(0.0, 0.01, height);
    float fade = 0.25 + 0.75 * clamp(yf / max(0.05, height), 0.0, 1.0);
    float along = fract(cIndex * 0.083 + uBarIndex * 0.5);
    vec3 pillar = mix(AQUA, PINK, smoothstep(0.35, 0.65, along));
    col += pillar * (core * 1.0 + halo * (0.10 + 0.3 * uDrive)) * body * fade * smoothstep(0.0, 50.0, outer);
  }

  // 小節の頭で広がる輪
  for (int i = 0; i < 4; i++) {
    float age = uRingAge[i];
    if (age > 2.6) continue;
    float radius = 240.0 + age * 2100.0;
    float width = 16.0 + age * 44.0;
    float e = (r - radius) / width;
    float ring = exp(-e * e) * exp(-age * 1.3);
    float tilt = mod(uBarIndex - float(i), 2.0) * (1.0 - inCenter);
    col += mix(AQUA, PINK, tilt) * ring * 0.62 * (0.4 + 0.8 * uEnergy);
  }

  // 飛ぶ粒: 数を絞り、音が強いほど増やす
  float density = 0.05 + 0.13 * uEnergy;
  float sparks = flyingSparks(d, 12.0, 1.15, 61.0, density) + 0.8 * flyingSparks(d, 23.0, 1.6, 67.0, density * 0.8);
  vec3 sparkColor = mix(vec3(0.45, 1.0, 0.92), vec3(1.0, 0.45, 0.72), step(0.5, wave1(slope * 9.0 + uBarIndex, 71.0)));
  col += sparkColor * sparks * (0.28 + 0.3 * beat + 0.3 * uEnergy);
  float dust = embers(px, 95.0, -18.0, 73.0, 0.22);
  col += vec3(0.45, 0.85, 0.9) * dust * (0.04 + 0.16 * beat);

  // 底の色
  col += INDIGO * (0.07 + 0.22 * uEnergy);

  // キャラの後ろを暗くして、キャラを背景から浮かせる
  float vx = dx / 860.0, vy = (px.y - 610.0) / 780.0;
  col *= 1.0 - 0.93 * exp(-(vx * vx + vy * vy) * 1.4);
  return col;
}

// 上から降りる光の円錐と床の光のだまり
vec3 spotPicture(vec2 px) {
  vec3 tone = mix(vec3(0.70, 0.84, 1.0), vec3(1.0, 0.70, 0.40), uWarm);
  float dx = px.x - uCx;
  float k = clamp((px.y + 70.0) / (uFloorY + 70.0), 0.0, 1.0);
  float halfWidth = mix(24.0, 400.0, k) * uStretch;
  float q = abs(dx) / halfWidth;
  float edge = 1.0 - smoothstep(0.35, 1.0, q);
  float streak = 0.72 + 0.28 * wave1(dx / halfWidth * 5.0 + uT * 0.06, 81.0);
  float haze = 0.62 + 0.38 * clouds(vec2(px.x * 0.0022 + uT * 0.015, px.y * 0.0034 - uT * 0.03), 83.0);
  float front = smoothstep(0.0, 0.16, uConeDrop * 1.18 - k);
  float below = 1.0 - smoothstep(uFloorY - 6.0, uFloorY + 42.0, px.y);
  float strength = mix(0.34, 0.11, k);
  vec3 col = tone * edge * edge * streak * haze * strength * front * below * uCone;

  float mote = embers(px, 62.0, 9.0, 85.0, 0.38);
  col += tone * mote * edge * front * below * uCone * 0.28;

  // 床の光のだまり。光が床に届いてから広がる
  float py = (px.y - uFloorY) / 58.0;
  float pxn = dx / (560.0 * uStretch);
  float reachFloor = smoothstep(0.75, 1.0, uConeDrop);
  float poolLight = exp(-(pxn * pxn + py * py) * 1.1);
  col += tone * poolLight * 0.30 * uPool * reachFloor;
  float farX = dx / 1500.0, farY = max(0.0, uFloorY + 20.0 - px.y) / 130.0;
  col += tone * exp(-farX * farX - farY * farY) * 0.035 * uPool * reachFloor;

  // キャラの足元の影
  float sx = dx / (300.0 * uStretch), sy = (px.y - uFloorY - 2.0) / 18.0;
  col *= 1.0 - uShadow * 0.8 * exp(-(sx * sx + sy * sy));
  return col;
}

// 静かな場面の粒と床の色
vec3 quietPicture(vec2 px) {
  vec3 tone = mix(vec3(0.35, 0.72, 0.85), vec3(1.0, 0.56, 0.24), uWarm);
  float e = embers(px, 130.0, 26.0, 91.0, 0.3) + 0.7 * embers(px + 41.0, 78.0, 15.0, 95.0, 0.22);
  float dx = px.x - uCx;
  float fall = 1.0 / (1.0 + pow(abs(dx) / 2600.0, 2.0));
  vec3 col = tone * e * uEmber * 0.26 * fall;
  float floorGlow = exp(-(uRes.y - px.y) / 240.0) * fall;
  float slow = 0.7 + 0.3 * wave1(px.x * 0.0009 + uT * 0.05, 97.0);
  col += tone * floorGlow * uWash * 0.075 * slow;
  return col;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 col = vec3(0.0);
  if (uSong > 0.002) {
    // 灯る瞬間: 1 拍で中心から外へ光が広がる。光の先頭は強く、中心は一度だけ大きく光る
    float dist = length(px - vec2(uCx, 660.0));
    float radius = 4300.0 * uIgniteAge / uBeatSec;
    col += songPicture(px) * uSong * (1.0 - smoothstep(radius - 800.0, radius, dist));
    float fade = exp(-uIgniteAge * 2.0);
    float e = (dist - radius) / (130.0 + radius * 0.035);
    col += mix(AQUA, vec3(0.85, 1.0, 0.98), 0.45) * exp(-e * e) * 1.25 * fade;
    float core = dist / 1300.0;
    col += vec3(0.5, 0.95, 0.9) * exp(-core * core) * exp(-uIgniteAge * 7.0) * 0.9;
  }
  if (uCone + uPool > 0.002) col += spotPicture(px);
  if (uEmber + uWash > 0.002) col += quietPicture(px);
  gl_FragColor = vec4(col, 1.0);
}
`;
