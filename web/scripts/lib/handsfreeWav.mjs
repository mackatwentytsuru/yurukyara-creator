// ハンズフリー試験用の「偽のマイクの録音」を作る部品。短い日本語の発話 5 つを、無音ではさんで 1 本の WAV(48kHz・モノ・16bit)にする。
// 発話の声は、Windows に入っている日本語の読み上げ(SAPI)で作る。外のサービスは使わない・鍵もいらない。
// Chrome の --use-file-for-fake-audio-capture=<この WAV> に渡す(録音の終わりまで来たら、頭から繰り返す)。
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const UTTERANCES = Object.freeze(['こんにちは', '今日はいい天気ですね', 'ステージはどこにありますか', 'おすすめを教えてください', 'ありがとう、またね']);
export const OUT_RATE = 48000;

/** PCM 16bit の WAV を読む(data チャンクを探す。ヘッダの長さに頼らない)。モノの Float32 と元の速さを返す */
export function readWavMono(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('WAV ではありません');
  let pos = 12;
  let fmt = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('16bit PCM の WAV だけ読めます');
      const n = Math.floor(Math.min(size, buf.length - pos - 8) / (2 * fmt.channels));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c++) s += buf.readInt16LE(pos + 8 + (i * fmt.channels + c) * 2);
        out[i] = s / fmt.channels / 32768;
      }
      return { samples: out, rate: fmt.rate };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error('data チャンクがありません');
}

/** 線形補間で速さを変える(声の試験用。音質は問わない) */
export function resampleLinear(x, from, to) {
  if (from === to) return x;
  const n = Math.floor((x.length * to) / from);
  const out = new Float32Array(n);
  const k = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * k;
    const i0 = Math.floor(p);
    const f = p - i0;
    out[i] = x[i0] * (1 - f) + (x[Math.min(i0 + 1, x.length - 1)] ?? 0) * f;
  }
  return out;
}

export function encodeWav16(samples, rate = OUT_RATE) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

/**
 * 発話の WAV(それぞれ別ファイル)を、先頭の無音(leadS)と、発話どうしの無音(gapS)ではさんで 1 本にする。
 * gapS は、キャラの返事が終わるまで(その間は聞かない決まり)より長くする。
 * @returns {{wav: Buffer, startsS: number[], durS: number[], totalS: number}}
 */
export function composeWav(files, { leadS = 4, gapS = 9, tailS = 6, rate = OUT_RATE, gain = 0.9 } = {}) {
  const parts = files.map((f) => {
    const { samples, rate: r } = readWavMono(readFileSync(f));
    const x = resampleLinear(samples, r, rate);
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    return peak > 0 ? x.map((v) => (v / peak) * gain) : x;
  });
  const total = Math.round(rate * (leadS + tailS + gapS * (parts.length - 1))) + parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let at = Math.round(rate * leadS);
  const startsS = [];
  const durS = [];
  for (const p of parts) {
    out.set(p, at);
    startsS.push(+(at / rate).toFixed(2));
    durS.push(+(p.length / rate).toFixed(2));
    at += p.length + Math.round(rate * gapS);
  }
  return { wav: encodeWav16(out, rate), startsS, durS, totalS: +(total / rate).toFixed(1) };
}

/** Windows の日本語の読み上げ(SAPI)で、1 文ずつ WAV にする。使えない(Windows でない・日本語の声が無い)時は null */
export function synthJapanese(texts, dir) {
  if (process.platform !== 'win32') return null;
  mkdirSync(dir, { recursive: true });
  const listFile = join(dir, 'texts.json');
  writeFileSync(listFile, JSON.stringify(texts), 'utf8');
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'ja-JP' } | Select-Object -First 1",
    'if (-not $v) { exit 3 }',
    '$s.SelectVoice($v.VoiceInfo.Name)',
    '$s.Rate = 0',
    `$texts = Get-Content -LiteralPath '${listFile.replace(/'/g, "''")}' -Raw -Encoding UTF8 | ConvertFrom-Json`,
    'for ($i = 0; $i -lt $texts.Count; $i++) {',
    `  $s.SetOutputToWaveFile((Join-Path '${dir.replace(/'/g, "''")}' ("u{0}.wav" -f $i)))`,
    '  $s.Speak($texts[$i])',
    '  $s.SetOutputToNull()',
    '}',
  ].join('\n');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (r.status !== 0) return null;
  return texts.map((_, i) => join(dir, `u${i}.wav`));
}
