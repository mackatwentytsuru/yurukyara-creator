"""ぽこたけ(きのこのゆるキャラ)の元の絵を SVG で描く。Claude が書いた図形だけ。"""
import sys
sys.path.insert(0, "creator/pipeline")
from d03_svgkit import *

k = Kit()
CX = 627
cap = [path('M252,570 C252,310 410,215 627,215 C844,215 1002,310 1002,570 Z'), ellipse(CX, 568, 388, 50), ellipse(CX, 590, 372, 46)]
stem = [ellipse(CX, 735, 222, 170), rrect(470, 590, 314, 180, 60)]
cps, cpc = k.clip(stem), k.clip(cap)

k.add(soft_shadow(k, CX, 910, 300, 30), "shadow")
# 足・手(後ろ)
foot = k.linear([(0, "#c98a52"), (1, "#8a5430")], 0, 880, 0, 950)
for fx in (535, 719):
    k.add(shape_svg(ellipse(fx, 905, 90, 58), f'fill="url(#{foot})"'), "foot_R" if fx < CX else "foot_L")
for (ax, rot) in ((398, -22), (856, 22)):
    g = k.radial([(0, "#fff4dc"), (0.6, "#ecd09c"), (1, "#c79e64")], ax - 10 * (1 if rot < 0 else -1), 730, 80, fx=ax - 20 * (1 if rot < 0 else -1), fy=705)
    k.add(shape_svg(ellipse(ax, 748, 72, 56, rot), f'fill="url(#{g})"'), "arm_R" if ax < CX else "arm_L")
# 軸(胴)
k.add(solid_body(k, stem, light="#fff6e2", mid="#f2d9a8", dark="#c79e64", light_at=(540, 650), rim=0.45, rim_color="#a07a42"), "body")
# 傘が軸に落とす影
k.add(contact_shadow(k, cps, CX, 625, 250, 40, opacity=0.5, sd=18, color="#6b3d1e"), "body")
# 顔(軸の上)
k.add(eye(k, 552, 712, 30, 41, color="#3a2418"), "eye_R")
k.add(eye(k, 702, 712, 30, 41, color="#3a2418"), "eye_L")
k.add(cheek(k, 496, 768, 40, 26, color="#ff7a7a", opacity=0.75), "cheek_R")
k.add(cheek(k, 758, 768, 40, 26, color="#ff7a7a", opacity=0.75), "cheek_L")
k.add(smile(CX, 752, 66, 26, color="#3a2418", thick=9), "mouth")
# 傘
k.add(solid_body(k, cap, light="#ff8a6b", mid="#e0452f", dark="#a82a22", light_at=(500, 330), rim=0.5, rim_color="#8c1f1c"), "hat")
spots = [(470, 380, 64), (705, 320, 50), (820, 450, 72), (610, 470, 34), (345, 490, 40), (600, 290, 26)]
k.add(f'<g clip-path="url(#{cpc})">' + "".join(shape_svg(circle(x, y, r), 'fill="url(#%s)"' % k.radial([(0, "#ffffff"), (0.7, "#fdf0da"), (1, "#ecd3a8")], x, y, r * 1.1, fx=x - r * 0.3, fy=y - r * 0.35)) for x, y, r in spots) + "</g>", "hat")
k.add(contact_shadow(k, cpc, CX, 600, 340, 34, opacity=0.3, sd=16, color="#6e1c18"), "hat")
k.add(highlight(k, 520, 300, 120, 40, rot=-22, opacity=0.6, sd=12, clip=cpc), "hat")
k.add(highlight(k, 880, 390, 30, 14, rot=-50, opacity=0.5, sd=6, clip=cpc), "hat")

k.part("傘", 627, 410, 776, 410, "赤 #e0452f(明 #ff8a6b・暗 #a82a22)", "丸い屋根。下のふち(幅 776)は軸より大きく張り出す")
k.part("傘のまだら(6 つ)", 627, 390, 560, 280, "クリーム #fdf0da", "大きさ 26〜72px の円。傘の形で切る")
k.part("軸(胴)", 627, 735, 444, 340, "クリーム #f2d9a8(明 #fff6e2・暗 #c79e64)", "卵形。上は傘に隠れる")
k.part("目(左)", 552, 712, 60, 82, "こげ茶 #3a2418", "白い光 2 つ")
k.part("目(右)", 702, 712, 60, 82, "こげ茶 #3a2418", "白い光 2 つ")
k.part("ほお(左)", 496, 768, 80, 52, "桃 #ff7a7a", "ぼかした楕円")
k.part("ほお(右)", 758, 768, 80, 52, "桃 #ff7a7a", "ぼかした楕円")
k.part("口", 627, 760, 66, 30, "こげ茶", "細い笑い口(線。端は丸い)")
k.part("手(左)", 398, 748, 144, 112, "クリーム", "体の後ろ。丸い突起")
k.part("手(右)", 856, 748, 144, 112, "クリーム", "体の後ろ。丸い突起")
k.part("足(左)", 535, 905, 180, 116, "茶 #c98a52〜#8a5430", "体の後ろ。床に触れる")
k.part("足(右)", 719, 905, 180, 116, "茶 #c98a52〜#8a5430", "体の後ろ。床に触れる")
SC = dict(scale=1.1, anchor=(627, 910), to=(627, 1000))
open(sys.argv[1], "w", encoding="utf-8").write(k.svg(**SC))
if len(sys.argv) > 2:
    open(sys.argv[2], "w", encoding="utf-8").write(k.parts_md(**SC) + chr(10))
