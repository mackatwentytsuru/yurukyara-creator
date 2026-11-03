"""PC の受け手(pc_stream_receiver.py)の記録 → 撮影記録(frames.jsonl・meta.json・video.mp4)と同じ形のフォルダ。ショーの import_shoot にそのまま渡せる。

  python place/shootlog/pc_to_frames.py --rx <受け手の出力フォルダ> --out <撮影フォルダ> [--from-flash <秒>] [--ffmpeg ffmpeg]
受け手の出力: stream.hevc(フル HD の Annex B)・index.jsonl(コマごと: ar_ts・T・K・flags・sent_ms …)・summary.json(clock.offset_ms など)・audio.raw/audio_index.jsonl。
作る物:
  frames.jsonl … 1 行 1 コマ(HEVC のアクセスユニット 1 つ = 1 コマ)。{"i","t","pts","T","K","track","ok"}。
      t   = ARFrame.timestamp(端末の起動からの秒。録画の frames.jsonl の t と同じ時計・同じ意味)
      pts = t − 最初のコマの t(秒。コマが落ちても本当の時刻。映像の中の時刻は 30 fps の目安なので、合成は frames.jsonl の pts を使うこと)
      K   = 元の映像(4K)の画素の [fx fy cx cy]。映像は 1920 幅に縮めてあるので、フル HD の画素にするには K を 1920/元の幅 倍する(meta.json の intrinsics_scale に書いた)。
  meta.json … 撮影記録の形(videoFile・stats.width/height/frames・format)+ source=pc_stream、端末と PC の時計のずれ(clock_offset_ms)、画角の縮尺。
  video.mp4 … stream.hevc を再符号化せずに mp4 に包んだ物(ffmpeg -f hevc -r 30 -c copy)。
  audio.wav … audio.raw があれば(ffmpeg -f s16le)。pts は audio_index.jsonl の pts(frames.jsonl の t と同じ時計)。
rec_frame は使わない(録画なしの送りでは全部 -1)。--from-flash <秒> を付けると、その t 以降のコマだけにする。
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rx", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--from-t", type=float, default=None, help="この t(ARFrame の時計の秒)以降のコマだけ")
    ap.add_argument("--source-width", type=int, default=3840, help="元の映像の幅(K の縮尺用。ARKit の 4K は 3840)")
    ap.add_argument("--ffmpeg", default="ffmpeg")
    a = ap.parse_args()
    rx, out = Path(a.rx), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = [json.loads(x) for x in (rx / "index.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    keep = [r for r in rows if a.from_t is None or r["ar_ts"] >= a.from_t]
    if not keep:
        raise SystemExit("コマが無い")
    t0 = keep[0]["ar_ts"]
    width, height = keep[0]["w"], keep[0]["h"]
    scale = width / a.source_width
    lines = []
    for i, r in enumerate(keep):
        ok = bool(r["flags"] & 2)
        lines.append(json.dumps({"i": i, "t": round(r["ar_ts"], 6), "pts": round(r["ar_ts"] - t0, 6), "T": [round(v, 6) for v in r["T"]],
                                 "K": [round(v, 3) for v in r["K"]], "track": "normal" if ok else "limited", "ok": ok, "seq": r["seq"]}))
    (out / "frames.jsonl").write_text("\n".join(lines), encoding="utf-8")
    # 映像: HEVC の頭(キーフレーム)から keep の最初のコマまで切るのは再符号化なしでは難しいので、全コマを包み、frames.jsonl 側で i のずれを持つ
    skip = rows.index(keep[0])
    summary = json.loads((rx / "summary.json").read_text(encoding="utf-8")) if (rx / "summary.json").exists() else {}
    if (rx / "stream.hevc").exists() and shutil.which(a.ffmpeg):
        subprocess.run([a.ffmpeg, "-v", "error", "-y", "-f", "hevc", "-r", "30", "-i", str(rx / "stream.hevc"), "-c", "copy", "-map_metadata", "-1", str(out / "video.mp4")], check=False)
    if (rx / "audio.raw").exists() and shutil.which(a.ffmpeg):
        subprocess.run([a.ffmpeg, "-v", "error", "-y", "-f", "s16le", "-ar", "48000", "-ac", "1", "-i", str(rx / "audio.raw"), str(out / "audio.wav")], check=False)
    meta = {"format": "camera-pose-log/1", "source": "pc_stream", "videoFile": "video.mp4", "framesFile": "frames.jsonl",
            "stats": {"width": width, "height": height, "frames": len(keep), "firstSessionTimestamp": t0, "durationSeconds": keep[-1]["ar_ts"] - t0,
                      "averageFps": (len(keep) - 1) / max(keep[-1]["ar_ts"] - t0, 1e-9)},
            "intrinsics_scale": scale, "intrinsics_note": "frames.jsonl の K は元の映像(幅 %d)の画素。video.mp4 の画素にするには fx fy cx cy に intrinsics_scale を掛ける" % a.source_width,
            "video_frame_offset": skip, "video_note": "video.mp4 は受け手が受けた全コマ。frames.jsonl の i=0 は video の %d コマ目(0 始まり)" % skip,
            "clock_offset_ms": (summary.get("clock") or {}).get("offset_ms"), "latency_corrected_ms": summary.get("latency_corrected_ms"),
            "audio": summary.get("audio"), "conventions": {"t": "ARFrame.timestamp(端末の起動からの秒)", "pts": "t - 最初の t", "T": "カメラ→世界の 4x4(列順 16 個)", "K": "[fx fy cx cy] 画素"}}
    (out / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"書いた: {out}(コマ {len(keep)}、{keep[-1]['ar_ts'] - t0:.1f} 秒、{width}x{height}、K の縮尺 {scale})")


if __name__ == "__main__":
    main()
