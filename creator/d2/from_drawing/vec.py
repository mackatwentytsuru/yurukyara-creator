"""マスク(画素の集まり)を、なめらかな SVG の path にする小さな道具。"""
import numpy as np, cv2

def _fmt(v):
    s = f'{v:.1f}'
    if s.endswith('.0'): s = s[:-2]
    if s == '-0': s = '0'
    return s

def _closed_bezier(pts, corner_deg=58.0, tension=1.0):
    n = len(pts)
    if n < 3:
        return ''
    P = np.asarray(pts, float)
    corner = np.zeros(n, bool)
    for i in range(n):
        a = P[i] - P[i - 1]; b = P[(i + 1) % n] - P[i]
        na, nb = np.linalg.norm(a), np.linalg.norm(b)
        if na < 1e-6 or nb < 1e-6: continue
        cosv = np.clip(np.dot(a, b) / (na * nb), -1, 1)
        corner[i] = np.degrees(np.arccos(cosv)) > corner_deg
    out = [f'M{_fmt(P[0][0])} {_fmt(P[0][1])}']
    for i in range(n):
        p0, p1, p2, p3 = P[i - 1], P[i], P[(i + 1) % n], P[(i + 2) % n]
        seg = np.linalg.norm(p2 - p1)
        t1 = (p2 - p0) / 6 * tension
        t2 = (p3 - p1) / 6 * tension
        # 長すぎる手(となりの点が遠い)をおさえる
        for t in (t1, t2):
            L = np.linalg.norm(t)
            if L > seg * 0.5 and L > 0: t *= seg * 0.5 / L
        c1 = p1 if corner[i] else p1 + t1
        c2 = p2 if corner[(i + 1) % n] else p2 - t2
        out.append(f'C{_fmt(c1[0])} {_fmt(c1[1])} {_fmt(c2[0])} {_fmt(c2[1])} {_fmt(p2[0])} {_fmt(p2[1])}')
    out.append('Z')
    return ''.join(out)

def mask_to_d(mask, eps=0.7, up=4, blur=0.9, min_area=12, corner_deg=58.0, holes=True):
    """mask(bool の 2 次元)→ path の d。holes=True なら穴も入る(fill-rule evenodd で塗る)。座標は元の画素の座標(画素 i は [i, i+1])"""
    m = cv2.resize(mask.astype(np.float32), None, fx=up, fy=up, interpolation=cv2.INTER_LINEAR)
    if blur > 0:
        m = cv2.GaussianBlur(m, (0, 0), blur * up)
    b = (m >= 0.5).astype(np.uint8)
    cnts, _ = cv2.findContours(b, cv2.RETR_CCOMP if holes else cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    ds = []
    for c in cnts:
        if abs(cv2.contourArea(c)) < min_area * up * up:
            continue
        pts = (c[:, 0, :].astype(np.float32) + 0.5) / up
        ap = cv2.approxPolyDP(pts, eps, True)[:, 0, :]
        if len(ap) < 3:
            continue
        ds.append(_closed_bezier(ap, corner_deg))
    return ''.join(ds)

def disk(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

def dil(mask, r):
    return cv2.dilate(mask.astype(np.uint8), disk(r)).astype(bool)

def ero(mask, r):
    return cv2.erode(mask.astype(np.uint8), disk(r)).astype(bool)
