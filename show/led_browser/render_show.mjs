// ショーの全編を描いて、画質の落ちない master を作る。
// 使い方: node show/led_browser/render_show.mjs --timeline <timeline.json> --character f_led --stretch 1.48 --out <フォルダ>
//   --cx 2159        キャラの中心
//   --from <コマ>    途中で止まったときに、このコマから続ける(前の部分は残す)
//   --sync-only      preroll の同期の区間(2 秒)だけを描く試し
//   --mouth-gain <値>  VRM の口の強さを台本の値の代わりに使う  --no-dance  踊りの部品を使わない
//   --raw-expressions  台本の表情を読みかえずに VRM へ渡す
//   --dance-track <頭>   既存の動きを並べた 1 本(assemble_track.py の <頭>.bin / <頭>.json)で踊らせる
//   --no-zoom        サビで寄らない(足のステップも見せる踊りのとき)
//   --no-character   キャラだけ描かない版(同じコマ数・同じ背景)
//   --character-file <.vrm のパス>   リポジトリの外の .vrm を、キャラとして描く(既定の動きは変わらない)
//   --at <秒> --seconds 3   timeline の絶対の秒から決まった秒だけ描く(--section より優先)
//   --section song --seconds 3   そのセクションの頭から決まった秒だけ描く(--loud を付けると一番盛り上がる所から)
// 出力: master.mov、character_box.json、render_stats.json、fit.json、progress.txt(1 分ごとの進み)、parts/(途中の部品)
// Chrome の描くプロセスは長く動かすと落ちるので、CHUNK_FRAMES コマごとに開き直す。
// 新しいコマが STALL_SEC 秒進まなければ、Chrome を止めて次のコマから続ける(MAX_RESTARTS 回まで)。
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { ShowTiming } from './show_timing.mjs';

const W = 5680;
const H = 1240;
const FRAME_BYTES = W * H * 4;
const SEAM_L = 1279;
const SEAM_R = 3039;
const FACE_TOP = 85;
const FACE_BOTTOM = 1218;
const FLOOR_LIMIT = 1205; // 全部の動きの下の端を置く高さ(中央の面は y 1218 まで映る)
const MARGIN_X = 24; // 枠と面の境目の間に残す余白
const MARGIN_TOP = 12;
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHROME_ARGS = (process.env.CHROME_ARGS ?? '--use-angle=d3d11 --ignore-gpu-blocklist').split(' ').filter(Boolean);
const PAGE_TIMEOUT_MS = 180000;
const CHUNK_FRAMES = 500; // 実測で 929 コマ目に落ちたので、十分手前で開き直す
const STALL_SEC = 60;
const MAX_RESTARTS = 3;
const PROGRESS_SEC = 60;
const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const ALLOW = ['/show/led_browser/', '/show/show_motion.json', '/web/src/', '/web/node_modules/three/', '/web/node_modules/@pixiv/', '/creator/', '/characters/'];
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

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

function startServer(state) {
  const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (req.method === 'POST' && path === '/frame') return receiveFrame(req, res, state);
    if (req.method === 'POST' && path === '/result') return receiveResult(req, res, state);
    try {
      if (path === '/show-data/timeline.json') {
        res.writeHead(200, { 'content-type': TYPES['.json'] }).end(state.timelineBody);
        return;
      }
      if (path === '/show-data/character.vrm' && state.characterFile) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' }).end(await readFile(state.characterFile));
        return;
      }
      if (state.danceTrack && path.startsWith('/show-data/dance_track')) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' }).end(await readFile(state.danceTrack + path.slice('/show-data/dance_track'.length)));
        return;
      }
      if (!ALLOW.some((p) => path.startsWith(p)) || path.includes('..') || /(^|\/)\.env/.test(path)) {
        res.writeHead(404).end('not allowed');
        return;
      }
      const file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT)) {
        res.writeHead(404).end();
        return;
      }
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

/** ページからの知らせ(準備ができた・結果・失敗)を受ける */
function receiveResult(req, res, state) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    res.writeHead(200).end('ok');
    const message = JSON.parse(body);
    if (message.kind === 'log') console.log('[page]', message.text);
    else state.onResult?.(message);
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
    info.zoom = info.zoom ?? 0;
    state.nextFrame += 1;
    const write = () => {
      state.stats.write(`${JSON.stringify({ f: frame, box: info.box ?? null, foot: info.foot ?? null, zoom: info.zoom })}\n`);
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
  // RGB から Y'CbCr へは bt709 と明示する(指定しないと bt601 になる)。FFV1 は画質が落ちない
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

function partName(frame) {
  return `part_${String(frame).padStart(6, '0')}.nut`;
}

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
 * 下調べの枠から、中央の面に収まる大きさと、全身と寄りのときの位置を決める。
 * anchorRefY(下調べの絵の頭の高さ)が、全身では anchorFull、寄りでは anchorZoom に来る。
 */
function computeFit(measured, stretch, cx, zoomConfig) {
  const [x0, y0, x1, y1] = measured.box;
  const center = measured.refCenterX;
  const limitLeft = cx - SEAM_L - MARGIN_X;
  const limitRight = SEAM_R - MARGIN_X - cx;
  const scaleX = Math.min(limitLeft / (center - x0), limitRight / (x1 - center)) / stretch;
  const scaleY = (FLOOR_LIMIT - FACE_TOP - MARGIN_TOP) / (y1 - y0);
  const scale = Math.min(scaleX, scaleY);
  const anchorFull = FLOOR_LIMIT - scale * (y1 - y0);
  const fit = { scale, zoom: 1, anchorRefY: y0, anchorFull, anchorZoom: anchorFull, limitedBy: scaleX < scaleY ? 'width' : 'height', measuredBox: measured.box, stretch, cx };
  if (!measured.zoomedBox || !measured.thighRefY || !zoomConfig) return fit;
  const [zx0, zy0, zx1] = measured.zoomedBox;
  const zoomByWidth = Math.min(limitLeft / (center - zx0), limitRight / (zx1 - center)) / stretch / scale;
  let anchorZoom = zoomConfig.top_y;
  let zoom = 1;
  for (let i = 0; i < 3; i++) {
    const zoomByThigh = (FACE_BOTTOM - anchorZoom) / (scale * (measured.thighRefY - y0));
    zoom = Math.max(1, Math.min(zoomByThigh, zoomByWidth));
    // 寄りの間に頭が上の端を越えないように、跳ねる分だけ頭の位置を下げる
    anchorZoom = Math.max(zoomConfig.top_y, FACE_TOP + MARGIN_TOP + scale * zoom * (y0 - zy0));
  }
  return { ...fit, zoom, anchorZoom, zoomedBox: measured.zoomedBox, thighRefY: measured.thighRefY, zoomLimitedBy: zoom >= zoomByWidth - 1e-6 ? 'width' : 'thigh' };
}

/** 背景の絵を決める物の指紋。同じならキャラなしの版を描き直さなくてよい */
function backgroundFingerprint(timelineBody) {
  const hash = createHash('sha256').update(timelineBody);
  for (const name of ['show_background.mjs', 'show_output.mjs', 'show_timing.mjs']) hash.update(readFileSync(join(ROOT, 'show/led_browser', name)));
  hash.update(JSON.stringify(JSON.parse(readFileSync(join(ROOT, 'show/show_motion.json'), 'utf8')).song_structure ?? null));
  return hash.digest('hex');
}

function resolveRange(args, timeline, timing) {
  let a = 0;
  let b = timeline.frames;
  if (args.at !== undefined) {
    a = Math.round(Number(args.at) * timeline.fps);
    b = Math.min(b, a + Math.round(Number(args.seconds ?? 3) * timeline.fps));
  } else if (args['sync-only']) {
    const fps = timeline.fps;
    const head = timing.section('sync_head');
    a = Math.round(head.start * fps) + fps - 10;
    b = a + 2 * fps;
  } else if (args.section) {
    const s = timing.section(args.section);
    if (!s) throw new Error(`section がありません: ${args.section}`);
    a = Math.round(s.start * timeline.fps);
    b = Math.round(s.end * timeline.fps);
    if (args.loud) {
      for (let f = a; f < b; f++) {
        if (timing.driveCurve[f] >= 0.7) {
          a = f;
          break;
        }
      }
    }
    if (args.seconds) b = Math.min(b, a + Math.round(Number(args.seconds) * timeline.fps));
  }
  return { first: a, end: b };
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
  const frames = [...byFrame.values()]
    .sort((p, r) => p.f - r.f)
    .map((row) => ({
      frame: row.f,
      box: row.box,
      center: row.box ? [(row.box[0] + row.box[2]) / 2, (row.box[1] + row.box[3]) / 2] : null,
      foot: row.foot,
      zoom: row.zoom ?? 0,
    }));
  writeFileSync(join(outDir, 'character_box.json'), JSON.stringify({ ...meta, frames }));
  return frames.length;
}

/**
 * ヘッドレスの Chrome を開いて、ページの仕事が終わるまで待つ。
 * 自動操作の道具(CDP)をつながない。つなぐと 28MB の送信が 1 コマ 0.86 秒かかる(なければ 0.15 秒)。
 * stallSec を渡すと、新しいコマが来ない間を見張り、超えたら失敗にする。止めるのは自分で起動した PID だけ。
 */
function runPage(state, baseUrl, query, onInfo, stallSec = null) {
  const profile = mkdtempSync(join(tmpdir(), 'show_chrome_'));
  const url = `${baseUrl}/show/led_browser/show_page.html?${new URLSearchParams(query)}`;
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
  return new Promise((ok, fail) => {
    timer = setTimeout(() => fail(new Error('ページが準備できません(時間切れ)')), PAGE_TIMEOUT_MS);
    state.onResult = (message) => {
      if (message.kind === 'error') fail(new Error(`ページの失敗: ${message.text}`));
      else if (message.kind === 'info') {
        clearTimeout(timer);
        if (/swiftshader|llvmpipe|basic render/i.test(message.info.gpuName)) fail(new Error(`GPU が使えていません: ${message.info.gpuName}`));
        onInfo?.(message.info);
        state.lastFrameAt = performance.now();
        if (stallSec) {
          watch = setInterval(() => {
            if ((performance.now() - state.lastFrameAt) / 1000 > stallSec) fail(new Error(`新しいコマが ${stallSec} 秒来ません(次は ${state.nextFrame})`));
          }, 2000);
        }
      } else if (message.kind === 'done') ok(message);
    };
  }).finally(() => {
    clearTimeout(timer);
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
    const line = `${new Date().toISOString()} 次のコマ ${state.nextFrame}/${state.endFrame} 経過 ${sec.toFixed(0)} 秒 1 コマ ${perFrame.toFixed(3)} 秒 残り約 ${((state.endFrame - state.nextFrame) * perFrame).toFixed(0)} 秒 開き直し ${state.chunks} 回 見張りでの再開 ${state.restarts} 回\n`;
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

/** Chrome を CHUNK_FRAMES コマごとに開き直しながら全部描く。止まったら次のコマから続ける */
async function renderAll(state, baseUrl, query, from, end) {
  const totals = { sim: 0, draw: 0, box: 0, send: 0 };
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
  if (args['print-background-fingerprint']) {
    console.log(backgroundFingerprint(readFileSync(args.timeline, 'utf8')));
    return;
  }
  for (const need of ['timeline', 'out']) if (!args[need]) throw new Error(`--${need} を指定してください`);
  const stretch = Number(args.stretch ?? 1.48);
  const cx = Number(args.cx ?? 2159);
  const characterFile = args['character-file'] ? resolve(args['character-file']) : null;
  if (characterFile && !existsSync(characterFile)) throw new Error(`--character-file がありません: ${characterFile}`);
  const character = characterFile ? '/show-data/character.vrm' : (args.character ?? 'f_led');
  const outDir = resolve(args.out);
  const partsDir = join(outDir, 'parts');
  mkdirSync(partsDir, { recursive: true });
  const timelineBody = readFileSync(args.timeline, 'utf8');
  const timeline = JSON.parse(timelineBody);
  const motion = JSON.parse(readFileSync(join(ROOT, 'show/show_motion.json'), 'utf8'));
  const timing = new ShowTiming(timeline, motion);
  const { first, end } = resolveRange(args, timeline, timing);
  const resume = args.from !== undefined;
  const from = resume ? Number(args.from) : first;
  if (from < first || from >= end) throw new Error(`--from ${from} が範囲 ${first}〜${end} の外です`);
  const statsPath = join(outDir, 'frame_box.jsonl');
  if (!resume) {
    rmSync(partsDir, { recursive: true, force: true });
    mkdirSync(partsDir, { recursive: true });
    rmSync(statsPath, { force: true });
  }

  const state = { fileCache: new Map(), timelineBody, nextFrame: from, endFrame: end, done: 0, startedAt: 0, lastFrameAt: 0, chunks: 0, restarts: 0, ffmpeg: null, stats: null, characterFile, danceTrack: args['dance-track'] ? resolve(args['dance-track']) : null };
  const server = await startServer(state);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const base = { character, stretch, cx, ...(args['dance-track'] ? { dancetrack: 1 } : {}), ...(args['no-zoom'] ? { nozoom: 1 } : {}) };
    const fitPath = join(outDir, 'fit.json');
    let fit;
    const t0 = performance.now();
    if (resume && existsSync(fitPath)) {
      fit = JSON.parse(readFileSync(fitPath, 'utf8'));
    } else {
      const result = await runPage(state, baseUrl, { ...base, measure: 1, run: 'measure' }, (info) => console.log('GPU:', info.gpuName, '動き:', (info.motions ?? []).join(','), '踊り:', info.dance));
      fit = computeFit(result.measured, stretch, cx, args['no-zoom'] ? null : motion.vrm?.zoom);
      writeFileSync(fitPath, JSON.stringify(fit, null, 1));
    }
    const measureSec = (performance.now() - t0) / 1000;
    console.log(`大きさ ${fit.scale.toFixed(4)}(${fit.limitedBy} で決まった)、下調べ ${measureSec.toFixed(1)} 秒`);

    state.ffmpeg = spawnEncoder(join(partsDir, partName(from)));
    state.stats = createWriteStream(statsPath, { flags: 'a' });
    state.startedAt = performance.now();
    const stopProgress = startProgressLog(outDir, state, from);
    const query = { ...base, fit: JSON.stringify(fit), ...(args['mouth-gain'] ? { mouthgain: args['mouth-gain'] } : {}), ...(args['no-dance'] ? { nodance: 1 } : {}), ...(args['raw-expressions'] ? { rawexpr: 1 } : {}), nocharacter: args['no-character'] ? 1 : 0 };
    const { totals: ms, info } = await renderAll(state, baseUrl, query, from, end).finally(stopProgress);
    const wall = (performance.now() - state.startedAt) / 1000;
    state.ffmpeg.stdin.end();
    await state.ffmpeg.finished;
    await new Promise((ok) => state.stats.end(ok));

    const master = concatParts(outDir, partsDir, first, end);
    const boxFrames = writeCharacterBox(outDir, statsPath, { canvas: [W, H], fps: timeline.fps, stretch, cx, character, seams: [SEAM_L, SEAM_R], first_frame: first, end_frame: end, scale: fit.scale, zoom_max: fit.zoom, no_character: Boolean(args['no-character']), note: 'box=[x0,y0,x1,y1] は stretch で伸ばした後の絵の座標。foot はキャラの原点(足元)の位置。キャラがいないコマは null' });
    const frames = end - from;
    const stats = { background_sha256: backgroundFingerprint(timelineBody), timeline_sha256: createHash('sha256').update(timelineBody).digest('hex'), gpu: info?.gpuName, chunks: state.chunks, restarts: state.restarts, from, end, frames_rendered: frames, wall_sec: wall, sec_per_frame: wall / frames, measure_sec: measureSec, page_ms_per_frame: Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, v / frames])), fit };
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
