"""model.glb の法線の強さ(normalTexture.scale)を gain 倍に書き換えた写しを作る。組み直さずに、凹凸の強さだけを試すための道具。
使い方: python glb_normal_gain.py <入力 pack のフォルダ> <出力 pack のフォルダ> <gain>"""
import json
import os
import shutil
import struct
import sys


def main():
    src, dst, gain = sys.argv[1], sys.argv[2], float(sys.argv[3])
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    path = os.path.join(dst, "model.glb")
    d = open(path, "rb").read()
    n = struct.unpack("<I", d[12:16])[0]
    g = json.loads(d[20:20 + n])
    cnt = 0
    for m in g.get("materials", []):
        nt = m.get("normalTexture")
        if nt is not None:
            nt["scale"] = nt.get("scale", 1.0) * gain
            cnt += 1
    j = json.dumps(g, separators=(",", ":")).encode("utf-8")
    j += b" " * (-len(j) % 4)
    rest = d[20 + n:]
    out = d[:8] + struct.pack("<I", 12 + 8 + len(j) + len(rest)) + struct.pack("<I", len(j)) + d[16:20] + j + rest
    open(path, "wb").write(out)
    print("法線つきの材質", cnt, "個を", gain, "倍にした:", dst)


if __name__ == "__main__":
    main()
