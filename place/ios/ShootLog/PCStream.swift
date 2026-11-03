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
    var codec: String? = nil
    var kbps: Int? = nil
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
    var codec = "jpeg"          // "jpeg"(確認用)か "hevc"(ハードウェア符号化。録画の代わりに PC で受ける本命)
    var kbps = 18000             // hevc の目標ビットレート(kbps)
    private var hevc: HEVCEncoder?
    private var destFormat: OSType = kCVPixelFormatType_32BGRA
    private(set) var hevcKeyFrames = 0

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
    private func scaled(_ pb: CVPixelBuffer, width: Int, format: OSType = kCVPixelFormatType_32BGRA) -> CVPixelBuffer? {
        let srcW = CVPixelBufferGetWidth(pb), srcH = CVPixelBufferGetHeight(pb)
        let dw = width, dh = Int((Double(width) * Double(srcH) / Double(srcW)).rounded())
        if transfer == nil { VTPixelTransferSessionCreate(allocator: kCFAllocatorDefault, pixelTransferSessionOut: &transfer) }
        if destPool == nil || destPoolSize != CGSize(width: dw, height: dh) || destFormat != format {
            destFormat = format
            let attrs: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: format,
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
        if codec == "hevc", (hevc?.inFlight ?? 0) >= 3 { skippedBusy += 1; lock.unlock(); return }
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
            if self.codec == "hevc" {
                self.encodeHEVC(pb: pb, n: n, recordedFrame: recordedFrame, ts: ts, captureMs: captureMs, T: T, K: K, ok: ok)
                return
            }
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

    /// HEVC の道(queue の中で呼ぶ)。符号化は非同期。できた Annex B を、JPEG と同じ頭(PCF1 の代わりに HEV1、flags の bit2 = キーフレーム)で送る。
    private func encodeHEVC(pb: CVPixelBuffer, n: UInt32, recordedFrame: Int?, ts: Double, captureMs: Double, T: [Float], K: [Float], ok: Bool) {
        let outW = width
        let outH = Int((Double(outW) * Double(CVPixelBufferGetHeight(pb)) / Double(CVPixelBufferGetWidth(pb))).rounded()) & ~1
        if hevc == nil || hevc?.width != outW {
            hevc = HEVCEncoder(width: outW, height: outH, fps: Int(targetFps), kbps: kbps)
            hevc?.onEncoded = { [weak self] data, key, ctx, encMs in self?.sendHEVC(data, key: key, ctx: ctx, encMs: encMs) }
        }
        guard let enc = hevc, let small = scaled(pb, width: outW, format: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange) else {
            lock.lock(); busy = false; sendFailed += 1; lock.unlock()
            return
        }
        let ctx = HEVCEncoder.Context(seq: n, recFrame: Int32(recordedFrame ?? -1), arTimestamp: ts, captureMs: captureMs, T: T, K: K, trackingOk: ok, recording: recordedFrame != nil)
        enc.encode(small, pts: CMTime(seconds: ts, preferredTimescale: 90000), context: ctx)
        lock.lock(); busy = false; lock.unlock()   // 符号化は非同期。詰まりは inFlight(3 コマまで)で止める
    }

    private func sendHEVC(_ payload: Data, key: Bool, ctx: HEVCEncoder.Context, encMs: Double) {
        var d = Data()
        func be32(_ v: UInt32) { var x = v.bigEndian; d.append(Data(bytes: &x, count: 4)) }
        func be16(_ v: UInt16) { var x = v.bigEndian; d.append(Data(bytes: &x, count: 2)) }
        func bef64(_ v: Double) { var x = v.bitPattern.bigEndian; d.append(Data(bytes: &x, count: 8)) }
        func bef32(_ v: Float) { var x = v.bitPattern.bigEndian; d.append(Data(bytes: &x, count: 4)) }
        d.append(contentsOf: [0x48, 0x45, 0x56, 0x31])
        be32(UInt32(payload.count))
        be32(ctx.seq)
        be32(UInt32(bitPattern: ctx.recFrame))
        bef64(ctx.arTimestamp)
        bef64(ctx.captureMs)
        be16(UInt16(clamping: width))
        be16(UInt16(clamping: hevc?.height ?? 0))
        let flags: UInt8 = (ctx.recording ? 1 : 0) | (ctx.trackingOk ? 2 : 0) | (key ? 4 : 0)
        d.append(flags)
        for v in ctx.T { bef32(v) }
        for v in ctx.K { bef32(v) }
        d.append(payload)
        lock.lock()
        let c = conn
        encodeSum += encMs
        encodeMax = max(encodeMax, encMs)
        if key { hevcKeyFrames += 1 }
        lock.unlock()
        guard let c else { return }
        c.send(content: d, completion: .contentProcessed { [weak self] err in
            guard let self else { return }
            self.lock.lock()
            if err == nil { self.framesSent += 1; self.bytesSent += d.count } else { self.sendFailed += 1 }
            self.lock.unlock()
        })
    }

    /// 音を PC へ(AUD1)。形(ビッグエンディアン): "AUD1" / pcmLen u32 / seq u32 / sampleRate u32 / channels u16 / bits u16(16) / ptsHostSeconds f64 / captureEpochMs f64 / int16 リトルエンディアンの PCM。
    /// 映像と同じ時計(ホスト時間)の時刻つき。映像の待ち状態(busy)とは別に、送れなければ捨てる(音は小さい)。
    private var audioSeq: UInt32 = 0
    func handleAudio(_ sample: CMSampleBuffer) {
        lock.lock()
        let on = enabled && ready
        let c = conn
        lock.unlock()
        guard on, let c, let fd = CMSampleBufferGetFormatDescription(sample), let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fd)?.pointee else { return }
        var blockBuffer: CMBlockBuffer?
        var abl = AudioBufferList()
        guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: nil, bufferListOut: &abl, bufferListSize: MemoryLayout<AudioBufferList>.size,
                                                                      blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &blockBuffer) == noErr,
              let data = abl.mBuffers.mData else { return }
        let bytes = Int(abl.mBuffers.mDataByteSize)
        var pcm = Data()
        if asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0 {
            let cnt = bytes / 4
            let ptr = data.assumingMemoryBound(to: Float.self)
            var out = [Int16](repeating: 0, count: cnt)
            for i in 0..<cnt { out[i] = Int16(max(-1, min(1, ptr[i])) * 32767) }
            pcm = out.withUnsafeBufferPointer { Data(buffer: $0) }
        } else if asbd.mBitsPerChannel == 16 {
            pcm = Data(bytes: data, count: bytes)
        } else {
            return
        }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample).seconds
        let captureMs = Date().timeIntervalSince1970 * 1000 - (ProcessInfo.processInfo.systemUptime - pts) * 1000
        lock.lock(); audioSeq &+= 1; let n = audioSeq; lock.unlock()
        var d = Data()
        func be32(_ v: UInt32) { var x = v.bigEndian; d.append(Data(bytes: &x, count: 4)) }
        func be16(_ v: UInt16) { var x = v.bigEndian; d.append(Data(bytes: &x, count: 2)) }
        func bef64(_ v: Double) { var x = v.bitPattern.bigEndian; d.append(Data(bytes: &x, count: 8)) }
        d.append(contentsOf: [0x41, 0x55, 0x44, 0x31])
        be32(UInt32(pcm.count))
        be32(n)
        be32(UInt32(asbd.mSampleRate))
        be16(UInt16(asbd.mChannelsPerFrame))
        be16(16)
        bef64(pts)
        bef64(captureMs)
        d.append(pcm)
        c.send(content: d, completion: .contentProcessed { _ in })
    }

    func summary() -> PCStreamSummary {
        lock.lock(); defer { lock.unlock() }
        let n = max(framesSent + sendFailed, 1)
        return PCStreamSummary(enabled: enabled, host: host, port: port, width: width, targetFps: targetFps, quality: quality,
                               framesSent: framesSent, skippedBusy: skippedBusy, skippedNotReady: skippedNotReady, sendFailed: sendFailed,
                               bytesSent: bytesSent, encodeMsAvg: (encodeSum / Double(n) * 10).rounded() / 10, encodeMsMax: (encodeMax * 10).rounded() / 10,
                               thermalMax: UELinkController.thermalNameFromRank(thermalMaxRank), codec: codec, kbps: codec == "hevc" ? kbps : nil)
    }

    var statusText: String {
        lock.lock(); defer { lock.unlock() }
        guard enabled else { return "" }
        let mb = Double(bytesSent) / 1_000_000
        return "映像→PC: \(ready ? "接続" : "未接続") 送\(framesSent) 捨(忙\(skippedBusy)/未接続\(skippedNotReady)) 失敗\(sendFailed) \(String(format: "%.1f", mb))MB 符号化最大\(Int(encodeMax))ms"
    }
}
