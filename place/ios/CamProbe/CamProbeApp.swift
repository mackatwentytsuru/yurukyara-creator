import AVFoundation
import SwiftUI
import UIKit

/// 「カメラの探り」: iPhone の背面カメラ(広角・超広角・望遠・LiDAR)を、AVCaptureMultiCamSession で同時に動かせる組み合わせと、
/// そのときの解像度・fps・コスト(hardwareCost / systemPressureCost)・実際に届いたコマ数を、実機で測って JSON に書く。
/// 起動すると自動で測る。結果は画面と Documents/multicam_probe.json。ARKit は使わない(ARKit との同時は、別に書く)。
@main
struct CamProbeApp: App {
    var body: some Scene {
        WindowGroup { ProbeView() }
    }
}

struct ProbeView: View {
    @StateObject private var model = ProbeModel()
    var body: some View {
        ScrollView {
            Text(model.text).font(.system(size: 11, design: .monospaced)).frame(maxWidth: .infinity, alignment: .leading).padding(8)
        }
        .onAppear { model.start() }
    }
}

final class ProbeModel: ObservableObject {
    @Published var text = "起動…"
    private var started = false

    func start() {
        guard !started else { return }
        started = true
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            UIApplication.shared.isIdleTimerDisabled = true
            let result = Probe().run { line in DispatchQueue.main.async { self.text += "\n" + line } }
            if let docs = try? FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true),
               let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: docs.appendingPathComponent("multicam_probe.json"))
            }
            DispatchQueue.main.async { self.text += "\n\n== 終わり(Documents/multicam_probe.json) ==" }
        }
    }
}

final class FrameCounter: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureDepthDataOutputDelegate {
    private let lock = NSLock()
    private(set) var video = 0
    private(set) var depth = 0
    private(set) var firstWidth = 0, firstHeight = 0
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        lock.lock(); defer { lock.unlock() }
        video += 1
        if firstWidth == 0, let pb = CMSampleBufferGetImageBuffer(sampleBuffer) { firstWidth = CVPixelBufferGetWidth(pb); firstHeight = CVPixelBufferGetHeight(pb) }
    }
    func depthDataOutput(_ output: AVCaptureDepthDataOutput, didOutput depthData: AVDepthData, timestamp: CMTime, connection: AVCaptureConnection) {
        lock.lock(); defer { lock.unlock() }
        depth += 1
    }
}

struct Probe {
    static func modelName() -> String {
        var u = utsname()
        uname(&u)
        return withUnsafePointer(to: &u.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) } }
    }

    static func thermalName(_ s: ProcessInfo.ThermalState) -> String {
        switch s { case .nominal: return "nominal"; case .fair: return "fair"; case .serious: return "serious"; case .critical: return "critical"; @unknown default: return "?" }
    }

    static let types: [(AVCaptureDevice.DeviceType, String)] = [
        (.builtInWideAngleCamera, "wide"), (.builtInUltraWideCamera, "ultraWide"), (.builtInTelephotoCamera, "tele"),
        (.builtInLiDARDepthCamera, "lidar"),
    ]

    func name(_ d: AVCaptureDevice) -> String { Self.types.first { $0.0 == d.deviceType }?.1 ?? d.deviceType.rawValue }

    func maxFps(_ f: AVCaptureDevice.Format) -> Double { f.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 0 }

    func formatList(_ d: AVCaptureDevice) -> [[String: Any]] {
        var seen = Set<String>()
        var out: [[String: Any]] = []
        for f in d.formats {
            let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            let key = "\(dim.width)x\(dim.height)@\(Int(maxFps(f)))m\(f.isMultiCamSupported)"
            if seen.insert(key).inserted {
                out.append(["size": "\(dim.width)x\(dim.height)", "maxFps": maxFps(f), "multiCam": f.isMultiCamSupported, "binned": f.isVideoBinned,
                            "depthFormats": f.supportedDepthDataFormats.count])
            }
        }
        return out
    }

    /// 解像度の段(max / 1080p / 720p)に合う、複数カメラ対応の形式(30 fps 以上)
    func pickFormat(_ d: AVCaptureDevice, tier: Int) -> AVCaptureDevice.Format? {
        let wantW: Int32 = tier == 0 ? Int32.max : (tier == 1 ? 1920 : 1280)
        let cands = d.formats.filter { $0.isMultiCamSupported && maxFps($0) >= 30 && CMVideoFormatDescriptionGetDimensions($0.formatDescription).width <= wantW }
        return cands.max { a, b in
            let da = CMVideoFormatDescriptionGetDimensions(a.formatDescription), db = CMVideoFormatDescriptionGetDimensions(b.formatDescription)
            return Int(da.width) * Int(da.height) < Int(db.width) * Int(db.height)
        }
    }

    func run(log: @escaping (String) -> Void) -> [String: Any] {
        var result: [String: Any] = ["device": UIDevice.current.name, "model": Probe.modelName(), "system": UIDevice.current.systemVersion,
                                     "multiCamSupported": AVCaptureMultiCamSession.isMultiCamSupported]
        log("機種 \(result["model"] ?? "") iOS \(UIDevice.current.systemVersion) 複数カメラ対応 \(AVCaptureMultiCamSession.isMultiCamSupported)")
        let sem = DispatchSemaphore(value: 0)
        AVCaptureDevice.requestAccess(for: .video) { _ in sem.signal() }
        sem.wait()
        let disc = AVCaptureDevice.DiscoverySession(deviceTypes: Self.types.map { $0.0 }, mediaType: .video, position: .back)
        let devices = disc.devices
        var devInfo: [[String: Any]] = []
        for d in devices {
            devInfo.append(["name": name(d), "type": d.deviceType.rawValue, "formats": formatList(d)])
            log("カメラ \(name(d)): 形式 \(d.formats.count) 個、複数カメラ対応 \(d.formats.filter { $0.isMultiCamSupported }.count) 個")
        }
        result["devices"] = devInfo
        let setsRaw = disc.supportedMultiCamDeviceSets
        let sets = setsRaw.map { Array($0).sorted { name($0) < name($1) } }
        result["supportedMultiCamDeviceSets"] = sets.map { $0.map { name($0) } }
        log("同時に使える組み合わせ(OS の答え): " + sets.map { "[" + $0.map { name($0) }.joined(separator: "+") + "]" }.joined(separator: " "))
        var tests: [[String: Any]] = []
        for set in sets where set.count >= 2 {
            for tier in 0..<3 {
                let r = runSet(set, tier: tier)
                tests.append(r)
                log("試し \(r["set"] ?? "") 段\(tier): \(r["ok"] as? Bool == true ? "動いた" : "だめ") cost hw=\(r["hardwareCost"] ?? "-") 圧=\(r["systemPressureCost"] ?? "-") コマ=\(r["frames"] ?? "-") \(r["error"] ?? "")")
            }
        }
        result["tests"] = tests
        result["thermalEnd"] = Probe.thermalName(ProcessInfo.processInfo.thermalState)
        return result
    }

    func runSet(_ set: [AVCaptureDevice], tier: Int) -> [String: Any] {
        var r: [String: Any] = ["set": set.map { name($0) }.joined(separator: "+"), "tier": tier]
        let session = AVCaptureMultiCamSession()
        let counters: [(String, FrameCounter)] = set.map { (name($0), FrameCounter()) }
        let queue = DispatchQueue(label: "probe.q")
        session.beginConfiguration()
        var sizes: [String: String] = [:]
        for (i, d) in set.enumerated() {
            do {
                guard let fmt = pickFormat(d, tier: tier) else { r["error"] = "\(name(d)): 条件に合う形式なし"; session.commitConfiguration(); return r }
                try d.lockForConfiguration()
                d.activeFormat = fmt
                d.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
                d.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
                d.unlockForConfiguration()
                let dim = CMVideoFormatDescriptionGetDimensions(fmt.formatDescription)
                sizes[name(d)] = "\(dim.width)x\(dim.height)"
                let input = try AVCaptureDeviceInput(device: d)
                guard session.canAddInput(input) else { r["error"] = "\(name(d)): 入力を足せない"; session.commitConfiguration(); return r }
                session.addInputWithNoConnections(input)
                let out = AVCaptureVideoDataOutput()
                out.alwaysDiscardsLateVideoFrames = true
                out.setSampleBufferDelegate(counters[i].1, queue: queue)
                guard session.canAddOutput(out) else { r["error"] = "\(name(d)): 出力を足せない"; session.commitConfiguration(); return r }
                session.addOutputWithNoConnections(out)
                guard let port = input.ports(for: .video, sourceDeviceType: d.deviceType, sourceDevicePosition: d.position).first else { r["error"] = "\(name(d)): ポートなし"; session.commitConfiguration(); return r }
                let conn = AVCaptureConnection(inputPorts: [port], output: out)
                guard session.canAddConnection(conn) else { r["error"] = "\(name(d)): 接続を足せない"; session.commitConfiguration(); return r }
                session.addConnection(conn)
            } catch {
                r["error"] = "\(name(d)): \(error.localizedDescription)"
                session.commitConfiguration()
                return r
            }
        }
        session.commitConfiguration()
        r["sizes"] = sizes
        r["hardwareCost"] = Double(session.hardwareCost)
        r["systemPressureCost"] = Double(session.systemPressureCost)
        if session.hardwareCost > 1.0 { r["error"] = "hardwareCost が 1.0 を超える"; r["ok"] = false; return r }
        session.startRunning()
        Thread.sleep(forTimeInterval: 6)
        let pressure = set.first?.systemPressureState.level.rawValue ?? "-"
        session.stopRunning()
        var frames: [String: Int] = [:]
        for (n, c) in counters { frames[n] = c.video }
        r["frames"] = frames
        r["fpsApprox"] = frames.mapValues { Double($0) / 6.0 }
        r["systemPressureLevel"] = pressure
        r["ok"] = frames.values.allSatisfy { $0 > 60 }
        return r
    }
}
