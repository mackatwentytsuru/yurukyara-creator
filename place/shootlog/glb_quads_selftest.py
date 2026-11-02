"""glb_quads の自己テスト。`python glb_quads_selftest.py [出力GLBのパス]` で「合格」が出れば OK。"""
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from glb_quads import read_back_check, write_textured_quads_glb  # noqa: E402


def encode_png(rgb: np.ndarray) -> bytes:
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def make_quads():
    colors = [(220, 60, 60), (60, 200, 80), (60, 90, 220), (230, 200, 40)]
    quads = []
    for i, col in enumerate(colors):
        img = np.zeros((16 + 4 * i, 24, 3), np.uint8)
        img[:] = col
        img[:4, :4] = (255, 255, 255)  # 左上に白い印(向きの確認用)
        x = i * 2.0
        corners = [[x, 0, 0], [x + 1.5, 0, 0], [x + 1.5, 2, 0], [x, 2, 0]]
        quads.append({"name": f"wall{i}", "corners": corners, "png": encode_png(img)})
    return quads


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp()) / "quads.glb"
    write_textured_quads_glb(out, make_quads())
    r = read_back_check(out)
    assert r["ok"], r["problems"]
    assert (r["nodes"], r["meshes"], r["images"], r["triangles"]) == (4, 4, 4, 8), r
    assert r["names"] == [f"wall{i}" for i in range(4)], r
    print(f"合格: {out} nodes={r['nodes']} meshes={r['meshes']} images={r['images']} triangles={r['triangles']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
