"""仮想の撮影: カットのルート(scout/rehearsal.py の CUTS)+手持ちの揺れの実記録 → 正解のカメラ(truth.json)。

  python place/shootlog/sim/sim_shoot.py cut --cut 3 --sec 8 --out <フォルダ>        # カットを撮る正解のカメラ
  python place/shootlog/sim/sim_shoot.py dots --out <フォルダ> [--station 1]          # 点の映像を撮る定位置(既定は 正面 13 m 手持ち)
出力: truth.json(UE の位置 cm・pitch/yaw/roll 度・focal mm。show/composite/render_comp.py がそのまま読む形)、
      truth_page.json(ページの座標のカメラ T と K。採点用)、cut.json(カット名・レンズ・ショーの始め秒)。
これを UE へ渡して正解の絵(Comp_PlateWith・Comp_PlateWithout)を撮る(サブ機。sim_ue.py)。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from sim_common import (FPS, H, W, Shake, apply_shake, fx_video, look_at_page, page_pose_to_ue_row, stage_to_page,  # noqa: E402
                        flat)

sys.path.insert(0, str(HERE.parent / "scout"))
import rehearsal  # noqa: E402  (CUTS・STATIONS・char_point。UE は起動しない)

FOCAL_W_MM = 36.0


def build_truth(route_fn, seconds, lens, shake, shake_from=0):
    """route_fn(t) → (位置 UE cm, 向く先 UE cm)。戻り: (truth rows, page の T の一覧, K)。"""
    fx = fx_video(lens)
    rows, pages = [], []
    for i in range(int(round(seconds * FPS))):
        t = i / FPS
        pos, target = route_fn(t)
        T = look_at_page(stage_to_page(pos), stage_to_page(target))
        if shake is not None:
            T = apply_shake(T, shake, i + shake_from)
        row = page_pose_to_ue_row(T, i)
        row["focal"] = fx * FOCAL_W_MM / W
        rows.append(row)
        pages.append(T)
    return rows, pages, [fx, fx, W / 2.0, H / 2.0]


def cut_route(cut):
    start, keys, look = cut["start"], cut["keys"], cut["look"]

    def route(t):
        pos = rehearsal.position_at(keys, t)
        target = rehearsal.char_point(start + t) if look == "char" else look
        return pos, target
    return route


def write_truth(out: Path, rows, pages, K, meta):
    out.mkdir(parents=True, exist_ok=True)
    (out / "truth.json").write_text(json.dumps({"rows": rows, "fx": K[0], "width": W, "height": H}), encoding="utf-8")
    (out / "truth_page.json").write_text(json.dumps({"T": [flat(T) for T in pages], "K": K, "w": W, "h": H, "fps": FPS}), encoding="utf-8")
    (out / "cut.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["cut", "dots"])
    ap.add_argument("--cut", type=int, default=3)
    ap.add_argument("--sec", type=float, help="カットの長さ(秒)。無ければカットの表の長さ")
    ap.add_argument("--station", type=int, default=1)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--shake-scale", type=float, default=1.0, help="揺れの倍率。0 で置いたまま")
    ap.add_argument("--shake-offset", type=float, default=0.0, help="実記録のどの秒から使うか")
    a = ap.parse_args()
    shake = Shake(scale=a.shake_scale, offset_s=a.shake_offset) if a.shake_scale > 0 else None
    if a.mode == "cut":
        cut = next(c for c in rehearsal.CUTS if c["no"] == a.cut)
        sec = a.sec or cut["sec"]
        lens = "wide" if cut["lens"] == "wide" else cut["lens"]
        rows, pages, K = build_truth(cut_route(cut), sec, lens, shake if cut["lens"] != "ultra" else None)
        meta = {"mode": "cut", "no": cut["no"], "name": cut["name"], "lens": lens, "show_start": cut["start"], "sec": sec,
                "shake": shake.stats() if shake else None, "note": "ショーの秒は show_stage.json から読んだ値(いつ撮ったかは cut.json の作成時刻)"}
    else:
        name, lens, pos, target, handheld = rehearsal.STATIONS[a.station]
        sec = rehearsal.DOT_SECONDS
        rows, pages, K = build_truth(lambda t: (pos, target), sec, lens, shake if handheld and lens != "ultra" else None)
        meta = {"mode": "dots", "station": a.station, "name": name, "lens": lens, "show_start": 0.0, "sec": sec, "shake": shake.stats() if shake and handheld else None}
    write_truth(a.out, rows, pages, K, meta)
    print(f"書いた: {a.out}  {len(rows)} コマ  {meta['name']}  レンズ {meta['lens']}  fx(1920 幅) {K[0]:.1f}  揺れ {meta['shake']}")


if __name__ == "__main__":
    main()
