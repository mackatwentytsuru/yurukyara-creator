"""人の方へ首を向ける制御(純粋な計算。カメラにも時計にも触らない)。**動かしすぎない**ための決まり:
- 顔が中央から不感帯の外にいて、かつ一定時間 安定して見えているときだけ動く
- 1 回の動きは小さく(max_step。位置の単位で 0.1 = 約 3.5°)、動いたあとは動き終わるまで待つ(settle_s)。待つあいだの顔の位置は信じない
- 動かした量を積算し、家の位置から ±limit を超える方向には動かさない(戻る方向は許す)
- 顔が見えなくなったら動かない(探し回らない)。見えない時間が idle_home_s を超えたら、家の位置へ戻す指示を 1 回だけ出す
注意: 首を振ると、カメラの向きが変わり、視線合わせの校正(カメラの置き場所・向き)が合わなくなる。
視線合わせに使う間は固定し、首振りは「人を見つける」ためだけに使う(計画書 15 章)。
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class FollowConfig:
    deadband: float = 0.12  # 中央からのずれ(-1〜1)がこれ以内なら動かない
    gain: float = 0.3  # ずれ 1(画面の端)あたりの動く量(位置の単位)
    max_step: float = 0.1  # 1 回の動きの上限(位置の単位。約 3.5°)
    settle_s: float = 1.5
    stable_s: float = 0.6
    limit_pan: float = 0.4  # 家の位置からの積算の上限(位置の単位)
    limit_tilt: float = 0.3
    idle_home_s: float = 30.0
    invert_pan: bool = False
    invert_tilt: bool = False


@dataclass
class Action:
    kind: str  # "move" か "home"
    pan: float = 0.0  # 動かす量(位置の単位)
    tilt: float = 0.0


@dataclass
class Follower:
    cfg: FollowConfig = field(default_factory=FollowConfig)
    acc_pan: float = 0.0
    acc_tilt: float = 0.0
    _seen_since: float | None = None
    _last_seen: float | None = None
    _blind_until: float = 0.0
    _homed: bool = True

    def update(self, now: float, found: bool, cx: float = 0.5, cy: float = 0.5) -> Action | None:
        c = self.cfg
        if not found:
            self._seen_since = None
            if not self._homed and self._last_seen is not None and now - self._last_seen >= c.idle_home_s:
                self._homed = True
                self.acc_pan = self.acc_tilt = 0.0
                return Action("home")
            return None
        self._last_seen = now
        if now < self._blind_until:
            return None  # 動いた直後の映像は、まだ動く前の絵が混ざる
        if self._seen_since is None:
            self._seen_since = now
        if now - self._seen_since < c.stable_s:
            return None
        ex = (cx - 0.5) * 2.0
        ey = (cy - 0.5) * 2.0
        pan = 0.0 if abs(ex) <= c.deadband else _clamp(c.gain * ex, c.max_step)
        tilt = 0.0 if abs(ey) <= c.deadband else _clamp(-c.gain * ey, c.max_step)  # 画像の下 = 首を下へ
        if c.invert_pan:
            pan = -pan
        if c.invert_tilt:
            tilt = -tilt
        pan = self._within(pan, self.acc_pan, c.limit_pan)
        tilt = self._within(tilt, self.acc_tilt, c.limit_tilt)
        if pan == 0.0 and tilt == 0.0:
            return None
        self.acc_pan += pan
        self.acc_tilt += tilt
        self._blind_until = now + c.settle_s
        self._seen_since = None
        self._homed = False
        return Action("move", pan, tilt)

    @staticmethod
    def _within(v: float, acc: float, limit: float) -> float:
        """積算が上限を超える向きには動かさない(戻る向きは許す)"""
        if v == 0.0:
            return 0.0
        nxt = acc + v
        if abs(nxt) > limit and abs(nxt) > abs(acc):
            return 0.0
        return v


def _clamp(v: float, m: float) -> float:
    return max(-m, min(m, v))
