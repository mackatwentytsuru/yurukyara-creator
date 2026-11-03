"""四元数(x, y, z, w)の計算。形は (..., 4)。"""
import numpy as np


def q_mul(a, b):
    ax, ay, az, aw = np.moveaxis(a, -1, 0)
    bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ], axis=-1)


def q_conj(q):
    return q * np.array([-1.0, -1.0, -1.0, 1.0])


def q_normalize(q):
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def q_rotate(q, v):
    u = q[..., :3]
    t = 2 * np.cross(u, v)
    return v + q[..., 3:4] * t + np.cross(u, t)


def q_from_to(a, b):
    """a の向きを b の向きへ回す最小の回転"""
    a = a / np.linalg.norm(a, axis=-1, keepdims=True)
    b = b / np.linalg.norm(b, axis=-1, keepdims=True)
    c = np.cross(a, b)
    w = 1 + np.sum(a * b, axis=-1, keepdims=True)
    return q_normalize(np.concatenate([c, w], axis=-1))


def q_nlerp(a, b, k):
    b = b * np.where(np.sum(a * b, axis=-1, keepdims=True) < 0, -1.0, 1.0)
    return q_normalize(a * (1 - k) + b * k)
