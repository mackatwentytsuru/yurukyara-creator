// ゆるキャラのショーを描いて、画質の落ちない master を作る。
// 使い方: node show/led_browser/render_yuru.mjs --timeline <timeline.json> --chars-dir <キャラのフォルダ> --out <フォルダ>
//   --cast <json>    配役(既定 show/yuru_cast.json)
//   --stretch 1.48   B 面のキャラの横の伸ばし
//   --from <コマ>    途中で止まったときに、このコマから続ける(前の部分は残す)
//   --at <秒> --seconds 3   timeline の絶対の秒から決まった秒だけ描く
//   --measure-only   配置だけ決めて fit.json を書く  --reuse-fit  今ある fit.json を使う
// 出力: master.mov、character_box.json、render_stats.json、fit.json、progress.txt、parts/
// Chrome は長く動かすと落ちるので CHUNK_FRAMES コマごとに開き直す。絵はコマ番号だけで決まるので、どこからでも描き直せる。
// 新しいコマが STALL_SEC 秒進まなければ、Chrome を止めて次のコマから続ける(MAX_RESTARTS 回まで)。
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const W = 5680;
const H = 1240;
const FRAME_BYTES = W * H * 4;
const SEAM_L = 1279;
const SEAM_R = 3039;
const FACE_RANGE = { A: [0, SEAM_L], B: [SEAM_L, SEAM_R], C: [SEAM_R, 4300] };
const FACE_TOP = 85;
const FLOOR_Y = 1196; // 全部の動きの下の端を置く高さ(中央の面は y 1218 まで映る)
const MARGIN_X = 30; // 枠と面の境目の間に残す余白
const MARGIN_TOP = 12;
const MEASURE_ERROR_PX = 4; // 枠を測る絵の 1 ピクセルの分
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHROME_ARGS = (process.env.CHROME_ARGS ?? '--use-angle=d3d11 --ignore-gpu-blocklist').split(' ').filter(Boolean);
const PAGE_TIMEOUT_MS = 180000;
const MEASURE_TIMEOUT_MS = 600000;
const CHUNK_FRAMES = 500;
const STALL_SEC = 60;
const MAX_RESTARTS = 3;
const PROGRESS_SEC = 60;
const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const ALLOW = ['/show/led_browser/', '/web/src/', '/web/node_modules/three/', '/web/node_modules/@pixiv/', '/creator/'];
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`知らない引数: ${argv[i]}`);
    const key = argv[i].slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

/** パスが base の中にあるときだけ、その絶対パスを返す */
function inside(base, relative) {
  const file = normalize(join(base, relative));
  return file.startsWith(normalize(base)) ? file : null;
}

function startServer(state) {
  const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (req.method === 'POST' && path === '/frame') return receiveFrame(req, res, state);
    if (req.method === 'POST' && path === '/result') return receiveResult(req, res, state);
    try {
      if (path === '/yuru-data/timeline.json') return void res.writeHead(200, { 'content-type': TYPES['.json'] }).end(state.timelineBody);
      if (path === '/yuru-data/cast.json') return void res.writeHead(200, { 'content-type': TYPES['.json'] }).end(state.castBody);
      if (path.includes('..') || /(^|\/)\.env/.test(path)) return void res.writeHead(404).end('not allowed');
      let file = null;
      if (path.startsWith('/yuru-chars/')) file = inside(state.charsDir, path.slice('/yuru-chars/'.length));
      else if (ALLOW.some((p) => path.startsWith(p))) file = inside(ROOT, path);
      if (!file) return void res.writeHead(404).end('not allowed');
      let body = state.fileCache.get(file);
      if (!body) {
        body = await readFile(file);
        state.fileCache.set(file, body);
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

function receiveResult(req, res, state) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    res.writeHead(200).end('ok');
    state.onResult?.(JSON.parse(body));
  });
}

function receiveFrame(req, res, state) {
  const frame = Number(new URL(req.url, 'http://x').searchParams.get('f'));
  if (frame !== state.nextFrame) {
    res.writeHead(409).end(`順番が違います: ${frame} (次は ${state.nextFrame})`);
    return;
  }
  const chunks = [];
  let received = 0;
  req.on('data', (chunk) => {
    chunks.push(chunk);
    received += chunk.length;
  });
  req.on('end', () => {
    if (received !== FRAME_BYTES) {
      res.writeHead(400).end(`大きさが違います: ${received}`);
      return;
    }
    // 1 コマぶんが全部そろってから書く。途中で Chrome が落ちても、ffmpeg の入力のコマがずれない
    const info = JSON.parse(req.headers['x-box'] ?? '{}');
    state.nextFrame += 1;
    const write = () => {
      state.stats.write(`${JSON.stringify({ f: frame, boxes: info.boxes ?? {} })}\n`);
      state.done += 1;
      state.lastFrameAt = performance.now();
      res.writeHead(200).end('ok');
    };
    const all = Buffer.concat(chunks, FRAME_BYTES);
    if (state.ffmpeg.stdin.write(all)) write();
    else state.ffmpeg.stdin.once('drain', write);
  });
}

function spawnEncoder(partPath) {
  // RGB から Y'CbCr へは bt709 と明示する。FFV1 は画質が落ちない
  const args = [
    '-y', '-v', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'x2bgr10le', '-s', `${W}x${H}`, '-r', '60', '-i', 'pipe:0',
    '-vf', 'scale=in_range=pc:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format=yuv444p10le',
    '-c:v', 'ffv1', '-level', '3', '-g', '1', '-slices', '24', '-slicecrc', '0', '-coder', '1', '-context', '0',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-threads', '12', '-filter_threads', '8',
    partPath,
  ];
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  child.finished = new Promise((ok, fail) => {
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg が失敗しました(終了番号 ${code})`))));
    child.on('error', fail);
  });
  child.stdin.on('error', (e) => console.error('ffmpeg への書き込みに失敗:', e.message));
  return child;
}

const partName = (frame) => `part_${String(frame).padStart(6, '0')}.nut`;

/** 部品をつないで master.mov にする。あとの部品が始まるコマで、前の部品を切る */
function concatParts(outDir, partsDir, firstFrame, endFrame) {
  const starts = readdirSync(partsDir)
    .map((n) => /^part_(\d+)\.nut$/.exec(n))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .filter((s) => s >= firstFrame && s < endFrame)
    .sort((a, b) => a - b);
  const lines = [];
  starts.forEach((start, i) => {
    const stop = starts[i + 1] ?? endFrame;
    lines.push(`file '${join(partsDir, partName(start)).replaceAll('\\', '/')}'`);
    lines.push(`outpoint ${((stop - start) / 60).toFixed(6)}`);
  });
  const list = join(partsDir, 'list.txt');
  writeFileSync(list, `${lines.join('\n')}\n`);
  const master = join(outDir, 'master.mov');
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-map_metadata', '-1', '-video_track_timescale', '60000', master], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('部品をつなげませんでした');
  return master;
}

/**
 * 下調べの枠から配置を決める。絵の上の高さをそろえるので、大きさは全員で 1 つ。
 * 面ごとに幅を分け、いちばん狭い所と上下の余りで決まる。
 */
function computeFit(measured, cast, stretch) {
  const groups = {};
  cast.characters.forEach((c, i) => {
    (groups[c.face] ??= []).push(i);
  });
  const slots = {};
  for (const [face, list] of Object.entries(groups)) {
    const [a, b] = FACE_RANGE[face];
    // 幅は、踊りの枠の広さに比べて分ける(耳の広いキャラに広い場所を)
    const widths = list.map((index) => measured.boxes[index][2] - measured.boxes[index][0]);
    const sum = widths.reduce((p, c) => p + c, 0);
    let left = a;
    list.forEach((index, n) => {
      const width = ((b - a) * widths[n]) / sum;
      slots[index] = { left: left + MARGIN_X, right: left + width - MARGIN_X };
      left += width;
    });
  }
  let scale = Infinity;
  let limitedBy = '';
  measured.boxes.forEach(([x0, y0, x1, y1], i) => {
    const s = cast.characters[i].face === 'B' ? stretch : 1;
    const byWidth = (slots[i].right - slots[i].left - 2 * MEASURE_ERROR_PX) / ((x1 - x0) * s);
    const byHeight = (FLOOR_Y - FACE_TOP - MARGIN_TOP - MEASURE_ERROR_PX) / (y1 - y0);
    if (byWidth < scale) {
      scale = byWidth;
      limitedBy = `${cast.characters[i].id} の幅`;
    }
    if (byHeight < scale) {
      scale = byHeight;
      limitedBy = `${cast.characters[i].id} の高さ`;
    }
  });
  const characters = measured.boxes.map(([x0, , x1, y1], i) => {
    const s = cast.characters[i].face === 'B' ? stretch : 1;
    const mid = (slots[i].left + slots[i].right) / 2;
    return { id: cast.characters[i].id, face: cast.characters[i].face, scale, cx: mid - scale * s * ((x0 + x1) / 2 - measured.refCenterX), floorY: FLOOR_Y, refBottomY: y1, slot: slots[i], measuredBox: [x0, measured.boxes[i][1], x1, y1] };
  });
  return { scale, limitedBy, heightPx: scale * measured.refHeight, stretch, characters };
}

function resolveRange(args, timeline) {
  if (args.at !== undefined) {
    const a = Math.round(Number(args.at) * timeline.fps);
    return { first: a, end: Math.min(timeline.frames, a + Math.round(Number(args.seconds ?? 3) * timeline.fps)) };
  }
  return { first: 0, end: timeline.frames };
}

function writeCharacterBox(outDir, statsPath, meta) {
  const byFrame = new Map();
  for (const line of readFileSync(statsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      byFrame.set(row.f, row);
    } catch {
      // 途中で止まったときの、最後の切れた行は捨てる
    }
  }
  const frames = [...byFrame.values()].sort((p, r) => p.f - r.f).map((row) => ({ frame: row.f, boxes: row.boxes }));
  writeFileSync(join(outDir, 'character_box.json'), JSON.stringify({ ...meta, frames }));
  return frames.length;
}

/**
 * ヘッドレスの Chrome を開いて、ページの仕事が終わるまで待つ。
 * 自動操作の道具(CDP)をつながない(送信が遅くなる)。止めるのは自分で起動した PID だけ。
 */
function runPage(state, baseUrl, query, onInfo, stallSec = null, doneTimeoutMs = null) {
  const profile = mkdtempSync(join(tmpdir(), 'yuru_chrome_'));
  const url = `${baseUrl}/show/led_browser/yuru_page.html?${new URLSearchParams(query)}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-timer-throttling', '--window-size=1280,400', `--user-data-dir=${profile}`, ...CHROME_ARGS, url], { stdio: 'ignore' });
  const close = () => {
    spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // 一時フォルダが残っても、絵には関係ない
    }
  };
  let timer = null;
  let watch = null;
  let doneTimer = null;
  return new Promise((ok, fail) => {
    timer = setTimeout(() => fail(new Error('ページが準備できません(時間切れ)')), PAGE_TIMEOUT_MS);
    state.onResult = (message) => {
      if (message.kind === 'error') fail(new Error(`ページの失敗: ${message.text}`));
      else if (message.kind === 'info') {
        clearTimeout(timer);
        if (/swiftshader|llvmpipe|basic render/i.test(message.info.gpuName)) fail(new Error(`GPU が使えていません: ${message.info.gpuName}`));
        onInfo?.(message.info);
        state.lastFrameAt = performance.now();
        if (doneTimeoutMs) doneTimer = setTimeout(() => fail(new Error('下調べが時間切れ')), doneTimeoutMs);
        if (stallSec) {
          watch = setInterval(() => {
            if ((performance.now() - state.lastFrameAt) / 1000 > stallSec) fail(new Error(`新しいコマが ${stallSec} 秒来ません(次は ${state.nextFrame})`));
          }, 2000);
        }
      } else if (message.kind === 'done') ok(message);
    };
  }).finally(() => {
    clearTimeout(timer);
    clearTimeout(doneTimer);
    clearInterval(watch);
    state.onResult = null;
    close();
  });
}

function startProgressLog(outDir, state, firstRendered) {
  const path = join(outDir, 'progress.txt');
  const writeLine = () => {
    const sec = (performance.now() - state.startedAt) / 1000;
    const perFrame = state.done ? sec / state.done : 0;
    const line = `${new Date().toISOString()} 次のコマ ${state.nextFrame}/${state.endFrame} 経過 ${sec.toFixed(0)} 秒 1 コマ ${perFrame.toFixed(3)} 秒 開き直し ${state.chunks} 回 見張りでの再開 ${state.restarts} 回\n`;
    writeFileSync(path, line, { flag: 'a' });
    console.log(line.trim());
  };
  writeFileSync(path, `始まり ${new Date().toISOString()} コマ ${firstRendered} から\n`);
  const timer = setInterval(writeLine, PROGRESS_SEC * 1000);
  return () => {
    clearInterval(timer);
    writeLine();
  };
}

async function renderAll(state, baseUrl, query, end) {
  const totals = { pose: 0, draw: 0, box: 0, send: 0 };
  let info = null;
  while (state.nextFrame < end) {
    const a = state.nextFrame;
    const b = Math.min(end, a + CHUNK_FRAMES);
    try {
      const result = await runPage(state, baseUrl, { ...query, run: 'render', from: a, to: b }, (i) => {
        info = i;
      }, STALL_SEC);
      for (const key of Object.keys(totals)) totals[key] += result.ms[key];
      state.chunks += 1;
    } catch (e) {
      state.restarts += 1;
      console.error(`止まったので続きから描きます(${state.restarts}/${MAX_RESTARTS}): ${e.message}`);
      if (state.restarts > MAX_RESTARTS) throw e;
    }
  }
  return { totals, info };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const need of ['timeline', 'out', 'chars-dir']) if (!args[need]) throw new Error(`--${need} を指定してください`);
  const stretch = Number(args.stretch ?? 1.48);
  const outDir = resolve(args.out);
  const partsDir = join(outDir, 'parts');
  mkdirSync(partsDir, { recursive: true });
  const timelineBody = readFileSync(args.timeline, 'utf8');
  const timeline = JSON.parse(timelineBody);
  const castBody = readFileSync(args.cast ?? join(ROOT, 'show/yuru_cast.json'), 'utf8');
  const cast = JSON.parse(castBody);
  const { first, end } = resolveRange(args, timeline);
  const resume = args.from !== undefined;
  const from = resume ? Number(args.from) : first;
  if (from < first || from >= end) throw new Error(`--from ${from} が範囲 ${first}〜${end} の外です`);
  const statsPath = join(outDir, 'frame_box.jsonl');
  if (!resume) {
    rmSync(partsDir, { recursive: true, force: true });
    mkdirSync(partsDir, { recursive: true });
    rmSync(statsPath, { force: true });
  }

  const state = { fileCache: new Map(), timelineBody, castBody, charsDir: resolve(args['chars-dir']), nextFrame: from, endFrame: end, done: 0, startedAt: 0, lastFrameAt: 0, chunks: 0, restarts: 0, ffmpeg: null, stats: null };
  const server = await startServer(state);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const base = { stretch };
    const fitPath = join(outDir, 'fit.json');
    let fit;
    const t0 = performance.now();
    if ((resume || args['reuse-fit']) && existsSync(fitPath)) {
      fit = JSON.parse(readFileSync(fitPath, 'utf8'));
    } else {
      const result = await runPage(state, baseUrl, { ...base, run: 'measure' }, (info) => console.log('GPU:', info.gpuName, 'キャラ:', JSON.stringify(info.cast)), null, MEASURE_TIMEOUT_MS);
      fit = computeFit(result.measured, cast, stretch);
      writeFileSync(fitPath, JSON.stringify(fit, null, 1));
    }
    const measureSec = (performance.now() - t0) / 1000;
    console.log(`大きさ ${fit.scale.toFixed(4)}(高さ ${fit.heightPx.toFixed(0)} px、${fit.limitedBy} で決まった)、下調べ ${measureSec.toFixed(1)} 秒`);
    if (args['measure-only']) return;

    state.ffmpeg = spawnEncoder(join(partsDir, partName(from)));
    state.stats = createWriteStream(statsPath, { flags: 'a' });
    state.startedAt = performance.now();
    const stopProgress = startProgressLog(outDir, state, from);
    const query = { ...base, fit: JSON.stringify(fit) };
    const { totals: ms, info } = await renderAll(state, baseUrl, query, end).finally(stopProgress);
    const wall = (performance.now() - state.startedAt) / 1000;
    state.ffmpeg.stdin.end();
    await state.ffmpeg.finished;
    await new Promise((ok) => state.stats.end(ok));

    const master = concatParts(outDir, partsDir, first, end);
    const boxFrames = writeCharacterBox(outDir, statsPath, { canvas: [W, H], fps: timeline.fps, stretch, seams: [SEAM_L, SEAM_R], first_frame: first, end_frame: end, scale: fit.scale, cast: cast.characters.map((c) => ({ id: c.id, face: c.face })), note: 'boxes はキャラの順番 → [x0,y0,x1,y1](B 面のキャラは伸ばした後の絵の座標)。枠は 1/4 の絵で測るので誤差 4 px' });
    const frames = end - from;
    const stats = { timeline_sha256: createHash('sha256').update(timelineBody).digest('hex'), gpu: info?.gpuName, chunks: state.chunks, restarts: state.restarts, from, end, frames_rendered: frames, wall_sec: wall, sec_per_frame: wall / frames, measure_sec: measureSec, page_ms_per_frame: Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, v / frames])), fit };
    writeFileSync(join(outDir, 'render_stats.json'), JSON.stringify(stats, null, 1));
    console.log(`できた: ${master} ${frames} コマ、${wall.toFixed(1)} 秒、1 コマ ${(wall / frames).toFixed(3)} 秒。枠 ${boxFrames} コマ分`);
    console.log('内訳(ミリ秒/コマ):', JSON.stringify(stats.page_ms_per_frame));
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

main().catch((e) => {
  console.error('失敗:', e.stack ?? e);
  process.exit(1);
});
