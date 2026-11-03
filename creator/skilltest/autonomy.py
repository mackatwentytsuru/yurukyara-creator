"""run_clean_trial.sh の 1 回を、ファイルと記録だけから採点する。作業役の申告は使わない。

使い方: python creator/skilltest/autonomy.py <作業フォルダ> <元の絵> [--json 出力.json]
工程ごとに、人の手を足さずにできたかを出す。人の手 = 最初の頼み以外に人が入れた文の数(この試験では、聞かれても答えない)。
見た目の判定は、作業役が流した判定の結果をそのまま数える。別の判定役でのやり直しは judge3 などで別に行う。
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys

MIN_IOU = 0.90
HERE = os.path.dirname(os.path.abspath(__file__))
CHECK_MARKS = {"①": "character.json の形", "③": "埋まりと浮き", "④": "抜け", "⑤": "ブラウザで撮れる", "⑥": "視線の暴走なし"}


def newest(pattern):
    found = glob.glob(pattern, recursive=True)
    return max(found, key=os.path.getmtime) if found else None


def read_log(path):
    events = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def iou_of(orig, shot):
    """輪郭の重なりを、測り直す。"""
    out = subprocess.run([sys.executable, os.path.join(HERE, "..", "pipeline", "s03_compare.py"), orig, shot, shot + ".cmp.png", "比べ"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace", check=False).stdout
    m = re.search(r"IoU ([\d.]+)", out)
    return float(m.group(1)) if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("orig")
    ap.add_argument("--json")
    args = ap.parse_args()
    repo = os.path.join(args.work, "repo")
    trials = os.path.join(repo, "_trials")
    events = read_log(os.path.join(args.work, "log.jsonl"))
    result = next((e for e in reversed(events) if e.get("type") == "result"), {})
    tools = [c.get("name") for e in events if e.get("type") == "assistant" for c in e.get("message", {}).get("content", []) if c.get("type") == "tool_use"]
    steps = []

    def step(name, ok, detail=""):
        steps.append(dict(name=name, ok=bool(ok), detail=str(detail)))

    step("環境を調べて設定した", os.path.exists(os.path.join(repo, "creator", "env.local.sh")))
    blend = newest(os.path.join(trials, "**", "*.blend"))
    step("builder が通った", blend, os.path.basename(blend) if blend else "")
    check_txt = newest(os.path.join(trials, "**", "check", "check.txt"))
    check = open(check_txt, encoding="utf-8").read() if check_txt else ""
    for mark, name in CHECK_MARKS.items():
        step("検査: " + name, f"{mark} OK" in check)
    shot = os.path.join(os.path.dirname(check_txt), "shots", "shot_front.png") if check_txt else None
    iou = iou_of(args.orig, shot) if shot and os.path.exists(shot) else None
    step(f"輪郭の重なり {MIN_IOU} 以上", iou is not None and iou >= MIN_IOU, iou)
    judge = newest(os.path.join(trials, "**", "judge.json"))
    passed = json.load(open(judge, encoding="utf-8"))["pass"] if judge else {}
    step("判定: 同じキャラ", passed.get("A"))
    step("判定: 色", passed.get("C"))
    installed = glob.glob(os.path.join(repo, "characters", "*_trial", "character.json"))
    step("characters に置いた", installed, installed[0] if installed else "")
    web = newest(os.path.join(trials, "**", "web_check.json"))
    web_data = json.load(open(web, encoding="utf-8")) if web else {}
    step("会話の画面で読めた", web_data.get("loaded"))
    step("返事が返った", web_data.get("turns"))
    step("口が動いた", web_data.get("mouth_max", 0) > 0)
    step("表情か動きが出た", web_data.get("expressions") or web_data.get("motions"))
    done = sum(s["ok"] for s in steps)
    humans = sum(1 for e in events if e.get("type") == "user" and not e.get("isSynthetic") and not any(c.get("type") == "tool_result" for c in (e.get("message", {}).get("content") or []) if isinstance(c, dict)))
    report = dict(steps=steps, done=done, total=len(steps), ratio=round(done / len(steps), 3), human_messages_after_first=humans,
                  cost_usd=result.get("total_cost_usd"), minutes=round(result.get("duration_ms", 0) / 60000, 1), turns=result.get("num_turns"),
                  tool_calls=len(tools), check_rounds=len(glob.glob(os.path.join(trials, "**", "check", "history", "*"), recursive=True)),
                  fur=passed.get("B"))
    for s in steps:
        print(f"{'○' if s['ok'] else '×'} {s['name']} {s['detail'] if s['detail'] not in ('', 'None') else ''}".rstrip())
    print(f"人の手なしでできた工程: {done}/{len(steps)} = {report['ratio'] * 100:.0f}%")
    print(f"人の文: 最初の頼みのあと {humans} 回 / 費用 ${report['cost_usd']} / {report['minutes']} 分 / 道具の呼び出し {report['tool_calls']} 回 / 検査 {report['check_rounds']} 周")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
