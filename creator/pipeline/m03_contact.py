"""部品の「埋まり」と「浮き」を数字にする(目で見る前の検査)。結果は頂点の見本だけの話で、見た目の合格ではない。

使い方: blender -b <build.blend> -P m03_contact.py -- [--json 出力.json] [--near 0.012] [--hug 名前,名前] [--skip 名前の頭,…]
  全部の物について、ほかの物(毛羽の殻は除く)を体として測る。
  --hug に書いた物(帯・襟・たすき): 全体が体の面の近くにある物。「面の近くが 8 割以上、0.4 cm より深く埋まる点なし」で合格。
  それ以外(耳・腕など): 付け根だけ埋まる物。「埋まる点が 2〜60%」で合格。0 なら宙に浮いている、多すぎれば体に飲まれている。
  本体(外接箱の体積がいちばん大きい物 1 つ)は、ほかの物の「体」になる側なので、浮きの判定をしない(手足が全部体に付いていても、
  本体の頂点が手足の中に 2% 入るとは限らない。平らな面の多い箱の胴で、浮きと誤って落ちた)。手足が体から離れていれば、手足のほうが落ちる。
内外の決め方: 物ごとに 3 方向の光線の交差回数を数え、奇数が多数なら内側。部品が重なっていても、物ごとに見るので数え間違えない。
"""
import json
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

RAYS = [Vector((0.927, 0.282, 0.247)).normalized(), Vector((0.211, 0.811, 0.544)).normalized(),
        Vector((-0.512, 0.391, 0.765)).normalized()]
MAX_SAMPLES = 3000
HUG_MIN_NEAR, HUG_MAX_DEEP = 0.8, 0.004
ROOT_MIN_IN, ROOT_MAX_IN = 0.02, 0.60
NOT_CHECKED = ["頂点の見本だけを見る。面どうしの交差は見ない", "止まった姿勢だけ。動いたときの埋まりは見ない", "形や色が元の絵に似ているかは見ない"]


def world_verts(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]


def bvh_of(o):
    o.data.calc_loop_triangles()
    return BVHTree.FromPolygons(world_verts(o), [tuple(t.vertices) for t in o.data.loop_triangles], all_triangles=True)


def is_inside(bvh, p):
    odd = 0
    for d in RAYS:
        start, count = p.copy(), 0
        for _ in range(64):
            hit = bvh.ray_cast(start, d, 100.0)[0]
            if hit is None:
                break
            count += 1
            start = hit + d * 1e-5
        odd += count % 2
    return odd >= 2


def measure(o, bodies, near):
    pts = world_verts(o)
    pts = pts[::max(1, len(pts) // MAX_SAMPLES)]
    inside = close = deep = 0
    max_depth = max_gap = 0.0
    for p in pts:
        dist = min(b.find_nearest(p)[3] for b in bodies)
        if any(is_inside(b, p) for b in bodies):
            inside += 1
            max_depth = max(max_depth, dist)
            deep += dist > HUG_MAX_DEEP
        else:
            max_gap = max(max_gap, dist)
        close += dist <= near
    n = max(len(pts), 1)
    return dict(samples=len(pts), inside_ratio=round(inside / n, 3), near_ratio=round(close / n, 3), deep_points=deep,
                max_depth_cm=round(max_depth * 100, 2), max_gap_cm=round(max_gap * 100, 2))


def judge(r, hug):
    why = []
    if hug:
        if r["near_ratio"] < HUG_MIN_NEAR:
            why.append("面から離れている(浮き)")
        if r["deep_points"] > 0:
            why.append("体に深く埋まる点がある")
    else:
        if r["inside_ratio"] < ROOT_MIN_IN:
            why.append("体に触れていない(浮き)")
        if r["inside_ratio"] > ROOT_MAX_IN:
            why.append("ほとんど体に飲まれている")
    return why


def main():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = {a[i][2:]: a[i + 1] for i in range(0, len(a) - 1, 2)}
    near = float(opt.get("near", 0.012))
    hug = set(filter(None, opt.get("hug", "").split(",")))
    skip = tuple(filter(None, opt.get("skip", "shell,cheek,hl").split(",")))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.data.polygons and not o.name.startswith(skip)
              and not o.get("surface_only")]   # 毛羽の殻と当て布は、部品の印で除く(古い物のために名前でも除く)
    trees = {o.name: bvh_of(o) for o in meshes}

    def box_volume(o):
        d = [max(c) - min(c) for c in zip(*[tuple(v) for v in world_verts(o)])]
        return d[0] * d[1] * d[2]
    root = max(meshes, key=box_volume).name if len(meshes) > 1 else None
    out = {}
    for o in meshes:
        bodies = [t for n, t in trees.items() if n != o.name]
        if not bodies:
            continue
        r = measure(o, bodies, near)
        r["kind"] = "沿う物" if o.name in hug else "付け根が埋まる物"
        r["why_failed"] = judge(r, o.name in hug)
        if o.name == root and not hug.intersection({o.name}):
            r["kind"] = "本体(最大の物。浮きは見ない)"
            r["why_failed"] = [w for w in r["why_failed"] if "浮き" not in w]
        out[o.name] = r
        print("M03", "OK  " if not r["why_failed"] else "NG  ", o.name, r["kind"], "埋まり", r["inside_ratio"], "面の近く",
              r["near_ratio"], "最深", r["max_depth_cm"], "cm", "最大のすきま", r["max_gap_cm"], "cm", "".join(r["why_failed"]))
    bad = sum(1 for r in out.values() if r["why_failed"])
    print(f"M03 {len(out) - bad}/{len(out)} が線の内側。確かめていない事: " + " / ".join(NOT_CHECKED))
    if "json" in opt:
        json.dump(dict(parts=out, not_checked=NOT_CHECKED, visual_pass=False), open(opt["json"], "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)


main()
