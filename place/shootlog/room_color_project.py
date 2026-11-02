"""撮影記録の動画(iPhone の映像 + ARKit の姿勢)から、場所スキャン(RoomPlan)の部屋の壁・床に写真の色を貼る(3 段階の 1 段目)。

  python place/shootlog/room_color_project.py <撮影フォルダ> --room <room.json> --out <出力フォルダ>
      (--led-from window:0 | --room-from-world <json>) [--texels-per-m 100] [--stride 8]

位置合わせ: 撮影のはじめに、部屋の窓(またはドア・テレビ)の 4 隅に十字を合わせて記録しておく(撮影記録の「LED 1面」の校正。
  overlay_room.py と同じ)。それで ARKit の世界 → RoomPlan の座標がわかる。--room-from-world は、その 4x4 を直接渡す版(試験用)。
やること: 壁と床の面ごとに、1 テクセルの 3D 位置を出し、映像のコマに投影して色を取る。
  コマごとの重み = cos(見る角度)² / 距離² × 画面の端で下げる、を 3 乗して足し合わせる(いちばん良く見えたコマが効く)。
  カメラと面の間に家具の箱(room.json の objects)があるテクセルは、そのコマでは使わない。
  どのコマからも見えなかった所は、近くの色で埋める。
出力: <面の名前>.png、report.json(面ごとの見えた割合・使ったコマ数)、coverage.png、(glb_quads.py があれば)room_photo.glb。
限界(正直に): 露出の違いは直していない / ARKit のずれ(ドリフト)でにじむ / 家具の箱の外にある物(棚の上の物など)は壁に写り込む / 天井は RoomPlan に無いので貼らない。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from shootlib import apply, invert_rigid, load_shoot, mat4

ARKIT_FROM_CV = np.diag([1.0, -1.0, -1.0, 1.0])


def sample_bilinear(img: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """点の列(u, v)の位置の色を取る。cv2.remap は地図の幅・高さが 32767 まで → 512 列の 2 次元にして渡す。"""
    n = len(u)
    cols = 512
    rows = (n + cols - 1) // cols
    pad = rows * cols - n
    uu = np.concatenate([u, np.zeros(pad)]).astype(np.float32).reshape(rows, cols)
    vv = np.concatenate([v, np.zeros(pad)]).astype(np.float32).reshape(rows, cols)
    out = cv2.remap(img, uu, vv, cv2.INTER_LINEAR)
    return out.reshape(-1, img.shape[2] if img.ndim == 3 else 1)[:n]


def surfaces_from_room(room: dict):
    out = []
    for key, kind in (("walls", "wall"), ("floors", "floor")):
        for i, el in enumerate(room.get(key, [])):
            out.append({"name": f"{kind}_{i}", "kind": kind, "M": mat4(el["transform"]), "w": float(el["dimensions"][0]), "h": float(el["dimensions"][1])})
    return out


def interior_normal(s: dict, floor_centre: np.ndarray) -> np.ndarray:
    n = s["M"][:3, 2] / np.linalg.norm(s["M"][:3, 2])
    if s["kind"] == "floor":
        return np.array([0.0, 1.0, 0.0])
    to_in = floor_centre - s["M"][:3, 3]
    to_in[1] = 0
    return -n if np.dot(n, to_in) < 0 else n


def texel_grid(s: dict, tpm: float):
    W = int(np.clip(round(s["w"] * tpm), 8, 2048))
    H = int(np.clip(round(s["h"] * tpm), 8, 2048))
    cols = (np.arange(W) + 0.5) / W
    rows = (np.arange(H) + 0.5) / H
    x = -s["w"] / 2 + cols * s["w"]        # 左 → 右
    y = s["h"] / 2 - rows * s["h"]         # 上 → 下
    X, Y = np.meshgrid(x, y)
    P_local = np.stack([X, Y, np.zeros_like(X)], axis=-1).reshape(-1, 3)
    P = apply(s["M"], P_local).reshape(H, W, 3)
    return P, (W, H)


def quad_corners(s: dict) -> np.ndarray:
    w, h = s["w"], s["h"]
    local = np.array([[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]])
    return apply(s["M"], local)


def occluded(C: np.ndarray, P: np.ndarray, boxes, shrink=-0.03) -> np.ndarray:
    """カメラ C から各点 P への線分が、箱(家具)に当たるか。shrink が負なら箱を大きめに見る(RoomPlan の箱は実物と数 cm ずれるので、縁の色が混ざらないよう余裕を持つ)。"""
    hit = np.zeros(len(P), bool)
    for M, dims in boxes:
        R, c = M[:3, :3], M[:3, 3]
        half = np.maximum(np.asarray(dims, float) / 2 - shrink, 1e-3)
        o = R.T @ (C - c)
        d = (R.T @ (P - C).T).T
        with np.errstate(divide="ignore", invalid="ignore"):
            t1 = (-half - o) / d
            t2 = (half - o) / d
        tmin = np.nanmax(np.minimum(t1, t2), axis=1)
        tmax = np.nanmin(np.maximum(t1, t2), axis=1)
        # d が 0 の軸は、o が箱の中にあるときだけ通る
        zero = np.abs(d) < 1e-12
        inside = np.abs(o) <= half
        bad = np.any(zero & ~inside, axis=1)
        hit |= (~bad) & (tmax > np.maximum(tmin, 1e-3)) & (tmin < 0.999)
    return hit


def project_colors(shoot, room, T_room_from_world, out: Path, tpm=100.0, stride=8, power=3.0, max_frames=60, min_sharp=15.0, log=print):
    surfaces = surfaces_from_room(room)
    floor_c = mat4(room["floors"][0]["transform"])[:3, 3]
    boxes = [(mat4(o["transform"]), o["dimensions"]) for o in room.get("objects", [])]
    grids = []
    for s in surfaces:
        P, (W, H) = texel_grid(s, tpm)
        n = interior_normal(s, floor_c)
        grids.append({"P": P.reshape(-1, 3), "W": W, "H": H, "n": n, "acc": np.zeros((H * W, 3), np.float32), "wsum": np.zeros(H * W, np.float32),
                      "frames": 0, "occl": 0})

    idx = [i for i in range(0, len(shoot.frames), stride) if shoot.frames[i]["ok"]]
    if len(idx) > max_frames:
        idx = [idx[j] for j in np.linspace(0, len(idx) - 1, max_frames).astype(int)]
    want = set(idx)
    cap = cv2.VideoCapture(str(shoot.video))
    used = 0
    i = 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if i in want:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            sharp = cv2.Laplacian(cv2.resize(gray, (gray.shape[1] // 2, gray.shape[0] // 2)), cv2.CV_64F).var()
            if sharp >= min_sharp:
                fr = shoot.frames[i]
                T_cam_ark = T_room_from_world @ mat4(fr["T"])        # カメラ(ARKit 流)→ 部屋
                C = T_cam_ark[:3, 3]
                Tcv = invert_rigid(T_cam_ark @ ARKIT_FROM_CV)         # 部屋 → カメラ(OpenCV 流)
                fx, fy, cx, cy = fr["K"]
                h_img, w_img = img.shape[:2]
                for g in grids:
                    P = g["P"]
                    cam = (Tcv[:3, :3] @ P.T).T + Tcv[:3, 3]
                    z = cam[:, 2]
                    with np.errstate(divide="ignore", invalid="ignore"):
                        u = cx + fx * cam[:, 0] / z
                        v = cy + fy * cam[:, 1] / z
                    to_cam = C - P
                    dist = np.linalg.norm(to_cam, axis=1)
                    cosv = (to_cam @ g["n"]) / np.maximum(dist, 1e-6)
                    margin = np.minimum.reduce([u, v, w_img - 1 - u, h_img - 1 - v])
                    valid = (z > 0.2) & (cosv > 0.25) & (margin > 2)
                    if not valid.any():
                        continue
                    occ = np.zeros(len(P), bool)
                    sel = np.where(valid)[0]
                    occ[sel] = occluded(C, P[sel], boxes)
                    valid &= ~occ
                    g["occl"] += int(occ.sum())
                    sel = np.where(valid)[0]
                    if len(sel) == 0:
                        continue
                    edge = np.clip(margin[sel] / 60.0, 0.05, 1.0)
                    w = (cosv[sel] ** 2) / (dist[sel] ** 2) * edge
                    w = w ** power
                    col = sample_bilinear(img, u[sel], v[sel]).astype(np.float32)
                    g["acc"][sel] += col * w[:, None]
                    g["wsum"][sel] += w
                    g["frames"] += 1
                used += 1
        i += 1
    cap.release()
    log(f"使ったコマ {used}")

    out.mkdir(parents=True, exist_ok=True)
    report = {"frames_used": used, "surfaces": []}
    for s, g in zip(surfaces, grids):
        W, H = g["W"], g["H"]
        seen = g["wsum"] > 0
        img = np.zeros((H * W, 3), np.float32)
        img[seen] = g["acc"][seen] / g["wsum"][seen][:, None]
        tex = np.clip(img.reshape(H, W, 3), 0, 255).astype(np.uint8)
        mask = (~seen).reshape(H, W).astype(np.uint8) * 255
        if seen.any() and (~seen).any():
            tex = cv2.inpaint(tex, mask, 5, cv2.INPAINT_TELEA)
        elif not seen.any():
            tex[:] = 128
        data = cv2.imencode(".png", tex)[1]
        (out / f"{s['name']}_seen.png").write_bytes(cv2.imencode(".png", (seen.reshape(H, W).astype(np.uint8) * 255))[1].tobytes())
        (out / f"{s['name']}.png").write_bytes(data.tobytes())
        report["surfaces"].append({"name": s["name"], "texels": [W, H], "seen_percent": round(float(seen.mean() * 100), 1),
                                   "frames_contributing": g["frames"], "occluded_texel_views": g["occl"]})
        s["tex_png"] = data.tobytes()
    (out / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return surfaces, report


def write_glb(surfaces, path):
    try:
        from glb_quads import write_textured_quads_glb
    except ImportError:
        return False
    quads = [{"name": s["name"], "corners": quad_corners(s).tolist(), "png": s["tex_png"], "double_sided": True} for s in surfaces]
    write_textured_quads_glb(str(path), quads)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("shoot_dir")
    ap.add_argument("--room", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--led-from", default=None)
    ap.add_argument("--room-from-world", default=None)
    ap.add_argument("--place-dir", default=None, help="places/<id>。room_photo.glb を置き、place.json の variants に photo を足す(?variant=photo で見られる)")
    ap.add_argument("--texels-per-m", type=float, default=100.0)
    ap.add_argument("--stride", type=int, default=8)
    ap.add_argument("--max-frames", type=int, default=60)
    a = ap.parse_args()

    shoot = load_shoot(a.shoot_dir)
    room = json.loads(Path(a.room).read_text(encoding="utf-8"))
    if a.room_from_world:
        T = np.array(json.loads(Path(a.room_from_world).read_text(encoding="utf-8"))["T_room_from_world"])
    elif a.led_from:
        from align_led import align
        from overlay_room import led_frame_from_element, pick_element
        el = pick_element(room, a.led_from)
        T_room_from_led, w, h = led_frame_from_element(room, el)
        al = align(a.shoot_dir, w, h)
        T = T_room_from_led @ np.array(al["T_led_from_world"])
    else:
        raise SystemExit("--led-from か --room-from-world のどちらかが要る")
    out = Path(a.out)
    surfaces, report = project_colors(shoot, room, T, out, a.texels_per_m, a.stride, max_frames=a.max_frames)
    if write_glb(surfaces, out / "room_photo.glb"):
        print("書いた:", out / "room_photo.glb")
        if a.place_dir:
            import shutil
            pd = Path(a.place_dir)
            shutil.copy2(out / "room_photo.glb", pd / "room_photo.glb")
            pj = json.loads((pd / "place.json").read_text(encoding="utf-8"))
            pj.setdefault("variants", {})["photo"] = "room_photo.glb"
            (pd / "place.json").write_text(json.dumps(pj, indent=2, ensure_ascii=False) + chr(10), encoding="utf-8")
            print("入れた:", pd / "room_photo.glb", "(?variant=photo)")
    for r in report["surfaces"]:
        print(f"  {r['name']}: 見えた {r['seen_percent']}%、寄与したコマ {r['frames_contributing']}")


if __name__ == "__main__":
    main()
