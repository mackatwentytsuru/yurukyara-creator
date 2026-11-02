// 誰を見るかを決める。three.js にもブラウザにも依存しない純粋なロジック(node --test で確かめる)。
//
// 入力は人ごとの「位置(キャラの座標、メートル)・口の開き」の数字だけ。カメラの絵そのものはここに来ない。
// キャラの座標: 足元が原点、+z が正面(お客さんのいる側)、+x がお客さんから見て右、y が上。
// 追跡: 入力が id をくれればそれで、無ければ前のフレームでいちばん近い人を同じ人とみなす。
// 選び方: 話している人(口の動きが大きく、2 番目より目立つ。入力が speaking を教えてくれればそれ)を見る。
//         分からなければ、いちばん近い人。

export const DEFAULTS = {
  maxJump: 0.5, // 同じ人とみなす最大の移動(m)。奥行き(z)は推定が粗いので、重みを小さくして測る
  depthWeight: 0.25,
  lostAfterS: 0.8, // 見えなくなってから忘れるまで
  mouthTau: 0.35, // 口の動きの平均をとる時間(秒)
  speakMin: 0.012, // これ未満の口の動きは「話していない」
  speakMinWithVoice: 0.006, // マイクに声があるときは、少し小さい動きでも話しているとみなす
  speakRatio: 1.5, // 2 番目の人よりこの倍率以上、口が動いていたら話している人とする
  speakingBoost: 0.05, // 入力が「話している」と教えてくれたときの、口の動きの扱い
  switchHoldS: 0.5, // 見る人を替えるのに、新しい人が続けて有利である時間
};

let nextId = 1;

const dist = (a, b, wz) => Math.hypot(a[0] - b[0], a[1] - b[1], wz * (a[2] - b[2]));

export class AttentionPicker {
  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.tracks = [];
    this.currentId = null;
    this.challenger = null; // { id, since }
    this.now = 0;
    this.speakerId = null;
  }

  /**
   * @param {Array<{id?:string|number, position:number[], gaze?:number[], mouth?:number, speaking?:boolean}>} people
   * @param {number} now 秒
   * @param {{voiceActive?:boolean}} ctx
   */
  update(people, now, ctx = {}) {
    const dt = this.now ? Math.max(0, now - this.now) : 0;
    this.now = now;
    this._match(people, now, dt);
    const alive = this.tracks.filter((t) => t.seenNow);
    const primary = this._choose(alive, now, ctx);
    return { tracks: alive.map((t) => this._view(t)), primaryId: primary?.id ?? null, speakerId: this.speakerId };
  }

  _view(t) {
    return { id: t.id, position: t.position, gaze: t.gaze, mouth: t.mouth, activity: t.activity };
  }

  _match(people, now, dt) {
    for (const t of this.tracks) t.seenNow = false;
    const free = new Set(this.tracks);
    const usedPerson = new Set();

    // 1. 入力が id をくれた人は、id で結ぶ
    people.forEach((p, i) => {
      if (p.id === undefined) return;
      const key = `ext:${p.id}`;
      const t = this.tracks.find((x) => x.key === key);
      if (!t) return;
      usedPerson.add(i);
      free.delete(t);
      this._observe(t, p, now, dt);
    });

    // 2. それ以外は、近い順に割り当てる
    const pairs = [];
    people.forEach((p, i) => {
      if (usedPerson.has(i) || p.id !== undefined) return;
      for (const t of free) {
        if (t.key) continue;
        const d = dist(p.position, t.position, this.o.depthWeight);
        if (d < this.o.maxJump) pairs.push({ d, i, t });
      }
    });
    pairs.sort((a, b) => a.d - b.d);
    for (const { i, t } of pairs) {
      if (usedPerson.has(i) || !free.has(t)) continue;
      usedPerson.add(i);
      free.delete(t);
      this._observe(t, people[i], now, dt);
    }

    // 3. 結べなかった人は、新しい人
    people.forEach((p, i) => {
      if (usedPerson.has(i)) return;
      const t = {
        id: nextId++,
        key: p.id !== undefined ? `ext:${p.id}` : null,
        position: p.position,
        gaze: p.gaze,
        mouth: p.mouth ?? 0,
        activity: 0,
        lastSeen: now,
        seenNow: true,
      };
      this.tracks.push(t);
    });

    this.tracks = this.tracks.filter((t) => now - t.lastSeen < this.o.lostAfterS);
    if (this.currentId !== null && !this.tracks.some((t) => t.id === this.currentId)) this.currentId = null;
  }

  _observe(t, p, now, dt) {
    const k = dt > 0 ? 1 - Math.exp(-dt / this.o.mouthTau) : 1;
    const mouth = p.mouth ?? t.mouth;
    // 入力が話しているかを知っていれば、それを使う。知らなければ、口の動きの大きさ
    const move = p.speaking !== undefined ? (p.speaking ? this.o.speakingBoost : 0) : Math.abs(mouth - t.mouth);
    t.activity += (move - t.activity) * k;
    t.position = p.position;
    t.gaze = p.gaze;
    t.mouth = mouth;
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
    const clearSpeaker = top.activity >= min && (!second || top.activity >= second.activity * this.o.speakRatio);
    if (clearSpeaker) this.speakerId = top.id;

    const near = (t) => Math.hypot(t.position[0], t.position[2]);
    const nearest = [...tracks].sort((a, b) => near(a) - near(b))[0];
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
