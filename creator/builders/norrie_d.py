"""ノリー D: まるい部品(式の形)で組む builder。案 C の比率・顔・色を、C の組み立てを測った数字で持つ。

前の作り方(三面図の輪郭に面を合わせる)は、3 枚の絵が 1 つの立体として食い違う所(顔の前のくさび形)で面が曲がり、
斜めから見ると顔がへこんだ。D は絵の輪郭に面を合わせない:
- 頭 = 頭の丸・下のほお(あご)・うなじ・鼻づらの 4 つの楕円体をやわらかくつないだ 1 つの式。胴 = 腰と胸の 2 つ。
  四角の格子を中から光線で面に載せるので、どの向きでもへこみが出ない(m04_round)。
- 耳 = 先の丸い円すいを回して平たくした形。腕・しっぽ = 中心線に沿う管(両端は半球)。足・手袋 = 楕円体・超楕円体。
- 顔の模様(仮面・鼻・ほお・口・前歯・鼻の線)・おなか・背中の帯 = 式の曲線の輪郭を、同じ式の面に載せた薄い板。
- 目 = 頭の面に沿う黒いレンズ(縁は面の 0.6 mm 上、まん中は 3.6 mm ふくらむ。裏は頭に埋める)と、大小 2 つの白い光。
  笑う目は、ふだん頭の中に隠した「∩」の帯をシェイプキー eye_smile で前へ出し、黒いレンズを奥へ隠す。
- 口 = 列 × 行の格子の小さな三日月。mouth_open・mouth_wide・mouth_o は、同じ格子を幅・高さ・口角の数字違いで作った点。
骨・モーフ・動きの名前は C と同じ。骨の位置も C と同じ(手をふるの肩のずらし等は rig_spec.json の motion.wave)。
2026-11-07 夜、本人が D を選んだ(「モデリングはもうこれで十分」)ので、characters/norrie の 3D はこの builder で作る(案 C の
norrie.py は前の版の記録)。選んだ後の小さな直し(N4): 横・見上げから目が見える(目の軸を外へ・顔の前の輪郭の殻を薄く)、
おじぎで足が体から離れない(体を低い点のまわりに傾ける motion.bow)・顔がきつくならない(頭の傾きを浅く)、
上げた腕の付け根が細く離れて見えない(腕を太く・肩の端を丸く・肩のずらしを小さく)。
使い方: blender -b -P norrie_d.py -- <出力.blend> work=<作業フォルダ> → b07_rig_groups.py(作業フォルダの rig_spec.json)
→ pk01_package.py --id norrie --name ノリー --height 1.0 --no-fur → model.glb と motions/ を characters/norrie へ
(character.json・persona.md・2d/ はそのまま)。
数字の試しは環境変数 ND_<名前>(例: ND_EYE_R=0.031)。既定の値だけで組むと、毎回同じ GLB になる。
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import m00_prims as P  # noqa: E402
import m04_round as RD  # noqa: E402

WORK = "."


def num(name, default):
    return float(os.environ.get("ND_" + name, default))


# ---------------- 色(元の絵の画素。案 C と同じ) ----------------
BROWN = (80, 64, 60)
CREAM = (240, 233, 222)
PINK = (228, 178, 188)
GREEN = (36, 152, 103)
WHITE = (252, 252, 252)
CORE = (52, 41, 40)          # 背中の芯(ほぼ黒の細い芯は「裂け目」に見えた)
INK = (8, 8, 8)
BLUSH = (244, 192, 198)
BASE_K, GLOW_K = 0.22, 0.92  # 地の色 = 絵の色 × 0.22、発光 = 絵の色 × 0.92(光の向きで灰色に沈まない)

# ---------------- 骨(案 C と同じ位置) ----------------
NECK = (0.0, -0.17, 0.5545)
BODY_AT = (0.0, 0.0, 0.3375)
ARM_AT = (0.112, -0.063, 0.525 + num("ARM_DZ", -0.018))   # 腕の骨(肩)。C より 1.8 cm 下: 大きな丸い頭のあごの下に、肩の上のすき間を作る
LEG_AT = (0.152, -0.06, 0.0844)
TOP_EAR = 0.9788              # 耳の先の高さ(殻なし)。C と同じ
# 耳を下げる量と、耳の輪郭の殻の厚み(N4)。スマホ 390 × 670 で 7 歩の札を開いた時、耳の先の輪郭が上の段に 1 px 近すぎた
# (すき間 40 px、決まり 40.2 px。C は 41 px)。耳の形と殻(11 mm)は同じまま、耳を 6 mm 下げる。
# 耳の殻を 8 mm に薄くすると、正面で耳の内の付け根と頭の間に背景の小さなすき間が囲まれ、check_all の ④(抜け)が落ちた
EAR_DROP = num("EAR_DROP", 0.006)
OL_EAR = num("OL_EAR", 0.011)

# ---------------- 頭(式の形)。C の頭を測った数字: 幅 ±0.229(z 0.71)、てっぺん 0.945、あご 0.553、鼻先 y −0.407 ----------------
HEAD_C = (0.0, -0.20, 0.74)   # 網を載せる光線の出どころ(頭の中)


def head_blobs():
    bl = [
        RD.blob((0.0, -0.182, num("CRANIUM_Z", 0.770)), (num("CRANIUM_RX", 0.196), num("CRANIUM_RY", 0.190), num("CRANIUM_RZ", 0.180)),
                n=num("CRANIUM_N", 2.4)),                                                   # 頭の丸(n が 2 より大きいと、てっぺんの角が広い)
        RD.blob((0.0, -0.205, num("JOWL_Z", 0.664)), (num("JOWL_RX", 0.214), num("JOWL_RY", 0.172), num("JOWL_RZ", 0.110)), k=num("JOWL_K", 0.07)),
        RD.blob((0.0, -0.105, 0.650), (0.150, 0.105, 0.095), k=0.06),                       # うなじ(首の後ろを丸く埋める)
    ]
    cb = num("CHEEK_BUMP", 1.0)
    if cb > 0:                                                                              # ほおのふくらみ(ほおの赤みの下)
        for sx in (1, -1):
            bl.append(RD.blob((sx * 0.088, num("CHEEK_Y", -0.312), 0.640), (0.060 * cb, 0.050 * cb, 0.046 * cb), k=0.04))
    # 鼻づら(口もとを前へ盛る)。頭の横の面より前へ出た分だけが横から見えるので、2D の横の絵のように「クリームの鼻づら」が
    # 横から読めるよう、頭の前の面から 2.7 cm 前まで出す(-0.345 → -0.372。正面の絵は光線で貼るので変わらない)
    bl.append(RD.blob((0.0, num("MUZZLE_Y", -0.372), num("MUZZLE_Z", 0.692)), (num("MUZZLE_RX", 0.100), num("MUZZLE_RY", 0.092), num("MUZZLE_RZ", 0.084)),
                      k=num("MUZZLE_K", 0.05)))
    return bl


# ---------------- 胴(式の形)。C の胴: 腰の幅 ±0.221(z 0.13)、胸 ±0.132(z 0.44)、前 y −0.214(z 0.45) ----------------
BODY_C = (0.0, -0.01, 0.26)


def torso_blobs():
    bl = [
        RD.blob((0.0, 0.015, 0.165), (0.218, 0.178, 0.168)),                                   # 腰とおなか
        RD.blob((0.0, -0.045, 0.392), (0.140, 0.168, 0.190), k=0.10),                         # 胸(前へ少し出る)
        RD.blob((0.0, 0.010, 0.515), (0.115, 0.090, 0.075), k=0.07),                          # 首の後ろ(背中の帯がなだらかに通る)
    ]
    sh = num("SHOULDER_BLOB", 1.15)
    if sh > 0:                                                                                    # 丸い肩(頭の下の横のくぼみを埋める)
        for sx in (1, -1):
            bl.append(RD.blob((sx * num("SHOULDER_X", 0.118), -0.050, num("SHOULDER_Z", 0.505)), (0.070 * sh, 0.080 * sh, 0.065 * sh), k=0.05))
    wa = num("WAIST_BLOB", 1.2)
    if wa > 0:                                                                                    # 腰の上(おなかの横)を少し広く
        bl.append(RD.blob((0.0, -0.010, num("WAIST_Z", 0.300)), (num("WAIST_RX", 0.185), 0.170, 0.140 * wa), k=0.08))
    return bl


# ---------------- 顔の模様(正面の x, z。C の組み立てを測った数字) ----------------
EYE_X, EYE_Z = num("EYE_X", 0.056), num("EYE_Z", 0.807)   # N4: 0.052 → 0.056(軸を外へ寄せた分、少し外へ)
EYE_R = (num("EYE_RX", 0.0280), num("EYE_RZ", 0.0310))    # 正面から見た目の半径(横, 縦)。絵の 1.6 倍級
EYE_RIM, EYE_BULGE, EYE_BACK = 0.0006, num("EYE_BULGE", 0.0060), 0.010   # N4: ふくらみ 3.6 → 6 mm(横の輪郭で目が読める。6 mm を超えると斜めでとげになる)
EYE_TOWARD_FRONT = 0.20       # 目の軸 = 面の向き + 正面 × 0.2(ほぼ面の向き。どの向きからも丸い)
# 目の軸を外(横)へ寄せる量。丸い頭では目の所の面がほぼ正面を向くので、横から目が見えなかった(N4 の直し)。
# 軸を外へ寄せると、目の輪郭は頭の丸みに沿って横へ回りこみ、横からも黒い目と光が見える(正面の形は少し横長になる)
EYE_OUT = num("EYE_OUT", 0.65)
CATCH = [(-0.36, 0.40, 0.33), (0.36, -0.38, 0.15)]   # 目の光(横, 縦, 半径。目の半径に対して)。見る人の左上に大、右下に小(2D と同じ)
SMILE_ARC = [(-0.92, -0.10), (-0.55, 0.36), (0.0, 0.56), (0.55, 0.36), (0.92, -0.10)]   # 笑う目「∩」の線(目の半径に対して)
SMILE_HALF = 0.115            # 笑う目の線の半分の太さ(目の半径に対して。約 7 mm の帯)
BLINK_LINE, BLINK_KEEP = -0.12, 0.10    # まばたき: 目を縦に 0.10 倍、この高さの線へ寄せる

MASK_TIP = 0.801
MASK_RIGHT = [(0.000, 0.801), (0.012, 0.792), (0.030, 0.778), (0.051, 0.762), (0.071, 0.742), (0.087, 0.722), (0.101, 0.702),
              (0.111, 0.682), (0.116, 0.660), (0.118, 0.635), (0.116, 0.610), (0.108, 0.588), (0.090, 0.571), (0.060, 0.561),
              (0.030, 0.557), (0.000, 0.556)]
NOSE_C, NOSE_R = (0.0, 0.707), (0.053, 0.064)
CHEEK_C, CHEEK_R = (0.076, 0.624), (0.024, 0.016)
MOUTH_TOP = 0.690
# 口(ふだん)= 小さな三日月: 上の縁は笑いの線(両端が curl だけ上がる)、下の縁は上の縁から depth の U、端はとがる。
# 2D の口を測った数字(幅 77 px・口角が真ん中より 9 px 上・真ん中の高さ 30 px、S = 1040)を頭の 1.12 倍にした大きさ。
MOUTH = dict(hw=num("MOUTH_HW", 0.040), depth=num("MOUTH_DEPTH", 0.022), curl=num("MOUTH_CURL", 0.011), p=num("MOUTH_P", 1.7),
             v=num("MOUTH_V", 0.9))
# 口のシェイプキー = 同じ格子の数字違い(ふだんに掛ける倍率。v は値そのもの)
MOUTH_KEYS = {"mouth_open": dict(hw=1.0, depth=2.0, curl=0.7), "mouth_wide": dict(hw=1.25, depth=1.2, curl=1.3),
              "mouth_o": dict(hw=0.55, depth=1.7, curl=-0.45, v=0.55)}
MOUTH_COLS, MOUTH_ROWS, MOUTH_CORNER = 28, 6, 0.0007   # 口の端の厚み(面積 0 の面を作らない)
TOOTH_HW, TOOTH_TOP, TOOTH_BOT = 0.0085, 0.6905, 0.6755
NOSE_ARC = [(-0.027, 0.756), (-0.015, 0.744), (0.0, 0.739), (0.015, 0.744), (0.027, 0.756)]
PHILTRUM = [(0.0, 0.740), (0.0, 0.716), (0.0, 0.692)]
LIFT = dict(mask_line=0.0008, mask=0.0022, nose=0.0036, cheek=0.0036, mouth=0.0050, nose_line=0.0050, tooth=0.0064)

# ---------------- おなか(正面の x, z)。C: 首の下で細く、z 0.40 で ±0.12、z 0.16 より下は胴の幅いっぱい ----------------
BELLY_RIGHT = [(0.000, 0.497), (0.022, 0.493), (0.060, 0.482), (0.090, 0.462), (0.110, 0.435), (0.120, 0.400), (0.124, 0.350),
               (0.125, 0.290), (0.127, 0.245), (0.150, 0.210), (0.185, 0.180), (0.205, 0.140), (0.210, 0.090), (0.196, 0.050),
               (0.160, 0.024), (0.090, 0.012), (0.000, 0.010)]

# ---------------- 背中の帯(後ろから見た x, z) ----------------
STRIPE_Z = (0.880, 0.160)
STRIPE_HALF, CORE_HALF = num("STRIPE_HALF", 0.036), num("CORE_HALF", 0.0140)   # 芯は帯の 0.4 倍ほど(太い芯は白い縁どりの「すき間」に見えた)
CORE_Z = (0.850, 0.200)
NAPE_Z = 0.600                # 帯の重みを頭と胴で混ぜる高さ(上下 3.5 cm)

# ---------------- 耳・腕・手袋・足・しっぽ・蝶ネクタイ ----------------
EAR = dict(x=num("EAR_X", 0.128), y=-0.080, r1=num("EAR_R1", 0.068), r2=num("EAR_R2", 0.018), length=num("EAR_L", 0.082), tilt=num("EAR_TILT", 20.0),
           back=7.0, flat=num("EAR_FLAT", 0.45))   # 根元の広い三角の耳(絵の耳の内の縁が頭のてっぺんへ斜めに下りる)
ARM = [ARM_AT, (0.148, -0.090, 0.478 + num("ARM_DZ", -0.018) * 0.5), (0.168, -0.118, 0.438), (0.156, -0.170, 0.366), (0.118, -0.222, 0.318)]
# 腕の太さ。上げた腕が細く体から離れて見えた(N4)ので、付け根から先まで ARM_K 倍に太くする
ARM_K = num("ARM_K", 1.12)
ARM_R = [num("SHOULDER_R", 0.060) * ARM_K, 0.050 * ARM_K, 0.042 * ARM_K, 0.038 * ARM_K, 0.034 * ARM_K]
SHOULDER_CAP = num("SHOULDER_CAP", 0.40)   # 肩の端の半球を腕の向きに平たく(頭の下に入らない)。大きいほど丸い(上げた時に付け根が角ばらない)
HAND_C = (0.0885, -0.2447, 0.3024)
HAND_DIR = (-0.772, -0.497, -0.395)
HAND_R = (0.034, 0.029, 0.058)
FOOT_C, FOOT_R = (0.152, -0.120, 0.034), (0.080, 0.088, 0.036)
TAIL = [(0.0, 0.10, 0.085), (0.07, 0.19, 0.102), (0.14, 0.25, 0.13), (0.19, 0.30, 0.18), (0.237, 0.333, 0.246),
        (0.272, 0.355, 0.304), (0.300, 0.369, 0.362), (0.319, 0.376, 0.419), (0.326, 0.374, 0.477), (0.324, 0.366, 0.535),
        (0.309, 0.346, 0.592), (0.291, 0.320, 0.640), (0.272, 0.296, 0.682), (0.257, 0.278, 0.700)]
TAIL_R = [0.027, 0.027, 0.026, 0.025, 0.0235, 0.0225, 0.022, 0.0215, 0.021, 0.0205, 0.020, 0.0195, 0.0185, 0.0165]
BOW_Z = 0.512
OL_HEAD, OL_BODY, OL_SMALL = 0.011, 0.0095, 0.004     # 輪郭の殻の厚み(C と同じ)
# 顔の前(鼻づら・ほお・目のあたり)の頭の殻の厚みの倍率。横から見ると、ほおの前の輪郭の線(11 mm)が白い顔に太く食い込み、
# 目も黒い縁に飲まれた(N4)。正面から見た頭の輪郭(横の端)とあごの線は 11 mm のまま
OL_FACE = num("OL_FACE", 0.45)
WAVE = {"style": "high", "out": num("WAVE_OUT", 135.0), "fwd": num("WAVE_FWD", -15.0), "swing": 16.0, "hz": 1.7,
        "other_out": num("WAVE_OTHER", 16.0), "head_tilt": num("WAVE_TILT", 4.0),
        "shift": [num("WAVE_SX", -0.06), num("WAVE_SY", 0.02), num("WAVE_SZ", -0.07)]}   # N4: 肩は外へ 10 → 6 cm、下へ 2 → 7 cm(上げた腕があごの下を通り、付け根が体に付いたまま)
# おじぎ(b04_motions の motion.bow)。体を腰の骨のまわりに 30° 傾けると、胴の下が後ろ上へ逃げて、白い足が体から離れて浮いた。
# 体は足の上の低い点(pivot)のまわりに傾け、根の沈みはなし。頭の足し分を浅くして、上から見た目がつり目に見えないように(N4)
BOW = {"body": num("BOW_BODY", 22.0), "head": num("BOW_HEAD", 4.0), "drop": num("BOW_DROP", 0.0),
       "pivot": [0.0, num("BOW_PY", -0.08), num("BOW_PZ", 0.05)]}
BOW_PIVOT = num("BOW_PIVOT", 1.0)   # 1 で motion.bow を書く(0 は前の b04 のおじぎ: 体 30°・頭 14°・骨のまわり・2 cm 沈む)


# ---------------- 材質 ----------------
def flat(name, rgb, base=BASE_K, glow=GLOW_K):
    m = P.material(name, rgb, rough=1.0, spec=0.0)
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    lin = [P._lin(c) for c in rgb]
    b.inputs["Base Color"].default_value = (lin[0] * base, lin[1] * base, lin[2] * base, 1.0)
    b.inputs["Emission Color"].default_value = (lin[0], lin[1], lin[2], 1.0)
    b.inputs["Emission Strength"].default_value = glow
    return m


# ---------------- 部品をまとめる(シェイプキーの点の順をそろえるため、自分で 1 つの網にする) ----------------
def combine(name, parts, mats):
    """parts = [(点, 面, 材質の番号)] → 1 つの物。点の順は parts の順のまま。"""
    verts, faces, idx = [], [], []
    for pts, fs, mi in parts:
        base = len(verts)
        verts += [tuple(float(x) for x in p) for p in pts]
        for f in fs:
            faces.append(tuple(base + v for v in f))
            idx.append(mi)
    ob = RD.make(name, verts, faces, mats[0])
    for m in mats[1:]:
        ob.data.materials.append(m)
    for p, mi in zip(ob.data.polygons, idx):
        p.material_index = mi
    return ob


# ---------------- 目 ----------------
def eye_frame(sign, hb):
    """目の面の点と枠。U = 横(見る人の右が +)、V = 上、a = 目の軸(外向き)。"""
    x = sign * EYE_X
    hit, ok = RD.ray_hits(np.array([[x, -0.8, EYE_Z]]), (0.0, 1.0, 0.0), hb, 1.2)
    s = hit[0]
    n = RD.normals(hit, hb)[0]
    a = n + np.array([0.0, -1.0, 0.0]) * EYE_TOWARD_FRONT + np.array([float(sign), 0.0, 0.0]) * EYE_OUT
    a /= np.linalg.norm(a)
    U = np.cross(np.array([0.0, 0.0, 1.0]), a)
    U /= np.linalg.norm(U)
    V = np.cross(a, U)
    # 正面から丸く見えるよう、面の傾きの分だけ広げる(横は 1/cos(横の向き)、縦は 1/cos(上下の向き))
    yaw = math.atan2(abs(a[0]), -a[1])
    pitch = math.asin(min(abs(a[2]), 0.99))
    ru, rv = EYE_R[0] / math.cos(yaw), EYE_R[1] / math.cos(pitch)
    return s, a, U, V, ru, rv


def dome_lift(s):
    return EYE_RIM + EYE_BULGE * math.sqrt(max(1.0 - s * s, 0.0))


def eye_parts(sign, hb, K=40, rings=7):
    """片目の部品: レンズ(表と裏)・光 2 つ・笑う目の帯。各部品の (ふだんの点, まばたきの点, 笑顔の点, 面, 材質)。"""
    s0, a, U, V, ru, rv = eye_frame(sign, hb)
    frame = (s0, U, V, -a)
    ell = RD.curve_outline(lambda t: (ru * math.cos(2 * math.pi * t), rv * math.sin(2 * math.pi * t)), K)
    back = lambda s: EYE_RIM - EYE_BACK * math.sqrt(max(1.0 - s * s, 0.0))  # noqa: E731
    lens0 = RD.keyed_points(ell, (0.0, 0.0), rings, frame, hb, dome_lift, back=back, ease=0.85)
    yl = BLINK_LINE * rv

    def blink_warp(p2, ss):
        q = p2.copy()
        q[:, 1] = yl + (q[:, 1] - yl) * BLINK_KEEP
        return q

    lens_blink = RD.keyed_points(ell, (0.0, 0.0), rings, frame, hb, dome_lift, back=back, warp=blink_warp, ease=0.85)
    lens_smile = lens0 - a * 0.025
    faces = RD.disc_topology(rings, K)
    rim0 = 1 + (rings - 1) * K
    faces = faces + [tuple((v if v >= rim0 else len(lens0) - rim0 + v) for v in f[::-1]) for f in RD.disc_topology(rings, K)]
    # 表が外を向くように
    fn = np.cross(lens0[faces[K][1]] - lens0[faces[K][0]], lens0[faces[K][2]] - lens0[faces[K][0]])
    if np.dot(fn, a) < 0:
        faces = [tuple(f[::-1]) for f in faces]
    out = [(lens0, lens_blink, lens_smile, faces, 0)]
    # 光(面のレンズの上 0.7 mm)。まばたき・笑顔では奥へ隠す
    for cu, cv, cr in CATCH:
        k2 = 18
        c2 = np.array([cu * ru, cv * rv])
        bd = RD.curve_outline(lambda t: (c2[0] + cr * ru * math.cos(2 * math.pi * t), c2[1] + cr * ru * math.sin(2 * math.pi * t)), k2)
        p2, _ = RD.disc_uv(bd, c2, 3)
        se = np.sqrt((p2[:, 0] / ru) ** 2 + (p2[:, 1] / rv) ** 2)
        pts, _, _ = RD.place_on(p2, se, frame, hb, lambda s: dome_lift(min(s, 1.0)) + 0.0007)
        f2 = RD.disc_topology(3, k2)
        fn = np.cross(pts[f2[k2][1]] - pts[f2[k2][0]], pts[f2[k2][2]] - pts[f2[k2][0]])
        if np.dot(fn, a) < 0:
            f2 = [tuple(f[::-1]) for f in f2]
        cen = pts.mean(0)
        hide = cen + (pts - cen) * 0.2 - a * 0.008
        # まばたき: 光は、縦に寄せた目の上の 1 点へ縮む(悲しい顔 = まばたき 0.3 でも、小さな光が目の上に残る)
        cb = np.array([[c2[0], yl + (c2[1] - yl) * BLINK_KEEP]])
        sc = math.sqrt(cu * cu + cv * cv)
        pc, _, _ = RD.place_on(cb, np.array([sc]), frame, hb, lambda s: dome_lift(min(s, 1.0)) + 0.0007)
        shrink = np.repeat(pc, len(pts), 0)
        out.append((pts, shrink, hide, f2, 1))
    # 笑う目の帯「∩」: ふだんは 12 mm 奥(頭の中)、笑顔で面の上 3.4 mm
    arc2 = [(u * ru, v * rv) for u, v in SMILE_ARC]
    p2, m = RD.stroke_uv(arc2, SMILE_HALF * (ru + rv) / 2, per=6, tip=0.55)
    vis, nor, _ = RD.place_on(p2, np.zeros(len(p2)), frame, hb, lambda s: 0.0034)
    hid = vis - a * 0.012
    f3 = RD.stroke_faces(m)
    fn = np.cross(vis[f3[m // 2][1]] - vis[f3[m // 2][0]], vis[f3[m // 2][2]] - vis[f3[m // 2][0]])
    if np.dot(fn, a) < 0:
        f3 = [tuple(f[::-1]) for f in f3]
    out.append((hid, hid, vis, f3, 0))
    return out, s0, a


def build_eyes(hb, mats):
    parts, centers = [], {}
    for sign, bone in ((1, "eye_L"), (-1, "eye_R")):
        ps, s0, a = eye_parts(sign, hb)
        parts += ps
        centers[bone] = s0 + a * (EYE_RIM + EYE_BULGE * 0.5)
    ob = combine("Eyes", [(p[0], p[3], p[4]) for p in parts], [mats["ink"], mats["catch"]])
    RD.add_key(ob, "eye_blink", np.concatenate([p[1] for p in parts]))
    RD.add_key(ob, "eye_smile", np.concatenate([p[2] for p in parts]))
    return ob, centers


# ---------------- 口と前歯 ----------------
def mouth_grid(hw, depth, curl, p, v):
    """口の 2D の点(列ごとに上の縁 → 下の縁)。列の数・行の数はいつも同じなので、数字違いの格子がそのままシェイプキーになる。"""
    pts = []
    for i in range(MOUTH_COLS + 1):
        u = -1.0 + 2.0 * i / MOUTH_COLS
        top = MOUTH_TOP + curl * abs(u) ** p
        h = depth * max(1.0 - u * u, 0.0) ** v + MOUTH_CORNER
        for j in range(MOUTH_ROWS + 1):
            pts.append((hw * u, top - h * j / MOUTH_ROWS))
    return np.array(pts)


def grid_faces(cols, rows):
    out = []
    for i in range(cols):
        for j in range(rows):
            a = i * (rows + 1) + j
            out.append((a, a + rows + 1, a + rows + 2, a + 1))
    return out


def build_mouth(hb, mats):
    front = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0))
    lift = lambda s: LIFT["mouth"]  # noqa: E731

    def placed(scale):
        prm = {k: MOUTH[k] * scale.get(k, 1.0) for k in ("hw", "depth", "curl")}
        prm["p"] = MOUTH["p"]
        prm["v"] = scale.get("v", MOUTH["v"])
        p2 = mouth_grid(**prm)
        pts, nor, miss = RD.place_on(p2, np.zeros(len(p2)), front, hb, lift)
        return pts, nor, miss

    pts, nor, miss = placed({})
    faces = grid_faces(MOUTH_COLS, MOUTH_ROWS)
    f0 = faces[len(faces) // 2]
    fn = np.cross(pts[f0[1]] - pts[f0[0]], pts[f0[2]] - pts[f0[0]])
    if np.dot(fn, nor[f0[0]]) < 0:
        faces = [tuple(f[::-1]) for f in faces]
    ob = RD.make("Mouth", pts, faces, mats["mouth"])
    ob["miss"] = miss
    for name, scale in MOUTH_KEYS.items():
        RD.add_key(ob, name, placed(scale)[0])
    # 前歯(1 本の白い角丸。上の唇に付いたまま)
    tb = []
    for i in range(28):
        t = 2 * math.pi * i / 28
        cx, cz = math.cos(t), math.sin(t)
        x = TOOTH_HW * math.copysign(abs(cx) ** 0.45, cx)
        z = (TOOTH_TOP + TOOTH_BOT) / 2 + (TOOTH_TOP - TOOTH_BOT) / 2 * math.copysign(abs(cz) ** 0.45, cz)
        tb.append((x, z))
    tooth = RD.plate("Tooth", np.array(tb), (0.0, (TOOTH_TOP + TOOTH_BOT) / 2), 3, front, hb, lambda s: LIFT["tooth"], mats["tooth"])
    return ob, tooth


# ---------------- 正面の板(仮面・鼻・ほお・おなか) ----------------
FRONT = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0))


def mirror_outline(right, per=3):
    """右半分(上 → 下)の点を、なめらかにして左右の閉じた輪郭にする(上の点から時計回り)。"""
    r = RD.catmull(right, per)
    left = r[::-1][1:-1].copy()
    left[:, 0] *= -1
    return np.concatenate([r, left], 0)


def face_plates(hb, mats):
    out = {}
    mask_b = mirror_outline(MASK_RIGHT)
    mcen = (0.0, 0.660)
    # 輪は縁の近くに寄せて多めに(7 輪では、ほおのふくらみの上で板の三角形が面の下にもぐり、黒い点が 2 つ透けた)
    out["mask_line"] = RD.plate("mask_line", RD.grow2d(mask_b, 0.0040), mcen, 11, FRONT, hb, lambda s: LIFT["mask_line"], mats["ink"], ease=0.7)
    out["mask"] = RD.plate("mask", mask_b, mcen, 11, FRONT, hb, lambda s: LIFT["mask"], mats["cream"], ease=0.7)
    nb = RD.curve_outline(lambda t: (NOSE_C[0] + NOSE_R[0] * math.cos(2 * math.pi * t), NOSE_C[1] + NOSE_R[1] * math.sin(2 * math.pi * t)), 48)
    out["nose"] = RD.plate("nose", nb, NOSE_C, 7, FRONT, hb, lambda s: LIFT["nose"], mats["pink"])
    for sign, nm in ((1, "cheek_L"), (-1, "cheek_R")):
        c = (sign * CHEEK_C[0], CHEEK_C[1])
        cb = RD.curve_outline(lambda t: (c[0] + CHEEK_R[0] * math.cos(2 * math.pi * t), c[1] + CHEEK_R[1] * math.sin(2 * math.pi * t)), 32)
        out[nm] = RD.plate(nm, cb, c, 4, FRONT, hb, lambda s: LIFT["cheek"], mats["blush"])
    arc = RD.stroke("nose_arc", NOSE_ARC, 0.0036, FRONT, hb, LIFT["nose_line"], mats["ink"])
    phil = RD.stroke("philtrum", PHILTRUM, 0.0030, FRONT, hb, LIFT["nose_line"], mats["ink"])
    out["nose_line"] = P.join([arc, phil], "nose_line")
    return out


def torso_halfwidth(tb, z):
    """胴のその高さの左右の半幅(光線を横から当てて測る)。"""
    hit, ok = RD.ray_hits(np.array([[0.6, 0.0, z]]), (-1.0, 0.0, 0.0), tb, 0.6)
    return float(hit[0][0]) if ok[0] else 0.0


def belly_plates(tb, mats):
    right = []
    for x, z in BELLY_RIGHT:
        hw = torso_halfwidth(tb, max(z, 0.02))
        right.append((min(x, hw - 0.006) if x > 0 else x, z))
    bb = mirror_outline(right)
    cen = (0.0, 0.200)
    # 黒い縁は、胴の下の丸く奥へ回りこむ所(z 0.10 より下)で細らせて 0 にする。下の縁を浅い角度で見ると、
    # 縁の板と白い板が細かく食い違って、ぎざぎざの黒い点に見えた(下は足と胴の輪郭の殻が縁になる)
    g = np.array([0.0045 * min(max((z - 0.05) / 0.05, 0.0), 1.0) for z in bb[:, 1]])
    grown = bb + (RD.grow2d(bb, 1.0) - bb) * g[:, None]
    # 輪は縁の近くに寄せて多めに(胴の下の曲がりの強い所で、板の三角形が面の下にもぐって茶色が透けないように)
    line = RD.plate("belly_line", grown, cen, 14, FRONT, tb, lambda s: 0.0010, mats["ink"], ease=0.7)
    belly = RD.plate("belly", bb, cen, 14, FRONT, tb, lambda s: 0.0026, mats["cream"], ease=0.7)
    return belly, line


# ---------------- 背中の帯(後ろから光線) ----------------
def band_lens(t):
    """白い帯の幅の割合(長さの上の位置 t ∈ [0, 1])。長さのほとんどは同じ幅、両端の 16% で 0.45 まで細り、先の 3% を丸める。"""
    e = min(t, 1.0 - t)
    k = min(e / 0.16, 1.0)
    w = 0.45 + 0.55 * k * k * (3.0 - 2.0 * k)
    c = min(e / 0.03, 1.0)
    return w * math.sqrt(max(1.0 - (1.0 - c) ** 2, 0.0))


def core_lens(t):
    """芯の幅の割合: まん中はほぼ同じ太さ、端だけ丸く 0 へ((1 − |2t − 1|⁴)^0.5)。"""
    return math.sqrt(max(1.0 - abs(2.0 * t - 1.0) ** 4, 0.0))


def band_grid(half, z0, z1, cols, rows, both, lift, lens=band_lens):
    """後ろの面に沿う長い丸い帯の点と面。both = 頭と胴の式。幅は half × lens(t)。"""
    pts2, ss = [], []
    for r in range(rows + 1):
        t = r / rows
        z = z0 + (z1 - z0) * t
        w = max(half * lens(t), 0.0008)
        for c in range(cols + 1):
            u = -1.0 + 2.0 * c / cols
            pts2.append((u * w, z))
            ss.append(0.0)
    pts2 = np.array(pts2)
    back = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, -1.0, 0.0))    # 後ろ(+Y)から前(−Y)へ光線
    pts, nor, miss = RD.place_on(pts2, np.array(ss), back, both, lambda s: lift)
    faces = []
    for r in range(rows):
        for c in range(cols):
            a = r * (cols + 1) + c
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    v = np.asarray(pts)
    f0 = faces[len(faces) // 2]
    fn = np.cross(v[f0[1]] - v[f0[0]], v[f0[2]] - v[f0[0]])
    if np.dot(fn, nor[f0[0]]) < 0:
        faces = [tuple(f[::-1]) for f in faces]
    return pts, faces, miss


def build_stripe(both, mats):
    p1, f1, m1 = band_grid(STRIPE_HALF, STRIPE_Z[0], STRIPE_Z[1], 8, 120, both, 0.0016, lens=band_lens)
    p2, f2, m2 = band_grid(CORE_HALF, CORE_Z[0], CORE_Z[1], 6, 110, both, 0.0026, lens=core_lens)
    st = combine("stripe", [(p1, f1, 0), (p2, f2, 1)], [mats["cream"], mats["core"]])
    gh = st.vertex_groups.new(name="head")
    gb = st.vertex_groups.new(name="body")
    for v in st.data.vertices:
        t = min(max((v.co.z - (NAPE_Z - 0.035)) / 0.07, 0.0), 1.0)
        t = t * t * (3 - 2 * t)
        if t > 0.0:
            gh.add([v.index], t, "REPLACE")
        if t < 1.0:
            gb.add([v.index], 1.0 - t, "REPLACE")
    return st, m1 + m2


# ---------------- 頭の輪郭の殻(顔の前だけ薄く) ----------------
def head_shell(hb, ol):
    """RD.implicit_shell と同じ網(20 × 20 の格子)で、厚みだけを場所で変える。顔の前(y が −0.26 より前、z 0.60 より上)で
    OL_HEAD × OL_FACE まで、なめらかに薄くする。横の端・後ろ・あごの下は OL_HEAD のまま。"""
    dirs, faces = RD.quad_sphere(20)
    pts, _ = RD.radial_surface(HEAD_C, dirs, hb, 0.5)
    nor = RD.normals(pts, hb)
    f = np.clip((-pts[:, 1] - 0.26) / 0.07, 0.0, 1.0) * np.clip((pts[:, 2] - 0.60) / 0.05, 0.0, 1.0)
    f = f * f * (3.0 - 2.0 * f)
    th = OL_HEAD * (1.0 - (1.0 - OL_FACE) * f)
    ob = RD.make("ol_head", pts + nor * th[:, None], [fc[::-1] for fc in faces], ol)
    ob["surface_only"] = True
    return ob


# ---------------- 耳 ----------------
def build_ear(sign, mats):
    e = EAR
    tilt, back = math.radians(e["tilt"]), math.radians(e["back"])
    axis = np.array([sign * math.sin(tilt), math.sin(back), math.cos(tilt) * math.cos(back)])
    axis /= np.linalg.norm(axis)
    prof = RD.round_cone_profile(e["r1"], e["r2"], e["length"], n=24)
    top_h = prof[-1][1]
    base_z = TOP_EAR - EAR_DROP - axis[2] * top_h
    origin = (sign * e["x"], e["y"], base_z)
    return RD.spin("ear_%s" % ("L" if sign > 0 else "R"), prof, origin, axis, (1.0, 0.0, 0.0), n=22, flat=e["flat"], mat=mats["brown"])


# ---------------- 腕・手袋 ----------------
def build_arm(sign, mats):
    pts = [(sign * x, y, z) for x, y, z in ARM]
    sleeve = RD.sweep("sleeve", pts, ARM_R, n=18, per=4, mat=mats["brown"], cap_depth=(SHOULDER_CAP, 1.0))
    hd = Vector((sign * HAND_DIR[0], HAND_DIR[1], HAND_DIR[2])).normalized()
    eul = hd.to_track_quat("Z", "Y").to_euler()
    hand = P.superquadric("mitt", HAND_R, (0.85, 1.0), (sign * HAND_C[0], HAND_C[1], HAND_C[2]), mat=mats["white"], seg=(22, 14),
                          rot_deg=tuple(math.degrees(a) for a in eul))
    arm = P.join([sleeve, hand], "arm_%s_part" % ("L" if sign > 0 else "R"))
    return arm


# ---------------- 蝶ネクタイ ----------------
def build_bow(tb, mats):
    hit, ok = RD.ray_hits(np.array([[0.0, -0.8, BOW_Z]]), (0.0, 1.0, 0.0), tb, 1.0)
    yb = float(hit[0][1]) - 0.004
    wings = []
    for sign in (1, -1):
        # 根元が細く外が広い、角の丸いくさび(超楕円体を横に寝かせて、外へ向けて広げる)
        w = P.superquadric("bowwing", (0.025, 0.011, 0.028), (0.55, 0.75), (sign * 0.040, yb - 0.004, BOW_Z), mat=mats["green"], seg=(24, 14),
                           rot_deg=(0.0, sign * 90.0, 0.0), taper=(0.45, 1.0))
        wings.append(w)
    bow = P.join(wings, "BowWings")
    knot = P.superquadric("BowKnot", (0.0120, 0.0125, 0.0210), (1.0, 1.0), (0.0, yb - 0.007, BOW_Z), mat=mats["green"], seg=(20, 12))
    return bow, knot


# ---------------- 全体 ----------------
def main():
    global WORK
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0]
    for kv in argv[1:]:
        k, v = kv.split("=", 1)
        if k == "work":
            WORK = v
    RD.clear_scene()
    os.makedirs(WORK, exist_ok=True)
    mats = dict(brown=flat("Brown", BROWN), cream=flat("Cream", CREAM), pink=flat("Pink", PINK), green=flat("Green", GREEN),
                white=flat("Glove", WHITE), core=flat("Stripe", CORE), ink=flat("Ink", INK), mouth=flat("MouthIn", INK),
                blush=flat("Blush", BLUSH), catch=flat("CatchWhite", WHITE, base=0.0, glow=1.0), tooth=flat("ToothWhite", WHITE, base=0.0, glow=1.0))
    ol = P.material("Outline", (0, 0, 0), rough=1.0, spec=0.0)
    ol.use_backface_culling = True
    hb, tb = head_blobs(), torso_blobs()
    report = {}

    # 頭(式の網)+ 耳
    head, bad = RD.implicit_part("head_core", hb, HEAD_C, int(num("HEAD_N", 28)), 0.5, mats["brown"])
    report["head_reenter"] = bad
    ears = [build_ear(s, mats) for s in (1, -1)]
    head_ol = head_shell(hb, ol) if OL_FACE != 1.0 else RD.implicit_shell("ol_head", hb, HEAD_C, 20, 0.5, OL_HEAD, ol)
    shells = [head_ol] + [RD.offset_shell(e, OL_EAR, ol) for e in ears]
    head_all = P.join([head] + ears, "Head")
    RD.group(head_all, "head")
    ol_head = P.join(shells, "ol_Head")
    ol_head["surface_only"] = True
    RD.group(ol_head, "head")

    # 顔
    eyes, eye_ctr = build_eyes(hb, mats)
    RD.group(eyes, "head")
    mouth, tooth = build_mouth(hb, mats)
    face = face_plates(hb, mats)
    for o in [mouth, tooth] + list(face.values()):
        RD.group(o, "head")
    for nm in ("mask", "mask_line", "cheek_L", "cheek_R"):
        face[nm]["surface_only"] = True

    # 胴・おなか
    torso, bad2 = RD.implicit_part("torso", tb, BODY_C, int(num("BODY_N", 22)), 0.5, mats["brown"])
    report["torso_reenter"] = bad2
    RD.group(torso, "body")
    ol_torso = RD.implicit_shell("ol_torso", tb, BODY_C, 16, 0.5, OL_BODY, ol)
    RD.group(ol_torso, "body")
    belly, belly_line = belly_plates(tb, mats)
    for o in (belly, belly_line):
        RD.group(o, "body")
        o["surface_only"] = True

    # 背中の帯(頭と胴の両方の面に沿う)
    both = lambda p: RD.smin(RD.sdf(p, hb), RD.sdf(p, tb), 0.03)  # noqa: E731  頭と胴の面(首だけ少しなだらかに)
    stripe, miss = build_stripe(both, mats)
    report["stripe_miss"] = miss

    # 足・しっぽ・腕・蝶ネクタイ
    for sign, nm in ((1, "leg_L"), (-1, "leg_R")):
        foot = P.superquadric(nm + "_foot", FOOT_R, (1.0, 1.0), (sign * FOOT_C[0], FOOT_C[1], FOOT_C[2]), mat=mats["cream"], seg=(24, 14))
        RD.group(foot, nm)
        RD.group(RD.offset_shell(foot, OL_BODY, ol), nm)
    tail = RD.sweep("tail", TAIL, TAIL_R, n=16, per=3, mat=mats["cream"])
    RD.group(tail, "body")
    RD.group(RD.offset_shell(tail, OL_BODY, ol), "body")
    for sign, nm in ((1, "arm_L"), (-1, "arm_R")):
        arm = build_arm(sign, mats)
        RD.group(arm, nm)
        RD.group(RD.offset_shell(arm, OL_BODY, ol), nm)
    bow, knot = build_bow(tb, mats)
    RD.group(bow, "body")
    RD.group(knot, "body")
    RD.group(RD.offset_shell(bow, OL_SMALL, ol), "body")

    # 骨の spec(C と同じ骨の位置。目の骨は目の中心)
    def r4(p):
        return [round(float(p[0]), 4), round(float(p[1]), 4), round(float(p[2]), 4)]
    rig = {"root": [0, 0, 0], "body": list(BODY_AT), "head": list(NECK), "arm_L": list(ARM_AT), "arm_R": [-ARM_AT[0], ARM_AT[1], ARM_AT[2]],
           "leg_L": list(LEG_AT), "leg_R": [-LEG_AT[0], LEG_AT[1], LEG_AT[2]], "eye_L": r4(eye_ctr["eye_L"]), "eye_R": r4(eye_ctr["eye_R"])}
    parent = dict(root=None, body="root", head="body", arm_L="body", arm_R="body", leg_L="root", leg_R="root", eye_L="head", eye_R="head")
    spec = {"id": "norrie", "height_m": 1.0, "bones": [{"name": k, "at": rig[k], "parent": parent[k]} for k in parent],
            "roles": {k: k for k in ("root", "body", "head", "arm_L", "arm_R", "leg_L", "leg_R")},
            "motion": {"only": ["idle", "talk", "nod", "bow", "wave"], "arm_amp": 0.45, "wave": dict(WAVE)}}
    if BOW_PIVOT > 0:
        spec["motion"]["bow"] = dict(BOW)
    json.dump(spec, open(os.path.join(WORK, "rig_spec.json"), "w"), indent=1)
    tri = {o.name: RD.tris(o) for o in bpy.context.scene.objects if o.type == "MESH"}
    report["tris"] = sum(tri.values())
    report["top"] = sorted(tri.items(), key=lambda kv: -kv[1])[:8]
    report["miss"] = {o.name: o.get("miss") for o in bpy.context.scene.objects if o.get("miss")}
    json.dump(report, open(os.path.join(WORK, "build_report.json"), "w"), ensure_ascii=False, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print("BUILD norrie_d ok", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
