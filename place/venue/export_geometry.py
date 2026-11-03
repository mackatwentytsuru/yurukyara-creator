"""ブラウザのシミュレーターに渡す形(LED の板・舞台・場面)を place/web/venue_data.json に書く。

  python place/venue/export_geometry.py
形は show/ue/stage_layout.py の数字(読むだけ)から作るので、ここに数字を写さない。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import venue as V  # noqa: E402

L = V.L
data = {
    "units": "cm。x=0 が中央の面の真ん中、+x が客席から見て右、+y が客席、z=0 が床(show/ue/stage_layout.py と同じ)",
    "canvas": {"w": L.CANVAS_W, "h": L.CANVAS_H},
    "led_z": [L.LED_Z_BOTTOM, L.LED_Z_TOP],
    "stage_box": list(V.STAGE_BOX),
    "plates": [
        {k: p[k] for k in ("name", "start", "end", "width", "u_scale", "u_offset", "v_scale", "v_offset")}
        for p in V.plates()
    ],
    "scenario": V.load_scenario(),
}
out = Path(__file__).resolve().parents[1] / "web" / "venue_data.json"
out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
print("書いた:", out, "板", len(data["plates"]))
