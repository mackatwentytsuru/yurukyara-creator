"""wave.glb の root / body の回転を、指定時刻(秒)で線形に読む(クォータニオンは slerp 近似でなく最近 2 点の nlerp)。
使い方: python -I read_rot.py <glb> <秒> [<秒>...]"""
import json
import math
import struct
import sys

import numpy as np

path, *ts = sys.argv[1:]
data = open(path, "rb").read()
jl = struct.unpack("<I", data[12:16])[0]
doc = json.loads(data[20:20 + jl])
off = 20 + jl
binlen = struct.unpack("<I", data[off:off + 4])[0]
blob = data[off + 8:off + 8 + binlen]


def acc(i):
    a = doc["accessors"][i]
    bv = doc["bufferViews"][a["bufferView"]]
    n = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]
    s = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(blob, dtype="<f4", count=a["count"] * n, offset=s).reshape(a["count"], n)


def euler_yxz(q):
    x, y, z, w = q
    m = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    ex = math.asin(-max(-1, min(1, m[1, 2])))
    ey = math.atan2(m[0, 2], m[2, 2])
    ez = math.atan2(m[1, 0], m[1, 1])
    return [round(math.degrees(v), 1) for v in (ex, ey, ez)]


anim = doc["animations"][0]
for ch in anim["channels"]:
    node = doc["nodes"][ch["target"]["node"]]
    if ch["target"]["path"] != "rotation":
        continue
    smp = anim["samplers"][ch["sampler"]]
    t, q = acc(smp["input"]), acc(smp["output"])
    for s in ts:
        s = float(s)
        k = int(np.searchsorted(t[:, 0], s))
        k = min(max(k, 1), len(t) - 1)
        u = (s - t[k - 1, 0]) / max(1e-9, t[k, 0] - t[k - 1, 0])
        qq = q[k - 1] * (1 - u) + q[k] * u
        qq = qq / np.linalg.norm(qq)
        print(node["name"], f"t={s}", "xyz(deg)=", euler_yxz(qq))
