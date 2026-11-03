"""VRM 1.0 の骨の休みの姿勢(T の姿勢)を、ファイルだけから読む。正規化の骨は世界の向きがそろっているので位置だけあればよい。"""
import json
import struct

import numpy as np


def _matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=float).reshape(4, 4).T
    t = np.array(node.get('translation', [0, 0, 0]), dtype=float)
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    s = np.array(node.get('scale', [1, 1, 1]), dtype=float)
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


def read_rest(path):
    """返す物: {骨の名前: 世界の位置}, {骨の名前: 親の骨の名前(なければ None)}"""
    with open(path, 'rb') as f:
        f.read(12)
        size, _ = struct.unpack('<II', f.read(8))
        gltf = json.loads(f.read(size))
    vrm = gltf['extensions'].get('VRMC_vrm')
    if not vrm:
        raise ValueError('VRM 1.0 ではありません')
    nodes = gltf['nodes']
    parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}

    def world(i):
        m = _matrix(nodes[i])
        while i in parent:
            i = parent[i]
            m = _matrix(nodes[i]) @ m
        return m

    human = {name: v['node'] for name, v in vrm['humanoid']['humanBones'].items()}
    by_node = {v: k for k, v in human.items()}
    positions, parents = {}, {}
    for name, node in human.items():
        positions[name] = world(node)[:3, 3]
        i = node
        parents[name] = None
        while i in parent:
            i = parent[i]
            if i in by_node:
                parents[name] = by_node[i]
                break
    return positions, parents
