"""全国のゆるキャラの傾向と、スキルで確認できた範囲(カバー率)を、機械で計算する。

使い方:
  python coverage.py --build-stats <全国一覧.csv>   # CSV から、名前・URL・絵を含まない集計 national_stats.json を作る(CSV はリポジトリに入れない)
  python coverage.py                                # national_stats.json と verified.json から、カバー率を計算して表示
  python coverage.py --write ../../docs/カバー率.md  # 上の表を、docs/カバー率.md の自動生成の区間に書く

「確認済み」の意味: その類型のオリジナルのキャラを、スキルだけで実際に作り、固定の試験に合格した物。
verified.json の各項目は、結果表(結果表.md)の行と結びつける。「作れるはず」は数えない。
手で数字を書かない。数字は、集計と verified.json から計算する。
"""
import csv
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
STATS = os.path.join(HERE, "national_stats.json")
VERIFIED = os.path.join(HERE, "verified.json")
MARK_A, MARK_B = "<!-- 自動生成ここから(coverage.py) -->", "<!-- 自動生成ここまで -->"

# 難しい部分の分類(CSV の語に含まれる文字 → 類型)
PART_RULES = [
    ("耳", ("耳",)),
    ("文字入り(たすき・胸・札・衣装)", ("文字", "札")),
    ("くちばし", ("くちばし", "嘴")),
    ("帽子・兜・冠", ("帽子", "兜", "王冠", "冠", "ちょんまげ")),
    ("翼", ("翼", "羽")),
    ("角・突起", ("角", "突起")),
    ("尾", ("尾", "しっぽ")),
    ("ひげ・牙", ("ひげ", "牙")),
    ("たすき・帯・マフラー", ("たすき", "帯", "マフラー", "スカーフ")),
    ("花・葉の飾り", ("花", "葉")),
    ("布のひらひら・着物・マント", ("ひらひら", "着物", "マント", "袖", "法被", "スカート", "衣装")),
    ("髪・毛並み", ("髪", "毛")),
]


def classify_parts(text):
    out = set()
    for seg in text.replace("、", ",").split(","):
        seg = seg.strip()
        for cat, keys in PART_RULES:
            if any(k in seg for k in keys):
                out.add(cat)
    return out


def build_stats(csv_path):
    rows = list(csv.DictReader(open(csv_path, encoding="utf-8-sig")))
    img = [r for r in rows if r["shape_from"] == "image" and r["body"]]
    st = {
        "date": "2026-11-02",
        "total": len(rows),
        "prefectures": len({r["prefecture"] for r in rows}),
        "with_image": len(img),
        "note": "絵を見て形と質感を判定できた物(shape_from=image)だけを、割合の分母にする。名前・URL・絵は含まない。",
        "body": dict(Counter(r["body"] for r in img)),
        "texture": dict(Counter(r["texture"] for r in img if r["texture"])),
        "head_ratio": dict(Counter(r["head_ratio"] for r in img if r["head_ratio"])),
        "colors": dict(Counter(r["colors"] for r in img if r["colors"])),
        "body_x_texture": dict(Counter(f'{r["body"]}|{r["texture"]}' for r in img if r["texture"])),
        "body_x_texture_x_head": dict(Counter(f'{r["body"]}|{r["texture"]}|{r["head_ratio"]}' for r in img if r["texture"] and r["head_ratio"])),
        "parts": dict(Counter(c for r in img for c in classify_parts(r["hard_parts"]))),
        "chars_with_parts": sum(1 for r in img if classify_parts(r["hard_parts"])),
    }
    with open(STATS, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1, sort_keys=True)
    print("書いた:", STATS, "対象", len(img), "体")


def pct(a, b):
    return f"{a / b * 100:.0f}%" if b else "-"


def compute():
    st = json.load(open(STATS, encoding="utf-8"))
    ver = json.load(open(VERIFIED, encoding="utf-8"))
    n = st["with_image"]
    ok = [v for v in ver["items"] if v["status"] == "確認済み"]
    vb = {b for v in ok for b in v.get("bodies", [])}
    vt = {t for v in ok for t in v.get("textures", [])}
    vh = {h for v in ok for h in v.get("head_ratios", [])}
    vp = {p for v in ok for p in v.get("parts", [])}
    shape = sum(c for b, c in st["body"].items() if b in vb)
    tex = sum(c for t, c in st["texture"].items() if t in vt)
    both = sum(c for k, c in st["body_x_texture"].items() if k.split("|")[0] in vb and k.split("|")[1] in vt)
    all3 = sum(c for k, c in st["body_x_texture_x_head"].items()
               if k.split("|")[0] in vb and k.split("|")[1] in vt and k.split("|")[2] in vh)
    parts_ok = sum(c for p, c in st["parts"].items() if p in vp)
    return st, ver, dict(n=n, vb=vb, vt=vt, vh=vh, vp=vp, shape=shape, tex=tex, both=both, all3=all3, parts_ok=parts_ok)


def table(st, field, verified, label):
    n = st["with_image"]
    lines = [f"| {label} | 体数 | 割合 | 確認 |", "|---|---|---|---|"]
    for k, c in sorted(st[field].items(), key=lambda kv: -kv[1]):
        lines.append(f"| {k} | {c} | {pct(c, n)} | {'確認済み' if k in verified else '未確認'} |")
    return "\n".join(lines)


def render():
    st, ver, r = compute()
    n = r["n"]
    pt = sum(st["parts"].values())
    out = []
    out.append(f"対象: 全国 {st['prefectures']} 都道府県の {st['total']} 体のうち、絵を見て形と質感を判定できた **{n} 体**(2026-11-02 時点)。割合は、この {n} 体を分母にした。")
    out.append("")
    out.append("## カバー率(機械で計算した値)")
    out.append("")
    out.append("| 指標 | 確認済みに入る体数 | 割合 |")
    out.append("|---|---|---|")
    out.append(f"| 形が確認済みの類型に入る | {r['shape']} / {n} | **{pct(r['shape'], n)}** |")
    out.append(f"| 質感が確認済みの類型に入る | {r['tex']} / {n} | **{pct(r['tex'], n)}** |")
    out.append(f"| 形と質感の**両方**が確認済みの類型に入る | {r['both']} / {n} | **{pct(r['both'], n)}** |")
    out.append(f"| 形・質感・頭の割合の**3 つ**とも確認済み | {r['all3']} / {n} | **{pct(r['all3'], n)}** |")
    out.append(f"| 難しい部分(耳・帽子・翼など)の言及のうち、確認済み | {r['parts_ok']} / {pt} | {pct(r['parts_ok'], pt)} |")
    out.append("")
    out.append("確認済みの類型: 形 = " + ("、".join(sorted(r["vb"])) or "なし") + " / 質感 = " + ("、".join(sorted(r["vt"])) or "なし") + " / 頭の割合 = " + ("、".join(sorted(r["vh"])) or "なし"))
    out.append("")
    out.append("### 形")
    out.append(table(st, "body", r["vb"], "形"))
    out.append("")
    out.append("### 質感")
    out.append(table(st, "texture", r["vt"], "質感"))
    out.append("")
    out.append("### 頭の割合")
    out.append(table(st, "head_ratio", r["vh"], "頭の割合"))
    out.append("")
    out.append(f"### 難しい部分(言及のあった体数。1 体が複数に入る。部分を 1 つ以上持つ体は {st['chars_with_parts']} 体)")
    out.append(table(st, "parts", r["vp"], "部分"))
    out.append("")
    out.append("### 確認済みの根拠(オリジナルの試験キャラと、結果表の行)")
    out.append("| 試験キャラ | 状態 | 形 | 質感 | 根拠 |")
    out.append("|---|---|---|---|---|")
    for v in ver["items"]:
        out.append(f"| {v['name']} | {v['status']} | {'、'.join(v.get('bodies', [])) or '-'} | {'、'.join(v.get('textures', [])) or '-'} | {v['evidence']} |")
    return "\n".join(out)


def main():
    a = sys.argv[1:]
    if a and a[0] == "--build-stats":
        build_stats(a[1])
        return
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
