// 誰を見るかを決める。three.js にもブラウザにも依存しない純粋なロジック(node --test で確かめる)。
//
// 入力は顔ごとの「位置・大きさ・口の開き」の数字だけ。カメラの絵そのものはここに来ない。
// 追跡: 前のフレームの顔といちばん近い顔を同じ人とみなし、口の動きを少し覚える。
// 選び方: 話している人(口の動きが大きく、2 番目より目立つ)を見る。分からなければいちばん近い人。

export const DEFAULTS = {
  maxJump: 0.22, // 同じ人とみなす最大の移動(画面の幅に対する割合)
  lostAfterS: 0.8, // 見えなくなってから忘れるまで
  mouthTau: 0.35, // 口の動きの平均をとる時間(秒)
  speakMin: 0.012, // これ未満の口の動きは「話していない」
  speakMinWithVoice: 0.006, // マイクに声があるときは、少し小さい動きでも話しているとみなす
  speakRatio: 1.5, // 2 番目の人よりこの倍率以上、口が動いていたら話している人とする
  switchHoldS: 0.5, // 見る人を替えるのに、新しい人が続けて有利である時間
};

let nextId = 1;

export class AttentionPicker {
  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.tracks = [];
    this.currentId = null;
    this.challenger = null; // { id, since }
    this.now = 0;
  }

  /**
   * @param {Array<{x:number,y:number,width:number,mouth:number}>} faces
   *   x,y: 顔の中心(0〜1、画像の左上が 0)。width: 顔の幅(画像の幅に対する割合)。mouth: 口の開き 0〜1
   * @param {number} now 秒
   * @param {{voiceActive?:boolean}} ctx
   */
  update(faces, now, ctx = {}) {
    const dt = this.now ? Math.max(0, now - this.now) : 0;
    this.now = now;
    this._match(faces, now, dt);
    const alive = this.tracks.filter((t) => now - t.lastSeen < 1e-6 || t.seenNow);
    const primary = this._choose(alive, now, ctx);
    return { tracks: alive.map((t) => this._view(t)), primaryId: primary?.id ?? null, speakerId: this.speakerId ?? null };
  }

  _view(t) {
    return { id: t.id, x: t.x, y: t.y, width: t.width, mouth: t.mouth, activity: t.activity };
  }

  _match(faces, now, dt) {
    for (const t of this.tracks) t.seenNow = false;
    const free = new Set(this.tracks);
    // 近い順に割り当てる
    const pairs = [];
    faces.forEach((f, i) => {
      for (const t of this.tracks) {
        const d = Math.hypot(f.x - t.x, f.y - t.y);
        if (d < this.o.maxJump) pairs.push({ d, i, t });
      }
    });
    pairs.sort((a, b) => a.d - b.d);
    const usedFace = new Set();
    for (const { i, t } of pairs) {
      if (usedFace.has(i) || !free.has(t)) continue;
      usedFace.add(i);
      free.delete(t);
      this._observe(t, faces[i], now, dt);
    }
    faces.forEach((f, i) => {
      if (usedFace.has(i)) return;
      const t = { id: nextId++, x: f.x, y: f.y, width: f.width, mouth: f.mouth, activity: 0, lastSeen: now, since: now, seenNow: true };
      this.tracks.push(t);
    });
    this.tracks = this.tracks.filter((t) => now - t.lastSeen < this.o.lostAfterS);
    if (this.currentId !== null && !this.tracks.some((t) => t.id === this.currentId)) this.currentId = null;
  }

  _observe(t, f, now, dt) {
    const k = dt > 0 ? 1 - Math.exp(-dt / this.o.mouthTau) : 1;
    const move = Math.abs(f.mouth - t.mouth);
    t.activity += (move - t.activity) * k;
    t.x = f.x;
    t.y = f.y;
    t.width = f.width;
    t.mouth = f.mouth;
    t.lastSeen = now;
    t.seenNow = true;
  }

  _choose(tracks, now, ctx) {
    this.speakerId = null;
    if (!tracks.length) {
      this.currentId = null;
      return null;
    }
    const byActivity = [...tracks].sort((a, b) => b.activity - a.activity);
    const min = ctx.voiceActive ? this.o.speakMinWithVoice : this.o.speakMin;
    const top = byActivity[0];
    const second = byActivity[1];
    const clearSpeaker = tracks.length === 1 ? top.activity >= min : top.activity >= min && (!second || top.activity >= second.activity * this.o.speakRatio);
    if (clearSpeaker) this.speakerId = top.id;

    const nearest = [...tracks].sort((a, b) => b.width - a.width)[0];
    const want = clearSpeaker ? top : nearest;

    if (this.currentId === null) {
      this.currentId = want.id;
      this.challenger = null;
    } else if (want.id !== this.currentId) {
      // 今見ている人から、すぐには替えない(視線が泳がないように)
      if (!this.challenger || this.challenger.id !== want.id) this.challenger = { id: want.id, since: now };
      else if (now - this.challenger.since >= this.o.switchHoldS) {
        this.currentId = want.id;
        this.challenger = null;
      }
    } else {
      this.challenger = null;
    }
    return tracks.find((t) => t.id === this.currentId) ?? want;
  }
}
