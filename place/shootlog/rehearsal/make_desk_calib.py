"""机の上のテスト用: 1 枚のウルトラワイド(5120×1440)を LED、机を会場の床に見立てる。中央の 2560 幅(曲面の影響を小さくする)の 4 隅に十字を描く。

  python place/shootlog/rehearsal/make_desk_calib.py --out desk_calib_5120x1440.png
面 A = x 1280〜3840、y 120〜1320(画素)。1 画素 = 120 cm / 5120 = 0.234375 mm → 横 0.600 m・縦 0.28125 m。
AR ページの引数: face_w=0.6 face_h=0.28125 led_bottom=<面の下端から机までの高さ(m)>。
"""
import argparse
import cv2
import numpy as np

W, H = 5120, 1440
X0, X1, Y0, Y1 = 1280, 3840, 120, 1320


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    img = np.zeros((H, W, 3), np.uint8)
    img[:] = (24, 24, 24)
    cv2.rectangle(img, (X0, Y0), (X1, Y1), (70, 70, 70), 3)
    for (x, y) in ((X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)):
        cv2.line(img, (x - 70, y), (x + 70, y), (255, 255, 255), 5)
        cv2.line(img, (x, y - 70), (x, y + 70), (255, 255, 255), 5)
        cv2.circle(img, (x, y), 5, (0, 0, 255), -1)
    ok, buf = cv2.imencode(".png", img)
    open(a.out, "wb").write(buf.tobytes())
    print("作った:", a.out)


if __name__ == "__main__":
    main()
