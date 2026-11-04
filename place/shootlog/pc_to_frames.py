"""PC の受け手(pc_stream_receiver.py)の記録 → 撮影記録(frames.jsonl・meta.json・video.mp4)と同じ形のフォルダ。ショーの import_shoot にそのまま渡せる。

  python place/shootlog/pc_to_frames.py --rx <受け手の出力フォルダ> --out <撮影フォルダ> [--from-flash <秒>] [--ffmpeg ffmpeg]
受け手の出力: stream.hevc(フル HD の Annex B)・index.jsonl(コマごと: ar_ts・T・K・flags・sent_ms …)・summary.json(clock.offset_ms など)・audio.raw/audio_index.jsonl。
作る物:
  frames.jsonl … 1 行 1 コマ(HEVC のアクセスユニット 1 つ = 1 コマ)。{"i","t","pts","T","K","track","ok"}。
      t   = ARFrame.timestamp(端末の起動からの秒。録画の frames.jsonl の t と同じ時計・同じ意味)
      pts = t − 最初のコマの t(秒。コマが落ちても本当の時刻。映像の中の時刻は 30 fps の目安なので、合成は frames.jsonl の pts を使うこと)
      K   = video.mp4 の画素の [fx fy cx cy]。受け手の記録の K は元の 4K の画素なので、1920/元の幅 倍して書く(2026-11-04 から。前は元の画素のまま
            intrinsics_scale を書いていて、shoot_track.py が読み落とし焦点距離が 2 倍になった)。meta.json の intrinsics_scale は 1.0、元の縮尺は source_intrinsics_scale。
  meta.json … 撮影記録の形(videoFile・stats.width/height/frames・format)+ source=pc_stream、端末と PC の時計のずれ(clock_offset_ms)、画角の縮尺。
  video.mp4 … stream.hevc を再符号化せずに mp4 に包んだ物(ffmpeg -f hevc -r 30 -c copy)。
  alignment_A/B/C.json … 受け手の calibration_rays.json(アプリの点の校正のレイ)があれば dots_align.py で解いて書く。使えないとき(無い・世界の ID が途中で変わった・
      点が足りない・残差が大きい)は理由を標準出力に出して書かない。結果は meta.json の calibration_source。shoot_track.build_track() がそのまま読む。
  audio.wav … audio.raw があれば(ffmpeg -f s16le)。pts は audio_index.jsonl の pts(frames.jsonl の t と同じ時計)。
rec_frame は使わない(録画なしの送りでは全部 -1)。--from-flash <秒> を付けると、その t 以降のコマだけにする。
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


def _solve_doc(doc: dict):
    """calibration_rays.json の中身 → (solve の結果, 使えない理由)。結果が ok でなければ理由が入る。"""
    sessions = doc.get("sessions") or [doc.get("arSessionId")]
    if len(sessions) > 1:
        return None, f"録画の間に ARKit の世界が変わった(世界の ID が {len(sessions)} 通り)。カメラの位置の約束が途中で変わるので、校正も位置も一貫しない"
    rays = doc.get("rays")
    if not rays:
        return None, "点のレイが無い(アプリで LED の点の映像を見せて校正してから録る。校正したあとにアプリを再起動・やり直しすると捨てられる)"
    import dots_align
    res = dots_align.solve(rays)
    if not res["ok"]:
        return res, res["reason"]
    res["arSessionId"] = doc.get("arSessionId")
    res["accepted"] = bool(doc.get("accepted", False))
    return res, ""


def _borrow(rx: Path, world: str):
    """同じ親フォルダの別のテイクの校正のうち、世界の ID が同じ(1 通りだけで、同じ)物から、解いて合格した最良の物を探す。(名前, 結果) か None。
    世界の ID が違う・途中で変わった物は決して使わない。accepted(アプリのページが良いと判定した物)を先に、次に点の数が多い物。"""
    if not rx.name.startswith("take_"):
        return None
    found = []
    for d in sorted(rx.parent.glob("take_*")):
        f = d / "calibration_rays.json"
        if d == rx or not f.exists():
            continue
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
            if (doc.get("sessions") or [doc.get("arSessionId")]) != [world]:
                continue
            res, _ = _solve_doc(doc)
        except (OSError, ValueError):
            continue
        if res and res["ok"]:
            found.append((res["accepted"], res["n_dots"], d.name, res))
    if not found:
        return None
    best = max(found, key=lambda x: (x[0], x[1]))
    return best[2], best[3]


def calibrate(rx: Path, out: Path) -> dict:
    """受け手の calibration_rays.json → alignment_A/B/C.json。meta に書く calibration_source を返す。使えないときは理由を出して alignment を書かない。
    このテイクの校正が使えないとき(レイなし・点不足・残差超え)は、同じ世界の ID の別のテイクの校正を使う。"""
    def fail(reason: str, **extra) -> dict:
        print(f"校正: 使えない({reason})。alignment は書かない(合成には撮影記録の 4 隅か、点の校正をやり直した録り直しが要る)")
        for face in "ABC":     # 前の実行の点の校正の alignment が残っていると、黙って古い校正を使ってしまう
            f = out / f"alignment_{face}.json"
            try:
                if f.exists() and json.loads(f.read_text(encoding="utf-8")).get("source") == "dots":
                    f.unlink()
                    print(f"  前の実行の {f.name} は消した")
            except (OSError, ValueError):
                pass
        return {"source": "none", "reason": reason, **extra}

    path = rx / "calibration_rays.json"
    if not path.exists():
        return fail("校正のファイルが無い(受け手が CAL1 を受けていない。アプリが古いか、校正の道が動いていない。世界の ID が分からないので、ほかのテイクの校正も使わない)")
    doc = json.loads(path.read_text(encoding="utf-8"))
    try:
        import dots_align
    except ImportError as e:
        return fail(f"校正を計算する部品が読めない({e}。dots_align.py と stage_layout.py を pc_to_frames.py と同じフォルダに置く)")
    sessions = doc.get("sessions") or [doc.get("arSessionId")]
    res, reason = _solve_doc(doc)
    borrowed = None
    if not (res and res["ok"]):
        if len(sessions) == 1 and doc.get("arSessionId"):
            hit = _borrow(rx, doc["arSessionId"])
            if hit:
                borrowed, res = hit
                print(f"校正: このテイクの校正は使えない({reason})ので、同じ世界の別のテイク {borrowed} の校正を使う")
        if borrowed is None:
            return fail(reason, arSessionId=doc.get("arSessionId"), rays_total=(res or {}).get("n_rays_all"), dots=(res or {}).get("n_dots"))
    dots_align.write_alignments(out, res)
    faces = " ".join(f"{f} {v:.1f}" for f, v in sorted(res["face_residual_cm"].items()))
    src = f"(テイク {borrowed} の校正)" if borrowed else ""
    print(f"校正: 点 {res['n_dots']}/33(レイ {res['n_rays']}/{res['n_rays_all']})、残差 {res['rms_cm']:.1f} cm、面ごとの残差(cm) {faces} → alignment_A/B/C.json を書いた{src}")
    return {"source": "dots", "borrowed_from": borrowed, "own_take_reason": reason if borrowed else None, "arSessionId": res["arSessionId"], "accepted": res["accepted"],
            "dots_used": res["n_dots"], "rays_used": res["n_rays"], "rays_total": res["n_rays_all"],
            "rms_cm": round(res["rms_cm"], 3), "face_residual_cm": res["face_residual_cm"], "yaw_deg": round(res["yaw_deg"], 3), "messages": doc.get("messages")}


def main():
    for stream in (sys.stdout, sys.stderr):   # Windows の cp932 の画面で、表示できない文字があっても落ちない
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
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
                                 "K": [round(v * scale, 3) for v in r["K"]], "track": "normal" if ok else "limited", "ok": ok, "seq": r["seq"]}))
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
            "intrinsics_scale": 1.0, "source_intrinsics_scale": scale, "source_width": a.source_width,
            "intrinsics_note": "frames.jsonl の K は video.mp4 の画素([fx fy cx cy])。受け手の記録(元の幅 %d の画素)に source_intrinsics_scale を掛けて書いた。そのまま使ってよい" % a.source_width,
            "video_frame_offset": skip, "video_note": "video.mp4 は受け手が受けた全コマ。frames.jsonl の i=0 は video の %d コマ目(0 始まり)" % skip,
            "clock_offset_ms": (summary.get("clock") or {}).get("offset_ms"), "latency_corrected_ms": summary.get("latency_corrected_ms"),
            "audio": summary.get("audio"), "calibration_source": calibrate(rx, out),
            "conventions": {"t": "ARFrame.timestamp(端末の起動からの秒)", "pts": "t - 最初の t", "T": "カメラ→世界の 4x4(列順 16 個)", "K": "[fx fy cx cy] video.mp4 の画素"}}
    (out / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"書いた: {out}(コマ {len(keep)}、{keep[-1]['ar_ts'] - t0:.1f} 秒、{width}x{height}、K の縮尺 {scale})")


if __name__ == "__main__":
    main()
