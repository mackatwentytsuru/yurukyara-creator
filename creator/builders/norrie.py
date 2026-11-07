"""ノリー(セスジキノボリカンガルーの子の執事見習い)の手組み builder。三面図(正面・横・後ろ)から組む。
元の絵: 透明の地の 1137×1137 の 3 枚(縮尺 S = 1040 px/m、地面 FY = 1076、全高 約 1.0 m)。
  正面(-Y から見た絵)X = (px - 568.5) / S、画面の右 = +X = キャラの左。
  横(キャラの左の側面)Y = (px - 568.5) / S、顔は画面の左 = -Y。
  後ろ(+Y から見た絵)X = (568.5 - px) / S。
体は P.loft、頭は loft_face(正面の絵から半幅、横の絵から前後の端。顔の前半分は行ごとに細くして、横の絵の顔が横から見えるようにする)、
しっぽは P.tube(正面と横と後ろの 3 枚で 3D の中心線)。
輪郭は P.outline の殻(黒・背面を描かない)。毛の殻は使わない(平らな塗り)。
色は元の絵の画素の色。材質は「地の色 A_SCALE 倍 + 発光 E_SCALE 倍」で、光の向きによる明暗を浅くする(影の側も絵の色に近い)。
使い方: blender -b -P norrie.py -- <出力.blend> work=<作業フォルダ>
案 C(既定。NORRIE_CUTE=0 で前の形): 組んだ後に頭を首の骨のまわりに大きく、胴を縦に短くする。骨の位置が変わるので、
骨と動きは作業フォルダに書く rig_spec.json で b07 に渡す(写しは norrie_rig_c.json。creator/specs/norrie_built.json は前の骨)。"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402
import m01_wrap as W  # noqa: E402

S = 1040.0
CX, FY = 568.5, 1076.0
WORK = "."
OL = 0.007          # 輪郭の殻の厚み(元の絵の黒い線は 7〜8px)
OL_SMALL = 0.004


def X(px):
    return (px - CX) / S


def Z(py):
    return (FY - py) / S


def R(px):
    return px / S


# ---- 色(元の絵の画素を測った値の中央値。平らな塗り) ----
BROWN = (80, 64, 60)
CREAM = (240, 233, 222)
PINK = (228, 178, 188)
GREEN = (36, 152, 103)
WHITE = (252, 252, 252)
STRIPE = (41, 40, 38)
BLACK = (8, 8, 8)
# 材質: 出る色 = 絵の色 ×(A_SCALE × 光の量 + E_SCALE)。画面の光の量は、下向きの面 約 0.05、光へ向く面 約 0.8。
# 照り(鏡のような反射)は 0。ブラウザの読み込み(rigRuntime の applyLift)は、発光のある材質には足さない
A_SCALE = float(os.environ.get("NORRIE_A", 0.22))
E_SCALE = float(os.environ.get("NORRIE_E", 0.92))


def flat_mat(name, rgb):
    """照り 0・つや消し。地の色は絵の色の A_SCALE 倍、発光は絵の色の E_SCALE 倍(どちらも線形の色で)。"""
    m = P.material(name, rgb, rough=1.0, spec=0.0)
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    lin = [P._lin(c) for c in rgb]
    b.inputs["Base Color"].default_value = (lin[0] * A_SCALE, lin[1] * A_SCALE, lin[2] * A_SCALE, 1.0)
    b.inputs["Emission Color"].default_value = (lin[0], lin[1], lin[2], 1.0)
    b.inputs["Emission Strength"].default_value = E_SCALE
    return m

# ---- 頭の断面: (py, 半幅 px, 前の端 px(横の絵), 後ろの端 px(横の絵))。輪郭の線(7px)を含む外形 ----
HEAD = [(80, 6, 395, 425), (86, 60, 340, 458), (100, 108, 292, 478), (130, 150, 246, 528), (160, 162, 226, 547),
        (190, 180, 215, 562), (220, 194, 205, 570), (250, 206, 172, 575), (280, 215, 150, 576), (310, 218, 152, 570),
        (340, 208, 158, 559), (370, 180, 168, 540), (400, 152, 194, 515), (425, 126, 230, 500), (445, 98, 275, 478),
        (461, 45, 340, 440)]
# ---- 顔の前半分の形: (py, 前半分の指数 p, いちばん広い所を後ろへずらす量 d px)。p=2 は楕円、1 に近いほどくさび形、2 より大きいと平ら ----
# 正面の絵の顔(クリームの仮面・ピンクの鼻・目)を正面から貼ったまま、横から見た時に横の絵と同じ所に見えるように決めた。
# 測った合い方(横の絵の画素): クリームの奥の端 平均 5 px・ピンクの奥の端 -3〜+6 px・目の中心 234 px(絵 234 px。正面は 521.5/615.8 px、絵 521.4/615.6)
FACE_SHAPE = [(150, 2.0, 0), (185, 2.0, 0), (204, 1.45, 18), (211, 1.35, 22), (222, 1.25, 40), (240, 1.12, 75), (300, 1.12, 78),
              (330, 1.2, 65), (350, 1.16, 30), (365, 1.14, 5), (380, 1.25, 0), (400, 1.48, 0), (412, 1.9, 0), (425, 2.5, 0),
              (440, 3.0, 0), (452, 2.6, 0), (461, 2.0, 0)]
# ---- 胴の断面(同じ書き方)。いちばん上の行の後ろの端は頭の中へ入れる(後ろから首に胴の上の縁と輪郭が見えないように) ----
BODY = [(424, 108, 352, 488), (450, 128, 348, 565), (480, 148, 342, 598), (520, 152, 338, 642), (560, 146, 338, 676),
        (600, 144, 342, 706), (640, 150, 352, 730), (680, 165, 372, 750), (720, 186, 394, 764), (760, 192, 410, 774),
        (800, 200, 416, 778), (840, 214, 412, 778), (880, 224, 408, 773), (910, 231, 402, 772), (940, 231, 398, 765),
        (970, 219, 398, 745), (1000, 213, 402, 712), (1030, 195, 392, 665), (1055, 160, 388, 620), (1068, 110, 395, 590)]

# しっぽの中心線(X: 正面と後ろの絵、Y: 横の絵、Z: 同じ高さ)。付け根は体の中、先は少し手前へ曲がる
TAIL = [(0.0, 0.13, 0.085), (0.07, 0.19, 0.102), (0.14, 0.25, 0.13), (0.19, 0.30, 0.18), (0.237, 0.333, 0.246),
        (0.272, 0.355, 0.304), (0.300, 0.369, 0.362), (0.319, 0.376, 0.419), (0.326, 0.374, 0.477), (0.324, 0.366, 0.535),
        (0.309, 0.346, 0.592), (0.291, 0.320, 0.640), (0.272, 0.296, 0.682), (0.257, 0.278, 0.705)]
TAIL_R = [0.027, 0.027, 0.026, 0.025, 0.0235, 0.0225, 0.022, 0.0215, 0.021, 0.0205, 0.020, 0.0195, 0.0185, 0.0155]

# 腕(キャラの左 +X。右は X を反転)。肩 → ひじ → 手首。半径は輪郭を除いた値
ARM = [(0.11, -0.065, 0.56), (0.148, -0.09, 0.51), (0.17, -0.115, 0.47), (0.158, -0.17, 0.39), (0.117, -0.226, 0.337)]
ARM_R = [0.036, 0.04, 0.038, 0.037, 0.032]
# 手袋: 平たい楕円体(長い軸が手首→指先)。中心と向きは元の絵の白い所(正面 重心 (474,737)・長軸 27° 下、横 重心 (315,742)・長軸 39° 下)から
HAND_C = (0.0885, -0.2447, 0.3226)            # キャラの左(+X)。右は X を反転
HAND_DIR = (-0.772, -0.497, -0.395)         # 手首→指先(おなか側・前・少し下)
HAND_R = (0.031, 0.027, 0.057)              # (幅, 厚み, 長さ)。長さが指先の向き
CUFF_R, CUFF_W = 0.0355, 0.008             # 袖口の帯: 外側の半径・軸方向の半幅(手首に密着)

# 耳の断面(元の絵の輪郭から 7px 縮めた、左の耳(画面の左)。(py, 正面の左端, 正面の右端, 横の前端, 横の後ろ端))
EAR_ROWS = [(175, 428, 495, 445, 530), (160, 411, 514, 441, 536), (130, 407, 505, 445, 527), (100, 407, 495, 449, 523),
            (88, 408, 486, 458, 522), (80, 408, 480, 466, 520), (72, 409, 472, 474, 519), (64, 413, 462, 483, 517),
            (58, 421, 446, 491, 513)]

# ---- 顔(正面の絵の画素) ----
MASK_ROWS = [(224, 566, 571), (230, 557, 580), (236, 551, 586), (242, 544, 593), (248, 537, 600), (254, 529, 608), (260, 522, 615),
             (266, 515, 622), (272, 510, 627), (278, 504, 633), (284, 499, 638), (290, 495, 642), (296, 490, 647), (302, 486, 649),
             (308, 482, 655), (314, 479, 658), (320, 475, 662), (326, 472, 665), (332, 470, 667), (338, 467, 670), (344, 466, 671),
             (350, 464, 673), (356, 463, 674), (362, 462, 675), (368, 462, 675), (374, 461, 676), (380, 461, 676), (386, 461, 676),
             (392, 462, 675), (398, 463, 674), (404, 464, 673), (410, 466, 671), (416, 468, 669), (422, 471, 666), (428, 479, 658),
             (434, 489, 648), (440, 504, 637)]
BELLY_ROWS = [(528, 548, 590), (540, 490, 647), (570, 469, 668), (600, 454, 683), (630, 446, 691), (660, 441, 696), (690, 438, 699),
              (750, 437, 700), (790, 438, 699), (810, 443, 694), (825, 430, 707), (840, 411, 726), (855, 393, 744), (870, 376, 761),
              (885, 358, 779), (900, 340, 797), (930, 300, 837), (960, 300, 837), (990, 300, 837), (1020, 300, 837),
              (1052, 300, 837)]
NOSE_C, NOSE_R = (568.5, 310.5), (48.0, 58.0)     # 中心は顔の稜線(x 568.5)に置く(絵は 567。1.5 px ずれると稜線で下のクリームが透けた)
# 目: 元の絵の黒い丸(正面で直径 約 32px)を測った中心。黒い玉(頭に半分埋めた楕円体)で作る
EYE_C = (521.4, 211.7), (615.6, 211.7)
EYE_R = (15.9, 17.4)       # 縦は少し高く(頭の面の斜めで下が埋まる分。正面で丸く見える)
EYE_BULGE = float(os.environ.get("EYE_BULGE", 0.0040))      # 玉の赤道の面から前へのふくらみ(m)。出すぎると横から飛び出して見える(横の顔の輪郭に目が重なった)
EYE_TILT = float(os.environ.get("EYE_TILT", 20.0))         # 玉の軸の向き(度)。頭の面の法線(上へ約 23°)でなく、ほぼ正面(-Y)に寄せる。上向きが正
EYE_CLEAR = float(os.environ.get("EYE_CLEAR", -0.009))      # 赤道の輪が頭の面から前へ出る最小の量(m、Y で測る)。顔の面が横を向くので深めに埋める(-6 mm だと前へ 14 mm 出て、横から見て輪郭のふちに乗った)
EYE_WIDEN_MAX = float(os.environ.get("EYE_WIDEN_MAX", 1.12))       # 横を向く面の目で、正面から見た幅を戻す倍率の上限
# 口: 黒い所の列ごとの (x, 上の縁 py, 下の縁 py)(正面の絵を測った値)。中央の人中は別の線
MOUTH_COLS = [(530, 326, 326), (534, 323, 332), (538, 325, 338), (542, 328, 341), (546, 330, 346), (550, 331, 351), (554, 332, 355),
              (558, 331, 359), (562, 330, 361), (566, 330, 362), (570, 330, 362), (574, 330, 361), (578, 331, 359), (582, 332, 356),
              (586, 331, 352), (590, 330, 347), (594, 328, 341), (598, 326, 338), (602, 323, 335), (606, 324, 326)]
# 前歯: 上の唇から下がる白い 1 本(正面の絵の白い所を行ごとに測った (py, 左の端, 右の端))。面から前へ出した小さな塊にして、横からも見える
TOOTH_ROWS = [(338.5, 566.5, 570.5), (340, 564.5, 572.5), (341.5, 561.5, 575.5), (343, 556.0, 581.0), (345, 557.5, 579.5),
              (347, 559.0, 578.0), (349, 560.5, 576.5), (351, 562.5, 574.5)]
# 前の面は行ごとに平ら(鼻づらの先から TOOTH_AHEAD〜TOOTH_AHEAD_TIP m 前)。上は口の板(面から 4.2 mm)より前。
# 横の壁(鼻づらの先から 7 mm 後ろの面まで)が横から白い四角に見える(面に沿って前へ出すだけだと、横からは口の黒に隠れた)
TOOTH_AHEAD = float(os.environ.get("TOOTH_AHEAD", 0.0068))          # 上の端(上の唇の所)
TOOTH_AHEAD_TIP = float(os.environ.get("TOOTH_AHEAD_TIP", 0.0068))  # 下の端(先)。下ほど前へ出すと輪郭の殻(7 mm)の外へはみ出し、判定役に「口の外にはみ出した白い四角」と言われた(11 mm で試した)。殻の内に止める
TOOTH_IN = -0.0012
OL_TOOTH = float(os.environ.get("OL_TOOTH", 0.0025))      # 前歯の黒い縁(殻)の厚み。絵の前歯の縁は約 3 mm。1 mm だと横から白い口元に埋もれて見えた(判定役)
# 鼻の上の弧(︶): 正面の絵の黒い線を列ごとに測った中心と太さ(px)。真ん中は人中につながる
ARC_PTS = [(548, 270.5), (552, 273.5), (556, 276.5), (560, 279.0), (564, 280.5), (568, 281.5), (572, 281.0), (576, 279.5),
           (580, 277.0), (584, 274.0), (588, 271.0), (590, 269.5)]
ARC_W = [3, 8, 10, 9, 7, 7, 7, 8, 9, 9, 5, 2]
MOUTH_KEYS = {"mouth_open": (1.8, 1.0), "mouth_wide": (1.0, 1.3), "mouth_o": (1.3, 0.5)}
MOUTH_NU = 20
# ---- 口の穴(第 6 波): 正面の絵の口の黒い形で、頭と顔の当て布に本当の穴をあける。穴の中(壁と底)は口の中の黒 ----
# 面に貼る口(黒い板)は、横から見ると鼻づらの横で前歯の横の面を隠した(前歯が 13〜25 画素の点になった)。
# 穴にすると、横から鼻づらの下に切れ込みが出て、上の唇(歯ぐき)から下がる前歯が白く見える。正面は穴の形 = 絵の口の黒の形のまま。
MOUTH_HOLE = os.environ.get("MOUTH_HOLE", "1") == "1"
HOLE_D = float(os.environ.get("HOLE_D", 0.010))               # 穴の深さ(元の面から奥へ、m。底は面に沿う)。
# くさび形の鼻づらでは穴が左右へ抜け、横から前歯の後ろに背景が透ける。前歯の後ろは黒い塊(GumBack)でふさぎ、
# 輪郭の殻は穴をあける前の頭から作って切らない(横から見て、絵と同じく前歯の前を輪郭の黒い線が通る)
TOOTH_FRONT = float(os.environ.get("TOOTH_FRONT", 0.0))       # 前歯の前の面: 鼻づらの真ん中の面から前へ(行ごとに平ら)。
# 前へ出すと横から輪郭の線を切って背景の上に白が乗り、判定役に「ほとんど見えない」と言われた(3 mm)。0 で線の内側に収まる
TOOTH_BACK_TOP = float(os.environ.get("TOOTH_BACK_TOP", 0.011))   # 前歯の後ろの面(上の端): 真ん中の面から奥へ(横から見た三角の上の幅)
TOOTH_BACK_TIP = float(os.environ.get("TOOTH_BACK_TIP", 0.001))   # 同じ(下の端)。上を厚く下を薄くすると、横から絵と同じ下向きの三角に見える
# 歯ぐき(黒): 穴の上の縁から前歯の上までをつなぐ塊。いちばん上の行は面の奥(頭の中)に置き、前歯を上の唇に付ける
GUM_ROWS = [(326.0, 562.0, 575.0), (330.5, 561.0, 576.0), (335.0, 560.0, 577.0), (339.5, 560.0, 577.0)]
GUM_IN = 0.0015
GUM_BACK = 0.0005          # 歯ぐきの前の面は前歯の前の面より少し奥(重なる所で前歯の白が勝つ。同じ面だと白と黒がちらついた)
MOUTH_REST_PX = 0.8        # 静かな時の口の板: 穴の下の縁に沿う細い帯(面積 0 の面を作らない)
KEY_OVERLAP_PX = 3.0       # シェイプキーで、動く黒い板を穴の下の縁から上へ重ねる量(前歯の下の端より下に収まる)
# 前歯の下の延び: 横の絵の前歯は正面の絵より縦に長い(横 341〜357 px、正面 338.5〜351 px)。前歯を下の唇の黒い縁(LipEdge)の後ろへ伸ばし、
# 正面からは縁に隠して絵の形のまま、横からは縦に長い三角に見せる(縁は前歯の前の面から 1 mm だけ。横から見ると輪郭の黒い線に重なる)
TOOTH_EXT_ROWS = [(353.5, 564.5, 572.5), (356.0, 566.5, 570.5)]
LIP_EDGE_ROWS = [(351.0, 561.0, 576.0), (356.8, 563.0, 574.0)]
LIP_EDGE_T = (0.0003, 0.0010)    # 縁の前の面は前歯の前の面から 0.3 mm 前、後ろの面は 1.0 mm 奥
# 背中の筋: 1 本の帯の真ん中を濃い色にする(首で切れない)。後ろの絵の幅 61 px・芯 25 px、芯は z 0.756〜0.208
STRIPE_PATH = [(180, 0.885), (180, 0.172)]
STRIPE_W, STRIPE_ROWS, STRIPE_SEG = 0.060, 21, 80
CORE_HALF_U = 0.40          # 21 列のうち真ん中の 9 列(0.026 m)
CORE_Z = (0.756, 0.208)
CORE_TIP = 0.14

# ==== 案 C「思い切ってかわいく」(2026-11-07): 赤ちゃんらしい頭身 ====
# 絵の色・仮面の形・ピンクの鼻・蝶ネクタイ・しっぽ・背中の筋はそのまま。頭を首の骨のまわりに一様に大きく、胴を縦に短く(全高はそのまま)、
# 目を絵の直径の 1.6 倍(頭の幅に対して)にして少し下・仮面の先寄りへ、目の光(大と小)、ほお、ほおのふくらみ、短い鼻づら、細い前歯、
# 丸いおなか、少し大きい手袋と耳、太い輪郭。NORRIE_CUTE=0 で前の形に戻る。
CUTE = os.environ.get("NORRIE_CUTE", "1") == "1"
HEAD_K = float(os.environ.get("NORRIE_HEAD_K", 1.12)) if CUTE else 1.0     # 頭の大きさ(首の骨のまわりに一様に)
TOP_Z = float(os.environ.get("NORRIE_TOP_Z", 0.9788))      # 耳の先の高さ(殻なし)。前のノリーと同じ(全高 1.0 m 級)
HEAD_PIV = Vector((0.0, -0.17, 0.60))                       # 頭の骨(頭を大きくする中心)
OL_SHELL = float(os.environ.get("NORRIE_OL", 0.0095)) if CUTE else OL      # 体・腕・足・しっぽの輪郭の殻(絵の太い線に近づける)
OL_HEAD = float(os.environ.get("NORRIE_OL_HEAD", 0.011)) if CUTE else OL   # 頭と耳の殻(大きくした後の厚み)
HAND_E = (0.9, 1.0) if CUTE else (0.8, 1.0)                 # 手袋の丸さ(縦の指数。1 で楕円体)
CATCH = [(-0.36, 0.40, 0.30), (0.34, -0.36, 0.13)]          # 目の光: (横, 縦, 目の横の半径に対する半径)。見る人の左上に大、右下に小(両目で同じ向き)
CATCH_T, CATCH_LIFT = 0.0006, 0.0003                        # 光の板の厚みの半分と、目の面からの持ち上げ(m)
BLUSH = [((499.0, 386.0), (21.0, 14.0)), ((638.0, 386.0), (21.0, 14.0))]     # ほお(仮面の下の左右、鼻づらの横)
BLUSH_RGB = (244, 192, 198)
# 案 C+眉(任意、既定は眉なし): NORRIE_BROWS=1 で目の上に小さな黒い眉。シェイプキー brow_up(上へ)・brow_sad(内の端を上げる)
BROWS = os.environ.get("NORRIE_BROWS", "0") == "1"
BROW_PY, BROW_UP_PX, BROW_SAD_PX = 176.0, 12.0, 7.0
BOW_PY = 508.0 if CUTE else 499.0                          # 蝶ネクタイの高さ(絵の画素)。頭が大きいので 9 px 下げ、うなずき・おじぎで、あごと重ならない
TOOTH_K = 0.62 if CUTE else 1.0                             # 前歯の幅の倍率(真ん中の線のまわりに細く)
TOOTH_ROWS_BASE = list(TOOTH_ROWS) + list(TOOTH_EXT_ROWS)    # 前歯の後ろの黒い段は元の幅のまま(横から透けない)
if CUTE:
    # 頭: てっぺんを少し丸く(上の 5 行を 2〜4 px 広く。低くすると検査 ④ でてっぺんが抜けた)、ほおをふっくら(下の行の半幅を広げ、いちばん下を丸く)、鼻づらを短く(前の端を 12〜18 px 後ろへ)
    HEAD = [(80, 6, 395, 425), (86, 64, 340, 458), (100, 112, 292, 478), (130, 153, 246, 528), (160, 165, 226, 547),
            (190, 182, 215, 563), (220, 196, 205, 570), (250, 208, 184, 575), (280, 217, 166, 576), (310, 220, 168, 570),
            (340, 214, 174, 562), (370, 194, 184, 548), (400, 166, 204, 526), (425, 132, 234, 504), (445, 102, 274, 482),
            (461, 50, 338, 446)]
    # 目の行は前を平らに寄せて目を前へ向け、ほおの行(330〜412)は p を上げてふくらませる
    FACE_SHAPE = [(150, 2.0, 0), (185, 2.0, 0), (204, 1.6, 18), (211, 1.5, 22), (222, 1.38, 40), (240, 1.2, 70), (300, 1.16, 72),
                  (330, 1.3, 58), (350, 1.32, 28), (365, 1.34, 5), (380, 1.45, 0), (400, 1.65, 0), (412, 1.95, 0), (425, 2.5, 0),
                  (440, 3.0, 0), (452, 2.6, 0), (461, 2.0, 0)]
    # おなかを丸く(下のおなかの前を 4〜12 px 前へ、半幅を 2〜6 px 広く。腕の近く(py 740 より上)は変えない)
    BODY = [(424, 108, 352, 488), (450, 128, 348, 565), (480, 148, 342, 598), (520, 152, 338, 642), (560, 146, 338, 676),
            (600, 144, 342, 706), (640, 150, 352, 730), (680, 165, 372, 750), (720, 186, 394, 764), (760, 194, 404, 774),
            (800, 204, 405, 778), (840, 220, 400, 778), (880, 230, 396, 773), (910, 236, 392, 772), (940, 235, 390, 765),
            (970, 223, 392, 745), (1000, 215, 399, 712), (1030, 195, 392, 665), (1055, 160, 388, 620), (1068, 110, 395, 590)]
    # 耳を幅だけ 1.12 倍(付け根の真ん中のまわりに。高さは絵のまま: 高くすると全高を保つために胴を縮めすぎ、頭のてっぺんが耳の先より下がって検査 ④ の抜けになった)
    _ecx, _ecy, _ez = 461.5, 487.5, 175.0
    EAR_ROWS = [(py, _ecx + (xl - _ecx) * 1.12, _ecx + (xr - _ecx) * 1.12, _ecy + (yf - _ecy) * 1.12,
                 _ecy + (yb - _ecy) * 1.12) for py, xl, xr, yf, yb in EAR_ROWS]
    HAND_R = (0.037, 0.033, 0.063)
    # 肩を丸く太く(袖の付け根の半径を太らせる)。頭を大きく胴を短くすると、あごの下と肩の間に、絵に無いくぼみができた(検査 ④ の抜け)
    ARM_R = [float(os.environ.get("NORRIE_SHOULDER_R", 0.066)), 0.052, 0.040, 0.037, 0.032]
    # 目: 絵の直径の 1.6 倍。中心は 7 px 下・内へ 1 px(仮面の先に寄せる)。少し前へ出す
    EYE_C = (520.0, 219.0), (617.0, 219.0)
    EYE_R = (15.9 * 1.6, 17.4 * 1.6)
    EYE_BULGE = float(os.environ.get("EYE_BULGE", 0.0050))
    TOOTH_ROWS = [(py, CX + (a - CX) * TOOTH_K, CX + (b - CX) * TOOTH_K) for py, a, b in TOOTH_ROWS]
    TOOTH_EXT_ROWS = [(py, CX + (a - CX) * TOOTH_K, CX + (b - CX) * TOOTH_K) for py, a, b in TOOTH_EXT_ROWS]


def smooth_path(pts, radii, k=4):
    """折れ線の中心線と半径を、Catmull-Rom で k 分割して滑らかにする(肩やひじの角を消す)。"""
    out, rr = [], []
    n = len(pts)
    for i in range(n - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n - 1)]
        r0, r1, r2, r3 = radii[max(i - 1, 0)], radii[i], radii[i + 1], radii[min(i + 2, n - 1)]
        for j in range(k):
            t = j / k
            f = lambda a, b, c, d: 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3)
            out.append(tuple(f(p0[m], p1[m], p2[m], p3[m]) for m in range(3)))
            rr.append(f(r0, r1, r2, r3))
    out.append(tuple(pts[-1]))
    rr.append(radii[-1])
    return out, rr


def group(ob, bone):
    vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")


def interp(rows, py, k):
    """rows = [(py, ...)] を py で補間して、k 番目の値を返す。"""
    ys = [r[0] for r in rows]
    vs = [r[k] for r in rows]
    if py <= ys[0]:
        return vs[0]
    for i in range(len(ys) - 1):
        if ys[i] <= py <= ys[i + 1]:
            t = (py - ys[i]) / (ys[i + 1] - ys[i])
            return vs[i] + (vs[i + 1] - vs[i]) * t
    return vs[-1]


def secs_from(rows, top_shift=True):
    """(py, 半幅, 前の端, 後ろの端)の外形から、輪郭の殻を引いた断面にする。両端の z は殻の分だけ内へ寄せる。"""
    out = []
    for i, (py, hw, f, b) in enumerate(rows):
        z = Z(py)
        if i == 0:
            z -= OL
        if i == len(rows) - 1:
            z += OL
        out.append(dict(z=z, cx=0.0, cy=((f + b) / 2 - CX) / S, rx=max((hw - 7) / S, 0.004), ry=max(((b - f) / 2 - 7) / S, 0.004)))
    return out


def face_shape(py):
    """FACE_SHAPE を py でなめらかに補間して (p, d px) を返す。"""
    K = FACE_SHAPE
    if py <= K[0][0]:
        return K[0][1], K[0][2]
    for i in range(len(K) - 1):
        if K[i][0] <= py <= K[i + 1][0]:
            t = (py - K[i][0]) / (K[i + 1][0] - K[i][0])
            t = t * t * (3 - 2 * t)
            return K[i][1] + (K[i + 1][1] - K[i][1]) * t, K[i][2] + (K[i + 1][2] - K[i][2]) * t
    return K[-1][1], K[-1][2]


def loft_face(name, secs, mat=None, n=36, refine=3):
    """頭の形。P.loft と同じ断面のつなぎ方で、前半分(-Y)だけ超楕円の指数 p と、いちばん広い所の位置 d を行ごとに変える。
    p と d は、細かくした後の断面ごとに face_shape(高さ) から決める(断面の間でも目の行の形が狂わない)。後ろ半分は楕円。"""
    if secs[0]["z"] > secs[-1]["z"]:
        secs = list(reversed(secs))
    secs = P._refine_secs(secs, refine) if refine > 1 else secs
    verts, faces = [], []
    for s in secs:
        p, dpx = face_shape(FY - s["z"] * S)
        d = dpx / S
        cyp, ryf, ryb = s["cy"] + d, s["ry"] + d, max(s["ry"] - d, 1e-4)
        ef = 2.0 / p
        for i in range(n):
            th = 2 * math.pi * i / n
            c, sn = math.cos(th), math.sin(th)
            if sn < 0:
                verts.append((s["cx"] + s["rx"] * P._sgnpow(c, ef), cyp + ryf * P._sgnpow(sn, ef), s["z"]))
            else:
                verts.append((s["cx"] + s["rx"] * c, cyp + ryb * sn, s["z"]))
        s["_cyp"] = cyp
    m = len(secs)
    for j in range(m - 1):
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    for j in (0, m - 1):
        c = len(verts)
        s = secs[j]
        verts.append((s["cx"], s["_cyp"], s["z"]))
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((c, b, a) if j == 0 else (c, a, b))
    return P._make(name, verts, faces, mat, (0, 0, 0), (0, 0, 0))


def slab(name, rows, surf, ahead, off_back, mat, ncols=8, ahead_tip=None):
    """行ごとの範囲で作る、面から前へ出た小さな塊(前歯)。前の板・後ろの板・まわりの壁で閉じる。
    前の板は行ごとに平ら: 顔の真ん中(x=0)の面から、上の行で ahead・下の行で ahead_tip だけ前(-Y)。後ろの板は面に沿って off_back。"""
    pts = rows_to_pts(rows, ncols)
    tip = ahead if ahead_tip is None else ahead_tip
    y0, y1 = rows[0][0], rows[-1][0]
    fr = [[(X(px), surf(0.0, Z(py)) - (ahead + (tip - ahead) * (py - y0) / (y1 - y0)), Z(py)) for px, py in row] for row in pts]
    bk = px_grid(pts, surf, off_back)
    nv, nu = len(pts), ncols + 1
    nb = nv * nu
    verts = [p for row in fr for p in row] + [p for row in bk for p in row]
    faces = []
    for i in range(nv - 1):
        for j in range(nu - 1):
            a = i * nu + j
            q = (a, a + nu, a + nu + 1, a + 1)
            faces.append(q)
            faces.append(tuple(reversed([v + nb for v in q])))
    ring = ([(0, j) for j in range(nu)] + [(i, nu - 1) for i in range(1, nv)] + [(nv - 1, j) for j in range(nu - 2, -1, -1)]
            + [(i, 0) for i in range(nv - 2, 0, -1)])
    for k in range(len(ring)):
        (i0, j0), (i1, j1) = ring[k], ring[(k + 1) % len(ring)]
        a, b = i0 * nu + j0, i1 * nu + j1
        faces.append((a, b, b + nb, a + nb))
    ob = P._make(name, verts, faces, mat, (0, 0, 0), (0, 0, 0))
    fix_normals(ob)
    return ob


def ray_surface(ob):
    me = ob.data
    me.calc_loop_triangles()
    bvh = BVHTree.FromPolygons([ob.matrix_world @ v.co for v in me.vertices], [tuple(t.vertices) for t in me.loop_triangles],
                               all_triangles=True)

    def surf(x, z):
        hit = bvh.ray_cast(Vector((x, -2.0, z)), Vector((0.0, 1.0, 0.0)), 4.0)[0]
        if hit is None:
            raise RuntimeError("面に当たらない (%.3f, %.3f)" % (x, z))
        return hit.y

    def surfn(x, z):
        hit, nor = bvh.ray_cast(Vector((x, -2.0, z)), Vector((0.0, 1.0, 0.0)), 4.0)[:2]
        if hit is None:
            raise RuntimeError("面に当たらない (%.3f, %.3f)" % (x, z))
        if nor.y > 0:
            nor = -nor
        return hit, nor

    def surfs(x, z, d=0.006):
        """なめらかな法線: 近くの 4 点(±d)の当たりから求める。三角形 1 枚の向きは左右で違うことがある(目の向きが左右でずれた)。"""
        hit = surfn(x, z)[0]
        tx = Vector((2 * d, surf(x + d, z) - surf(x - d, z), 0.0))
        tz = Vector((0.0, surf(x, z + d) - surf(x, z - d), 2 * d))
        nor = tx.cross(tz).normalized()
        if nor.y > 0:
            nor = -nor
        return hit, nor
    surf.n = surfn
    surf.ns = surfs
    return surf


def fix_normals(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()


def grid_mesh(name, grids, mat, mats=None):
    """grids: [(点の 3D の 2 次元配列 [行][列], 前向きか)] を 1 つの網にする。行は下へ(z が小さくなる向き)、列は +x の向き。"""
    verts, faces = [], []
    for g, front in grids:
        base = len(verts)
        nv, nu = len(g), len(g[0])
        for row in g:
            verts.extend(tuple(p) for p in row)
        for i in range(nv - 1):
            for j in range(nu - 1):
                a = base + i * nu + j
                q = (a, a + nu, a + nu + 1, a + 1)      # 画面の正面(-Y)から見て表
                faces.append(q if front else tuple(reversed(q)))
    return P._make(name, verts, faces, mat, (0, 0, 0), (0, 0, 0))


def px_grid(pts2, surf, off):
    """画素の点の 2 次元配列を、頭(体)の面から off(m、手前が正)だけ手前の 3D の点にする。"""
    out = []
    for row in pts2:
        r = []
        for px, py in row:
            x, z = X(px), Z(py)
            hit, nor = surf.n(x, z)
            nor = nor.normalized()
            r.append((hit.x + nor.x * off, hit.y + nor.y * off, hit.z + nor.z * off))
        out.append(r)
    return out


def rows_to_pts(rows, ncols, grow=0.0, clip=None):
    """行ごとの (py, x0, x1) から、点の格子(画素)を作る。grow は外へ広げる量(px)。clip(py) があれば半幅の上限(中心 CX から)。"""
    pts = []
    n = len(rows)
    for k, (py, x0, x1) in enumerate(rows):
        yy = py - (grow if k == 0 else 0)
        a, b = x0 - grow, x1 + grow
        if clip:
            lim = clip(py)
            a, b = max(a, CX - lim), min(b, CX + lim)
        pts.append([(a + (b - a) * j / ncols, yy) for j in range(ncols + 1)])
    return pts


def plate(name, rows, surf, front, back, mat, ncols=14, grow=0.0, clip=None):
    """行ごとの範囲で作る、体の面に沿う板(前の板と、面の奥へ沈めた後ろの板)。"""
    pts = rows_to_pts(rows, ncols, grow, clip)
    gs = [(px_grid(pts, surf, front), True)]
    if back:          # 大きな当て布は後ろの板を作らない(三角形を節約)
        gs.append((px_grid(pts, surf, -back), False))
    ob = grid_mesh(name, gs, mat)
    return ob


def ribbon(name, center, widths, surf, off, mat):
    """画素の中心線に沿う、幅つきの細い帯(人中・鼻の上の線)。"""
    pts = []
    n = len(center)
    for i, (px, py) in enumerate(center):
        a = center[max(i - 1, 0)]
        b = center[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / ln, dx / ln
        w = widths[i] / 2
        pts.append([(px - nx * w, py - ny * w), (px, py), (px + nx * w, py + ny * w)])
    g = px_grid(pts, surf, off)
    # 行 = 中心線に沿う向き、列 = 幅の向き。grid_mesh は 行 → 列 の順なので、そのまま使う(向きはあとで法線を直す)
    ob = grid_mesh(name, [(g, True)], mat)
    fix_to_front(ob)
    return ob


def fix_to_front(ob):
    """板の面が -Y(見る人の側)を向くようにそろえる。"""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    bad = [f for f in bm.faces if f.normal.y > 0]
    bmesh.ops.reverse_faces(bm, faces=bad)
    bm.to_mesh(me)
    bm.free()


def ellipse_rows(c, r, n=24, margin=0.0):
    rows = []
    for k in range(n + 1):
        t = -1 + 2 * k / n
        t = max(-0.999, min(0.999, t))
        py = c[1] + r[1] * t
        hw = (r[0] + margin) * math.sqrt(1 - t * t)
        rows.append((py, c[0] - hw, c[0] + hw))
    return rows


def mouth_pts(k, fw):
    """口の黒い板の点(画素)。列ごとに上の縁から下の縁へ。k は下の縁の深さの倍率、fw は幅の倍率。"""
    pts = []
    for (x, top, bot) in MOUTH_COLS:
        xx = 568.0 + (x - 568.0) * fw
        yb = top + (bot - top) * k
        pts.append([(xx, top + (yb - top) * i / 6) for i in range(7)])
    # grid は「行 = 列の位置」なので、行 × 列を入れ替えて、grid_mesh の向き(行は下へ、列は +x)に合わせる
    return [list(r) for r in zip(*pts)]


def mouth_tb(x):
    """穴(静かな時の口 = 正面の絵の口の黒)の、列 x(画素)の上の縁と下の縁。範囲の外は None。"""
    cols = MOUTH_COLS
    if x < cols[0][0] or x > cols[-1][0]:
        return None
    for i in range(len(cols) - 1):
        x0, t0, b0 = cols[i]
        x1, t1, b1 = cols[i + 1]
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0)
            return t0 + (t1 - t0) * t, b0 + (b1 - b0) * t
    return cols[-1][1], cols[-1][2]


def mouth_ext_pts(k, fw):
    """穴のある口の、動く黒い板の点(画素)。列ごとに、開いた口の列 [上の縁, 下の縁] のうち穴の外の所だけを覆う。
    穴の範囲の列は穴の下の縁から下(縁に MOUTH_REST_PX だけ重ねる)、広げて穴の横へ出た列は列の全部。
    基本の形(k=1, fw=1)は、穴の下の縁に沿う細い帯になる(静かな時は穴だけが口に見える。横から前歯を隠さない)。
    シェイプキーでは穴の下の縁に KEY_OVERLAP_PX 重ねる(広げた口の角で、穴の縁が急に上がる所に桃色の欠けが出たため)。
    口の形全体を覆うと、板(面から 4.2 mm 前)が前歯の前に来て、話す間は前歯が隠れた(下見で確かめた)。"""
    rest = (k, fw) == (1.0, 1.0)
    cols = []
    for (x, top, bot) in MOUTH_COLS:
        xx = 568.0 + (x - 568.0) * fw
        kb = top + (bot - top) * k
        tb = mouth_tb(xx)
        if tb is None:
            a, b = top, max(kb, top + MOUTH_REST_PX)
        else:
            a = tb[1] - (MOUTH_REST_PX if rest else KEY_OVERLAP_PX)
            b = max(kb, tb[1])
        cols.append([(xx, a + (b - a) * i / 6) for i in range(7)])
    return [list(r) for r in zip(*cols)]


def hole_cutter(surf, mat, step=2.0, nrow=8, ahead=0.03):
    """口の穴をあける刃: 正面の絵の口の黒い形を前後へ伸ばした閉じた形(前のふたは面から ahead 前、後ろのふた = 穴の底は面から HOLE_D 奥)。
    底は列と行の格子で面に沿う(平らな底だと、くさび形の鼻づらの横で穴があかない)。"""
    x0, x1 = MOUTH_COLS[0][0], MOUTH_COLS[-1][0]
    n = int(round((x1 - x0) / step))
    cols = []
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        t, b = mouth_tb(x)
        if b - t < 1.0:          # 両端は高さ 0 なので、刃が潰れないよう 1 px にする
            c = (t + b) / 2
            t, b = c - 0.5, c + 0.5
        cols.append([(x, t + (b - t) * j / nrow) for j in range(nrow + 1)])
    pts = [list(r) for r in zip(*cols)]          # [行(上→下)][列(+x)]
    fr = [[(X(px), surf(X(px), Z(py)) - ahead, Z(py)) for px, py in row] for row in pts]
    bk = [[(X(px), surf(X(px), Z(py)) + HOLE_D, Z(py)) for px, py in row] for row in pts]
    nv, nu = len(pts), len(pts[0])
    nb = nv * nu
    verts = [p for row in fr for p in row] + [p for row in bk for p in row]
    faces = []
    for i in range(nv - 1):
        for j in range(nu - 1):
            a = i * nu + j
            q = (a, a + nu, a + nu + 1, a + 1)
            faces.append(q)
            faces.append(tuple(reversed([v + nb for v in q])))
    ring = ([(0, j) for j in range(nu)] + [(i, nu - 1) for i in range(1, nv)] + [(nv - 1, j) for j in range(nu - 2, -1, -1)]
            + [(i, 0) for i in range(nv - 2, 0, -1)])
    for k in range(len(ring)):
        (i0, j0), (i1, j1) = ring[k], ring[(k + 1) % len(ring)]
        a, b = i0 * nu + j0, i1 * nu + j1
        faces.append((a, b, b + nb, a + nb))
    ob = P._make("mouth_cutter", verts, faces, mat, (0, 0, 0), (0, 0, 0), smooth=False)
    fix_normals(ob)
    return ob


def cut_hole(ob, cutter, sheet):
    """ob から刃の形を引く(Blender の Boolean、EXACT)。穴の壁と底は刃の材質(口の中の黒)になる。
    sheet(顔の当て布のような開いた板)は、刃から来た面を消して、穴だけを残す。"""
    m = ob.modifiers.new("mouth_hole", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.solver = "EXACT"
    m.object = cutter
    m.material_mode = "TRANSFER"
    m.use_hole_tolerant = sheet
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    ob.modifiers.remove(m)
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    if sheet:
        cut_mat = cutter.data.materials[0]
        bm = bmesh.new()
        bm.from_mesh(me)
        bad = [f for f in bm.faces if me.materials[f.material_index] == cut_mat]
        bmesh.ops.delete(bm, geom=bad, context="FACES")
        bm.to_mesh(me)
        bm.free()
        while len(me.materials) > 1 and me.materials[len(me.materials) - 1] == cut_mat:
            me.materials.pop(index=len(me.materials) - 1)
    for p in me.polygons:
        p.use_smooth = True
    n_in = sum(1 for p in me.polygons if me.materials[p.material_index] == cutter.data.materials[0])
    print("CUT", ob.name, "faces", len(me.polygons), "hole faces", n_in)
    return ob


def block_rows(name, rows, edge, mat, ncols=8):
    """行ごとの (py, x0, x1) の範囲を、行ごとの前の面と後ろの面(edge(py, px, x) → (前の y, 後ろの y))で閉じた塊(前歯・歯ぐき)。"""
    pts = rows_to_pts(rows, ncols)
    fr, bk = [], []
    for row in pts:
        fr.append([])
        bk.append([])
        for px, py in row:
            yf, yb = edge(py, px, X(px))
            fr[-1].append((X(px), yf, Z(py)))
            bk[-1].append((X(px), yb, Z(py)))
    nv, nu = len(pts), ncols + 1
    nb = nv * nu
    verts = [p for row in fr for p in row] + [p for row in bk for p in row]
    faces = []
    for i in range(nv - 1):
        for j in range(nu - 1):
            a = i * nu + j
            q = (a, a + nu, a + nu + 1, a + 1)
            faces.append(q)
            faces.append(tuple(reversed([v + nb for v in q])))
    ring = ([(0, j) for j in range(nu)] + [(i, nu - 1) for i in range(1, nv)] + [(nv - 1, j) for j in range(nu - 2, -1, -1)]
            + [(i, 0) for i in range(nv - 2, 0, -1)])
    for k in range(len(ring)):
        (i0, j0), (i1, j1) = ring[k], ring[(k + 1) % len(ring)]
        a, b = i0 * nu + j0, i1 * nu + j1
        faces.append((a, b, b + nb, a + nb))
    ob = P._make(name, verts, faces, mat, (0, 0, 0), (0, 0, 0))
    fix_normals(ob)
    return ob


def tooth_mid_y(py):
    """前歯の横から見た幅の真ん中の、鼻づらの真ん中の面からの奥行き(m、奥が正)。8 方向の撮影で前歯の画素を測る点に使う。"""
    if not MOUTH_HOLE:
        return -(TOOTH_AHEAD + TOOTH_AHEAD_TIP) / 2
    rows = TOOTH_ROWS + TOOTH_EXT_ROWS
    y0, y1 = rows[0][0], rows[-1][0]
    t = (py - y0) / (y1 - y0)
    return (-TOOTH_FRONT + TOOTH_BACK_TOP + (TOOTH_BACK_TIP - TOOTH_BACK_TOP) * t) / 2


def tooth_in_hole(surf, mats):
    """穴のある口の前歯(白)と歯ぐき(黒)。前の面は鼻づらの真ん中の面から TOOTH_FRONT 前(行ごとに平ら)、
    後ろの面は上で TOOTH_BACK_TOP・下で TOOTH_BACK_TIP 奥(横から見て下向きの三角に近い形)。
    歯ぐき: 上の段は穴の上の縁から前歯の上まで。下の段は前歯の真後ろ(正面からは前歯に隠れる幅)で、穴の底の奥までふさぐ(横から透けない)。
    前歯は下の唇の黒い縁(LipEdge)の後ろへ TOOTH_EXT_ROWS だけ伸ばす(正面は縁に隠れ、横からは絵のように縦に長い)。"""
    rows = TOOTH_ROWS + TOOTH_EXT_ROWS
    y0, y1 = rows[0][0], rows[-1][0]

    def back_of(py):
        t = min(max((py - y0) / (y1 - y0), 0.0), 1.0)
        return TOOTH_BACK_TOP + (TOOTH_BACK_TIP - TOOTH_BACK_TOP) * t

    def tooth_edge(py, px, x):
        yc = surf(0.0, Z(py))
        return yc - TOOTH_FRONT, yc + back_of(py)

    def gum_edge(py, px, x):
        yc = surf(0.0, Z(py))
        # 後ろの面は穴の底の少し奥まで(深くすると頭に埋まる点が 6 割を超え、検査 ③ の「飲まれている」に落ちた)
        if py <= GUM_ROWS[0][0] + 0.01:           # いちばん上の行は面の奥(その点の面から GUM_IN 奥)= 頭の中
            return surf(x, Z(py)) + GUM_IN, yc + HOLE_D + 0.0005
        return yc - TOOTH_FRONT + GUM_BACK, yc + HOLE_D + 0.0005

    def behind_edge(py, px, x):
        yc = surf(0.0, Z(py))
        f = yc + back_of(py) - 0.0003
        return f, max(f + 0.0005, yc + HOLE_D + 0.001)
    # 前歯の後ろの段: 前歯と同じ行で、幅を左右 0.4 px ずつ細く(横から見て、重なる所は前歯の横の面が手前)
    def lip_edge(py, px, x):
        yc = surf(0.0, Z(py))
        return yc - TOOTH_FRONT - LIP_EDGE_T[0], yc - TOOTH_FRONT + LIP_EDGE_T[1]
    behind_rows = [(py, a + 0.4, b - 0.4) for py, a, b in TOOTH_ROWS_BASE]
    tooth = block_rows("Tooth", rows, tooth_edge, mats["tooth"], ncols=8)
    gum = block_rows("Gum", GUM_ROWS, gum_edge, mats["mouth"], ncols=6)
    # 前歯の後ろの段と下の唇の縁は頭に合わせる(ほとんどが前歯と頭の中なので、別の部品にすると検査 ③ の「飲まれている」に落ちる)
    gum_back = block_rows("GumBack", behind_rows, behind_edge, mats["mouth"], ncols=8)
    lip = block_rows("LipEdge", LIP_EDGE_ROWS, lip_edge, mats["mouth"], ncols=6)
    gum_back = P.join([gum_back, lip], "GumBack")
    return tooth, gum, gum_back


def px_grid_y(pts2, surf, off):
    """px_grid と同じだが、面からの距離 off を「真っすぐ前(-Y)」へ取る(正面から見た位置が絵の画素のまま。穴の縁とずれない)。
    面の法線の向きの距離が off になるよう、前への量は off / |法線の y|(0.35 で止める)。"""
    out = []
    for row in pts2:
        r = []
        for px, py in row:
            x, z = X(px), Z(py)
            hit, nor = surf.n(x, z)
            ny = max(abs(nor.normalized().y), 0.35)
            r.append((x, hit.y - off / ny, z))
        out.append(r)
    return out


def mouth_mesh(surf, mats):
    """口: 黒い板(前と後ろ)。mouth_open・mouth_wide・mouth_o のシェイプキー(口の下の縁と幅を動かす)。
    前歯は別の塊(Tooth)にして上の唇に付ける(口が開いても歯は上に残る)。
    MOUTH_HOLE のとき、板は穴の外へ出る所だけ(mouth_ext_pts)。基本の形は穴の下の縁の細い帯。"""
    pts_fn = mouth_ext_pts if MOUTH_HOLE else mouth_pts

    grid = px_grid_y if MOUTH_HOLE else px_grid

    def build(k, fw):
        dark = pts_fn(k, fw)
        return [grid(dark, surf, 0.0042), grid(dark, surf, -0.0015)]
    grids = build(1.0, 1.0)
    allg = [(grids[0], True), (grids[1], False)]
    verts, faces = [], []
    for g, front in allg:
        base = len(verts)
        nv, nu = len(g), len(g[0])
        for row in g:
            verts.extend(tuple(p) for p in row)
        for i in range(nv - 1):
            for j in range(nu - 1):
                a = base + i * nu + j
                q = (a, a + nu, a + nu + 1, a + 1)
                faces.append(q if front else tuple(reversed(q)))
    mo = P._make("Mouth", verts, faces, mats["mouth"], (0, 0, 0), (0, 0, 0))
    mo.shape_key_add(name="Basis")
    for name, (k, fw) in MOUTH_KEYS.items():
        key = mo.shape_key_add(name=name)
        g2 = build(k, fw)
        pts = []
        for g in g2:
            for row in g:
                pts.extend(row)
        for i, p in enumerate(pts):
            key.data[i].co = Vector(p)
        key.value = 0.0
    return mo


def build_face(surf_head, mats):
    parts = {}
    # 顔の仮面(クリーム)と、その縁の黒い線(少し大きい黒い板を 1 mm 奥に)
    mask_line = plate("mask_line", MASK_ROWS, surf_head, 0.0010, 0, mats["black"], ncols=20, grow=5.0)
    mask = plate("mask", MASK_ROWS, surf_head, 0.0022, 0, mats["cream"], ncols=20)
    nose = plate("nose", ellipse_rows(NOSE_C, NOSE_R, 22), surf_head, 0.0030, 0.0025, mats["pink"], ncols=16)
    # 鼻の上の弧(︶ の 1 本)と人中
    arc = ribbon("nose_arc", ARC_PTS, ARC_W, surf_head, 0.0052, mats["black"])
    # 人中の下の端: 穴のある口では穴の上の縁(330 px)の手前で止める(穴の上へ垂れると、穴のあいた鼻の板を内側と数えて検査 ③ に落ちた)
    phil_end = 329.5 if MOUTH_HOLE else 334
    phil = ribbon("philtrum", [(569, 282), (569, 300), (569, 322), (569, phil_end)], [9, 8, 8, 9], surf_head, 0.0052, mats["black"])
    mouth = mouth_mesh(surf_head, mats)
    parts["Gum"] = parts["GumBack"] = None
    if MOUTH_HOLE:
        # 前歯 1 本と歯ぐき: 穴の中で上の唇から下がる(横から切れ込みの中に白く見える)
        tooth, parts["Gum"], parts["GumBack"] = tooth_in_hole(surf_head, mats)
    else:
        # 前歯 1 本: 上の唇から下がる白い塊(正面は絵の形、横からは口の前に白く見える)
        tooth = slab("Tooth", TOOTH_ROWS, surf_head, TOOTH_AHEAD, TOOTH_IN, mats["white"], ncols=8, ahead_tip=TOOTH_AHEAD_TIP)
    parts["flat"] = [mask_line, mask, nose, arc, phil]
    # 案 C: ほお(やわらかい桃色の楕円を仮面の上、鼻づらの横に。後ろの板なし)
    parts["cheeks"] = []
    if CUTE:
        for i, (c, r) in enumerate(BLUSH):
            parts["cheeks"].append(plate("cheek%d" % i, ellipse_rows(c, r, 16), surf_head, 0.0031, 0, mats["blush"], ncols=12))
    parts["Mouth"] = mouth
    parts["Tooth"] = tooth
    # 目: 黒い玉(頭に半分埋めた楕円体)。向きは頭の面の横向き(水平の向き)に、上へ EYE_TILT 度。
    # 顔の前半分を細くしたので、目の所の面は横を向く(約 30 度)。正面から見た幅が細らないよう、横の半径を 1/cos だけ広げる
    eyes_parts, eye_ctr, catch_parts, catch_ctr = [], [], [], []
    up = Vector((0.0, 0.0, 1.0))
    al = math.radians(EYE_TILT)
    for ci, c in enumerate(EYE_C):
        xt, z = X(c[0]), Z(c[1])
        x = xt
        for _ in range(4):          # 玉を軸の向きへ出すと横へずれるので、正面から見た中心が絵の位置になるまで当て直す
            hit, nor = surf_head.ns(x, z)
            h = Vector((nor.x, nor.y, 0.0)).normalized()
            axis = (h * math.cos(al) + up * math.sin(al)).normalized()       # 玉の前向きの軸
            xl = up.cross(axis).normalized()
            yl = -axis
            rot = Matrix((xl, yl, xl.cross(yl))).transposed()                # 玉の局所の (x, y, z) → 世界
            widen = min(1.0 / max(-h.y, 1e-3), EYE_WIDEN_MAX)
            rx, rz = EYE_R[0] / S * widen, EYE_R[1] / S

            def clearance(sh, hit=hit, axis=axis, rot=rot, rx=rx, rz=rz):
                """玉の赤道の輪(軸に垂直な円)の各点が、頭の面より前へ出ている量の最小(m、Y の向きで測る)。"""
                cc = hit + axis * sh
                m = 1e9
                for k in range(24):
                    t = 2 * math.pi * k / 24
                    pnt = cc + rot @ Vector((rx * math.cos(t), 0.0, rz * math.sin(t)))
                    m = min(m, surf_head(pnt.x, pnt.z) - pnt.y)
                return m
            lo, hi = -0.02, 0.04
            for _ in range(30):
                mid = (lo + hi) / 2
                if clearance(mid) < EYE_CLEAR:
                    lo = mid
                else:
                    hi = mid
            ctr = hit + axis * hi
            if abs(ctr.x - xt) < 0.0003:
                break
            x -= ctr.x - xt
        eye_ctr.append(ctr)
        tip = ctr + axis * EYE_BULGE
        print("EYE", ci, "shift", round(hi, 4), "side_deg", round(math.degrees(math.atan2(abs(h.x), -h.y)), 1), "widen", round(widen, 3),
              "ctr", [round(v, 4) for v in ctr], "front_px", round(CX + ctr.x * S, 1), "side_px", round(CX + ctr.y * S, 1),
              "protrude_mm", round((surf_head(tip.x, tip.z) - tip.y) * 1000, 1))
        eyes_parts.append(P.superquadric("eye%d" % ci, (rx, EYE_BULGE, rz), (1.0, 1.0), tuple(ctr), mat=mats["black"], seg=(24, 14),
                                         rot_deg=tuple(math.degrees(a) for a in rot.to_euler("XYZ"))))
        if CUTE:
            # 目の光(白、発光): 玉の前の面の点に、その点の面の向きで置いた薄い円板。目の物に合わせるので、目の骨と一緒に動く
            for (u, v, kr) in CATCH:
                lp = Vector((u * rx, -EYE_BULGE * max(1.0 - u * u - v * v, 0.02) ** 0.5, v * rz))
                nl = Vector((lp.x / rx ** 2, lp.y / EYE_BULGE ** 2, lp.z / rz ** 2)).normalized()
                nw = (rot @ nl).normalized()
                cpos = ctr + rot @ lp + nw * CATCH_LIFT
                eul = nw.to_track_quat("Y", "Z").to_euler()
                r = kr * rx
                catch_parts.append(P.superquadric("catch%d_%d" % (ci, len(catch_parts)), (r, CATCH_T, r * rz / rx), (1.0, 1.0), tuple(cpos),
                                                  mat=mats["tooth"], seg=(12, 6), rot_deg=tuple(math.degrees(a) for a in eul)))
                catch_ctr.append(cpos)
    parts["eye_ctr"] = eye_ctr
    parts["Brows"] = None
    if BROWS:
        def brow_line(cx, inner, lift, tilt):
            """眉 1 本の中心線(5 点)と幅。inner = 顔の真ん中の向き(+1 / -1)。tilt > 0 で内の端が上がる。"""
            pts = []
            for k, dx in enumerate((-17, -8.5, 0, 8.5, 17)):
                arch = 4.5 * (1 - (dx / 17.0) ** 2)
                pts.append((cx + dx, BROW_PY - lift - arch - tilt * (dx * inner) / 17.0))
            return pts
        widths = [3, 6, 7, 6, 3]
        sets = {}
        for key, lift, tilt in (("base", 0.0, 0.0), ("brow_up", BROW_UP_PX, 0.0), ("brow_sad", 1.0, BROW_SAD_PX)):
            obs = [ribbon("brow_%s_%d" % (key, i), brow_line(c[0], 1 if c[0] < CX else -1, lift, tilt), widths, surf_head, 0.0045, mats["black"])
                   for i, c in enumerate(EYE_C)]
            sets[key] = P.join(obs, "Brows_" + key)
        brows = sets["base"]
        brows.name = "Brows"
        brows.shape_key_add(name="Basis")
        for key in ("brow_up", "brow_sad"):
            kb = brows.shape_key_add(name=key)
            src = sets[key].data.vertices
            assert len(src) == len(brows.data.vertices)
            for i in range(len(src)):
                kb.data[i].co = src[i].co.copy()
            kb.value = 0.0
            bpy.data.objects.remove(sets[key], do_unlink=True)
        parts["Brows"] = brows
        print("BUILD brows verts", len(brows.data.vertices))
    eyes = P.join(eyes_parts + catch_parts, "Eyes")
    gL = eyes.vertex_groups.new(name="eye_L")
    gR = eyes.vertex_groups.new(name="eye_R")
    for v in eyes.data.vertices:
        (gL if v.co.x > 0 else gR).add([v.index], 1.0, "REPLACE")
    zc = Z(EYE_C[0][1])
    # 光の頂点(白い材質の面の頂点)。まばたきでは、光の板の真ん中へ縮めて消す(目と同じく zc へ寄せる)
    white = {i for i, m in enumerate(eyes.data.materials) if m is not None and m.name == mats["tooth"].name}
    cv = set()
    for pg in eyes.data.polygons:
        if pg.material_index in white:
            cv.update(pg.vertices)
    eyes.shape_key_add(name="Basis")
    bl = eyes.shape_key_add(name="eye_blink")
    for i, v in enumerate(eyes.data.vertices):
        if i in cv:
            c = min(catch_ctr, key=lambda q: (q - v.co).length)
            bl.data[i].co = Vector((c.x, c.y, zc + (c.z - zc) * 0.08))
        else:
            bl.data[i].co = Vector((v.co.x, v.co.y, zc + (v.co.z - zc) * 0.08))
    bl.value = 0.0
    print("BUILD eyes catch_verts", len(cv), "verts", len(eyes.data.vertices))
    parts["Eyes"] = eyes
    return parts


def xloft(name, secs, mat, n=20):
    """x 方向に伸びる形。secs = [(x, y, z, ry, rz)](y-z 平面の楕円)。両端は平らなふた。"""
    verts, faces = [], []
    for (x, y, z, ry, rz) in secs:
        for i in range(n):
            t = 2 * math.pi * i / n
            verts.append((x, y + ry * math.cos(t), z + rz * math.sin(t)))
    m = len(secs)
    for j in range(m - 1):
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    for j in (0, m - 1):
        c = len(verts)
        x, y, z = secs[j][:3]
        verts.append((x, y, z))
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((c, b, a) if j == 0 else (c, a, b))
    ob = P._make(name, verts, faces, mat, (0, 0, 0), (0, 0, 0))
    fix_normals(ob)
    return ob


def with_outline(ob, thick, mats, bone_group=True):
    """殻を作って返す(頂点グループは複製が引きつぐ)。検査の「体」に数えない印を付ける。"""
    sh = P.outline(ob, thick, mats["outline"])
    sh["surface_only"] = True
    return sh


def main():
    global WORK
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0]
    for kv in argv[1:]:
        k, v = kv.split("=", 1)
        if k == "work":
            WORK = v
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(WORK, exist_ok=True)

    mats = dict(
        brown=flat_mat("Brown", BROWN), cream=flat_mat("Cream", CREAM), pink=flat_mat("Pink", PINK), green=flat_mat("Green", GREEN),
        white=flat_mat("Glove", WHITE), stripe=flat_mat("Stripe", STRIPE), black=flat_mat("Ink", BLACK), mouth=flat_mat("MouthIn", BLACK),
        blush=flat_mat("Blush", BLUSH_RGB),
    )
    # 前歯は光の向きによらず絵の白のまま(地の色 0・発光 1)。横から見ると前歯の横の壁は下向きで、ほかと同じ材質だと灰色になり、
    # 判定役に「白い前歯が小さい」と言われた(白く写る所が上半分だけだった)
    tooth_m = flat_mat("ToothWhite", WHITE)
    tb = next(n for n in tooth_m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    tb.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    tb.inputs["Emission Strength"].default_value = 1.0
    mats["tooth"] = tooth_m
    ol = P.material("Outline", (0, 0, 0), rough=1.0, spec=0.0)
    ol.use_backface_culling = True
    mats["outline"] = ol

    objs_shell = []     # 殻を付けた物(殻の一覧)

    # ---- 頭(loft_face: 顔の前半分を行ごとに細く)と胴(P.loft) ----
    head = loft_face("head_core", secs_from(HEAD), mat=mats["brown"], n=36, refine=3)
    torso = P.loft("torso", secs_from(BODY), mat=mats["brown"], n=36, e=0.97, refine=2)
    surf_head = ray_surface(head)
    surf_torso = ray_surface(torso)

    # ---- 顔 ----
    face = build_face(surf_head, mats)

    # ---- 胴のおなか(クリーム)と黒い縁 ----
    def torso_clip(py):
        return interp([(r[0], r[1]) for r in BODY], py, 1) - 12.0

    belly_line = plate("belly_line", BELLY_ROWS, surf_torso, 0.0012, 0, mats["black"], ncols=32, grow=5.0, clip=lambda py: torso_clip(py) + 3)
    belly = plate("belly", BELLY_ROWS, surf_torso, 0.0032, 0, mats["cream"], ncols=32, clip=torso_clip)

    # ---- 耳(丸みのある三角。頭の上の後ろ寄り。元の絵の耳の輪郭を 7px 縮めた断面を、高さごとに積む) ----
    ears = []
    for sign in (-1, 1):
        secs = []
        for py, xl, xr, yf, yb in EAR_ROWS:
            secs.append(dict(z=Z(py), cx=sign * (((xl + xr) / 2) - CX) / S * -1.0, cy=((yf + yb) / 2 - CX) / S,
                             rx=(xr - xl) / 2 / S, ry=(yb - yf) / 2 / S))
        ears.append(P.loft("ear%d" % sign, secs, mat=mats["brown"], n=28, e=1.0, refine=2))
    ol_head_all = None
    if MOUTH_HOLE:
        # 口の穴: 頭(耳と合わせる前の頭だけ。耳と重なったまま引くと、耳の殻の付け根も消える)と顔の当て布(仮面の縁・仮面・鼻)から、
        # 口の黒い形を引く
        cutter = hole_cutter(surf_head, mats["mouth"])
        # 殻は穴をあける前の頭から(切らない)。穴をあけた頭から作ると、切り口の細い三角の法線が乱れて口の角から黒い棘が 25 mm 出た。
        # 殻を口の形に切り抜くと、横から前歯が輪郭の外の背景に乗って見えにくかった。正面からは殻の手前の面は裏向きで描かれない
        ol_parts = [with_outline(head, OL_HEAD / HEAD_K, mats)] + [with_outline(e, OL_HEAD / HEAD_K, mats) for e in ears]
        cut_hole(head, cutter, sheet=False)
        for o in face["flat"][:3]:
            cut_hole(o, cutter, sheet=True)
        bpy.data.objects.remove(cutter, do_unlink=True)
        ol_head_all = P.join(ol_parts, "ol_Head")
        ol_head_all["surface_only"] = True
    head_all = P.join([head] + ears + ([face["GumBack"]] if face["GumBack"] is not None else []), "Head")
    group(head_all, "head")
    if ol_head_all is None:
        objs_shell.append(head_all)
    else:
        group(ol_head_all, "head")

    group(torso, "body")
    objs_shell.append(torso)

    # ---- 足(クリーム。横の絵では前に長い) ----
    feet = {}
    for sign, nm in ((-1, "leg_R"), (1, "leg_L")):
        foot = P.superquadric(nm + "_foot", (0.080, 0.088, 0.037), (1.0, 1.0), (sign * 0.152, -0.120, 0.0335), mat=mats["cream"], seg=(28, 16))
        group(foot, nm)
        feet[nm] = foot
        objs_shell.append(foot)

    # ---- しっぽ(3D の中心線の管。クリーム) ----
    tail = P.tube("tail", TAIL, TAIL_R, mat=mats["cream"], n=20)
    group(tail, "body")
    objs_shell.append(tail)

    # ---- 腕(管 + 白い手袋 + 袖口の輪) ----
    arms = {}
    for sign, nm in ((-1, "arm_R"), (1, "arm_L")):
        pts = [(sign * x, y, z) for x, y, z in ARM]
        sp, sr = smooth_path(pts, ARM_R, 3)
        tube = P.tube(nm + "_sleeve", sp, sr, mat=mats["brown"], n=22)
        hd = Vector((sign * HAND_DIR[0], HAND_DIR[1], HAND_DIR[2])).normalized()
        heul = hd.to_track_quat("Z", "Y").to_euler()
        hand = P.superquadric(nm + "_hand", HAND_R, HAND_E, (sign * HAND_C[0], HAND_C[1], HAND_C[2]), mat=mats["white"], seg=(24, 14),
                              rot_deg=tuple(math.degrees(a) for a in heul))
        d = (Vector(pts[-1]) - Vector(pts[-2])).normalized() + hd
        eul = d.normalized().to_track_quat("Z", "Y").to_euler()
        cuff_c = Vector(pts[-1]) - d.normalized() * 0.004
        # 袖口: 手首(袖の端)に密着した短い帯。角丸の長方形の断面の輪で、袖の太さに被せて浮かせない
        cuff = P.ring(nm + "_cuff", CUFF_R - CUFF_W * 0.5, CUFF_W * 0.5, tuple(cuff_c), mat=mats["white"], seg=(24, 6), squash=1.7,
                      sq=0.45, rot_deg=tuple(math.degrees(a) for a in eul))
        arm = P.join([tube, hand, cuff], nm + "_part")
        arm["pivot"] = [round(sign * ARM[0][0], 4), round(ARM[0][1], 4), round(ARM[0][2], 4)]
        group(arm, nm)
        arms[nm] = arm
        objs_shell.append(arm)

    # ---- 蝶ネクタイ(緑。首の前。横の絵で少し前へ出る) ----
    zb = Z(BOW_PY)
    yb = surf_torso(0.0, zb) - 0.004
    bows = []
    for sign in (-1, 1):
        secs = []
        for px, hz in ((580, 11), (596, 15), (614, 21), (636, 26)):
            secs.append((sign * X(px + CX) if False else sign * (px - 568.0) / S, yb - 0.004, zb, 0.011, hz / S))
        bows.append(xloft("bow%d" % sign, secs if sign > 0 else secs, mats["green"]))
    bow = P.join(bows, "BowWings")
    group(bow, "body")
    knot = P.superquadric("BowKnot", (0.0115, 0.0125, 0.021), (1.0, 1.0), (0.0, yb - 0.006, zb), mat=mats["green"], seg=(20, 12))
    group(knot, "body")
    objs_shell.append(bow)

    # ---- 案 C: 頭を首の骨のまわりに一様に大きく、胴(と腕・足・蝶ネクタイ)を縦に短く。全高(耳の先)はそのまま。しっぽは変えない ----
    # 筋・輪郭の殻(頭の殻を除く)・骨の位置は、このあと形を変えた物から作る
    head_objs = [head_all] + ([ol_head_all] if ol_head_all is not None else []) + face["flat"] + face["cheeks"] + \
        [face["Mouth"], face["Tooth"], face["Eyes"]] + ([face["Gum"]] if face["Gum"] is not None else []) + \
        ([face["Brows"]] if face["Brows"] is not None else [])
    top = max((head_all.matrix_world @ v.co).z for v in head_all.data.vertices)
    body_kz = (TOP_Z - (top - HEAD_PIV.z) * HEAD_K) / HEAD_PIV.z if CUTE else 1.0
    piv2 = Vector((HEAD_PIV.x, HEAD_PIV.y, HEAD_PIV.z * body_kz))
    m_head = Matrix.Translation(piv2) @ Matrix.Scale(HEAD_K, 4) @ Matrix.Translation(-HEAD_PIV)
    m_body = Matrix.Diagonal((1.0, 1.0, body_kz, 1.0))
    hn = {o.name for o in head_objs}
    if CUTE:
        for o in list(bpy.context.scene.objects):
            if o.type != "MESH" or o.name == tail.name:
                continue
            o.data.transform((m_head if o.name in hn else m_body) @ o.matrix_world, shape_keys=True)
            o.matrix_world = Matrix.Identity(4)
            o.data.update()
    print("BUILD cute head_k", HEAD_K, "body_kz", round(body_kz, 4), "ratio", round(HEAD_K / body_kz, 3), "top_before", round(top, 4),
          "head_pivot", [round(c, 4) for c in piv2])

    def xh(p):
        return m_head @ Vector(p)

    def xb(p):
        return m_body @ Vector(p)

    # ---- 背中の筋: 1 本の帯(クリーム)の真ん中の列を濃い色にする。2 本に分けると首で濃い芯が途切れた(判定 ④) ----
    surfaces = [head_all, torso]
    stripe_path = [(STRIPE_PATH[0][0], xh((0, 0, STRIPE_PATH[0][1])).z), (STRIPE_PATH[1][0], xb((0, 0, STRIPE_PATH[1][1])).z)]
    core_z = (xh((0, 0, CORE_Z[0])).z, xb((0, 0, CORE_Z[1])).z)
    st = W.wrap_band("stripe", surfaces, stripe_path, STRIPE_W, thick=0.003, clearance=0.0012, mat=mats["cream"],
                     seg=STRIPE_SEG, rows=STRIPE_ROWS, taper=0.2, taper_min=0.05)
    st.data.materials.append(mats["stripe"])
    nv = STRIPE_ROWS + 1
    z0, z1 = stripe_path[0][1], stripe_path[1][1]
    n_core = 0
    for k in range(STRIPE_SEG):
        zc = z0 + (z1 - z0) * (k + 0.5) / STRIPE_SEG
        s = (core_z[0] - zc) / (core_z[0] - core_z[1])
        if not 0.0 < s < 1.0:
            continue
        f = min(min(s, 1.0 - s) / CORE_TIP, 1.0)
        half = CORE_HALF_U * max(f * f * (3 - 2 * f), 0.15)       # 芯の両端は細くとがらせる
        for j in range(STRIPE_ROWS):
            if abs(2 * (j + 0.5) / STRIPE_ROWS - 1) < half:
                fi = 2 * (k * (nv - 1) + j)                        # wrap_band の面の順: 列ごとに 表・裏
                st.data.polygons[fi].material_index = 1
                st.data.polygons[fi + 1].material_index = 1
                n_core += 1
    print("BUILD stripe core faces", n_core)
    # 筋の上半分は頭の骨、下半分は胴の骨(首の高さで分ける)
    z_neck = xh((0, 0, 0.63)).z
    gh = st.vertex_groups.new(name="head")
    gb = st.vertex_groups.new(name="body")
    for v in st.data.vertices:
        (gh if v.co.z > z_neck else gb).add([v.index], 1.0, "REPLACE")

    # ---- 顔の部品の骨 ----
    for o in face["flat"]:
        group(o, "head")
    group(face["Mouth"], "head")
    group(face["Tooth"], "head")
    if face["Brows"] is not None:
        group(face["Brows"], "head")
    for o in face["cheeks"]:
        group(o, "head")
        o["surface_only"] = True     # ほおは地の色の当て布と同じ扱い
    if face["Gum"] is not None:
        group(face["Gum"], "head")
    with_outline(face["Tooth"], OL_TOOTH, mats)        # 前歯の黒い縁(横から見た時に絵と同じ線が出る)
    group(belly, "body")
    group(belly_line, "body")
    for o in (face["flat"][0], face["flat"][1], belly, belly_line):
        o["surface_only"] = True     # 地の色の当て布(検査の「体」にも「部品」にも数えない)
    group(knot, "body")
    for nm in ("eye_L", "eye_R"):
        pass

    # ---- 輪郭の殻(黒)。目・口・鼻・筋・結び目・当て布には付けない ----
    for ob in objs_shell:
        th = OL_SMALL if ob.name == "BowWings" else OL_SHELL
        with_outline(ob, th, mats)

    # ---- 骨の位置(目の骨は玉の中心) ----
    eL = next(c for c in face["eye_ctr"] if c.x > 0)
    eR = next(c for c in face["eye_ctr"] if c.x < 0)
    def r4(p):
        return [round(p[0], 4), round(p[1], 4), round(p[2], 4)]
    eL, eR = xh(eL), xh(eR)
    rig = {
        "root": [0, 0, 0],
        "body": r4(xb((0, 0.0, 0.36))),
        "head": r4(piv2),
        "arm_L": r4(xb(arms["arm_L"]["pivot"])),
        "arm_R": r4(xb(arms["arm_R"]["pivot"])),
        "leg_L": r4(xb((0.152, -0.06, 0.09))),
        "leg_R": r4(xb((-0.152, -0.06, 0.09))),
        "eye_L": r4(eL),
        "eye_R": r4(eR),
    }
    # ---- 色と横顔の点検に使う点(作業フォルダへ。8 方向の写真のどの画素を測るか) ----
    def on(surf, px, py, off):
        hit, nor = surf.n(X(px), Z(py))
        p = hit + nor.normalized() * off
        return r4(xh(p) if surf is surf_head else xb(p))
    samples = {
        "chin": [on(surf_head, 568.5, 428, 0.0022), on(surf_head, 520, 418, 0.0022), on(surf_head, 617, 418, 0.0022)],
        "belly": [on(surf_torso, 568.5, 650, 0.0032), on(surf_torso, 568.5, 760, 0.0032), on(surf_torso, 520, 900, 0.0032)],
        "tail": [list(TAIL[i]) for i in (6, 8, 10, 12)],
        "nose_tip": [on(surf_head, 568.5, 300, 0.003)],
        "tooth": [r4(xh((0.0, surf_head(0.0, Z(346)) + tooth_mid_y(346), Z(346))))],
        "eye_L": [rig["eye_L"]], "eye_R": [rig["eye_R"]],
    }
    json.dump(samples, open(WORK + "/samples_at.json", "w"), indent=1)
    tri = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH"}
    print("BUILD tris", sum(tri.values()), json.dumps(sorted(tri.items(), key=lambda kv: -kv[1])[:8]))
    json.dump(rig, open(WORK + "/rig_at.json", "w"), indent=1)
    # 骨の spec(b07 に渡す)。骨の位置は形を変えた後の物
    parent = dict(root=None, body="root", head="body", arm_L="body", arm_R="body", leg_L="root", leg_R="root", eye_L="head", eye_R="head")
    spec = {"id": "norrie", "height_m": 1.0, "bones": [{"name": k, "at": rig[k], "parent": parent[k]} for k in parent],
            "roles": {k: k for k in ("root", "body", "head", "arm_L", "arm_R", "leg_L", "leg_R")},
            "motion": {"only": ["idle", "talk", "nod", "bow", "wave"], "arm_amp": 0.45}}
    json.dump(spec, open(WORK + "/rig_spec.json", "w"), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print("BUILD norrie ok", json.dumps(rig))


if __name__ == "__main__":
    main()
