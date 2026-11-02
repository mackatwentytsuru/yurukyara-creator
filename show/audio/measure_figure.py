"""summary.json から、候補ごとの音量の帯にイントロ・サビの位置を重ねた図を描く(PIL のみ。ラベルは日本語で大きく)。
使い方: python measure_figure.py --summary summary.json --out 構成の測定.jpg [--max-sec 65] 名前 [...]
"""
import argparse, json
from PIL import Image, ImageDraw, ImageFont

W, M = 1600, 40
FONT = "C:/Windows/Fonts/YuGothB.ttc"
INTRO, PRE, CHO = (205, 225, 250), (255, 240, 190), (255, 205, 200)
MIX, VOC = (90, 100, 130), (235, 120, 40)


def f(sz):
    return ImageFont.truetype(FONT, sz)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--summary", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-sec", type=float, default=65.0)
    ap.add_argument("names", nargs="+")
    a = ap.parse_args()
    d = json.load(open(a.summary, encoding="utf-8"))
    px = (W - 2 * M) / a.max_sec
    head, band = 80, 190
    H = 110 + len(a.names) * (head + band + 30) + 270
    im = Image.new("RGB", (W, H), "white")
    g = ImageDraw.Draw(im)
    g.text((M, 15), "曲の構成(最初の %d 秒)" % a.max_sec, font=f(64), fill="black")
    y = 110
    for n in a.names:
        r = d[n]
        pc, ch, ce = r["prechorus_start"], r["chorus_start"], r["chorus_end_bar"]
        g.text((M, y), "%s  イントロ %.1f秒 / サビ %.1f〜%.1f秒" % (n, pc, ch, ce), font=f(56), fill="black")
        top = y + head
        for (x0, x1, c) in ((0, pc, INTRO), (pc, ch, PRE), (ch, ce, CHO)):
            g.rectangle([M + x0 * px, top, M + min(x1, a.max_sec) * px, top + band], fill=c)
        step = r["step"]
        for i, (m, v) in enumerate(zip(r["mix_db"], r["vocal_db"])):
            t = i * step
            if t >= a.max_sec:
                break
            hm = max(0.0, min(1.0, (m + 40) / 25)) * band
            hv = max(0.0, min(1.0, (v + 40) / 25)) * band
            g.rectangle([M + t * px, top + band - hm, M + (t + step) * px - 1, top + band], fill=MIX)
            g.rectangle([M + t * px, top + band - hv, M + (t + step) * px - 1, top + band], outline=VOC)
        g.line([M + 35 * px, top - 6, M + 35 * px, top + band], fill=(200, 0, 0), width=4)
        y += head + band + 30
    # 軸
    for s in range(0, int(a.max_sec) + 1, 10):
        g.line([M + s * px, y - 20, M + s * px, y - 8], fill="black", width=3)
        g.text((M + s * px - 20, y - 4), str(s), font=f(48), fill="black")
    g.text((M + 12, y + 50), "秒", font=f(48), fill="black")
    ly = y + 110
    for k, (c, t) in enumerate(((INTRO, "イントロ"), (PRE, "歌い出し〜"), (CHO, "サビ"))):
        g.rectangle([M + k * 400, ly, M + k * 400 + 50, ly + 50], fill=c, outline="black")
        g.text((M + k * 400 + 62, ly - 4), t, font=f(48), fill="black")
    g.text((M, ly + 62), "灰青=全体の音量  橙の枠=歌声の音量  赤線=35秒", font=f(44), fill="black")
    im.save(a.out, quality=92)
    print(im.size)


if __name__ == "__main__":
    main()
