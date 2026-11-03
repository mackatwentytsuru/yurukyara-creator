"""描いた効果の記録(compose_led の --stats)を、音の打点と比べて測る。

  python fx_measure.py --stats fx_only.jsonl [--composed composed.jsonl] --timeline <timeline.json> --stage <stage.json> --out report.json

- 光の時刻: 打点のまわりで、いちばん大きく明るくなったコマの境目。
- 押した: 打点のまわりの増えが PRESS_LEVEL を超えた。決めの光の中は別に数える(光に埋もれるため)。
- 山の幅: 明るさの山の半分の高さでの幅。3 コマ未満は 30p のカメラに写らないことがある。
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audio_hits  # noqa: E402
from fx_plan import CRASH_STRONG_RANK, FALL_LEAD_SEC, STRONG_RANK  # noqa: E402

SEARCH_FRAMES = 6
PRESS_LEVEL = 1.5  # 平均の明るさの増え(0〜255)
SPIKE_LEVEL = 1.0  # これより低い山は光の変化に数えない(0〜255)
PEAK_REACH = 12
FLASH_AFTER_SEC = 2.2


def load_rows(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def signal_for(rows, band):
    """音の種類ごとに、光が動く場所を見る。"""
    if band == "kick":
        return np.array([r["bottom"] for r in rows])
    if band == "snare":
        return np.array([(r["A"] + r["C"]) / 2.0 for r in rows])
    return np.array([r["mean"] for r in rows])


def response(signal, first, t, fps):
    """打点 t(秒)のまわりの、増えと、光の変化の時刻(秒)。"""
    at = int(round(t * fps)) - first
    low, high = at - SEARCH_FRAMES, at + SEARCH_FRAMES
    if low < 1 or high >= len(signal):
        return None
    steps = np.diff(signal[low:high + 1])
    best = int(np.argmax(steps))
    rise = float(signal[at:high + 1].max() - signal[low:at].min())
    # 境目の時刻: steps[i] は コマ low+i と low+i+1 の間
    return rise, (first + low + best + 0.5) / fps


def peak_widths(signal):
    """目に見える山(高さ SPIKE_LEVEL 以上)の、半分の高さでの幅(コマ)。"""
    widths = []
    for at in np.where((signal[1:-1] > signal[:-2]) & (signal[1:-1] >= signal[2:]))[0] + 1:
        low_left = signal[max(0, at - PEAK_REACH):at].min()
        low_right = signal[at + 1:at + 1 + PEAK_REACH].min()
        height = signal[at] - max(low_left, low_right)
        if height < SPIKE_LEVEL:
            continue
        half = signal[at] - height / 2.0
        left, right = at, at
        while left > 0 and signal[left - 1] > half:
            left -= 1
        while right < len(signal) - 1 and signal[right + 1] > half:
            right += 1
        widths.append((int(right - left + 1), int(at)))
    return widths


def width_report(rows, names):
    report = {}
    for name in names:
        widths = peak_widths(np.array([r[name] for r in rows]))
        first = rows[0]["frame"]
        report[name] = {"peaks": len(widths), "min_width_frames": min(w for w, _ in widths) if widths else None,
                        "under_3_frames": [first + at for w, at in widths if w < 3]}
    return report


def in_flash(t, flashes):
    return any(at - FALL_LEAD_SEC <= t <= at + FLASH_AFTER_SEC for at in flashes)


def measure_hits(rows, hits, flashes, fps):
    first = rows[0]["frame"]
    begin, end = first / fps, (rows[-1]["frame"] + 1) / fps
    strong, weak = [], []
    for hit in hits:
        if not begin <= hit["t"] < end:
            continue
        result = response(signal_for(rows, hit["band"]), first, hit["t"], fps)
        if result is None:
            continue
        cut = CRASH_STRONG_RANK if hit["band"] == "crash" else STRONG_RANK
        row = {"t": hit["t"], "band": hit["band"], "strength": hit["strength"], "rise": round(result[0], 3),
               "diff_ms": round((result[1] - hit["t"]) * 1000.0, 1), "flash": in_flash(hit["t"], flashes)}
        (strong if hit["strength"] >= cut else weak).append(row)
    return strong, weak


def summarize(group):
    if not group:
        return {"count": 0}
    rise = np.array([g["rise"] for g in group])
    diff = np.array([g["diff_ms"] for g in group])
    return {"count": len(group), "pressed": int((rise >= PRESS_LEVEL).sum()),
            "pressed_pct": round(float((rise >= PRESS_LEVEL).mean()) * 100.0, 1),
            "rise_median": round(float(np.median(rise)), 2),
            "diff_ms_median": round(float(np.median(diff)), 1), "diff_ms_abs_median": round(float(np.median(np.abs(diff))), 1)}


def measure_beats(rows, timeline):
    first, fps = rows[0]["frame"], timeline["fps"]
    signal = signal_for(rows, "kick")
    begin, end = first / fps, (rows[-1]["frame"] + 1) / fps
    out = [response(signal, first, b, fps) for b in timeline["beats"] if begin <= b < end]
    diffs = [(r[1] - b) * 1000.0 for r, b in zip(out, [b for b in timeline["beats"] if begin <= b < end]) if r]
    return {"count": len(diffs), "diff_ms_median": round(float(np.median(diffs)), 1),
            "diff_ms_abs_median": round(float(np.median(np.abs(diffs))), 1)} if diffs else {"count": 0}


def brightness(rows):
    out = {"mean_max": max(r["mean"] for r in rows), "mean_median": float(np.median([r["mean"] for r in rows])),
           "white_pct_max": max(r["white_pct"] for r in rows), "limit_min": min(r.get("limit", 1.0) for r in rows),
           "peak_max": max(r["peak"] for r in rows), "sec_per_frame_median": round(float(np.median([r["sec"] for r in rows])), 4)}
    if "white_pct_no_char" in rows[0] or any("white_pct_no_char" in r for r in rows):
        out["white_pct_no_char_max"] = max(r.get("white_pct_no_char", r["white_pct"]) for r in rows)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stats", required=True, help="効果だけの版の記録")
    parser.add_argument("--composed", help="重ねた版の記録(明るさを見る)")
    parser.add_argument("--timeline", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--hits")
    parser.add_argument("--out")
    args = parser.parse_args()
    timeline = json.loads(Path(args.timeline).read_text(encoding="utf-8"))
    stage = json.loads(Path(args.stage).read_text(encoding="utf-8"))
    rows = load_rows(args.stats)
    hits, source = audio_hits.load_hits(args.timeline, args.hits)
    flashes = [float(c["t"]) for c in stage["flashes"]]
    strong, weak = measure_hits(rows, hits, flashes, timeline["fps"])
    plain = [g for g in strong if not g["flash"]]
    report = {"hits_source": source, "missed_strong": [g for g in plain if g["rise"] < PRESS_LEVEL], "beats": measure_beats(rows, timeline), "strong": summarize(strong),
              "strong_outside_flash": summarize(plain), "weak_outside_flash": summarize([g for g in weak if not g["flash"]]),
              "peak_width": width_report(rows, ("mean", "bottom", "A", "C")),
              "fx_only_brightness": brightness(rows)}
    if args.composed:
        composed = load_rows(args.composed)
        report["composed_brightness"] = brightness(composed)
        report["composed_peak_width"] = width_report(composed, ("mean", "bottom"))
    text = json.dumps(report, ensure_ascii=False, indent=1)
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
