"""run_stream_test.py の結果の置き場(runN_phone.json と runN_rx_summary.json)から、比べ用の表を作る。

  python place/shootlog/stream_table.py work\\_stream\\ar15pc30 work\\_stream\\ipad_ar15fhd30
率は「端末が送ったコマ ÷ 同じ窓の ARKit コマ」で出す。受け手のコマ数は窓が約 2.5 秒長いので、ARKit 数で割ると
100% を超える(3893/3884)。受け手の数は、連番の欠け(seq_missing)の確認にだけ使う。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def rows(d: Path):
    out = []
    for k in (1, 2, 3, 4, 5):
        p, r = load(d / f"run{k}_phone.json"), load(d / f"run{k}_rx_summary.json")
        if not p:
            continue
        pc, ar = p.get("pc") or {}, p.get("ar") or {}
        ark, sent, sec = p["arkitFrames"], pc.get("framesSent", 0), p["seconds"]
        lat = (r or {}).get("latency_corrected_ms") or {}
        out.append({
            "回": k, "熱(開始→終わり)": f"{ar.get('thermalAtStart', '?')}→{p['thermalMax']}",
            "ARKit": ark, "送れた": sent, "送れた率%": round(100 * sent / ark, 1), "捨てた": pc.get("skippedBusy"),
            "実効fps": round(sent / sec, 1), "Mbps": (r or {}).get("mbps"), "連番の欠け": (r or {}).get("seq_missing"),
            "遅れ中央/p95/最大ms": f"{lat.get('median')}/{lat.get('p95')}/{lat.get('max')}",
            "音の欠け": ((r or {}).get("audio") or {}).get("missing_buffers"),
            "ARの姿勢": f"{ar.get('posesSent')}(捨{ar.get('posesSkipped')})",
        })
    return out


def main():
    for arg in sys.argv[1:]:
        d = Path(arg)
        print(f"## {d.name}")
        rs = rows(d)
        if not rs:
            print("(データなし)")
            continue
        keys = list(rs[0].keys())
        print("| " + " | ".join(keys) + " |")
        print("|" + "---|" * len(keys))
        for r in rs:
            print("| " + " | ".join(str(r[k]) for k in keys) + " |")


if __name__ == "__main__":
    main()
