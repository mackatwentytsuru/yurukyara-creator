"""スキルで確認できた範囲(カバー率)を、verified.json だけから機械で数える。

使い方:
  python coverage.py                                # 試した題材のうち確認済みの数と、根拠の表を表示
  python coverage.py --write ../../docs/カバー率.md  # 上の表を、docs/カバー率.md の自動生成の区間に書く

「確認済み」の意味: オリジナルのキャラを、スキルだけで実際に作り、固定の試験に合格した物。
判定役は新しい文脈の Claude(Haiku 5.5 と Sonnet 5.5。creator/pipeline/j01_judge.py)。
verified.json の各項目は、結果表(結果表.md)の行と結びつける。「作れるはず」は数えない。
手で数字を書かない。数字は verified.json から計算する。全国の分布は扱わない(元の一覧の絵が手元に無く、Claude で取り直せないため)。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VERIFIED = os.path.join(HERE, "verified.json")
MARK_A, MARK_B = "<!-- 自動生成ここから(coverage.py) -->", "<!-- 自動生成ここまで -->"


def compute():
    ver = json.load(open(VERIFIED, encoding="utf-8"))
    items = ver["items"]
    ok = [v for v in items if v["status"] == "確認済み"]
    return ver, dict(
        n=len(items),
        ok=len(ok),
        bodies=sorted({b for v in ok for b in v.get("bodies", [])}),
        textures=sorted({t for v in ok for t in v.get("textures", [])}),
        heads=sorted({h for v in ok for h in v.get("head_ratios", [])}),
        parts=sorted({p for v in ok for p in v.get("parts", [])}),
        with_texture=sum(1 for v in ok if v.get("textures")),
        with_parts=sum(1 for v in ok if v.get("parts")),
    )


def render():
    ver, r = compute()
    n = r["n"]
    out = [
        f"試した題材は **{n} 体**(オリジナルのキャラ。実在のキャラには似せていない)。判定役は新しい文脈の Claude(Haiku 5.5 と Sonnet 5.5)だけ。",
        "",
        "## 試した題材のうち、確認済みの数(機械で計算した値)",
        "",
        "| 指標 | 体数 |",
        "|---|---|",
        f"| 確認済み(固定の試験に合格。同じキャラは Claude の判定役が両方はい) | {r['ok']} / {n} |",
        f"| 質感(毛足)も確認済み | {r['with_texture']} / {n} |",
        f"| 難しい部分(耳・帽子・翼など)も確認済み | {r['with_parts']} / {n} |",
        "",
        "確認済みの形: " + ("、".join(r["bodies"]) or "なし")
        + " / 質感: " + ("、".join(r["textures"]) or "なし")
        + " / 頭の割合: " + ("、".join(r["heads"]) or "なし")
        + " / 部分: " + ("、".join(r["parts"]) or "なし"),
        "",
        "### 確認済みの根拠(オリジナルの試験キャラと、結果表の行)",
        "| 試験キャラ | 状態 | 形 | 質感 | 根拠 |",
        "|---|---|---|---|---|",
    ]
    for v in ver["items"]:
        out.append(f"| {v['name']} | {v['status']} | {'、'.join(v.get('bodies', [])) or '-'} | {'、'.join(v.get('textures', [])) or '-'} | {v['evidence']} |")
    return "\n".join(out)


def main():
    a = sys.argv[1:]
    text = render()
    if a and a[0] == "--write":
        p = a[1]
        s = open(p, encoding="utf-8").read()
        i, j = s.index(MARK_A) + len(MARK_A), s.index(MARK_B)
        open(p, "w", encoding="utf-8").write(s[:i] + "\n" + text + "\n" + s[j:])
        print("書いた:", p)
    else:
        print(text)


if __name__ == "__main__":
    main()
