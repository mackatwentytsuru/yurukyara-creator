"""venue.py の確かめ。手で解ける形(真正面の座席・真ん中の演者)の答えと合うかを見る。

  python place/venue/venue_selftest.py
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import venue as V  # noqa: E402

fails = []


def check(name, ok, detail=""):
    print(("合格 " if ok else "不合格 ") + name + (" " + detail if detail else ""))
    if not ok:
        fails.append(name)


# 1) 真正面(x=0, y=1000, 目の高さ 120)・演者 (0, 200)・半径 30・高さ 160(舞台の上 z 90〜250)
eye = (0, 1000, 120)
perf = [{"x": 0, "y": 200, "radius": 30, "height": 160}]
pv, det = V.view(eye, perf, step_px=4)
b = pv["LED_B_L"], pv["LED_B_R"]
# 影の幅: 円柱の接線は半径 r の円に引くので、幅は 2r を (目→LED)/(目→円柱の中心) 倍に近い
d_led = 1000 - (-140)
d_cyl = 1000 - 200
exp_w_cm = 2 * 30 * d_led / math.sqrt(d_cyl ** 2 - 30 ** 2) * 0.999
rngs = [v["performer_range_px"] for v in b if v["performer_range_px"]]
# B は 2 枚(左右)に分かれ、絵の x は 957〜3345 の 704 cm 分
px_per_cm = (V.L.B_PX_X1 - V.L.B_PX_X0) / (2 * V.L.B_X_HALF)
x_lo = min(r["x"][0] for r in rngs)
x_hi = max(r["x"][1] for r in rngs)
w_cm = (x_hi - x_lo) / px_per_cm
check("影の幅(B 面)", abs(w_cm - exp_w_cm) / exp_w_cm < 0.06, f"計算 {w_cm:.1f} cm / 手計算 {exp_w_cm:.1f} cm")
center_px = (V.L.B_PX_X0 + V.L.B_PX_X1) / 2
check("影の中心は B 面の真ん中", abs((x_lo + x_hi) / 2 - center_px) < 12, f"{(x_lo + x_hi) / 2:.0f} / {center_px:.0f}")
# 影の高さ: 目の高さ 120 から円柱の上 250 を通る線が LED(y=-140)に届く高さ
top_z = 120 + (250 - 120) * d_led / d_cyl
# 絵の y と z の関係(B の縦は絵の 85〜1218 を 98〜594 cm に割り当て)
y_hi = min(r["y"][0] for r in rngs)
z_of = lambda py: V.L.LED_Z_TOP - (py - V.L.B_PX_Y0) / (V.L.B_PX_Y1 - V.L.B_PX_Y0) * (V.L.LED_Z_TOP - V.L.LED_Z_BOTTOM)
check("影の上の高さ", abs(z_of(y_hi) - top_z) < 6, f"計算 {z_of(y_hi):.0f} cm / 手計算 {top_z:.0f} cm")
# 2) 演者がいなければ演者に隠れる所は 0
pv0, _ = V.view(eye, [], step_px=8)
check("演者なしなら 0", all(v["hidden_by_performer"] == 0 for v in pv0.values()))
# 3) 真正面の目は、B 面の正面 cos≈1、A・C は斜め
check("B 面の cos(目から面の端までで 0.95〜1)", 0.95 < pv0["LED_B_L"]["mean_cos"] <= 1.0, str(pv0["LED_B_L"]["mean_cos"]))
# 4) 低い目(舞台より低い z=60)は、舞台の前の縁で LED の下が隠れる(sim_layout の計算と同じ向き)
low = (0, 730, 60)
pvl, _ = V.view(low, [], step_px=4)
hidden_cm_calc = None
try:
    sys.path.insert(0, str(V.REPO / "show" / "ue"))
    import sim_layout as S  # noqa: E402
    hidden_cm_calc = S.hidden_led_bottom_cm({"pos": low})
except Exception as e:  # sim_layout が読めない環境
    print("sim_layout を読めない:", e)
if hidden_cm_calc is not None:
    # 板の下端 98 cm(舞台の床からは +8 cm)。隠れる割合 ≈ (hidden_z - 98) / 496 + 舞台高さの差を考える
    z_hidden_top = V.L.STAGE_Z + hidden_cm_calc
    frac = max(0.0, (z_hidden_top - V.L.LED_Z_BOTTOM) / (V.L.LED_Z_TOP - V.L.LED_Z_BOTTOM))
    got = pvl["LED_B_L"]["hidden_by_stage"]
    check("舞台の縁に隠れる割合(sim_layout の計算と)", abs(got - frac) < 0.03, f"計算 {got:.3f} / sim_layout {frac:.3f}")
# 5) 板の裏側(LED の後ろに回った目)は見えない
back_eye = (0, -600, 120)
pvb, _ = V.view(back_eye, [], step_px=16)
check("裏から見ると見えない", pvb["LED_B_L"]["backside"] > 0.99)
print("全部合格" if not fails else "不合格: " + ", ".join(fails))
sys.exit(1 if fails else 0)
