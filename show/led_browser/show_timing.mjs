// 時刻の計算だけの部品。three.js に依存しない。コマ番号と timeline と台本から、そのコマの値を全部決める。
// 同じ入力なら同じ値になる(コマを進める状態を持たない)。node からも読める。
// section は重なってもよい(せりふが曲のイントロに乗るなど)。絵は「主のセクション」で決め、動きは id ごとに足す。

export const smooth = (t) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};
const lerp = (a, b, t) => a + (b - a) * t;

// セクションごとの光。cone=上からの光の円錐、pool=床の光のだまり、song=全面の絵、ember=静かな粒、
// warm=暖かさ、wash=床からの淡い色、key/rim/hemi=キャラに当たる光、lift=キャラ自身の明るさ、xfade=前からの移り変わりの秒。
const LOOK_FIELDS = ['cone', 'pool', 'song', 'ember', 'warm', 'wash', 'key', 'rim', 'hemi', 'lift'];
const look = (cone, pool, songAmount, ember, warm, wash, key, rim, hemi, lift, xfade) => ({ cone, pool, song: songAmount, ember, warm, wash, key, rim, hemi, lift, xfade });
export const LOOKS = {
  preroll: look(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01),
  dark: look(1, 0.8, 0, 0.25, 0, 0, 0, 0, 0, 0, 0.01),
  enter: look(1, 1, 0, 0.3, 0, 0, 2.3, 0.5, 0.5, 0.75, 0.6),
  line: look(0.9, 1, 0, 0.4, 0.08, 0.1, 2.5, 0.7, 0.75, 1, 0.8),
  song: look(0, 0.35, 1, 0, 0, 0, 2.8, 5, 1.1, 1.1, 0.1),
  bow: look(0.75, 0.9, 0.06, 0.9, 0.12, 0.15, 2.3, 0.7, 0.7, 0.95, 1.3),
  listen: look(0.3, 0.5, 0, 0.2, 0, 0, 1.9, 0.6, 0.35, 0.7, 1.2),
  answer: look(0.65, 1, 0, 0.7, 1, 0.8, 3.1, 0.5, 1.0, 1, 1.0),
  outro: look(0.65, 1, 0, 0.7, 1, 0.8, 3.1, 0.5, 1.0, 1, 0.01),
  tail: look(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01),
  sync_head: look(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01),
  sync_tail: look(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01),
  black_end: look(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01),
};
// 曲の静かな所の光。曲の盛り上がり drive に合わせて LOOKS.song へ移る
const SONG_QUIET = look(0.9, 1, 0, 0.4, 0.05, 0.12, 2.4, 0.7, 0.75, 1, 0.8);
const EMBER_BEFORE_IGNITE = 1.0; // 灯る直前の粒の量。せりふの間に少しずつ増やす
const IGNITE_LOOK_SEC = 0.2; // 灯るときに光を切りかえる秒

// カメラを合わせる同期のフラッシュの明るさ。形は timeline の sync(音のビープと同じ秒)
const SYNC_FLASH_LEVEL = 0.7;
const MASTER_ZERO = new Set(['tail', 'sync_tail', 'black_end']);

const IGNITE_NONE = 1000;
const CONE_DROP_WAIT = 0.5; // dark の頭で真っ黒のまま待つ秒
const CONE_DROP_SEC = 2.2; // 光が上から床まで降りる秒
const TURN_SEC = 0.9; // 体の向きが変わる秒
const CHORUS_MIN_GAP_BARS = 6;
const CHORUS_THRESHOLD = 0.55; // 小節の強さの下位 10% と上位 10% の間の、どの高さを超えたらサビとみなすか
const DRIVE_FLAT = 0.05; // 音の強さの幅がこれより狭い曲は、全体を盛り上がりとして扱う
const QUIET_BEAT_GAIN = 0.25; // 静かな所での、拍の動きの強さ

function validate(timeline) {
  for (const key of ['fps', 'frames', 'sections', 'mouth', 'energy']) {
    if (timeline[key] === undefined) throw new Error(`timeline に ${key} がありません`);
  }
  if (timeline.mouth.length < timeline.frames || timeline.energy.length < timeline.frames) {
    throw new Error(`mouth(${timeline.mouth.length})・energy(${timeline.energy.length}) が frames(${timeline.frames}) より短いです`);
  }
}

function follow(values, fps, attackSec, releaseSec) {
  const up = 1 - Math.exp(-1 / (attackSec * fps));
  const down = 1 - Math.exp(-1 / (releaseSec * fps));
  const out = new Float32Array(values.length);
  let v = 0;
  for (let i = 0; i < values.length; i++) {
    v += (values[i] - v) * (values[i] > v ? up : down);
    out[i] = v;
  }
  return out;
}

function percentile(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
}

/** 曲の構成。timeline にあればそちら、無ければ台本の値 */
function songStructure(timeline, motion) {
  const cfg = motion.song_structure;
  if (!cfg) return null;
  return {
    ...cfg,
    intro_song_sec: timeline.intro_song_sec ?? cfg.intro_song_sec,
    chorus_song_sec: timeline.chorus_song_sec ?? cfg.chorus_song_sec,
  };
}

/** LED が灯る秒: 歌声が入る秒の直前の小節の頭。1 小節以内に小節の頭が無ければ、歌声が入る秒そのもの */
function igniteTimeOf(section, downbeats, structure) {
  const at = section.start + structure.intro_song_sec;
  const before = downbeats.filter((d) => d <= at && d >= section.start);
  const last = before[before.length - 1];
  const barSec = downbeats.length > 1 ? downbeats[1] - downbeats[0] : 0;
  return last !== undefined && at - last <= barSec ? last : at;
}

/**
 * 曲の中の盛り上がり(0〜1)をコマごとに作る。曲の中の音の強さの幅で正規化するので、曲ごとに合う。
 * 構成が書いてあれば、イントロ・歌・サビの上限をかける(音圧のそろった曲は、音の強さだけではサビが分からない)。
 */
function precomputeDrive(timeline, motion) {
  const { fps, frames, energy, sections } = timeline;
  const structure = songStructure(timeline, motion);
  const raw = new Float32Array(frames);
  for (const s of sections) {
    if (s.id !== 'song') continue;
    const a = Math.round(s.start * fps);
    const b = Math.min(frames, Math.round(s.end * fps));
    const sorted = Array.from(energy.slice(a, b)).sort((x, y) => x - y);
    const lo = percentile(sorted, 0.1);
    const hi = percentile(sorted, 0.9);
    for (let i = a; i < b; i++) {
      const level = hi - lo < DRIVE_FLAT ? 1 : Math.min(1, Math.max(0, (energy[i] - lo) / (hi - lo)));
      if (!structure) {
        raw[i] = level;
        continue;
      }
      const songSec = i / fps - s.start;
      const ignite = igniteTimeOf(s, timeline.downbeats ?? [], structure) - s.start;
      const cap = songSec < ignite ? 0 : songSec < structure.chorus_song_sec ? structure.verse_drive : structure.chorus_drive;
      raw[i] = cap * (0.85 + 0.15 * level);
    }
  }
  return follow(raw, fps, 0.15, 1.6);
}

function precomputeEnergy(energy, frames, fps) {
  const input = Float32Array.from({ length: frames }, (_, i) => energy[i] ?? 0);
  const sm = follow(input, fps, 0.03, 0.3);
  const flow = new Float32Array(frames);
  let f = 0;
  for (let i = 0; i < frames; i++) {
    f += (0.3 + sm[i] * 1.3) / fps;
    flow[i] = f;
  }
  return { sm, flow };
}

/** t 以下で最後の要素の番号(なければ -1)。a は昇順 */
export function lastIndexBefore(a, t) {
  let lo = 0;
  let hi = a.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function barsIn(section, downbeats) {
  return downbeats.filter((d) => d >= section.start - 1e-6 && d < section.end);
}

/** 小節ごとの音の強さから、サビの頭(小節の番号)を探す。曲が変わっても同じ規則で動く */
export function chorusBars(section, downbeats, energy, fps) {
  const bars = barsIn(section, downbeats);
  if (bars.length < 3) return [];
  const means = bars.map((d, i) => {
    const a = Math.round(d * fps);
    const b = Math.round((bars[i + 1] ?? section.end) * fps);
    let s = 0;
    for (let k = a; k < b; k++) s += energy[k] ?? 0;
    return s / Math.max(1, b - a);
  });
  const sorted = [...means].sort((x, y) => x - y);
  const lo = percentile(sorted, 0.1);
  const hi = percentile(sorted, 0.9);
  if (hi - lo < DRIVE_FLAT) return [];
  const line = lo + (hi - lo) * CHORUS_THRESHOLD;
  const out = [];
  for (let i = 1; i < means.length; i++) {
    const rising = means[i] > line && means[i - 1] <= line;
    if (rising && (out.length === 0 || i - out[out.length - 1] >= CHORUS_MIN_GAP_BARS)) out.push(i);
  }
  return out;
}

function chorusOf(section, downbeats, timeline, motion) {
  const structure = songStructure(timeline, motion);
  if (!structure || section.id !== 'song') return chorusBars(section, downbeats, timeline.energy, timeline.fps);
  const at = section.start + structure.chorus_song_sec;
  const bars = barsIn(section, downbeats);
  let best = -1;
  bars.forEach((d, i) => {
    if (best < 0 || Math.abs(d - at) < Math.abs(bars[best] - at)) best = i;
  });
  return best >= 0 ? [best] : [];
}

function eventTimes(ev, section, ctx) {
  const dur = section.end - section.start;
  if (ev.at_sec !== undefined) return [section.start + ev.at_sec];
  if (ev.at_frac !== undefined) return [section.start + dur * ev.at_frac];
  if (ev.from_end_sec !== undefined) return [section.end - ev.from_end_sec];
  const beatOffset = (ev.beat ?? 0) * ctx.beatSec;
  const atBar = (n) => (n < ctx.bars.length ? ctx.bars[n] + beatOffset : null);
  if (ev.bar !== undefined) return [atBar(ev.bar)];
  if (ev.on === 'chorus') return ctx.chorus.map((n) => atBar(n + (ev.after_bars ?? 0)));
  if (ev.every_bars !== undefined) {
    const out = [];
    for (let n = ev.offset_bars ?? 0; n < ctx.bars.length; n += ev.every_bars) out.push(atBar(n));
    return out;
  }
  throw new Error(`時刻の書き方が分かりません: ${JSON.stringify(ev)}`);
}

/**
 * 返事の文ごとの台本を、ふつうの events の形にする。
 * 開始は全編の秒(start / start_sec / at)。answer の section の中に無いときは、section の頭からの秒とみなす。
 */
function saysToEvents(says, section, sayWeights) {
  return says.map((say) => {
    const raw = say.start ?? say.start_sec ?? say.at ?? 0;
    const inside = raw >= section.start - 1e-3 && raw < section.end;
    return {
      at_sec: (inside ? raw - section.start : raw),
      expr: say.expression ?? say.expr ?? undefined,
      expr_weight: sayWeights?.[say.expression ?? say.expr],
      play: say.motion ?? say.play ?? undefined,
    };
  });
}

/** 台本を、コマ番号つきの一覧にする。動きが重なるときは、先の物を優先する */
export function resolveEvents(timeline, motion, drive) {
  const fps = timeline.fps;
  const beatSec = 60 / (timeline.bpm || 120);
  const downbeats = timeline.downbeats ?? [];
  const out = [];
  for (const section of timeline.sections) {
    const def = motion.sections?.[section.id];
    if (!def) continue;
    const start = Math.round(section.start * fps);
    const says = section.id === 'answer' && timeline.answer_says?.length ? timeline.answer_says : null;
    if (def.expr && !says) out.push({ frame: start, expr: def.expr, exprWeight: def.expr_weight, order: -1 });
    if (def.look_at !== undefined || section.id !== 'line') out.push({ frame: start, look: def.look_at ?? null, order: -1 });
    const ctx = {
      beatSec,
      bars: barsIn(section, downbeats),
      chorus: chorusOf(section, downbeats, timeline, motion),
    };
    const events = says ? [...saysToEvents(says, section, motion.vrm?.say_weights), ...(def.finish_events ?? [])] : def.events ?? [];
    events.forEach((ev, order) => {
      for (const t of eventTimes(ev, section, ctx)) {
        if (t === null || t < section.start - 1e-6 || t >= section.end) continue;
        const frame = Math.round(t * fps);
        if (ev.min_drive !== undefined && (drive[frame] ?? 0) < ev.min_drive) continue;
        out.push({ frame, order, play: ev.play, expr: ev.expr, exprWeight: ev.expr_weight, beats: ev.beats, weight: ev.weight });
      }
    });
  }
  out.sort((a, b) => a.frame - b.frame || a.order - b.order);
  const kept = [];
  let busyUntil = -1;
  for (const ev of out) {
    if (ev.play) {
      if (ev.frame < busyUntil) continue;
      busyUntil = ev.frame + Math.round((ev.beats ?? 1) * beatSec * fps);
    }
    kept.push(ev);
  }
  return kept;
}

export class ShowTiming {
  constructor(timeline, motion) {
    validate(timeline);
    this.timeline = timeline;
    this.motion = motion;
    this.fps = timeline.fps;
    this.frames = timeline.frames;
    this.sections = timeline.sections;
    this.beats = timeline.beats ?? [];
    this.downbeats = timeline.downbeats ?? [];
    this.beatSec = 60 / (timeline.bpm || 120);
    const { sm, flow } = precomputeEnergy(timeline.energy, this.frames, this.fps);
    this.energySm = sm;
    this.flow = flow;
    this.driveCurve = precomputeDrive(timeline, motion);
    this.events = new Map();
    for (const ev of resolveEvents(timeline, motion, this.driveCurve)) {
      if (!this.events.has(ev.frame)) this.events.set(ev.frame, []);
      this.events.get(ev.frame).push(ev);
    }
  }

  frameOf(t) {
    return Math.max(0, Math.min(this.frames - 1, Math.round(t * this.fps)));
  }

  drive(t) {
    return this.driveCurve[this.frameOf(t)];
  }

  /** そのコマの絵を決めるセクション。曲が鳴っていれば曲、それ以外は一番あとに始まった物 */
  primary(t) {
    let best = this.sections[0];
    for (const s of this.sections) {
      if (s.start > t) continue;
      if (t < s.end && s.id === 'song') return s;
      if (s.start >= best.start) best = s;
    }
    return best;
  }

  active(id, t) {
    return this.sections.some((s) => s.id === id && s.start <= t && t < s.end);
  }

  section(id) {
    return this.sections.find((s) => s.id === id) ?? null;
  }

  /** LED が灯る秒。構成が無ければ null */
  igniteTime() {
    const song = this.section('song');
    const structure = songStructure(this.timeline, this.motion);
    return song && structure ? igniteTimeOf(song, this.downbeats, structure) : null;
  }

  /** 灯ってからの秒(灯る前は負)。構成が無いときは、ずっと前に灯ったことにする */
  igniteAge(t) {
    const at = this.igniteTime();
    return at === null ? IGNITE_NONE : t - at;
  }

  _lookOf(s, t) {
    if (s.id !== 'song') return LOOKS[s.id] ?? LOOKS.dark;
    const out = { xfade: LOOKS.song.xfade };
    const ignite = this.igniteTime();
    if (ignite === null) {
      const d = this.drive(t);
      for (const f of LOOK_FIELDS) out[f] = lerp(SONG_QUIET[f], LOOKS.song[f], d);
      return out;
    }
    // 灯るまでは暗い舞台のまま。粒だけが少しずつ増える。灯った瞬間に全面へ切りかえる
    const k = smooth((t - ignite) / IGNITE_LOOK_SEC);
    for (const f of LOOK_FIELDS) out[f] = lerp(SONG_QUIET[f], LOOKS.song[f], k);
    out.song = t >= ignite ? 1 : 0;
    if (t < ignite) out.ember = lerp(SONG_QUIET.ember, EMBER_BEFORE_IGNITE, smooth((t - s.start) / Math.max(0.01, ignite - s.start)));
    return out;
  }

  look(t) {
    const s = this.primary(t);
    const now = this._lookOf(s, t);
    const previous = s.start > 0 ? this.primary(s.start - 1e-3) : s;
    const before = previous === s ? now : this._lookOf(previous, s.start - 1e-3);
    const xfade = s.id === 'song' ? SONG_QUIET.xfade : now.xfade;
    const k = smooth((t - s.start) / xfade);
    const out = {};
    for (const f of LOOK_FIELDS) out[f] = lerp(before[f], now[f], k);
    return out;
  }

  /** 拍の情報。pos は連続の拍位置。pulse は拍で 1 になって減る値、down は小節の頭で 1 になって減る値。静かな所では弱い */
  beat(t) {
    const i = lastIndexBefore(this.beats, t);
    const d = lastIndexBefore(this.downbeats, t);
    if (i < 0 || !this.active('song', t)) return { index: Math.max(0, i), phase: 0, pos: Math.max(0, i), pulse: 0, down: 0, bar: Math.max(0, d), active: false, gain: 0 };
    const next = this.beats[i + 1] ?? this.beats[i] + this.beatSec;
    const phase = Math.min(1, (t - this.beats[i]) / Math.max(1e-3, next - this.beats[i]));
    const age = t - this.beats[i];
    const dage = d >= 0 ? t - this.downbeats[d] : 99;
    const gain = lerp(QUIET_BEAT_GAIN, 1, Math.min(1, this.drive(t) * 1.4));
    return { index: i, phase, pos: i + phase, pulse: gain * Math.exp(-age * 7), down: gain * Math.exp(-dage * 3.2), bar: Math.max(0, d), active: true, gain };
  }

  /** サビの寄りが始まる秒。台本の at_song_sec か、音の強さから探したサビの頭。無ければ曲の頭から決まった秒 */
  zoomStart() {
    if (this._zoomStart !== undefined) return this._zoomStart;
    const cfg = this.motion.vrm?.zoom;
    const song = this.section('song');
    this._zoomStart = null;
    if (cfg && song) {
      if (cfg.at_song_sec !== null && cfg.at_song_sec !== undefined) this._zoomStart = song.start + cfg.at_song_sec;
      else {
        const bars = barsIn(song, this.downbeats);
        const found = chorusOf(song, this.downbeats, this.timeline, this.motion).map((n) => bars[n])[0];
        this._zoomStart = found ?? song.start + (cfg.fallback_song_sec ?? 24);
      }
    }
    return this._zoomStart;
  }

  /** サビの寄りの量(0=全身、1=寄り)。一礼の頭から全身に戻る */
  zoomAmount(t) {
    const cfg = this.motion.vrm?.zoom;
    const start = this.zoomStart();
    if (!cfg || start === null) return 0;
    const bow = this.section('bow');
    const back = bow ? bow.start : this.frames / this.fps;
    return smooth((t - start) / cfg.in_sec) * (1 - smooth((t - back) / cfg.out_sec));
  }

  /** 小節の中の位置(0〜1) */
  barPhase(t) {
    const d = lastIndexBefore(this.downbeats, t);
    if (d < 0) return 0;
    const next = this.downbeats[d + 1] ?? this.downbeats[d] + this.beatSec * 4;
    return Math.min(1, (t - this.downbeats[d]) / Math.max(1e-3, next - this.downbeats[d]));
  }

  /** 新しい順に n 個の、小節の頭からの経過秒(無い・静かな所は大きな値で輪を出さない) */
  ringAges(t, n) {
    const d = lastIndexBefore(this.downbeats, t);
    const out = [];
    for (let k = 0; k < n; k++) {
      const at = d - k >= 0 ? this.downbeats[d - k] : null;
      const ignite = this.igniteTime();
      const lit = ignite === null ? this.drive(at ?? 0) > 0.4 : at !== null && at >= ignite - 1e-3;
      out.push(at !== null && this.active('song', at) && lit ? t - at : 1000);
    }
    return out;
  }

  /** 全体の明るさ。outro で 0 まで下げ、tail は 0 */
  master(t) {
    const s = this.primary(t);
    if (MASTER_ZERO.has(s.id)) return 0;
    if (s.id !== 'outro') return 1;
    return 1 - smooth((t - s.start) / Math.max(0.01, s.end - s.start));
  }

  /** dark の光が上から降りる進み具合(0〜1) */
  coneDrop(t) {
    const dark = this.section('dark');
    if (!dark) return 1;
    return smooth((t - dark.start - CONE_DROP_WAIT) / CONE_DROP_SEC);
  }

  /** preroll の残りの秒(数字)。preroll でなければ 0 */
  countdown(t) {
    const s = this.primary(t);
    return s.id === 'preroll' ? Math.max(1, Math.ceil(s.end - t - 1e-6)) : 0;
  }

  /** 同期の区間の値。コマ番号(頭の区間だけ)と、フラッシュの明るさ。無ければ -1 と 0 */
  sync(frame) {
    const cfg = this.timeline.sync;
    if (!cfg) return { number: -1, flash: 0 };
    for (const id of ['sync_head', 'sync_tail']) {
      const s = this.section(id);
      if (!s) continue;
      const first = Math.round(s.start * this.fps);
      if (frame < first || frame >= Math.round(s.end * this.fps)) continue;
      const width = Math.round(cfg.flash_sec * this.fps);
      const flashing = cfg.flash_starts.some((sec) => {
        const at = first + Math.round(sec * this.fps);
        return frame >= at && frame < at + width;
      });
      return { number: id === 'sync_head' ? frame : -1, flash: flashing ? SYNC_FLASH_LEVEL : 0 };
    }
    return { number: -1, flash: 0 };
  }

  characterVisible(t) {
    const enter = this.section('enter');
    if (!enter || t < enter.start) return false;
    const outro = this.section('outro');
    return t < (outro ? outro.end : this.frames / this.fps);
  }

  /** enter の上がり具合(0=画面の下、1=定位置) */
  rise(t) {
    const enter = this.section('enter');
    if (!enter) return 1;
    const u = Math.min(1, Math.max(0, (t - enter.start) / (enter.end - enter.start)));
    return 1 - (1 - u) ** 3;
  }

  /** 体の向き(度)。主のセクションの turn_deg へなめらかに移る */
  turnDeg(t) {
    const s = this.primary(t);
    const of = (x) => this.motion.sections?.[x.id]?.turn_deg ?? 0;
    const now = of(s);
    const before = s.start > 0 ? of(this.primary(s.start - 1e-3)) : now;
    return lerp(before, now, smooth((t - s.start) / TURN_SEC));
  }

  /** 拍で弾む体の動き。床に着く瞬間が拍。y=上への量(m)、sq=つぶれ(0〜1)、sway=左右の傾き(度) */
  bounce(t) {
    const b = this.beat(t);
    const s = this.primary(t);
    const on = this.motion.sections?.[s.id]?.bounce ?? 0;
    if (!on || !b.active) return { y: 0, sq: 0, sway: 0 };
    const cfg = this.motion.bounce ?? {};
    const k = on * smooth((t - s.start) / 0.2) * smooth((s.end - t) / 0.4) * b.gain;
    const gain = 0.6 + 0.6 * this.energySm[this.frameOf(t)];
    return {
      y: k * gain * (cfg.height_m ?? 0) * Math.sin(Math.PI * b.phase),
      sq: k * gain * (cfg.squash ?? 0) * Math.exp(-b.phase * 9),
      sway: k * (cfg.sway_deg ?? 0) * Math.sin((Math.PI * b.pos) / 2),
    };
  }
}
