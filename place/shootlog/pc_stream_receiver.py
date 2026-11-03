"""撮影記録アプリの「作業用 PC へ映像」(確認用の縮小映像+姿勢)を TCP で受けて、ディスクに記録し、数字を出す。

  python place/shootlog/pc_stream_receiver.py --out <出力フォルダ> [--port 9100] [--seconds 120]
出力: stream.mjpg(JPEG を並べただけ。ffmpeg -f mjpeg -i stream.mjpg ... で動画にできる)、index.jsonl(1 コマ 1 行:
  seq・rec_frame(録画のコマ番号、録画外は -1)・ar_ts(ARFrame の時刻 = frames.jsonl の t)・sent_ms・recv_ms・w・h・flags・T・K・offset・length)、
  summary.json(受けたコマ数・fps・Mbps・欠けたコマ・見かけの遅れ(中央値・最大。端末と PC の時計のずれを含む))。
形は place/ios/ShootLog/PCStream.swift の冒頭の説明と同じ(ビッグエンディアン)。本番の録画は端末の中にあり、これは確認用。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import struct
import time
from pathlib import Path

HEADER = struct.Struct(">4sIIiddHHB")   # magic, jpegLen, seq, recFrame, arTs, sentMs, w, h, flags
FLOATS = struct.Struct(">20f")           # T 16 + K 4


class Recorder:
    def __init__(self, out: Path):
        out.mkdir(parents=True, exist_ok=True)
        self.out = out
        self.mjpg = open(out / "stream.mjpg", "wb")
        self.index = open(out / "index.jsonl", "w", encoding="utf-8")
        self.offset = 0
        self.rows: list[dict] = []
        self.t0 = time.time()
        self.bytes = 0
        self.connections = 0

    def add(self, row: dict, jpeg: bytes):
        row["offset"], row["length"] = self.offset, len(jpeg)
        self.mjpg.write(jpeg)
        self.index.write(json.dumps(row) + "\n")
        self.offset += len(jpeg)
        self.bytes += len(jpeg)
        self.rows.append(row)

    def summary(self) -> dict:
        rows = self.rows
        if not rows:
            return {"frames": 0}
        dur = max(rows[-1]["recv_ms"] - rows[0]["recv_ms"], 1) / 1000
        seqs = [r["seq"] for r in rows]
        lag = sorted(r["recv_ms"] - r["sent_ms"] for r in rows)
        gaps = sorted(rows[i]["recv_ms"] - rows[i - 1]["recv_ms"] for i in range(1, len(rows)))
        rec_rows = [r for r in rows if r["rec_frame"] >= 0]
        return {
            "frames": len(rows), "seconds": round(dur, 1), "fps": round((len(rows) - 1) / dur, 2),
            "mbps": round(self.bytes * 8 / dur / 1e6, 2), "jpeg_kb_avg": round(self.bytes / len(rows) / 1000, 1),
            "seq_missing": (seqs[-1] - seqs[0] + 1) - len(set(seqs)),
            "apparent_latency_ms": {"median": round(lag[len(lag) // 2], 1), "p95": round(lag[int(len(lag) * 0.95)], 1), "max": round(lag[-1], 1),
                                    "note": "端末の時計と PC の時計のずれ・縮小と符号化・送りを含む。ずれ自体は引けていない"},
            "interval_ms": {"median": round(gaps[len(gaps) // 2], 1) if gaps else None, "p95": round(gaps[int(len(gaps) * 0.95)], 1) if gaps else None, "max": round(gaps[-1], 1) if gaps else None},
            "recording_frames_in_stream": len(rec_rows), "connections": self.connections,
            "size": [rows[0]["w"], rows[0]["h"]],
        }

    def close(self):
        self.mjpg.close()
        self.index.close()
        (self.out / "summary.json").write_text(json.dumps(self.summary(), ensure_ascii=False, indent=1), encoding="utf-8")


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, rec: Recorder):
    rec.connections += 1
    peer = writer.get_extra_info("peername")
    print("つながった:", peer)
    try:
        while True:
            head = await reader.readexactly(HEADER.size)
            magic, jlen, seq, recf, ar_ts, sent_ms, w, h, flags = HEADER.unpack(head)
            if magic != b"PCF1" or jlen > 20_000_000:
                print("形が違う。切る")
                break
            floats = FLOATS.unpack(await reader.readexactly(FLOATS.size))
            jpeg = await reader.readexactly(jlen)
            rec.add({"seq": seq, "rec_frame": recf, "ar_ts": ar_ts, "sent_ms": sent_ms, "recv_ms": time.time() * 1000, "w": w, "h": h,
                     "flags": flags, "T": list(floats[:16]), "K": list(floats[16:])}, jpeg)
    except asyncio.IncompleteReadError:
        pass
    finally:
        print("切れた:", peer, "受けたコマ", len(rec.rows))
        writer.close()


async def main_async(a):
    rec = Recorder(Path(a.out))
    server = await asyncio.start_server(lambda r, w: handle(r, w, rec), a.bind, a.port)
    print(f"待ち受け {a.bind}:{a.port}、記録 {a.out}" + (f"、{a.seconds} 秒で終わる" if a.seconds else "(Ctrl+C で終わる)"))
    try:
        if a.seconds:
            await asyncio.sleep(a.seconds)
        else:
            await asyncio.Event().wait()
    finally:
        server.close()
        rec.close()
        print(json.dumps(rec.summary(), ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--port", type=int, default=9100)
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--seconds", type=float, default=0)
    a = ap.parse_args()
    try:
        asyncio.run(main_async(a))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
