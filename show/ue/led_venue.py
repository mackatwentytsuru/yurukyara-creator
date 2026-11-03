"""LED の中の会場。会場を差し替えるときは、この 1 つのファイルの VENUES に足すだけでよい。

決まり: 舞台の床の上面が z=0(キャラの足)。キャラは原点に立ち、カメラは +y から -y を見る。
関数の返り値の screen_y は、左右のスクリーンを置く奥行き(絵の上の位置と大きさはカメラの式で決める)。
"""
from ue_helpers import vec

WINE = (0.13, 0.008, 0.02)
DARK = (0.012, 0.012, 0.016)
GOLD = (0.55, 0.36, 0.13)
SEAT = (0.09, 0.012, 0.03)
BOARDS = (0.06, 0.035, 0.022)
CURTAIN_Y = -470.0
OPENING = 330.0  # 中央の面の幅に合わせた、舞台の開口の半分
TIER_ROWS = 7
SEATS_PER_ROW = 13


def _curtain(b, wine):
    """緞帳。細い円柱を並べてひだにする。"""
    x = -OPENING
    i = 0
    while x <= OPENING:
        radius = 20.0 if i % 2 == 0 else 15.0
        b.shape(f"Curtain{i:02d}", "Cylinder", (x, CURTAIN_Y - (0 if i % 2 == 0 else 10), 330.0),
                (radius / 50.0, radius / 50.0, 6.6), wine)
        x += 24.0
        i += 1


def _tiers(b, sign, seat, dark):
    """客席の段。外へ向かって奥へ上がる段と、並んだ座席。"""
    for row in range(TIER_ROWS):
        y1 = -360.0 - row * 110.0
        y0 = y1 - 110.0
        z1 = 20.0 + row * 52.0
        x0, x1 = (440.0, 1950.0)
        x_range = (x0, x1) if sign > 0 else (-x1, -x0)
        b.box(f"Tier{'R' if sign > 0 else 'L'}{row}", x_range, (y0, y1), (0.0, z1), dark)
        for i in range(SEATS_PER_ROW):
            x = sign * (x0 + 60.0 + i * (x1 - x0 - 120.0) / (SEATS_PER_ROW - 1))
            b.box(f"Seat{'R' if sign > 0 else 'L'}{row}_{i:02d}", (x - 40.0, x + 40.0), (y1 - 70.0, y1 - 15.0),
                  (z1, z1 + 62.0), seat, shadow=False)


def _columns(b, gold, dark):
    for sign in (-1, 1):
        for i, x in enumerate((OPENING + 45.0, 900.0, 1500.0)):
            b.shape(f"Column{'R' if sign > 0 else 'L'}{i}", "Cylinder", (sign * x, -440.0 - i * 60.0, 400.0),
                    (0.7 if i == 0 else 0.9, 0.7 if i == 0 else 0.9, 8.0), gold if i == 0 else dark)


def placeholder_theatre(b):
    """基本図形の仮の劇場: 舞台、緞帳、客席の段、柱、天井。"""
    wine = b.surface("LT_Wine", WINE, 0.75)
    dark = b.surface("LT_Dark", DARK, 0.7)
    gold = b.surface("LT_Gold", GOLD, 0.4, metallic=0.6)
    seat = b.surface("LT_Seat", SEAT, 0.8)
    boards = b.surface("LT_Boards", BOARDS, 0.25)
    b.box("Stage", (-3000.0, 3000.0), (-560.0, 1760.0), (-60.0, 0.0), boards)
    b.box("Pit", (-3000.0, 3000.0), (-1600.0, -560.0), (-60.0, 0.0), dark)
    _curtain(b, wine)
    b.box("Valance", (-OPENING - 60.0, OPENING + 60.0), (-450.0, -420.0), (560.0, 720.0), wine)
    b.box("BackWall", (-3000.0, 3000.0), (-1560.0, -1500.0), (0.0, 1000.0), dark)
    b.box("Ceiling", (-3000.0, 3000.0), (-1560.0, 200.0), (700.0, 760.0), dark, shadow=False)
    b.box("SideWallL", (-2060.0, -2000.0), (-1560.0, 200.0), (0.0, 760.0), dark)
    b.box("SideWallR", (2000.0, 2060.0), (-1560.0, 200.0), (0.0, 760.0), dark)
    for sign in (-1, 1):
        _tiers(b, sign, seat, dark)
    _columns(b, gold, dark)
    # 開口の上の小さな明かり。奥行きの目印と、光のにじみの確認を兼ねる
    bulb_teal = b.surface("LT_BulbTeal", (0, 0, 0), 0.5, glow=(0.2, 3.0, 2.6))
    bulb_pink = b.surface("LT_BulbPink", (0, 0, 0), 0.5, glow=(3.0, 0.3, 1.4))
    for i in range(-5, 6):
        b.shape(f"Bulb{i + 5:02d}", "Sphere", (i * 62.0, -415.0, 552.0), (0.14, 0.14, 0.14), bulb_teal if i % 2 else bulb_pink, shadow=False)
    return {"screen_y": -300.0}


VENUES = {"placeholder": placeholder_theatre}


def build_venue(b, name):
    if name not in VENUES:
        raise RuntimeError(f"会場の名前が違う: {name}。ある物: {sorted(VENUES)}")
    if "Sphere" not in b.meshes:
        import unreal
        b.meshes["Sphere"] = unreal.load_asset("/Engine/BasicShapes/Sphere")
    return VENUES[name](b)


__all__ = ["build_venue", "VENUES", "vec"]
