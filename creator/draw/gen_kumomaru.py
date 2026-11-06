"""くもまる(青い雲のゆるキャラ)の元の絵を SVG で描く。Claude が書いた図形だけ。"""
import sys
sys.path.insert(0, "creator/pipeline")
from d03_svgkit import *

k = Kit()
CX = 627
body = [
    circle(CX, 600, 255),
    circle(CX, 440, 200),
    circle(440, 570, 170), circle(814, 570, 170),
    circle(350, 750, 130), circle(904, 750, 130),
    rrect(300, 690, 654, 240, 120),
]
cp = k.clip(body)

# 足元の影(id=shadow。--noshadow で外れる)
k.add(soft_shadow(k, CX, 962, 340, 34), "shadow")

# 後ろ: 足 2 つ・手 2 つ(体より濃い青)
dark_lin = k.linear([(0, "#5fa8e6"), (1, "#2f6fb8")], 0, 900, 0, 1000)
for fx in (492, 762):
    k.add(shape_svg(ellipse(fx, 928, 86, 56), f'fill="url(#{dark_lin})"'), "foot_R" if fx < CX else "foot_L")
arm_g = k.radial([(0, "#9bd0f6"), (0.6, "#5aa5e3"), (1, "#3a7fc6")], 215, 740, 110, fx=185, fy=700)
k.add(shape_svg(ellipse(214, 752, 84, 66, -20), f'fill="url(#{arm_g})"'), "arm_R")
arm_g2 = k.radial([(0, "#9bd0f6"), (0.6, "#5aa5e3"), (1, "#3a7fc6")], 1039, 740, 110, fx=1069, fy=700)
k.add(shape_svg(ellipse(1040, 752, 84, 66, 20), f'fill="url(#{arm_g2})"'), "arm_L")

# 体
k.add(solid_body(k, body, light="#e6f5ff", mid="#82c4f2", dark="#3f86cc", light_at=(470, 350), rim=0.5, rim_color="#2c6cb4"), "body")
# 腹の下の影(体の中だけ)
k.add(contact_shadow(k, cp, CX, 930, 330, 80, opacity=0.35, sd=26, color="#2a5fa5"), "body")
# 谷間のやわらかい影(雲のもこもこに見せる)
k.add(contact_shadow(k, cp, 322, 650, 70, 50, opacity=0.32, sd=18, color="#2a5fa5"), "body")
k.add(contact_shadow(k, cp, 932, 650, 70, 50, opacity=0.32, sd=18, color="#2a5fa5"), "body")
# ハイライト
k.add(highlight(k, 520, 380, 100, 42, rot=-35, opacity=0.8, sd=12, clip=cp), "body")
k.add(highlight(k, 395, 520, 52, 24, rot=-40, opacity=0.65, sd=8, clip=cp), "body")
k.add(highlight(k, 760, 400, 36, 16, rot=-35, opacity=0.55, sd=6, clip=cp), "body")

# 顔
k.add(eye(k, 548, 640, 36, 46), "eye_R")
k.add(eye(k, 706, 640, 36, 46), "eye_L")
k.add(cheek(k, 468, 712, 46, 30, color="#ff7f9e", opacity=0.8), "cheek_R")
k.add(cheek(k, 786, 712, 46, 30, color="#ff7f9e", opacity=0.8), "cheek_L")
k.add(smile(CX, 696, 112, 50, open_mouth=True), "mouth")

k.part("体(雲のもこもこ全体)", 627, 640, 794, 700, "空色 #82c4f2(明 #e6f5ff・暗 #3f86cc)", "重ねた円 6 つ+底の角丸。左右対称")
k.part("目(左)", 548, 640, 72, 92, "紺 #1b2a4a", "白い光 2 つ")
k.part("目(右)", 706, 640, 72, 92, "紺 #1b2a4a", "白い光 2 つ")
k.part("ほお(左)", 468, 712, 92, 60, "桃 #ff7f9e", "ぼかした楕円")
k.part("ほお(右)", 786, 712, 92, 60, "桃 #ff7f9e", "ぼかした楕円")
k.part("口", 627, 706, 112, 60, "紺(中は桃の舌)", "笑い口")
k.part("手(左)", 214, 752, 168, 132, "空色の濃淡", "体の後ろ。丸い太い突起")
k.part("手(右)", 1040, 752, 168, 132, "空色の濃淡", "体の後ろ。丸い太い突起")
k.part("足(左)", 492, 928, 172, 112, "濃い空色 #5fa8e6〜#2f6fb8", "体の後ろ。床に触れる")
k.part("足(右)", 762, 928, 172, 112, "濃い空色 #5fa8e6〜#2f6fb8", "体の後ろ。床に触れる")
SC = dict(scale=1.04, to=(627, 1020))
open(sys.argv[1], "w", encoding="utf-8").write(k.svg(**SC))
if len(sys.argv) > 2:
    open(sys.argv[2], "w", encoding="utf-8").write(k.parts_md(**SC) + chr(10))
