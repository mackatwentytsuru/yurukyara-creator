"""段 5: メッシュ(UV つき OBJ)に、自分の絵だけから色を塗る(AI なし・nvdiffrast なし)。

使い方: python p05_paint.py <メッシュ.obj> <views.json> <出力.png> [--size 2048]

views.json: { "views": [ {"name":"front","image":"…png","dir":"front"}, … ] }
  dir は front / back / left / right。画像は「背景が白、キャラは中央、顔なし」の正射影に近い絵。
  メッシュは Z が上、キャラの正面が -Y、キャラの左が +X(Blender の向き)。

やること
 1. 各視点で、メッシュの輪郭の外接箱と絵の輪郭の外接箱を合わせる(拡大率と位置を決める)。
 2. 各視点の深度を自前のラスタライザで作り、見えている面だけを使う。
 3. UV の各テクセルの 3D 位置と法線を求め、法線と視線の内積の 2 乗で視点を混ぜる。
 4. どの視点からも見えないテクセルは、近くの塗れた色で埋める。
"""
import argparse
import json
import os

import cv2
import numpy as np
import trimesh
from PIL import Image

# 視点ごとの (画面の右向き, 視線の向き)。Z が上。
VIEW_AXES = {
    "front": (np.array([1.0, 0, 0]), np.array([0, 1.0, 0])),
    "back": (np.array([-1.0, 0, 0]), np.array([0, -1.0, 0])),
    "left": (np.array([0, 1.0, 0]), np.array([-1.0, 0, 0])),
    "right": (np.array([0, -1.0, 0]), np.array([1.0, 0, 0])),
}
UP = np.array([0, 0, 1.0])


def raster_uv(uv, w):
    """UV 三角形を w×w に塗り、各テクセルの (三角形番号, 重心座標) を返す。"""
    T = len(uv)
    tid = -np.ones((w, w), np.int32)
    bary = np.zeros((w, w, 3), np.float32)
    px = uv.copy()
    px[..., 0] = px[..., 0] * w - 0.5
    px[..., 1] = (1.0 - px[..., 1]) * w - 0.5
    for t in range(T):
        p = px[t]
        x0 = max(int(np.floor(p[:, 0].min())), 0)
        x1 = min(int(np.ceil(p[:, 0].max())), w - 1)
        y0 = max(int(np.floor(p[:, 1].min())), 0)
        y1 = min(int(np.ceil(p[:, 1].max())), w - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        d = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
        if abs(d) < 1e-12:
            continue
        l0 = ((p[1, 1] - p[2, 1]) * (xs - p[2, 0]) + (p[2, 0] - p[1, 0]) * (ys - p[2, 1])) / d
        l1 = ((p[2, 1] - p[0, 1]) * (xs - p[2, 0]) + (p[0, 0] - p[2, 0]) * (ys - p[2, 1])) / d
        l2 = 1 - l0 - l1
        inside = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
        if not inside.any():
            continue
        yy, xx = ys[inside], xs[inside]
        tid[yy, xx] = t
        bary[yy, xx, 0], bary[yy, xx, 1], bary[yy, xx, 2] = l0[inside], l1[inside], l2[inside]
    return tid, bary


def push_pull(img, valid):
    """valid(真)の画素の色で、それ以外を埋める。"""
    f = img.astype(np.float32) * valid[..., None]
    w = valid.astype(np.float32)
    levels = [(f, w)]
    while min(levels[-1][0].shape[:2]) > 4:
        cf, cw = levels[-1]
        h2, w2 = cf.shape[0] // 2, cf.shape[1] // 2
        nf = cf[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2, 3).sum(axis=(1, 3))
        nw = cw[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2).sum(axis=(1, 3))
        levels.append((nf, nw))
    cf, cw = levels[-1]
    col = cf / np.maximum(cw[..., None], 1e-6)
    for lf, lw in reversed(levels[:-1]):
        up = cv2.resize(col, (lf.shape[1], lf.shape[0]), interpolation=cv2.INTER_LINEAR)
        own = lf / np.maximum(lw[..., None], 1e-6)
        col = np.where((lw > 0.5)[..., None], own, up)
    return np.clip(col, 0, 255).astype(np.uint8)


def depth_buffer(verts, faces, right, d, scale, offs, w, h):
    """正射影の深度バッファ(視線方向の距離。小さいほど手前)。"""
    u = verts @ right
    v = verts @ UP
    z = verts @ d
    sx = u * scale + offs[0]
    sy = h - 1 - (v * scale + offs[1])
    zbuf = np.full((h, w), np.inf, np.float32)
    P = np.stack([sx, sy], axis=1)[faces]  # (T,3,2)
    Z = z[faces]
    for t in range(len(faces)):
        p = P[t]
        x0 = max(int(np.floor(p[:, 0].min())), 0)
        x1 = min(int(np.ceil(p[:, 0].max())), w - 1)
        y0 = max(int(np.floor(p[:, 1].min())), 0)
        y1 = min(int(np.ceil(p[:, 1].max())), h - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        dd = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
        if abs(dd) < 1e-9:
            continue
        l0 = ((p[1, 1] - p[2, 1]) * (xs - p[2, 0]) + (p[2, 0] - p[1, 0]) * (ys - p[2, 1])) / dd
        l1 = ((p[2, 1] - p[0, 1]) * (xs - p[2, 0]) + (p[0, 0] - p[2, 0]) * (ys - p[2, 1])) / dd
        l2 = 1 - l0 - l1
        ins = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
        if not ins.any():
            continue
        zz = l0 * Z[t, 0] + l1 * Z[t, 1] + l2 * Z[t, 2]
        sub = zbuf[y0:y1 + 1, x0:x1 + 1]
        sub[ins] = np.minimum(sub[ins], zz[ins])
    return zbuf


def fit_view(verts, right, img_alpha):
    """メッシュの輪郭の外接箱を絵の輪郭の外接箱に合わせる。(scale, offs, 情報) を返す。"""
    h, w = img_alpha.shape
    ys, xs = np.where(img_alpha > 128)
    ix0, ix1, iy0, iy1 = xs.min(), xs.max(), ys.min(), ys.max()
    u = verts @ right
    v = verts @ UP
    mu0, mu1, mv0, mv1 = u.min(), u.max(), v.min(), v.max()
    sx = (ix1 - ix0) / max(mu1 - mu0, 1e-9)
    sy = (iy1 - iy0) / max(mv1 - mv0, 1e-9)
    scale = 0.5 * (sx + sy)
    # 画素 x = u*scale + offs0、画素 y(下から) = v*scale + offs1
    cx_img = 0.5 * (ix0 + ix1)
    cy_img_from_bottom = (h - 1) - 0.5 * (iy0 + iy1)
    offs = np.array([cx_img - 0.5 * (mu0 + mu1) * scale, cy_img_from_bottom - 0.5 * (mv0 + mv1) * scale])
    return scale, offs, {"scale_x": float(sx), "scale_y": float(sy), "ratio": float(sx / sy)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mesh")
    ap.add_argument("views")
    ap.add_argument("out")
    ap.add_argument("--size", type=int, default=2048)
    ap.add_argument("--power", type=float, default=2.5)
    ap.add_argument("--smooth", type=float, default=0.0, help="塗った色をぼかす幅(画素)。大きいほど、絵の光や影の筋が消えて無地に近づく")
    a = ap.parse_args()
    m = trimesh.load(a.mesh, process=False, maintain_order=True, force="mesh")
    verts = np.asarray(m.vertices, np.float64)
    faces = np.asarray(m.faces, np.int64)
    uv = np.asarray(m.visual.uv, np.float64)
    print("verts", len(verts), "faces", len(faces), "uv", len(uv))
    cfg = json.load(open(a.views, encoding="utf-8"))
    W = a.size
    tid, bary = raster_uv(uv[faces], W)
    ok = tid >= 0
    t_ok = tid[ok]
    b_ok = bary[ok]
    P = (verts[faces[t_ok]] * b_ok[..., None]).sum(axis=1)
    fn = m.face_normals[t_ok]
    # 頂点法線で滑らかに(境界で段が出ないように)
    vn = np.asarray(m.vertex_normals, np.float64)
    N = (vn[faces[t_ok]] * b_ok[..., None]).sum(axis=1)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    acc = np.zeros((len(P), 3))
    wsum = np.zeros(len(P))
    info = {}
    for vcfg in cfg["views"]:
        name, d_key = vcfg["name"], vcfg["dir"]
        right, d = VIEW_AXES[d_key]
        img = Image.open(vcfg["image"]).convert("RGB")
        arr = np.array(img).astype(np.float32)
        h, w = arr.shape[:2]
        from p01_prep import soft_alpha  # 同じフォルダ
        alpha = soft_alpha(arr.astype(np.uint8))
        if vcfg.get("flip"):
            arr = arr[:, ::-1].copy()
            alpha = alpha[:, ::-1].copy()
        scale, offs, finfo = fit_view(verts, right, alpha)
        zbuf = depth_buffer(verts, faces, right, d, scale, offs, w, h)
        er = cv2.erode((alpha > 200).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
        u = P @ right
        v = P @ UP
        sx = u * scale + offs[0]
        sy = h - 1 - (v * scale + offs[1])
        ix = np.clip(np.round(sx).astype(int), 0, w - 1)
        iy = np.clip(np.round(sy).astype(int), 0, h - 1)
        z = P @ d
        vis = (z <= zbuf[iy, ix] + vcfg.get("depth_eps", 0.012) * np.ptp(verts @ d)) & er[iy, ix]
        facing = np.clip(-(N @ d), 0, 1)
        wgt = (facing ** a.power) * vis * vcfg.get("weight", 1.0)
        # 双一次補間
        x0 = np.clip(np.floor(sx).astype(int), 0, w - 2)
        y0 = np.clip(np.floor(sy).astype(int), 0, h - 2)
        fx = (sx - x0)[:, None]
        fy = (sy - y0)[:, None]
        col = (arr[y0, x0] * (1 - fx) * (1 - fy) + arr[y0, x0 + 1] * fx * (1 - fy)
               + arr[y0 + 1, x0] * (1 - fx) * fy + arr[y0 + 1, x0 + 1] * fx * fy)
        acc += col * wgt[:, None]
        wsum += wgt
        info[name] = {**finfo, "scale": float(scale), "visible_texel_ratio": float((wgt > 0.05).mean())}
        print(name, info[name], flush=True)
    tex = np.zeros((W, W, 3), np.float32)
    painted = np.zeros((W, W), bool)
    good = wsum > 1e-3
    colr = np.where(good[:, None], acc / np.maximum(wsum[:, None], 1e-9), 0)
    tex[ok] = colr
    painted[ok] = good
    print("painted texel ratio of UV area:", float(good.mean()))
    tex8 = np.clip(tex, 0, 255).astype(np.uint8)
    hole = (ok & ~painted) | (~ok)
    # 穴埋め: 塗れた色を縮小して平均し、広げて穴に当てる(筋の出ない押し引き。Telea は細長い筋が出る)
    filled = push_pull(tex8, ~hole)
    if a.smooth > 0:
        filled = cv2.GaussianBlur(filled, (0, 0), a.smooth)
    Image.fromarray(filled).save(a.out)
    json.dump({"views": info, "painted_ratio": float(good.mean())},
              open(os.path.splitext(a.out)[0] + "_paint.json", "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
