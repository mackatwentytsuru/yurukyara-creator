"""UE 版の通しの録画を 1 本にまとめる。左 = 床のカメラの録画(合成の客)と説明、右 = 入口の LED の UE の窓(縦長)。
python -X utf8 compose_ue.py final work\tmp_entrance\frames1"""
import json, subprocess, sys
from pathlib import Path

D = Path(sys.argv[1]).resolve()
FR = Path(sys.argv[2])
FONT = "C\:/Windows/Fonts/meiryo.ttc"
W, H, LW = 1280, 900, 572
REC20 = Path(r"work_1105\web\final\rec20.mp4")
t0 = int(FR.joinpath("t0.txt").read_text(encoding="utf-8-sig").strip()) / 1000
# 窓のコマ → 一定の速さの動画(コマの名前 = 撮り始めからの ms)
names = sorted(p for p in FR.glob("*.jpg"))
ms = [int(p.stem) for p in names]
lines = ["ffconcat version 1.0"]
for i, p in enumerate(names):
    lines.append(f"file '{p.as_posix()}'")
    lines.append(f"duration {((ms[i + 1] if i + 1 < len(ms) else ms[i] + 100) - ms[i]) / 1000:.3f}")
lines.append(f"file '{names[-1].as_posix()}'")
(D / "frames.ffconcat").write_text("\n".join(lines) + "\n", encoding="utf-8")
UE = D / "ue.mp4"


def run(args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


if not UE.exists():
    run(["-safe", "0", "-f", "concat", "-i", str(D / "frames.ffconcat"), "-vf", "scale=708:900,fps=30", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", str(UE)])
v0 = t0 + ms[0] / 1000  # ue.mp4 の 0 秒の時刻
ph = {p["name"]: p["unix_ms"] / 1000 - v0 for p in json.loads((D / "phases.json").read_text(encoding="utf-8"))}
playA = json.loads((D / "playA.json").read_text(encoding="utf-8"))
playD = json.loads((D / "playD.json").read_text(encoding="utf-8"))
evalr = json.loads((D / "calib" / "eval.json").read_text(encoding="utf-8"))
talk = [json.loads(l) for l in (D / "talk.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
base = talk[0]["q_unix"]
TXT = D / "txt"; TXT.mkdir(exist_ok=True)
SEG = D / "seg"; SEG.mkdir(exist_ok=True)


def tf(name, text):
    p = TXT / f"{name}.txt"
    p.write_text(text, encoding="utf-8")
    return str(p).replace("\\", "/").replace(":", "\:")


def dt(name, text, x, y, size=24, color="white", enable=None):
    s = f"drawtext=fontfile='{FONT}':textfile='{tf(name, text)}':x={x}:y={y}:fontsize={size}:fontcolor={color}:line_spacing=8:expansion=none"
    if enable:
        s += f":enable='{enable}'"
    return s


HEAD = "入口キオスク: UE(ショーの新しいレベル)の人型・縦長"
NOTE = "客の顔は CG の合成。声は鳴らさない(口は手元の声の音の大きさ)"


def wrap(s, n=22):
    return [s[i:i + n] for i in range(0, len(s), n)]


def segment(name, t0_, t1, title, lines, cam_offset=None, speed=1.0, extra=()):
    dur = t1 - t0_
    inputs = ["-ss", f"{t0_:.3f}", "-t", f"{dur:.3f}", "-i", str(UE)]
    filt = [f"[0:v]setpts=(PTS-STARTPTS)/{speed},split[r][z0]", "[z0]crop=96:96:304:338,scale=260:260[zoom]",
            f"color=c=0x101826:s={LW}x{H}:r=30:d={dur / speed:.3f}[bg0]", "[bg0][zoom]overlay=300:590[bg]"]
    last = "bg"
    if cam_offset is not None:
        inputs += ["-ss", f"{max(0, cam_offset):.3f}", "-i", str(REC20)]
        delay = max(0, -cam_offset)
        filt.append(f"[1:v]scale=552:-2,setpts=PTS-STARTPTS+{delay:.3f}/TB[cam]")
        filt.append(f"[{last}][cam]overlay=10:190:eof_action=pass[l1]")
        last = "l1"
    draws = [dt(f"{name}_h", HEAD, 14, 14, 18, "0x9fd8ff"), dt(f"{name}_t", title, 14, 52, 30, "0xffd27a")]
    y = 510 if cam_offset is not None else 120
    for i, ln in enumerate(lines):
        draws.append(dt(f"{name}_l{i}", ln, 14, y + i * 40, 22))
    for j, (txt, en) in enumerate(extra):
        draws.append(dt(f"{name}_x{j}", txt, 14, en[0], en[1], en[2], en[3]))
    draws.append(dt(f"{name}_z", "顔の拡大(右の窓から)", 300, 560, 16, "0x8fa9b3"))
    draws.append(dt(f"{name}_n", NOTE, 14, H - 40, 15, "0x8fa9b3"))
    if cam_offset is not None:
        draws.append(dt(f"{name}_c", "床のカメラの録画(上向き・合成の客)", 14, 160, 18, "0x8fa9b3"))
    filt.append(f"[{last}]" + ",".join(draws) + "[l]")
    filt.append("[l][r]hstack=2,format=yuv420p[v]")
    out = SEG / f"{name}.mp4"
    run([*inputs, "-filter_complex", ";".join(filt), "-map", "[v]", "-r", "30", "-c:v", "libx264", "-crf", "20", "-t", f"{dur / speed:.3f}", str(out)])
    return out


segs = []
camA = playA["start_unix_ms"] / 1000 - v0
a0 = ph["A_follow_start"] - 0.5
segs.append(segment("a", a0, ph["A_follow_end"] + 0.5, "① 録画の客を、目と首で追う", [
    "床のカメラ → 顔の検出 → 視線の橋(UDP)",
    "→ UE の人型の首と目(新しく書いた受け口)",
    f"顔が見つかった割合 {playA['found_rate'] * 100:.1f}%",
    f"向きの誤差(中央値){playA['err_deg_median']}°(校正前の仮の値)",
], cam_offset=a0 - camA))
b0, b1 = ph["B_talk_start"], ph["B_talk_end"] + 1.0
extra = []
for k, t in enumerate(talk):
    s = t["q_unix"] - v0 - b0
    e = (talk[k + 1]["q_unix"] - v0 - b0) if k + 1 < len(talk) else 999
    extra.append((f"Q{k + 1}「{t['q']}」", (330, 24, "white", f"between(t,{s:.2f},{e:.2f})")))
    if t.get("mouth_send_s"):
        extra.append((f"質問から口が動くまで {t['mouth_send_s']:.2f} 秒", (372, 20, "0x38d6c4", f"between(t,{s + t['mouth_send_s']:.2f},{e:.2f})")))
    for si, sub in enumerate(t["subs"]):
        ss, se = sub["start"] + base - v0 - b0, sub["end"] + base - v0 - b0
        for li, ln in enumerate(wrap(sub["text"])[:4]):
            extra.append((ln, (430 + li * 34, 24, "0xffe9a8", f"between(t,{ss:.2f},{se + 0.4:.2f})")))
mouth = [t["mouth_send_s"] for t in talk if t.get("mouth_send_s")]
segs.append(segment("b", b0, b1, "② 文字の質問に答えて、口が動く", [
    "頭脳 = 会話サーバーの Claude Haiku(店の記憶・型)",
    f"4 往復。口が動くまで {min(mouth):.1f}〜{max(mouth):.1f} 秒",
], extra=extra))
segs.append(segment("c", ph["C_calib_start"], ph["C_calib_end"] + 0.5, "③ 校正(床の 6 点・2 倍速)", [
    "仮想の客が床の 6 点に立つ",
    "→ 校正の画面と同じ API で、人型の向きを",
    "  「自分を見ている」向きへ合わせて記録",
    "  (本当の向き + 人のばらつき 1.5°で代用)",
    "→ gaze_calib でカメラの角度・目の位置を求める",
    "校正に使わない 25 点の誤差(中央値)",
    f"  {evalr['before_median_deg']}° → {evalr['after_median_deg']}°",
    f"  (90% 点 {evalr['before_p90_deg']}° → {evalr['after_p90_deg']}°)",
], speed=2.0))
camD = playD["start_unix_ms"] / 1000 - v0
d0 = ph["D_follow_start"] - 0.5
segs.append(segment("d", d0, ph["D_follow_end"] + 0.5, "④ 校正後、同じ録画を追う", [
    "向きの誤差(中央値)",
    f"  校正前 {playA['err_deg_median']}° → 校正後 {playD['err_deg_median']}°",
    f"顔が見つかった割合 {playD['found_rate'] * 100:.1f}%",
], cam_offset=d0 - camD))
lst = D / "segs.txt"
lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in segs), encoding="utf-8")
out = D / "kiosk_ue_1105.mp4"
run(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", "-map_metadata", "-1", str(out)])
print(out)
