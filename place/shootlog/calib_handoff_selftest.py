"""点の校正の結果が、受け手 → pc_to_frames → shoot_track.build_track まで人の手なしで届くかの通し試験(正解の分かる合成データ)。

  python place/shootlog/calib_handoff_selftest.py
作り: 舞台の前を 10 秒歩く正解のカメラ(K は実機の値 fx 3065・4K)→ 仮の ARKit の世界(y 回りの回転+平行移動)で 33 点のレイを雑音つきで作る →
アプリと同じ形の電文(HEV1・CAL1)を本物のソケットで受け手(pc_stream_receiver.py --split-takes)へ流す → pc_to_frames.py → show/composite/shoot_track.build_track()
→ UE の位置・向き・焦点距離を正解と比べる。①広角 ②寄り 2 倍 ③レイなし(はっきり失敗) ④世界の ID が途中で変わる(はっきり失敗)
⑤レイが更新された(最新が使われる) ⑥誤検出だけの CAL1 で終わったテイクが、同じ世界の別のテイクの校正を使う(accepted を優先)
⑦世界の ID が違うテイクの校正は使わない。実機の確かめではない(ARKit の世界・点の拾いは作り物)。
合格の線: 位置 中央値 3 cm・向き 0.3°(中央値)・横の画角 64° ± 0.5°・主点のずれが映像の画素で正しい・面ごとの残差 3 cm 以内。
"""
from __future__ import annotations

import json
import math
import socket
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path[:0] = [str(HERE), str(ROOT / "show" / "composite")]
import dots_align  # noqa: E402
import shoot_track  # noqa: E402
from stage_layout import A_X0, LED_Z_BOTTOM  # noqa: E402
from ue_axes import focal_from_fx  # noqa: E402

PORT = 19101
HEADER = struct.Struct(">4sIIiddHHB")
FPS, SECONDS = 30, 10
N = FPS * SECONDS
FX4K, CX4K, CY4K = 3065.0, 1920.0 + 7.0, 1080.0 - 5.0     # 実機の fx。主点は中心から少しずらす(主点の扱いも確かめる)
ARKIT_THETA, ARKIT_T = math.radians(37.0), np.array([1.3, -0.4, 2.1])     # 仮の ARKit の世界(舞台の座標からのずれ)
POS_TOL_CM, ANGLE_TOL_DEG, FOV_TOL_DEG, FACE_TOL_CM = 3.0, 0.3, 0.5, 3.0
ok_all = True


def check(name, cond, detail=""):
    global ok_all
    ok_all = ok_all and bool(cond)
    print(("  合格 " if cond else "  不合格 ") + name + (f"  {detail}" if detail else ""))


# ---- 正解のカメラ ---------------------------------------------------------------------------

def stage_to_page(X, Y, Z):
    """舞台の (X, Y, Z) cm → ページの LED の座標 m(右手系、y が上)。"""
    return np.array([(X - A_X0) / 100.0, (Z - LED_Z_BOTTOM) / 100.0, Y / 100.0])


def rigid(theta, t):
    c, s = math.cos(theta), math.sin(theta)
    m = np.eye(4)
    m[:3, :3] = [[c, 0, s], [0, 1, 0], [-s, 0, c]]
    m[:3, 3] = t
    return m


def truth_pose(i):
    """i コマ目の正解。戻り: (UE の位置 cm, UE の前の単位ベクトル, T カメラ→ページ 4x4)。舞台の前を下手から上手へ歩き、舞台の中央の上を向く。"""
    t = i / FPS
    s = t / SECONDS
    s = s * s * (3 - 2 * s)
    X, Y, Z = -300 + 600 * s, 900 - 200 * s, 150 + 5 * math.sin(2 * math.pi * 0.5 * t)
    pos = stage_to_page(X, Y, Z)
    fwd = stage_to_page(0, 0, 300) - pos
    fwd /= np.linalg.norm(fwd)
    z = -fwd
    x = np.cross([0, 1, 0], z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = x, y, z, pos
    fwd_ue = np.array([fwd[0], fwd[2], fwd[1]])     # ページ (x, y, z) → 舞台 (X, Y, Z) = (x, z, y)
    return np.array([X, Y, Z]), fwd_ue, T


def ue_rotator_truth(fwd_ue):
    """前から UE の Pitch・Yaw(ロール 0 = 水平)。"""
    return math.degrees(math.asin(fwd_ue[2])), math.degrees(math.atan2(fwd_ue[1], fwd_ue[0]))


# ---- 電文 ---------------------------------------------------------------------------------

def make_rays(rng, theta=ARKIT_THETA, t=ARKIT_T, per_dot=2, noise_rad=0.0002, origin_noise_m=0.005):
    """33 点のレイ(仮の ARKit の世界)。カメラは舞台の正面 13 m のあたりで、点ごとに少し動く。"""
    M = rigid(theta, t)
    out = []
    for k, d in enumerate(dots_align.DOTS):
        for _ in range(per_dot):
            o_page = stage_to_page(0, 1300, 170) + rng.uniform(-0.5, 0.5, 3)
            direction = np.asarray(d["p"]) - o_page
            direction = M[:3, :3] @ (direction / np.linalg.norm(direction)) + rng.normal(0, noise_rad, 3)
            origin = M[:3, :3] @ o_page + M[:3, 3] + rng.normal(0, origin_noise_m, 3)
            out.append({"face": "A", "id": f"dot{k}", "dot": k, "origin": origin.tolist(), "direction": (direction / np.linalg.norm(direction)).tolist()})
    return out


def false_rays(rng, n=3):
    """誤検出のレイ(点の番号は本物、向きはでたらめ)。"""
    out = []
    for k in rng.choice(33, n, replace=False):
        d = rng.normal(size=3)
        out.append({"face": "A", "id": f"dot{int(k)}", "dot": int(k), "origin": (rng.normal(size=3) * 3).tolist(), "direction": (d / np.linalg.norm(d)).tolist()})
    return out


def cal_packet(session, rays, accepted=None):
    """accepted は、アプリが良い校正を送るときの印(None なら付けない = 古いアプリの形)。"""
    doc = {"arSessionId": session, "rays": rays}
    if accepted is not None:
        doc.update(accepted=accepted, latestDots=len(rays or []))
    body = json.dumps(doc).encode("utf-8")
    return b"CAL1" + struct.pack(">I", len(body)) + body


def frame_packet(i, zoom):
    _, _, T_page = truth_pose(i)
    T = rigid(ARKIT_THETA, ARKIT_T) @ T_page
    if zoom:   # 寄り 2 倍: 中央の 1920×1080 を切り出す。アプリは K を fx·2, fy·2, (cx−960)·2, (cy−540)·2 で送る(受け手は 0.5 倍して映像の画素にする)
        K = [FX4K * 2, FX4K * 2, (CX4K - 960) * 2, (CY4K - 540) * 2]
    else:
        K = [FX4K, FX4K, CX4K, CY4K]
    payload = b"\x00\x00\x00\x01" + bytes(64)
    floats = struct.pack(">20f", *(T.T.reshape(-1).tolist() + K))
    return HEADER.pack(b"HEV1", len(payload), i + 1, -1, 1000.0 + i / FPS, time.time() * 1000, 1920, 1080, 2 | (4 if i == 0 else 0)) + floats + payload


def send_take(events, zoom=False):
    """events: ("cal", packet) か ("frames", 始め, 終わり)。受け手が全部書いたと答えるまで待ってから切る。"""
    s = socket.create_connection(("127.0.0.1", PORT), timeout=5)
    sent = 0
    for ev in events:
        if ev[0] == "cal":
            s.sendall(ev[1])
        else:
            for i in range(ev[1], ev[2]):
                s.sendall(frame_packet(i, zoom))
                sent += 1
                time.sleep(0.003)
    s.settimeout(3)
    buf, acked, end = b"", -1, time.time() + 6
    while time.time() < end and acked < sent:
        try:
            buf += s.recv(4096)
        except socket.timeout:
            break
        while len(buf) >= 16:
            m, buf = buf[:16], buf[16:]
            if m[:4] == b"RCV1":
                acked = struct.unpack(">I", m[4:8])[0]
    s.close()
    time.sleep(0.8)      # 受け手がテイクを閉じて、ファイルを書き切るのを待つ
    return sent


# ---- 評価 ---------------------------------------------------------------------------------

def run_convert(take_dir, out_dir):
    r = subprocess.run([sys.executable, str(HERE / "pc_to_frames.py"), "--rx", str(take_dir), "--out", str(out_dir), "--ffmpeg", "no-such-ffmpeg"],
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print(r.stdout, r.stderr)
    return r.stdout


def evaluate(track, zoom):
    rows = track["rows"]
    pos_err, ang_err = [], []
    for row in rows:
        p, fwd, _ = truth_pose(row["f"])
        pos_err.append(float(np.linalg.norm(np.array([row["x"], row["y"], row["z"]]) - p)))
        pitch, yaw = ue_rotator_truth(fwd)
        got = np.array([math.cos(math.radians(row["pitch"])) * math.cos(math.radians(row["yaw"])), math.cos(math.radians(row["pitch"])) * math.sin(math.radians(row["yaw"])), math.sin(math.radians(row["pitch"]))])
        angle = math.degrees(math.acos(float(np.clip(got @ fwd, -1, 1))))
        ang_err.append(max(angle, abs(row["roll"])))       # 正解のロールは 0
    fx_video = FX4K
    fx_video = fx_video if zoom else fx_video / 2
    expected_focal = focal_from_fx(fx_video, 1920)
    fov = math.degrees(2 * math.atan(18.0 / np.median([r["focal"] for r in rows])))
    expected_fov = math.degrees(2 * math.atan(960 / fx_video))
    cx_vid = (CX4K - 960) if zoom else CX4K / 2
    cy_vid = (CY4K - 540) if zoom else CY4K / 2
    expect_pp = [cx_vid - 960, cy_vid - 540]
    print(f"    位置 中央値 {np.median(pos_err):.2f} cm(最大 {max(pos_err):.2f})、向き 中央値 {np.median(ang_err):.3f}°(最大 {max(ang_err):.3f})、"
          f"焦点距離 {np.median([r['focal'] for r in rows]):.2f} mm(想定 {expected_focal:.2f})、横の画角 {fov:.2f}°(想定 {expected_fov:.2f})、主点のずれ {track['principal_offset_px']}(想定 {expect_pp})")
    check("位置 中央値 3 cm 以内", np.median(pos_err) <= POS_TOL_CM)
    check("向き 中央値 0.3° 以内", np.median(ang_err) <= ANGLE_TOL_DEG)
    check("横の画角が想定 ± 0.5°" + ("(寄り 2 倍 34.9°)" if zoom else "(広角 64°)"), abs(fov - expected_fov) <= FOV_TOL_DEG)
    check("主点のずれが映像の画素で正しい(±0.01 px)", np.allclose(track["principal_offset_px"], expect_pp, atol=0.01))
    check("shoot_track の面ごとの残差 3 cm 以内", all(v["max_cm"] <= FACE_TOL_CM for v in track["residuals"].values()), json.dumps({f: v["max_cm"] for f, v in track["residuals"].items()}))
    return track


def face_residuals(out_dir):
    return {f: json.loads((out_dir / f"alignment_{f}.json").read_text(encoding="utf-8")) for f in "ABC"}


def main():
    work = Path(tempfile.mkdtemp(prefix="calib_handoff_"))
    rx_dir = work / "rx"
    proc = subprocess.Popen([sys.executable, str(HERE / "pc_stream_receiver.py"), "--out", str(rx_dir), "--port", str(PORT), "--seconds", "300", "--split-takes"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    rng = np.random.default_rng(11)
    half = N // 2
    try:
        print("① 広角(K は fx 3065・4K)。つないだ直後・途中・止める直前に CAL1")
        rays = make_rays(rng)
        send_take([("cal", cal_packet("S1", rays)), ("frames", 0, half), ("cal", cal_packet("S1", rays)), ("frames", half, N), ("cal", cal_packet("S1", rays))])
        t1, o1 = rx_dir / "take_001", work / "out_1"
        text = run_convert(t1, o1)
        print("   ", [x for x in text.splitlines() if x.startswith("校正")][0])
        check("受け手の calibration_rays.json が、最新の CAL1(3 通)", json.loads((t1 / "calibration_rays.json").read_text(encoding="utf-8"))["messages"] == 3 and not (t1 / "calibration_rays.json.tmp").exists())
        track = evaluate(shoot_track.build_track(o1), zoom=False)
        al = face_residuals(o1)
        check("alignment: 面 A・B・C が source=dots で、面ごとの残差 3 cm 以内、rms も 3 cm 以内",
              all(a["source"] == "dots" and (a["face_residual_cm"] or 0) <= FACE_TOL_CM and a["rms_cm"] <= FACE_TOL_CM for a in al.values()),
              json.dumps({f: [a["face_residual_cm"], a["rms_cm"], a["dots_used"]] for f, a in al.items()}))
        meta = json.loads((o1 / "meta.json").read_text(encoding="utf-8"))
        check("meta: intrinsics_scale=1.0、source_intrinsics_scale=0.5、calibration_source=dots",
              meta["intrinsics_scale"] == 1.0 and meta["source_intrinsics_scale"] == 0.5 and meta["calibration_source"]["source"] == "dots")
        # 鎖の確認: 世界 → UE の変換が、ARKit の世界のずれを打ち消している(位置の誤差が小さいことが、その証拠)

        print("② 寄り 2 倍(K は fx·2 … で送られる)")
        send_take([("cal", cal_packet("S2", rays)), ("frames", 0, N), ("cal", cal_packet("S2", rays))], zoom=True)
        o2 = work / "out_2"
        run_convert(rx_dir / "take_002", o2)
        evaluate(shoot_track.build_track(o2), zoom=True)

        print("③ レイなし(つないだ直後から rays=null)。はっきり失敗する")
        send_take([("cal", cal_packet("S3", None)), ("frames", 0, N), ("cal", cal_packet("S3", None))])
        o3 = work / "out_3"
        text = run_convert(rx_dir / "take_003", o3)
        print("   ", [x for x in text.splitlines() if x.startswith("校正")][0])
        raised = ""
        try:
            shoot_track.build_track(o3)
        except RuntimeError as e:
            raised = str(e)
        check("pc_to_frames が「使えない」と理由を出し、alignment を書かず、build_track が止まる",
              "点のレイが無い" in text and not list(o3.glob("alignment_*.json")) and "alignment" in raised, raised)

        print("④ 世界の ID が途中で変わる(最初 S4a でレイなし → 途中から S4b でレイあり)。はっきり失敗する")
        send_take([("cal", cal_packet("S4a", None)), ("frames", 0, half), ("cal", cal_packet("S4b", rays)), ("frames", half, N), ("cal", cal_packet("S4b", rays))])
        o4 = work / "out_4"
        text = run_convert(rx_dir / "take_004", o4)
        print("   ", [x for x in text.splitlines() if x.startswith("校正")][0])
        raised = ""
        try:
            shoot_track.build_track(o4)
        except RuntimeError as e:
            raised = str(e)
        check("世界が変わったと理由を出し、alignment を書かず、build_track が止まる", "世界が変わった" in text and not list(o4.glob("alignment_*.json")) and "alignment" in raised, raised)

        print("⑤ レイが更新された(最初は別の世界のずれで解いたレイ → 途中で正しいレイ。同じ世界の ID)。最新が使われる。途中に壊れた JSON も混ぜる")
        wrong = make_rays(rng, theta=ARKIT_THETA + 0.35, t=ARKIT_T + np.array([0.8, 0.0, -0.6]))
        bad = b"CAL1" + struct.pack(">I", 5) + b"{oops"
        send_take([("cal", cal_packet("S5", wrong)), ("frames", 0, half), ("cal", bad), ("cal", cal_packet("S5", rays)), ("frames", half, N), ("cal", cal_packet("S5", rays))])
        o5 = work / "out_5"
        run_convert(rx_dir / "take_005", o5)
        doc = json.loads((rx_dir / "take_005" / "calibration_rays.json").read_text(encoding="utf-8"))
        check("受け手: 壊れた JSON を無視し、有効な CAL1 3 通で、最新のレイ", doc["messages"] == 3 and doc["rays"][0]["origin"] == rays[0]["origin"], f"messages={doc['messages']}")
        evaluate(shoot_track.build_track(o5), zoom=False)

        print("⑥ 良い校正(S1、17 点、accepted)のテイクのあと、誤検出 3 本だけの CAL1 で終わる S1 のテイク → 同じ世界の別のテイクの校正を使う(accepted の物を優先)")
        good17 = [r for r in rays if r["dot"] % 2 == 0]
        send_take([("cal", cal_packet("S1", good17, accepted=True)), ("frames", 0, N), ("cal", cal_packet("S1", good17, accepted=True))])
        run_convert(rx_dir / "take_006", work / "out_6a")
        send_take([("cal", cal_packet("S1", rays, accepted=True)), ("frames", 0, half), ("cal", cal_packet("S1", false_rays(rng), accepted=False)),
                   ("frames", half, N), ("cal", cal_packet("S1", false_rays(rng), accepted=False))])
        o6 = work / "out_6b"
        text = run_convert(rx_dir / "take_007", o6)
        print("   ", [x for x in text.splitlines() if x.startswith("校正")][0])
        doc = json.loads((rx_dir / "take_007" / "calibration_rays.json").read_text(encoding="utf-8"))
        src = json.loads((o6 / "meta.json").read_text(encoding="utf-8"))["calibration_source"]
        check("受け手は最新(誤検出 3 本、accepted=false)を書き、pc_to_frames は take_006(accepted)の校正を使う(take_001 は 33 点だが accepted でない)",
              not doc["accepted"] and len(doc["rays"]) == 3 and src["source"] == "dots" and src["borrowed_from"] == "take_006" and src["accepted"] and "別のテイク take_006" in text, json.dumps(src, ensure_ascii=False)[:160])
        evaluate(shoot_track.build_track(o6), zoom=False)

        print("⑦ 世界の ID が違う(S9)テイクは、ほかのテイクに良い校正があっても使わない")
        send_take([("cal", cal_packet("S9", false_rays(rng), accepted=False)), ("frames", 0, N), ("cal", cal_packet("S9", false_rays(rng), accepted=False))])
        o7 = work / "out_7"
        text = run_convert(rx_dir / "take_008", o7)
        print("   ", [x for x in text.splitlines() if x.startswith("校正")][0])
        raised = ""
        try:
            shoot_track.build_track(o7)
        except RuntimeError as e:
            raised = str(e)
        check("使えないと理由を出し(別のテイクの校正は借りない)、alignment を書かず、build_track が止まる",
              "校正: 使えない" in text and "別のテイク" not in text and not list(o7.glob("alignment_*.json")) and "alignment" in raised, raised)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    print("全部合格" if ok_all else "不合格あり")
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
