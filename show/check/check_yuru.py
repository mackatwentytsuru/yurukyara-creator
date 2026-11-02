"""ゆるキャラのショーの映像を、数字と確認シートで確かめる(check_show.py の部品を使う)。
使い方: python show/check/check_yuru.py --video-dir <video> --timeline <timeline.json> --cast show/yuru_cast.json [--name yuru] [--sheet <出力>]
出力: <video-dir>/check.json、シート(既定 <video-dir>/sheet.jpg)。全部合格なら終了番号 0、1 つでも不合格なら 1。
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
from check_show import (AV_MAX_SEC, BLACK_MAX, FLASH_RANGE, FONT, H, MEAN_MAX, SEAM_L, SEAM_R, W, WHITE_MAX_PERCENT,  # noqa: E402
                        flash_frames, grab, measure_brightness, probe)

FACE_RANGE = {"A": (0, SEAM_L), "B": (SEAM_L, SEAM_R), "C": (SEAM_R, 4300)}
FACE_TOP, FACE_BOTTOM = 85, 1218
CELL_W, CELL_H = 2000, 437
LABEL_SIZE = 92  # 幅 2000 の絵で 92 px = 幅 400 に縮めて約 18 px
# シートの行: (ショーの頭からの秒または区間の id と割合, ラベル)
SHEET_SHOW = [(0.9, "登場(順に)"), (4.5, "波の踊り"), (7.9, "低音が抜ける・手を振る"), (8.8, "全員の決め"), (13.0, "波の踊り 2"), (15.4, "順に回る"), (18.3, "手を振る 2"), (21.5, "全員でおじぎ")]


def check_boxes(video_dir, cast):
    data = json.loads((video_dir / "character_box.json").read_text(encoding="utf-8"))
    per = {str(i): [] for i in range(len(cast))}
    for row in data["frames"]:
        for key, box in row["boxes"].items():
            if box:
                per[key].append(box)
    out = {"ok": True, "characters": {}}
    for i, entry in enumerate(cast):
        boxes = np.array(per[str(i)], float)
        if not len(boxes):
            out["ok"] = False
            out["characters"][entry["id"]] = {"ok": False, "why": "枠のあるコマがない"}
            continue
        union = [float(boxes[:, 0].min()), float(boxes[:, 1].min()), float(boxes[:, 2].max()), float(boxes[:, 3].max())]
        a, b = FACE_RANGE[entry["face"]]
        ok = union[0] >= a and union[2] <= b and union[1] >= FACE_TOP and union[3] <= FACE_BOTTOM
        out["ok"] = out["ok"] and ok
        out["characters"][entry["id"]] = {"ok": ok, "face": entry["face"], "frames": len(boxes), "union_box": union, "margin_to_face": [union[0] - a, b - union[2]], "height_rest_px_scale": data.get("scale")}
    # 隣のキャラと重ならないこと
    overlaps = 0
    for row in data["frames"]:
        items = sorted((b for b in row["boxes"].values() if b), key=lambda v: v[0])
        overlaps += sum(1 for p, n in zip(items, items[1:]) if p[2] > n[0])
    out["frames_with_overlap"] = overlaps
    out["ok"] = out["ok"] and overlaps == 0
    return out


def make_sheet(master, timeline, path):
    show = next(s for s in timeline["sections"] if s["id"] == "show")
    rows = [(10.0, "待ち(数字だけ)"), (show["start"] - 12 + 1.05, "同期のフラッシュ")]
    rows += [(show["start"] + sec, label) for sec, label in SHEET_SHOW]
    rows += [(show["end"] + 1.5, "黒"), (show["end"] + 3 + 1.05, "同期(終わり)")]
    font = ImageFont.truetype(FONT, LABEL_SIZE)
    k = CELL_W / W
    sheet = Image.new("RGB", (CELL_W, (CELL_H + 12) * len(rows)), (24, 24, 30))
    for row, (t, label) in enumerate(rows):
        cell = grab(master, t).convert("RGBA")
        overlay = Image.new("RGBA", cell.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        for x in (SEAM_L, SEAM_R):
            draw.line([(x * k, 0), (x * k, CELL_H)], fill=(255, 240, 0, 230), width=6)
        text = f"{label} {t:.1f}秒"
        draw.rectangle((0, 0, 36 + draw.textlength(text, font=font), LABEL_SIZE + 26), fill=(0, 0, 0, 190))
        draw.text((14, 4), text, fill=(255, 255, 255, 255), font=font)
        sheet.paste(Image.alpha_composite(cell, overlay).convert("RGB"), (0, row * (CELL_H + 12)))
    sheet.save(path, quality=90)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video-dir", required=True)
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--cast", required=True)
    ap.add_argument("--name", default="yuru")
    ap.add_argument("--sheet")
    a = ap.parse_args()
    video_dir = Path(a.video_dir)
    timeline = json.loads(Path(a.timeline).read_text(encoding="utf-8"))
    cast = json.loads(Path(a.cast).read_text(encoding="utf-8"))["characters"]
    fps, frames = timeline["fps"], timeline["frames"]
    master = video_dir / "master.mov"
    results = {}

    used = json.loads((video_dir / "render_stats.json").read_text(encoding="utf-8")).get("timeline_sha256")
    results["timeline_same"] = {"ok": used == hashlib.sha256(Path(a.timeline).read_bytes()).hexdigest()}

    info = probe(master, "stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_read_packets,duration")
    count = int(info.get("nb_read_packets", 0))
    results["master"] = {"ok": info.get("width") == W and info.get("height") == H and info.get("r_frame_rate") == "60/1" and "10" in info.get("pix_fmt", "") and count == frames, "info": info, "frames_expected": frames}

    for suffix, codec, pix in ((".mov", "hevc", "yuv420p10le"), (".mp4", "h264", "yuv420p")):
        path = video_dir / f"{a.name}{suffix}"
        if not path.exists():
            results[f"deliver{suffix}"] = {"ok": False, "why": f"{path.name} がない"}
            continue
        v = probe(path, "stream=codec_name,codec_tag_string,pix_fmt,width,height,r_frame_rate,nb_read_packets,duration")
        s = probe(path, "stream=codec_name,sample_rate,channels,duration", "a:0")
        diff = abs(float(v.get("duration", 0)) - float(s.get("duration", -1)))
        ok = v.get("codec_name") == codec and v.get("pix_fmt") == pix and v.get("width") == W and v.get("height") == H and v.get("r_frame_rate") == "60/1" and int(v.get("nb_read_packets", 0)) == count and diff <= AV_MAX_SEC
        if suffix == ".mov":
            ok = ok and v.get("codec_tag_string") == "hvc1" and s.get("codec_name") == "pcm_s24le" and s.get("sample_rate") == "48000"
        results[f"deliver{suffix}"] = {"ok": bool(ok), "video": v, "audio": s, "av_diff_sec": round(diff, 4)}

    results["character_box"] = check_boxes(video_dir, cast)

    means, whites, black, digit_seen = measure_brightness(master, timeline)
    results["preroll_black"] = {"ok": bool(black["preroll"]) and max(black["preroll"]) <= BLACK_MAX and digit_seen == len(black["preroll"]), "max_outside_digit": max(black["preroll"], default=None), "frames_with_digit": digit_seen, "frames": len(black["preroll"])}
    for sid in ("sync_head", "tail", "sync_tail", "black_end"):
        results[f"{sid}_black"] = {"ok": bool(black[sid]) and max(black[sid]) <= BLACK_MAX, "max": max(black[sid], default=None), "frames": len(black[sid])}
    flash_list = flash_frames(timeline)
    flash_means = [round(means[i], 1) for i in flash_list if i < len(means)]
    flash_set = set(flash_list)
    neighbors = [round(means[i], 1) for f in flash_list for i in (f - 1, f + 1) if i not in flash_set and i < len(means)]
    results["sync_flash"] = {"ok": len(flash_means) == len(flash_list) > 0 and all(FLASH_RANGE[0] <= v <= FLASH_RANGE[1] for v in flash_means) and max(neighbors) < 20, "frames": len(flash_list), "means_range": [min(flash_means), max(flash_means)], "means_next_to_flash_max": max(neighbors)}

    show = next(s for s in timeline["sections"] if s["id"] == "show")
    sa, sb = int(round(show["start"] * fps)), int(round(show["end"] * fps))
    plain = [v for i, v in enumerate(means) if i not in flash_set]
    results["brightness"] = {"ok": max(plain) < MEAN_MAX and max(whites) <= WHITE_MAX_PERCENT, "mean_max_without_flash": round(max(plain), 1), "white_percent_max": round(max(whites), 3),
                             "show_mean": round(float(np.mean(means[sa:sb])), 1), "show_white_percent_max": round(max(whites[sa:sb]), 3)}

    sheet_path = Path(a.sheet) if a.sheet else video_dir / "sheet.jpg"
    make_sheet(master, timeline, sheet_path)
    all_ok = all(item.get("ok") for item in results.values())
    (video_dir / "check.json").write_text(json.dumps({"ok": bool(all_ok), "sheet": str(sheet_path), "checks": results}, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    for name, item in results.items():
        print("合格" if item.get("ok") else "不合格", name)
    print("全部合格" if all_ok else "不合格があります", video_dir / "check.json")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
