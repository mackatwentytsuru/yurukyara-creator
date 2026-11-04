"""カットの計画(線 F): 全カット(番号は rehearsal.py の CUTS のまま)+超広角の全景(12 番)を、サブ機の UE で 1280 幅の JPG で撮り、
rehearsal_sheet.py で 1 枚の絵にする。

  python place/shootlog/sim/sim_cutplan.py shoot [--only 1 2 3]     # 撮る(カットごとにサブ機で 1 回)
  python place/shootlog/sim/sim_cutplan.py sheet --jpg <出力 jpg> [--when "11-04 18:30"]
撮るのは Beauty(正解のカメラで、LED の絵と舞台のキャラが両方入った絵)。カメラは実測の手持ちの揺れ入り(広角・寄り)、超広角は置いたまま。
ショーの全編はこのあと変わるので、いつ撮った物かを絵の一番上に書く。
"""
from __future__ import annotations

import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sim_shoot  # noqa: E402
from sim_common import OUT, Shake  # noqa: E402

rehearsal = sim_shoot.rehearsal
WORK = Path("work/cutplan")
CUT12 = dict(no=12, name="超広角の全景 後ろ 15 m", lens="ultra", start=rehearsal.at("out", 0, 0.0), sec=6.0, keys=[(0, (0, 1500, 200))], look=rehearsal.LED_MIDDLE, walk="置いたまま")


def all_cuts():
    return rehearsal.CUTS + [CUT12]


def shoot(a):
    only = set(a.only or [])
    shake = Shake()
    WORK.mkdir(parents=True, exist_ok=True)
    started = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    (WORK / "when.txt").write_text(started, encoding="utf-8")
    for cut in all_cuts():
        if only and cut["no"] not in only:
            continue
        d = WORK / f"cut_{cut['no']:02d}"
        d.mkdir(exist_ok=True)
        lens = cut["lens"]
        rows, pages, K = sim_shoot.build_truth(sim_shoot.cut_route(cut), cut["sec"], lens, shake if lens != "ultra" else None)
        sim_shoot.write_truth(d, rows, pages, K, {"mode": "cut", "no": cut["no"], "name": cut["name"], "lens": lens, "show_start": cut["start"], "sec": cut["sec"]})
        cmd = [sys.executable, str(HERE / "sim_ue.py"), "run", "--shoot", str(d), "--name", f"plan{cut['no']}", "--passes", "Comp_BeautyWith", "--provisional", "--jpg", "--keep-jpg",
               "--res", "1280x720", "--media", "rehearsal", "--show-start", str(cut["start"])]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", stdin=subprocess.DEVNULL)
        print(f"カット {cut['no']}: 終了 {r.returncode}", (r.stdout.strip().splitlines() or [""])[-1][:200], flush=True)
        if r.returncode != 0:
            print(r.stdout[-600:], r.stderr[-600:], flush=True)
            continue
        frames = d / "frames" / "Comp_BeautyWith"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", str(frames / "f.%04d.jpeg"), "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-map_metadata", "-1", "-threads", "6",
                        str(WORK / f"cut_{cut['no']:02d}.mp4")], check=True)


def sheet(a):
    from PIL import Image, ImageDraw, ImageFont
    sys.path.insert(0, str(HERE.parent / "scout"))
    import rehearsal_sheet
    from rehearsal_sheet import FONT, make_sheet
    rehearsal_sheet.NOTE2 = "UE の仮想の撮影。本物の LED の明るさ・色は含まない"
    ns = argparse.Namespace(out=str(WORK), sheet=str(WORK / "sheet_raw.jpg"), movie=None)
    make_sheet(ns, [c for c in all_cuts() if (WORK / f"cut_{c['no']:02d}.mp4").exists()], rehearsal.FX, {**rehearsal.LENS_JP})
    img = Image.open(WORK / "sheet_raw.jpg")
    when = a.when or (WORK / "when.txt").read_text(encoding="utf-8")
    bar_h = 80
    out = Image.new("RGB", (img.width, img.height + bar_h * 2), (0, 0, 0))
    d = ImageDraw.Draw(out)
    font = ImageFont.truetype(FONT, 56)
    d.rectangle((0, 0, img.width, bar_h * 2), fill=(90, 40, 20))
    d.text((12, 8), f"仮想 iPad のカット案(UE を {when} に撮影)", fill=(255, 255, 255), font=font)
    d.text((12, 8 + bar_h), "ショーの全編はこのあと変わる。秒は撮った時の show_stage.json", fill=(255, 220, 160), font=font)
    out.paste(img, (0, bar_h * 2))
    Path(a.jpg).parent.mkdir(parents=True, exist_ok=True)
    out.save(a.jpg, quality=88)
    print("書いた:", a.jpg, out.size)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)
    p = sub.add_parser("shoot")
    p.add_argument("--only", nargs="*", type=int)
    p = sub.add_parser("sheet")
    p.add_argument("--jpg", required=True)
    p.add_argument("--when")
    a = ap.parse_args()
    {"shoot": shoot, "sheet": sheet}[a.mode](a)


if __name__ == "__main__":
    main()
