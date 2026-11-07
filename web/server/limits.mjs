// 費用の上限。誰でも開ける URL を出しても、Claude と読み上げの費用が青天井にならないようにする。
//  - 1 日の回数の上限(日付が替わると 0 に戻る。再起動しても、ファイルに残る)
//  - 同じ接続元からの、1 分あたりの回数の上限
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const today = (now) => new Date(now).toLocaleDateString('sv-SE'); // YYYY-MM-DD(ローカル日付)

/**
 * @param {object} o
 * @param {string} o.file 使った回数を残すファイル
 * @param {number} o.dailyCap 1 日の回数の上限
 * @param {number} o.perMinute 1 つの接続元の、1 分あたりの上限
 * @param {number} [o.imageCap] BCV: 1 日に頭脳へ送ってよいカメラの絵の枚数(同じ 1 日の記録で数える。無ければ数えるだけ)
 * @param {() => number} [o.now]
 */
export function createLimiter({ file, dailyCap, perMinute, imageCap = Infinity, now = Date.now }) {
  const recent = new Map(); // 接続元 → 直近 1 分の時刻の列

  const read = () => {
    try {
      const u = JSON.parse(readFileSync(file, 'utf8'));
      if (u.date === today(now())) return u;
    } catch {
      // 無ければ新しく始める
    }
    return { date: today(now()), calls: 0 };
  };
  const write = (u) => {
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(u));
  };

  return {
    /** 1 回ぶんを引き当てる。足りなければ { ok:false, reason } */
    take(client = 'local') {
      const t = now();
      const times = (recent.get(client) ?? []).filter((x) => t - x < 60_000);
      if (times.length >= perMinute) {
        recent.set(client, times);
        return { ok: false, reason: 'rate', message: '少し間をおいて、もう一度話しかけてください' };
      }
      const u = read();
      if (u.calls >= dailyCap) return { ok: false, reason: 'daily', message: '今日の会話の上限に達しました。また明日お話ししましょう' };
      u.calls += 1;
      write(u);
      times.push(t);
      recent.set(client, times);
      return { ok: true };
    },
    /** 失敗したとき、引き当てを返す */
    refund(client = 'local') {
      const u = read();
      u.calls = Math.max(0, u.calls - 1);
      write(u);
      const times = recent.get(client) ?? [];
      times.pop();
    },
    // BCV: カメラの絵の枚数も、同じ 1 日の記録(calls の隣の images)で数える。上限に届いたら、その回は絵を送らずに話す
    takeImage() {
      const u = read();
      const used = u.images ?? 0;
      if (used >= imageCap) return { ok: false, reason: 'image-daily', message: '今日のカメラの絵の上限に達しました' };
      u.images = used + 1;
      write(u);
      return { ok: true };
    },
    refundImage() {
      const u = read();
      u.images = Math.max(0, (u.images ?? 0) - 1);
      write(u);
    },
    status() {
      const u = read();
      const images = u.images ?? 0;
      const imageStatus = Number.isFinite(imageCap) ? { imagesToday: images, imageCapToday: imageCap, imagesRemainingToday: Math.max(0, imageCap - images) } : { imagesToday: images };
      return { usedToday: u.calls, capToday: dailyCap, remainingToday: Math.max(0, dailyCap - u.calls), perMinute, ...imageStatus };
    },
  };
}
