"""みかんの子(みかんのゆるキャラ)の元の絵を SVG で描く。Claude が書いた図形だけ。型 B(球の胴)。"""
import sys
sys.path.insert(0, "creator/pipeline")
from d03_svgkit import *

k = Kit()
CX = 627
body = [ellipse(CX, 635, 328, 296), ellipse(CX, 700, 300, 230)]
cb = k.clip(body)

k.add(soft_shadow(k, CX, 930, 300, 28), "shadow")
foot = k.linear([(0, "#f2a43a"), (1, "#c26a14")], 0, 880, 0, 960)
for fx in (520, 734):
    k.add(shape_svg(ellipse(fx + (-12 if fx < CX else 12), 940, 100, 66), f'fill="url(#{foot})"'), "foot_R" if fx < CX else "foot_L")
for ax in (300, 954):
    s = -1 if ax < CX else 1
    g = k.radial([(0, "#ffcf7a"), (0.6, "#ff9f2e"), (1, "#d9740f")], ax + 15 * s, 650, 95, fx=ax - 10, fy=620)
    k.add(shape_svg(ellipse(ax + 40 * s, 670, 84, 70, 18 * s * -1), f'fill="url(#{g})"'), "arm_R" if ax < CX else "arm_L")
k.add(solid_body(k, body, light="#ffc15a", mid="#ff8a1c", dark="#d9560a", light_at=(500, 470), rim=0.5, rim_color="#b8420a"), "body")
# 葉の下の軽いくぼみ影
k.add(contact_shadow(k, cb, CX, 345, 150, 36, opacity=0.45, sd=18, color="#9a3a08"), "body")
# 皮のつぶつぶ
dots = [(430, 780), (520, 850), (640, 870), (760, 840), (850, 760), (900, 620), (380, 560), (420, 450), (860, 480), (780, 400)]
k.add(f'<g clip-path="url(#{cb})">' + "".join(shape_svg(ellipse(x, y, 7, 4), 'fill="#c8530a" opacity="0.35"') for x, y in dots) + "</g>", "body")
k.add(highlight(k, 480, 460, 95, 45, rot=-30, opacity=0.65, sd=14, clip=cb), "body")
k.add(highlight(k, 390, 560, 24, 14, rot=-40, opacity=0.55, sd=6, clip=cb), "body")
# 顔
k.add(cheek(k, 462, 720, 44, 28, color="#ff5a5a", opacity=0.75), "cheek_R")
k.add(cheek(k, 792, 720, 44, 28, color="#ff5a5a", opacity=0.75), "cheek_L")
k.add(eye(k, 548, 660, 39, 53, color="#3a1c0e"), "eye_R")
k.add(eye(k, 706, 660, 39, 53, color="#3a1c0e"), "eye_L")
k.add(smile(CX, 716, 84, 46, color="#3a1c0e", open_mouth=True, tongue="#ff6f7f"), "mouth")
# 葉っぱ 1 枚(厚みのため 2 枚重ね)+ へた
leaf = "M630,352 C628,262 730,195 872,218 C878,326 770,408 640,372 Z"
leafd = "M630,372 C628,288 730,221 872,244 C878,356 770,440 640,402 Z"
lg = k.linear([(0, "#8fdc4a"), (1, "#2e9a2e")], 640, 240, 840, 380)
k.add(shape_svg(path(leafd), 'fill="#1f6e22"')
      + shape_svg(rrect(606, 322, 40, 62, 18), 'fill="#6a4a1a"')
      + shape_svg(path(leaf), f'fill="url(#{lg})"')
      + '<path d="M640,366 C716,305 790,262 862,230" fill="none" stroke="#1f7a24" stroke-width="9" stroke-linecap="round"/>', "hat")
k.add(highlight(k, 740, 250, 60, 16, rot=-25, opacity=0.5, sd=6), "hat")

k.part("体(胴)", 627, 635, 656, 592, "橙 #ff8a1c(明 #ffc15a・暗 #d9560a)", "丸いみかん。皮に小さなつぶつぶ")
k.part("葉っぱ(頭)", 740, 310, 220, 150, "緑 #8fdc4a〜#2e9a2e", "1 枚。下に濃い緑を重ねて厚く。へたは茶 #6a4a1a")
k.part("目(左)", 706, 655, 68, 92, "こげ茶 #3a1c0e", "白い光 2 つ")
k.part("目(右)", 548, 655, 68, 92, "こげ茶 #3a1c0e", "白い光 2 つ")
k.part("ほお(左)", 792, 720, 88, 56, "赤 #ff5a5a", "ぼかした楕円")
k.part("ほお(右)", 462, 720, 88, 56, "赤 #ff5a5a", "ぼかした楕円")
k.part("口", 627, 733, 70, 30, "こげ茶", "開いた笑い口(中は濃い茶、舌は桃)")
k.part("手(左)", 954, 655, 148, 120, "橙", "体の後ろ。丸い突起")
k.part("手(右)", 300, 655, 148, 120, "橙", "体の後ろ。丸い突起")
k.part("足(左)", 734, 925, 184, 112, "濃い橙 #f2a43a〜#c26a14", "床に触れる")
k.part("足(右)", 520, 925, 184, 112, "濃い橙 #f2a43a〜#c26a14", "床に触れる")
SC = dict(scale=1.05, anchor=(627, 930), to=(627, 1000))
open(sys.argv[1], "w", encoding="utf-8").write(k.svg(**SC))
if len(sys.argv) > 2:
    open(sys.argv[2], "w", encoding="utf-8").write(k.parts_md(**SC) + chr(10))
