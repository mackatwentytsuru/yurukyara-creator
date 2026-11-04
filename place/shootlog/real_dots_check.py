"""固定の iPad のカメラで、会場用の点の映像(3 面 33 点)を本物のアプリで拾い、番号の正しさを測る(人の手なし)。

  python place/shootlog/real_dots_check.py --out work/_stream/real_dots
  python place/shootlog/real_dots_check.py --selftest          # 画面も iPad も使わない。番号の判定(RANSAC)だけ確かめる
流れ: ①メイン PC の画面の下に、フォーカスを奪わない小さな窓(最前面・枠なし)で ArUco の盤を 5 秒だけ出し、iPad の映像 1 コマで「カメラに映る画面の範囲」を求める
    ②その範囲に収まる最大の窓(4.58:1)に、本物の点の映像(led_dots_5680x1240_H264.mp4)を縮めて 1 回(34 秒)流す。
    ③アプリを `--ar-on --lock-exposure --iso 50` で起動して点を拾わせ、周ごとに dot_rays.json を取る(30 秒より古いレイは消えるので、流している間に取り続ける)。
    ④レイの向きを画像の平面に投影し、点の映像の画素(LED の px)とのホモグラフィーを RANSAC で解く。番号が 1 つずれた点は外れになる。
    ⑤窓の位置(ArUco)と iPad の姿勢・内部パラメータから、点の画素の「予想」を作り、レイの投影とも比べる(RANSAC に頼らない確認)。
決まり: 窓を出すのは合計 180 秒まで(out の window_ledger.json に積む)、1 回 60 秒以内。窓は例外でも必ず消す。
  iPad のカメラの映像(本人の画面が映る)は out の probe/・play/ にだけ置き、終わりに消す(`--keep-camera` で残す。残すのは試作のときだけ)。Mac の受け手の記録も消す。
  結果の絵(real_dots_result.jpg)にはカメラの絵を入れない(点の位置だけを描く)。
終了コード: 0=20 点以上拾い、拾った点の 9 割以上の番号が正しい / 1=測れたが届かない / 2=測れなかった。
"""
from __future__ import annotations

import argparse
import ctypes
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from ctypes import wintypes as wt
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE)]
from calib_device_test import BUNDLE, IPAD, MAC_LAN_IP, PATH, PORT, scp, ssh  # noqa: E402
import make_led_dots_video as dv  # noqa: E402

VIDEO_DIR = Path(r"work\キャラクターショー\本番_1103\LEDに出す物\点の校正")
VIDEO_NAME = "led_dots_5680x1240_H264.mp4"
RESULT_JPG = Path(r"work\本部\朝の確認_1104\点の実機の試し_1104.jpg")
BUDGET_SEC, PER_WINDOW_SEC = 180.0, 60.0
RATIO = dv.W / dv.H                                  # 4.58:1
PAGE = "app://app/place/web/ar_show.html?dots=led3&dot_rms=4&track=/show/data/ar/dance_track&show_led=1"
SOURCE_WIDTH = 3840                                  # ARKit の 4K。受け手の記録の K はこの画素
INLIER_LED_PX = 70.0                                 # 点の間隔(約 350 px)の 2 割。これを超える点は「番号がずれた」とみなす
PASS_DOTS, PASS_CORRECT = 20, 0.9
PROBE_SIDE, PROBE_PITCH, PROBE_ROWS = 170, 210, 2
PROBE_H = PROBE_ROWS * PROBE_PITCH + 20
EDGE_MARGIN = 0.03                                   # 窓の 4 隅がカメラの縁から離れる割合
FONT = r"C:\Windows\Fonts\YuGothB.ttc"

user32 = ctypes.windll.user32
user32.GetAncestor.restype = wt.HWND
user32.GetAncestor.argtypes = [wt.HWND, wt.UINT]
user32.GetForegroundWindow.restype = wt.HWND
user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]
user32.GetWindowLongW.argtypes = [wt.HWND, ctypes.c_int]
user32.SetWindowLongW.argtypes = [wt.HWND, ctypes.c_int, ctypes.c_long]
GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST = -20, 0x08000000, 0x80, 0x8
SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x10, 0x40


# ---------------------------------------------------------------- 画面と窓

def list_monitors():
    class Info(ctypes.Structure):
        _fields_ = [("cbSize", wt.DWORD), ("rcMonitor", wt.RECT), ("rcWork", wt.RECT), ("dwFlags", wt.DWORD)]
    mons = []

    def cb(h, dc, rc, data):
        mi = Info()
        mi.cbSize = ctypes.sizeof(Info)
        user32.GetMonitorInfoW(h, ctypes.byref(mi))
        r, w = mi.rcMonitor, mi.rcWork
        mons.append({"rect": [r.left, r.top, r.right - r.left, r.bottom - r.top], "taskbar_px": {"bottom": r.bottom - w.bottom, "top": w.top - r.top, "left": w.left - r.left, "right": r.right - w.right},
                     "primary": bool(mi.dwFlags & 1)})
        return 1
    proto = ctypes.WINFUNCTYPE(ctypes.c_int, wt.HMONITOR, wt.HDC, ctypes.POINTER(wt.RECT), wt.LPARAM)
    user32.EnumDisplayMonitors(None, None, proto(cb), 0)
    return mons


class Ledger:
    """窓を出した秒数の合計(試験をまたいで積む)。"""

    def __init__(self, path: Path):
        self.path = path
        self.seconds = json.loads(path.read_text(encoding="utf-8")).get("seconds", 0.0) if path.exists() else 0.0

    def check(self, planned: float):
        if planned > PER_WINDOW_SEC:
            raise SystemExit(f"窓を 1 回 {planned:.0f} 秒は出せない(上限 {PER_WINDOW_SEC:.0f} 秒)")
        if self.seconds + planned > BUDGET_SEC:
            raise SystemExit(f"窓の合計が上限を超える(使用 {self.seconds:.0f} 秒 + 予定 {planned:.0f} 秒 > {BUDGET_SEC:.0f} 秒)")

    def add(self, actual: float):
        self.seconds += actual
        self.path.write_text(json.dumps({"seconds": round(self.seconds, 2), "limit": BUDGET_SEC}), encoding="utf-8")


_WND_CLASS = "RealDotsOverlay"
_WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)
_overlays: dict = {}


class _WndClass(ctypes.Structure):
    _fields_ = [("style", wt.UINT), ("lpfnWndProc", _WNDPROC), ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int), ("hInstance", wt.HINSTANCE), ("hIcon", wt.HANDLE),
                ("hCursor", wt.HANDLE), ("hbrBackground", wt.HANDLE), ("lpszMenuName", wt.LPCWSTR), ("lpszClassName", wt.LPCWSTR)]


class _Paint(ctypes.Structure):
    _fields_ = [("hdc", wt.HDC), ("fErase", wt.BOOL), ("rcPaint", wt.RECT), ("fRestore", wt.BOOL), ("fIncUpdate", wt.BOOL), ("rgbReserved", ctypes.c_byte * 32)]


class _BmpInfo(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long), ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
                ("biSizeImage", wt.DWORD), ("x", ctypes.c_long), ("y", ctypes.c_long), ("a", wt.DWORD), ("b", wt.DWORD)]


user32.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.DefWindowProcW.restype = ctypes.c_ssize_t
user32.CreateWindowExW.restype = wt.HWND
user32.CreateWindowExW.argtypes = [wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.HWND, wt.HANDLE, wt.HINSTANCE, wt.LPVOID]
user32.GetDC.restype = wt.HDC
user32.GetDC.argtypes = [wt.HWND]
user32.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
user32.BeginPaint.restype = wt.HDC
user32.BeginPaint.argtypes = [wt.HWND, ctypes.POINTER(_Paint)]
user32.EndPaint.argtypes = [wt.HWND, ctypes.POINTER(_Paint)]
user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
user32.DestroyWindow.argtypes = [wt.HWND]
user32.SetLayeredWindowAttributes.argtypes = [wt.HWND, wt.COLORREF, ctypes.c_ubyte, wt.DWORD]
user32.PeekMessageW.argtypes = [ctypes.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT, wt.UINT]
gdi32 = ctypes.windll.gdi32
gdi32.SetDIBitsToDevice.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int, wt.DWORD, wt.DWORD, ctypes.c_int, ctypes.c_int, wt.UINT, wt.UINT, ctypes.c_char_p, ctypes.POINTER(_BmpInfo), wt.UINT]
gdi32.GetStockObject.restype = wt.HANDLE
WS_POPUP, WS_EX_LAYERED, WS_EX_TRANSPARENT = 0x80000000, 0x80000, 0x20
WM_PAINT, WM_ERASEBKGND = 0x000F, 0x0014


def _wndproc(hwnd, msg, wparam, lparam):
    ov = _overlays.get(hwnd)
    if msg == WM_PAINT:
        ps = _Paint()
        hdc = user32.BeginPaint(hwnd, ctypes.byref(ps))
        if ov is not None:
            ov._blit(hdc)
        user32.EndPaint(hwnd, ctypes.byref(ps))
        return 0
    if msg == WM_ERASEBKGND:
        return 1
    return user32.DefWindowProcW(hwnd, msg, wparam, lparam)


_wndproc_ref = _WNDPROC(_wndproc)
_class_ready = False


def _register_class():
    global _class_ready
    if _class_ready:
        return
    wc = _WndClass()
    wc.lpfnWndProc = _wndproc_ref
    wc.hInstance = ctypes.windll.kernel32.GetModuleHandleW(None)
    wc.hbrBackground = gdi32.GetStockObject(4)          # 黒
    wc.lpszClassName = _WND_CLASS
    if not ctypes.windll.user32.RegisterClassW(ctypes.byref(wc)):
        raise OSError("RegisterClassW が失敗")
    _class_ready = True


class Overlay:
    """最前面・枠なし・フォーカスを奪わない・マウスを通す窓(素の Win32。最初から NOACTIVATE で作るので、作った瞬間にも前面を奪わない。tkinter は作った瞬間に前面を奪った)。
    絵は 32 ビット(B,G,R,0)の bytes を set_frame で出す。fg0 は、窓を作る前に前面だったウィンドウで、出している間も同じかを focus_kept() で見る。"""

    def __init__(self, rect, fg0=None):
        _register_class()
        self.fg0 = fg0 if fg0 is not None else user32.GetForegroundWindow()
        self.rect = rect
        x, y, w, h = rect
        ex = WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_TRANSPARENT
        self.hwnd = user32.CreateWindowExW(ex, _WND_CLASS, "", WS_POPUP, x, y, w, h, None, None, ctypes.windll.kernel32.GetModuleHandleW(None), None)
        if not self.hwnd:
            raise OSError("CreateWindowExW が失敗")
        user32.SetLayeredWindowAttributes(self.hwnd, 0, 255, 2)
        _overlays[self.hwnd] = self
        self.frame = None
        self.shown_at = None
        self.bmi = _BmpInfo(40, w, -h, 1, 32, 0, 0, 0, 0, 0, 0)

    def _blit(self, hdc):
        if self.frame is not None:
            w, h = self.rect[2], self.rect[3]
            gdi32.SetDIBitsToDevice(hdc, 0, 0, w, h, 0, 0, 0, h, self.frame, ctypes.byref(self.bmi), 0)

    def show(self):
        x, y, w, h = self.rect
        user32.SetWindowPos(self.hwnd, wt.HWND(-1), x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW)
        user32.ShowWindow(self.hwnd, 4)                  # SW_SHOWNOACTIVATE
        self.shown_at = time.perf_counter()
        self.tick()

    def set_frame(self, data: bytes):
        self.frame = data
        hdc = user32.GetDC(self.hwnd)
        self._blit(hdc)
        user32.ReleaseDC(self.hwnd, hdc)
        self.tick()

    def tick(self):
        msg = wt.MSG()
        while user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

    def focus_kept(self):
        return user32.GetForegroundWindow() == self.fg0

    def close(self):
        try:
            _overlays.pop(self.hwnd, None)
            user32.DestroyWindow(self.hwnd)
        except Exception:
            pass


def to_bgr0(rgb: np.ndarray) -> bytes:
    """(h, w, 3) の RGB → (B, G, R, 0) の bytes。"""
    h, w, _ = rgb.shape
    out = np.zeros((h, w, 4), np.uint8)
    out[:, :, 0], out[:, :, 1], out[:, :, 2] = rgb[:, :, 2], rgb[:, :, 1], rgb[:, :, 0]
    return out.tobytes()


# ---------------------------------------------------------------- 探す: ArUco の盤

def aruco_dict():
    return cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_250)


def probe_layout(mon_index: int, mon_w: int):
    """盤の中の印の位置(窓の画素)。戻り: {id: (x, y)}(印の左上)、盤の絵。"""
    cols = min(mon_w // PROBE_PITCH, 24)
    img = np.full((PROBE_H, mon_w, 3), 255, np.uint8)
    pos = {}
    for r in range(PROBE_ROWS):
        for c in range(cols):
            mid = mon_index * 50 + r * cols + c
            m = cv2.aruco.generateImageMarker(aruco_dict(), mid, PROBE_SIDE)
            x, y = c * PROBE_PITCH + (PROBE_PITCH - PROBE_SIDE) // 2, 10 + r * PROBE_PITCH + (PROBE_PITCH - PROBE_SIDE) // 2
            img[y:y + PROBE_SIDE, x:x + PROBE_SIDE] = m[:, :, None]
            pos[mid] = (x, y)
    return pos, img


def video_size(path: Path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    w, h = r.stdout.strip().split(",")[:2]
    return int(w), int(h)


def read_frames(path: Path, w: int, h: int, vf: str = "null", fmt: str = "rgb24"):
    """HEVC の生ファイルを、1 コマずつ numpy で返す(vf で縮める場合の w,h は縮めたあとの大きさ)。"""
    cmd = ["ffmpeg", "-v", "error", "-f", "hevc", "-i", str(path), "-vf", vf, "-f", "rawvideo", "-pix_fmt", fmt, "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = w * h * 3
    try:
        while True:
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    finally:
        p.stdout.close()
        p.kill()
        p.wait()


def detect_board(hevc: Path, layouts, step: int = 3):
    """映像から ArUco の盤を探す。戻り: 見つかった印の最も多いコマの {id: 4 隅(カメラの画素)}、コマの大きさ、見つかった印の数の経過。"""
    w, h = video_size(hevc)
    det = cv2.aruco.ArucoDetector(aruco_dict(), cv2.aruco.DetectorParameters())
    best, counts = (0, None), []
    for i, fr in enumerate(read_frames(hevc, w, h, "null", "rgb24")):
        if i % step:
            continue
        corners, ids, _ = det.detectMarkers(cv2.cvtColor(fr, cv2.COLOR_RGB2GRAY))
        n = 0 if ids is None else len(ids)
        counts.append(n)
        if n > best[0]:
            best = (n, {int(k): c.reshape(4, 2) for k, c in zip(ids.ravel(), corners)})
    return best[1] or {}, (w, h), counts


def screen_to_camera(found, layouts, mon_rects):
    """見つけた印から、画面の画素 → カメラの画素のホモグラフィーを、モニターごとに解く。戻り: 印の数が最も多いモニターの情報。"""
    best = None
    for mi, (pos, _img) in layouts.items():
        mx, my, mw, mh = mon_rects[mi]
        ox, oy = mx, my + mh - PROBE_H
        src, dst, n = [], [], 0
        for mid, c in found.items():
            if mid not in pos:
                continue
            n += 1
            x, y = pos[mid]
            for (cx, cy), q in zip([(0, 0), (PROBE_SIDE, 0), (PROBE_SIDE, PROBE_SIDE), (0, PROBE_SIDE)], c):
                src.append((ox + x + cx, oy + y + cy))
                dst.append(q)
        if n >= 3 and (best is None or n > best["markers"]):
            s, d = np.array(src, np.float64), np.array(dst, np.float64)
            H, mask = cv2.findHomography(s, d, cv2.RANSAC, 3.0)
            if H is None:
                continue
            err = np.linalg.norm(cv2.perspectiveTransform(s[None], H)[0] - d, axis=1)
            best = {"monitor": mi, "markers": n, "H": H, "reproj_px_med": float(np.median(err)), "reproj_px_max": float(err.max())}
    return best


def apply_h(H, pts):
    return cv2.perspectiveTransform(np.asarray(pts, np.float64).reshape(1, -1, 2), H)[0]


def choose_window(H, cam_size, mon_rect):
    """カメラに全部映る窓(4.58:1)のうち、いちばん大きい物。戻り: [x, y, w, h](画面の画素)と、4 隅のカメラの縁からの余裕(画素)。"""
    cw, ch = cam_size
    mx, my, mw, mh = mon_rect
    m = EDGE_MARGIN * cw
    best = None
    for w in range(mw, 200, -20):
        h = int(round(w / RATIO))
        if h > mh:
            continue
        for y in range(my + mh - h - 8, my - 1, -16):
            for x in range(mx, mx + mw - w + 1, 24):
                q = apply_h(H, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
                room = min(q[:, 0].min(), cw - q[:, 0].max(), q[:, 1].min(), ch - q[:, 1].max())
                if room >= m and (best is None or room > best[1]):
                    best = ([x, y, w, h], float(room))
        if best:
            return best
    return None


# ---------------------------------------------------------------- iPad と Mac

def start_receiver(tag: str, seconds: int, log: Path):
    rx = f"~/sample_work/rx/real_dots_{tag}"
    ssh(f"rm -rf {rx} && mkdir -p {rx}")
    p = subprocess.Popen(["ssh", "-o", "ConnectTimeout=10", "pc3", f"python3 ~/sample_work/rx/pc_stream_receiver.py --out {rx} --port {PORT} --seconds {seconds}"],
                         stdout=open(log, "w"), stderr=subprocess.STDOUT)
    time.sleep(3)
    return p, rx


def launch_app(args):
    return ssh(f"xcrun devicectl device process launch --device {IPAD} --terminate-existing {BUNDLE} " + " ".join(f"'{x}'" for x in args) + " 2>&1 | tail -1").strip()


def stream_args(seconds: int, iso: int):
    return ["--auto-stream", str(seconds), "--exit-after-record", "--lock-exposure", "--iso", str(iso), "--pc-on", "--pc-host", MAC_LAN_IP, "--pc-port", str(PORT), "--pc-codec", "hevc",
            "--pc-width", "1920", "--pc-kbps", "18000", "--pc-fps", "30"]


def fetch_stream(rx: str, dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    for name in ("stream.hevc", "index.jsonl"):
        scp(f"pc3:sample_work/rx/{Path(rx).name}/{name}", str(dest / name))


def mac_clock_offset():
    """Mac の時計 - この PC の時計(秒)。往復の真ん中で合わせる。"""
    t0 = time.time()
    out = ssh("python3 -c 'import time;print(time.time())'").strip().splitlines()[-1]
    t1 = time.time()
    return float(out) - (t0 + t1) / 2


POLL_SH = ("mkdir -p /tmp/rd_poll && rm -f /tmp/rd_poll/*; i=0; end=$((SECONDS+{n})); while [ $SECONDS -lt $end ]; do "
           "a=$(python3 -c 'import time;print(time.time())'); "
           "xcrun devicectl device copy from --device {dev} --domain-type appDataContainer --domain-identifier {bundle} --source Documents/dot_rays.json --destination /tmp/rd_poll/r$i.json >/dev/null 2>&1; "
           "b=$(python3 -c 'import time;print(time.time())'); echo \"$i $a $b\" >> /tmp/rd_poll/times.txt; i=$((i+1)); done")


def start_poll(seconds: int):
    return subprocess.Popen(["ssh", "-o", "ConnectTimeout=10", "pc3", PATH + POLL_SH.format(n=seconds, dev=IPAD, bundle=BUNDLE)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def fetch_polls(dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    subprocess.run(["scp", "-q", "-r", "pc3:/tmp/rd_poll/.", str(dest)], check=False, timeout=120)


def mac_cleanup():
    ssh("rm -rf ~/sample_work/rx/real_dots_probe ~/sample_work/rx/real_dots_play /tmp/rd_poll")


# ---------------------------------------------------------------- 流す

def decode_events(video: Path, w: int, h: int, fps: int):
    """点の映像を窓の大きさに縮めて fps で全部デコードし、変わった所だけ別の bytes にする(窓を出す前に済ませる)。戻り: コマごとの bytes(変わらないコマは同じ物)。"""
    cmd = ["ffmpeg", "-v", "error", "-i", str(video), "-an", "-vf", f"fps={fps},scale={w}:{h}:flags=area", "-f", "rawvideo", "-pix_fmt", "bgr0", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = w * h * 4
    frames, last = [], None
    try:
        while True:
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            if buf != last:
                last = buf
            frames.append(last)
    finally:
        p.stdout.close()
        p.kill()
        p.wait()
    return frames


def play(overlay: Overlay, frames, fps: int):
    """frames をその時刻に出す。戻り: 出したコマごとの {i(動画のコマ), want(予定の秒), got(出し終えた秒)} と、全体の秒数。"""
    log, last_i, last_ph = [], -1, None
    n = len(frames)
    overlay.set_frame(frames[0])
    overlay.show()
    t0 = time.perf_counter()
    while True:
        now = time.perf_counter() - t0
        i = int(now * fps)
        if i >= n:
            break
        if i == last_i:
            time.sleep(0.001)
            continue
        ph = frames[i]
        if ph is not last_ph:
            overlay.set_frame(ph)
            last_ph = ph
        else:
            overlay.tick()
        log.append({"i": i, "want": i / fps, "got": time.perf_counter() - t0})
        last_i = i
    return log, time.perf_counter() - t0, t0


# ---------------------------------------------------------------- 測る

def cumulative_dot_time(n: int, k: int) -> float:
    """周 n・点 k の中ほどの時刻(動画の秒)。"""
    cycle = dv.SYNC + dv.GAP + 33 * dv.STEP + dv.TAIL
    return n * cycle + dv.SYNC + dv.GAP + k * dv.STEP + dv.ON / 2


def load_rays(poll_dir: Path, offset: float, t_video0_wall: float):
    """周ごとの dot_rays.json から、新しく出たレイを集める。戻り: レイ({dot, o, d, level, first_poll})の一覧と、accepted の最後の値。
    動画を始める前からあったレイは、前の試験の物なので捨てる。レベル(0=100%・1=60%・2=35%)は、そのレイが初めて見えた間に鳴った点の周で決める。"""
    rows = []
    tf = poll_dir / "times.txt"
    if not tf.exists():
        return [], None, 0
    for line in tf.read_text().splitlines():
        i, a, b = line.split()
        rows.append((int(i), float(a) - offset, float(b) - offset))
    rows.sort()
    seen, rays, accepted, prev_a = set(), [], None, None
    cycle = dv.SYNC + dv.GAP + 33 * dv.STEP + dv.TAIL
    for i, a, b in rows:
        f = poll_dir / f"r{i}.json"
        if not f.exists():
            continue
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        accepted = doc.get("accepted")
        before_video = b < t_video0_wall - 0.5
        for r in doc.get("rays") or []:
            key = (r["dot"], tuple(round(v, 5) for v in r["origin"]), tuple(round(v, 6) for v in r["direction"]))
            if key in seen:
                continue
            seen.add(key)
            if before_video:
                continue
            level = None
            for n in range(len(dv.LEVELS) - 1, -1, -1):
                c = t_video0_wall + cumulative_dot_time(n, r["dot"]) + 0.2        # 点が消えて、アプリがレイにするまで
                if (prev_a is None or c > prev_a - 0.5) and c <= b + 0.1:
                    level = n
                    break
            rays.append({"dot": int(r["dot"]), "o": np.array(r["origin"], np.float64), "d": np.array(r["direction"], np.float64), "level": level, "poll": i})
        prev_a = a
    return rays, accepted, len(rows)


def plane_points(dirs, f):
    """レイの向き(世界)を、向きの平均に垂直な平面へ投影する(1 の距離の平面。f を掛けてカメラの画素の大きさにする)。"""
    d = np.asarray(dirs, np.float64)
    m = d.mean(axis=0)
    m /= np.linalg.norm(m)
    u = np.cross(m, [0.0, 1.0, 0.0])
    if np.linalg.norm(u) < 1e-6:
        u = np.cross(m, [1.0, 0.0, 0.0])
    u /= np.linalg.norm(u)
    v = np.cross(m, u)
    dm = d @ m
    return np.stack([(d @ u) / dm, (d @ v) / dm], axis=1) * f


def fit_numbers(p, led, thr=INLIER_LED_PX, seed=0):
    """p(カメラの画素の大きさの平面の点)→ led(点の映像の px)のホモグラフィーを RANSAC で解く。戻り: H、内側の印、LED の px の残差、カメラの画素の残差。"""
    p, led = np.asarray(p, np.float64), np.asarray(led, np.float64)
    if len(p) < 8:
        return None
    cv2.setRNGSeed(seed)
    H, mask = cv2.findHomography(p, led, cv2.RANSAC, thr, maxIters=10000, confidence=0.9999)
    if H is None:
        return None
    inl = mask.ravel().astype(bool)
    for _ in range(3):
        if inl.sum() < 6:
            break
        H2, _ = cv2.findHomography(p[inl], led[inl], 0)
        if H2 is None:
            break
        H = H2
        inl = np.linalg.norm(apply_h(H, p) - led, axis=1) <= thr
    err_led = np.linalg.norm(apply_h(H, p) - led, axis=1)
    err_cam = np.linalg.norm(apply_h(np.linalg.inv(H), led) - p, axis=1)
    return H, inl, err_led, err_cam


def stats(x):
    x = np.asarray(x, np.float64)
    if len(x) == 0:
        return None
    return {"median": float(np.median(x)), "p90": float(np.percentile(x, 90)), "max": float(x.max())}


def level_report(rays, inl, err_led, err_cam):
    rep = []
    for lv, gain in enumerate(dv.LEVELS):
        idx = [i for i, r in enumerate(rays) if r["level"] == lv]
        dots = sorted({rays[i]["dot"] for i in idx})
        good = [k for k in dots if sum(inl[i] for i in idx if rays[i]["dot"] == k) * 2 >= sum(1 for i in idx if rays[i]["dot"] == k)]
        ok = [i for i in idx if inl[i]]
        rep.append({"gain": gain, "rays": len(idx), "dots": len(dots), "dots_correct": len(good), "dot_list": dots, "wrong_dots": sorted(set(dots) - set(good)),
                    "correct_frac": (len(good) / len(dots)) if dots else None, "led_px": stats(err_led[ok]) if ok else None, "cam_px": stats(err_cam[ok]) if ok else None})
    return rep


def camera_pose(index_rows, i0, i1):
    """動画のコマ i0〜i1 の姿勢と K(動画の画素)の中央値。戻り: 4x4(世界 ← カメラ)、[fx, fy, cx, cy]、位置のばらつき(m)、向きのばらつき(度)。"""
    rows = index_rows[i0:i1] or index_rows
    T = np.array([r["T"] for r in rows], np.float64)
    scale = rows[0]["w"] / SOURCE_WIDTH
    K = np.median(np.array([r["K"] for r in rows], np.float64), axis=0) * scale
    col_major = abs(T[0][3]) < 1e-9 and abs(T[0][7]) < 1e-9 and abs(T[0][11]) < 1e-9
    mats = [t.reshape(4, 4).T if col_major else t.reshape(4, 4) for t in T]
    M = mats[len(mats) // 2]
    pos = np.array([m[:3, 3] for m in mats])
    zs = np.array([m[:3, 2] for m in mats])
    ang = np.degrees(np.arccos(np.clip(zs @ M[:3, 2], -1, 1)))
    return M, K, float(np.linalg.norm(pos - np.median(pos, axis=0), axis=1).max()), float(ang.max())


def project_dirs(dirs, M, K):
    """世界の向き → 動画の画素。DotCalibrator.swift の逆(dc = ((u-cx)/fx, -(v-cy)/fy, -1))。"""
    dc = np.asarray(dirs, np.float64) @ M[:3, :3]
    fx, fy, cx, cy = K
    return np.stack([cx + fx * dc[:, 0] / -dc[:, 2], cy - fy * dc[:, 1] / -dc[:, 2]], axis=1)


def sync_from_camera(hevc: Path, index_rows, roi_quad, cam_size):
    """映像の中の窓の範囲の「緑らしさ」から、合図(全面の緑)の始まりの時刻と、色(明るさの段ごと)を測る。"""
    w, h = cam_size
    sw = 640
    sh = int(round(h * sw / w))
    mask = np.zeros((sh, sw), np.uint8)
    cv2.fillConvexPoly(mask, np.round(np.asarray(roi_quad) * sw / w).astype(np.int32), 255)
    ii = np.nonzero(mask)
    if len(ii[0]) < 20:
        return None
    g, rgbs = [], []
    for fr in read_frames(hevc, sw, sh, f"scale={sw}:{sh}:flags=area", "rgb24"):
        px = fr[ii].astype(np.float32)
        rgbs.append(px.mean(axis=0))
        g.append(float((px[:, 1] - np.maximum(px[:, 0], px[:, 2])).mean()))
    n = min(len(g), len(index_rows))
    g, rgbs = np.array(g[:n]), np.array(rgbs[:n])
    ts = np.array([r["ar_ts"] for r in index_rows[:n]])
    hi = np.percentile(g, 99.5)
    if hi < 8:
        return {"edges": [], "g_peak": float(hi), "roi_area_cells": int(len(ii[0]) * (w / sw) ** 2 / (w / 240) ** 2)}
    on = g > hi * 0.5
    edges, runs = [], []
    i = 0
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]:
                j += 1
            if 0.2 <= ts[j - 1] - ts[i] + 1 / 30 <= 0.7:
                edges.append(float(ts[i]))
                runs.append((i, j))
            i = j
        else:
            i += 1
    colors = [[float(v) for v in rgbs[a:b].max(axis=0)] for a, b in runs]
    return {"edges": edges, "intervals": [round(b - a, 3) for a, b in zip(edges, edges[1:])], "colors_rgb": colors, "g_peak": float(hi),
            "roi_area_cells": int(len(ii[0]) * (w / sw) ** 2 / (w / 240) ** 2)}


def emulate_app(hevc: Path, index_rows, cam_size, gate_as_is: bool):
    """DotCalibrator.swift の判定(点の見つけ方 → 合図からの時間で番号 → レイ)を、録画した映像に当てた写し。映像は 240×135 の格子(最近傍)で見る。
    gate_as_is=True は、アプリのソースのまま(確定の判定 `k < total` の total が、その 1 コマの候補マスの数)。False は、点の数 33 で比べる直し。
    戻り: レイの一覧({dot, o, d, level})。アプリそのものではない(映像は符号化済み・同じ姿勢と K)。"""
    gw, gh = 240, 135
    w, h = cam_size
    T = [np.array(r["T"], np.float64) for r in index_rows]
    col_major = abs(T[0][3]) < 1e-9 and abs(T[0][7]) < 1e-9 and abs(T[0][11]) < 1e-9
    T = [t.reshape(4, 4).T if col_major else t.reshape(4, 4) for t in T]
    scale = index_rows[0]["w"] / SOURCE_WIDTH
    cmd = ["ffmpeg", "-v", "error", "-f", "hevc", "-i", str(hevc), "-vf", f"scale={gw}:{gh}:flags=neighbor", "-f", "rawvideo", "-pix_fmt", "yuv444p", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = gw * gh * 3
    base = None
    in_event, quiet, frames, sync_end, in_sync, sync_start, syncs = False, 0, [], None, False, 0.0, 0
    rays, rejects = [], {}
    i = 0
    try:
        while i < len(index_rows):
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            Y, Cb, Cr = np.frombuffer(buf, np.uint8).reshape(3, gh, gw).astype(np.float32)
            chroma = np.maximum(0, 128 - Cb) + np.maximum(0, 128 - Cr)
            if base is None:
                base = chroma.copy()
            cand = (Y >= 70) & (chroma >= 70) & (Cb < 118) & (Cr < 118) & (base < 40)
            base = base * (1 - np.where(cand, 0.01, 0.05)) + chroma * np.where(cand, 0.01, 0.05)
            total = int(cand.sum())
            ts = index_rows[i]["ar_ts"]
            blob = None
            if total < 800:
                n, _lab, st, cen = cv2.connectedComponentsWithStats(cand.astype(np.uint8), connectivity=8)
                for k in range(1, n):
                    bx, by, bw, bh, area = st[k]
                    if 6 <= area <= 400 and 0.6 <= bw / bh <= 1.7 and area / (bw * bh) >= 0.55 and (blob is None or area > blob[0]):
                        blob = (int(area), float(cen[k][0]) + 0.5, float(cen[k][1]) + 0.5)
            if total >= 800:
                if not in_sync:
                    sync_start = ts
                in_sync, in_event, frames = True, False, []
            else:
                if in_sync:
                    in_sync = False
                    if 0.25 <= ts - sync_start <= 0.6:
                        sync_end, syncs = ts, syncs + 1
                if blob:
                    if not in_event:
                        in_event, frames = True, []
                    quiet = 0
                    frames.append((blob[1] * w / gw, blob[2] * h / gh, ts, T[i], index_rows[i]["K"]))
                elif in_event:
                    quiet += 1
                    if quiet >= 2:
                        in_event = False
                        fr, frames = frames, []
                        limit = total if gate_as_is else 33
                        if len(fr) < 2 or sync_end is None:
                            rejects["合図の前・コマが少ない"] = rejects.get("合図の前・コマが少ない", 0) + 1
                        elif fr[-1][2] - fr[0][2] > 0.35:
                            rejects["0.35 秒より長い"] = rejects.get("0.35 秒より長い", 0) + 1
                        else:
                            f0, f1 = fr[0][3], fr[-1][3]
                            moved = float(np.linalg.norm(f1[:3, 3] - f0[:3, 3]))
                            ang = float(np.arccos(np.clip((np.trace(f0[:3, :3].T @ f1[:3, :3]) - 1) / 2, -1, 1)))
                            mid = (fr[0][2] + fr[-1][2]) / 2
                            q = (mid - sync_end - 0.4 - 0.1) / 0.3
                            k = int(round(q))
                            if moved > 0.03 or ang > np.radians(2):
                                rejects["カメラが動いた"] = rejects.get("カメラが動いた", 0) + 1
                            elif abs(q - k) * 0.3 > 0.08 or k < 0 or k >= limit:
                                key = "番号の判定 k < total で落ちた" if (gate_as_is and 0 <= k < 33 and abs(q - k) * 0.3 <= 0.08) else "時刻が合わない"
                                rejects[key] = rejects.get(key, 0) + 1
                            else:
                                cx, cy, _ts, M, K0 = fr[len(fr) // 2]
                                fx, fy, ccx, ccy = [v * scale for v in K0]
                                dc = np.array([(cx - ccx) / fx, -(cy - ccy) / fy, -1.0, 0.0])
                                d = (M @ dc)[:3]
                                rays.append({"dot": k, "o": M[:3, 3].copy(), "d": d / np.linalg.norm(d), "level": min(max(syncs - 1, 0), len(dv.LEVELS) - 1), "poll": None})
            i += 1
    finally:
        p.stdout.close()
        p.kill()
        p.wait()
    return rays, {"syncs": syncs, "rejects": rejects, "rays": len(rays), "dots": len({r["dot"] for r in rays})}


def pose_in_range(index_rows, t_a, t_b):
    """ar_ts が [t_a, t_b) のコマの姿勢と K(動画の画素)。コマが無ければ None。"""
    ids = [i for i, r in enumerate(index_rows) if t_a <= r["ar_ts"] < t_b]
    if len(ids) < 3:
        return None
    M, K, jm, jd = camera_pose(index_rows, ids[0], ids[-1] + 1)
    return M, K


def measure(rays, table, poses, exp_cam, cam_size):
    """レイの一覧 → 番号の正しさ(RANSAC)・段ごとの数字・窓の位置からの予想との比べ。
    固定のカメラでも ARKit の世界の向きは周の間で数度ずれる(実測 2.5〜3.5°)ので、ホモグラフィーは周(明るさの段)ごとに解く。8 本に満たない段は判定しない。
    poses: {段: (姿勢, K)} と、段が分からないレイ用の None 番。戻り: レイが 1 本も判定できなければ None。"""
    n = len(rays)
    inl, err_led, err_cam = np.zeros(n, bool), np.full(n, np.nan), np.full(n, np.nan)
    judged, hp, drift = np.zeros(n, bool), np.zeros((n, 2)), {}
    dirs = np.array([r["d"] for r in rays]) if n else np.zeros((0, 3))
    led = np.array([[table[r["dot"]]["px"], table[r["dot"]]["py"]] for r in rays]) if n else np.zeros((0, 2))
    f_of = lambda lv: float(poses.get(lv, poses[None])[1][0])        # noqa: E731
    groups = {}
    for i, r in enumerate(rays):
        groups.setdefault(r["level"], []).append(i)
    mean_dir = {}
    for lv, ix in groups.items():
        mean_dir[lv] = dirs[ix].mean(axis=0) / np.linalg.norm(dirs[ix].mean(axis=0))
        fit = fit_numbers(plane_points(dirs[ix], f_of(lv)), led[ix]) if len(ix) >= 8 else None
        if fit is None:
            continue
        H, gi, el, ec = fit
        for j, i in enumerate(ix):
            inl[i], err_led[i], err_cam[i], judged[i] = gi[j], el[j], ec[j], True
        hp[ix] = apply_h(H, plane_points(dirs[ix], f_of(lv)))
    if not judged.any():
        return None
    base_lv = min(k for k in mean_dir if k is not None) if any(k is not None for k in mean_dir) else None
    if base_lv is not None:
        for lv, m in mean_dir.items():
            if lv is not None:
                drift[lv] = float(np.degrees(np.arccos(np.clip(m @ mean_dir[base_lv], -1, 1))))
    # 参考: 全部を 1 つのホモグラフィーで解くと(周の間の向きのずれのぶん)どうなるか
    one = fit_numbers(plane_points(dirs, float(poses[None][1][0])), led) if n >= 8 else None
    levels = level_report(rays, np.where(judged, inl, False), np.nan_to_num(err_led), np.nan_to_num(err_cam))
    all_dots = sorted({r["dot"] for r in rays})
    dot_ok = {}
    for k in all_dots:
        ix = [i for i, r in enumerate(rays) if r["dot"] == k and judged[i]]
        dot_ok[k] = bool(ix) and sum(inl[i] for i in ix) * 2 >= len(ix)
    n_ok = sum(dot_ok.values())
    ray_cam = np.zeros((n, 2))
    for lv, ix in groups.items():
        M, K = poses.get(lv, poses[None])
        ray_cam[ix] = project_dirs(dirs[ix], M, K)
    near_ok, err_pose = 0, []
    for r, uv in zip(rays, ray_cam):
        dist = np.linalg.norm(exp_cam - uv, axis=1)
        err_pose.append(float(dist[r["dot"]]))
        near_ok += int(np.argmin(dist) == r["dot"])
    visible = [k for k, c in enumerate(exp_cam) if 0 <= c[0] < cam_size[0] and 0 <= c[1] < cam_size[1]]
    ok = judged & inl
    summary = {"dots_picked": len(all_dots), "dots_correct": n_ok, "dots_correct_frac": n_ok / len(all_dots), "rays": n, "rays_judged": int(judged.sum()), "rays_inlier": int(ok.sum()),
               "wrong_dots": sorted(k for k, v in dot_ok.items() if not v), "visible_expected": len(visible), "led_px": stats(err_led[ok]), "cam_px": stats(err_cam[ok]),
               "inlier_thr_led_px": INLIER_LED_PX, "cycle_direction_drift_deg": drift,
               "one_homography_for_all_cycles": None if one is None else {"inliers": int(one[1].sum()), "rays": n, "led_px_median": float(np.median(one[2]))},
               "pose_check": {"rays_nearest_expected_is_own_dot": near_ok, "rays": n, "err_cam_px": stats(err_pose)}}
    return {"summary": summary, "levels": levels, "dot_ok": dot_ok, "inl": ok, "hp": hp, "ray_cam": ray_cam, "rays": rays}


def print_measure(tag, m):
    s = m["summary"]
    print(f"[{tag}] 拾えた点 {s['dots_picked']}/33(窓の内に映る予想 {s['visible_expected']})、番号が正しい {s['dots_correct']}/{s['dots_picked']} = {s['dots_correct_frac'] * 100:.0f}%、"
          f"内側の残差 LED {s['led_px']['median']:.1f} px・カメラ {s['cam_px']['median']:.1f} px(周ごとに解く。内側 {s['rays_inlier']}/{s['rays']} 本)")
    pc = s["pose_check"]
    print(f"[{tag}] 窓の位置からの予想との比べ: 自分の番号がいちばん近い {pc['rays_nearest_expected_is_own_dot']}/{pc['rays']} 本、差の中央値 {pc['err_cam_px']['median']:.1f} 画素")
    one = s["one_homography_for_all_cycles"]
    print(f"[{tag}] 周の間の向きのずれ(度、100% の周から) {({k: round(v, 2) for k, v in s['cycle_direction_drift_deg'].items()})}。全部を 1 つで解くと内側 {one['inliers']}/{one['rays']} 本(中央値 {one['led_px_median']:.0f} px)" if one else "")
    for lv in m["levels"]:
        print(f"[{tag}]   明るさ {lv['gain'] * 100:.0f}%: 拾えた {lv['dots']}/33、正しい {lv['dots_correct']}(レイ {lv['rays']} 本)、残差 LED {lv['led_px']}、カメラ {lv['cam_px']}")


# ---------------------------------------------------------------- 絵

def draw_result(path: Path, res: dict):
    """点の位置だけの絵(カメラの絵は入れない)。上: 点の映像の上(丸=点・×=レイの投影)、下: カメラの画素の上(丸=窓から予想した位置・×=レイの投影)と、段ごとの数字。"""
    from PIL import Image, ImageDraw, ImageFont
    W = 2400
    fs = 76                                           # 絵の幅の 3% 以上
    font = ImageFont.truetype(FONT, fs)
    pad = 100
    pw = W - 2 * pad
    sc = pw / dv.W
    ph = int(dv.H * sc)
    cam_w, cam_h = res["camera_size"]
    cs = 1000 / cam_w
    cph = int(cam_h * cs)
    rows_txt = res["table"]
    note = res.get("note") or ""
    H = (fs + 20 if note else 0) + 40 + fs + 30 + fs + 20 + ph + 40 + fs + 20 + max(cph, 4 * (fs + 14)) + 40 + (len(rows_txt) + 1) * (fs + 16) + 40
    im = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(im)
    GOOD, BAD, NONE, INK = (0, 130, 70), (215, 40, 40), (150, 150, 150), (20, 20, 20)
    y = 40
    d.text((pad, y), res["title"], font=font, fill=INK)
    y += fs + 30
    if note:
        d.text((pad, y), note, font=font, fill=(215, 40, 40))
        y += fs + 20
    d.text((pad, y), "丸=点の映像の点  ×=レイの向きの投影", font=font, fill=INK)
    y += fs + 20
    top = y
    d.rectangle([pad, top, pad + pw, top + ph], outline=INK, width=3)
    status = res["dot_status"]
    for k, dot in enumerate(dv.dots()):
        cx, cy = pad + dot["px"] * sc, top + dot["py"] * sc
        col = {"good": GOOD, "bad": BAD}.get(status.get(str(k)), NONE)
        r = max(10, dot["rx"] * sc)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=6)
        if status.get(str(k)) == "bad":
            d.text((cx + r + 4, cy - fs / 2), str(k), font=font, fill=BAD)
    for pr in res["ray_led_px"]:
        cx, cy = pad + pr["x"] * sc, top + pr["y"] * sc
        col = GOOD if pr["inlier"] else BAD
        dot = dv.dots()[pr["dot"]]
        d.line([cx, cy, pad + dot["px"] * sc, top + dot["py"] * sc], fill=col, width=3)
        d.line([cx - 14, cy - 14, cx + 14, cy + 14], fill=INK, width=5)
        d.line([cx - 14, cy + 14, cx + 14, cy - 14], fill=INK, width=5)
    y = top + ph + 40
    d.text((pad, y), "カメラの画素の上(枠=映像)", font=font, fill=INK)
    y += fs + 20
    cx0, cy0 = pad, y
    d.rectangle([cx0, cy0, cx0 + cam_w * cs, cy0 + cam_h * cs], outline=INK, width=3)
    q = res.get("window_quad_cam")
    if q:
        d.polygon([(cx0 + a * cs, cy0 + b * cs) for a, b in q], outline=(120, 120, 120))
    for pt in res.get("expected_cam") or []:
        col = {"good": GOOD, "bad": BAD}.get(status.get(str(pt["dot"])), NONE)
        d.ellipse([cx0 + pt["x"] * cs - 9, cy0 + pt["y"] * cs - 9, cx0 + pt["x"] * cs + 9, cy0 + pt["y"] * cs + 9], outline=col, width=4)
    for pt in res.get("ray_cam") or []:
        x, yy = cx0 + pt["x"] * cs, cy0 + pt["y"] * cs
        d.line([x - 10, yy - 10, x + 10, yy + 10], fill=INK, width=4)
        d.line([x - 10, yy + 10, x + 10, yy - 10], fill=INK, width=4)
    lx = cx0 + 1000 + 60
    for i, (txt, col) in enumerate([("緑=番号が正しい", GOOD), ("赤=番号がずれた", BAD), ("灰=拾えず", NONE), ("枠=窓の範囲", (120, 120, 120))]):
        d.text((lx, cy0 + i * (fs + 14)), txt, font=font, fill=col)
    y = cy0 + max(int(cam_h * cs), 4 * (fs + 14)) + 40
    for line in rows_txt:
        d.text((pad, y), line, font=font, fill=INK)
        y += fs + 16
    im = im.crop((0, 0, W, y + 30))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, quality=90)


# ---------------------------------------------------------------- 自己試験

def selftest():
    """合成: 3 面の点を、平らな画面を斜めに見たカメラで拾ったことにして、番号を 3 つずらした点が外れになるかを確かめる。"""
    rng = np.random.default_rng(3)
    table = dv.dots()
    led = np.array([[d["px"], d["py"]] for d in table])
    f = 1540.0
    Hs = np.array([[0.00022, 0.00003, -0.55], [-0.00002, 0.00021, -0.2], [0.0000002, 0.0000001, 1.0]])   # LED の px → 平面(1 の距離)
    plane = apply_h(Hs, led)
    dirs = np.c_[plane, np.ones(len(plane))]
    dirs /= np.linalg.norm(dirs, axis=1)[:, None]
    labels = list(range(33))
    wrong = {5, 17, 28}
    for k in wrong:
        labels[k] = (k + 1) % 33                               # 番号が 1 つずれた
    noisy = dirs + rng.normal(0, 0.0003, dirs.shape)
    p = plane_points(noisy, f)
    shown = np.array([led[labels[k]] for k in range(33)])
    fit = fit_numbers(p, shown)
    ok = fit is not None
    found = set(np.nonzero(~fit[1])[0]) if ok else set()
    print("合格" if ok and found == wrong else "不合格", "番号がずれた点を外れにできる", sorted(found), "期待", sorted(wrong), "残差(LED px)", None if not ok else round(float(np.median(fit[2][fit[1]])), 1))
    fit0 = fit_numbers(p, led)
    ok0 = fit0 is not None and fit0[1].all()
    print("合格" if ok0 else "不合格", "ずれが無ければ全部が内側", None if fit0 is None else int(fit0[1].sum()))
    M = np.eye(4)
    K = [f, f, 960.0, 720.0]
    uv = project_dirs(np.array([[0.0, 0.0, -1.0], [0.1, 0.0, -1.0]]), M, K)
    ok1 = abs(uv[0][0] - 960) < 1e-6 and abs(uv[1][0] - (960 + f * 0.1)) < 1e-6 and abs(uv[1][1] - 720) < 1e-6
    print("合格" if ok1 else "不合格", "向き → 画素の向きの約束(右が +u、上が -v)")
    return ok and found == wrong and ok0 and ok1


# ---------------------------------------------------------------- 本体

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", help="作業フォルダ(例: work/_stream/real_dots)")
    ap.add_argument("--iso", type=int, default=50)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--probe-seconds", type=float, default=5.0)
    ap.add_argument("--probe-only", action="store_true", help="窓の置き場所を決めるところまで(流さない)。試作用")
    ap.add_argument("--skip-probe", action="store_true", help="前の placement.json を使う(窓の秒数を節約。試作用)")
    ap.add_argument("--analyze-only", action="store_true", help="窓も iPad も使わず、残っている記録(--keep-camera の物)だけ測り直す")
    ap.add_argument("--keep-camera", action="store_true", help="カメラの映像を消さない(試作用。本番は付けない)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--jpg", default=str(RESULT_JPG))
    a = ap.parse_args()
    if a.selftest:
        sys.exit(0 if selftest() else 1)
    if not a.out:
        ap.error("--out が要る")
    ctypes.windll.user32.SetProcessDPIAware()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    probe_dir, play_dir, poll_dir = out / "probe", out / "play", out / "poll"
    ledger = Ledger(out / "window_ledger.json")
    video = next(iter(VIDEO_DIR.glob(VIDEO_NAME)), None) or next(iter(Path(r"work\hackathon").rglob(VIDEO_NAME)), None)
    if video is None:
        raise SystemExit(f"{VIDEO_NAME} が見つからない(make_led_dots_video.py で作る)")
    print("点の映像:", video)
    res: dict = {"video": str(video), "fps": a.fps, "iso": a.iso}
    try:
        code = run(a, out, probe_dir, play_dir, poll_dir, ledger, video, res)
    except SystemExit:
        raise
    except Exception as e:                                   # noqa: BLE001
        import traceback
        traceback.print_exc()
        res["error"] = repr(e)
        code = 2
    finally:
        (out / "result.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
        if not a.keep_camera and not a.analyze_only:
            for dpath in (probe_dir, play_dir):
                shutil.rmtree(dpath, ignore_errors=True)
            shutil.rmtree(poll_dir, ignore_errors=True)
            try:
                mac_cleanup()
            except Exception as e:                           # noqa: BLE001
                print("Mac の記録を消せなかった:", e)
            print("カメラの映像を消した:", [str(p) for p in (probe_dir, play_dir) if p.exists()] or "残り 0")
    print("窓を出した合計:", round(ledger.seconds, 1), "秒")
    sys.exit(code)


def run(a, out, probe_dir, play_dir, poll_dir, ledger, video, res):
    monitors = list_monitors()
    res["monitors"] = monitors
    print("モニター:", [(m["rect"], "タスクバー下 %d" % m["taskbar_px"]["bottom"]) for m in monitors])
    rects = [m["rect"] for m in monitors]
    place_file = out / "placement.json"
    # ---- ①映る場所を探す
    if a.analyze_only or a.skip_probe:
        place = json.loads(place_file.read_text(encoding="utf-8"))
        Hs = np.array(place["H"])
    else:
        layouts = {i: probe_layout(i, r[2]) for i, r in enumerate(rects)}
        ledger.check(a.probe_seconds)
        Hs = None
        server, rx = start_receiver("probe", 30, out / "probe_rx.log")
        overlays = []
        try:
            print("起動:", launch_app(stream_args(16, a.iso)))
            time.sleep(7)
            fg0 = user32.GetForegroundWindow()
            for i, r in enumerate(rects):
                ov = Overlay([r[0], r[1] + r[3] - PROBE_H, r[2], PROBE_H], fg0=fg0)
                overlays.append((ov, to_bgr0(layouts[i][1][:, :, ::-1])))
            t_show = time.perf_counter()
            for ov, fr in overlays:
                ov.show()
                ov.set_frame(fr)
            while time.perf_counter() - t_show < a.probe_seconds:
                overlays[0][0].tick()
                time.sleep(0.02)
            focus = all(ov.focus_kept() for ov, _ in overlays)
        finally:
            used = 0.0
            for ov, _ in overlays:
                if ov.shown_at:
                    used = max(used, time.perf_counter() - ov.shown_at)
                ov.close()
            ledger.add(used)
        res["probe"] = {"seconds": round(used, 2), "focus_kept": focus}
        print(f"ArUco の窓を {used:.1f} 秒出して消した(フォーカス {'そのまま' if focus else '動いた!'})")
        try:
            server.wait(timeout=60)
        except subprocess.TimeoutExpired:
            server.terminate()
        fetch_stream(rx, probe_dir)
        found, cam_size, counts = detect_board(probe_dir / "stream.hevc", layouts)
        res["probe"].update({"camera_size": cam_size, "markers_found": len(found), "markers_over_frames": counts})
        print("映像の大きさ", cam_size, "見つかった印", len(found), "(コマごとの最大", max(counts) if counts else 0, ")")
        info = screen_to_camera(found, layouts, rects) if found else None
        if not info:
            res["error"] = "ArUco の印が見つからない(カメラにどのモニターも映らない、または印が小さい)"
            return 2
        Hs = info["H"]
        mi = info["monitor"]
        win = choose_window(Hs, cam_size, rects[mi])
        res["probe"].update({"monitor": mi, "monitor_rect": rects[mi], "markers_on_monitor": info["markers"], "reproj_px_med": info["reproj_px_med"], "reproj_px_max": info["reproj_px_max"]})
        print(f"カメラに映るのはモニター {mi}{rects[mi]}、印 {info['markers']} 個、再投影 中央値 {info['reproj_px_med']:.2f} px・最大 {info['reproj_px_max']:.2f} px")
        if not win:
            res["error"] = "カメラの範囲に窓が収まらない"
            return 2
        rect, room = win
        place = {"monitor": mi, "monitor_rect": rects[mi], "window": rect, "room_px": room, "camera_size": list(cam_size), "H": Hs.tolist()}
        place_file.write_text(json.dumps(place), encoding="utf-8")
    rect = place["window"]
    cam_size = tuple(place["camera_size"])
    quad = apply_h(Hs, [(rect[0], rect[1]), (rect[0] + rect[2], rect[1]), (rect[0] + rect[2], rect[1] + rect[3]), (rect[0], rect[1] + rect[3])])
    area = abs(cv2.contourArea(quad.astype(np.float32))) / (cam_size[0] * cam_size[1])
    scr = lambda px, py: (rect[0] + px * rect[2] / dv.W, rect[1] + py * rect[3] / dv.H)       # noqa: E731
    table = dv.dots()
    exp_cam = apply_h(Hs, [scr(d["px"], d["py"]) for d in table])
    # 点の大きさ(カメラの画素)。アプリは 240×135 の格子で 6 マス以上の塊を点とする
    diam = []
    for d, c in zip(table, exp_cam):
        e = apply_h(Hs, [scr(d["px"] - d["rx"], d["py"]), scr(d["px"] + d["rx"], d["py"])])
        diam.append(float(np.linalg.norm(e[1] - e[0])))
    res["placement"] = {"window": rect, "window_area_frac": float(area), "window_area_cells": float(area * 240 * 135), "dot_diameter_cam_px": {"min": min(diam), "max": max(diam)},
                        "cells_for_sync": 800, "monitor": place["monitor"], "camera_size": list(cam_size)}
    print(f"窓 {rect[2]}×{rect[3]} を画面の ({rect[0]}, {rect[1]}) に。映像の {area * 100:.1f}%({area * 240 * 135:.0f} マス。合図は 800 マス以上が要る)、点の直径 {min(diam):.0f}〜{max(diam):.0f} 画素(映像)")
    if a.probe_only:
        return 0
    # ---- ②③流す
    play_dir.mkdir(parents=True, exist_ok=True)
    if not a.analyze_only:
        plan = dv.SYNC + dv.GAP + 33 * dv.STEP + dv.TAIL
        seconds_video = plan * len(dv.LEVELS)
        ledger.check(seconds_video + 2)
        total_run = int(seconds_video + 30)
        t = time.perf_counter()
        frames = decode_events(video, rect[2], rect[3], a.fps)          # 重いので、窓も受け手も立てる前に済ませる
        print(f"デコード {len(frames)} コマ、{time.perf_counter() - t:.1f} 秒")
        offset = mac_clock_offset()
        server, rx = start_receiver("play", total_run + 20, out / "play_rx.log")
        ov = Overlay(rect)
        try:
            args = stream_args(total_run, a.iso) + ["--ar-on", "--ar-url", PAGE, "--dot-calib"]
            launch_wall = time.time()
            print("起動:", launch_app(args))
            poller = start_poll(total_run - 4)
            time.sleep(max(0.0, 11 - (time.time() - launch_wall)))
            wall0 = time.time()
            log, took, _t0 = play(ov, frames, a.fps)
            focus = ov.focus_kept()
        finally:
            used = (time.perf_counter() - ov.shown_at) if ov.shown_at else 0.0
            ov.close()
            ledger.add(used)
        print(f"点の窓を {used:.1f} 秒出して消した(フォーカス {'そのまま' if focus else '動いた!'})")
        late = np.array([r["got"] - r["want"] for r in log]) * 1000
        res["window"] = {"seconds": round(used, 2), "focus_kept": focus, "frames_total": len(frames), "frames_shown": len(log), "video_seconds": round(took, 3),
                         "effective_fps": round(len(log) / took, 2), "late_ms": {"median": float(np.median(late)), "p95": float(np.percentile(late, 95)), "max": float(late.max())},
                         "late_over_1frame": int((late > 1000 / a.fps).sum()), "t_video0_wall": wall0}
        print("窓の時刻:", res["window"])
        try:
            server.wait(timeout=total_run + 60)
        except subprocess.TimeoutExpired:
            server.terminate()
        poller.wait(timeout=60)
        fetch_stream(rx, play_dir)
        fetch_polls(poll_dir)
        res["clock_offset_s"] = offset
    # ---- ④測る
    if a.analyze_only:
        prev = json.loads((out / "result.json").read_text(encoding="utf-8"))
        res["window"], res["clock_offset_s"] = prev["window"], prev["clock_offset_s"]
    wall0 = res["window"]["t_video0_wall"]
    offset = res["clock_offset_s"]
    rays, accepted, n_polls = load_rays(poll_dir, offset, wall0)
    res["rays"] = {"total": len(rays), "polls": n_polls, "page_accepted": accepted, "level_unknown": sum(1 for r in rays if r["level"] is None)}
    print(f"周ごとの取得 {n_polls} 回、新しいレイ {len(rays)} 本、ページの accepted={accepted}")
    index_rows = [json.loads(x) for x in (play_dir / "index.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    cam = sync_from_camera(play_dir / "stream.hevc", index_rows, quad, cam_size)
    res["camera_sync"] = cam
    if cam and cam.get("edges"):
        print("カメラで見た合図:", [round(e - cam["edges"][0], 2) for e in cam["edges"]], "間隔", cam.get("intervals"), "(期待 11.4)")
        res["camera_sync"]["rgb_note"] = "窓の範囲の平均 RGB の最大(合図の間)。緑が白く飛ぶと R・B も上がる"
    else:
        print("カメラで合図が見えなかった:", cam)
    # 姿勢: 動画の最初の合図〜最後の頃のコマ
    i0 = int(len(index_rows) * 0.3)
    i1 = int(len(index_rows) * 0.9)
    M, K, jitter_m, jitter_deg = camera_pose(index_rows, i0, i1)
    res["pose"] = {"K_video_px": [float(v) for v in K], "position_jitter_m": jitter_m, "rotation_jitter_deg": jitter_deg}
    # アプリの判定の写し(アプリのソースのまま / 直したもの)。実機が 0 本のときの原因を見るため、いつも測る
    as_is_rays, as_is_info = emulate_app(play_dir / "stream.hevc", index_rows, cam_size, gate_as_is=True)
    fixed_rays, fixed_info = emulate_app(play_dir / "stream.hevc", index_rows, cam_size, gate_as_is=False)
    res["port"] = {"as_is": as_is_info, "fixed": fixed_info}
    print(f"アプリの判定の写し: ソースのまま {as_is_info['dots']} 点({as_is_info['rays']} 本、落ちた理由 {as_is_info['rejects']})、点の数 33 で比べる直し {fixed_info['dots']} 点({fixed_info['rays']} 本)")
    poses = {None: (M, K)}                                           # 周ごとの姿勢(合図の時刻から 1 周分のコマ)。ARKit の世界は周の間でずれる
    if cam and cam.get("edges"):
        cyc = dv.SYNC + dv.GAP + 33 * dv.STEP + dv.TAIL
        for lv, e in enumerate(cam["edges"][:len(dv.LEVELS)]):
            got = pose_in_range(index_rows, e, e + cyc)
            if got:
                poses[lv] = got
    res["pose_by_cycle"] = {str(k): {"K_video_px": [float(v) for v in v_[1]]} for k, v_ in poses.items() if k is not None}
    device = measure(rays, table, poses, exp_cam, cam_size)
    port = measure(fixed_rays, table, poses, exp_cam, cam_size)
    visible = [k for k, c in enumerate(exp_cam) if 0 <= c[0] < cam_size[0] and 0 <= c[1] < cam_size[1]]
    res["device"] = device["summary"] if device else {"dots_picked": len({r["dot"] for r in rays}), "rays": len(rays), "visible_expected": len(visible)}
    res["device_levels"] = device["levels"] if device else None
    res["port_fixed"] = port["summary"] if port else None
    res["port_fixed_levels"] = port["levels"] if port else None
    if device:
        print_measure("実機", device)
    else:
        print(f"[実機] レイが {len(rays)} 本(8 本未満)で解けない。拾えた点 {len({r['dot'] for r in rays})}/33(窓の内に映る予想 {len(visible)})")
    if port:
        print_measure("写し(直し)", port)
    shown = device or port
    if shown is None:
        res["error"] = "実機も写しもレイが少なすぎて解けない"
        return 2
    # ---- ⑤絵と表
    sync_txt = "-"
    if cam and cam.get("intervals"):
        sync_txt = "%.2f 秒" % float(np.median(cam["intervals"]))
    table_txt = ["明るさ 拾えた 正しい 残差px(LED/映像)"]
    for lv in shown["levels"]:
        li, ci = lv["led_px"], lv["cam_px"]
        table_txt.append(f"{lv['gain'] * 100:3.0f}%  {lv['dots']:2d}/33  " + (f"{lv['correct_frac'] * 100:3.0f}%" if lv["correct_frac"] is not None else " - ") + "  " + (f"{li['median']:.0f}/{ci['median']:.1f}" if li else "-"))
    s = shown["summary"]
    table_txt.append(f"全部 {s['dots_picked']}/33  正しい {s['dots_correct_frac'] * 100:.0f}%")
    table_txt.append(f"合図の間隔 {sync_txt}(期待 11.4)")
    if not device:
        table_txt.append(f"実機のアプリは {res['device']['dots_picked']}/33 点")
    hp = shown["hp"]
    inl = shown["inl"]
    srays = shown["rays"]
    status = {str(k): ("good" if v else "bad") for k, v in shown["dot_ok"].items()}
    draw_data = {"title": "点の実機の試し(固定の iPad)" if device else "点の試し(アプリの判定の写し)", "note": "" if device else "実機のアプリは拾えず。録画に写しを当てた",
                 "camera_size": list(cam_size), "table": table_txt, "dot_status": status,
                 "ray_led_px": [{"dot": r["dot"], "x": float(hp[i][0]), "y": float(hp[i][1]), "inlier": bool(inl[i])} for i, r in enumerate(srays)],
                 "window_quad_cam": quad.tolist(), "expected_cam": [{"dot": k, "x": float(c[0]), "y": float(c[1])} for k, c in enumerate(exp_cam)],
                 "ray_cam": [{"x": float(c[0]), "y": float(c[1])} for c in shown["ray_cam"]]}
    draw_result(Path(a.jpg), draw_data)
    draw_result(out / "real_dots_result.jpg", draw_data)
    print("絵:", a.jpg)
    res["figure"] = a.jpg
    passed = bool(device) and s["dots_picked"] >= PASS_DOTS and s["dots_correct_frac"] >= PASS_CORRECT
    print("合格" if passed else "届かない", f"(実機で 20 点以上: {res['device']['dots_picked']}、9 割以上正しい: " + (f"{device['summary']['dots_correct_frac'] * 100:.0f}%" if device else "-") + ")")
    return 0 if passed else 1


if __name__ == "__main__":
    main()
