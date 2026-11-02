"""LED に出した ChArUco の盤を撮った動画(a7 など)から、レンズの焦点距離と歪みを測る。

  python place/shootlog/lens_calib.py --video <動画> --board board_A.json --out-dir <出力> [--every 10] [--model standard|simple|rational]

撮り方: LED の平らな面(A か C)に盤を出し、使うズームの位置・ピントのまま、盤が画面の四隅・端・中央、近く・遠く、
少し斜めからも入るように、カメラをゆっくり動かして 30〜60 秒撮る。ズームやピントを動かさない。
出力: lens.json(係数・焦点距離・画角・UE の値)、st_map.png(16 ビット)、st_map.npz(map_x, map_y)、coverage.png(盤の角が画面のどこに写ったか)。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from lenslib import Board, calibrate, detect_corners, imwrite, lens_json, st_map, write_st_png16


def pick_views(video, board, every, max_views, min_corners):
    cap = cv2.VideoCapture(str(video))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    size = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    found = []
    i = 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        if i % every == 0:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            r = detect_corners(gray, board, min_corners)
            if r is not None:
                found.append((i, *r))
        i += 1
    cap.release()
    # 似たコマを減らす: 角の重心と広がりが離れた順に選ぶ
    feats = [np.array([c[:, 0].mean() / size[0], c[:, 1].mean() / size[1], np.ptp(c[:, 0]) / size[0], np.ptp(c[:, 1]) / size[1]]) for _, c, _ in found]
    chosen = []
    for idx in range(len(found)):
        if len(chosen) >= max_views:
            break
        if all(np.linalg.norm(feats[idx] - feats[j]) > 0.03 for j in chosen):
            chosen.append(idx)
    return size, [(found[j][1], found[j][2]) for j in chosen], [found[j][0] for j in chosen], len(found), n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--board", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--every", type=int, default=10)
    ap.add_argument("--max-views", type=int, default=60)
    ap.add_argument("--min-corners", type=int, default=12)
    ap.add_argument("--model", default="standard", choices=["standard", "simple", "rational"])
    ap.add_argument("--focal-mm35", type=float, default=None, help="おおよその焦点距離(35mm 換算)。初期値に使う")
    ap.add_argument("--fix-principal-point", action="store_true", help="主点を画像の中心に固定する(視点が少ない・傾きが小さいとき)")
    a = ap.parse_args()

    board = Board.load(a.board)
    size, views, frame_ids, n_found, n_total = pick_views(a.video, board, a.every, a.max_views, a.min_corners)
    if len(views) < 8:
        raise SystemExit(f"盤が見つかった異なる構図が少ない({len(views)} 枚)。8 枚以上要る。盤の明るさ・大きさ・ピントを確かめる")
    f0 = a.focal_mm35 * size[0] / 36.0 if a.focal_mm35 else None
    cal = calibrate(views, board, size, a.model, f0, a.fix_principal_point)
    info = lens_json(cal, size, Path(a.video).name, len(views), a.model)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    # 保持して確かめる: 半分の構図で解いた結果が、残り半分でどれだけ合うか
    cal2 = calibrate(views[::2], board, size, a.model, f0, a.fix_principal_point)
    errs = []
    for c, ids in views[1::2]:
        obj = board.corner_led_m(ids)
        ok, rvec, tvec = cv2.solvePnP(obj, c.reshape(-1, 1, 2), cal2["K"], cal2["dist"])
        proj, _ = cv2.projectPoints(obj, rvec, tvec, cal2["K"], cal2["dist"])
        errs.append(float(np.sqrt(np.mean(np.sum((proj.reshape(-1, 2) - c) ** 2, axis=1)))))
    info["holdout_rms_px"] = float(np.mean(errs)) if errs else None
    info["frames_with_board"] = n_found
    info["frames_total"] = n_total
    info["bad_views_frame_index"] = [int(frame_ids[i]) for i, v in enumerate(cal["per_view_rms"]) if v > 3 * max(cal["rms"], 0.3)]

    mx, my, cg_size, over = st_map(cal["K"], cal["dist"], size)
    info["st_map"] = {"overscan": over, "cg_render_size": list(cg_size),
                      "cg_principal_point": [cal["K"][0, 2] + (cg_size[0] - size[0]) / 2, cal["K"][1, 2] + (cg_size[1] - size[1]) / 2],
                      "how": "CG は a7 と同じ fx, fy の歪みなしピンホールで、この大きさ・この主点で描く。st_map.png の R=u、G=v(0〜1)が、歪んだ出力の各画素が CG のどこを見るか。"}
    (out / "lens.json").write_text(json.dumps(info, indent=2, ensure_ascii=False), encoding="utf-8")
    o = info["distortion_opencv"]
    lens_a7 = {"width": size[0], "height": size[1], "K": [info["fx"], info["fy"], info["cx"], info["cy"]],
               "dist": [o["k1"], o["k2"], o["p1"], o["p2"], o["k3"]], "rms_px": info["rms_reprojection_px"],
               "focal_mm_nominal": a.focal_mm35, "focal_mm_35_measured": info["focal_mm_35"], "model": a.model}
    (out / "lens_a7.json").write_text(json.dumps(lens_a7, indent=2), encoding="utf-8")
    write_st_png16(out / "st_map.png", mx, my, cg_size)
    np.savez_compressed(out / "st_map.npz", map_x=mx, map_y=my, cg_size=np.array(cg_size))

    cov = np.zeros((size[1] // 4, size[0] // 4, 3), np.uint8)
    for c, _ in views:
        for p in c:
            cv2.circle(cov, (int(p[0] / 4), int(p[1] / 4)), 3, (0, 255, 255), -1)
    imwrite(out / "coverage.png", cov)
    keys = ("fx", "fy", "cx", "cy", "distortion_opencv", "rms_reprojection_px", "holdout_rms_px", "hfov_deg", "focal_mm_35", "views_used", "bad_views_frame_index")
    print(json.dumps({k: info[k] for k in keys}, ensure_ascii=False, indent=1))
    print("出力:", out)


if __name__ == "__main__":
    main()
