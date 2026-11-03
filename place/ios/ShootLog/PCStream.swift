import ARKit
import CoreImage
import Foundation
import Network
import UIKit
import VideoToolbox

/// 「作業用 PC へ映像」(確認用): ARKit のカメラ映像を縮小した JPEG にして、姿勢・画角・時刻と一緒に TCP で PC へ送る。
/// 本番の録画(4K の video.mov)は端末の中に残り、これは別の確認用。ネットワークが遅い・切れても録画には影響しない:
/// 送り中は新しいコマを捨てる(待たせない)、切れたら 2 秒おきにつなぎ直す。
/// 1 コマの形(大きい順に、すべてビッグエンディアン): "PCF1" / jpegLen u32 / seq u32 / recFrame i32(録画中なら録画のコマ番号、でなければ -1) /
///   arTimestamp f64(ARFrame.timestamp、frames.jsonl の t と同じ) / captureEpochMs f64(映像を撮った時刻。端末の時計) / w u16 / h u16 / flags u8(bit0 録画中、bit1 追跡が正常) /
///   T f32×16(カメラ→世界、列順) / K f32×4(元の映像の画素で fx fy cx cy) / jpeg バイト列。
struct PCStreamSummary: Codable {
    var enabled: Bool
    var host: String
    var port: Int
    var width: Int
    var targetFps: Double
    var quality: Double
    var framesSent: Int
    var skippedBusy: Int
    var skippedNotReady: Int
    var sendFailed: Int
    var bytesSent: Int
    var encodeMsAvg: Double
    var encodeMsMax: Double
    var thermalMax: String
}

final class PCStreamer {
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "shootlog.pcstream", qos: .utility)
    private let ci = CIContext(options: [.cacheIntermediates: false])
    private var conn: NWConnection?
    private var ready = false
    private var busy = false
    private var lastSentTs = -1.0
    private var seq: UInt32 = 0
    private var retry: DispatchWorkItem?
    private var transfer: VTPixelTransferSession?
    private var destPool: CVPixelBufferPool?
    private var destPoolSize = CGSize.zero
    private(set) var pongCount = 0

    private(set) var enabled = false
    private(set) var host = ""
    private(set) var port = 9100
    var width = 960
    var targetFps = 15.0
    var quality = 0.5

    private var framesSent = 0, skippedBusy = 0, skippedNotReady = 0, sendFailed = 0, bytesSent = 0
    private var encodeSum = 0.0, encodeMax = 0.0
    private var thermalMaxRank = 0

    init() {
        NotificationCenter.default.addObserver(self, selector: #selector(thermalChanged), name: ProcessInfo.thermalStateDidChangeNotification, object: nil)
    }

    @objc private func thermalChanged() {
        lock.lock()
        thermalMaxRank = max(thermalMaxRank, UELinkController.thermalRank(ProcessInfo.processInfo.thermalState))
        lock.unlock()
    }

    func setEnabled(_ on: Bool, host: String, port: Int) {
        lock.lock()
        let wasOn = enabled
        enabled = on
        self.host = host
        self.port = port
        if on && !wasOn {
            framesSent = 0; skippedBusy = 0; skippedNotReady = 0; sendFailed = 0; bytesSent = 0
            encodeSum = 0; encodeMax = 0; lastSentTs = -1; seq = 0
            thermalMaxRank = UELinkController.thermalRank(ProcessInfo.processInfo.thermalState)
        }
        lock.unlock()
        if on { connect() } else { disconnect() }
    }

    private func connect() {
        disconnect(keepRetry: true)
        guard !host.isEmpty, let p = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else { return }
        let params = NWParameters.tcp
        if let tcp = params.defaultProtocolStack.transportProtocol as? NWProtocolTCP.Options { tcp.noDelay = true }
        let c = NWConnection(host: NWEndpoint.Host(host), port: p, using: params)
        c.stateUpdateHandler = { [weak self] s in
            guard let self else { return }
            self.lock.lock()
            switch s {
            case .ready:
                self.ready = true
                self.startReceive(c)
            case .failed, .cancelled, .waiting:
                self.ready = false
                if self.enabled { self.scheduleRetry() }
            default: break
            }
            self.lock.unlock()
        }
        lock.lock(); conn = c; lock.unlock()
        c.start(queue: queue)
    }

    /// PC からの時計合わせの問い合わせ(PNG1 + サーバー時刻 f64 + 通し番号 u32 = 16 バイト)に、PON1 + 同じ時刻 + 端末の時刻 f64 + 通し番号 u32 で答える。
    private func startReceive(_ c: NWConnection) {
        c.receive(minimumIncompleteLength: 16, maximumLength: 16) { [weak self] data, _, isComplete, err in
            guard let self else { return }
            if let data, data.count == 16, data.prefix(4) == Data([0x50, 0x4E, 0x47, 0x31]) {
                let nowMs = Date().timeIntervalSince1970 * 1000
                var out = Data([0x50, 0x4F, 0x4E, 0x31])
                out.append(data.subdata(in: 4..<12))
                var x = nowMs.bitPattern.bigEndian
                out.append(Data(bytes: &x, count: 8))
                out.append(data.subdata(in: 12..<16))
                c.send(content: out, completion: .contentProcessed { _ in })
                self.lock.lock(); self.pongCount += 1; self.lock.unlock()
            }
            if err == nil && !isComplete { self.startReceive(c) }
        }
    }

    /// 縮小は VideoToolbox(専用の回路)で。CPU で 4K を縮める時間を避ける。
    private func scaled(_ pb: CVPixelBuffer, width: Int) -> CVPixelBuffer? {
        let srcW = CVPixelBufferGetWidth(pb), srcH = CVPixelBufferGetHeight(pb)
        let dw = width, dh = Int((Double(width) * Double(srcH) / Double(srcW)).rounded())
        if transfer == nil { VTPixelTransferSessionCreate(allocator: kCFAllocatorDefault, pixelTransferSessionOut: &transfer) }
        if destPool == nil || destPoolSize != CGSize(width: dw, height: dh) {
            let attrs: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                                        kCVPixelBufferWidthKey as String: dw, kCVPixelBufferHeightKey as String: dh,
                                        kCVPixelBufferIOSurfacePropertiesKey as String: [:]]
            var pool: CVPixelBufferPool?
            CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attrs as CFDictionary, &pool)
            destPool = pool
            destPoolSize = CGSize(width: dw, height: dh)
        }
        var dst: CVPixelBuffer?
        guard let pool = destPool, CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &dst) == kCVReturnSuccess, let dstBuf = dst, let t = transfer else { return nil }
        guard VTPixelTransferSessionTransferImage(t, from: pb, to: dstBuf) == noErr else { return nil }
        return dstBuf
    }

    /// lock を持って呼ぶ
    private func scheduleRetry() {
        guard retry == nil else { return }
        let w = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.lock.lock()
            self.retry = nil
            let on = self.enabled
            self.lock.unlock()
            if on { self.connect() }
        }
        retry = w
        queue.asyncAfter(deadline: .now() + 2, execute: w)
    }

    private func disconnect(keepRetry: Bool = false) {
        lock.lock()
        let c = conn
        conn = nil
        ready = false
        if !keepRetry { retry?.cancel(); retry = nil }
        lock.unlock()
        c?.stateUpdateHandler = nil
        c?.cancel()
    }

    /// ARSession の delegateQueue から呼ぶ。重い処理は専用のキューで。送り中なら捨てる。
    func handle(frame: ARFrame, recordedFrame: Int?) {
        lock.lock()
        guard enabled else { lock.unlock(); return }
        if lastSentTs >= 0 && frame.timestamp - lastSentTs < 1.0 / targetFps - 0.004 { lock.unlock(); return }
        if !ready { skippedNotReady += 1; lock.unlock(); return }
        if busy { skippedBusy += 1; lock.unlock(); return }
        busy = true
        lastSentTs = frame.timestamp
        seq &+= 1
        let n = seq
        let outW = width, q = quality
        lock.unlock()

        let pb = frame.capturedImage
        // 映像を撮った時刻(エポック ms): いまの時刻から、ARFrame の時刻(端末の起動からの秒)との差を引く。符号化と送りの遅れを含めて測れる
        let captureMs = Date().timeIntervalSince1970 * 1000 - (ProcessInfo.processInfo.systemUptime - frame.timestamp) * 1000
        let cam = frame.camera
        let ts = frame.timestamp
        let T = Pack.flat(cam.transform)
        let K = Pack.intrinsics(cam)
        let (_, ok) = Pack.tracking(cam.trackingState)
        queue.async { [weak self] in
            guard let self else { return }
            let t0 = CACurrentMediaTime()
            let small = self.scaled(pb, width: outW)
            let src = CIImage(cvPixelBuffer: small ?? pb)
            let s = small == nil ? CGFloat(outW) / src.extent.width : 1
            let scaled = small == nil ? src.transformed(by: CGAffineTransform(scaleX: s, y: s)) : src
            let space = CGColorSpaceCreateDeviceRGB()
            guard let jpeg = self.ci.jpegRepresentation(of: scaled, colorSpace: space,
                                                         options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): q]) else {
                self.lock.lock(); self.busy = false; self.lock.unlock()
                return
            }
            let encMs = (CACurrentMediaTime() - t0) * 1000
            var d = Data()
            func be32(_ v: UInt32) { var x = v.bigEndian; d.append(Data(bytes: &x, count: 4)) }
            func be16(_ v: UInt16) { var x = v.bigEndian; d.append(Data(bytes: &x, count: 2)) }
            func bef64(_ v: Double) { var x = v.bitPattern.bigEndian; d.append(Data(bytes: &x, count: 8)) }
            func bef32(_ v: Float) { var x = v.bitPattern.bigEndian; d.append(Data(bytes: &x, count: 4)) }
            d.append(contentsOf: [0x50, 0x43, 0x46, 0x31])
            be32(UInt32(jpeg.count))
            be32(n)
            be32(UInt32(bitPattern: Int32(recordedFrame ?? -1)))
            bef64(ts)
            bef64(captureMs)
            be16(UInt16(clamping: Int((src.extent.width * s).rounded())))
            be16(UInt16(clamping: Int((src.extent.height * s).rounded())))
            let flags: UInt8 = (recordedFrame != nil ? 1 : 0) | (ok ? 2 : 0)
            d.append(flags)
            for v in T { bef32(Float(v)) }
            for v in K { bef32(Float(v)) }
            d.append(jpeg)
            self.lock.lock()
            let c = self.conn
            self.encodeSum += encMs
            self.encodeMax = max(self.encodeMax, encMs)
            self.lock.unlock()
            guard let c else { self.lock.lock(); self.busy = false; self.lock.unlock(); return }
            c.send(content: d, completion: .contentProcessed { [weak self] err in
                guard let self else { return }
                self.lock.lock()
                if err == nil { self.framesSent += 1; self.bytesSent += d.count } else { self.sendFailed += 1 }
                self.busy = false
                self.lock.unlock()
            })
        }
    }

    func summary() -> PCStreamSummary {
        lock.lock(); defer { lock.unlock() }
        let n = max(framesSent + sendFailed, 1)
        return PCStreamSummary(enabled: enabled, host: host, port: port, width: width, targetFps: targetFps, quality: quality,
                               framesSent: framesSent, skippedBusy: skippedBusy, skippedNotReady: skippedNotReady, sendFailed: sendFailed,
                               bytesSent: bytesSent, encodeMsAvg: (encodeSum / Double(n) * 10).rounded() / 10, encodeMsMax: (encodeMax * 10).rounded() / 10,
                               thermalMax: UELinkController.thermalNameFromRank(thermalMaxRank))
    }

    var statusText: String {
        lock.lock(); defer { lock.unlock() }
        guard enabled else { return "" }
        let mb = Double(bytesSent) / 1_000_000
        return "映像→PC: \(ready ? "接続" : "未接続") 送\(framesSent) 捨(忙\(skippedBusy)/未接続\(skippedNotReady)) 失敗\(sendFailed) \(String(format: "%.1f", mb))MB 符号化最大\(Int(encodeMax))ms"
    }
}
