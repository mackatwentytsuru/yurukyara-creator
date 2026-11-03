"""E30 の自動の最適化の最初の probes(動かして調べるモーフ)を、先読み(scan_moves.csv)から選ぶ: 正面と斜めで全体が下がる向きの大きい順に上位 N 個(1 モーフ 1 つ)。"""
import csv
import json
import sys

N = int(sys.argv[1]) if len(sys.argv) > 1 else 24
E = r"work\cc5_human_1102\eval_runs\E30_base"
rows = list(csv.DictReader(open(E + r"\scan_moves.csv", encoding="utf-8")))[1:]
best = {}
for r in rows:
    s = -(float(r["f_all"]) / 1.9 + float(r["s_all"]) / 8.5)  # 大きいほど効く
    if r["morph"] not in best or s > best[r["morph"]]:
        best[r["morph"]] = s


def mid(name):
    for p in ("cc embed morphs_", "essential head morphs_"):
        if name.startswith(p):
            return p[:-1] + "/" + name[len(p):]
    return name


top = sorted(best, key=lambda m: -best[m])[:N]
json.dump([mid(m) for m in top], open(E + r"\probes_loop1.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(top), [mid(m) for m in top][:5])
