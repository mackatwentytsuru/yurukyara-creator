// 仕上げの 1 回。線形の絵を表示の階調(sRGB)へ変え、10bit の枠へ描いて読み出す。
// 8bit だと暗い面に段が出るので、10bit(ffmpeg の x2bgr10le と同じ並び)で読む。three の外の素の WebGL2 で書く。

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uSize;
uniform float uMaster, uFlip, uFrame;
uniform int uCount;
uniform vec3 uDigitBox; // 数字の中心の x・y と高さ
uniform int uFrameNumber; // 同期の区間に出すコマ番号。無いときは -1
uniform vec4 uNumberBox; // コマ番号の中心の x・y、高さ、横の伸ばし
uniform float uFlash; // 同期のフラッシュの明るさ。無いときは 0
out vec4 outColor;

const float SHOULDER = 0.72;
const float PEAK = 0.97; // 真っ白まで上げない
const float STROKE = 0.08;

vec3 softLimit(vec3 c) {
  vec3 over = max(c - SHOULDER, 0.0);
  vec3 room = vec3(PEAK - SHOULDER);
  return min(c, vec3(SHOULDER)) + room * (1.0 - exp(-over / room));
}
vec3 encode(vec3 c) {
  vec3 low = c * 12.92;
  vec3 high = 1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), c));
}
float bar(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - a - ab * t) - STROKE;
}
// 7 本の線の数字。p の範囲は横 -0.5〜0.5、縦 -1〜1(上が正)
float digit(vec2 p, int n) {
  const int LIT[10] = int[10](0x77, 0x24, 0x5D, 0x6D, 0x2E, 0x6B, 0x7B, 0x25, 0x7F, 0x6F);
  const float X = 0.45, Y = 0.9;
  int m = LIT[n];
  float best = 1e3;
  if ((m & 1) != 0) best = min(best, bar(p, vec2(-X, Y), vec2(X, Y)));
  if ((m & 2) != 0) best = min(best, bar(p, vec2(-X, Y), vec2(-X, 0.0)));
  if ((m & 4) != 0) best = min(best, bar(p, vec2(X, Y), vec2(X, 0.0)));
  if ((m & 8) != 0) best = min(best, bar(p, vec2(-X, 0.0), vec2(X, 0.0)));
  if ((m & 16) != 0) best = min(best, bar(p, vec2(-X, 0.0), vec2(-X, -Y)));
  if ((m & 32) != 0) best = min(best, bar(p, vec2(X, 0.0), vec2(X, -Y)));
  if ((m & 64) != 0) best = min(best, bar(p, vec2(-X, -Y), vec2(X, -Y)));
  return best;
}
float number(vec2 px) {
  if (uCount <= 0) return 0.0;
  float unit = uDigitBox.z * 0.5;
  vec2 p = (px - uDigitBox.xy) / unit;
  p.y = -p.y;
  int tens = uCount / 10, ones = uCount % 10;
  float d = tens > 0 ? min(digit(p + vec2(0.75, 0.0), tens), digit(p - vec2(0.75, 0.0), ones)) : digit(p, ones);
  return 1.0 - smoothstep(0.0, 2.0 / unit, d);
}
const float NUMBER_GRAY = 0.5;
// コマ番号。4 桁の幅を固定して、数字が左右に動かないようにする
float frameNumber(vec2 px) {
  if (uFrameNumber < 0) return 0.0;
  float unit = uNumberBox.z * 0.5;
  vec2 p = (px - uNumberBox.xy) / unit;
  p.x /= uNumberBox.w;
  p.y = -p.y;
  float d = 1e3;
  int rest = uFrameNumber;
  for (int i = 0; i < 4; i++) {
    d = min(d, digit(p - vec2(1.5 * (1.5 - float(i)), 0.0), rest % 10));
    rest /= 10;
  }
  return 1.0 - smoothstep(0.0, 2.0 / unit, d);
}
float ditherNoise(vec2 p, float f) {
  return fract(52.9829189 * fract(dot(p + 5.588238 * mod(f, 64.0), vec2(0.06711056, 0.00583715))));
}
void main() {
  // uFlip=1 で上下を返す。読み出しの行の順が、そのまま絵の上から下になる
  vec2 fc = gl_FragCoord.xy;
  vec2 px = vec2(fc.x, uFlip > 0.5 ? fc.y : uSize.y - fc.y);
  vec2 uv = vec2(px.x, uSize.y - px.y) / uSize;
  vec3 c = texture(uSource, uv).rgb * uMaster;
  vec3 e = encode(softLimit(max(c, vec3(0.0))));
  e += (ditherNoise(fc, uFrame) - 0.5) / 1023.0 * step(1e-4, max(e.r, max(e.g, e.b)));
  e = mix(e, vec3(0.13), number(px));
  e = mix(e, vec3(NUMBER_GRAY), frameNumber(px));
  e = max(e, vec3(uFlash));
  outColor = vec4(e, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

export class TenBitOutput {
  constructor(gl, width, height) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.pixels = new Uint32Array(width * height);
    this.program = gl.createProgram();
    gl.attachShader(this.program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(this.program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    this.vao = gl.createVertexArray();
    this.target = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.target);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB10_A2, width, height);
    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`10bit の枠を作れません: ${status}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.uniforms = {};
    for (const name of ['uSource', 'uSize', 'uMaster', 'uFlip', 'uFrame', 'uCount', 'uDigitBox', 'uFrameNumber', 'uNumberBox', 'uFlash']) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
  }

  _draw(source, params, flip) {
    const { gl, uniforms: u } = this;
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(u.uSource, 0);
    gl.uniform2f(u.uSize, this.width, this.height);
    gl.uniform1f(u.uMaster, params.master);
    gl.uniform1f(u.uFlip, flip);
    gl.uniform1f(u.uFrame, params.frame);
    gl.uniform1i(u.uCount, params.count);
    gl.uniform3f(u.uDigitBox, params.digit[0], params.digit[1], params.digit[2]);
    gl.uniform1i(u.uFrameNumber, params.frameNumber);
    gl.uniform4f(u.uNumberBox, params.numberBox[0], params.numberBox[1], params.numberBox[2], params.numberBox[3]);
    gl.uniform1f(u.uFlash, params.flash);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** 1 コマを 10bit で描いて読む。返すのは x2bgr10le の並びの配列(行は上から下) */
  renderAndRead(source, params) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    this._draw(source, params, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_INT_2_10_10_10_REV, this.pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.pixels;
  }

  /** 画面の canvas に出す(目で見る確かめのときだけ) */
  renderToCanvas(source, params) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this._draw(source, params, 0);
  }
}
