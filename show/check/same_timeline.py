"""キャラなしを流用してよいかを確かめる。今の timeline が、描いたときの timeline と同じで、コマ数も同じなら 0 で終わる。
使い方: python show/check/same_timeline.py <timeline.json> <render_stats.json>
"""
import hashlib
import json
import sys
from pathlib import Path


def main():
    timeline_path, stats_path = sys.argv[1:3]
    body = Path(timeline_path).read_bytes()
    stats = json.loads(Path(stats_path).read_text(encoding="utf-8"))
    frames = json.loads(body)["frames"]
    same = hashlib.sha256(body).hexdigest() == stats.get("timeline_sha256") and frames == stats.get("frames_rendered")
    print(f"timeline が同じ: {same}、コマ数 {frames}(描いたとき {stats.get('frames_rendered')})")
    sys.exit(0 if same else 1)


if __name__ == "__main__":
    main()
