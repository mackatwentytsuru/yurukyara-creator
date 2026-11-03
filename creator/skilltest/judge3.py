"""試験のキャラをまとめて判定する(sh judge_browser.sh から呼ぶ)。決まりと判定役の設定は creator/pipeline/j01_judge.py。

使い方: python judge3.py <絵のフォルダ名> <試験のフォルダ…>(TRIAL_BASE からの相対、例 k_beak/p3_sonnet_medium)
  難しい部分も問うときは、試験のあとに = で部分の名前を書く(例 k_beak/p4=くちばし)。問い E が足される。
出力: <試験>/judge_<絵のフォルダ名>/browser_cmp.png・answers/・judge.json
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import j01_judge as J  # noqa: E402

BASE = os.environ["TRIAL_BASE"]


def main():
    shots_name, args = sys.argv[1], sys.argv[2:]
    jobs = []
    for arg in args:
        t, _, part = arg.partition("=")
        orig = os.path.join(BASE, "jobs", t.split("/")[0], "out.png")
        work = J.prepare(orig, os.path.join(BASE, t, shots_name), os.path.join(BASE, t, "judge_" + shots_name), part, True)
        jobs.append(dict(label=t, work=work, axes=J.axes_of(part, True)))
    rows = J.judge_many(jobs)
    keys = ("A", "B", "C")
    names = J.axes_of(None, True)
    passed = {k: sum(r[k] for r in rows.values()) for k in keys}
    all_three = sum(all(r[k] for k in keys) for r in rows.values())
    print("合計: " + "、".join(f"{names[k]} {passed[k]}/{len(jobs)}" for k in keys) + f"、3 つとも {all_three}/{len(jobs)}")


if __name__ == "__main__":
    main()
