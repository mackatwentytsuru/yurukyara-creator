"""ゆるキャラチェックの試験: 試験の絵 6 枚を描いて PNG にし、c01_yuru_check.py に通し、正解の表と比べる。

使い方: python creator/check/run_testset.py <出力フォルダ> [--no-ai] [--jobs 2] [--reuse]
合格: 6/6(分け方が正解と同じ)。結果は <出力>/summary.json と画面に。終わりの番号: 全部正解で 0、外れがあれば 1。
判定役(Claude)を使うと 1 枚あたり claude -p を 6 回呼ぶ(Haiku 3・Sonnet 3)。定額のプランで流れる(j01_judge が ANTHROPIC_API_KEY を外す)。
"""
import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PY = sys.executable


def run(args):
    return subprocess.run([PY, *map(str, args)], cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--no-ai", action="store_true")
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--reuse", action="store_true", help="前の答え(answers/)を読み直すだけ。聞き直さない")
    a = ap.parse_args()
    out = Path(a.out)
    pics = out / "testset"
    p = run([REPO / "creator/check/testset/gen_testset.py", pics])
    if p.returncode:
        sys.exit(p.stderr)
    labels = json.loads((pics / "labels.json").read_text(encoding="utf-8"))
    for name in labels:
        run([REPO / "creator/pipeline/d01_svg_to_png.py", pics / f"{name}.svg"])
    t0 = time.time()

    def one(name):
        extra = (["--no-ai"] if a.no_ai else []) + (["--reuse"] if a.reuse else [])
        run([REPO / "creator/pipeline/c01_yuru_check.py", pics / f"{name}.png", out / "check" / name, *extra])
        return name, json.loads((out / "check" / name / "yuru_check.json").read_text(encoding="utf-8"))

    with ThreadPoolExecutor(a.jobs) as pool:
        results = dict(pool.map(one, labels))
    rows, ok = [], 0
    for name, want in labels.items():
        r = results[name]
        hit = r["class"] == want
        ok += hit
        votes = {m.split("-")[1]: v["answers"] for m, v in r["judges"].items()} if r["judges"] else {}
        rows.append({"picture": name, "want": want, "got": r["class"], "next": r["next"], "hit": hit, "why": r["why"],
                     "votes": votes, "numbers_say": r["numbers_say"]})
        print(f"{'○' if hit else '×'} {name}: 正解 {want} / 出た {r['class']} → {r['next']}  判定役 {votes}  数字 {r['numbers_say']}")
    summary = {"score": f"{ok}/{len(labels)}", "ai": not a.no_ai, "sec": round(time.time() - t0), "rows": rows}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"結果: {ok}/{len(labels)}({summary['sec']} 秒)")
    sys.exit(0 if ok == len(labels) else 1)


if __name__ == "__main__":
    main()
