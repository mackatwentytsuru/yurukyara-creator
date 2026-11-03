"""iPhone「撮影記録」の動画から、Claude が「箱の中のどこに何があるか」を読み、床の上の位置にする。

  python place/shootlog/scene_reader.py <撮影フォルダ> --out <出力フォルダ> [--n 8] [--alignment alignment_A.json --face A] [--floor-y -1.257]

流れ:
  1. 撮影記録のコマから、カメラの位置・向きがいろいろ違う n コマを選ぶ(ぼやけたコマ・追跡が不正常なコマは除く)。
  2. 各コマを Claude(画像を読めるモデル)に見せ、写っている設備・物(柱・ロープ・階段・カウンター・ドア・段差など)の足元の位置を画像の座標で答えさせる。
  3. 足元の画素を、そのコマの ARKit の姿勢と画角で床(y=床の高さ)まで伸ばして、世界の位置にする。
  4. 複数のコマで同じ物を、種類と距離でまとめて平均し、位置のばらつき(cm)・見えたコマ数・根拠のコマを残す。
  5. --alignment(align_led.py の出力)があれば、LED の座標と、シミュレーター(show/ue/stage_layout.py の座標、cm)の座標にも直す。
出力: venue_details.json(シミュレーターの ?details= にそのまま渡せる)、keyframes/*.jpg(読んだ位置を重ねた確認用の絵)、reader_log.json(使った量)。
Claude は位置を「画像の大きさに対する 0〜1000 の座標」で答える。足元が見えない物は、足元を推定せず null にさせ、位置を出さない。
安全に関わりそうな気づきは、断定させず needs_human=true の注記として残す(人が判断する)。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "venue"))
import claude_api  # noqa: E402
import shootlib as S  # noqa: E402

KINDS = ["pillar", "rope", "stairs", "counter", "door", "speaker", "step", "table", "other"]
PROMPT = """これは、ライブ会場(箱)の中を iPhone で撮った動画の 1 コマです。このコマに写っている、床に立っている設備・物
(柱・ロープやポール・階段・カウンター・ドア・スピーカー・段差・テーブルなど)を列挙してください。
各物について、**床に接している点(足元)** の画像上の位置を、画像の横(x: 左が 0、右が 1000)と縦(y: 上が 0、下が 1000)の座標で答えます。

守ること:
- 見えているものだけ。推測で増やさない。足元が他の物や画面の外で見えないときは base を null にする(位置を作らない)。
- 机・モニターなど、床に立っていない物は列挙しない。
- kind は次のどれか: pillar rope stairs counter door speaker step table other。name は日本語の短い名前。
- height_m: 物の高さの目安(不明なら null)。confidence: 0〜1。
- notes: この物について、つまずき・視界・避難路など、**安全に関わりそうな気づき**があれば短く書く(断定せず「〜かもしれない」)。無ければ空。

次の JSON だけを返す:
{"objects": [{"name": "...", "kind": "...", "base": {"x": 0〜1000, "y": 0〜1000} か null, "height_m": 数 か null, "confidence": 0〜1, "notes": "..."}]}
"""


def sharpness(img_bgr) -> float:
    g = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, (640, int(g.shape[0] * 640 / g.shape[1])))
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def pick_keyframes(shoot: S.Shoot, n: int):
    """追跡が正常なコマから、カメラの位置と向きがなるべく違う n コマ(最遠点の順)。ぼやけたコマは避ける。"""
    cand = [i for i, f in enumerate(shoot.frames) if f.get("track") == "normal" and f.get("ok", True)][::3]
    if not cand:
        raise SystemExit("追跡が正常なコマが無い")
    feats = []
    for i in cand:
        T = shoot.T(i)
        pos = T[:3, 3]
        fwd = -T[:3, 2]
        feats.append(np.concatenate([pos, fwd * 1.5]))
    feats = np.array(feats)
    chosen = [int(np.argmax(np.linalg.norm(feats - feats.mean(0), axis=1)))]
    while len(chosen) < min(n * 2, len(cand)):
        d = np.min(np.linalg.norm(feats[:, None] - feats[chosen][None], axis=2), axis=1)
        chosen.append(int(np.argmax(d)))
    # ぼやけの少ない順に n 個(候補の 2n 個を読んで測る)
    cap = cv2.VideoCapture(str(shoot.video))
    scored = []
    for c in chosen:
        idx = cand[c]
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, img = cap.read()
        if ok:
            scored.append((sharpness(img), idx, img))
    cap.release()
    # 最遠点の順を保ち、ぼやけたコマ(中央値の 6 割未満)を飛ばして n 個
    if not scored:
        raise SystemExit("動画のコマを読めない")
    med = float(np.median([s[0] for s in scored]))
    keep = [s for s in scored if s[0] >= 0.6 * med][:n]
    best = sorted(keep, key=lambda s: s[1])
    return [(idx, img, sh) for sh, idx, img in best]


def backproject(T, K4, u, v, floor_y):
    """画素 → 床(y=floor_y)の世界の点。前に進む向きで床と交わらなければ None。"""
    fx, fy, cx, cy = K4
    d_cam = np.array([(u - cx) / fx, -(v - cy) / fy, -1.0])
    R, t = T[:3, :3], T[:3, 3]
    d = R @ d_cam
    if abs(d[1]) < 1e-6:
        return None
    s = (floor_y - t[1]) / d[1]
    if s <= 0:
        return None
    return t + s * d


def read_frame(model, key, img_bgr):
    pil = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    text, usage = claude_api.call(model, key, [{"type": "text", "text": PROMPT}, claude_api.image_block(pil, 1568)], max_tokens=3000)
    try:
        return claude_api.parse_json(text).get("objects", []), usage, text
    except Exception:
        return [], usage, text


def font(size):
    for p in ("C:/Windows/Fonts/YuGothB.ttc", "C:/Windows/Fonts/meiryo.ttc"):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def fuse(detections, radius_m=0.6):
    """種類が同じで、床の上の位置が radius_m 以内の検出を 1 つにまとめる(貪欲)。"""
    groups = []
    for d in sorted(detections, key=lambda d: -d["confidence"]):
        for g in groups:
            if g["kind"] == d["kind"] and np.linalg.norm(g["center"] - d["world"][[0, 2]]) < radius_m:
                g["items"].append(d)
                g["center"] = np.mean([i["world"][[0, 2]] for i in g["items"]], axis=0)
                break
        else:
            groups.append({"kind": d["kind"], "center": d["world"][[0, 2]].copy(), "items": [d]})
    return groups


def stage_origin(face):
    sys.path.insert(0, str(HERE.parents[1] / "show" / "ue"))
    import stage_layout as L  # 読むだけ
    return {"A": (L.A_X0, 0.0), "B": (-L.B_X_HALF, L.B_Y), "C": (L.C_FLAT_X0, 0.0)}[face], L.LED_Z_BOTTOM


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("shoot_dir")
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--model", default="claude-sonnet-5-5")
    ap.add_argument("--floor-y", type=float, default=None, help="床の高さ(ARKit の世界 y)。無ければ meta の校正の床")
    ap.add_argument("--alignment", default=None)
    ap.add_argument("--face", default="A")
    ap.add_argument("--radius", type=float, default=0.6, help="同じ物とみなす距離(m)")
    a = ap.parse_args()

    shoot = S.load_shoot(a.shoot_dir)
    out = Path(a.out)
    (out / "keyframes").mkdir(parents=True, exist_ok=True)
    floor_y = a.floor_y
    if floor_y is None:
        floor_y = (shoot.meta.get("calibration") or {}).get("floor", {}).get("planeY")
    if floor_y is None:
        raise SystemExit("床の高さが分からない(--floor-y か、校正の床)")
    key, keyname = claude_api.get_key()
    frames = pick_keyframes(shoot, a.n)
    detections, log = [], []
    for idx, img, sh in frames:
        t0 = time.time()
        objs, usage, raw = read_frame(a.model, key, img)
        T, K4 = shoot.T(idx), shoot.frames[idx]["K"]
        h, w = img.shape[:2]
        pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        dr = ImageDraw.Draw(pil)
        n_ok = 0
        for o in objs:
            base = o.get("base")
            if not base:
                continue
            u, v = base["x"] / 1000.0 * w, base["y"] / 1000.0 * h
            world = backproject(T, K4, u, v, floor_y)
            dist = None if world is None else float(np.linalg.norm(world - T[:3, 3]))
            dr.ellipse([u - 14, v - 14, u + 14, v + 14], outline=(255, 60, 60), width=5)
            dr.text((u + 18, v - 18), o.get("name", ""), fill=(255, 255, 0), font=font(44))
            if world is None or dist > 25:
                continue
            n_ok += 1
            detections.append({"name": o.get("name", ""), "kind": o.get("kind", "other"), "world": world, "frame": idx,
                               "confidence": float(o.get("confidence") or 0.5), "height_m": o.get("height_m"),
                               "notes": o.get("notes", ""), "distance_m": dist})
        pil.resize((1280, int(1280 * h / w))).save(out / "keyframes" / f"frame_{idx:05d}.jpg", quality=85)
        log.append({"frame": idx, "sharpness": round(sh, 1), "objects_read": len(objs), "located": n_ok,
                    "seconds": round(time.time() - t0, 1), "usage": {k: usage.get(k) for k in ("input_tokens", "output_tokens")}, "model": a.model, "key": keyname})
        print(f"コマ {idx}: Claude が {len(objs)} 個、位置にできた {n_ok} 個、{log[-1]['seconds']} 秒")

    groups = fuse(detections, a.radius)
    T_led_from_world = None
    origin = None
    if a.alignment:
        T_led_from_world = np.array(json.loads(Path(a.alignment).read_text(encoding="utf-8"))["T_led_from_world"])
        origin, led_z_bottom = stage_origin(a.face)
    objects = []
    for g in groups:
        items = g["items"]
        world = np.mean([i["world"] for i in items], axis=0)
        spread = float(np.sqrt(np.mean([np.sum((i["world"][[0, 2]] - g["center"]) ** 2) for i in items]))) * 100
        names = [i["name"] for i in items]
        o = {"name": max(set(names), key=names.count), "kind": g["kind"], "n_views": len({i["frame"] for i in items}),
             "spread_cm": round(spread, 1), "evidence_frames": sorted({i["frame"] for i in items}),
             "world_m": [round(float(world[0]), 3), round(float(floor_y), 3), round(float(world[2]), 3)],
             "height_cm": None, "confidence": round(float(np.mean([i["confidence"] for i in items])), 2),
             "notes": sorted({i["notes"] for i in items if i["notes"]}), "needs_human": any(i["notes"] for i in items)}
        hs = [i["height_m"] for i in items if i["height_m"]]
        if hs:
            o["height_cm"] = round(float(np.median(hs)) * 100)
        if T_led_from_world is not None:
            p = (T_led_from_world[:3, :3] @ world) + T_led_from_world[:3, 3]
            o["led_m"] = [round(float(x), 3) for x in p]
            o["x_cm"] = round(origin[0] + 100 * p[0], 1)
            o["y_cm"] = round(origin[1] + 100 * p[2], 1)
        objects.append(o)
    result = {"method": "撮影記録のコマを Claude が読み、足元の画素を ARKit の姿勢で床へ伸ばした",
              "source": str(a.shoot_dir), "model": a.model, "floor_y": floor_y, "keyframes": [f[0] for f in frames],
              "alignment": a.alignment, "face": a.face if a.alignment else None,
              "caveat": "足元の画素は Claude の読み。位置の正しさは実測と比べるまで未確認。spread_cm は同じ物を別のコマで読んだときのばらつき(正しさそのものではない)。",
              "objects": objects}
    (out / "venue_details.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "reader_log.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"物 {len(objects)} 個(検出 {len(detections)} 件をまとめた)。書いた: {out / 'venue_details.json'}")


if __name__ == "__main__":
    main()
