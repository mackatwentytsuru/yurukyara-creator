"""舞台の上のキャラの位置(show_stage.json の ar_path と led_character)。UE の外でも中でも使う。"""


def smooth(k):
    k = min(max(k, 0.0), 1.0)
    return k * k * (3 - 2 * k)


def ar_at(path, t):
    """t 秒の [x, y, yaw]。キーの間はなめらかに動く。"""
    if t <= path[0][0]:
        return list(path[0][1:])
    for a, b in zip(path, path[1:]):
        if t < b[0]:
            k = smooth((t - a[0]) / (b[0] - a[0]))
            return [a[i] + (b[i] - a[i]) * k for i in (1, 2, 3)]
    return list(path[-1][1:])


def on_led(stage, t):
    """その秒、キャラは LED の中にいるか(舞台の上にはいない)。"""
    return any(a <= t < b for a, b in stage["led_character"])
