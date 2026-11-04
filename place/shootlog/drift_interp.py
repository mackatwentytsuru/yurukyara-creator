"""ARKit の向きのずれを、撮影の頭と終わりの 2 回の点の校正から直線で補間して、撮影フォルダの frames.jsonl の向きから引く。

  python place/shootlog/drift_interp.py --shoot <撮影フォルダ> --head-rays <頭の点のレイ json> --end-rays <終わりの点のレイ json> \
         --head-min <頭の校正の時刻(分)> --end-min <終わりの校正の時刻(分)> --take-min <このテイクの最初のコマの時刻(分)>

考え方: 頭の校正で ARKit の世界とページの LED の座標の合わせ(T)を解く。終わりの校正のレイは、そのあいだに溜まった向きのずれ Rw の分だけ、T から予想される方向と
ずれる(レイの原点はずれない。実測で位置のずれは 0.2 cm)。全レイの「予想の方向 → 実際の方向」への最適な回転(Wahba)を Rw とする。
テイクの時刻 τ では、ずれを rotvec(Rw) × (τ − 頭) / (終わり − 頭) と見なし(直線の補間)、各コマの向きの回転の左から引く。
frames.jsonl は frames_raw.jsonl に写してから書き換える。直したあとに shoot_track.build_track を通す。
時刻の単位は分で、3 つとも同じ原点でよい。レイは {dot,o,d} か CAL1 の {dot,origin,direction}。
限界: ずれが直線に増えない分(実測では 0〜10 分で 1 分あたり 0.29→0.56→0.38→0.43°/分と凹凸)は残る。10 分より先は実測が無い。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation as R

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dots_align  # noqa: E402

FPS = 30.0


def _norm_rays(rays):
    out = []
    for r in rays:
        o = r.get("o", r.get("origin"))
        d = r.get("d", r.get("direction"))
        out.append({"dot": int(r["dot"]), "o": np.array(o, float), "d": np.array(d, float) / np.linalg.norm(d)})
    return out


def estimate_rotation(head_rays, end_rays):
    """頭のレイで T を解き、終わりのレイとの間の世界の回転 Rw(scipy Rotation)を返す。戻り: (Rw, 情報)。"""
    head = dots_align.solve([{"face": "A", "dot": r["dot"], "origin": list(r["o"]), "direction": list(r["d"])} for r in _norm_rays(head_rays)])
    if not head["ok"]:
        raise RuntimeError("頭の校正が通らない: " + head["reason"])
    T = np.array(head["T"], float).reshape(4, 4)
    end = _norm_rays(end_rays)
    tgt, act = [], []
    for r in end:
        p = T @ np.append(np.array(dots_align.DOTS[r["dot"]]["p"], float), 1.0)
        v = p[:3] - r["o"]
        tgt.append(v / np.linalg.norm(v))
        act.append(r["d"])
    tgt, act = np.array(tgt), np.array(act)
    keep = np.ones(len(tgt), bool)
    Rw = R.identity()
    for _ in range(4):
        Rw, _ = R.align_vectors(act[keep], tgt[keep])
        err = np.degrees(np.arccos(np.clip(np.sum((Rw.apply(tgt) * act), 1), -1, 1)))
        lim = max(0.3, 2.5 * float(np.median(err[keep])))
        new = err <= lim
        if new.sum() < 8 or (new == keep).all():
            break
        keep = new
    err = np.degrees(np.arccos(np.clip(np.sum((Rw.apply(tgt) * act), 1), -1, 1)))
    info = {"n_end_rays": len(end), "n_used": int(keep.sum()), "rotation_deg": float(np.degrees(np.linalg.norm(Rw.as_rotvec()))), "residual_deg_median": float(np.median(err[keep])),
            "head_rms_cm": head["rms_cm"]}
    return Rw, info


def apply(shoot: Path, Rw, head_min, end_min, take_min):
    """frames.jsonl の向きから、補間したずれを引く。戻り: 最初と最後のコマで引いた角度(度)。"""
    f = shoot / "frames.jsonl"
    raw = shoot / "frames_raw.jsonl"
    if not raw.exists():
        shutil.copyfile(f, raw)
    rv = Rw.as_rotvec()
    out, ang = [], []
    for line in raw.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        tau = take_min + int(row["i"]) / FPS / 60.0
        frac = (tau - head_min) / (end_min - head_min)
        Rc = R.from_rotvec(rv * frac)
        T = np.array(row["T"], float).reshape(4, 4).T
        T[:3, :3] = (Rc.inv() * R.from_matrix(T[:3, :3])).as_matrix()
        row["T"] = [float(v) for v in T.T.reshape(-1)]
        out.append(json.dumps(row, ensure_ascii=False))
        ang.append(float(np.degrees(np.linalg.norm(rv * frac))))
    f.write_text("\n".join(out) + "\n", encoding="utf-8")
    return ang[0], ang[-1]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--shoot", required=True, type=Path)
    ap.add_argument("--head-rays", required=True, type=Path)
    ap.add_argument("--end-rays", required=True, type=Path)
    ap.add_argument("--head-min", required=True, type=float)
    ap.add_argument("--end-min", required=True, type=float)
    ap.add_argument("--take-min", required=True, type=float)
    a = ap.parse_args()
    if a.end_min <= a.head_min:
        sys.exit("終わりの校正は頭より後にする")
    Rw, info = estimate_rotation(json.loads(a.head_rays.read_text(encoding="utf-8")), json.loads(a.end_rays.read_text(encoding="utf-8")))
    first, last = apply(a.shoot, Rw, a.head_min, a.end_min, a.take_min)
    info.update(subtracted_deg_first=first, subtracted_deg_last=last)
    (a.shoot / "drift_interp.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(info, ensure_ascii=False))


if __name__ == "__main__":
    main()
