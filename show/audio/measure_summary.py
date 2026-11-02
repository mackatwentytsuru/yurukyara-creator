"""measure_song.py の結果と書き起こし(measure_lyrics.py)から、候補ごとの構成の数字をまとめて summary.json に出す。
使い方: python measure_summary.py --songs <songs フォルダ> --lyrics <lyrics.json> --out <summary.json> 名前 [...]
  歌い出し=書き起こしの最初の語、サビの始まり=「聞こえる」の語、サビの終わり=最後の行の語から声が切れる秒を探し、
  次の小節頭(下拍)に丸める。音量は 0.5 秒ごとの二乗平均の平均(dB)。
"""
import argparse, json, pathlib
import numpy as np, soundfile as sf

HOLD_GAP = 0.3     # 声が途切れても続きとみなす秒
END_REL_DB = -20.0 # 声が「ある」とみなす、歌声の 95 パーセンタイル比


def mean_db(series, step, a, b):
    i, j = int(a / step), max(int(b / step), int(a / step) + 1)
    x = 10 ** (np.array(series[i:j]) / 10)
    return float(10 * np.log10(x.mean() + 1e-12))


def voice_end(v, sr, t_from):
    hop = int(sr * 0.05)
    k = len(v) // hop
    r = np.sqrt((v[:k * hop].reshape(k, hop) ** 2).mean(axis=1))
    on = r > np.percentile(r, 95) * 10 ** (END_REL_DB / 20)
    i, last = int(t_from / 0.05), None
    while i < len(on):
        if on[i]:
            last = i
        elif last is not None and (i - last) * 0.05 > HOLD_GAP:
            break
        i += 1
    return (last + 1) * 0.05 if last is not None else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--songs", required=True)
    ap.add_argument("--lyrics", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("items", nargs="+")
    a = ap.parse_args()
    songs = pathlib.Path(a.songs)
    lyr = json.loads(pathlib.Path(a.lyrics).read_text(encoding="utf-8"))
    res = {}
    for name in a.items:
        m = json.loads((songs / name / "measure.json").read_text(encoding="utf-8"))
        words = [w for s in lyr[name] for w in s["words"] if w["s"] < 80]
        pc = words[0]["s"]
        ch = next(w["s"] for w in words if w["w"].strip().startswith("聞"))
        last = next(w["s"] for w in words if w["s"] > ch and w["w"].strip().startswith("呼"))
        v, sr = sf.read(str(songs / name / "vocals.wav"), dtype="float32")
        vend = voice_end(v.mean(axis=1), sr, last)
        down = np.array(m["downbeats"])
        end_bar = float(down[down >= vend - 0.02][0])
        step, md = m["step"], m["mix_db"]
        vd = sf.read(str(songs / name / "no_vocals.wav"), dtype="float32")[0].mean(axis=1)
        nv = [20 * np.log10(np.sqrt((vd[i:i + int(sr * step)] ** 2).mean()) + 1e-9) for i in range(0, len(vd) - int(sr * step), int(sr * step))]
        res[name] = {
            "duration": m["duration"], "bpm": m["bpm"], "beat_quality": m["beat_quality"],
            "first_voice_level_sec": m["first_voice_sec"], "quiet_before": m["quiet_before"],
            "prechorus_start": pc, "chorus_start": ch, "chorus_last_line_start": last,
            "chorus_voice_end": vend, "chorus_end_bar": end_bar,
            "intro_to_chorus_end": end_bar, "fits_35": end_bar <= 35.5,
            "chorus_repeat_runs": m["repeats"][:2],
            "mix_db_intro_tail": round(mean_db(md, step, max(pc - 4, 0), pc), 1),
            "mix_db_prechorus": round(mean_db(md, step, pc, ch), 1),
            "mix_db_chorus8": round(mean_db(md, step, ch, ch + 8), 1),
            "bgm_db_intro_tail": round(mean_db(nv, step, max(pc - 4, 0), pc), 1),
            "bgm_db_prechorus": round(mean_db(nv, step, pc, ch), 1),
            "bgm_db_chorus8": round(mean_db(nv, step, ch, ch + 8), 1),
            "mix_db_line_window": round(mean_db(md, step, 2.0, 7.4), 1),
            "mix_db": md, "vocal_db": m["vocal_db"], "step": step,
            "downbeats": m["downbeats"],
        }
        r = res[name]
        r["line_window_minus_chorus_db"] = round(r["mix_db_line_window"] - r["mix_db_chorus8"], 1)
        r["rise_prechorus_to_chorus_db"] = round(r["mix_db_chorus8"] - r["mix_db_prechorus"], 1)
        r["rise_intro_to_chorus_db"] = round(r["mix_db_chorus8"] - r["mix_db_intro_tail"], 1)
        r["bgm_rise_prechorus_to_chorus_db"] = round(r["bgm_db_chorus8"] - r["bgm_db_prechorus"], 1)
        print(name, {k: v for k, v in r.items() if k not in ("mix_db", "vocal_db", "downbeats")}, flush=True)
    pathlib.Path(a.out).write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
