// 外から位置を受け取る入力。カメラは使わない。
//   - VR(Quest 3): ヘッドセットの位置 = 見ている人の頭。three の camera.getWorldPosition() を毎フレーム setViewer へ
//   - AR(iPhone の殻アプリ): ARKit の端末の姿勢 = 見ている人の頭。殻が送ってくる位置を setViewer へ
//   - 殻の顔追跡など、複数人の位置が分かるとき: setPeople([{ id, position, speaking }])
// 座標は place.json と同じ(ワールド、単位 m、y が上、右手系)。
// 一定時間(staleMs)更新が無ければ「いなくなった」とみなす。

const MAX_PEOPLE = 8;
const MAX_COORD_M = 1000; // 部屋の座標としてありえない遠さ(殻の初期化中の巨大な値などを捨てる)

export class PoseSource {
  constructor({ staleMs = 1500 } = {}) {
    this.kind = 'pose';
    this.staleMs = staleMs;
    this.people = [];
    this.updatedAt = 0;
    this.started = false;
  }

  async start() {
    this.started = true;
  }

  stop() {
    this.started = false;
    this.people = [];
  }

  /** 見ている人の頭のワールド座標(1 人)。null なら誰もいない */
  setViewer(position) {
    this.setPeople(position ? [{ id: 'viewer', position }] : []);
  }

  /**
   * 外(殻アプリ・VR)から届く値は信じない。3 つの数が有限で、部屋の外ほど遠くない物だけを受け取る。
   * 形のおかしい人は捨てる(1 人でも NaN が入ると、キャラの首が壊れ、以降の計算が全部 NaN になる)。
   */
  setPeople(people) {
    const vec = (v) => {
      const a = v && typeof v.length === 'number' && v.length === 3 ? Array.from(v, Number) : null;
      return a && a.every((x) => Number.isFinite(x) && Math.abs(x) <= MAX_COORD_M) ? a : null;
    };
    this.people = (Array.isArray(people) ? people : [])
      .slice(0, MAX_PEOPLE)
      .map((p) => ({ p, position: vec(p?.position) }))
      .filter((x) => x.position)
      .map(({ p, position }) => ({
        id: p.id,
        position,
        gaze: vec(p.gaze) ?? undefined,
        speaking: typeof p.speaking === 'boolean' ? p.speaking : undefined,
        mouth: Number.isFinite(p.mouth) ? Math.min(Math.max(p.mouth, 0), 1) : undefined,
      }));
    this.updatedAt = performance.now();
  }

  getPeople(nowMs = performance.now()) {
    return nowMs - this.updatedAt > this.staleMs ? [] : this.people;
  }

  info() {
    return { label: this.people.length ? '位置を受信中' : '位置を待っています', ok: this.people.length > 0 };
  }
}
