"""LED の校正の盤の絵(5680×1240)を、自宅のウルトラワイド(5120×1440、幅 120 cm)に出す形にする。multi_calib を本物の実写で試すため。

  python place/shootlog/rehearsal/make_monitor_boards.py --still <LED校正の頭_静止画.png> --faces <LED校正の頭_faces_led.json> --out <出力フォルダ>
出力: monitor_boards_5120x1440.png(縦の中央に置く)、faces_monitor.json(multi_calib に渡す。1 画素の物理の大きさをモニターの値に直した物)。
モニターは曲面なので、面ごとの平らさは少し崩れる。3 面が別の向きに解けるかの確かめにも使える。
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

MON_W, MON_H, MON_WIDTH_M = 5120, 1440, 1.20


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--still", required=True)
    ap.add_argument("--faces", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    still = cv2.imdecode(np.fromfile(a.still, np.uint8), 1)
    scale = MON_W / still.shape[1]
    small = cv2.resize(still, (MON_W, int(round(still.shape[0] * scale))), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((MON_H, MON_W, 3), np.uint8)
    y0 = (MON_H - small.shape[0]) // 2
    canvas[y0:y0 + small.shape[0]] = small
    ok, buf = cv2.imencode(".png", canvas)
    (out / "monitor_boards_5120x1440.png").write_bytes(buf.tobytes())
    pitch = MON_WIDTH_M / MON_W * scale     # 元の絵の 1 画素の、モニターの上の大きさ(m)
    spec = json.loads(Path(a.faces).read_text(encoding="utf-8"))
    for f in spec["faces"]:
        f["board"]["pitch_m"] = pitch
        f["board"]["pitch_y_m"] = pitch
    spec["monitor"] = {"pitch_m": pitch, "scale": scale, "y0": y0}
    (out / "faces_monitor.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"作った: 1 画素 {pitch * 1000:.4f} mm、縦の頭 {y0}")


if __name__ == "__main__":
    main()
