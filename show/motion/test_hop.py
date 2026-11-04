#!/usr/bin/env python
"""跳ぶ動き(hop.py)と、make_show_plan.py が「出る」ごとに跳びを入れることの試験。素材の動きと GPU は要らない。
曲の timeline が手元にあれば(今の曲と song1)それでも確かめる。無ければ作った拍だけで確かめる。

動かし方: python show/motion/test_hop.py
"""
import json
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "live")]
import hop  # noqa: E402
from stage_path import ar_at, on_led  # noqa: E402  合成・リアルタイムと同じ読み方で確かめる

TIMELINES = {"mc_try": pathlib.Path("work/ue_show/show_build/mc_try/audio/timeline.json"),
             "song1": pathlib.Path("work/ue_show/show_build/song1/audio/timeline.json")}


def beats_at(bpm, start=0.0, count=400):
    return [round(start + i * 60.0 / bpm, 4) for i in range(count)]


def test_times_land_on_beat_and_take_off_on_beat():
    for bpm in (150.17, 128.0, 100.0, 175.0):
        beats = beats_at(bpm, 0.37)
        h = hop.hop_times(30.0, beats)
        assert h["land"] in beats and h["takeoff"] in beats, bpm
        assert h["land"] >= 30.0 + hop.LAND_MIN_AFTER - 1e-6
        air = h["land"] - h["takeoff"]
        assert 0.5 <= air <= 1.1, (bpm, air)
        assert 0.75 < h["speed"] < 2.0, (bpm, h["speed"])
        assert h["start"] < h["takeoff"] < h["land"] < h["end"]


def test_tame_is_long_and_takeoff_stays_on_beat():
    """溜め(素材の 0〜離陸)は TAME_SEC に伸び、素材の離陸は踏み切りの拍に来る。別の拍・2 回目でも同じ。"""
    assert 0.45 <= hop.TAME_SEC <= 0.55 and hop.FADE_IN_SEC <= 0.15
    for bpm, t in ((150.17, 30.0), (128.0, 41.3)):
        h = hop.hop_times(t, beats_at(bpm, 0.37))
        seg = hop.hop_segment(h)
        (t0, c0), (t1, c1), (t2, c2) = seg["warp"]
        assert abs((t1 - t0) - hop.TAME_SEC) < 1e-6 and c0 == 0.0 and c1 == hop.CLIP_TAKEOFF
        assert t1 == h["takeoff"] and t0 == h["start"] and t2 == h["end"] and c2 == hop.CLIP_END


def test_path_moves_only_in_the_air_at_constant_speed():
    beats = beats_at(150.17)
    h = hop.hop_times(30.0, beats)
    keys, land = hop.hop_path(h, "left_front")
    assert land == hop.FORMS["left_front"]
    before = ar_at(keys, h["takeoff"] - 0.3)
    assert before[:2] == list(hop.START_XY)
    after = ar_at(keys, h["land"] + 2.0)
    assert after[:2] == list(land)
    # 宙の間は一定の速さ(キーの上で測る)
    step = [((b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2) ** 0.5 / (b[0] - a[0]) for a, b in zip(keys, keys[1:])]
    assert max(step) - min(step) < 0.01 * max(step), (min(step), max(step))  # 秒と位置の丸めの分だけ
    keys_f, land_f = hop.hop_path(h, "front")
    assert land_f[0] == hop.START_XY[0]


def test_insert_removes_overlaps_and_returns_to_the_dance():
    beats = beats_at(150.17)
    h = hop.hop_times(30.0, beats)
    segs = [{"clip": "A", "at_sec": 20.0, "clip_from": 0.0, "clip_to": 20.0, "end_sec": 40.0, "fade_sec": 0.4},
            {"clip": "W", "at_sec": 30.0, "clip_from": 0.0, "clip_to": 1.33, "end_sec": 31.33, "fade_sec": 0.45, "in_place": True},
            {"clip": "B", "at_sec": 36.0, "clip_from": 0.0, "clip_to": 5.0, "end_sec": 41.0, "fade_sec": 0.4}]
    out = hop.insert_hops(segs, [h])
    names = [s["clip"] for s in out]
    assert "W" not in names  # 跳びの間に始まる歩きは消える
    # 跳びの間に始まる踊りの区切り(同じ踊りの続き)は、跳びの後にその続きから入る
    seg2 = [segs[0], {"clip": "A2", "at_sec": round(h["start"] + 0.3, 4), "clip_from": 0.0, "clip_to": 12.0, "end_sec": 50.0, "fade_sec": 0.4}, segs[2]]
    out2 = hop.insert_hops(seg2, [h])
    k = next(i for i, s in enumerate(out2) if s.get("hop"))
    assert out2[k + 1]["clip"] == "A2" and abs(out2[k + 1]["clip_from"] - (h["end"] - seg2[1]["at_sec"])) < 1e-3
    starts = [s["at_sec"] for s in out]
    assert starts == sorted(starts)
    i = next(k for k, s in enumerate(out) if s.get("hop"))
    assert out[i]["hold"] is True
    follow = out[i + 1]
    assert follow["clip"] == "A" and abs(follow["at_sec"] - h["end"]) < 1e-3  # 元の踊りの続きへ戻る
    assert abs(follow["clip_from"] - (h["end"] - 20.0)) < 1e-3


def run_plan(timeline_path, extra=()):
    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    by_id = {s["id"]: s for s in timeline["sections"]}
    song = by_id["song"]
    rel = lambda t: round(t - song["start"], 3)  # noqa: E731
    lyrics = {"lines": [
        {"section": "pre", "words": [["a", rel(song["start"] + 8.5), 0], ["b", rel(song["start"] + 9.5), 0]]},
        {"section": "pre", "words": [["c", rel(song["start"] + 18.4), 0], ["d", rel(song["start"] + 19.6), 0], ["e", rel(song["start"] + 20.0), 0]]},
        {"section": "chorus", "words": [["f", rel(song["start"] + 24.0), 0]]},
        {"section": "chorus", "words": [["g", rel(song["start"] + 34.4), 0]]}]}
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        (tmp / "lyrics.json").write_text(json.dumps(lyrics), encoding="utf-8")
        base = json.loads((HERE.parent / "show_stage.json").read_text(encoding="utf-8"))
        (tmp / "base.json").write_text(json.dumps(base), encoding="utf-8")
        subprocess.run([sys.executable, str(HERE / "make_show_plan.py"), "--timeline", str(timeline_path), "--lyrics", str(tmp / "lyrics.json"),
                        "--song-start", str(song["start"]), "--base-stage", str(tmp / "base.json"), "--out-plan", str(tmp / "plan.json"),
                        "--out-stage", str(tmp / "stage.json"), *extra], check=True, capture_output=True)
        return (timeline, json.loads((tmp / "plan.json").read_text(encoding="utf-8")),
                json.loads((tmp / "stage.json").read_text(encoding="utf-8")))


def check_plan(timeline, plan, stage):
    outs = [f["t"] for f in stage["flashes"] if f["kind"] == "out"]
    hops = stage["hops"]
    assert len(hops) == len(outs) == 2
    jumps = [s for s in plan["segments"] if s.get("hop")]
    assert len(jumps) == 2
    # 着地から足を止める区間が、跳びごとに 1 つ
    assert [round(a, 3) for a, _ in plan["foot_lock_sec"]] == [round(h["land"], 3) for h in hops]
    starts = [s["at_sec"] for s in plan["segments"]]
    assert starts == sorted(starts)
    for h, out in zip(hops, outs):
        assert abs(h["out"] - out) < 1e-3
        assert h["land"] in timeline["beats"] and h["takeoff"] in timeline["beats"]
        # 舞台のキャラは踏み切りで現れる(LED にいる区間の終わりが踏み切り)
        assert any(abs(b - h["takeoff"]) < 1e-3 for _, b in stage["led_character"])
        assert not on_led(stage, h["takeoff"] + 0.01)
        # 着地の後、次に動くまでの 1 秒は同じ場所(足が滑らない)
        p0, p1 = ar_at(stage["ar_path"], h["land"] + 0.02), ar_at(stage["ar_path"], h["land"] + 1.0)
        assert abs(p0[0] - p1[0]) < 1e-6 and abs(p0[1] - p1[1]) < 1e-6
        assert [round(v, 3) for v in p0[:2]] == [round(v, 3) for v in h["land_xy"]]
        # 跳びの区間の中に、ほかの区間が始まらない
        jump = next(s for s in jumps if abs(s["at_sec"] - (h["takeoff"] - hop.TAME_SEC)) < 1e-3)
        assert not [s for s in plan["segments"] if jump["at_sec"] < s["at_sec"] < jump["end_sec"]]


def test_plan_on_real_timelines():
    found = [p for p in TIMELINES.values() if p.exists()]
    for path in found:
        timeline, plan, stage = run_plan(path)
        check_plan(timeline, plan, stage)
        _, _, front = run_plan(path, ["--hop-form", "front"])
        assert front["hops"][0]["land_xy"][0] == hop.START_XY[0]
        _, plain, plain_stage = run_plan(path, ["--no-hop"])
        assert "hops" not in plain_stage and not [s for s in plain["segments"] if s.get("hop")]
    if not found:
        print("  (曲の timeline が無いので、作った拍だけで確かめた)")


def test_led_fade_and_reveal_share_one_short_window():
    """LED が消えるのと舞台が現れるのは同じ 0.10〜0.15 秒(60p で 6 コマ以上、30p で 3 コマ以上)。"""
    h = hop.hop_times(30.0, beats_at(150.17))
    s = hop.stage_hop(h, hop.FORMS["left_front"])
    assert s["led_fade"] == s["reveal"], s
    a, b = s["reveal"]
    assert 0.10 - 1e-6 <= b - a <= 0.15 + 1e-6, (a, b)
    assert (b - a) * 60 >= 6 - 1e-6 and (b - a) * 30 >= 3 - 1e-6
    assert h["takeoff"] <= a < b < h["land"]


def test_walk_moves_at_walk_speed():
    keys, t1, t2 = hop.walk_path(10.0, (-100.0, 70.0), (150.0, 290.0), 0.867)
    speed = (((150 + 100) ** 2 + (290 - 70) ** 2) ** 0.5) / 100.0 / (t2 - t1)
    assert abs(speed - 0.867) < 1e-3
    mid = [k for k in keys if t1 < k[0] < t2]
    step = [((b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2) ** 0.5 / (b[0] - a[0]) for a, b in zip(mid, mid[1:])]
    assert max(step) - min(step) < 0.01 * max(step)


# ---- サビが 2 回ある曲(part のある歌詞)。偽の語の秒と 150 BPM の拍だけで確かめる。音も曲も使わない ----
SONG_START = 39.0
FLOW = [(1, "pre", 7, None), (1, "pre", 7, None), (1, "pre", 7, None), (1, "pre", 7, 3), (1, "chorus", 6, None), (1, "chorus", 6, None),
        (1, "chorus", 6, None), (1, "chorus", 6, None), (1, "verse", 7, None), (1, "verse", 7, None), (1, "verse", 7, None), (1, "verse", 7, None),
        (2, "pre", 7, None), (2, "pre", 6, 3), (2, "chorus", 6, None), (2, "chorus", 6, None), (2, "chorus", 6, None), (2, "chorus", 6, None),
        (2, "outro", 7, None)]
CHORUS_FIRST = (4, 14)  # FLOW の中で、各サビの最初の行の番号


def fake_timeline():
    beats = beats_at(150.0, 0.37, 700)
    names = [("dark", 32, 36), ("enter", 36, 39), ("song", 39, 173), ("line", 41, 46.35), ("bow", 173, 178), ("listen", 178, 185),
             ("answer", 185, 194), ("outro", 194, 198), ("tail", 198, 203)]
    return {"sections": [{"id": k, "start": a, "end": b} for k, a, b in names], "beats": beats}


def fake_lyrics(extra_after_call=False, with_part=True):
    """偽の語の秒(曲の頭から)。語は 0.5 秒おき。サビの 1〜3 行目の後は 2.4 秒あく(4 拍と少し)、4 行目の後は 3.0 秒、ほかは 1.0 秒。
    extra_after_call なら、サビの 4 行目の後に短い行を足す(4 行目の後の 3.0 秒の中に入れ、次の行の秒は動かさない)。"""
    lines, t, seen = [], 10.0, {}
    for part, sec, n, out_word in FLOW:
        words = [["w", round(t + 0.5 * k, 3), round(t + 0.5 * k + 0.4, 3)] for k in range(n)]
        lines.append({"section": sec, "mood": [], "words": words, **({"part": part} if with_part else {}),
                      **({"out_word": out_word} if out_word is not None else {})})
        seen[(part, sec)] = seen.get((part, sec), 0) + 1
        end = words[-1][2]
        t = end + (2.4 if sec == "chorus" and seen[(part, sec)] < 4 else 3.0 if sec == "chorus" else 1.0)
        if extra_after_call and sec == "chorus" and seen[(part, sec)] == 4:
            x = end + 0.6
            lines.append({"section": "chorus", "mood": [], **({"part": part} if with_part else {}),
                          "words": [["x", round(x, 3), round(x + 0.4, 3)], ["y", round(x + 0.5, 3), round(x + 0.9, 3)]]})
    return {"lines": lines}


def run_fake(lyrics, extra=()):
    timeline = fake_timeline()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        (tmp / "t.json").write_text(json.dumps(timeline), encoding="utf-8")
        (tmp / "l.json").write_text(json.dumps(lyrics), encoding="utf-8")
        (tmp / "base.json").write_text((HERE.parent / "show_stage.json").read_text(encoding="utf-8"), encoding="utf-8")
        subprocess.run([sys.executable, str(HERE / "make_show_plan.py"), "--timeline", str(tmp / "t.json"), "--lyrics", str(tmp / "l.json"),
                        "--song-start", str(SONG_START), "--base-stage", str(tmp / "base.json"), "--out-plan", str(tmp / "plan.json"),
                        "--out-stage", str(tmp / "stage.json"), "--out-cues", str(tmp / "cues.json"), *extra], check=True, capture_output=True)
        read = lambda n: json.loads((tmp / n).read_text(encoding="utf-8"))  # noqa: E731
        return timeline, read("plan.json"), read("stage.json"), read("cues.json")


def test_two_round_trips_in_flow_order():
    timeline, plan, stage, _ = run_fake(fake_lyrics())
    assert [f["kind"] for f in stage["flashes"]] == ["out", "back", "out", "back"]
    ts = [f["t"] for f in stage["flashes"]]
    assert ts == sorted(ts) and len(stage["hops"]) == 2 and len(stage["led_character"]) == 3
    lines = fake_lyrics()["lines"]
    # 出る = 各 pre の最後の行の out_word 番目の語。戻る = 1 組はサビ 4 行目の頭、2 組は outro の頭(どちらも拍へ寄せる)
    expect = [SONG_START + lines[3]["words"][3][1], SONG_START + lines[7]["words"][0][1],
              SONG_START + lines[13]["words"][3][1], SONG_START + lines[18]["words"][0][1]]
    for got, want in zip(ts, expect):
        assert abs(got - want) <= 0.2 + 1e-6, (got, want)
    assert [s["at_sec"] for s in plan["segments"]] == sorted(s["at_sec"] for s in plan["segments"])
    assert len([s for s in plan["segments"] if s.get("hop")]) == 2
    sing = {s["clip"].rsplit("_", 1)[-1] for s in plan["segments"] if "Sing" in s["clip"]}
    assert {"Loop1", "Loop4", "Loop2"} <= sing
    # 決め(PEACE)は 2 回目のサビの終わり = 最後の戻りの手前に終わる
    peace = next(s for s in plan["segments"] if "DoublePeace" in s["clip"])
    assert abs(peace["end_sec"] - ts[3]) <= 0.4 + 0.01 and peace["at_sec"] > ts[2]
    assert [round(a, 3) for a, _ in plan["foot_lock_sec"]] == [round(h["land"], 3) for h in stage["hops"]]


def test_hops_and_returns_on_beat_and_led_intervals_do_not_overlap():
    timeline, plan, stage, _ = run_fake(fake_lyrics())
    beats = timeline["beats"]
    on_beat = lambda t: any(abs(b - t) < 1e-3 for b in beats)  # noqa: E731
    for h in stage["hops"]:
        assert on_beat(h["takeoff"]) and on_beat(h["land"]) and 0.5 <= h["land"] - h["takeoff"] <= 1.1
    backs = [f["t"] for f in stage["flashes"] if f["kind"] == "back"]
    assert all(on_beat(t) for t in backs)
    led = stage["led_character"]
    assert all(a < b for a, b in led) and all(led[i][1] < led[i + 1][0] for i in range(len(led) - 1))
    for i, h in enumerate(stage["hops"]):
        assert led[i][1] == h["takeoff"] and led[i + 1][0] == backs[i]
        for t in (h["takeoff"] + 0.01, h["land"] + 0.5, backs[i] - 0.05):  # 舞台にいる間は LED のキャラが居ない
            assert not on_led(stage, t), t
        assert on_led(stage, backs[i] + 0.01) and on_led(stage, h["takeoff"] - 0.01)
        # 踏み切りの前は LED の足元の前(2 回目も。戻った後に置き直す)。着地の後は着地の場所
        assert ar_at(stage["ar_path"], h["takeoff"] - 0.01)[:2] == list(hop.START_XY)
        assert [round(v, 3) for v in ar_at(stage["ar_path"], h["land"] + 0.02)[:2]] == [round(v, 3) for v in h["land_xy"]]
    keys = [k[0] for k in stage["ar_path"]]
    assert keys == sorted(keys)
    for j in [s for s in plan["segments"] if s.get("hop")]:
        assert not [s for s in plan["segments"] if j["at_sec"] < s["at_sec"] < j["end_sec"]]


def test_call_runs_three_per_chorus_and_none_after_the_fourth_line():
    timeline, _, stage, cues = run_fake(fake_lyrics())
    runs, beats, lines = cues["call_runs"], timeline["beats"], fake_lyrics()["lines"]
    assert len(runs) == 6 and all(len(r) == 4 and all(b in beats for b in r) for r in runs)
    for first in CHORUS_FIRST:
        mine = [r for r in runs if SONG_START + lines[first]["words"][-1][2] <= r[0] < SONG_START + lines[first + 3]["words"][0][1]]
        assert len(mine) == 3  # 各サビ 3 組
        for k, r in enumerate(mine):  # 行末から次の行の頭の間に収まる
            assert r[0] >= SONG_START + lines[first + k]["words"][-1][2] - 1e-6 and r[-1] < SONG_START + lines[first + k + 1]["words"][0][1]
        end4 = SONG_START + lines[first + 3]["words"][-1][2]  # 4 行目の後には入らない
        assert not [r for r in runs if end4 - 1e-6 <= r[0] < end4 + 2.4]
    assert cues["landings"] == [h["land"] for h in stage["hops"]]


def test_short_gap_gives_fewer_than_four_beats():
    lyrics = fake_lyrics()
    gap = lyrics["lines"][6]["words"][0][1] - lyrics["lines"][5]["words"][-1][2]
    shift = gap - 1.2  # サビ 2 行目の後だけ 1.2 秒に縮める(3 拍以下)。以降の行は同じだけ早める
    for line in lyrics["lines"][6:]:
        for w in line["words"]:
            w[1] = round(w[1] - shift, 3)
            w[2] = round(w[2] - shift, 3)
    _, _, _, cues = run_fake(lyrics)
    assert len(cues["call_runs"]) == 6 and min(len(r) for r in cues["call_runs"]) <= 3


def test_extra_lines_after_the_fourth_line_change_nothing():
    _, _, stage, cues = run_fake(fake_lyrics())
    _, _, stage2, cues2 = run_fake(fake_lyrics(extra_after_call=True))
    assert stage2["flashes"] == stage["flashes"] and stage2["led_character"] == stage["led_character"] and stage2["hops"] == stage["hops"]
    assert cues2["call_runs"] == cues["call_runs"] and cues2["landings"] == cues["landings"]


def test_lyrics_without_part_keep_the_old_form():
    timeline = fake_timeline()
    old = {"lines": [{"section": "pre", "words": [["a", 8.5, 0], ["b", 9.5, 0]]}, {"section": "pre", "words": [["c", 18.4, 0], ["d", 19.6, 0], ["e", 20.0, 0]]},
                     {"section": "chorus", "words": [["f", 24.0, 0]]}, {"section": "chorus", "words": [["g", 34.4, 0]]}]}
    _, plan, stage, _ = run_fake(old)
    by = {s["id"]: s for s in timeline["sections"]}
    assert stage["led_character"][2] == [by["outro"]["start"], by["tail"]["end"]] and len(stage["hops"]) == 2
    assert [f["kind"] for f in stage["flashes"]] == ["out", "back", "out", "back"]
    assert stage["flashes"][3]["t"] == by["outro"]["start"] and plan["foot_lock_sec"][1][1] == by["tail"]["end"]


def test_lyrics_times_pass_part_through():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        src = {"lines": [{"part": 1, "section": "pre", "out_word": 1, "text": "あいう えお"}, {"part": 2, "section": "chorus", "text": "かき くけ"}]}
        words = {"song": [{"words": [{"w": w, "s": 1.0 + i * 0.5, "e": 1.4 + i * 0.5} for i, w in enumerate(["あいう", "えお", "かき", "くけ"])]}]}
        (tmp / "s.json").write_text(json.dumps(src, ensure_ascii=False), encoding="utf-8")
        (tmp / "w.json").write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
        subprocess.run([sys.executable, str(HERE.parent / "audio" / "make_lyrics_times.py"), "--source", str(tmp / "s.json"), "--words", str(tmp / "w.json"),
                        "--name", "song", "--out", str(tmp / "o.json")], check=True, capture_output=True)
        out = json.loads((tmp / "o.json").read_text(encoding="utf-8"))
        assert [l.get("part") for l in out["lines"]] == [1, 2] and out["lines"][0]["out_word"] == 1 and "out_word" not in out["lines"][1]


def test_morphs_use_first_and_third_call_and_end_before_returning_to_led():
    timeline, _, stage, cues = run_fake(fake_lyrics())
    lines = fake_lyrics()["lines"]
    morphs, runs = cues["morphs"], cues["call_runs"]
    assert [m["to"] for m in morphs] == ["human", "anime", "human", "anime"]
    for chorus in range(2):  # 各サビの 1 組目で人型へ、3 組目でアニメへ。始めの打から終わりの打まで
        for slot, m in zip((0, 2), morphs[chorus * 2:chorus * 2 + 2]):
            run = runs[chorus * 3 + slot]
            assert m["start"] == run[0] and m["end"] > run[-1] and m["end"] - m["start"] > 0.5  # 終わりは 4 打目の 1 拍後
    words = [(SONG_START + w[1], SONG_START + w[2]) for line in lines for w in line["words"]]
    for m in morphs:  # 歌詞の語と重ならない
        assert not [1 for a, b in words if m["start"] < b and a < m["end"]], m
    backs = [f["t"] for f in stage["flashes"] if f["kind"] == "back"]
    for chorus in range(2):  # LED へ戻る前に、アニメへ戻り終わる
        assert morphs[chorus * 2 + 1]["end"] < backs[chorus] - 1e-6
    assert morphs == sorted(morphs, key=lambda m: m["start"]) and all(a["end"] < b["start"] for a, b in zip(morphs, morphs[1:]))


def test_no_morphs_without_part():
    old = {"lines": [{"section": "pre", "words": [["a", 8.5, 0], ["b", 9.5, 0]]}, {"section": "pre", "words": [["c", 18.4, 0], ["d", 19.6, 0], ["e", 20.0, 0]]},
                     {"section": "chorus", "words": [["f", 24.0, 0]]}, {"section": "chorus", "words": [["g", 34.4, 0]]}]}
    assert "morphs" not in run_fake(old)[3]


def test_short_gap_drops_a_morph_pair_only_when_it_cannot_return():
    lyrics = fake_lyrics()
    gap = lyrics["lines"][6]["words"][0][1] - lyrics["lines"][5]["words"][-1][2]
    shift = gap - 1.2  # サビ 2 行目の後を縮める。3 組目(アニメへ戻る)は無事なので 4 つのまま
    for line in lyrics["lines"][6:]:
        for w in line["words"]:
            w[1] = round(w[1] - shift, 3)
            w[2] = round(w[2] - shift, 3)
    morphs = run_fake(lyrics)[3]["morphs"]
    assert [m["to"] for m in morphs] == ["human", "anime", "human", "anime"]


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print("ok", t.__name__)
    print(f"全部 {len(tests)} 件 合格")
