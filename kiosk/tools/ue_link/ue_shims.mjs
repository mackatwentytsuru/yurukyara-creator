// UE の声の中継(voice-lab)の「頭」と「声」の席に座る、小さな代役 2 つ(手元だけ・127.0.0.1)。
//   頭(OpenAI 互換。中継の brain.provider=local の url): 中継が送る会話の最後の発話を、会話側のサーバー(web/ の /api/chat、interview: true)へ渡し、
//     返事の文字(店の記憶・インタビューの型つき)を、そのまま流して返す。→ UE の頭脳は、会話側と同じ物になる。
//   声(VOICEVOX 互換。中継の tts.provider=voicevox の url): 文を Windows の日本語の声(System.Speech)で 24 kHz の WAV にして返す。
//     音はファイルに書くだけで鳴らさない。UE は -NoSound で起動し、口の動きだけをこの音から作る。
//   node kiosk/tools/ue_link/ue_shims.mjs --chat http://127.0.0.1:8811 [--brain-port 8096] [--voice-port 50032] [--log turns.jsonl]
// 記録(--log): 1 往復 1 行(質問・返事・各 ms)。音声・鍵は書かない。
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const CHAT = args.chat ?? 'http://127.0.0.1:8787';
const BRAIN_PORT = Number(args['brain-port'] ?? 8096);
const VOICE_PORT = Number(args['voice-port'] ?? 50032);
const LOG = args.log ?? '';
const CHARACTER = args.character ?? '見本のキャラ';

const log = (o) => { if (LOG) appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n'); };
const readBody = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => p?.text ?? '').join('') : '');

/** 中継の messages → 会話側の { text, history }。system と道具の行は渡さない(人格・記憶は会話側が持つ) */
export function toChatBody(messages) {
  const turns = (messages ?? []).filter((m) => m && (m.role === 'user' || m.role === 'assistant')).map((m) => ({ role: m.role, content: textOf(m.content).trim() })).filter((m) => m.content);
  let i = turns.length - 1;
  while (i >= 0 && turns[i].role !== 'user') i--;
  if (i < 0) return null;
  return { text: turns[i].content, history: turns.slice(0, i).slice(-12), interview: true, character: { name: CHARACTER } };
}

async function askChat(body) {
  const t0 = Date.now();
  const r = await fetch(CHAT + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const raw = await r.text();
  const says = [];
  let firstMs = null, usage = null, error = null;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const ev = JSON.parse(line.slice(6));
      if (ev.type === 'say' && ev.text) { says.push(ev.text); firstMs ??= ev.serverMs; }
      if (ev.type === 'meta' && ev.usage) usage = ev.usage;
      if (ev.type === 'error') error = ev.message;
    } catch { /* 行の途中 */ }
  }
  return { says, firstMs, totalMs: Date.now() - t0, usage, error };
}

const sse = (res, obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

const brain = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname.endsWith('/models'))) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', data: [{ id: 'chat-bridge' }] }));
  }
  if (req.method !== 'POST' || !/\/chat\/completions$/.test(url.pathname)) { res.statusCode = 404; return res.end('{}'); }
  let body = null;
  try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch { /* */ }
  const chatBody = toChatBody(body?.messages);
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
  const chunk = (delta, finish = null) => ({ id: 'chatcmpl-bridge', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] });
  let reply = '';
  if (chatBody) {
    try {
      const out = await askChat(chatBody);
      reply = out.says.join('');
      log({ kind: 'turn', question: chatBody.text, reply, says: out.says, chatFirstSayMs: out.firstMs, chatTotalMs: out.totalMs, usage: out.usage, error: out.error });
      if (out.error) console.error('[brain] chat error:', out.error);
    } catch (e) {
      console.error('[brain] chat failed:', e.message);
      log({ kind: 'turn', question: chatBody.text, error: e.message });
    }
  }
  if (!reply) reply = 'ごめんね、もう一回言ってくれる？';
  for (const s of reply.match(/[^。！？!?]+[。！？!?]?/g) ?? [reply]) sse(res, chunk({ content: s }));
  sse(res, chunk({}, 'stop'));
  sse(res, { id: 'chatcmpl-bridge', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  res.write('data: [DONE]\n\n');
  res.end();
});

/** 文 → 24 kHz mono 16 bit の WAV(Windows の日本語の声)。鳴らさない */
export function harukaWav(text) {
  return new Promise((ok, fail) => {
    const dir = mkdtempSync(join(tmpdir(), 'haruka-'));
    const tf = join(dir, 't.txt'), wf = join(dir, 'o.wav');
    writeFileSync(tf, text, 'utf8');
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'haruka_wav.ps1'), '-TextFile', tf, '-Out', wf], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      try {
        if (code !== 0) throw new Error('haruka exit ' + code + ' ' + err.slice(0, 200));
        ok(readFileSync(wf));
      } catch (e) { fail(e); } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  });
}

const voice = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const body = await readBody(req);
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
  if (req.method === 'GET' && url.pathname === '/version') return json(200, '0.0.0-haruka');
  if (req.method === 'GET' && url.pathname === '/speakers') return json(200, [{ name: 'Haruka', speaker_uuid: 'haruka', styles: [{ name: 'normal', id: 3 }] }]);
  if (req.method === 'POST' && url.pathname === '/audio_query') {
    return json(200, { accent_phrases: [], speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1, prePhonemeLength: 0.1, postPhonemeLength: 0.1, outputSamplingRate: 24000, outputStereo: false, kana: url.searchParams.get('text') ?? '' });
  }
  if (req.method === 'POST' && (url.pathname === '/synthesis' || url.pathname === '/streaming_synthesis')) {
    let text = '';
    try { text = JSON.parse(body.toString('utf8')).kana ?? ''; } catch { /* */ }
    if (!text.trim()) return json(422, { detail: 'empty' });
    const t0 = Date.now();
    try {
      const wav = await harukaWav(text);
      log({ kind: 'voice', chars: text.length, ms: Date.now() - t0, audioSec: Math.round(((wav.length - 44) / 48000) * 100) / 100 });
      res.writeHead(200, { 'content-type': 'audio/wav' });
      return res.end(wav);
    } catch (e) {
      console.error('[voice]', e.message);
      return json(500, { detail: e.message });
    }
  }
  json(404, {});
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  brain.listen(BRAIN_PORT, '127.0.0.1', () => console.log(`[brain] 127.0.0.1:${BRAIN_PORT} -> ${CHAT}/api/chat (interview)`));
  voice.listen(VOICE_PORT, '127.0.0.1', () => console.log(`[voice] 127.0.0.1:${VOICE_PORT} (Windows ja-JP voice, silent)`));
}
