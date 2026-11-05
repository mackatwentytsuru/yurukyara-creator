"""撮影記録アプリの「PC へ映像」(確認用の縮小映像+姿勢)を TCP で受けて、ディスクに記録し、数字を出す。

  python place/shootlog/pc_stream_receiver.py --out <出力フォルダ> [--port 9100] [--seconds 120]
出力: stream.mjpg(JPEG を並べただけ。ffmpeg -f mjpeg -i stream.mjpg ... で動画にできる)、index.jsonl(1 コマ 1 行:
  seq・rec_frame(録画のコマ番号、録画外は -1)・ar_ts(ARFrame の時刻 = frames.jsonl の t)・sent_ms・recv_ms・w・h・flags・T・K・offset・length)、
  summary.json(受けたコマ数・fps・Mbps・欠けたコマ・見かけの遅れ(中央値・最大。端末と PC の時計のずれを含む))。
校正(CAL1: "CAL1" / JSON の長さ u32 / UTF-8 の JSON {"arSessionId","rays","accepted","latestDots"}。accepted=true は、アプリのページが良い校正と判定した物)を受けたら、テイクのフォルダの calibration_rays.json に原子的に書く(最新が勝つ)。
形は place/ios/ShootLog/PCStream.swift の冒頭の説明と同じ(ビッグエンディアン)。本番の録画は端末の中にあり、これは確認用。
"""
from __future__ import annotations

import argparse
import asyncio
import os
import shutil
import json
import struct
import time
from pathlib import Path

HEADER = struct.Struct(">4sIIiddHHB")   # magic, jpegLen, seq, recFrame, arTs, sentMs, w, h, flags
FLOATS = struct.Struct(">20f")           # T 16 + K 4
AUDH = struct.Struct(">4sIIIHHdd")      # AUD1, pcmLen, seq, sampleRate, channels, bits, ptsHostSeconds, captureEpochMs
PING = struct.Struct(">4sdI")            # PNG1, サーバー時刻 ms, 通し番号(端末へ)
RCV = struct.Struct(">4sIII")           # RCV1, ディスクへ書いたコマ数, MB, 受け手のディスクの空き GB(16 バイト。毎秒、端末へ)
CALH = struct.Struct(">4sI")            # CAL1, JSON の長さ(端末から。校正のレイ)
PONG = struct.Struct(">4sddI")           # PON1, 同じサーバー時刻, 端末の時刻 ms, 通し番号(端末から)


class Recorder:
    def __init__(self, out: Path):
        out.mkdir(parents=True, exist_ok=True)
        self.out = out
        self.closed = False
        self.mjpg = open(out / "stream.mjpg", "wb")
        self.hevc_file = None
        self.audio_file = None
        self.audio_index = None
        self.audio_rows = []
        self.audio_off = 0
        self.out_dir = out
        self.hevc_off = 0
        self.index = open(out / "index.jsonl", "w", encoding="utf-8")
        self.offset = 0
        self.rows: list[dict] = []
        self.t0 = time.time()
        self.bytes = 0
        self.connections = 0
        self.clock_samples: list[tuple[float, float]] = []   # (rtt_ms, offset_ms = 端末の時計 - PC の時計)
        self.peer = ""                          # つないだ端末の IP(2 台のとき、どのテイクがどの端末かの目印)
        self.cal_messages = 0
        self.cal_with_rays = 0
        self.cal_sessions: list[str] = []      # 見た arSessionId(順に、重複なし)。2 つ以上 = テイクの間に ARKit の世界が変わった

    def add_calibration(self, body: bytes) -> bool:
        """CAL1 の JSON を calibration_rays.json に書く(一時ファイル → os.replace。最新が勝つ)。読めなければ False。"""
        try:
            msg = json.loads(body.decode("utf-8"))
            session = str(msg["arSessionId"])
        except (ValueError, KeyError, TypeError):
            return False
        rays = msg.get("rays")
        if not isinstance(rays, list):
            rays = None
        self.cal_messages += 1
        self.cal_with_rays += 1 if rays else 0
        if session not in self.cal_sessions:
            self.cal_sessions.append(session)
        doc = {"format": "calibration-rays/1", "arSessionId": session, "rays": rays, "sessions": self.cal_sessions,
               "accepted": bool(msg.get("accepted", False)), "latest_dots": msg.get("latestDots"),
               "messages": self.cal_messages, "recv_ms": time.time() * 1000, "frames_at_receive": len(self.rows)}
        tmp = self.out_dir / "calibration_rays.json.tmp"
        tmp.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.out_dir / "calibration_rays.json")
        return True

    def add(self, row: dict, jpeg: bytes, hevc: bool = False):
        if hevc:
            if self.hevc_file is None:
                self.hevc_file = open(self.out_dir / "stream.hevc", "wb")
            row["offset"], row["length"], row["codec"] = self.hevc_off, len(jpeg), "hevc"
            self.hevc_file.write(jpeg)
            self.hevc_off += len(jpeg)
        else:
            row["offset"], row["length"] = self.offset, len(jpeg)
            self.mjpg.write(jpeg)
            self.offset += len(jpeg)
        self.index.write(json.dumps(row) + "\n")
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
        clock = None
        corrected = None
        if self.clock_samples:
            best = sorted(self.clock_samples)[: max(3, len(self.clock_samples) // 4)]
            offset = sorted(o for _, o in best)[len(best) // 2]
            clock = {"offset_ms": round(offset, 1), "rtt_min_ms": round(best[0][0], 1), "rtt_median_ms": round(sorted(r for r, _ in self.clock_samples)[len(self.clock_samples) // 2], 1), "samples": len(self.clock_samples)}
            c = sorted(r["recv_ms"] - (r["sent_ms"] - offset) for r in rows)
            corrected = {"median": round(c[len(c) // 2], 1), "p95": round(c[int(len(c) * 0.95)], 1), "max": round(c[-1], 1), "min": round(c[0], 1),
                         "note": "映像を撮ってから PC が受けるまで(縮小・符号化・Wi-Fi・送り)。時計のずれは PING/PONG で引いた(誤差は往復の半分ほど)"}
        return {
            "frames": len(rows), "seconds": round(dur, 1), "fps": round((len(rows) - 1) / dur, 2),
            "mbps": round(self.bytes * 8 / dur / 1e6, 2), "jpeg_kb_avg": round(self.bytes / len(rows) / 1000, 1),
            "seq_missing": (seqs[-1] - seqs[0] + 1) - len(set(seqs)),
            "apparent_latency_ms": {"median": round(lag[len(lag) // 2], 1), "p95": round(lag[int(len(lag) * 0.95)], 1), "max": round(lag[-1], 1),
                                    "note": "端末の時計と PC の時計のずれ・縮小と符号化・送りを含む。ずれ自体は引けていない"},
            "interval_ms": {"median": round(gaps[len(gaps) // 2], 1) if gaps else None, "p95": round(gaps[int(len(gaps) * 0.95)], 1) if gaps else None, "max": round(gaps[-1], 1) if gaps else None},
            "latency_corrected_ms": corrected, "clock": clock,
            "audio": self.audio_summary(),
            "keyframes": sum(1 for r in rows if r["flags"] & 4), "codec": rows[0].get("codec", "jpeg"),
            "recording_frames_in_stream": len(rec_rows), "connections": self.connections, "peer": self.peer,
            "calibration": {"messages": self.cal_messages, "with_rays": self.cal_with_rays, "sessions": len(self.cal_sessions)},
            "size": [rows[0]["w"], rows[0]["h"]],
        }

    def audio_summary(self):
        rows = self.audio_rows
        if not rows:
            return None
        rate, ch = rows[0]["rate"], rows[0]["channels"]
        total = sum(r["bytes"] for r in rows) / 2 / ch
        span = rows[-1]["pts"] - rows[0]["pts"] + rows[-1]["bytes"] / 2 / ch / rate
        seqs = [r["seq"] for r in rows]
        return {"sample_rate": rate, "channels": ch, "seconds": round(total / rate, 2), "span_seconds": round(span, 2),
                "missing_buffers": (seqs[-1] - seqs[0] + 1) - len(set(seqs)), "buffers": len(rows),
                "note": "audio.raw は int16 のリトルエンディアン。ffmpeg -f s16le -ar 48000 -ac 1 -i audio.raw audio.wav で wav にできる。pts は frames.jsonl の t と同じ時計"}

    def flush(self):
        for f in (self.mjpg, self.index, self.hevc_file, self.audio_file, self.audio_index):
            if f:
                f.flush()

    def checkpoint(self):
        """途中で止められても記録が読めるように、ファイルを書き出し、summary.json も途中の値で書く。"""
        for f in (self.mjpg, self.index, self.hevc_file, self.audio_file, self.audio_index):
            if f:
                f.flush()
        (self.out_dir / "summary.json").write_text(json.dumps(self.summary(), ensure_ascii=False, indent=1), encoding="utf-8")

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.mjpg.close()
        if self.audio_file:
            self.audio_file.close()
            self.audio_index.close()
        if self.hevc_file:
            self.hevc_file.close()
        self.index.close()
        (self.out / "summary.json").write_text(json.dumps(self.summary(), ensure_ascii=False, indent=1), encoding="utf-8")


async def ping_loop(writer: asyncio.StreamWriter, stop: asyncio.Event):
    i = 0
    while not stop.is_set():
        for _ in range(8 if i == 0 else 3):
            i += 1
            try:
                writer.write(PING.pack(b"PNG1", time.time() * 1000, i))
                await writer.drain()
            except Exception:
                return
            await asyncio.sleep(0.15)
        try:
            await asyncio.wait_for(stop.wait(), 10)
        except asyncio.TimeoutError:
            pass


def free_gb(path: Path) -> int:
    try:
        return int(shutil.disk_usage(path).free / 1e9)
    except OSError:
        return 0


async def ack_loop(writer: asyncio.StreamWriter, rec: Recorder, stop: asyncio.Event):
    """毎秒、本当にディスクへ書いた分を端末へ返す(端末の画面の「Mac 保存」)。書けなくなったら返さない = 端末が警告を出す。"""
    while not stop.is_set():
        try:
            rec.flush()
            writer.write(RCV.pack(b"RCV1", len(rec.rows), int(rec.bytes / 1_000_000), free_gb(rec.out)))
            await writer.drain()
        except Exception as e:
            print("保存の応答を止めた:", e, flush=True)
            return
        try:
            await asyncio.wait_for(stop.wait(), 1.0)
        except asyncio.TimeoutError:
            pass


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, rec: Recorder, first: bytes | None = None):
    rec.connections += 1
    peer = writer.get_extra_info("peername")
    rec.peer = str(peer[0]) if peer else ""
    print("つながった:", peer)
    stop = asyncio.Event()
    pinger = asyncio.create_task(ping_loop(writer, stop))
    acker = asyncio.create_task(ack_loop(writer, rec, stop))
    sent_at: dict[int, float] = {}
    try:
        while True:
            magic = first if first else await reader.readexactly(4)
            first = None
            if magic == b"AUD1":
                _, plen, aseq, rate, ch, bits, pts, cap_ms = AUDH.unpack(magic + await reader.readexactly(AUDH.size - 4))
                pcm = await reader.readexactly(plen)
                if rec.audio_file is None:
                    rec.audio_file = open(rec.out_dir / "audio.raw", "wb")
                    rec.audio_index = open(rec.out_dir / "audio_index.jsonl", "w", encoding="utf-8")
                rec.audio_file.write(pcm)
                row = {"seq": aseq, "rate": rate, "channels": ch, "bits": bits, "pts": pts, "sent_ms": cap_ms, "recv_ms": time.time() * 1000, "bytes": plen, "offset": rec.audio_off}
                rec.audio_index.write(json.dumps(row) + "\n")
                rec.audio_off += plen
                rec.audio_rows.append(row)
                continue
            if magic == b"CAL1":
                _, clen = CALH.unpack(magic + await reader.readexactly(CALH.size - 4))
                if clen > 5_000_000:
                    print("校正が大きすぎる。切る")
                    break
                body = await reader.readexactly(clen)
                if not rec.add_calibration(body):
                    print("校正(CAL1)の JSON が読めない。無視する", flush=True)
                continue
            if magic == b"PON1":
                _, echo, phone_ms, idx = PONG.unpack(magic + await reader.readexactly(PONG.size - 4))
                now = time.time() * 1000
                rtt = now - echo
                rec.clock_samples.append((rtt, phone_ms - (echo + rtt / 2)))
                continue
            if magic not in (b"PCF1", b"HEV1"):
                print("形が違う。切る")
                break
            rest = await reader.readexactly(HEADER.size - 4)
            _, jlen, seq, recf, ar_ts, sent_ms, w, h, flags = HEADER.unpack(magic + rest)
            if jlen > 20_000_000:
                print("大きすぎる。切る")
                break
            floats = FLOATS.unpack(await reader.readexactly(FLOATS.size))
            jpeg = await reader.readexactly(jlen)
            rec.add({"seq": seq, "rec_frame": recf, "ar_ts": ar_ts, "sent_ms": sent_ms, "recv_ms": time.time() * 1000, "w": w, "h": h,
                     "flags": flags, "T": list(floats[:16]), "K": list(floats[16:])}, jpeg, hevc=(magic == b"HEV1"))
    except asyncio.IncompleteReadError:
        pass
    finally:
        stop.set()
        pinger.cancel()
        acker.cancel()
        print("切れた:", peer, "受けたコマ", len(rec.rows))
        writer.close()


async def main_async(a):
    # --split-takes: つなぐごとに take_001、take_002 … に分ける(アプリの録画ボタンが送りの開始・終了になる)
    state = {"rec": Recorder(Path(a.out) / "take_001") if a.split_takes else Recorder(Path(a.out)), "n": 1, "used": False, "all": [], "open": set()}
    state["all"].append(state["rec"])

    async def on_connect(r, w):
        try:
            first = await r.readexactly(4)
        except asyncio.IncompleteReadError:
            w.close()
            return
        if first == b"PRB1":        # つなぎの試し: テイクを作らずに答える
            w.write(RCV.pack(b"RCV1", 0, 0, free_gb(Path(a.out))))
            await w.drain()
            w.close()
            print("つなぎの試し: OK", flush=True)
            return
        if a.split_takes:
            if state["used"]:
                # 前のテイクは、つながりが切れていれば閉じる。**まだつながっている端末(2 台目が来たとき)の記録は閉じない**
                for old in state["all"]:
                    if old not in state["open"]:
                        old.close()
                state["n"] += 1
                state["rec"] = Recorder(Path(a.out) / f"take_{state['n']:03d}")
                state["all"].append(state["rec"])
            state["used"] = True
            print("テイク:", state["rec"].out, flush=True)
        rec = state["rec"]
        state["open"].add(rec)
        try:
            await handle(r, w, rec, first)
        finally:
            state["open"].discard(rec)
            if a.split_takes:
                rec.checkpoint()

    server = await asyncio.start_server(on_connect, a.bind, a.port)

    async def status_loop():
        last = (0, time.time())
        while True:
            await asyncio.sleep(5)
            rec = state["rec"]
            if rec.closed:
                continue
            if last[0] > len(rec.rows):
                last = (0, time.time())
            n, now = len(rec.rows), time.time()
            fps = (n - last[0]) / (now - last[1]) if now > last[1] else 0
            seqs = [r["seq"] for r in rec.rows[-300:]]
            lost = (seqs[-1] - seqs[0] + 1) - len(set(seqs)) if seqs else 0
            lag = ""
            if rec.clock_samples and rec.rows:
                best = sorted(rec.clock_samples)[: max(3, len(rec.clock_samples) // 4)]
                off = sorted(o for _, o in best)[len(best) // 2]
                lag = f"  遅れ {rec.rows[-1]['recv_ms'] - (rec.rows[-1]['sent_ms'] - off):.0f} ms"
            print(f"[受信中] コマ {n}(毎秒 {fps:.1f})  欠け(直近 300 コマ){lost}  {rec.bytes / 1e6:.0f} MB  音 {len(rec.audio_rows)} 塊{lag}", flush=True)
            last = (n, now)
            try:
                rec.checkpoint()
            except Exception:
                pass
    status_task = asyncio.create_task(status_loop())
    print(f"待ち受け {a.bind}:{a.port}、記録 {a.out}" + (f"、{a.seconds} 秒で終わる" if a.seconds else "(Ctrl+C で終わる)"))
    try:
        if a.seconds:
            await asyncio.sleep(a.seconds)
        else:
            await asyncio.Event().wait()
    finally:
        server.close()
        for old in state["all"]:
            old.close()
        print(json.dumps(state["rec"].summary(), ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--port", type=int, default=9100)
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--seconds", type=float, default=0)
    ap.add_argument("--split-takes", action="store_true", help="つなぐごとに take_001… に分ける")
    a = ap.parse_args()
    try:
        asyncio.run(main_async(a))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
