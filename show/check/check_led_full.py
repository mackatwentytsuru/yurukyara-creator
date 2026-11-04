"""全編の LED の検査。build_led_full.py の最後の段。不合格が 1 つでもあれば終了コード 1。

  python check_led_full.py --out-dir <作業の置き場> --timeline <timeline.json> --stage <show_stage.json> --master <原版> \\
      --led <LED 用 mp4> --ue <UE 用 mp4> --stats <重ねの記録 jsonl> --audio <show_mix.wav> [--char-dir <キャラの層>] [--ref-boxes <json>]

測る物(全部、出した物そのものから。行き来と LED のキャラだけは重ねの記録から):
  形式  : 原版・LED 用・UE 用のコマ数と長さ。LED 用は音あり、UE 用は 2840x620 で音の線が無いこと。
  行き来: 出る・戻るごとに、LED と舞台にキャラが同時にいる秒。舞台にいる間の LED のキャラの透明の画素が 0。
  キャラ: 足の y・身長・中心 x(1198・397・2159 との差の最大と中央値)。ブラウザ版の枠があれば、その差の最大。
  明るさ: LED 用の mp4 を縮めて全コマの平均の明るさ(上限 105)、純白の割合(原寸で 6 コマに 1 コマ)、3 コマ未満の光の山。
  音    : 強い打点と光の立ち上がりの差(fx_measure と同じ測り方)、LED 用の mp4 の音と元の wav のずれ。
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / "fx")]
import audio_hits  # noqa: E402
import fx_measure  # noqa: E402
import fx_plan  # noqa: E402

CANVAS = (5680, 1240)
TARGET = {"foot": 1198.0, "height": 397.0, "center_x": 2159.0}
MEAN_CAP = 105.0
OUTSIDE_DIFF_MAX = 3.0  # 頭と尾の、今の全編とのコマごとの平均の明るさの差
WHITE_LEVEL = 254
WHITE_PCT_GUIDE = 1.0  # 目安(決まりの上限ではない。前の全編で 0.82% を許した)
WHITE_EVERY = 6
SMALL_DIV = 4
HIT_ABS_MEDIAN_MS = 16.7  # 1 コマ
AUDIO_LAG_MS = 5.0
REF_PX = 3.0  # ブラウザ版との差(前の UE の土台の合格の線)
FOOT_MEDIAN_PX = 3.0
ZONES = {"A": (945, 1279), "C": (4290, 5680)}
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def probe(path, entries, stream="v:0"):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", stream, "-show_entries", entries, "-of", "json", str(path)],
                         capture_output=True, text=True, stdin=subprocess.DEVNULL).stdout
    streams = json.loads(out or "{}").get("streams", [])
    return streams[0] if streams else None


def count_frames(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True, stdin=subprocess.DEVNULL).stdout
    return int(out.strip().split(",")[0]) if out.strip() else -1


class Report:
    def __init__(self):
        self.items = []

    def add(self, name, value, limit, passed, note=None):
        row = {"name": name, "value": value, "limit": limit, "pass": bool(passed)}
        if note:
            row["note"] = note
        self.items.append(row)
        print(("合格 " if passed else "不合格 ") + name, json.dumps(value, ensure_ascii=False), "上限/条件:", limit, flush=True)


def expected_frames(plan):
    every = plan["every"]
    if every == 1:
        return plan["frames"]
    total = 0
    for a, b in [plan["head"], *plan["chunks"], plan["tail"]]:
        total += len(range(-(-a // every) * every, b, every)) if b > a else 0
    return total


def check_format(report, args, plan):
    expected = expected_frames(plan)
    every, fps = plan["every"], plan["fps"]
    quick = every != 1 or plan["scale"] != 1.0
    led_size = ((plan["size"][0] // 2 * 2, plan["size"][1] // 2 * 2) if quick else CANVAS)
    ue_size = ((plan["size"][0] // 4 * 2, plan["size"][1] // 4 * 2) if quick else (2840, 620))
    duration = expected * every / fps
    master = count_frames(args.master)
    report.add("原版のコマ数", {"frames": master, "expected": expected}, "一致", master == expected)
    for name, path, size, want_audio in (("LED 用", args.led, led_size, True), ("UE 用", args.ue, ue_size, False)):
        video = probe(path, "stream=codec_name,width,height,r_frame_rate,duration")
        audio = probe(path, "stream=codec_name,sample_rate,channels,duration", "a")
        frames = count_frames(path)
        got = {"codec": video["codec_name"], "size": [video["width"], video["height"]], "rate": video["r_frame_rate"], "frames": frames,
               "video_sec": round(float(video["duration"]), 4), "audio": audio and {k: audio[k] for k in ("codec_name", "sample_rate", "channels")}}
        ok = (video["codec_name"] == "h264" and [video["width"], video["height"]] == list(size) and frames == expected
              and abs(float(video["duration"]) - duration) <= 1.0 / fps * every + 1e-6)
        if want_audio:
            gap = abs(float(audio["duration"]) - float(video["duration"])) if audio else None
            got["audio_video_gap_sec"] = gap and round(gap, 4)
            ok = ok and audio is not None and audio["codec_name"] == "aac" and gap <= 2.0 / fps
        else:
            ok = ok and audio is None
        report.add(f"{name}の形式・コマ数・長さ", got, {"size": list(size), "frames": expected, "sec": round(duration, 4),
                                                   "audio": "aac 48000 2" if want_audio else "無い"}, ok)


def decode_rows(path, plan):
    """縮めた全コマの明るさ(sRGB 0〜255)。fx_measure と同じ名前の欄(mean・bottom・A・C)。"""
    width = max(64, int(probe(path, "stream=width")["width"]) // SMALL_DIV // 2 * 2)
    height = int(round(width * CANVAS[1] / CANVAS[0])) // 2 * 2
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"scale={width}:{height}:flags=area", "-f", "rawvideo",
                             "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, stdin=subprocess.DEVNULL)
    size = width * height * 3
    rows, index = [], 0
    zones = {k: (int(a * width / CANVAS[0]), int(b * width / CANVAS[0])) for k, (a, b) in ZONES.items()}
    low = int(height * 0.85)
    while True:
        data = proc.stdout.read(size)
        if len(data) < size:
            break
        luma = np.frombuffer(data, np.uint8).reshape(height, width, 3).astype(np.float32) @ LUMA
        row = {"frame": index * plan["every"], "mean": float(luma.mean()), "bottom": float(luma[low:].mean())}
        for key, (a, b) in zones.items():
            row[key] = float(luma[:, a:b].mean())
        rows.append(row)
        index += 1
    proc.wait()
    return rows


def white_rows(path, plan):
    """原寸の純白(3 色とも 254 以上)の割合。WHITE_EVERY コマに 1 コマ。"""
    every = max(1, WHITE_EVERY // plan["every"])
    width, height = (plan["size"][0] // 2 * 2, plan["size"][1] // 2 * 2) if plan["every"] != 1 or plan["scale"] != 1.0 else CANVAS
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"select='not(mod(n\\,{every}))'", "-vsync", "0",
                             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, stdin=subprocess.DEVNULL)
    size = width * height * 3
    out, index = [], 0
    while True:
        data = proc.stdout.read(size)
        if len(data) < size:
            break
        image = np.frombuffer(data, np.uint8).reshape(height, width, 3)
        out.append((index * every * plan["every"], float((image.min(axis=2) >= WHITE_LEVEL).mean() * 100.0)))
        index += 1
    proc.wait()
    return out


def check_light(report, args, plan, timeline, stage, rows):
    fps = plan["fps"]
    # 上限 105 は本編(重ねで描く区間)に掛ける。頭と尾は今の全編と同じ校正・同期の絵(同期のフラッシュは灰 179 の決まり)
    body = [r for r in rows if plan["body"][0] <= r["frame"] < plan["body"][1]]
    means = np.array([r["mean"] for r in body])
    worst = int(np.argmax(means))
    outside = [r for r in rows if not plan["body"][0] <= r["frame"] < plan["body"][1]]
    head_max = max(outside, key=lambda r: r["mean"]) if outside else None
    report.add("平均の明るさの最大(本編)", {"max": round(float(means.max()), 2), "frame": body[worst]["frame"],
                                       "median": round(float(np.median(means)), 2),
                                       "outside_body_max": head_max and [round(head_max["mean"], 2), head_max["frame"]]},
               MEAN_CAP, means.max() <= MEAN_CAP, "頭と尾(待ち・同期・黒)は下の「今の全編との差」で見る")
    if args.compare_head and outside:
        theirs = decode_rows(args.compare_head, plan)
        by_frame = {r["frame"]: r["mean"] for r in theirs}
        diffs = [abs(r["mean"] - by_frame[r["frame"]]) for r in outside if r["frame"] in by_frame]
        report.add("頭と尾の明るさの、今の全編との差(コマごとの平均の差の最大)",
                   {"max": round(float(max(diffs)), 3), "frames": len(diffs), "compare": str(args.compare_head)},
                   f"{OUTSIDE_DIFF_MAX} 以下(符号化の差)", len(diffs) == len(outside) and max(diffs) <= OUTSIDE_DIFF_MAX,
                   "同期のフラッシュ(灰 179)は H.264 の符号化で 175.6〜178 に揺れる")
    whites = white_rows(args.led, plan)
    peak = max(whites, key=lambda w: w[1])
    report.add("純白の割合(原寸)", {"max_pct": round(peak[1], 4), "frame": peak[0], "mean_pct": round(float(np.mean([w[1] for w in whites])), 5),
                                 "frames_measured": len(whites)}, f"目安 {WHITE_PCT_GUIDE}%", peak[1] <= WHITE_PCT_GUIDE,
               "上限は決まっていない。目安で判定")
    if plan["every"] != 1:
        report.add("3 コマ未満の光の山", "間引きの試しでは測らない", "-", True)
        report.add("強い打点と光の差", "間引きの試しでは測らない", "-", True)
        return
    short = {}
    for key in ("mean", "bottom", "A", "C"):
        widths = fx_measure.peak_widths(np.array([r[key] for r in rows]))
        short[key] = {"peaks": len(widths), "under_3_frames": [rows[at]["frame"] for w, at in widths if w < 3]}
    count = sum(len(v["under_3_frames"]) for v in short.values())
    report.add("3 コマ未満の光の山(高さ 1 以上)", short, "0 個", count == 0)
    hits, source = audio_hits.load_hits(args.timeline, None)
    body = [r for r in rows if plan["body"][0] <= r["frame"] < plan["body"][1]]
    flashes = [float(c["t"]) for c in stage["flashes"]]
    strong, _ = fx_measure.measure_hits(body, hits, flashes, fps)
    plain = fx_measure.summarize([g for g in strong if not g["flash"]])
    plain["hits_source"] = source
    report.add("強い打点と光の立ち上がりの差(決めの外)", plain, f"差の絶対値の中央値 {HIT_ABS_MEDIAN_MS} ms 以下",
               plain.get("count", 0) > 0 and plain["diff_ms_abs_median"] <= HIT_ABS_MEDIAN_MS)


def read_audio(path, start, seconds, rate=8000):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{seconds:.3f}", "-i", str(path), "-ac", "1", "-ar", str(rate),
                          "-f", "f32le", "-"], capture_output=True, stdin=subprocess.DEVNULL).stdout
    return np.frombuffer(raw, np.float32)


def check_audio(report, args, plan):
    if plan["every"] != 1:
        report.add("音のずれ", "間引きの試しでは測らない", "-", True)
        return
    rate, start, seconds = 8000, plan["body_sec"][0], 30.0
    ours, theirs = read_audio(args.led, start, seconds, rate), read_audio(args.audio, start, seconds, rate)
    n = min(len(ours), len(theirs))
    a, b = ours[:n] - ours[:n].mean(), theirs[:n] - theirs[:n].mean()
    size = 1 << int(np.ceil(np.log2(2 * n)))
    corr = np.fft.irfft(np.fft.rfft(a, size) * np.conj(np.fft.rfft(b, size)), size)
    reach = int(0.2 * rate)
    window = np.concatenate([corr[-reach:], corr[:reach + 1]])
    lag = (int(np.argmax(window)) - reach) / rate * 1000.0
    report.add("LED 用の mp4 の音と元の wav のずれ", {"lag_ms": round(lag, 3), "from_sec": start, "seconds": seconds}, f"{AUDIO_LAG_MS} ms 以内",
               abs(lag) <= AUDIO_LAG_MS)


def check_crossings(report, args, plan, timeline, stage, cues):
    rows = [json.loads(line) for line in Path(args.stats).read_text(encoding="utf-8").splitlines() if line.strip()]
    fps, every = plan["fps"], plan["every"]
    fx = fx_plan.FxPlan(timeline, stage, [], cues)
    crossings = []
    for c in sorted(stage["flashes"], key=lambda c: c["t"]):
        at = float(c["t"])
        near = [r for r in rows if at - 3.0 <= r["frame"] / fps < at + 3.0]
        both = [r for r in near if r["char_px"] > 0 and r["stage_char"]]
        crossings.append({"kind": c["kind"], "t": at, "both_sec": round(len(both) * every / fps, 4),
                          "both_frames": [both[0]["frame"], both[-1]["frame"]] if both else None})
    # 出るの引き継ぎ: 舞台のキャラは出るの EXIT_START_BEFORE 秒前から足から現れ、LED のキャラは出るの LED_FADE_END 秒後に消える
    handoff = fx_plan.EXIT_START_BEFORE + fx_plan.LED_FADE_END
    report.add("行き来ごとの、LED と舞台にキャラが同時にいる秒", crossings,
               f"出るは引き継ぎの {handoff:.2f} 秒(+1 コマ)以下、戻るは 0", all(
                   (c["both_sec"] <= handoff + 1.0 / fps + 1e-6) if c["kind"] == "out" else c["both_sec"] == 0 for c in crossings),
               "出るの重なりは設計の引き継ぎ(2 人が別々に見える間)")
    staged = [r for r in rows if r["stage_char"] and fx.led_character_level(r["frame"] / fps) == 0.0]
    leaked = [r["frame"] for r in staged if r["char_px"] > 0]
    report.add("舞台にいる間の LED のキャラの透明の画素", {"frames_on_stage": len(staged), "px_total": int(sum(r["char_px"] for r in staged)),
                                               "frames_with_px": leaked[:20]}, "0", not leaked and len(staged) > 0)
    if not args.char_dir:
        return
    led_frames = [r for r in rows if r["led_level"] >= 1.0]
    empty = [r["frame"] for r in led_frames if r["char_px"] == 0]
    report.add("LED にいる間にキャラが写っているか", {"frames_on_led": len(led_frames), "frames_empty": len(empty), "first_empty": empty[:10]},
               "空のコマ 0", not empty)


def measure_box(path):
    alpha = np.asarray(Image.open(path).getchannel("A"))
    mask = alpha >= 128
    if not mask.any():
        return None
    xs, ys = np.where(mask.any(axis=0))[0], np.where(mask.any(axis=1))[0]
    to_canvas = CANVAS[0] / alpha.shape[1]
    return [xs[0] * to_canvas, int(ys[0]), (xs[-1] + 1) * to_canvas, int(ys[-1]) + 1]


def check_figure(report, args, plan):
    if not args.char_dir:
        report.add("キャラの足・身長・中心 x", "キャラの層なし(--skip-ue の試し)", "-", True)
        return
    files = sorted(Path(args.char_dir).glob("f.*.png"), key=lambda p: int(re.search(r"f\.(\d+)", p.name).group(1)))[::2]
    boxes = {}
    for path in files:
        box = measure_box(path)
        if box:
            boxes[int(re.search(r"f\.(\d+)", path.name).group(1))] = box
    values = {"foot": [], "height": [], "center_x": []}
    for box in boxes.values():
        values["foot"].append(box[3])
        values["height"].append(box[3] - box[1])
        values["center_x"].append((box[0] + box[2]) / 2.0)
    summary = {}
    for key, list_ in values.items():
        diff = np.array(list_) - TARGET[key]
        summary[key] = {"target": TARGET[key], "abs_max": round(float(np.abs(diff).max()), 2), "median": round(float(np.median(diff)), 2),
                        "p95_abs": round(float(np.percentile(np.abs(diff), 95)), 2)}
    summary["frames"] = len(boxes)
    report.add("キャラの足・身長・中心 x(目標との差。踊りと登場の途中を含む)", summary, "数字だけ(合否はブラウザ版の枠との差)", True,
               "枠の下の端は靴の底で、ブラウザ版でも足の基準より約 6 px 下。身長と中心 x は踊りと登場の途中で変わる")
    if args.ref_boxes:
        reference = {row["frame"]: row.get("box") for row in json.loads(Path(args.ref_boxes).read_text(encoding="utf-8"))["frames"]}
        diffs = {"foot": [], "height": [], "center_x": []}
        for frame, ours in boxes.items():
            theirs = reference.get(frame)
            if not theirs or theirs[3] >= CANVAS[1]:
                continue
            theirs = [theirs[0], theirs[1] + args.ref_foot_shift, theirs[2], theirs[3] + args.ref_foot_shift]
            diffs["foot"].append(ours[3] - theirs[3])
            diffs["height"].append((ours[3] - ours[1]) - (theirs[3] - theirs[1]))
            diffs["center_x"].append((ours[0] + ours[2]) / 2 - (theirs[0] + theirs[2]) / 2)
        out = {k: round(float(np.abs(v).max()), 2) for k, v in diffs.items() if v}
        out["frames"] = len(diffs["foot"])
        report.add("ブラウザ版の枠との差の最大", out, f"{REF_PX} px 以内", out["frames"] > 0 and all(out[k] <= REF_PX for k in diffs))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("--out-dir", "--timeline", "--stage", "--master", "--led", "--ue", "--stats", "--audio"):
        parser.add_argument(name, required=True)
    parser.add_argument("--cues")
    parser.add_argument("--char-dir")
    parser.add_argument("--ref-boxes")
    parser.add_argument("--compare-head", help="今の全編の mp4。頭と尾(本編の外)の明るさを比べる")
    parser.add_argument("--ref-foot-shift", type=float, default=0.0, help="比べる枠の足の高さの差(足 1212 の古い版なら -14)")
    parser.add_argument("--every", type=int, default=1)
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--report")
    args = parser.parse_args()
    plan = json.loads((Path(args.out_dir) / "plan.json").read_text(encoding="utf-8"))
    timeline = json.loads(Path(args.timeline).read_text(encoding="utf-8"))
    stage = json.loads(Path(args.stage).read_text(encoding="utf-8"))
    cues = json.loads(Path(args.cues).read_text(encoding="utf-8")) if args.cues else None
    report = Report()
    check_format(report, args, plan)
    check_crossings(report, args, plan, timeline, stage, cues)
    check_figure(report, args, plan)
    rows = decode_rows(args.led, plan)
    check_light(report, args, plan, timeline, stage, rows)
    check_audio(report, args, plan)
    failed = [i["name"] for i in report.items if not i["pass"]]
    result = {"passed": not failed, "failed": failed, "items": report.items}
    if args.report:
        Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print("結果:", "全部合格" if not failed else f"不合格 {len(failed)} 件: {failed}")
    sys.exit(0 if not failed else 1)


if __name__ == "__main__":
    main()
