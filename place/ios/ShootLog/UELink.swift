import ARKit
import Foundation
import Network
import UIKit
import WebKit

/// 「UE モニター」: ARKit の位置・向き・画角を UDP で UE へ送り、UE の絵(Pixel Streaming)を全画面で映す。
/// 撮影記録(録画)と同じ ARSession を使うので、録画しながら動かせる。スイッチを切れば何もしない。
/// 送るもの(1 ARFrame 1 行の JSON、末尾に改行): place/shootlog の「リアルタイムの形」を参照。
struct UELinkConfig: Codable {
    var host: String
    var port: Int
    var url: String
}

enum UELinkDefaults {
    private static let key = "uelink.config"

    /// 保存した値 → アプリに同梱の ue_link_defaults.json(リポジトリの外で置く)→ 空、の順。
    static func load() -> UELinkConfig {
        if let data = UserDefaults.standard.data(forKey: key), let c = try? JSONDecoder().decode(UELinkConfig.self, from: data) { return c }
        if let url = Bundle.main.url(forResource: "ue_link_defaults", withExtension: "json"),
           let data = try? Data(contentsOf: url), let c = try? JSONDecoder().decode(UELinkConfig.self, from: data) { return c }
        return UELinkConfig(host: "", port: 9000, url: "")
    }

    static func save(_ c: UELinkConfig) {
        if let data = try? JSONEncoder().encode(c) { UserDefaults.standard.set(data, forKey: key) }
    }
}

final class UEUDPSender {
    private var conn: NWConnection?
    private let queue = DispatchQueue(label: "uelink.udp")
    private let lock = NSLock()
    private var sentCount = 0
    private var failedCount = 0
    private var state = "-"

    var counts: (sent: Int, failed: Int, state: String) {
        lock.lock(); defer { lock.unlock() }
        return (sentCount, failedCount, state)
    }

    func start(host: String, port: Int) {
        stop()
        guard !host.isEmpty, let p = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else { return }
        let c = NWConnection(host: NWEndpoint.Host(host), port: p, using: .udp)
        c.stateUpdateHandler = { [weak self] s in
            guard let self else { return }
            self.lock.lock(); self.state = "\(s)"; self.lock.unlock()
        }
        c.start(queue: queue)
        lock.lock(); conn = c; sentCount = 0; failedCount = 0; lock.unlock()
    }

    func stop() {
        lock.lock()
        let c = conn
        conn = nil
        lock.unlock()
        c?.cancel()
    }

    func send(_ line: String) {
        lock.lock()
        let c = conn
        lock.unlock()
        guard let c, let data = line.data(using: .utf8) else { return }
        c.send(content: data, completion: .contentProcessed { [weak self] err in
            guard let self else { return }
            self.lock.lock()
            if err == nil { self.sentCount += 1 } else { self.failedCount += 1 }
            self.lock.unlock()
        })
    }
}

/// 遅れの見積もり。ARKit の動きの速さ(iPhone を振る)と、返ってきた絵の動きの量を、時刻をずらしながら重ねて、いちばん合うずれを遅れとする。
struct LatencyResult: Codable {
    var lagMs: Double?
    var confidence: Double      // 相関係数(0〜1)。0.5 未満は信用しない
    var speedSamples: Int
    var motionSamples: Int
    var note: String
}

enum LatencyEstimator {
    private static func resample(_ s: [(Double, Double)], from t0: Double, to t1: Double, step: Double) -> [Double] {
        guard s.count >= 2 else { return [] }
        let sorted = s.sorted { $0.0 < $1.0 }
        var out: [Double] = []
        var j = 0
        var t = t0
        while t <= t1 {
            while j + 1 < sorted.count - 1 && sorted[j + 1].0 < t { j += 1 }
            let a = sorted[j], b = sorted[min(j + 1, sorted.count - 1)]
            let u = b.0 > a.0 ? min(max((t - a.0) / (b.0 - a.0), 0), 1) : 0
            out.append(a.1 * (1 - u) + b.1 * u)
            t += step
        }
        return out
    }

    private static func normalize(_ x: [Double]) -> [Double]? {
        guard !x.isEmpty else { return nil }
        let m = x.reduce(0, +) / Double(x.count)
        let v = x.map { ($0 - m) * ($0 - m) }.reduce(0, +) / Double(x.count)
        guard v > 1e-12 else { return nil }
        let sd = v.squareRoot()
        return x.map { ($0 - m) / sd }
    }

    /// speed / motion = [(時刻 ms(1970 年から)、値)]。
    static func estimate(speed: [(Double, Double)], motion: [(Double, Double)], maxLagMs: Double = 1000) -> LatencyResult {
        let base = LatencyResult(lagMs: nil, confidence: 0, speedSamples: speed.count, motionSamples: motion.count, note: "")
        guard speed.count > 20, motion.count > 20 else {
            var r = base; r.note = "データが少ない(ARKit \(speed.count)、絵 \(motion.count))。絵が届いているか確かめる"; return r
        }
        let t0 = max(speed.map(\.0).min()!, motion.map(\.0).min()! - maxLagMs)
        let t1 = min(speed.map(\.0).max()!, motion.map(\.0).max()! )
        let step = 10.0
        guard t1 - t0 > 3000 else { var r = base; r.note = "重なる時間が短い"; return r }
        // 速さは少しならす(3 点の平均)
        let sp = resample(speed, from: t0, to: t1, step: step)
        let mo = resample(motion, from: t0, to: t1 + maxLagMs, step: step)
        guard let s = normalize(sp), normalize(Array(mo.prefix(sp.count))) != nil else {
            var r = base; r.note = "動きが足りない(iPhone をもっと大きく振る)"; return r
        }
        var best: (lag: Int, c: Double) = (0, -1)
        var cs: [Double] = []
        let maxLag = Int(maxLagMs / step)
        for lag in 0...maxLag {
            let seg = Array(mo[lag..<min(lag + sp.count, mo.count)])
            guard seg.count == sp.count, let m = normalize(seg) else { cs.append(0); continue }
            var acc = 0.0
            for i in 0..<sp.count { acc += s[i] * m[i] }
            let c = acc / Double(sp.count)
            cs.append(c)
            if c > best.c { best = (lag, c) }
        }
        var lagMs = Double(best.lag) * step
        if best.lag > 0, best.lag < cs.count - 1 {   // 放物線で補間
            let a = cs[best.lag - 1], b = cs[best.lag], c = cs[best.lag + 1]
            let d = a - 2 * b + c
            if abs(d) > 1e-9 { lagMs += 0.5 * (a - c) / d * step }
        }
        var r = base
        r.lagMs = lagMs
        r.confidence = best.c
        r.note = best.c < 0.5 ? "相関が弱い(振りが足りない、または絵が動きに追従していない)" : "ok"
        return r
    }
}

struct UELinkSummary: Codable {
    var enabled: Bool
    var host: String
    var port: Int
    var url: String
    var packetsSent: Int
    var packetsFailed: Int
    var thermalAtStart: String
    var thermalMax: String
}

final class UELinkController: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    let sender = UEUDPSender()
    private(set) var config: UELinkConfig = UELinkDefaults.load()
    private(set) var enabled = false
    private let lock = NSLock()
    private var seq = 0
    private var logLines: [String] = []

    // 絵の側の統計(JS から 1 秒ごと)
    private var videoFps: Double = 0
    private var videoTotal = 0
    private var videoDropped = 0
    private var videoSize = ""
    private var videoState = "未接続"
    private var motionSamples: [(Double, Double)] = []   // (epoch ms, 動きの量)

    // 測定
    private var speedSamples: [(Double, Double)] = []
    private var measuring = false
    private var prevPose: (t: Double, m: simd_float4x4)?
    private var epochOffsetMs: Double = 0

    private var thermalAtStart = ""
    private var thermalMaxRank = 0
    var recorderInfo: (() -> (frames: Int, dropped: Int)?)?

    override init() {
        let conf = WKWebViewConfiguration()
        conf.allowsInlineMediaPlayback = true
        conf.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: conf)
        super.init()
        conf.userContentController.add(self, name: "uelink")
        conf.userContentController.addUserScript(WKUserScript(source: Self.script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView.navigationDelegate = self
        webView.isOpaque = true
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.isUserInteractionEnabled = false   // 画面のタッチを UE の入力にしない
        webView.isHidden = true
        NotificationCenter.default.addObserver(self, selector: #selector(thermalChanged), name: ProcessInfo.thermalStateDidChangeNotification, object: nil)
    }

    // MARK: - 設定・開始/停止

    func update(config c: UELinkConfig) {
        config = c
        UELinkDefaults.save(c)
    }

    func setEnabled(_ on: Bool) {
        guard on != enabled else { return }
        enabled = on
        if on {
            thermalAtStart = Self.thermalName(ProcessInfo.processInfo.thermalState)
            thermalMaxRank = Self.thermalRank(ProcessInfo.processInfo.thermalState)
            sender.start(host: config.host, port: config.port)
            if let u = URL(string: config.url), u.scheme != nil {
                webView.load(URLRequest(url: u))
                videoState = "読み込み中"
            } else {
                videoState = "絵の URL が未設定"
            }
            webView.isHidden = false
            log("モニター入: 送り先 \(config.host):\(config.port)")
        } else {
            sender.stop()
            webView.isHidden = true
            webView.loadHTMLString("", baseURL: nil)
            videoState = "未接続"
            log("モニター切")
        }
    }

    func reloadPicture() {
        if enabled, let u = URL(string: config.url), u.scheme != nil { webView.load(URLRequest(url: u)); videoState = "読み込み中" }
    }

    // MARK: - コマごと(ARSession の delegateQueue から呼ぶ)

    func handle(frame: ARFrame, recording: Bool) {
        if enabled {
            lock.lock(); seq += 1; let n = seq; lock.unlock()
            let cam = frame.camera
            let (track, ok) = Pack.tracking(cam.trackingState)
            let t = Pack.flat(cam.transform).map { String(format: "%.6f", $0) }.joined(separator: ",")
            let k = Pack.intrinsics(cam).map { String(format: "%.3f", $0) }.joined(separator: ",")
            let nowMs = Date().timeIntervalSince1970 * 1000
            let line = "{\"seq\":\(n),\"sent_ms\":\(String(format: "%.1f", nowMs)),\"t\":\(String(format: "%.6f", frame.timestamp)),"
                + "\"T\":[\(t)],\"K\":[\(k)],\"w\":\(Int(cam.imageResolution.width)),\"h\":\(Int(cam.imageResolution.height)),"
                + "\"ok\":\(ok),\"track\":\"\(track)\",\"rec\":\(recording)}\n"
            sender.send(line)
        }
        lock.lock()
        let isMeasuring = measuring
        lock.unlock()
        if isMeasuring { recordSpeed(frame) }
    }

    private func recordSpeed(_ frame: ARFrame) {
        let now = frame.timestamp
        let m = frame.camera.transform
        defer { prevPose = (now, m) }
        guard let p = prevPose, now > p.t else { return }
        let dt = now - p.t
        let dp = simd_float3(m.columns.3.x - p.m.columns.3.x, m.columns.3.y - p.m.columns.3.y, m.columns.3.z - p.m.columns.3.z)
        let q0 = simd_quatf(p.m), q1 = simd_quatf(m)
        let ang = 2 * acos(min(1, abs(simd_dot(q0.vector, q1.vector))))
        let speed = Double(simd_length(dp)) / dt + 0.3 * Double(ang) / dt
        lock.lock()
        speedSamples.append((now * 1000 + epochOffsetMs, speed))
        lock.unlock()
    }

    // MARK: - 測定

    /// 10 秒間、iPhone を振ってもらい、遅れを見積もる。
    func measureLatency(seconds: Double = 10, done: @escaping (LatencyResult) -> Void) {
        guard enabled else { done(LatencyResult(lagMs: nil, confidence: 0, speedSamples: 0, motionSamples: 0, note: "モニターが切れている")); return }
        lock.lock()
        speedSamples = []
        motionSamples = []
        prevPose = nil
        epochOffsetMs = (Date().timeIntervalSince1970 - ProcessInfo.processInfo.systemUptime) * 1000
        measuring = true
        lock.unlock()
        log("遅れの測定を始めた: \(Int(seconds)) 秒、iPhone を左右に大きく振る")
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            guard let self else { return }
            self.lock.lock()
            self.measuring = false
            let sp = self.speedSamples, mo = self.motionSamples
            self.lock.unlock()
            let r = LatencyEstimator.estimate(speed: sp, motion: mo)
            self.log("遅れ \(r.lagMs.map { String(format: "%.0f ms", $0) } ?? "測れない")(確かさ \(String(format: "%.2f", r.confidence))、\(r.note))")
            self.saveJSONOptional(["kind": "latency", "result": try? Self.jsonObject(r), "speed": sp.map { [$0.0, $0.1] }, "motion": mo.map { [$0.0, $0.1] }], name: "latency")
            done(r)
        }
    }

    /// 1 分間の統計: UDP の数、ARKit のコマ、絵のコマ・落ちたコマ、録画の落ちたコマ、熱。
    func minuteTest(seconds: Double = 60, done: @escaping (String) -> Void) {
        guard enabled else { done("モニターが切れている"); return }
        let s0 = sender.counts
        lock.lock()
        let v0 = (videoTotal, videoDropped)
        lock.unlock()
        let r0 = recorderInfo?()
        thermalMaxRank = Self.thermalRank(ProcessInfo.processInfo.thermalState)
        let thermal0 = Self.thermalName(ProcessInfo.processInfo.thermalState)
        let start = Date()
        log("1 分テストを始めた(\(Int(seconds)) 秒)。iPhone は普通に動かす")
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            guard let self else { return }
            let s1 = self.sender.counts
            self.lock.lock()
            let v1 = (self.videoTotal, self.videoDropped)
            let fps = self.videoFps
            self.lock.unlock()
            let r1 = self.recorderInfo?()
            let dur = Date().timeIntervalSince(start)
            var o: [String: Any] = [
                "kind": "minute_test", "seconds": dur,
                "udp_sent": s1.sent - s0.sent, "udp_failed": s1.failed - s0.failed, "udp_per_s": Double(s1.sent - s0.sent) / dur,
                "video_frames": v1.0 - v0.0, "video_dropped": v1.1 - v0.1, "video_fps_now": fps,
                "thermal_start": thermal0, "thermal_max": Self.thermalNameFromRank(self.thermalMaxRank),
            ]
            if let a = r0, let b = r1 {
                o["record_frames"] = b.frames - a.frames
                o["record_dropped"] = b.dropped - a.dropped
            } else {
                o["record"] = "録画していない"
            }
            self.saveJSON(o, name: "minute")
            let text = "1分: UDP \(s1.sent - s0.sent)(失敗 \(s1.failed - s0.failed))、絵 \(v1.0 - v0.0) コマ(落ち \(v1.1 - v0.1))、録画 \(r1.map { b in r0.map { "\(b.frames - $0.frames) コマ・落ち \(b.dropped - $0.dropped)" } ?? "-" } ?? "なし")、熱 \(thermal0)→\(Self.thermalNameFromRank(self.thermalMaxRank))"
            self.log(text)
            done(text)
        }
    }

    func summary() -> UELinkSummary {
        let c = sender.counts
        return UELinkSummary(enabled: enabled, host: config.host, port: config.port, url: config.url, packetsSent: c.sent, packetsFailed: c.failed,
                             thermalAtStart: thermalAtStart, thermalMax: Self.thermalNameFromRank(thermalMaxRank))
    }

    // MARK: - 表示用

    var statusText: String {
        let c = sender.counts
        lock.lock(); defer { lock.unlock() }
        return enabled ? "UE: 送信 \(c.sent)(失敗 \(c.failed)) 絵 \(String(format: "%.0f", videoFps))fps 落ち \(videoDropped) \(videoState) 熱 \(Self.thermalName(ProcessInfo.processInfo.thermalState))" : ""
    }

    var logText: String {
        lock.lock(); defer { lock.unlock() }
        return logLines.suffix(40).joined(separator: "\n")
    }

    private func log(_ s: String) {
        let line = String(format: "%@ %@", Self.timeString(), s)
        lock.lock()
        logLines.append(line)
        lock.unlock()
        // 後から取り出せるように、ファイルにも残す(Documents/ue_link/log.txt)
        let newline = String(UnicodeScalar(10))
        if let docs = try? FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true) {
            let dir = docs.appendingPathComponent("ue_link", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let f = dir.appendingPathComponent("log.txt")
            if let h = try? FileHandle(forWritingTo: f) {
                h.seekToEndOfFile(); h.write(Data((line + newline).utf8)); try? h.close()
            } else {
                try? Data((line + newline).utf8).write(to: f)
            }
        }
    }

    private static func timeString() -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f.string(from: Date())
    }

    // MARK: - 熱

    @objc private func thermalChanged() {
        let r = Self.thermalRank(ProcessInfo.processInfo.thermalState)
        thermalMaxRank = max(thermalMaxRank, r)
        log("熱の状態: \(Self.thermalName(ProcessInfo.processInfo.thermalState))")
    }

    static func thermalName(_ s: ProcessInfo.ThermalState) -> String { thermalNameFromRank(thermalRank(s)) }

    static func thermalRank(_ s: ProcessInfo.ThermalState) -> Int {
        switch s {
        case .nominal: return 0
        case .fair: return 1
        case .serious: return 2
        case .critical: return 3
        @unknown default: return 3
        }
    }

    static func thermalNameFromRank(_ r: Int) -> String { ["nominal", "fair", "serious", "critical"][min(max(r, 0), 3)] }

    // MARK: - 絵の側の統計(JS)

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let d = message.body as? [String: Any], let type = d["type"] as? String else { return }
        lock.lock(); defer { lock.unlock() }
        switch type {
        case "stats":
            videoFps = (d["fps"] as? Double) ?? 0
            videoTotal = (d["total"] as? Int) ?? videoTotal
            videoDropped = (d["dropped"] as? Int) ?? videoDropped
            if let w = d["w"] as? Int, let h = d["h"] as? Int { videoSize = "\(w)x\(h)" }
            videoState = (d["playing"] as? Bool) == true ? "再生中 \(videoSize)" : "映像待ち"
        case "motion":
            if let arr = d["s"] as? [[Double]], measuring {
                for p in arr where p.count == 2 { motionSamples.append((p[0], p[1])) }
            }
        default: break
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        lock.lock(); videoState = "読み込み失敗"; lock.unlock()
        log("絵の読み込み失敗: \(error.localizedDescription)")
    }

    // MARK: - 保存

    private static func jsonObject<T: Encodable>(_ v: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(v))
    }

    private func saveJSONOptional(_ obj: [String: Any?], name: String) {
        let clean = obj.compactMapValues { $0 }
        saveJSON(clean, name: name)
    }

    private func saveJSON(_ obj: [String: Any], name: String) {
        guard JSONSerialization.isValidJSONObject(obj),
              let docs = try? FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true) else { return }
        let dir = docs.appendingPathComponent("ue_link", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyyMMdd-HHmmss"
        if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: dir.appendingPathComponent("\(name)_\(f.string(from: Date())).json"))
        }
    }

    // 絵のページに入れる JS: 操作の部品を隠し、映像のコマ数・落ちたコマ・動きの量を 1 秒/0.25 秒ごとに知らせる。
    static let script = #"""
    (function () {
      if (window.__uelink) return; window.__uelink = true;
      var post = function (o) { try { window.webkit.messageHandlers.uelink.postMessage(o); } catch (e) {} };
      var st = document.createElement('style');
      st.textContent = '#uiFeatures,#overlay,#showFPSButton,.UiTool,#settingsBtn,#controls{display:none!important} html,body{background:#000!important;margin:0!important} video{object-fit:contain!important}';
      document.head.appendChild(st);
      var canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      var prev = null, frames = 0, lastCount = 0, lastT = performance.now(), batch = [], hooked = null;
      function onFrame() {
        frames++;
        try {
          var v = hooked; ctx.drawImage(v, 0, 0, 64, 36);
          var d = ctx.getImageData(0, 0, 64, 36).data, diff = 0;
          if (prev) { for (var i = 0; i < d.length; i += 4) { diff += Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]); } }
          prev = new Uint8ClampedArray(d);
          if (prev && diff >= 0) batch.push([Date.now(), diff / (64 * 36 * 3)]);
        } catch (e) {}
        if (hooked && hooked.requestVideoFrameCallback) hooked.requestVideoFrameCallback(onFrame);
      }
      function hook() {
        var v = document.querySelector('video');
        if (v && v !== hooked) {
          hooked = v; v.muted = true; v.playsInline = true;
          if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame);
          try { v.play(); } catch (e) {}
        }
        var btn = document.querySelector('#playButton, #connectButton, .btn-overlay');
        if (btn && !hooked) { try { btn.click(); } catch (e) {} }
      }
      setInterval(hook, 500);
      setInterval(function () {
        if (batch.length) { post({ type: 'motion', s: batch }); batch = []; }
      }, 250);
      setInterval(function () {
        var now = performance.now(), fps = (frames - lastCount) * 1000 / (now - lastT); lastCount = frames; lastT = now;
        var q = hooked && hooked.getVideoPlaybackQuality ? hooked.getVideoPlaybackQuality() : null;
        post({ type: 'stats', fps: fps, total: q ? q.totalVideoFrames : frames, dropped: q ? q.droppedVideoFrames : 0,
               w: hooked ? hooked.videoWidth : 0, h: hooked ? hooked.videoHeight : 0, playing: !!hooked && !hooked.paused && hooked.readyState > 2 });
      }, 1000);
    })();
    """#
}
