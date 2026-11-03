"""座席から見た絵と数字を Claude(画像を読めるモデル)に渡して、見え方の問題を指摘させる。

  python place/venue/claude_review.py --report <venue_report.py の出力フォルダ> [--model claude-sonnet-5-5] [--only seat1_perf1]
キーは環境変数 CLAUDE_CREDIT_API_KEY_2、なければ CLAUDE_CREDIT_API_KEY から読む(表示しない)。使った量は <出力フォルダ>/usage.jsonl に残す。
決まり: 数字と絵にあることだけを言う。分からないことは「不明」。安全に関わる指摘は、必ず「人が判断する」印をつけて出す(Claude は断定しない)。
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
from pathlib import Path

import requests
from PIL import Image

API = "https://api.anthropic.com/v1/messages"
PROMPT = """あなたは、ライブ会場「サンプル会場」のステージ LED(客席から見て左の A 面・中央の B 面・右の C 面。中央の B 面は後ろへ 1.4 m へこんでいて、右の C 面の端は客席側へ曲がる)に映像を出す人を助けるレビュアーです。
映像を作る人は、リハーサルの日より前に、座席からの見え方を知りたい。次の資料から、**見え方の問題**を指摘してください。

資料:
1. 1 枚目の絵: 座席から見たシミュレーター(橙の円柱は演者の仮の立ち位置。高さ 1.6 m)。
2. 2 枚目の絵: 面ごとに、LED に出る映像を並べた絵。赤は、演者に隠れる所。青は、その座席から見る角度が斜めすぎて(cos が 0.6 未満)見えにくい所。
3. 数字(JSON): 面ごとの「見える割合・演者に隠れる割合・舞台に隠れる割合・いちばん斜めの cos」。座席の位置は仮の値。

守ること:
- 絵と数字にあることだけを言う。見えないこと・測っていないことは「不明」と書く。座席の位置が仮であることを前提にする。
- 映像の中身(キャラクター、文字、光など)が、赤や青の所と重なっているかを、絵を見て具体的に言う(どの部分が、どの面で)。
- 安全に関わりそうなこと(つまずき・視界・避難路など)は、気づいても断定せず、kind を「安全」、needs_human を true にして「人が判断する」ものとして出す。絵や数字から分からなければ書かない。
- 直し方の案は短く(演者の位置を動かす、映像の主役の位置を動かす、など)。
- 問題が無ければ issues は空でよい。無理に作らない。
- issues は多くて 4 件。where・what・suggestion は各 100 字以内。

次の JSON だけを返してください(前後に文章を付けない):
{"summary": "1〜2 文", "issues": [{"kind": "見え方" か "安全", "severity": "高" か "中" か "低", "where": "面と場所", "what": "何が問題か(絵と数字の根拠つき)", "suggestion": "直し方の案", "needs_human": true か false}]}
"""


def img_b64(path, max_w=1400):
    im = Image.open(path).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, int(im.height * max_w / im.width)))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def get_key():
    for name in ("CLAUDE_CREDIT_API_KEY_2", "CLAUDE_CREDIT_API_KEY"):
        v = os.environ.get(name)
        if v:
            return v, name
    sys.exit("API キーの環境変数が無い(CLAUDE_CREDIT_API_KEY_2 / CLAUDE_CREDIT_API_KEY)")


def ask(model, key, view_png, hidden_png, numbers_text):
    content = [
        {"type": "text", "text": PROMPT},
        {"type": "text", "text": "1 枚目: 座席から見たシミュレーター"},
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": img_b64(view_png)}},
        {"type": "text", "text": "2 枚目: 面ごとの映像と、隠れる所(赤)・斜めすぎる所(青)"},
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": img_b64(hidden_png, 1100)}},
        {"type": "text", "text": "数字(JSON):\n" + numbers_text},
    ]
    body = {"model": model, "max_tokens": 3000, "messages": [{"role": "user", "content": content}]}
    r = requests.post(API, headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                      json=body, timeout=180)
    if r.status_code != 200:
        raise RuntimeError(f"API {r.status_code}: {r.text[:300]}")
    j = r.json()
    text = "".join(b.get("text", "") for b in j["content"] if b["type"] == "text").strip()
    return text, j.get("usage", {})


def parse_json(text):
    s = text[text.find("{"): text.rfind("}") + 1]
    return json.loads(s)


def short_numbers(r):
    faces = r["faces"]
    return json.dumps({"座席": r["seat_name"], "目の位置cm": r["eye_cm"], "演者": r["perf_name"], "演者の位置": r["performers"],
                       "面ごと": {f: {"見える割合": v["visible"], "演者に隠れる割合": v["hidden_by_performer"],
                                     "舞台に隠れる割合": v["hidden_by_stage"], "いちばん斜めのcos": v["min_cos"]} for f, v in faces.items()}},
                      ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", required=True)
    ap.add_argument("--model", default="claude-sonnet-5-5")
    ap.add_argument("--only", default=None, help="例 seat1_perf1")
    a = ap.parse_args()
    rep = Path(a.report)
    key, keyname = get_key()
    numbers = json.loads((rep / "numbers.json").read_text(encoding="utf-8"))
    md = ["# 見え方の指摘(Claude)", "", f"モデル: {a.model}。座席の位置は仮(未実測)。安全の印がある指摘は、人が判断する。", ""]
    for r in numbers["results"]:
        tag = f"{r['seat']}_{r['perf']}"
        if a.only and a.only != tag:
            continue
        t0 = time.time()
        text, usage = ask(a.model, key, rep / f"view_{tag}.png", rep / f"hidden_{tag}.png", short_numbers(r))
        sec = time.time() - t0
        try:
            res = parse_json(text)
        except Exception:
            res = {"summary": "(JSON を読めなかった)", "issues": [], "raw": text}
        (rep / f"review_{tag}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
        with open(rep / "usage.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"tag": tag, "model": a.model, "key": keyname, "seconds": round(sec, 1), **usage}, ensure_ascii=False) + "\n")
        md += [f"## {r['seat_name']} × {r['perf_name']}", "", res.get("summary", ""), ""]
        for i in res.get("issues", []):
            human = "【人が判断】" if i.get("needs_human") else ""
            md.append(f"- {human}[{i.get('kind')}・{i.get('severity')}] {i.get('where')}: {i.get('what')} → {i.get('suggestion')}")
        md.append("")
        print(f"{tag}: {len(res.get('issues', []))} 件、{sec:.0f} 秒、入力 {usage.get('input_tokens')} / 出力 {usage.get('output_tokens')} トークン")
    (rep / "見え方の指摘.md").write_text("\n".join(md), encoding="utf-8")
    print("書いた:", rep / "見え方の指摘.md")


if __name__ == "__main__":
    main()
