"""E30 の自動の最適化(自動写真判定の形): 手本(画像生成、角度ごとに複数枚)と CC5 の絵を計算で比べた数字 J を、モーフを動かして下げる反復。
AI の文章の判断は使わない。測りは顔の点の部位別の差(%IOD、手本の点を基準)を、0°・約 30°・約 50° で出し、基準(反復の始め)で割って重みづけした和 J。
1 反復: 現在の状態を撮る → 各モーフを ±δ 動かして撮る(傾き g と曲がり h)→ 1 つずつのニュートン法の一歩(a = −g/h、|a| ≤ amax)を足し合わせて当てる
→ 撮って J が下がれば採用、下がらなければ半分の歩幅でもう 1 回 → 採用/不採用を記録。CC5 側は作業用 PC のポート 5111(P3 を開いた状態)。P3 は保存しない。終わりに全モーフを元の値へ戻す。
止まる条件: 2 反復続けて採用の改善が noise_floor(既定 J の 1%)未満 / 2 反復続けて不採用 / 時間切れ(--deadline HH:MM)。
使い方: python e30_loop.py --out work\\cc5_eval\\E30L --probes probes.json [--state state.json] [--iters 2] [--delta 0.15] [--amax 0.5] [--deadline 22:55]"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import et_cc5 as E  # noqa: E402

T = os.path.dirname(os.path.abspath(__file__))
PY_VENV = r"work\local_3d_compare\venvs\w3_mediapipe\Scripts\python.exe"
W = {"0": 0.5, "30": 0.3, "50": 0.2}
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--probes", required=True)
ap.add_argument("--state", default="")
ap.add_argument("--iters", type=int, default=2)
ap.add_argument("--delta", type=float, default=0.15)
ap.add_argument("--amax", type=float, default=0.5)
ap.add_argument("--noise-floor", type=float, default=0.01)
ap.add_argument("--deadline", default="")
ap.add_argument("--port", type=int, default=5111)
a = ap.parse_args()
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
client = E.Client(a.port, None, 90, False)
probes = json.load(open(a.probes, encoding="utf-8"))
state = json.load(open(a.state, encoding="utf-8")) if a.state else {}
base, applied = {}, {}


def log(*m):
    s = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in m)
    print(s, flush=True)
    with open(out / "loop.log", "a", encoding="utf-8") as f:
        f.write(s + "\n")


def getb(mid):
    if mid not in base:
        base[mid] = float(client.post("/morph/get", {"morph_id": mid})["value"])
        applied[mid] = 0.0
    return base[mid]


def apply(target):
    """target: {morph: 基準からの差}。違う物だけ /morph/set。載っていない物は 0 に戻す。"""
    for mid in set(list(target) + [m for m, v in applied.items() if abs(v) > 1e-9]):
        want = float(target.get(mid, 0.0))
        b = getb(mid)
        v = max(-1.0, min(1.0, b + want))
        if abs(applied.get(mid, 0.0) - (v - b)) > 1e-9:
            client.post("/morph/set", {"morph_id": mid, "value": v})
            applied[mid] = v - b


def shoot(d):
    sub = argparse.Namespace(protocol=os.path.join(T, "protocol_e30.json"), avatar="HD Neutral F", sets="side_yaw", out=str(d), project=None, machine="pc1", matched_rx=None, cc5_version=None)
    E.shoot(client, sub)


def score(dirs):
    dj, oj = out / "dirs.json", out / "scores.json"
    json.dump([str(d) for d in dirs], open(dj, "w", encoding="utf-8"))
    r = subprocess.run([PY_VENV, os.path.join(T, "e30_score_dirs.py"), "--dirs", str(dj), "--out", str(oj)], capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        raise RuntimeError("測りが失敗: " + (r.stderr or r.stdout)[-300:])
    return json.load(open(oj, encoding="utf-8"))


JB = {}


def J(sc):
    tot = 0.0
    for ang, w in W.items():
        s = sc.get(ang)
        if s is None:
            return None
        tot += w * s["all"] / JB[ang]
    return tot


def late():
    return a.deadline and time.strftime("%H:%M") >= a.deadline


try:
    log("開始 状態", len(state), "個、probes", len(probes), "個")
    apply(state)
    d0 = out / "i0_cur"
    shoot(d0)
    sc = score([d0])[str(d0)]
    JB.update({k: sc[k]["all"] for k in W})
    j_cur = J(sc)
    hist = [{"iter": 0, "J": j_cur, "regions": sc}]
    log("反復 0 J =", round(j_cur, 4), {k: round(sc[k]["all"], 3) for k in W})
    small, rejected = 0, 0
    for it in range(1, a.iters + 1):
        if late():
            log("時間切れ(deadline)")
            break
        pd = {}
        for k, mid in enumerate(probes):
            if late():
                break
            for sign, nm in ((1, "p"), (-1, "m")):
                t = dict(state)
                t[mid] = state.get(mid, 0.0) + sign * a.delta
                if abs(getb(mid) + t[mid]) > 1.0:
                    continue
                apply(t)
                d = out / f"i{it}_pr{k:02d}_{nm}"
                shoot(d)
                pd[(mid, nm)] = d
        apply(state)
        sc_all = score(list(pd.values()))
        jc = j_cur
        step = {}
        info = []
        for mid in probes:
            jp, jm = pd.get((mid, "p")), pd.get((mid, "m"))
            vp = J(sc_all[str(jp)]) if jp else None
            vm = J(sc_all[str(jm)]) if jm else None
            if vp is None and vm is None:
                continue
            if vp is not None and vm is not None:
                g = (vp - vm) / (2 * a.delta)
                h = (vp + vm - 2 * jc) / (a.delta ** 2)
                ai = -g / h if h > 1e-6 else -a.amax * (1 if g > 0 else -1)
            else:
                v, sg = (vp, 1) if vp is not None else (vm, -1)
                ai = sg * a.delta if v < jc else 0.0
                g, h = 0.0, 0.0
            ai = max(-a.amax, min(a.amax, ai))
            pred = -(g * ai + 0.5 * h * ai * ai) if (vp is not None and vm is not None) else 0.0
            if abs(ai) > 1e-6 and (pred > 0.001 or (vp is None or vm is None)):
                step[mid] = ai
            info.append({"morph": mid, "g": round(g, 5), "h": round(h, 5), "a": round(ai, 3), "pred": round(pred, 5)})
        json.dump(info, open(out / f"i{it}_probe_info.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        log(f"反復 {it}: 一歩に入る morph", len(step), "個")
        best = None
        for scale in (1.0, 0.5):
            t = dict(state)
            for mid, v in step.items():
                t[mid] = max(-1.0, min(1.0, t.get(mid, 0.0) + scale * v))
            apply(t)
            d = out / f"i{it}_try_s{int(scale * 10):02d}"
            shoot(d)
            scs = score([d])[str(d)]
            jt = J(scs)
            log(f"  歩幅 {scale}: J = {round(jt, 4)}(現在 {round(jc, 4)})")
            if jt is not None and (best is None or jt < best[0]):
                best = (jt, t, scs, scale)
            if jt is not None and jt < jc - a.noise_floor:
                break
        gain = jc - best[0] if best else 0.0
        if best and gain > 0:
            state = best[1]
            apply(state)
            d_new = out / f"i{it}_cur"
            os.rename(out / f"i{it}_try_s{int(best[3] * 10):02d}", d_new)
            j_cur = best[0]
            hist.append({"iter": it, "J": best[0], "gain": gain, "scale": best[3], "regions": best[2], "state_size": len(state)})
            json.dump(state, open(out / f"state_i{it}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            log(f"  採用 J {round(jc, 4)} → {round(best[0], 4)}(改善 {round(gain, 4)})")
            rejected = 0
            small = small + 1 if gain < a.noise_floor else 0
        else:
            hist.append({"iter": it, "J": jc, "gain": 0.0, "note": "不採用"})
            apply(state)
            log("  不採用")
            rejected += 1
        json.dump(hist, open(out / "history.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        if small >= 2 or rejected >= 2:
            log("止まる条件(2 反復続けて noise_floor 未満 / 不採用)")
            break
finally:
    try:
        apply({})
        log("全モーフを元の値へ戻した")
    except Exception as e:  # noqa: BLE001
        log("戻しに失敗:", str(e)[:200])
json.dump(state, open(out / "state_final.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
log("終了")
