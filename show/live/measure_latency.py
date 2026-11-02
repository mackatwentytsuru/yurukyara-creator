"""送り手の記録・UE の記録・ページの記録から、遅れと fps とコマ落ちを出す。

使い方: python measure_latency.py <記録のフォルダ> [--skip 秒]
"""
import argparse
import json
import statistics
from pathlib import Path

CODES = 7


def percentile(values, q):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def summary(values):
    if not values:
        return None
    return {"count": len(values), "p50": round(statistics.median(values), 1), "p95": round(percentile(values, 0.95), 1),
            "min": round(min(values), 1), "max": round(max(values), 1)}


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def match_events(sent, events, applied):
    """ページで色が変わるたびに、同じ番号で最も新しく送った時刻と比べる。"""
    to_screen, ue_to_screen, missing = [], [], 0
    last_seq = None
    for event in events:
        if event["code"] == 0:
            continue
        candidates = [s for s in sent if s["m"] % CODES + 1 == event["code"] and s["wall_ms"] <= event["display_ms"]]
        if not candidates:
            continue
        chosen = candidates[-1]
        if last_seq is not None and chosen["m"] > last_seq + 1:
            missing += chosen["m"] - last_seq - 1
        last_seq = chosen["m"]
        to_screen.append(event["display_ms"] - chosen["wall_ms"])
        if chosen["m"] in applied:
            ue_to_screen.append(event["display_ms"] - applied[chosen["m"]])
    return to_screen, ue_to_screen, missing


def stream_numbers(stats):
    a, b = stats[0], stats[-1]
    seconds = (b["wall_ms"] - a["wall_ms"]) / 1000.0
    emitted = (b.get("jitterCount") or 0) - (a.get("jitterCount") or 0)
    jitter = (b.get("jitterDelay") or 0) - (a.get("jitterDelay") or 0)
    return {"seconds": round(seconds, 1), "browser_decoded_fps": round((b["decoded"] - a["decoded"]) / seconds, 1),
            "browser_received": b["received"] - a["received"], "browser_decoded": b["decoded"] - a["decoded"],
            "browser_dropped": (b.get("dropped") or 0) - (a.get("dropped") or 0),
            "packets_lost": (b.get("lost") or 0) - (a.get("lost") or 0),
            "freezes": (b.get("freezes") or 0) - (a.get("freezes") or 0),
            "mbps": round((b["bytes"] - a["bytes"]) * 8 / seconds / 1e6, 1), "decoder": b.get("decoder"),
            "jitter_buffer_ms": round(jitter * 1000.0 / emitted, 1) if emitted else None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder")
    parser.add_argument("--skip", type=float, default=5.0, help="初めの安定しない秒を捨てる")
    args = parser.parse_args()
    folder = Path(args.folder)
    sent = read_jsonl(folder / "sent.jsonl")
    ue_rows = read_jsonl(folder / "ue_stats.jsonl") if (folder / "ue_stats.jsonl").exists() else []
    logs = sorted(folder.glob("player_log_*.json"))
    if not logs:
        raise SystemExit("ページの記録が無い")
    page = json.loads(logs[-1].read_text(encoding="utf-8"))
    first = sent[0]["wall_ms"] + args.skip * 1000.0
    sent_used = [s for s in sent if s["wall_ms"] >= first]
    events = [e for e in page["events"] if e["display_ms"] >= first + 200.0]
    applied = {m: wall for row in ue_rows for m, wall in row["applied"]}
    to_screen, ue_to_screen, missing = match_events(sent_used, events, applied)
    send_to_ue = [applied[s["m"]] - s["wall_ms"] for s in sent_used if s["m"] in applied]
    ue_used = [r for r in ue_rows if r["wall"] * 1000.0 >= first and r["poses"] > 0]
    stats = [s for s in page["stats"] if s["wall_ms"] >= first]
    result = {"picture": page.get("size"), "codec": page.get("codec"), "state": page.get("state"),
              "clock_rtt_ms": page.get("clockRttMs"), "last_marker_rgb": page.get("lastRgb"),
              "send_to_screen_ms": summary(to_screen), "send_to_ue_ms": summary(send_to_ue),
              "send_to_screen_series_ms": [round(v) for v in to_screen], "ue_to_screen_ms": summary(ue_to_screen), "marker_changes_sent": len(sent_used),
              "marker_changes_missing": missing, "ue_fps": summary([r["fps"] for r in ue_used]),
              "ue_max_dt_ms": summary([r["max_dt_ms"] for r in ue_used]),
              "ue_python_tick_ms": summary([r["tick_ms"] for r in ue_used])}
    if len(stats) >= 2:
        result.update(stream_numbers(stats))
    text = json.dumps(result, ensure_ascii=False, indent=1)
    print(text)
    (folder / "result.json").write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
