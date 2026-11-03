"""移した動きの、体の大きさの違いから出る崩れだけを直す。振り付けは変えない。
- 顔: 歌っているので、顔が天井や床を向きすぎないように首と頭で戻す。
- 手: アニメの頭はマネキンより大きいので、手が顔に入るコマは手首を外へ押し出して腕を解き直す。
"""
import numpy as np

from quat import q_conj, q_from_to, q_mul, q_normalize, q_nlerp, q_rotate

IDENTITY = np.array([0.0, 0, 0, 1])
FACE_UP_LIMIT = np.radians(16)
FACE_DOWN_LIMIT = np.radians(35)
NECK_SHARE = 0.4
HEAD_CENTER = np.array([0.0, 0.085, 0.02])  # 頭の骨から見た顔と髪の中心(m)
HEAD_RADIUS = 0.165  # 髪と手袋の厚みを含む
FINGER_REACH = 0.075  # 指の付け根から指先まで
DILATE = 4  # 押し出しを早めに始めて遅く終わる(コマ)
SMOOTH = 7


def bone_chain(bone, parents):
    chain = []
    while bone is not None:
        chain.append(bone)
        bone = parents.get(bone)
    return list(reversed(chain))


class BodyFix:
    def __init__(self, rest, parents):
        self.rest = rest
        self.parents = parents
        self.head_chain = bone_chain('head', parents)

    def forward(self, q, hips, bone):
        """骨の世界の回転と位置"""
        chain = bone_chain(bone, self.parents)
        w = q[chain[0]]
        p = self.rest[chain[0]] + hips
        for prev, name in zip(chain, chain[1:]):
            p = p + q_rotate(w, self.rest[name] - self.rest[prev])
            w = q_mul(w, q[name])
        return w, p

    def limit_face(self, q, hips):
        """顔の向きの上下を限る。戻した分の 4 割を首、残りを頭で持つ"""
        w_head, _ = self.forward(q, hips, 'head')
        f = q_rotate(w_head, np.array([0.0, 0, 1]))
        pitch = np.arcsin(np.clip(f[1], -1, 1))
        target = np.clip(pitch, -FACE_DOWN_LIMIT, FACE_UP_LIMIT)
        if target == pitch:
            return 0.0
        flat = np.array([f[0], 0.0, f[2]])
        n = np.linalg.norm(flat)
        flat = flat / n if n > 1e-5 else np.array([0.0, 0, 1])
        goal = flat * np.cos(target) + np.array([0.0, 1, 0]) * np.sin(target)
        fix = q_from_to(f, goal)
        share = q_nlerp(IDENTITY, fix, NECK_SHARE)
        w_chest, _ = self.forward(q, hips, 'chest')
        w_neck = q_mul(w_chest, q['neck'])
        w_neck2 = q_normalize(q_mul(share, w_neck))
        w_head2 = q_normalize(q_mul(fix, w_head))
        q['neck'] = q_normalize(q_mul(q_conj(w_chest), w_neck2))
        q['head'] = q_normalize(q_mul(q_conj(w_neck2), w_head2))
        return abs(pitch - target)

    def hand_push(self, q, hips, side):
        """手が頭の球に入っている量を、手首を動かすベクトルで返す"""
        w_head, p_head = self.forward(q, hips, 'head')
        center = p_head + q_rotate(w_head, HEAD_CENTER)
        w_hand, p_wrist = self.forward(q, hips, f'{side}Hand')
        knuckle = p_wrist + q_rotate(w_hand, self.rest[f'{side}MiddleProximal'] - self.rest[f'{side}Hand'])
        finger_dir = knuckle - p_wrist
        tip = knuckle + finger_dir / np.linalg.norm(finger_dir) * FINGER_REACH
        best = np.zeros(3)
        for point in (p_wrist, knuckle, tip):
            d = point - center
            dist = np.linalg.norm(d)
            if HEAD_RADIUS - dist > np.linalg.norm(best):
                best = d / max(dist, 1e-5) * (HEAD_RADIUS - dist)
        return best

    def solve_arm(self, q, hips, side, offset):
        up, lo, ha = f'{side}UpperArm', f'{side}LowerArm', f'{side}Hand'
        w_upper, shoulder = self.forward(q, hips, up)
        w_lower = q_mul(w_upper, q[lo])
        w_hand = q_mul(w_lower, q[ha])
        v1 = self.rest[lo] - self.rest[up]
        v2 = self.rest[ha] - self.rest[lo]
        l1, l2 = np.linalg.norm(v1), np.linalg.norm(v2)
        elbow_fk = shoulder + q_rotate(w_upper, v1)
        wrist = elbow_fk + q_rotate(w_lower, v2)
        target = wrist + offset
        d_vec = target - shoulder
        d = np.linalg.norm(d_vec)
        limit = (l1 + l2) * 0.999
        if d > limit:
            d_vec = d_vec / d * limit
            d = limit
            target = shoulder + d_vec
        axis = d_vec / d
        a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
        h = np.sqrt(max(l1 * l1 - a * a, 0.0))
        pole = elbow_fk - shoulder
        pole = pole - axis * np.dot(pole, axis)
        n = np.linalg.norm(pole)
        pole = pole / n if n > 1e-5 else np.array([0.0, -1, 0])
        elbow = shoulder + axis * a + pole * h
        w_upper2 = q_normalize(q_mul(q_from_to(q_rotate(w_upper, v1), elbow - shoulder), w_upper))
        w_lower2 = q_mul(w_upper2, q[lo])
        w_lower2 = q_normalize(q_mul(q_from_to(q_rotate(w_lower2, v2), target - elbow), w_lower2))
        w_parent = q_mul(w_upper, q_conj(q[up]))
        q[up] = q_normalize(q_mul(q_conj(w_parent), w_upper2))
        q[lo] = q_normalize(q_mul(q_conj(w_upper2), w_lower2))
        q[ha] = q_normalize(q_mul(q_conj(w_lower2), w_hand))

    def fix_hands(self, frames):
        """全コマの手を直す。押し出しは時間でならして、急に飛ばないようにする"""
        most = 0.0
        hit = 0
        window = np.hanning(2 * SMOOTH + 3)[1:-1]
        window = window / window.sum()
        for side in ('left', 'right'):
            raw = np.array([self.hand_push(fr['q'], fr['hips'], side) for fr in frames])
            size = np.linalg.norm(raw, axis=1)
            most = max(most, float(size.max()))
            hit += int((size > 0.001).sum())
            held = raw.copy()
            for i in range(len(raw)):
                a, b = max(i - DILATE, 0), min(i + DILATE + 1, len(raw))
                held[i] = raw[a + int(np.argmax(size[a:b]))]
            eased = np.stack([np.convolve(np.pad(held[:, k], SMOOTH, mode='edge'), window, 'valid') for k in range(3)], axis=1)
            for fr, offset in zip(frames, eased):
                if np.linalg.norm(offset) > 1e-4:
                    self.solve_arm(fr['q'], fr['hips'], side, offset)
        return most, hit
