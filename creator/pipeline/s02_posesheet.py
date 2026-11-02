"""段 8c: 姿勢の絵を 1 枚の一覧にする(大きな日本語の見出し)。

使い方: python s02_posesheet.py <フォルダ> <出力.png> "<見出し>"  (フォルダの pose_*.png を名前順に並べる)
"""
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = r"C:\Windows\Fonts\meiryob.ttc"
JP = {"idle": "待つ", "talk": "話す", "wave": "手をふる", "nod": "うなずく", "bow": "おじぎ", "jump": "ジャンプ", "think": "考える", "sad": "しょんぼり"}


def main():
    d, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
    files = sorted(glob.glob(os.path.join(d, "pose_*.png")))
    imgs = [Image.open(f).convert("RGB") for f in files]
    w, h = imgs[0].size
    cols = 4
    rows = (len(imgs) + cols - 1) // cols
    head, lab = int(w * 0.34), int(w * 0.18)
    sheet = Image.new("RGB", (cols * w, head + rows * (h + lab)), (255, 255, 255))
    dr = ImageDraw.Draw(sheet)
    dr.rectangle([0, 0, sheet.width, head], fill=(22, 34, 58))
    dr.text((int(w * 0.1), int(head * 0.15)), title, font=ImageFont.truetype(FONT, int(head * 0.6)), fill=(255, 255, 255))
    fl = ImageFont.truetype(FONT, int(lab * 0.72))
    for i, (f, im) in enumerate(zip(files, imgs)):
        name, fr = os.path.basename(f)[5:-4].rsplit("_", 1)
        x, y = (i % cols) * w, head + (i // cols) * (h + lab)
        sheet.paste(im, (x, y + lab))
        dr.text((x + int(w * 0.05), y + int(lab * 0.1)), f"{JP.get(name, name)} {int(fr) / 30:.1f}秒", font=fl, fill=(22, 34, 58))
    sheet.save(out)
    print(out, sheet.size)


main()
