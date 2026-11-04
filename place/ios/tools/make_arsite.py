"""AR モニターのページと部品を、アプリに同梱する形(place/ios/ARSite/)に集める。ネットワークなしで動く(アプリの中の独自の URL: app://app/…)。

  python place/ios/tools/make_arsite.py
集める物(リポジトリの根からの同じ並びで置く。ページの import map の絶対パスがそのまま効く):
  place/web/{ar_show.html, ar_show.js, nativeAR.js}
  web/node_modules/three/build/{three.module.js, three.core.js}、three/examples/jsm/{loaders/GLTFLoader.js, utils/BufferGeometryUtils.js, utils/SkeletonUtils.js}
  web/node_modules/@pixiv/*/lib/*.module.js(three-vrm とその部品)
  characters/sample_vrm/model.vrm(52 MB)、show/show_stage.json、show/data/ar/dance_track.{json,bin}
曲が変わったら、show_stage.json と dance_track を置き直して、このスクリプトを流し、アプリを組み立て直す(または、Documents/ARSite/ の同じパスに置いても、そちらが優先される)。
ARSite/ はコミットしない(生成物・大きい)。
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "place" / "ios" / "ARSite"

FILES = [
    "place/web/ar_show.html", "place/web/ar_show.js", "place/web/nativeAR.js",
    "web/node_modules/three/build/three.module.js", "web/node_modules/three/build/three.core.js",
    "web/node_modules/three/examples/jsm/loaders/GLTFLoader.js", "web/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js",
    "web/node_modules/three/examples/jsm/utils/SkeletonUtils.js",
    "characters/sample_vrm/model.vrm",
]
# 曲や動きの版が違うときは、環境変数で別の舞台の予定と踊りを同梱できる(同梱先の名前は同じ)
STAGE = Path(os.environ.get("SHOW_STAGE") or REPO / "show/show_stage.json")
TRACK = os.environ.get("SHOW_TRACK")      # 拡張子なしの踊りのパス(<名前>.json と <名前>.bin)。無ければ show/data/ar/dance_track.*


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    for rel in FILES:
        src = REPO / rel
        if not src.exists():
            raise SystemExit(f"無い: {rel}")
        dst = OUT / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    for lib in (REPO / "web/node_modules/@pixiv").glob("three-vrm*"):
        for f in (lib / "lib").glob("*.module.js"):
            dst = OUT / "web/node_modules/@pixiv" / lib.name / "lib" / f.name
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst)
    (OUT / "show").mkdir(parents=True, exist_ok=True)
    shutil.copy2(STAGE, OUT / "show/show_stage.json")
    tracks = [(REPO / "show/data/ar" / f"dance_track{ext}", f"dance_track{ext}") for ext in (".json", ".bin")]
    if TRACK:
        tracks = [(Path(TRACK + ext), f"dance_track{ext}") for ext in (".json", ".bin")]
    for src, name in tracks:
        if not src.exists():
            raise SystemExit(f"無い: {src}")
        dst = OUT / "show/data/ar" / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    print(f"舞台の予定: {STAGE.name}、踊り: {Path(TRACK).name if TRACK else 'show/data/ar/dance_track'}")
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"集めた: {OUT}({sum(1 for p in OUT.rglob('*') if p.is_file())} ファイル、{total / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
