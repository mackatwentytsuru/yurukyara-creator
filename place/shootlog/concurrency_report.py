"""同時に動かす試験(録画のみ / +UE モニター / +作業用 PC へ映像 / 両方)の結果を 1 枚の表にする。

  python place/shootlog/concurrency_report.py "A 録画のみ=<撮影フォルダ>" "B +UE=<撮影フォルダ>" "C +作業用 PC へ映像=<撮影フォルダ>[|<受け手の出力フォルダ>]" ... [--out report.md]   (受け手のフォルダは "|" で区切る: "C=<撮影>|<受け手>")
撮影フォルダ(AirDrop で届いた物)の meta.json・frames.jsonl から、録画の質(落ちたコマ・コマの間隔・追跡)・熱・送りの数を読み、
受け手(pc_stream_receiver.py)の summary.json があれば、作業用 PC 側の fps・Mbps・見かけの遅れ・欠けも並べる。比べるときは、場所・動き・最初の熱の状態を同じにする。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def load(d: Path):
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    frames = [json.loads(x) for x in (d / "frames.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    return meta, frames


def row(label: str, shoot: Path, recv: Path | None) -> dict:
    meta, frames = load(shoot)
    st = meta["stats"]
    pts = np.array([f["pts"] for f in frames])
    dt = np.diff(pts) * 1000 if len(pts) > 1 else np.array([0.0])
    ue = meta.get("ueLink") or {}
    pc = meta.get("pcStream") or {}
    thermal = [e["kind"] for e in meta["events"] if e["kind"].startswith("thermal:")]
    r = {
        "試験": label, "秒": st["durationSeconds"] and round(st["durationSeconds"], 1), "コマ": st["frames"], "平均fps": round(st["averageFps"], 2),
        "落ちたコマ": st["droppedFrames"], "コマ間隔 p95/最大(ms)": f"{np.percentile(dt, 95):.1f} / {dt.max():.1f}",
        "追跡が正常でないコマ": st["trackingNotNormalFrames"], "形式": f"{st.get('width')}x{st.get('height')}",
        "熱(UE側の記録)": ue.get("thermalMax", "-"), "熱(映像側の記録)": pc.get("thermalMax", "-"), "熱の変化の記録": ",".join(t.split(":")[1] for t in thermal) or "-",
        "UE へ送った/失敗": f"{ue.get('packetsSent', '-')}/{ue.get('packetsFailed', '-')}" if ue else "-",
        "映像 送った/忙しく捨て/未接続で捨て": f"{pc.get('framesSent', '-')}/{pc.get('skippedBusy', '-')}/{pc.get('skippedNotReady', '-')}" if pc else "-",
        "符号化 平均/最大(ms)": f"{pc.get('encodeMsAvg', '-')}/{pc.get('encodeMsMax', '-')}" if pc else "-",
    }
    if recv and (recv / "summary.json").exists():
        s = json.loads((recv / "summary.json").read_text(encoding="utf-8"))
        r["作業用 PC fps/Mbps"] = f"{s.get('fps')}/{s.get('mbps')}"
        r["作業用 PC 欠け"] = s.get("seq_missing")
        lat = s.get("apparent_latency_ms") or {}
        r["見かけの遅れ 中央/p95/最大(ms)"] = f"{lat.get('median')}/{lat.get('p95')}/{lat.get('max')}"
    return r


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("items", nargs="+")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    rows = []
    for it in a.items:
        label, _, rest = it.partition("=")
        shoot, _, recv = rest.partition("|") if "|" in rest else (rest, "", "")
        rows.append(row(label, Path(shoot), Path(recv) if recv else None))
    keys = list(dict.fromkeys(k for r in rows for k in r))
    lines = ["| " + " | ".join(keys) + " |", "|" + "---|" * len(keys)]
    for r in rows:
        lines.append("| " + " | ".join(str(r.get(k, "-")) for k in keys) + " |")
    text = "\n".join(lines)
    print(text)
    if a.out:
        Path(a.out).write_text(text + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
