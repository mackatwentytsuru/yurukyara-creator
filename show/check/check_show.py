"""ショーの映像を、数字と確認シートで確かめる。
使い方: python show/check/check_show.py --video-dir <版/video> --timeline <timeline.json> [--name show] [--audio <wav>]
出力: <video-dir>/check.json、<video-dir>/sheet.jpg
全部合格なら終了番号 0、1 つでも不合格なら 1。
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 5680, 1240
SEAM_L, SEAM_R = 1279, 3039
CENTER_X = 2159
FACE_TOP, FACE_BOTTOM = 85, 1218
READ_W, READ_H = 1420, 310  # 明るさを測るときの大きさ
SCALE = READ_W / W
WHITE_LEVEL = 250  # 3 色ともこれ以上を白飛びとする(0〜255)
WHITE_MAX_PERCENT = 1.0  # 1 コマの中の白飛びの上限(%)
MEAN_MAX = 150  # 真っ白に近いコマとする平均の明るさ(0〜255)
BLACK_MAX = 2  # 黒とする明るさの上限
AV_MAX_SEC = 0.034
DIGIT_BOX = (560, 540, 720, 700)  # カウントダウンの数字がある所
FLASH_RANGE = (150, 205)  # フラッシュのコマの平均の明るさの許す幅(0〜255、70% の白は約 178)
NUMBER_BOX = (1279, 880, 3039, 1110)  # コマ番号がある所
BLACK_SECTIONS = ("preroll", "sync_head", "tail", "sync_tail", "black_end")
LABELS = {
    "preroll": "待ち(数字だけ)", "sync_head": "同期(頭)", "sync_tail": "同期(終わり)", "black_end": "黒(最後)", "dark": "暗闇→光", "enter": "登場", "line": "せりふ", "song": "歌",
    "bow": "おじぎ", "listen": "聞く", "answer": "返事", "outro": "暗くなる", "tail": "黒",
}
FONT = "C:/Windows/Fonts/meiryob.ttc"


def probe(path, entries, stream="v:0"):
    cmd = ["ffprobe", "-v", "error", "-select_streams", stream, "-count_packets", "-show_entries", entries, "-of", "json", str(path)]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    streams = json.loads(out).get("streams", [])
    return streams[0] if streams else {}


def read_frames(master):
    """master を小さくして 1 コマずつ読む(RGB)"""
    cmd = ["ffmpeg", "-v", "error", "-i", str(master), "-vf", f"scale={READ_W}:{READ_H}:flags=area,format=rgb24", "-f", "rawvideo", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = READ_W * READ_H * 3
    while True:
        raw = proc.stdout.read(size)
        if len(raw) < size:
            break
        yield np.frombuffer(raw, np.uint8).reshape(READ_H, READ_W, 3)
    proc.wait()


def flash_frames(timeline):
    """フラッシュのコマの番号。timeline の sync から求める"""
    sync = timeline.get("sync")
    if not sync:
        return []
    fps = timeline["fps"]
    width = int(round(sync["flash_sec"] * fps))
    out = []
    for section in timeline["sections"]:
        if section["id"] in ("sync_head", "sync_tail"):
            first = int(round(section["start"] * fps))
            for at in sync["flash_starts"]:
                out += [first + int(round(at * fps)) + k for k in range(width)]
    return out


def measure_brightness(master, timeline):
    """全コマの明るさ。黒であるはずの区間は、数字とフラッシュのコマを除いて最大の値を見る"""
    sections, fps = timeline["sections"], timeline["fps"]
    means, whites, digit_seen = [], [], 0
    section_black = {sid: [] for sid in BLACK_SECTIONS}
    x0, y0, x1, y1 = [int(v * SCALE) for v in DIGIT_BOX]
    nx0, ny0, nx1, ny1 = [int(v * SCALE) for v in NUMBER_BOX]
    spans = {s["id"]: (int(round(s["start"] * fps)), int(round(s["end"] * fps))) for s in sections}
    flashes = set(flash_frames(timeline))
    for i, frame in enumerate(read_frames(master)):
        means.append(float(frame.mean()))
        whites.append(float((frame.min(axis=2) >= WHITE_LEVEL).mean() * 100))
        for sid in section_black:
            a, b = spans.get(sid, (0, 0))
            if a <= i < b and i not in flashes:
                work = frame.copy()
                if sid == "sync_head":
                    work[ny0:ny1, nx0:nx1] = 0
                if sid == "preroll":
                    if frame[y0:y1, x0:x1].max() > 10:
                        digit_seen += 1
                    work[y0:y1, x0:x1] = 0
                section_black[sid].append(int(work.max()))
    return means, whites, section_black, digit_seen


def check_boxes(video_dir, enter_end_frame):
    """キャラの枠が面の境目と上下の端を越えないこと。enter の間は下へはみ出してよい"""
    data = json.loads((video_dir / "character_box.json").read_text(encoding="utf-8"))
    rows = [r for r in data["frames"] if r["box"]]
    if not rows:
        return {"ok": False, "why": "枠のあるコマがない"}
    boxes = np.array([r["box"] for r in rows], float)
    frames = np.array([r["frame"] for r in rows])
    settled = boxes[frames >= enter_end_frame] if (frames >= enter_end_frame).any() else boxes
    union = [boxes[:, 0].min(), boxes[:, 1].min(), boxes[:, 2].max(), boxes[:, 3].max()]
    settled_union = [settled[:, 0].min(), settled[:, 1].min(), settled[:, 2].max(), settled[:, 3].max()]
    inside_x = union[0] > SEAM_L and union[2] < SEAM_R
    # 寄りがある版は、足が中央の面の下の端で切れてよい(上の端だけを見る)。全身の場面の下の端は見る
    zooms = np.array([r.get("zoom", 0) for r in rows])
    whole = settled[(zooms[frames >= enter_end_frame] if (frames >= enter_end_frame).any() else zooms) < 0.01]
    bottom = float(whole[:, 3].max()) if len(whole) else 0.0
    inside_y = settled_union[1] >= FACE_TOP and bottom <= FACE_BOTTOM
    return {
        "ok": bool(inside_x and inside_y),
        "frames_with_character": len(rows),
        "union_box": [round(v, 1) for v in union],
        "settled_union_box": [round(v, 1) for v in settled_union],
        "margin_to_seams": [round(union[0] - SEAM_L, 1), round(SEAM_R - union[2], 1)],
        "bottom_whole_body": round(bottom, 1),
        "zoom_max": data.get("zoom_max"),
        "width": round(union[2] - union[0], 1),
        "height_settled": round(settled_union[3] - settled_union[1], 1),
    }


def grab(master, seconds):
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{seconds:.3f}", "-i", str(master), "-frames:v", "1", "-vf", "scale=2000:437:flags=area,format=rgb24", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return Image.frombuffer("RGB", (2000, 437), raw[: 2000 * 437 * 3])


def make_sheet(master, sections, base_sec, path):
    """セクションごとに 2 コマ。面の境目と中心の線を薄く重ね、日本語のラベルを大きく書く"""
    label_font = ImageFont.truetype(FONT, 76)
    small_font = ImageFont.truetype(FONT, 44)
    cell_w, cell_h = 2000, 437
    k = cell_w / W
    rows = sections
    sheet = Image.new("RGB", (cell_w * 2 + 10, (cell_h + 10) * len(rows)), (24, 24, 30))
    for row, section in enumerate(rows):
        span = section["end"] - section["start"]
        for col, ratio in enumerate((0.3, 0.8)):
            t = section["start"] + span * ratio
            cell = grab(master, max(0.0, t - base_sec)).convert("RGBA")
            overlay = Image.new("RGBA", cell.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)
            for x, color in ((SEAM_L, (255, 240, 0, 90)), (SEAM_R, (255, 240, 0, 90)), (CENTER_X, (255, 255, 255, 60))):
                draw.line([(x * k, 0), (x * k, cell_h)], fill=color, width=3)
            label = LABELS.get(section["id"], section["id"])
            text = f"{label} {t:.1f}秒"
            draw.rectangle((0, 0, 40 + draw.textlength(text, font=label_font), 104), fill=(0, 0, 0, 170))
            draw.text((16, 2), text, fill=(255, 255, 255, 255), font=label_font)
            draw.text((16, cell_h - 60), section["id"], fill=(200, 200, 200, 200), font=small_font)
            merged = Image.alpha_composite(cell, overlay).convert("RGB")
            sheet.paste(merged, (col * (cell_w + 10), row * (cell_h + 10)))
    sheet.save(path, quality=90)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-dir", required=True)
    parser.add_argument("--timeline", required=True)
    parser.add_argument("--name", default="show")
    parser.add_argument("--sample", action="store_true", help="短い見本。全編のコマ数や黒の場面は見ない")
    parser.add_argument("--no-character", action="store_true", help="キャラなしの版。全部のコマでキャラの枠が無いことを確かめる")
    args = parser.parse_args()
    video_dir = Path(args.video_dir)
    timeline = json.loads(Path(args.timeline).read_text(encoding="utf-8"))
    fps, frames = timeline["fps"], timeline["frames"]
    sections = timeline["sections"]
    master = video_dir / "master.mov"
    results = {}

    # 描いたときの timeline と今の timeline が同じか(音の直しで変わっていないか)
    used = json.loads((video_dir / "render_stats.json").read_text(encoding="utf-8")).get("timeline_sha256")
    now = hashlib.sha256(Path(args.timeline).read_bytes()).hexdigest()
    results["timeline_same"] = {"ok": used == now, "rendered_with": used, "now": now}

    info = probe(master, "stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_read_packets,duration")
    count = int(info.get("nb_read_packets", 0))
    format_ok = info.get("width") == W and info.get("height") == H and info.get("r_frame_rate") == "60/1" and "10" in info.get("pix_fmt", "")
    results["master"] = {"ok": bool(format_ok and (args.sample or count == frames)), "info": info, "frames_expected": frames}

    for suffix, codec, pix in ((".mov", "hevc", "yuv420p10le"), (".mp4", "h264", "yuv420p")):
        path = video_dir / f"{args.name}{suffix}"
        if not path.exists():
            results[f"deliver{suffix}"] = {"ok": False, "why": f"{path.name} がない"}
            continue
        v = probe(path, "stream=codec_name,codec_tag_string,pix_fmt,width,height,r_frame_rate,nb_read_packets,duration")
        a = probe(path, "stream=codec_name,sample_rate,channels,duration", "a:0")
        diff = abs(float(v.get("duration", 0)) - float(a.get("duration", -1)))
        ok = v.get("codec_name") == codec and v.get("pix_fmt") == pix and v.get("width") == W and v.get("height") == H and v.get("r_frame_rate") == "60/1" and int(v.get("nb_read_packets", 0)) == count and diff <= AV_MAX_SEC
        if suffix == ".mov":
            ok = ok and v.get("codec_tag_string") == "hvc1" and a.get("codec_name") == "pcm_s24le" and a.get("sample_rate") == "48000"
        results[f"deliver{suffix}"] = {"ok": bool(ok), "video": v, "audio": a, "av_diff_sec": round(diff, 4)}

    preview = video_dir / "preview.mp4"
    if preview.exists():
        v = probe(preview, "stream=width,height,r_frame_rate,nb_read_packets")
        a = probe(preview, "stream=codec_name", "a:0")
        results["preview"] = {"ok": v.get("width") == 1420 and v.get("height") == 310 and bool(a), "video": v}
    else:
        results["preview"] = {"ok": False, "why": "preview.mp4 がない"}

    enter = next((s for s in sections if s["id"] == "enter"), None)
    if args.no_character:
        rows = json.loads((video_dir / "character_box.json").read_text(encoding="utf-8"))["frames"]
        seen = sum(1 for r in rows if r["box"])
        results["character_box"] = {"ok": seen == 0 and len(rows) == count, "frames_with_character": seen, "frames": len(rows)}
    else:
        results["character_box"] = check_boxes(video_dir, int(enter["end"] * fps) if enter else 0)

    if args.sample:
        sample_sections = []
        means, whites, _, _ = measure_brightness(master, {**timeline, "sections": [], "sync": None})
        stats = json.loads((video_dir / "render_stats.json").read_text(encoding="utf-8"))
        base_sec = stats["from"] / fps
        sample_sections = [{"id": "song", "start": base_sec, "end": base_sec + len(means) / fps}]
        make_sheet(master, sample_sections, base_sec, video_dir / "sheet.jpg")
    else:
        means, whites, black, digit_seen = measure_brightness(master, timeline)
        results["preroll_black"] = {"ok": bool(black["preroll"]) and max(black["preroll"]) <= BLACK_MAX and digit_seen == len(black["preroll"]), "max_outside_digit": max(black["preroll"], default=None), "frames_with_digit": digit_seen, "frames": len(black["preroll"])}
        for sid in ("sync_head", "tail", "sync_tail", "black_end"):
            results[f"{sid}_black"] = {"ok": bool(black[sid]) and max(black[sid]) <= BLACK_MAX, "max": max(black[sid], default=None), "frames": len(black[sid])}
        make_sheet(master, sections, 0.0, video_dir / "sheet.jpg")
        flash_list = flash_frames(timeline)
        flash_means = [round(means[i], 1) for i in flash_list if i < len(means)]
        flash_set = set(flash_list)
        neighbors = [round(means[i], 1) for f in flash_list for i in (f - 1, f + 1) if i not in flash_set and i < len(means)]
        results["sync_flash"] = {
            "ok": len(flash_means) == len(flash_list) > 0 and all(FLASH_RANGE[0] <= v <= FLASH_RANGE[1] for v in flash_means) and max(neighbors) < 20,
            "frames": flash_list, "means": flash_means, "means_next_to_flash": neighbors,
        }

    skip = set(flash_frames(timeline)) if not args.sample else set()
    plain = [v for i, v in enumerate(means) if i not in skip]
    per_section = {}
    for s in sections:
        a, b = int(s["start"] * fps), int(s["end"] * fps)
        part = means[a:b]
        if part:
            per_section[s["id"]] = {"mean": round(float(np.mean(part)), 1), "max": round(float(np.max(part)), 1), "white_percent_max": round(float(np.max(whites[a:b])), 3)}
    results["brightness"] = {
        "ok": bool(plain) and max(plain) < MEAN_MAX and max(whites) <= WHITE_MAX_PERCENT,
        "mean_max_without_flash": round(max(plain), 1) if plain else None,
        "white_percent_max": round(max(whites), 3) if whites else None,
        "per_section": per_section,
    }
    (video_dir / "brightness_per_frame.json").write_text(json.dumps({"mean": [round(v, 2) for v in means], "white_percent": [round(v, 3) for v in whites]}), encoding="utf-8")

    all_ok = all(item.get("ok") for item in results.values())
    report = {"ok": bool(all_ok), "sheet": str(video_dir / "sheet.jpg"), "checks": results}
    (video_dir / "check.json").write_text(json.dumps(report, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    for name, item in results.items():
        print(("合格" if item.get("ok") else "不合格"), name)
    print("全部合格" if all_ok else "不合格があります", video_dir / "check.json")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
