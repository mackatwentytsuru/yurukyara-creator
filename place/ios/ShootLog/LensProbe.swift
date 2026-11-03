import ARKit
import AVFoundation
import Foundation

/// レンズの調べ(試験用: 起動の引数 --probe-lenses)。結果は Documents/lens_probe.json。iPad を動かさずに流す。
/// ①ARKit の全部の形式(カメラの種類・大きさ・fps)②カメラごとの画角 ③形式を切り替えたときの位置の飛び(セッションをやり直さない run)
/// ④ARKit を止めて超広角を動かし、ARKit に戻したときの位置の飛びと、追跡が戻るまでの時間。
final class LensProbe: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let session: ARSession
    private let latestFrame: () -> ARFrame?
    private let frameCount: () -> Int
    private var result: [String: Any] = [:]
    private let queue = DispatchQueue(label: "lensprobe.video")
    private var videoFrames = 0
    private var videoLock = NSLock()

    init(session: ARSession, latestFrame: @escaping () -> ARFrame?, frameCount: @escaping () -> Int) {
        self.session = session
        self.latestFrame = latestFrame
        self.frameCount = frameCount
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        videoLock.lock(); videoFrames += 1; videoLock.unlock()
    }

    private static func typeName(_ t: AVCaptureDevice.DeviceType?) -> String { t?.rawValue ?? "unknown" }

    private static func listFormats(_ formats: [ARConfiguration.VideoFormat]) -> [[String: Any]] {
        formats.map { f in
            var d: [String: Any] = ["w": Int(f.imageResolution.width), "h": Int(f.imageResolution.height), "fps": f.framesPerSecond,
                                    "device": typeName(f.captureDeviceType), "position": f.captureDevicePosition.rawValue]
            if #available(iOS 16.0, *) { d["hdr"] = f.isVideoHDRSupported }
            return d
        }
    }

    private func snapshot() -> [String: Any] {
        guard let f = latestFrame() else { return ["frame": "なし"] }
        let k = f.camera.intrinsics, w = f.camera.imageResolution.width
        let hfov = 2 * atan(Double(w) / 2 / Double(k[0][0])) * 180 / .pi
        let t = f.camera.transform.columns.3
        var state = "normal"
        switch f.camera.trackingState {
        case .normal: state = "normal"
        case .notAvailable: state = "notAvailable"
        case .limited(let r): state = "limited:\(r)"
        }
        return ["w": Int(w), "h": Int(f.camera.imageResolution.height), "fx": Double(k[0][0]), "hfov_deg": hfov, "tracking": state, "pos": [Double(t.x), Double(t.y), Double(t.z)], "ts": f.timestamp]
    }

    private func dist(_ a: [String: Any], _ b: [String: Any]) -> Double? {
        guard let p = a["pos"] as? [Double], let q = b["pos"] as? [Double] else { return nil }
        return sqrt(zip(p, q).map { ($0 - $1) * ($0 - $1) }.reduce(0, +))
    }

    /// 背景で順に流す。呼び出しは主スレッド以外から。
    func run(save: @escaping ([String: Any]) -> Void) {
        result["model"] = UIDevice.current.model
        result["system"] = UIDevice.current.systemVersion
        result["world_formats"] = Self.listFormats(ARWorldTrackingConfiguration.supportedVideoFormats)
        result["positional_formats"] = Self.listFormats(ARPositionalTrackingConfiguration.supportedVideoFormats)
        result["orientation_formats"] = Self.listFormats(AROrientationTrackingConfiguration.supportedVideoFormats)
        result["image_formats"] = Self.listFormats(ARImageTrackingConfiguration.supportedVideoFormats)
        result["sceneDepth"] = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        result["sceneReconstruction"] = ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
        if #available(iOS 16.0, *) {
            result["recommended4K"] = ARWorldTrackingConfiguration.recommendedVideoFormatFor4KResolution.map { Self.listFormats([$0]) } ?? []
            result["configurableDevice"] = ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera.map { Self.typeName($0.deviceType) } ?? "なし"
        }
        // カメラごとの画角
        let types: [(AVCaptureDevice.DeviceType, String)] = [(.builtInWideAngleCamera, "wide"), (.builtInUltraWideCamera, "ultrawide"), (.builtInTelephotoCamera, "tele"), (.builtInLiDARDepthCamera, "lidar")]
        var cams: [[String: Any]] = []
        for (t, name) in types {
            guard let d = AVCaptureDevice.default(t, for: .video, position: .back) else { cams.append(["name": name, "exists": false]); continue }
            var sizes: [String] = []
            var fovMax = 0.0
            for f in d.formats {
                let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
                let maxFps = f.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 0
                let s = "\(dim.width)x\(dim.height)@\(Int(maxFps)) fov\(String(format: "%.1f", f.videoFieldOfView))"
                if !sizes.contains(s) { sizes.append(s) }
                fovMax = max(fovMax, Double(f.videoFieldOfView))
            }
            cams.append(["name": name, "exists": true, "fov_max_deg": fovMax, "formats": sizes, "active_fov": Double(d.activeFormat.videoFieldOfView)])
        }
        result["cameras"] = cams
        save(result)

        // ②基準の形式で落ち着くのを待つ
        Thread.sleep(forTimeInterval: 8)
        let base = snapshot()
        result["base"] = base
        // ③形式を、やり直しなし(run に options なし)で順に切り替える
        var steps: [[String: Any]] = []
        var seen = Set<String>()
        for f in ARWorldTrackingConfiguration.supportedVideoFormats {
            let key = "\(Self.typeName(f.captureDeviceType))-\(Int(f.imageResolution.width))x\(Int(f.imageResolution.height))-\(f.framesPerSecond)"
            guard seen.insert(key).inserted else { continue }
            let c = ARWorldTrackingConfiguration()
            c.videoFormat = f
            let before = snapshot()
            let n0 = frameCount()
            let t0 = Date()
            session.run(c, options: [])
            Thread.sleep(forTimeInterval: 1.0)
            var firstNormal: Double?
            var tries = 0
            while tries < 40 {
                if let s = snapshot()["tracking"] as? String, s == "normal", (snapshot()["w"] as? Int) == Int(f.imageResolution.width) { firstNormal = Date().timeIntervalSince(t0); break }
                Thread.sleep(forTimeInterval: 0.25)
                tries += 1
            }
            Thread.sleep(forTimeInterval: 4.0)
            let n1 = frameCount()
            let after = snapshot()
            steps.append(["format": key, "before": before, "after": after, "jump_m": dist(before, after) ?? -1, "normal_after_s": firstNormal ?? -1,
                          "fps": Double(n1 - n0) / Date().timeIntervalSince(t0), "hfov_deg": after["hfov_deg"] ?? -1])
            result["format_switch"] = steps
            save(result)
        }
        // ④ARKit を止めて、超広角を単独で動かし、ARKit に戻す
        if let d = AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back) {
            let before = snapshot()
            session.pause()
            let cap = AVCaptureSession()
            var info: [String: Any] = [:]
            do {
                cap.beginConfiguration()
                let input = try AVCaptureDeviceInput(device: d)
                if cap.canAddInput(input) { cap.addInput(input) }
                let out = AVCaptureVideoDataOutput()
                out.setSampleBufferDelegate(self, queue: queue)
                if cap.canAddOutput(out) { cap.addOutput(out) }
                let best = d.formats.max { a, b in
                    let x = CMVideoFormatDescriptionGetDimensions(a.formatDescription), y = CMVideoFormatDescriptionGetDimensions(b.formatDescription)
                    let fa = a.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 0, fb = b.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 0
                    if (fa >= 30) != (fb >= 30) { return fb >= 30 }
                    return Int(x.width) * Int(x.height) < Int(y.width) * Int(y.height)
                }
                try d.lockForConfiguration()
                if let best { d.activeFormat = best }
                d.unlockForConfiguration()
                cap.commitConfiguration()
                videoLock.lock(); videoFrames = 0; videoLock.unlock()
                let tStart = Date()
                cap.startRunning()
                Thread.sleep(forTimeInterval: 5)
                videoLock.lock(); let n = videoFrames; videoLock.unlock()
                let dim = CMVideoFormatDescriptionGetDimensions(d.activeFormat.formatDescription)
                info = ["size": "\(dim.width)x\(dim.height)", "fov_deg": Double(d.activeFormat.videoFieldOfView), "fps": Double(n) / Date().timeIntervalSince(tStart), "frames": n]
                cap.stopRunning()
            } catch { info["error"] = error.localizedDescription }
            // ARKit に戻す(やり直しなし)
            let c = ARWorldTrackingConfiguration()
            if let f = ARWorldTrackingConfiguration.supportedVideoFormats.first(where: { $0.imageResolution.width >= 3800 }) { c.videoFormat = f }
            let t0 = Date()
            session.run(c, options: [])
            var firstNormal: Double?
            var tries = 0
            while tries < 120 {
                Thread.sleep(forTimeInterval: 0.25)
                if let s = snapshot()["tracking"] as? String, s == "normal", (snapshot()["ts"] as? Double ?? 0) > (before["ts"] as? Double ?? 0) { firstNormal = Date().timeIntervalSince(t0); break }
                tries += 1
            }
            Thread.sleep(forTimeInterval: 3)
            let after = snapshot()
            info["back_to_arkit"] = ["normal_after_s": firstNormal ?? -1, "before": before, "after": after, "jump_m": dist(before, after) ?? -1]
            result["ultrawide_alone"] = info
        } else {
            result["ultrawide_alone"] = ["error": "超広角が無い"]
        }
        result["done"] = true
        save(result)
    }
}
