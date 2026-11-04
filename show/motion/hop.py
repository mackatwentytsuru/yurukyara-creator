"""LED から舞台へ跳び出す動き。「出る」の cue 1 つから、溜め・踏み切り・宙・着地の秒と、動きの区間と、舞台の位置のキーを作る。

動きは買った素材の JumpForJoy(1 回目の跳び)をそのまま使う。秒の伸び縮みと切り抜きだけで、骨の値は作らない。
秒の決まり: 着地 = 「出る」の LAND_MIN_AFTER 秒後より後の最初の拍。踏み切り = 着地の AIR_TARGET_SEC に近い整数の拍だけ前。
宙の間だけ、舞台の位置が一定の速さで動く(溜めと着地の後は止まる)。足が床にある間は位置が動かないので、足が滑らない。
"""
import math

JUMP = "Anim_KA_Idle66_JumpForJoy"
CLIP_TAKEOFF = 0.35  # 素材の中で両足が床を離れる秒(measure: 足の一番低い所が 2 cm を超える)
CLIP_LAND = 1.333  # 素材の中で着地する秒
CLIP_END = 1.50  # 着地の沈みのいちばん下(1.467)の少し後。ここで止めて、次の動きへ混ぜて立ち上がる
FADE_IN_SEC = 0.12  # 前の踊りからの混ぜ。長いと溜めの沈みが混ざって浅くなる
TAME_SEC = 0.50  # 溜め(素材の 0〜CLIP_TAKEOFF)を見せる長さ。踏み切りの拍の手前から遅く再生して伸ばす(0.45〜0.55)
FADE_OUT_SEC = 0.45  # 着地の沈みから次の動きへ戻る長さ
AIR_TARGET_SEC = 0.8
LAND_MIN_AFTER = 0.3  # fx_plan と同じ
# 入れ替わり: LED のキャラが薄れるのと舞台のキャラが現れるのを、同じ 0.15 秒(60p で 9 コマ、30p で 4.5 コマ)に揃える。
# LED の層は舞台のキャラへ横にずらしながら薄れる(fx_plan.hop_shift_px)ので、見る人の目からは 1 人のまま
LED_FADE = (0.05, 0.20)  # LED のキャラは踏み切りのこの秒後から薄れ、この秒後に消える
REVEAL_SEC = 0.15  # 舞台のキャラが透明だけで現れきる長さ。始めは LED_FADE[0](同じ秒)
REVEAL_START = LED_FADE[0]
KEY_STEP = 1.0 / 60.0  # 宙の間の位置のキーの間隔。どの読み手(なめらかに補う)でも一定の速さになる
START_XY = (0.0, -130.0)  # LED の足元の前(中央の面 y=-140)
FORMS = {"left_front": (-100.0, 70.0), "front": (0.0, 70.0)}  # 着地の場所 [x, y] cm


def hop_times(out_t, beats):
    """{'out', 'takeoff', 'land', 'speed', 'start', 'end'}。start〜end が動きの区間(溜めから着地の沈みまで)。"""
    later = [b for b in beats if b >= out_t + LAND_MIN_AFTER - 1e-6]
    i = beats.index(later[0]) if later else None
    beat = (beats[-1] - beats[0]) / max(1, len(beats) - 1)
    if i is None:
        land = out_t + LAND_MIN_AFTER
        takeoff = land - AIR_TARGET_SEC
    else:
        land = later[0]
        if i > 0:
            beat = beats[i] - beats[i - 1]
        n = max(1, round(AIR_TARGET_SEC / beat))
        takeoff = beats[i - n] if i - n >= 0 else land - n * beat
    speed = (CLIP_LAND - CLIP_TAKEOFF) / (land - takeoff)  # 宙から後の速さ。溜めは別(TAME_SEC で遅く)
    start = takeoff - TAME_SEC
    end = takeoff + (CLIP_END - CLIP_TAKEOFF) / speed
    return {"out": out_t, "takeoff": round(takeoff, 4), "land": round(land, 4), "speed": round(speed, 5),
            "start": round(start, 4), "end": round(end, 4)}


def hop_segment(h):
    """assemble_track.py の区間。hold で、区間の後ろは最後の姿勢を保つ(素材の 2 回目の跳びへ進まない)。"""
    return {"clip": JUMP, "at_sec": h["start"], "clip_from": 0.0, "clip_to": CLIP_END, "speed": h["speed"],
            "warp": [[h["start"], 0.0], [h["takeoff"], CLIP_TAKEOFF], [h["end"], CLIP_END]],  # 溜めは遅く、踏み切りの拍で素材の離陸
            "end_sec": h["end"], "fade_sec": FADE_IN_SEC, "hold": True, "hop": True}


def continuation(seg, t, fade):
    """seg が t 秒に続いていたらの姿を、t から始まる区間にする(跳びの後に元の動きへ戻る)。"""
    speed = seg.get("speed", 1.0)
    c = seg.get("clip_from", 0.0) + (t - seg["at_sec"]) * speed
    c1 = seg.get("clip_to")
    if c1 is not None and c >= c1 - 0.05:
        return None
    out = {**seg, "at_sec": round(t, 4), "clip_from": round(c, 4), "fade_sec": fade}
    if "end_sec" in seg and seg["end_sec"] <= t:
        return None
    return out


def insert_hops(segments, hops):
    """秒で置いた区間の並びへ跳びを差し込む。跳びの間に始まる区間は消し、跳びの後は元の動きの続きへ混ぜる。"""
    out = sorted(segments, key=lambda s: s["at_sec"])
    for h in hops:
        before = [s for s in out if s["at_sec"] < h["start"]]
        after = [s for s in out if s["at_sec"] >= h["end"]]
        # 跳びの終わりに続ける踊り: その秒に動いているはずだった区間。歩き(in_place)は跳びに置きかわるので使わない
        dances = [s for s in out if s["at_sec"] < h["end"] and not s.get("in_place")]
        active = dances[-1] if dances else None
        follow = []
        nxt = after[0]["at_sec"] if after else math.inf
        if active is not None and nxt - h["end"] > FADE_OUT_SEC:
            c = continuation(active, h["end"], FADE_OUT_SEC)
            if c is not None:
                follow = [c]
        if after and not follow:
            after[0] = {**after[0], "fade_sec": max(after[0].get("fade_sec", 0.4), FADE_OUT_SEC)}
        out = before + [hop_segment(h)] + follow + after
    return out


def hop_path(h, form="left_front", start_xy=START_XY):
    """舞台の位置のキー [秒, x, y, yaw]。踏み切りまで start、宙の間は一定の速さ、着地から先は着地の場所。"""
    land_xy = FORMS[form] if isinstance(form, str) else tuple(form)
    keys = [[round(h["takeoff"], 4), start_xy[0], start_xy[1], 0]]
    span = h["land"] - h["takeoff"]
    n = max(1, int(round(span / KEY_STEP)))
    for k in range(1, n + 1):
        u = k / n
        keys.append([round(h["takeoff"] + span * u, 4), round(start_xy[0] + (land_xy[0] - start_xy[0]) * u, 3),
                     round(start_xy[1] + (land_xy[1] - start_xy[1]) * u, 3), 0])
    return keys, land_xy


def walk_path(t0, a, b, speed, turn_sec=0.2):
    """a から b へ、歩く動きの前へ進む速さ(m/s)と同じ一定の速さで歩くキー。向きを変えてから歩き、着いたら正面へ戻る。
    戻り値: (キー, 歩き始め, 歩き終わり)。"""
    dx, dy = b[0] - a[0], b[1] - a[1]
    dist = math.hypot(dx, dy)
    yaw = -math.degrees(math.atan2(dx, dy))
    t1 = t0 + turn_sec
    t2 = t1 + dist / (speed * 100.0)
    keys = [[round(t0, 4), a[0], a[1], 0], [round(t1, 4), a[0], a[1], round(yaw, 2)]]
    n = max(1, int(round((t2 - t1) / KEY_STEP)))
    for k in range(1, n + 1):
        u = k / n
        keys.append([round(t1 + (t2 - t1) * u, 4), round(a[0] + dx * u, 3), round(a[1] + dy * u, 3), round(yaw, 2)])
    keys.append([round(t2 + turn_sec + 0.2, 4), b[0], b[1], 0])
    return keys, t1, t2


def stage_hop(h, land_xy, start_xy=START_XY):
    """show_stage.json の hops に書く 1 件(LED の薄れと合成の現れの秒)。"""
    return {"out": h["out"], "takeoff": h["takeoff"], "land": h["land"], "start_xy": list(start_xy), "land_xy": list(land_xy),
            "led_fade": [round(h["takeoff"] + LED_FADE[0], 4), round(h["takeoff"] + LED_FADE[1], 4)],
            "reveal": [round(h["takeoff"] + REVEAL_START, 4), round(h["takeoff"] + REVEAL_START + REVEAL_SEC, 4)]}
