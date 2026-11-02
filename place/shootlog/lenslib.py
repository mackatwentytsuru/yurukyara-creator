"""レンズの歪みの校正と、歪みを合成に使う道具の共通部分。

LED に出した ChArUco の盤(make_led_board.py が作る)を a7 などで撮った動画から、焦点距離と歪みを測る。
座標の約束(shootlib.py と同じ): LED の座標は 客席から見て左下が原点、x が右、y が上、z が客席側(m)。
盤の角の LED 座標は、盤の画像の画素位置と LED の画素の大きさ(pitch_m)から決まる。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class Board:
    cols: int           # 四角の数(横)
    rows: int           # 四角の数(縦)
    square_px: int      # 四角の一辺(LED の画素)
    marker_px: int
    offset_px: tuple[int, int]   # 盤が LED の面の画像のどこから始まるか(左上、画素)
    face_px: tuple[int, int]     # 面の画像の大きさ(幅, 高さ)
    pitch_m: float      # LED の 1 画素の大きさ(m)
    dictionary: str

    @staticmethod
    def load(path) -> "Board":
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        return Board(d["cols"], d["rows"], d["square_px"], d["marker_px"], tuple(d["offset_px"]), tuple(d["face_px"]), d["pitch_m"], d["dictionary"])

    def to_json(self) -> dict:
        return {"cols": self.cols, "rows": self.rows, "square_px": self.square_px, "marker_px": self.marker_px,
                "offset_px": list(self.offset_px), "face_px": list(self.face_px), "pitch_m": self.pitch_m, "dictionary": self.dictionary}

    def cv_board(self):
        aruco = cv2.aruco
        d = aruco.getPredefinedDictionary(getattr(aruco, self.dictionary))
        return aruco.CharucoBoard((self.cols, self.rows), self.square_px * self.pitch_m, self.marker_px * self.pitch_m, d)

    def corner_led_m(self, ids: np.ndarray) -> np.ndarray:
        """角の id → LED の座標(m)。内側の角は (cols-1)×(rows-1) 個で、左から右、上から下の順。"""
        ids = np.asarray(ids).ravel()
        c = ids % (self.cols - 1)
        r = ids // (self.cols - 1)
        px = self.offset_px[0] + (c + 1) * self.square_px
        py = self.offset_px[1] + (r + 1) * self.square_px
        X = px * self.pitch_m
        Y = (self.face_px[1] - py) * self.pitch_m
        return np.stack([X, Y, np.zeros_like(X)], axis=1).astype(np.float32)

    def render(self) -> np.ndarray:
        """面の画像(face_px の大きさ)。黒地に盤。"""
        img = np.zeros((self.face_px[1], self.face_px[0]), np.uint8)
        w = self.cols * self.square_px
        h = self.rows * self.square_px
        board_img = self.cv_board().generateImage((w, h), marginSize=0, borderBits=1)
        ox, oy = self.offset_px
        img[oy:oy + h, ox:ox + w] = board_img
        return img


def imwrite(path, img) -> None:
    """日本語のフォルダ名でも書ける cv2.imwrite(cv2 は非 ASCII のパスに書けない)。"""
    ext = Path(path).suffix or ".png"
    ok, buf = cv2.imencode(ext, img)
    if not ok:
        raise IOError(f"画像を書けない: {path}")
    Path(path).write_bytes(buf.tobytes())


def detect_corners(gray: np.ndarray, board: Board, min_corners=12):
    det = cv2.aruco.CharucoDetector(board.cv_board())
    cc, ci, _, _ = det.detectBoard(gray)
    if cc is None or ci is None or len(cc) < min_corners:
        return None
    return cc.reshape(-1, 2).astype(np.float32), ci.reshape(-1)


def calibrate(views: list[tuple[np.ndarray, np.ndarray]], board: Board, size: tuple[int, int], model="standard", focal_guess_px=None, fix_principal_point=False):
    """views = [(画素の角(N,2), id(N))]。戻り: dict(K, dist, rms, per_view_rms, std)"""
    obj = [board.corner_led_m(ids) for _, ids in views]
    img = [c.reshape(-1, 1, 2) for c, _ in views]
    w, h = size
    f0 = focal_guess_px or 1.2 * w
    K0 = np.array([[f0, 0, w / 2], [0, f0, h / 2], [0, 0, 1.0]])
    flags = cv2.CALIB_USE_INTRINSIC_GUESS
    if fix_principal_point:   # 平らな面 1 枚で主点が決まりにくいとき、主点を画像の中心に固定する
        flags |= cv2.CALIB_FIX_PRINCIPAL_POINT
    if model == "standard":
        nd = 5
    elif model == "simple":     # k1, k2 だけ(接線・k3 は 0)
        flags |= cv2.CALIB_ZERO_TANGENT_DIST | cv2.CALIB_FIX_K3
        nd = 5
    elif model == "rational":
        flags |= cv2.CALIB_RATIONAL_MODEL
        nd = 8
    else:
        raise ValueError(model)
    rms, K, dist, rvecs, tvecs, std_int, _, per_view = cv2.calibrateCameraExtended(
        [o.reshape(-1, 1, 3) for o in obj], img, (w, h), K0, np.zeros((nd, 1)), flags=flags)
    return {"K": K, "dist": dist.ravel(), "rms": float(rms), "per_view_rms": per_view.ravel(), "std_intrinsics": std_int.ravel(),
            "rvecs": rvecs, "tvecs": tvecs}


def lens_json(cal: dict, size: tuple[int, int], source: str, n_views: int, model: str) -> dict:
    K, dist = cal["K"], cal["dist"]
    w, h = size
    fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]
    k = list(dist) + [0.0] * (14 - len(dist))
    return {
        "image_size": [w, h], "fx": fx, "fy": fy, "cx": cx, "cy": cy,
        "distortion_opencv": {"k1": k[0], "k2": k[1], "p1": k[2], "p2": k[3], "k3": k[4], "k4_k6_rational": k[5:8]},
        "model": model, "views_used": n_views, "rms_reprojection_px": cal["rms"],
        "hfov_deg": float(np.degrees(2 * np.arctan(w / (2 * fx)))), "vfov_deg": float(np.degrees(2 * np.arctan(h / (2 * fy)))),
        "focal_mm_35": float(fx * 36.0 / w),
        # UE の Lens File(Spherical)に入れる形: 焦点距離と主点を画像の幅・高さで割った値
        "unreal_spherical": {"K1": k[0], "K2": k[1], "K3": k[4], "P1": k[2], "P2": k[3],
                             "Fx_normalized": fx / w, "Fy_normalized": fy / h, "Cx_normalized": cx / w, "Cy_normalized": cy / h},
        "std_fx_fy_cx_cy_px": [float(v) for v in cal["std_intrinsics"][:4]],
        "source": source,
        "note": "歪みの係数は OpenCV の定義(正規化した画像座標)。UE の値は同じ式の係数をそのまま移したもので、UE 側の向きの規約は実際の絵で確かめること。",
    }


# ---- 歪みを合成に使う ---------------------------------------------------------------

def st_map(K: np.ndarray, dist: np.ndarray, size: tuple[int, int], overscan: float | None = None):
    """歪んだ出力(a7 の画面)の各画素が、歪みなしの絵(CG の描画)のどこを見るかの地図。

    CG は a7 と同じ K のピンホールで、幅・高さを overscan 倍に広げて描く(主点は中心にそろえて足す)。
    戻り: (map_x, map_y)(CG の画像の画素座標、cv2.remap に渡せる)、CG の大きさ (幅, 高さ)、overscan。
    overscan=None なら、四隅が収まる最小の倍率(少し余裕つき)を自動で決める。
    """
    w, h = size
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    pts = np.stack([xs.ravel(), ys.ravel()], axis=1).reshape(-1, 1, 2)
    und = cv2.undistortPoints(pts, K, dist, P=K).reshape(h, w, 2)   # 歪みなしのピンホール座標(a7 の画素の単位)
    ux, uy = und[..., 0], und[..., 1]
    if overscan is None:
        # 画像の外へはみ出す量(片側の最大)から倍率を決める
        left, right = -ux.min(), ux.max() - (w - 1)
        top, bottom = -uy.min(), uy.max() - (h - 1)
        extra = max(left, right, top, bottom, 0.0)
        overscan = max(1.0, (max(w, h) + 2 * extra + 4) / max(w, h))
    wc, hc = int(np.ceil(w * overscan / 2) * 2), int(np.ceil(h * overscan / 2) * 2)
    sx, sy = (wc - w) / 2.0, (hc - h) / 2.0
    return (ux + sx).astype(np.float32), (uy + sy).astype(np.float32), (wc, hc), float(overscan)


def distort_image(cg: np.ndarray, map_x: np.ndarray, map_y: np.ndarray, interp=cv2.INTER_LINEAR) -> np.ndarray:
    return cv2.remap(cg, map_x, map_y, interp, borderMode=cv2.BORDER_CONSTANT)


def write_st_png16(path, map_x, map_y, cg_size):
    """16 ビット PNG の ST マップ(R=u、G=v、0〜1 を 0〜65535)。cv2 は BGR の順に書くので B=0。"""
    wc, hc = cg_size
    u = np.clip((map_x + 0.5) / wc, 0, 1)
    v = np.clip((map_y + 0.5) / hc, 0, 1)
    img = np.stack([np.zeros_like(u), v, u], axis=2)
    imwrite(path, (img * 65535 + 0.5).astype(np.uint16))
