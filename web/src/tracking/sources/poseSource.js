// 外から位置を受け取る入力。カメラは使わない。
//   - VR(Quest 3): ヘッドセットの位置 = 見ている人の頭。three の camera.getWorldPosition() を毎フレーム setViewer へ
//   - AR(iPhone の殻アプリ): ARKit の端末の姿勢 = 見ている人の頭。殻が送ってくる位置を setViewer へ
//   - 殻の顔追跡など、複数人の位置が分かるとき: setPeople([{ id, position, speaking }])
// 座標は place.json と同じ(ワールド、単位 m、y が上、右手系)。
// 一定時間(staleMs)更新が無ければ「いなくなった」とみなす。

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

  setPeople(people) {
    this.people = people.map((p) => ({
      id: p.id,
      position: Array.from(p.position),
      gaze: p.gaze ? Array.from(p.gaze) : undefined,
      speaking: p.speaking,
      mouth: p.mouth,
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
