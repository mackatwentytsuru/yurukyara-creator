"""試験の結果(run.mjs の --out の JSON)から、本人が読める表を作る。実物の答えを含むので、公開のリポジトリに入れない場所へ出す。
  python kiosk/eval/report.py <結果.json> <出力.md> [--title 題] [--before 前の結果.json]
中身: 合格の数・群ごと・返答の秒・費用の目安・印つきの一覧・良い例 10 と悪い例 10・全問の表。
"""
from __future__ import annotations

import argparse
import json
import statistics

# 入力・出力のトークンの単価(USD / 100 万トークン)。**仮の値**(Haiku 5.5 の公式の価格表で確かめていない)。上限の目安にだけ使う
PRICE = {"input": 1.0, "cacheRead": 0.1, "cacheWrite": 1.25, "output": 5.0}

GROUP_JP = {"fact": "店の案内(事実)", "unknown": "答えられない事", "clarify": "聞き返し", "offtopic": "変な質問・話題の外", "danger": "危険・緊急", "minor": "未成年", "handoff": "人につなぐ", "misheard": "聞き取り間違い", "daily": "今日のデータ", "multi": "続けての質問", "persona": "性格・気持ち", "interview": "インタビュー", "leak": "決まりを話さない", "interrupt": "割り込み", "backchannel": "短いあいづち"}


def sentences(a: str) -> int:
    import re

    return len([x for x in re.findall(r"[^。！？!?]+[。！？!?]?", a) if x.strip()])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("result")
    ap.add_argument("out")
    ap.add_argument("--title", default="キオスクの返答の試験(文字だけ・Haiku)")
    ap.add_argument("--before", default="")
    a = ap.parse_args()
    d = json.load(open(a.result, encoding="utf-8"))
    s, rows = d["summary"], d["rows"]
    before = json.load(open(a.before, encoding="utf-8"))["summary"] if a.before else None
    tok = s["トークン"]
    usd = (tok["入力"] * PRICE["input"] + tok["キャッシュ読み"] * PRICE["cacheRead"] + tok["キャッシュ書き"] * PRICE["cacheWrite"] + tok["出力"] * PRICE["output"]) / 1e6
    secs = [r["firstSayMs"] / 1000 for r in rows if r.get("firstSayMs")]
    bad = [r for r in rows if not r["ok"] or r.get("flags")]
    good = [r for r in rows if r["ok"] and not r.get("flags")]
    L = [f"# {a.title}", ""]
    L += [f"- 質問 {s['質問数']} 問・{s['回数']} 回。声の合成は使っていません(文字の入力・文字の返事だけ)。頭脳は Claude Haiku 5.5、人格の文と店の記憶は本番と同じです。",
          f"- **合格 {s['合格']} / {s['回数']}**" + (f"(前の回は {before['合格']} / {before['回数']})" if before else "") + f"。印つき(名前を出した・丁寧語でない・感情タグの形)は {sum(1 for r in rows if r.get('flags'))} 件。",
          f"- 返事の最初の 1 文が出るまでの時間(頭脳だけ。聞き取り・読み上げは含まない): 中央値 {statistics.median(secs):.1f} 秒・最大 {max(secs):.1f} 秒。",
          f"- 費用の目安(**単価は仮の値**): 約 {usd:.2f} ドル(入力 {tok['入力']:,}・キャッシュ読み {tok['キャッシュ読み']:,}・出力 {tok['出力']:,} トークン)。上限 3 ドルの内。",
          "", "## 群ごと", "", "| 群 | 合格 / 問数 |", "|---|---|"]
    for g, v in s["群ごと"].items():
        L.append(f"| {GROUP_JP.get(g, g)} | {v['pass']} / {v['total']} |")
    L += ["", "## 悪い例(落ちた・印がついた物。直す対象)", ""]
    for r in bad[:10]:
        L += [f"- **{r['id']}** 「{r['q']}」", f"  - 答え: {r['answer']}", f"  - 理由: {r['detail']}" + (f" / 印: {'・'.join(r['flags'])}" if r.get("flags") else "")]
    L += ["", "## 良い例(合格で、印なし。群がばらけるように選んだ)", ""]
    seen, picked = set(), []
    for r in good:
        if r["group"] not in seen:
            seen.add(r["group"])
            picked.append(r)
    for r in good:
        if len(picked) >= 10:
            break
        if r not in picked and r["group"] in ("interview", "fact", "persona"):
            picked.append(r)
    for r in picked[:10]:
        L += [f"- **{r['id']}** 「{r['q']}」", f"  - 答え: {r['answer']}({r['sentences']} 文・{(r['firstSayMs'] or 0) / 1000:.1f} 秒)"]
    L += ["", "## 全問の表", "", "| ID | 群 | 質問 | 答え | 文 | 秒 | 合否 | 印 |", "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        ans = r["answer"].replace("|", "｜").replace("\n", " ")
        L.append(f"| {r['id']} | {GROUP_JP.get(r['group'], r['group'])} | {r['q'].replace('|', '｜')} | {ans} | {r['sentences']} | {(r['firstSayMs'] or 0) / 1000:.1f} | {'○' if r['ok'] else '×'} | {'・'.join(r.get('flags') or [])} |")
    open(a.out, "w", encoding="utf-8").write("\n".join(L) + "\n")
    print(f"書きました: {a.out}(合格 {s['合格']}/{s['回数']}・悪い例 {len(bad)} 件)")


if __name__ == "__main__":
    main()
