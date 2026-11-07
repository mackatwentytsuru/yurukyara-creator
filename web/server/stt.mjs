// 聞き取り(声 → 文字)。ブラウザに聞き取りが無い端末(Quest 3 のブラウザなど)のために、サーバーで文字にする。
// faster-whisper を自分の PC で動かすので、鍵も外への送信も無い。音は一時ファイルに置き、文字にしたら消す(保存しない)。
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ValidationError } from './validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MAX_WAV_BYTES = 1.5 * 1024 * 1024; // 16kHz・16bit で約 47 秒
const MAX_PENDING = 3;
const TIMEOUT_MS = 30000;
// 無音や雑音のとき、Whisper が勝手に作りがちな文(字幕の学習データ由来)
const HALLUCINATIONS = [/^ご視聴(ありがとうございました|ありがとうございます)。?$/, /^(チャンネル登録|字幕).*$/];

/** 形を確かめる。外から届く物は信じない */
export function assertWav(buf) {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') {
    throw new ValidationError('WAV ではありません');
  }
  if (buf.length > MAX_WAV_BYTES) throw Object.assign(new ValidationError('音が長すぎます'), { status: 413 });
}

/**
 * 手がかりの言葉(話しかけているキャラの名前)。外から届く物なので、40 字までの、文字と数字と伸ばす棒だけにする
 * (係へは 1 行で渡すので、改行・タブは入れさせない)。名前が無ければ空
 */
export function cleanHint(hint) {
  return Array.from(String(hint ?? ''))
    .filter((ch) => /[\p{L}\p{N}ー]/u.test(ch))
    .slice(0, 40)
    .join('');
}

export function cleanText(text) {
  const t = String(text ?? '').trim();
  return HALLUCINATIONS.some((re) => re.test(t)) ? '' : t;
}

/**
 * @param {object} [o]
 * @param {string} [o.command] 係を動かす実行ファイル(試験では偽の係に替える)
 * @param {string[]} [o.args]
 */
export function createStt({ command = process.env.STT_PYTHON ?? 'python', args = [join(HERE, 'stt_worker.py')], engine = process.env.STT_ENGINE ?? 'local' } = {}) {
  let worker = null; // { proc, ready:Promise, waiting:[{resolve,reject,timer}] }
  let pending = 0;
  let tail = Promise.resolve();
  let installed = null; // faster-whisper があるか(調べた結果)

  function startWorker() {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const w = { proc, waiting: [] };
    w.ready = new Promise((resolve, reject) => {
      w.markReady = resolve;
      w.markDead = reject;
    });
    w.ready.catch(() => {});
    const die = (err) => {
      if (worker === w) worker = null;
      w.markDead(err);
      for (const job of w.waiting.splice(0)) {
        clearTimeout(job.timer);
        job.reject(err);
      }
    };
    proc.on('error', die);
    proc.on('exit', () => die(new Error('聞き取りの係が止まりました')));
    createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // 読み込み中の余計な出力
      }
      if (msg.ready) return w.markReady();
      const job = w.waiting.shift();
      if (!job) return;
      clearTimeout(job.timer);
      if (msg.error) job.reject(new Error(msg.error));
      else job.resolve(msg);
    });
    worker = w;
    return w;
  }

  /** 1 つの WAV を係に渡して、返事を待つ */
  async function ask(path, hint = '') {
    const w = worker ?? startWorker();
    await w.ready;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // 詰まった係は作り直す(次の区間を巻き込まない)
        w.proc.kill();
        reject(new Error('聞き取りが時間内に終わりませんでした'));
      }, TIMEOUT_MS);
      w.waiting.push({ resolve, reject, timer });
      w.proc.stdin.write(hint ? `${path}\t${hint}\n` : `${path}\n`);
    });
  }

  return {
    /** faster-whisper が入っているかを調べる(サーバーの起動時に 1 回) */
    async check() {
      if (engine === 'off') return (installed = false);
      installed = await new Promise((resolve) => {
        const p = spawn(command, ['-c', "import importlib.util as u,sys;sys.exit(0 if u.find_spec('faster_whisper') else 1)"], { stdio: 'ignore', windowsHide: true });
        p.on('error', () => resolve(false));
        p.on('exit', (code) => resolve(code === 0));
      });
      return installed;
    },
    status() {
      return { available: installed === true, engine: installed === true ? 'faster-whisper' : 'none', loaded: Boolean(worker) };
    },
    /** 最初の 1 回が遅くならないよう、型を読み込んでおく */
    warm() {
      if (installed && !worker) startWorker();
    },
    /** @returns {Promise<{text:string, ms:number}>} */
    async transcribe(wav, { hint = '' } = {}) {
      assertWav(wav);
      if (pending >= MAX_PENDING) throw Object.assign(new ValidationError('聞き取りが混んでいます'), { status: 429 });
      pending += 1;
      const run = async () => {
        const path = join(tmpdir(), `stt_${randomBytes(8).toString('hex')}.wav`);
        writeFileSync(path, wav);
        try {
          const r = await ask(path, cleanHint(hint));
          return { text: cleanText(r.text), ms: r.ms ?? null };
        } finally {
          rmSync(path, { force: true });
          pending -= 1;
        }
      };
      const result = tail.then(run, run); // 係は 1 つなので、順番に
      tail = result.catch(() => {});
      return result;
    },
    stop() {
      worker?.proc.stdin.end();
      worker = null;
    },
  };
}
