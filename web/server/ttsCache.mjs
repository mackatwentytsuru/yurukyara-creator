// 読み上げた声(PCM)のおぼえ書き。同じ声・同じモデル・同じ文なら、声のサービスにもう頼まない(早く出る・文字数を使わない)。
// 置き場は 2 つ: 手元の記憶(新しい順に残す。大きさに上限)と、手元のフォルダ(作業用の置き場。git に入れない。大きさに上限)。
// 入れるのは声の音だけ。鍵・声の鍵・使う人の言葉の履歴は入れない(文そのものは、声のサービスへ送る文と同じ。ファイル名は鍵のハッシュ)。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MEM_CACHE_BYTES = 24 * 1024 * 1024;
export const DISK_CACHE_BYTES = 64 * 1024 * 1024;
export const ENTRY_MAX_BYTES = 4 * 1024 * 1024; // 1 文の音の上限(300 字でも 2MB に届かない)

/** 声の id・モデル・文から、おぼえ書きの名前を作る(区切りに文字が混ざっても別の物になるよう、長さつきで) */
export function cacheKey(voiceId, modelId, text, lang = 'ja') {
  const raw = `${String(voiceId).length}:${voiceId}|${String(modelId).length}:${modelId}|${text}`;
  // ML1: 日本語以外の言葉の声は、言葉も名前に足す(同じ文字でも言葉が違えば、別の声)。日本語の名前は今までと同じ(今のおぼえ書きをそのまま使える)
  return createHash('sha256').update(lang && lang !== 'ja' ? `${raw}|lang:${lang}` : raw).digest('hex');
}

const NAME = /^[0-9a-f]{64}\.pcm$/;

export function createTtsCache({ dir, memBytes = MEM_CACHE_BYTES, diskBytes = DISK_CACHE_BYTES } = {}) {
  const mem = new Map(); // key → Buffer(Map の並び = 古い順。使うたびに入れ直す)
  let memSize = 0;
  const stats = { hitMem: 0, hitDisk: 0, miss: 0, stored: 0 };

  const touch = (key, buf) => {
    if (mem.has(key)) memSize -= mem.get(key).length;
    mem.delete(key);
    mem.set(key, buf);
    memSize += buf.length;
    while (memSize > memBytes && mem.size > 1) {
      const [oldKey, old] = mem.entries().next().value;
      mem.delete(oldKey);
      memSize -= old.length;
    }
  };

  const diskFiles = () => {
    try {
      return readdirSync(dir)
        .filter((n) => NAME.test(n))
        .map((n) => {
          const st = statSync(join(dir, n));
          return { n, size: st.size, at: st.mtimeMs };
        });
    } catch {
      return [];
    }
  };

  const trimDisk = () => {
    const files = diskFiles().sort((a, b) => a.at - b.at);
    let total = files.reduce((s, f) => s + f.size, 0);
    for (const f of files) {
      if (total <= diskBytes) break;
      try {
        unlinkSync(join(dir, f.n));
        total -= f.size;
      } catch {
        // 使われている・もう無い物は飛ばす
      }
    }
  };

  return {
    stats,
    /** @returns {Buffer|null} */
    get(key) {
      const m = mem.get(key);
      if (m) {
        touch(key, m);
        stats.hitMem += 1;
        return m;
      }
      if (dir) {
        try {
          const buf = readFileSync(join(dir, `${key}.pcm`));
          if (buf.length > 0 && buf.length % 2 === 0) {
            touch(key, buf);
            stats.hitDisk += 1;
            return buf;
          }
        } catch {
          // 無い
        }
      }
      stats.miss += 1;
      return null;
    },
    /** 最後まで取れた音だけ入れる(途中で切れた物は入れない) */
    set(key, buf) {
      if (!Buffer.isBuffer(buf) || buf.length === 0 || buf.length % 2 !== 0 || buf.length > ENTRY_MAX_BYTES) return false;
      touch(key, buf);
      stats.stored += 1;
      if (dir) {
        try {
          mkdirSync(dir, { recursive: true });
          const tmp = join(dir, `${key}.tmp`);
          writeFileSync(tmp, buf);
          renameSync(tmp, join(dir, `${key}.pcm`));
          trimDisk();
        } catch {
          // 書けなくても、手元の記憶には入っている
        }
      }
      return true;
    },
    has: (key) => mem.has(key) || (Boolean(dir) && existsSync(join(dir, `${key}.pcm`))),
    memBytes: () => memSize,
    diskBytes: () => diskFiles().reduce((s, f) => s + f.size, 0),
  };
}
