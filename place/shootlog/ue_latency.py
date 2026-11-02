"""UE モニターの「動かしてから絵が動くまで」の遅れを、保存した測定(Documents/ue_link/latency_*.json)から出し直す。
アプリの中の見積もり(UELink.swift の LatencyEstimator)と同じ考え: ARKit の動きの速さと、返ってきた絵の動きの量を、時刻をずらしながら重ねて、いちばん合うずれを遅れとする。

  python place/shootlog/ue_latency.py <latency_*.json>     # 保存した測定から出し直す
  python place/shootlog/ue_latency.py --selftest            # 既知の遅れ(120 ms)を入れた合成データで確かめる
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def resample(series, t0, t1, step):
    a = np.array(sorted(series), dtype=float)
    t = np.arange(t0, t1, step)
    return np.interp(t, a[:, 0], a[:, 1])


def estimate(speed, motion, max_lag_ms=1000.0, step=10.0):
    if len(speed) < 20 or len(motion) < 20:
        return {"lag_ms": None, "confidence": 0.0, "note": f"データが少ない(ARKit {len(speed)}、絵 {len(motion)})"}
    s = np.array(sorted(speed)); m = np.array(sorted(motion))
    t0 = max(s[0, 0], m[0, 0] - max_lag_ms)
    t1 = min(s[-1, 0], m[-1, 0])
    if t1 - t0 < 3000:
        return {"lag_ms": None, "confidence": 0.0, "note": "重なる時間が短い"}
    sp = resample(speed, t0, t1, step)
    mo = resample(motion, t0, t1 + max_lag_ms, step)
    def norm(x):
        sd = x.std()
        return None if sd < 1e-9 else (x - x.mean()) / sd
    sn = norm(sp)
    if sn is None:
        return {"lag_ms": None, "confidence": 0.0, "note": "動きが足りない(iPhone をもっと大きく振る)"}
    cs = []
    for lag in range(int(max_lag_ms / step) + 1):
        seg = mo[lag:lag + len(sp)]
        mn = norm(seg) if len(seg) == len(sp) else None
        cs.append(0.0 if mn is None else float(np.mean(sn * mn)))
    k = int(np.argmax(cs))
    lag = k * step
    if 0 < k < len(cs) - 1:
        a, b, c = cs[k - 1], cs[k], cs[k + 1]
        d = a - 2 * b + c
        if abs(d) > 1e-9:
            lag += 0.5 * (a - c) / d * step
    return {"lag_ms": lag, "confidence": cs[k], "note": "ok" if cs[k] >= 0.5 else "相関が弱い(振りが足りない、または絵が動きに追従していない)"}


def selftest():
    rng = np.random.default_rng(2)
    t = np.arange(0, 12000, 1000 / 30.0)                              # ARKit 30 Hz(ms)
    def motion_fn(x):                                                 # 振る動き(速さ)
        return np.abs(np.sin(x / 700.0)) * (1 + 0.5 * np.sin(x / 1900.0)) + 0.05
    speed = [(1e12 + float(x), float(motion_fn(x)) + rng.normal(0, 0.02)) for x in t]
    true_lag = 120.0
    tv = np.arange(0, 12000, 1000 / 42.0) + rng.normal(0, 3, int(12000 / (1000 / 42.0)) + 1)[: len(np.arange(0, 12000, 1000 / 42.0))]
    motion = [(1e12 + float(x), float(motion_fn(x - true_lag)) + rng.normal(0, 0.03)) for x in tv]
    r = estimate(speed, motion)
    err = abs(r["lag_ms"] - true_lag)
    print(f"真の遅れ {true_lag:.0f} ms → 推定 {r['lag_ms']:.1f} ms(誤差 {err:.1f} ms、確かさ {r['confidence']:.2f})")
    print("合格" if err < 15 and r["confidence"] > 0.8 else "不合格")
    raise SystemExit(0 if err < 15 and r["confidence"] > 0.8 else 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json", nargs="?")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest()
    d = json.loads(Path(a.json).read_text(encoding="utf-8"))
    r = estimate([tuple(x) for x in d["speed"]], [tuple(x) for x in d["motion"]])
    print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main()
