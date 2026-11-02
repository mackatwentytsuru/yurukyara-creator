"""段 8: 人型でないキャラの動きを、式で作る(Blender で焼いて GLB にする)。

b03_rig.py から呼ばれ、build_all(spec) が { 名前: {duration, loop, fn(t) -> 骨ごとの姿勢} } を返す。
姿勢は { 骨の名前: {"rot": (x, y, z)度, "loc": (x, y, z)m, "scale": (x, y, z)} }。
回転は世界の軸まわり。キャラは -Y を向き、+Z が上。
  x まわり 正 = 前におじぎ  /  y まわり 正 = 上の端が +X(キャラの左)へ傾く  /  z まわり 正 = 左(+X 側)を向く
腕は下へ垂れている形が基本。腕を横に上げるのは y まわり(左腕 = 負、右腕 = 正)、前に上げるのは x まわりの負。
spec["roles"] に無い役割(足や腕のないキャラ)は、その動きを飛ばす。
"""
import math


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def tri(t, a, b, c, d):
    """a で上がり始め b で 1、c まで 1、d で 0 に戻る台形。"""
    if t <= a or t >= d:
        return 0.0
    if t < b:
        return smooth((t - a) / (b - a))
    if t <= c:
        return 1.0
    return 1 - smooth((t - c) / (d - c))


def squash(a):
    """a > 0 で縦に伸び(体積はほぼ保つ)、a < 0 でつぶれる。"""
    return (1 - a * 0.5, 1 - a * 0.5, 1 + a)


def build_all(spec):
    R = spec["roles"]
    H = spec["height_m"]
    M = spec.get("motion", {})
    amp = M.get("arm_amp", 1.0)

    def pose(**kw):
        out = {}
        for role, p in kw.items():
            if role in R:
                out[R[role]] = p
        return out

    def arm(side, out_deg=0.0, fwd_deg=0.0):
        """side=+1 左腕(+X)、-1 右腕(-X)。out は外へ上げる角度、fwd は前へ上げる角度。"""
        return {"rot": (-fwd_deg * amp, -side * out_deg * amp, 0.0)}

    def two(left, right, **extra):
        d = {}
        if "arm_L" in R:
            d["arm_L"] = left
        if "arm_R" in R:
            d["arm_R"] = right
        d.update(extra)
        return d

    def idle(t):
        w = 2 * math.pi * t / 3.0
        a = 0.018 * math.sin(w)
        return pose(body={"rot": (0.0, 1.5 * math.sin(w / 2 * 2 / 2), 0.0), "scale": squash(a)},
                    **two(arm(1, 4 + 2.5 * math.sin(w)), arm(-1, 4 + 2.5 * math.sin(w + 1.0))),
                    flap_L={"rot": (0, -3 * math.sin(w + 0.5), 0)}, flap_R={"rot": (0, 3 * math.sin(w + 0.5), 0)},
                    lid={"rot": (0, 1.5 * math.sin(w), 0)})

    def talk(t):
        w = 2 * math.pi * t / 1.2
        hop = abs(math.sin(w))
        a = -0.04 * (1 - hop) + 0.02 * hop
        return pose(root={"loc": (0, 0, 0.012 * H * hop)},
                    body={"rot": (2.5 * math.sin(w), 2.0 * math.sin(w / 2), 0.0), "scale": squash(a)},
                    **two(arm(1, 14 + 12 * max(0, math.sin(w)), 8 * max(0, math.sin(w))),
                          arm(-1, 14 + 12 * max(0, -math.sin(w)), 8 * max(0, -math.sin(w)))),
                    flap_L={"rot": (0, -10 - 8 * math.sin(w), 0)}, flap_R={"rot": (0, 10 + 8 * math.sin(w), 0)},
                    lid={"rot": (2 * math.sin(w), 0, 0)})

    def wave(t):
        up = tri(t, 0.0, 0.45, 1.95, 2.4)
        osc = math.sin(2 * math.pi * 2.6 * max(0.0, t - 0.45)) * 16 * up
        return pose(body={"rot": (0.0, -3.0 * up, 0.0), "scale": squash(0.01 * up)},
                    **two(arm(1, 5), arm(-1, 115 * up + 5 * (1 - up), 0) if True else {}),
                    flap_R={"rot": (0, 35 * up + osc * 0.8, 0)}, flap_L={"rot": (0, -5, 0)})

    def wave_fix(t):
        p = wave(t)
        up = tri(t, 0.0, 0.45, 1.95, 2.4)
        osc = math.sin(2 * math.pi * 2.6 * max(0.0, t - 0.45)) * 16 * up
        if "arm_R" in R:
            p[R["arm_R"]] = {"rot": (0.0, (145 + osc) * up * amp + 5, 0.0)}
        return p

    def nod(t):
        a = tri(t, 0.0, 0.2, 0.25, 0.45) * 13 + tri(t, 0.45, 0.65, 0.7, 0.95) * 9
        return pose(body={"rot": (a, 0, 0), "scale": squash(-0.01 * a / 13)},
                    lid={"rot": (a * 0.5, 0, 0)})

    def bow(t):
        a = tri(t, 0.0, 0.7, 1.1, 1.8)
        return pose(root={"loc": (0, 0, -0.02 * H * a)},
                    body={"rot": (30 * a, 0, 0), "scale": squash(-0.03 * a)},
                    **two(arm(1, 6 - 4 * a, -10 * a), arm(-1, 6 - 4 * a, -10 * a)),
                    flap_L={"rot": (0, -8 * a, 0)}, flap_R={"rot": (0, 8 * a, 0)})

    def jump(t):
        crouch = tri(t, 0.0, 0.2, 0.22, 0.34)
        air = tri(t, 0.34, 0.5, 0.58, 0.8)
        land = tri(t, 0.78, 0.86, 0.88, 1.05)
        z = 0.32 * H * math.sin(math.pi * smooth((t - 0.34) / 0.46)) if 0.34 <= t <= 0.8 else 0.0
        a = -0.12 * crouch + 0.09 * air - 0.10 * land
        return pose(root={"loc": (0, 0, z)},
                    body={"rot": (-4 * air + 6 * crouch, 0, 0), "scale": squash(a)},
                    **two(arm(1, 20 + 85 * air - 10 * crouch), arm(-1, 20 + 85 * air - 10 * crouch)),
                    leg_L={"rot": (0, 0, 0), "scale": squash(a * 0.6)}, leg_R={"rot": (0, 0, 0), "scale": squash(a * 0.6)},
                    flap_L={"rot": (0, -45 * air - 8, 0)}, flap_R={"rot": (0, 45 * air + 8, 0)},
                    lid={"rot": (0, 0, 0), "scale": squash(a * 0.5)})

    def think(t):
        w = 2 * math.pi * t / 4.0
        return pose(body={"rot": (-3 + 1.5 * math.sin(w), 9 + 2 * math.sin(w), 4 * math.sin(w / 2)),
                          "scale": squash(0.012 * math.sin(w))},
                    **two(arm(1, 6), {"rot": (-70.0 * amp, -(-25.0) * amp + 0.0, 0.0)}),
                    flap_R={"rot": (-25, 20, 0)}, flap_L={"rot": (0, -6, 0)},
                    lid={"rot": (0, 8, 0)})

    def sad(t):
        w = 2 * math.pi * t / 4.0
        return pose(body={"rot": (7 + 1.0 * math.sin(w), 0, 0), "scale": squash(-0.055 + 0.01 * math.sin(w))},
                    **two(arm(1, -2, 6), arm(-1, -2, 6)),
                    flap_L={"rot": (0, 8, 0)}, flap_R={"rot": (0, -8, 0)},
                    lid={"rot": (6, 0, 0)})

    return {
        "idle": {"duration": 3.0, "loop": True, "fn": idle},
        "talk": {"duration": 1.2, "loop": True, "fn": talk},
        "wave": {"duration": 2.4, "loop": False, "fn": wave_fix},
        "nod": {"duration": 0.95, "loop": False, "fn": nod},
        "bow": {"duration": 1.8, "loop": False, "fn": bow},
        "jump": {"duration": 1.05, "loop": False, "fn": jump},
        "think": {"duration": 4.0, "loop": True, "fn": think},
        "sad": {"duration": 4.0, "loop": True, "fn": sad},
    }
