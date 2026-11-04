"""映像の取り込み。ffmpeg の子プロセスから生のコマ(BGR)を読み、いつも「最新の 1 コマ」だけを持つ(古いコマをためない = 遅れを増やさない)。
入力は rtsp:// の URL・動画ファイル・どちらでもよい。映像は保存しない(メモリの中だけ)。
"""
from __future__ import annotations

import os
import subprocess
import threading
import time

import numpy as np

# 測定の間だけ、自分が起動した処理の優先度を上げる(ほかの重い仕事に埋もれて、遅れを実際より大きく測らないため)
ABOVE_NORMAL = getattr(subprocess, "ABOVE_NORMAL_PRIORITY_CLASS", 0)


def raise_self_priority() -> None:
    if os.name == "nt":
        import ctypes

        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x8000)  # ABOVE_NORMAL


LOW_LATENCY = ["-fflags", "nobuffer", "-flags", "low_delay", "-threads", "1", "-probesize", "32768", "-analyzeduration", "0"]


def probe_size(source: str, rtsp_tcp: bool = True, timeout: float = 15.0) -> tuple[int, int]:
    cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0"]
    if source.startswith("rtsp://") and rtsp_tcp:
        cmd += ["-rtsp_transport", "tcp"]
    cmd += [source]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    try:
        w, h = r.stdout.strip().split(",")[:2]
        return int(w), int(h)
    except ValueError:
        raise RuntimeError("映像の大きさを読めません(アドレス・アカウント・電源を確かめてください)") from None


class FrameReader:
    def __init__(self, source: str, width: int, height: int, extra_in_args: list[str] | None = None, rtsp_tcp: bool = True, realtime: bool = False, on_frame=None, high_priority: bool = False):
        self.on_frame = on_frame  # on_frame(到着時刻, フレーム) を、読む係の中で呼ぶ(軽い処理だけ)
        self.w, self.h = width, height
        listen = bool(extra_in_args and "listen" in extra_in_args)
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
        if source.startswith("rtsp://"):
            cmd += LOW_LATENCY
            if rtsp_tcp and not listen:
                cmd += ["-rtsp_transport", "tcp"]
        if realtime:
            cmd += ["-re"]  # ファイルを実時間で流す(試験用)
        cmd += (extra_in_args or []) + ["-i", source, "-an", "-pix_fmt", "bgr24", "-f", "rawvideo", "-"]
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0, creationflags=ABOVE_NORMAL if high_priority else 0)
        self._lock = threading.Lock()
        self._latest = None  # (seq, perf_counter での到着時刻, フレーム)
        self.seq = 0
        self.ended = False
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()

    def _read_frame(self, n: int):
        """n バイトをコピーを増やさず 1 つの領域へ読む(1080p は 1 コマ 6 MB。コピーが多いと 15 fps に追いつかない)"""
        buf = bytearray(n)
        view = memoryview(buf)
        got = 0
        while got < n:
            k = self.proc.stdout.readinto(view[got:])
            if not k:
                return None
            got += k
        return buf

    def _run(self):
        size = self.w * self.h * 3
        while True:
            raw = self._read_frame(size)
            if raw is None:
                break
            arrived = time.perf_counter()
            frame = np.frombuffer(raw, np.uint8).reshape(self.h, self.w, 3)
            if self.on_frame:
                self.on_frame(arrived, frame)
            with self._lock:
                self.seq += 1
                self._latest = (self.seq, arrived, frame)
        self.ended = True

    def latest(self, after_seq: int = 0):
        """after_seq より新しい最新のコマ (seq, arrived, frame)。無ければ None"""
        with self._lock:
            if self._latest and self._latest[0] > after_seq:
                return self._latest
        return None

    def close(self):
        """自分で起動した ffmpeg だけを止める"""
        try:
            self.proc.terminate()
            self.proc.wait(timeout=3)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
