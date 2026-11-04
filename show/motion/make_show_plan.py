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
PEACE_SEC = 4.0  # PEACE の素材 0.3〜4.3 秒
CALL_LINES = 4  # サビの 4 行目の頭で戻る。コール(ハイ)が入るのは 1〜3 行目の後だけ(4 行目の後は別の歌詞に差し替わる)
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


def head_segments(section):
    line = section["line"]
    return [timed(BREATH, section["dark"]["start"], 0.0, 6.6, 0.4), timed(SP3S, line["start"] - 1.7, 0.0, 2.0, 0.5),
            timed(SP3L, line["start"] + 0.3, 0.0, 5.0, 0.3), timed(SP3E, line["end"] - 0.45, 0.0, 0.6, 0.3)]


def tail_segments(section):
    """お辞儀から終わりまで(答えのせりふ・手を振る・静止)。"""
    bow, listen, answer, outro, tail = (section[k] for k in ("bow", "listen", "answer", "outro", "tail"))
    out = [timed(BOW, bow["start"], 0.0, bow["end"] - bow["start"], 0.5),
           timed(LEAN, listen["start"], 0.0, 5.0, 0.6), timed(BREATH, listen["end"] - 2.0, 0.0, 2.0, 0.5),
           timed(SP1S, answer["start"] - 0.4, 0.0, 2.0, 0.5)]
    out += fill(SP1L, answer["start"] + 1.6, answer["end"] - 1.43, 0.0, 5.0, 0.3)
    out += [timed(SP1E, answer["end"] - 1.43, 0.0, 1.43, 0.3), timed(WAVE, outro["start"], 0.0, 4.0, 0.5),
            timed(BREATH, tail["start"], 0.0, 5.0, 0.5)]
    return out


def write_cues(path, cues):
    note = "make_show_plan.py が作った。build_led_full.py --cues (LED_CUES) が読む。"
    pathlib.Path(path).write_text(json.dumps({"_説明": note, **cues}, ensure_ascii=False, indent=1), encoding="utf-8")


def call_runs_by_chorus(choruses, at, beats):
    """サビごとに、1〜3 行目の行末から次の行の頭までにある拍の先頭 4 つ(足りなければ入る数だけ。拍が無ければ None)。4 行目の後には入れない。"""
    out = []
    for chorus in choruses:
        runs = []
        for k in range(min(CALL_LINES - 1, len(chorus) - 1)):
            lo, hi = at + chorus[k]["words"][-1][2], at + chorus[k + 1]["words"][0][1]
            runs.append([b for b in beats if lo - 1e-6 <= b < hi - 1e-6][:4] or None)
        out.append(runs)
    return out


def call_runs_for(choruses, at, beats):
    return [run for runs in call_runs_by_chorus(choruses, at, beats) for run in runs if run]


def morph_end(last, hi, beats):
    """終わりの打の 1 拍後(4 打で 4 拍ぶんの長さ)。次の行の語の頭(hi)を超えるなら、その少し手前で切る。"""
    nxt = [b for b in beats if b > last + 1e-6]
    end = nxt[0] if nxt else last + 0.4
    return min(end, hi - MORPH_MARGIN) if end > hi - MORPH_MARGIN else end


MORPH_MARGIN = 0.05


def morphs_for(choruses, at, beats):
    """変身の秒。各サビの 1 行目の後のコールで人型へ、3 行目の後のコールで アニメへ戻る。始めは 4 打の頭、終わりは 4 打目の 1 拍後
    (次の行の語の頭を超えるなら手前で切る)。戻りが組めないサビは、人型のまま LED へ戻らないよう、変身を出さない。打が 2 つ未満なら組めない。"""
    out = []
    for chorus, runs in zip(choruses, call_runs_by_chorus(choruses, at, beats)):
        if len(runs) < CALL_LINES - 1:
            continue
        go, back = runs[0], runs[CALL_LINES - 2]
        if go and back and len(go) >= 2 and len(back) >= 2:
            hi = lambda k: at + chorus[k + 1]["words"][0][1]
            out += [{"start": go[0], "end": morph_end(go[-1], hi(0), beats), "to": "human"},
                    {"start": back[0], "end": morph_end(back[-1], hi(CALL_LINES - 2), beats), "to": "anime"}]
    return out


def parts_plan(a, lyrics, section, beats, snap):
    """part(サビの組)ごとに行き来を作る。前の部分の out_word の語で舞台へ跳び、サビの 4 行目の頭(最後の組は outro の頭)で LED へ戻る。"""
    if not a.hop:
        raise SystemExit("part のある歌詞は跳びで作る(--no-hop は使えない)")
    at, lines = a.song_start, lyrics["lines"]
    groups = []
    for p in sorted({l["part"] for l in lines if "part" in l}):
        mine = [l for l in lines if l.get("part") == p]
        pre, chorus = ([l for l in mine if l.get("section") == k] for k in ("pre", "chorus"))
        if not pre or len(chorus) < CALL_LINES:
            raise SystemExit(f"part {p} に pre と chorus(4 行以上)が要る")
        outro = [l for l in mine if l.get("section") == "outro"]
        words = pre[-1]["words"]
        out = snap(at + words[pre[-1].get("out_word", max(len(words) - 2, 0))][1])
        groups.append({"pre": pre, "chorus": chorus, "outro": outro, "out": out, "head": at + chorus[0]["words"][0][1],
                       "hop": hop.hop_times(out, beats), "stop": out + WALK_OUT_SEC})
    last = groups[-1]
    bow, line, tail = section["bow"], section["line"], section["tail"]
    for g in groups:
        if g is last:
            g["back"] = snap(at + g["outro"][0]["words"][0][1]) if g["outro"] else snap(bow["start"])
        else:
            g["back"] = snap(at + g["chorus"][CALL_LINES - 1]["words"][0][1])
    peace_at = snap(last["back"] - PEACE_SEC)
    land_xy = hop.FORMS[a.hop_form]
    walk_sec = WALK_TURN_SEC + math.hypot(STAGE_FRONT[0] - land_xy[0], STAGE_FRONT[1] - land_xy[1]) / (WALK_SPEED * 100.0)
    segments, cursor, prev_back = head_segments(section), line["end"], section["enter"]["start"]
    for g in groups:
        g["stand_end"] = peace_at if g is last else g["back"]
        g["front_walk"] = g["stand_end"] - walk_sec - 1.4
        g["has_walk"] = g["front_walk"] > g["stop"] + 0.5
        if not (prev_back < g["hop"]["takeoff"] < g["hop"]["land"] < g["hop"]["end"] < g["back"]):
            raise SystemExit(f"跳び {g['out']:.2f} が前の戻り {prev_back:.2f} と戻り {g['back']:.2f} の間に入らない")
        segments += fill(SING1, cursor, g["stop"], 0.5, 12.9, 0.4)
        if g["has_walk"]:
            segments += fill(SING4, g["stop"], g["front_walk"], 0.3, 9.2, 0.4)
            segments += walk(g["front_walk"] + WALK_TURN_SEC, g["front_walk"] + walk_sec, exact=True)
            segments += fill(SING2, g["front_walk"] + walk_sec, g["stand_end"], 0.3, 8.0, 0.4)
        else:
            segments += fill(SING4, g["stop"], g["stand_end"], 0.3, 9.2, 0.4)
        cursor, prev_back = g["stand_end"], g["back"]
    segments.append(timed(PEACE, peace_at, 0.3, 0.3 + PEACE_SEC, 0.5))
    segments += fill(SING1, peace_at + PEACE_SEC, bow["start"], 0.5, 12.9, 0.4)
    segments += tail_segments(section)
    plan = {"from_sec": section["dark"]["start"], "to_sec": tail["end"], "free_face_sec": [[bow["start"], bow["end"]]]}
    plan["segments"] = hop.insert_hops(segments, [g["hop"] for g in groups])
    plan["foot_lock_sec"] = [[g["hop"]["land"], round(g["front_walk"] if g["has_walk"] else g["stand_end"], 4)] for g in groups]
    pathlib.Path(a.out_plan).write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")

    stage = json.loads(pathlib.Path(a.base_stage).read_text(encoding="utf-8"))
    sing = at + groups[0]["pre"][0]["words"][0][1]
    starts = [section["enter"]["start"]] + [g["back"] for g in groups]
    ends = [g["hop"]["takeoff"] for g in groups] + [tail["end"]]
    stage["led_character"] = [[s, e] for s, e in zip(starts, ends)]
    stage["flashes"] = [f for g in groups for f in ({"t": g["out"], "kind": "out"}, {"t": g["back"], "kind": "back"})]
    stage["monitors"] = [{"on": sing - MONITOR_OPEN_LEAD, "off": sing + 4.5, "shots": [[sing - MONITOR_OPEN_LEAD, "face"]]}]
    for g in groups:
        off = min(g["head"] + 3.4, g["stop"] + SING4_SPIN_AT - 0.1)
        stage["monitors"].append({"on": g["head"] - MONITOR_OPEN_LEAD, "off": off, "shots": [[g["head"] - MONITOR_OPEN_LEAD, "face"]]})
    stage["monitors"].append({"on": peace_at - MONITOR_OPEN_LEAD, "off": last["back"], "shots": [[peace_at - MONITOR_OPEN_LEAD, "bust"]]})
    path = []
    for g in groups:
        keys, lxy = hop.hop_path(g["hop"], a.hop_form)
        path += keys
        stand = STAGE_FRONT if g["has_walk"] else lxy
        if g["has_walk"]:
            walk_keys, _, _ = hop.walk_path(g["front_walk"], lxy, STAGE_FRONT, WALK_SPEED, WALK_TURN_SEC)
            path += walk_keys
        # 戻る秒まで立ち、戻ったら次の踏み切りの足元(LED の前)へ置き直す
        path += [[g["back"], stand[0], stand[1], 0], [round(g["back"] + 0.05, 4), hop.START_XY[0], hop.START_XY[1], 0]]
    stage["ar_path"] = path
    stage["hops"] = [hop.stage_hop(g["hop"], hop.FORMS[a.hop_form]) for g in groups]
    pathlib.Path(a.out_stage).write_text(json.dumps(stage, ensure_ascii=False, indent=2), encoding="utf-8")
    if a.out_cues:
        choruses = [g["chorus"] for g in groups]
        write_cues(a.out_cues, {"call_runs": call_runs_for(choruses, at, beats), "morphs": morphs_for(choruses, at, beats),
                                "landings": [g["hop"]["land"] for g in groups], "finale": peace_at})
    text = "、".join(f"組{k + 1} 出る {g['out']:.2f} 踏み切り {g['hop']['takeoff']:.3f} 着地 {g['hop']['land']:.3f} 戻る {g['back']:.2f}" for k, g in enumerate(groups))
    print(f"{text}。決め {peace_at:.2f}。動き {len(plan['segments'])} 本")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--lyrics", required=True)
    ap.add_argument("--song-start", type=float, required=True)
    ap.add_argument("--base-stage", required=True)
    ap.add_argument("--out-plan", required=True)
    ap.add_argument("--out-stage", required=True)
    ap.add_argument("--hop-form", default="left_front", choices=sorted(hop.FORMS), help="跳んで着地する場所の形")
    ap.add_argument("--out-cues", help="全編の道具(build_led_full.py --cues)が読む cues json。part のある歌詞で call_runs・landings・finale を書く")
    ap.add_argument("--no-hop", dest="hop", action="store_false", help="跳ばずに前の形(足から現れて歩く)にする")
    a = ap.parse_args()
    timeline = json.loads(pathlib.Path(a.timeline).read_text(encoding="utf-8"))
    lyrics = json.loads(pathlib.Path(a.lyrics).read_text(encoding="utf-8"))
    section = {s["id"]: s for s in timeline["sections"]}
    beats = timeline["beats"]

    def snap(t):
        return min(beats, key=lambda b: abs(b - t))

    if any("part" in l for l in lyrics["lines"]):
        return parts_plan(a, lyrics, section, beats, snap)
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

    segments = head_segments(section)
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
    segments.append(timed(PEACE, peace_at, 0.3, 4.3, 0.5))
    segments += tail_segments(section)
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
    if a.out_cues and hops:
        write_cues(a.out_cues, {"landings": [h["land"] for h in hops]})
    hop_text = "。跳び " + "、".join(f"踏み切り {h['takeoff']:.3f} 着地 {h['land']:.3f}" for h in hops) if hops else ""
    print(f"歌い出し {sing:.2f}、出る {out_1:.2f}、サビ {chorus_head:.2f}、前へ {front_walk:.2f}、戻る {back:.2f}、決め {peace_at:.2f}、もう一度出る {out_2:.2f}。動き {len(plan['segments'])} 本{hop_text}")


if __name__ == "__main__":
    main()
