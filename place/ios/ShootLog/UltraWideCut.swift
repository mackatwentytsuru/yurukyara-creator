import AVFoundation
import CoreMedia
import Foundation

/// 超広角のカットの録画。ARKit と同時に使えないので、ARKit を止めてから使う(位置の記録も AR モニターも無い)。
/// 4K 30 fps の HEVC を Documents/ultrawide/<名前>.mov に書き、内部パラメータ(コマごとに付く値)を <名前>.json に書く。
final class UltraWideCut: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "ultrawide.video", qos: .userInitiated)
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var started = false
    private var frames = 0, dropped = 0
    private var firstK: [Float]?
    private var firstPts: CMTime?
    private var lastPts: CMTime?
    private var info: [String: Any] = [:]
    private var url: URL?
    private(set) var running = false

    /// 超広角の 4K 30 fps の形式(16:9 で画角が最大)を選ぶ
    private static func bestFormat(_ d: AVCaptureDevice) -> AVCaptureDevice.Format? {
        d.formats.filter { f in
            let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            return dim.width == 3840 && dim.height == 2160 && f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= 30 && $0.minFrameRate <= 30 }
        }.max { $0.videoFieldOfView < $1.videoFieldOfView }
    }

    /// 始める。correction は歪みの補正(既定 true = iOS が直してから出す)。iso が 0 なら露出は自動。
    func start(name: String, correction: Bool, iso: Float, kbps: Int = 50000) throws {
        guard let d = AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back), let format = Self.bestFormat(d) else {
            throw NSError(domain: "UltraWideCut", code: 1, userInfo: [NSLocalizedDescriptionKey: "超広角の 4K 30 fps が無い"])
        }
        let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("ultrawide", isDirectory: true)
        try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
        let url = docs.appendingPathComponent("\(name).mov")
        try? FileManager.default.removeItem(at: url)
        self.url = url
        session.beginConfiguration()
        session.sessionPreset = .inputPriority
        let camInput = try AVCaptureDeviceInput(device: d)
        guard session.canAddInput(camInput) else { throw NSError(domain: "UltraWideCut", code: 2, userInfo: [NSLocalizedDescriptionKey: "入力を足せない"]) }
        session.addInput(camInput)
        let out = AVCaptureVideoDataOutput()
        out.alwaysDiscardsLateVideoFrames = false
        out.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(out) else { throw NSError(domain: "UltraWideCut", code: 3, userInfo: [NSLocalizedDescriptionKey: "出力を足せない"]) }
        session.addOutput(out)
        try d.lockForConfiguration()
        d.activeFormat = format
        d.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
        d.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
        if d.isGeometricDistortionCorrectionSupported { d.isGeometricDistortionCorrectionEnabled = correction }
        if iso > 0, d.isExposureModeSupported(.custom) {
            let v = max(format.minISO, min(format.maxISO, iso))
            d.setExposureModeCustom(duration: CMTime(value: 1, timescale: 60), iso: v, completionHandler: nil)
        }
        d.unlockForConfiguration()
        var kDelivery = false
        if let c = out.connection(with: .video) {
            if c.isCameraIntrinsicMatrixDeliverySupported { c.isCameraIntrinsicMatrixDeliveryEnabled = true; kDelivery = true }
            if c.isVideoOrientationSupported { c.videoOrientation = .landscapeRight }
        }
        session.commitConfiguration()
        let w = try AVAssetWriter(outputURL: url, fileType: .mov)
        let settings: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.hevc, AVVideoWidthKey: 3840, AVVideoHeightKey: 2160,
                                       AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: kbps * 1000]]
        let vi = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        vi.expectsMediaDataInRealTime = true
        w.add(vi)
        writer = w
        input = vi
        info = ["name": name, "fov_deg": Double(format.videoFieldOfView), "correction_requested": correction,
                "correction_supported": d.isGeometricDistortionCorrectionSupported, "correction_enabled": d.isGeometricDistortionCorrectionEnabled,
                "iso": Double(iso), "k_delivery": kDelivery, "size": [3840, 2160]]
        running = true
        session.startRunning()
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sb: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard running, let w = writer, let vi = input else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        if !started {
            guard w.startWriting() else { return }
            w.startSession(atSourceTime: pts)
            started = true
            firstPts = pts
        }
        if firstK == nil, let a = CMGetAttachment(sb, key: kCMSampleBufferAttachmentKey_CameraIntrinsicMatrix, attachmentModeOut: nil) as? Data, a.count >= MemoryLayout<matrix_float3x3>.size {
            let m = a.withUnsafeBytes { $0.load(as: matrix_float3x3.self) }
            firstK = [m[0][0], m[1][1], m[2][0], m[2][1]]
        }
        if vi.isReadyForMoreMediaData, vi.append(sb) { frames += 1; lastPts = pts } else { dropped += 1 }
    }

    func captureOutput(_ output: AVCaptureOutput, didDrop sb: CMSampleBuffer, from connection: AVCaptureConnection) { dropped += 1 }

    /// 止めて、ファイルを閉じ、情報を書く
    func stop(done: @escaping ([String: Any]) -> Void) {
        running = false
        session.stopRunning()
        queue.async { [self] in
            input?.markAsFinished()
            writer?.finishWriting { [self] in
                info["frames"] = frames
                info["dropped"] = dropped
                if let a = firstPts, let b = lastPts { info["seconds"] = CMTimeGetSeconds(b - a); info["fps"] = Double(frames - 1) / max(CMTimeGetSeconds(b - a), 0.001) }
                if let k = firstK { info["K"] = k.map { Double($0) } }
                info["file_bytes"] = (try? FileManager.default.attributesOfItem(atPath: url?.path ?? "")[.size] as? Int) ?? 0
                info["writer_status"] = writer?.status.rawValue ?? -1
                if let u = url, let d = try? JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted]) {
                    try? d.write(to: u.deletingPathExtension().appendingPathExtension("json"))
                }
                done(info)
            }
        }
    }
}
