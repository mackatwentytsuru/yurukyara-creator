"""校正の受け渡しの実機の試験(本人の手なし): 本物の iPad の送り → Mac の受け手 → pc_to_frames → shoot_track.build_track。

  python place/shootlog/calib_device_test.py --out <出力フォルダ> [--seconds 15]
レイは合成(固定の端末では LED の点を見られないので `--test-calib-json` で読み込ませる)。確かめるのは経路と約束で、点の拾い方ではない:
CAL1 が接続の直後に届く・世界の ID が入る・実機の K が映像の画素で合成に渡る(横の画角 約 64°)・alignment が書かれて build_track が通る。
カメラの動きは本物の ARKit、レイの世界は合成なので、舞台の上の位置は意味を持たない(位置の正しさは calib_handoff_selftest.py で確かめる)。
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1] / "show" / "composite")]
import shoot_track  # noqa: E402
from calib_handoff_selftest import make_rays  # noqa: E402

BUNDLE = "dev.hackathon.shootlog"
IPAD = "00008103-001959392279001E"
MAC_LAN_IP = "192.168.x.x"
PORT = 9100
RAYS_NAME = "test_rays.json"
PATH = "export PATH=/opt/homebrew/bin:$PATH; "
HFOV_DEG, HFOV_TOL_DEG = 64.0, 1.0
ok_all = True


def check(name, cond, detail=""):
    global ok_all
    ok_all = ok_all and bool(cond)
    print(("合格 " if cond else "不合格 ") + name, detail)


def ssh(cmd, timeout=180):
    r = subprocess.run(["ssh", "-o", "ConnectTimeout=10", "pc3", PATH + cmd], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return (r.stdout or "") + (r.stderr or "")


def scp(src, dst):
    subprocess.run(["scp", "-q", src, dst], check=True, timeout=180)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seconds", type=int, default=15)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rx = "~/sample_work/rx/caltest"
    # レイを iPad の Documents へ
    rays = out / RAYS_NAME
    rays.write_text(json.dumps(make_rays(np.random.default_rng(7))), encoding="utf-8")
    scp(str(rays), f"pc3:/tmp/{RAYS_NAME}")
    copied = ssh(f"xcrun devicectl device copy to --device {IPAD} --domain-type appDataContainer --domain-identifier {BUNDLE} --source /tmp/{RAYS_NAME} --destination Documents/{RAYS_NAME} 2>&1 | tail -1")
    check("レイのファイルを iPad へ写せる", "error" not in copied.lower(), copied.strip())
    # 受け手とアプリ
    ssh(f"rm -rf {rx} && mkdir -p {rx}")
    receiver = subprocess.Popen(["ssh", "-o", "ConnectTimeout=10", "pc3", f"python3 ~/sample_work/rx/pc_stream_receiver.py --out {rx} --port {PORT} --seconds {a.seconds + 25}"],
                                stdout=open(out / "rx.log", "w"), stderr=subprocess.STDOUT)
    time.sleep(3)
    args = ["--test-calib-json", RAYS_NAME, "--auto-stream", str(a.seconds), "--exit-after-record", "--pc-on", "--pc-host", MAC_LAN_IP, "--pc-port", str(PORT), "--pc-codec", "hevc", "--pc-width", "1920", "--pc-kbps", "18000", "--pc-fps", "30"]
    launched = ssh(f"xcrun devicectl device process launch --device {IPAD} --terminate-existing {BUNDLE} " + " ".join(f"'{x}'" for x in args) + " 2>&1 | tail -1")
    print("起動:", launched.strip())
    time.sleep(a.seconds + 14)
    try:
        receiver.wait(timeout=30)
    except subprocess.TimeoutExpired:
        receiver.terminate()
    # Mac で直して、小さい物だけ持ち帰る
    converted = ssh(f"cd ~/sample_work/rx && python3 pc_to_frames.py --rx {rx} --out {rx}/shoot 2>&1 | tail -6")
    print(converted.strip())
    work = Path(tempfile.mkdtemp(prefix="caldev_"))
    try:
        for name in ("frames.jsonl", "meta.json", "alignment_A.json", "alignment_B.json", "alignment_C.json"):
            subprocess.run(["scp", "-q", f"pc3:sample_work/rx/caltest/shoot/{name}", str(work / name)], timeout=120)
        scp("pc3:sample_work/rx/caltest/calibration_rays.json", str(work / "calibration_rays.json"))
        scp("pc3:sample_work/rx/caltest/summary.json", str(work / "summary.json"))
        doc = json.loads((work / "calibration_rays.json").read_text(encoding="utf-8"))
        summary = json.loads((work / "summary.json").read_text(encoding="utf-8"))
        cal = summary.get("calibration") or {}
        check("CAL1 が接続の直後に届く(止める直前の分はボタンの経路なので ui_roundtrip.py で確かめる)", cal.get("messages", 0) >= 1 and cal.get("with_rays", 0) >= 1, cal)
        check("世界の ID が 1 つだけ", cal.get("sessions") == 1 and bool(doc.get("arSessionId")), doc.get("arSessionId"))
        check("ページの判定なしは accepted=false のまま", doc.get("accepted") is False, doc.get("accepted"))
        check("レイの本数が合う", len(doc.get("rays") or []) == 66, len(doc.get("rays") or []))
        check("映像のコマが届く", summary.get("seq_missing") == 0 and summary.get("frames", 0) > a.seconds * 25, {k: summary.get(k) for k in ("frames", "seq_missing", "fps")})
        meta = json.loads((work / "meta.json").read_text(encoding="utf-8"))
        check("meta の縮尺は 1.0、元の縮尺は別に残す", meta.get("intrinsics_scale") == 1.0 and meta.get("source_intrinsics_scale") == 0.5, {k: meta.get(k) for k in ("intrinsics_scale", "source_intrinsics_scale", "calibration_source")})
        track = shoot_track.build_track(work)
        rows = track["rows"]
        hfov = float(np.median([r["hfov_deg"] for r in rows])) if rows and "hfov_deg" in rows[0] else None
        focal = float(np.median([r["focal_mm"] for r in rows])) if rows and "focal_mm" in rows[0] else None
        off = track["principal_offset_px"]
        print("build_track:", {"width": track["width"], "focal_mm": focal, "hfov_deg": hfov, "principal_offset_px": off, "faces": track["faces"], "gaps": track["tracking_gaps_sec"], "rows": len(rows)})
        k = json.loads((work / "frames.jsonl").read_text(encoding="utf-8").splitlines()[0])["K"]
        measured = 2 * np.degrees(np.arctan(track["width"] / 2 / k[0]))
        check("実機の K が映像の画素(横の画角 約 64°)", abs(measured - HFOV_DEG) < HFOV_TOL_DEG, f"{measured:.2f}° fx {k[0]}")
        check("主点のずれが映像の画素の範囲", max(abs(off[0]), abs(off[1])) < 60, off)
        check("build_track が通る", len(rows) > 0 and track["faces"] == ["A", "B", "C"], len(rows))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    ssh(f"rm -rf {rx}; rm -f /tmp/{RAYS_NAME}")
    print("全部合格" if ok_all else "不合格あり")
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
