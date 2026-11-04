#!/usr/bin/env python
"""曲が変わっても、歌詞の区切りと拍から、動きの並べ方と舞台の予定(出る秒・戻る秒・アップ)を作り直す。動きは案 C(歌いながら)。

使い方: make_show_plan.py --timeline <timeline.json> --lyrics <lyrics.json> --song-start 秒 --base-stage <show_stage.json> --out-plan <案.json> --out-stage <show_stage.json>
決まり: 前の部分の最後の行の out_word 番目の語(既定は最後から 2 語目)で舞台へ出る。サビの最後の行の頭で LED へ戻る。曲の終わりの少し前にもう一度出る。
「出る」ごとに跳ぶ動き(hop.py)が自動で入る: 拍で溜めて踏み切り、拍で着地し、着地した場所で歌い続ける。--hop-form front で前へまっすぐ、--no-hop で前の形。
"""
import argparse
import json
import math
import pathlib

import hop

K = "Anim_KA_"
BREATH, BOW, LEAN = K + "Idle01_breathing", K + "Idle44_GreetingBow", K + "Idle12_LeaningForward"
WAVE = K + "Idle16_WaveHands"
SP3S, SP3L, SP3E = K + "Speak03_Excited_Start", K + "Speak03_Excited_Loop", K + "Speak03_Excited_End"
SP1S, SP1L, SP1E = K + "Speak01_Normal_Start", K + "Speak01_Normal_Loop", K + "Speak01_Normal_End"
SING1, SING2, SING4 = K + "Idle81_Sing_NoMicrophone_Loop1", K + "Idle81_Sing_NoMicrophone_Loop2", K + "Idle81_Sing_NoMicrophone_Loop4"
PEACE, WALK = K + "Idle88_DoublePeacePose", K + "Walk01"
WALK_CYCLE_SEC = 1.33
WALK_SPEED = 0.867  # Walk01 の前へ進む速さ(m/s。移した後の腰の動きから測った値)。舞台の位置をこの速さで動かすと足が滑らない
WALK_TURN_SEC = 0.2
SING4_SPIN_AT = 3.4  # Loop4 はここから一回転するので、モニターはその前に閉じる
WALK_OUT_SEC = 3.8
WALK_FRONT_SEC = 2.4
MONITOR_OPEN_LEAD = 0.3
STAGE_START, STAGE_MIDDLE, STAGE_FRONT = (0, -130), (0, 180), (150, 290)  # 中央の面 y=-140、前の縁 y=450


def timed(clip, at, c0, c1, fade):
    return {"clip": clip, "at_sec": round(at, 3), "clip_from": c0, "clip_to": c1, "end_sec": round(at + (c1 - c0), 3), "fade_sec": fade}


def walk(at, until, exact=False):
    """その場の足踏みの歩き。exact なら最後の 1 歩を until で切る(舞台の位置が歩く速さで動く間とそろえる)。"""
    out, t = [], at
    while t < until - (0.05 if exact else 0.0):
        length = min(WALK_CYCLE_SEC, until - t) if exact else WALK_CYCLE_SEC
        out.append({**timed(WALK, t, 0.0, length, 0.12 if t > at else 0.45), "in_place": True})
        t += WALK_CYCLE_SEC
    return out


def fill(clip, start, end, c0, c1, fade):
    """start〜end 秒を、clip の c0〜c1 で埋める(足りなければ繰り返す)。"""
    out, t = [], start
    while t < end:
        length = min(c1 - c0, end - t)
        out.append(timed(clip, t, c0, c0 + length, fade))
        t += length
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--lyrics", required=True)
    ap.add_argument("--song-start", type=float, required=True)
    ap.add_argument("--base-stage", required=True)
    ap.add_argument("--out-plan", required=True)
    ap.add_argument("--out-stage", required=True)
    ap.add_argument("--hop-form", default="left_front", choices=sorted(hop.FORMS), help="跳んで着地する場所の形")
    ap.add_argument("--no-hop", dest="hop", action="store_false", help="跳ばずに前の形(足から現れて歩く)にする")
    a = ap.parse_args()
    timeline = json.loads(pathlib.Path(a.timeline).read_text(encoding="utf-8"))
    lyrics = json.loads(pathlib.Path(a.lyrics).read_text(encoding="utf-8"))
    section = {s["id"]: s for s in timeline["sections"]}
    beats = timeline["beats"]

    def snap(t):
        return min(beats, key=lambda b: abs(b - t))

    at = a.song_start
    lines = lyrics["lines"]
    pre = [line for line in lines if line.get("section") == "pre"]
    chorus = [line for line in lines if line.get("section") == "chorus"]
    if not pre or not chorus:
        raise SystemExit("歌詞に section の pre と chorus が要る")
    sing = at + pre[0]["words"][0][1]
    out_words = pre[-1]["words"]
    out_1 = snap(at + out_words[pre[-1].get("out_word", max(len(out_words) - 2, 0))][1])
    chorus_head = at + chorus[0]["words"][0][1]
    back = snap(at + chorus[-1]["words"][0][1])
    song_end = section["song"]["end"]
    out_2 = snap(song_end - 0.8)
    peace_at = snap(song_end - 4.0)
    line = section["line"]
    bow, listen, answer, outro, tail = (section[k] for k in ("bow", "listen", "answer", "outro", "tail"))

    segments = [timed(BREATH, section["dark"]["start"], 0.0, 6.6, 0.4), timed(SP3S, line["start"] - 1.7, 0.0, 2.0, 0.5),
                timed(SP3L, line["start"] + 0.3, 0.0, 5.0, 0.3), timed(SP3E, line["end"] - 0.45, 0.0, 0.6, 0.3)]
    hops = [hop.hop_times(t, beats) for t in (out_1, out_2)] if a.hop else []
    stop_walking = out_1 + WALK_OUT_SEC  # 跳ぶときは歩かず、この秒まで着地の場所で歌い続ける(Loop4 の秒は前と同じ)
    if a.hop:
        segments += fill(SING1, line["end"], stop_walking, 0.5, 12.9, 0.4)
        land_xy = hop.FORMS[a.hop_form]
        walk_sec = WALK_TURN_SEC + math.hypot(STAGE_FRONT[0] - land_xy[0], STAGE_FRONT[1] - land_xy[1]) / (WALK_SPEED * 100.0)
        front_walk = back - walk_sec - 1.4
        segments += fill(SING4, stop_walking, front_walk, 0.3, 9.2, 0.4)
        segments += walk(front_walk + WALK_TURN_SEC, front_walk + walk_sec, exact=True)  # 向きを変えてから、進む間だけ足を出す
    else:
        segments += fill(SING1, line["end"], out_1, 0.5, 12.9, 0.4)
        segments += walk(out_1, stop_walking)
        walk_sec = WALK_FRONT_SEC
        front_walk = back - walk_sec - 1.4
        segments += fill(SING4, stop_walking, front_walk, 0.3, 9.2, 0.4)
        segments += walk(front_walk, front_walk + walk_sec)
    segments += fill(SING2, front_walk + walk_sec, peace_at, 0.3, 8.0, 0.4)
    segments += [timed(PEACE, peace_at, 0.3, 4.3, 0.5), timed(BOW, bow["start"], 0.0, bow["end"] - bow["start"], 0.5),
                 timed(LEAN, listen["start"], 0.0, 5.0, 0.6), timed(BREATH, listen["end"] - 2.0, 0.0, 2.0, 0.5),
                 timed(SP1S, answer["start"] - 0.4, 0.0, 2.0, 0.5)]
    segments += fill(SP1L, answer["start"] + 1.6, answer["end"] - 1.43, 0.0, 5.0, 0.3)
    segments += [timed(SP1E, answer["end"] - 1.43, 0.0, 1.43, 0.3), timed(WAVE, outro["start"], 0.0, 4.0, 0.5),
                 timed(BREATH, tail["start"], 0.0, 5.0, 0.5)]
    plan = {"from_sec": section["dark"]["start"], "to_sec": tail["end"], "free_face_sec": [[bow["start"], bow["end"]]], "segments": segments}
    if hops:
        plan["segments"] = hop.insert_hops(segments, hops)
        # 着地してから次に歩くまで、床の足を止める。2 回目は LED へ戻った後に放す(舞台で放すと戻しの間に滑る)
        plan["foot_lock_sec"] = [[hops[0]["land"], round(front_walk, 4)], [hops[1]["land"], tail["end"]]]
    pathlib.Path(a.out_plan).write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")

    stage = json.loads(pathlib.Path(a.base_stage).read_text(encoding="utf-8"))
    chorus_off = min(chorus_head + 3.4, stop_walking + SING4_SPIN_AT - 0.1)
    stage["led_character"] = [[section["enter"]["start"], out_1], [back, out_2], [outro["start"], tail["end"]]]
    stage["flashes"] = [{"t": out_1, "kind": "out"}, {"t": back, "kind": "back"}, {"t": out_2, "kind": "out"}, {"t": outro["start"], "kind": "back"}]
    stage["monitors"] = [{"on": sing - MONITOR_OPEN_LEAD, "off": sing + 4.5, "shots": [[sing - MONITOR_OPEN_LEAD, "face"]]},
                         {"on": chorus_head - MONITOR_OPEN_LEAD, "off": chorus_off, "shots": [[chorus_head - MONITOR_OPEN_LEAD, "face"]]},
                         {"on": back + 1.4, "off": out_2, "shots": [[back + 1.4, "face"], [peace_at, "bust"]]}]
    x0, y0 = STAGE_START
    x1, y1 = STAGE_MIDDLE
    x2, y2 = STAGE_FRONT
    if hops:
        # 跳んで着地した場所に立ったまま歌う(戻らない)。前へ歩くのは歩く動きと同じ速さの一定の動き
        path1, land_xy = hop.hop_path(hops[0], a.hop_form)
        walk_keys, walk_from, walk_to = hop.walk_path(front_walk, land_xy, STAGE_FRONT, WALK_SPEED, WALK_TURN_SEC)
        path2, land2 = hop.hop_path(hops[1], a.hop_form)
        stage["ar_path"] = path1 + walk_keys + path2 + [[outro["start"], land2[0], land2[1], 0]]
        stage["led_character"] = [[section["enter"]["start"], hops[0]["takeoff"]], [back, hops[1]["takeoff"]], [outro["start"], tail["end"]]]
        stage["hops"] = [hop.stage_hop(hops[0], land_xy), hop.stage_hop(hops[1], land2)]
    else:
        stage["ar_path"] = [[out_1, x0, y0, 0], [stop_walking, x1, y1, 0], [front_walk - 0.2, x1, y1, 0], [front_walk + 0.2, x1, y1, -55],
                            [front_walk + WALK_FRONT_SEC - 0.1, x2, y2, -55], [front_walk + WALK_FRONT_SEC + 0.3, x2, y2, 0],
                            [out_2, x1, y1, 0], [outro["start"], x1, y1, 0]]
        stage.pop("hops", None)
    pathlib.Path(a.out_stage).write_text(json.dumps(stage, ensure_ascii=False, indent=2), encoding="utf-8")
    hop_text = "。跳び " + "、".join(f"踏み切り {h['takeoff']:.3f} 着地 {h['land']:.3f}" for h in hops) if hops else ""
    print(f"歌い出し {sing:.2f}、出る {out_1:.2f}、サビ {chorus_head:.2f}、前へ {front_walk:.2f}、戻る {back:.2f}、決め {peace_at:.2f}、もう一度出る {out_2:.2f}。動き {len(plan['segments'])} 本{hop_text}")


if __name__ == "__main__":
    main()
