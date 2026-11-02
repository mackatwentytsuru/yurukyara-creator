import ARKit
import AVFoundation
import Foundation

/// ARFrame の映像を video.mov に、コマごとの姿勢・画角を frames.jsonl に書く。
/// append と finish は同じ直列キュー(ARSession の delegateQueue)から呼ぶこと。
/// 映像に書いたコマだけを frames.jsonl に書く(コマ番号 i = 映像の i コマ目)。書けずに捨てたコマは数えて meta に残す。
final class ShootRecorder {
    let dir: URL
    private let nominalFps: Int
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private let framesHandle: FileHandle
    private var buffer = ""
    private var t0: Double?
    private var lastPts: Double = 0
    private var width = 0
    private var height = 0
    private var dropped: [Double] = []
    private var notNormal = 0
    private(set) var frameCount = 0
    private var finished = false
    private var writerError: String?

    init(dir: URL, nominalFps: Int) throws {
        self.dir = dir
        self.nominalFps = nominalFps
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let framesURL = dir.appendingPathComponent("frames.jsonl")
        FileManager.default.createFile(atPath: framesURL.path, contents: nil)
        framesHandle = try FileHandle(forWritingTo: framesURL)
    }

    var currentFrameCount: Int { frameCount }
    var droppedCount: Int { dropped.count }

    private func setup(width: Int, height: Int, firstTimestamp: Double) {
        t0 = firstTimestamp
        self.width = width
        self.height = height
        do {
            let w = try AVAssetWriter(outputURL: dir.appendingPathComponent("video.mov"), fileType: .mov)
            let bitrate = Int(Double(width * height * max(nominalFps, 1)) * 0.12)
            let settings: [String: Any] = [
                AVVideoCodecKey: AVVideoCodecType.hevc,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: bitrate,
                    AVVideoExpectedSourceFrameRateKey: nominalFps,
                ],
            ]
            let inp = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
            inp.expectsMediaDataInRealTime = true
            guard w.canAdd(inp) else {
                writerError = "映像の入力を足せない"
                return
            }
            w.add(inp)
            adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: inp, sourcePixelBufferAttributes: nil)
            guard w.startWriting() else {
                writerError = w.error?.localizedDescription ?? "書き始められない"
                return
            }
            w.startSession(atSourceTime: .zero)
            writer = w
            input = inp
        } catch {
            writerError = error.localizedDescription
        }
    }

    func append(_ frame: ARFrame) {
        guard !finished else { return }
        let pb = frame.capturedImage
        if t0 == nil {
            setup(width: CVPixelBufferGetWidth(pb), height: CVPixelBufferGetHeight(pb), firstTimestamp: frame.timestamp)
        }
        guard let t0, let writer, let input, let adaptor, writer.status == .writing else { return }
        let relative = frame.timestamp - t0
        guard input.isReadyForMoreMediaData else {
            dropped.append(relative)
            return
        }
        let pts = CMTime(seconds: relative, preferredTimescale: 1_000_000)
        guard adaptor.append(pb, withPresentationTime: pts) else {
            dropped.append(relative)
            if writerError == nil { writerError = writer.error?.localizedDescription }
            return
        }
        lastPts = relative

        let cam = frame.camera
        let (track, ok) = Pack.tracking(cam.trackingState)
        if !ok { notNormal += 1 }
        let t = Pack.flat(cam.transform).map { String(format: "%.6f", $0) }.joined(separator: ",")
        let k = Pack.intrinsics(cam).map { String(format: "%.3f", $0) }.joined(separator: ",")
        buffer += "{\"i\":\(frameCount),\"t\":\(String(format: "%.6f", frame.timestamp)),\"pts\":\(String(format: "%.6f", relative)),"
            + "\"T\":[\(t)],\"K\":[\(k)],\"track\":\"\(track)\",\"ok\":\(ok),\"exp\":\(String(format: "%.5f", cam.exposureDuration))}\n"
        frameCount += 1
        if buffer.utf8.count > 64_000 { flush() }
    }

    private func flush() {
        guard !buffer.isEmpty else { return }
        framesHandle.write(Data(buffer.utf8))
        buffer = ""
    }

    func finish(_ done: @escaping (ShootStats) -> Void) {
        guard !finished else { return }
        finished = true
        flush()
        try? framesHandle.close()
        func stats() -> ShootStats {
            ShootStats(
                frames: frameCount,
                droppedFrames: dropped.count,
                droppedAtSeconds: Array(dropped.prefix(200)),
                trackingNotNormalFrames: notNormal,
                durationSeconds: lastPts,
                averageFps: lastPts > 0 ? Double(frameCount - 1) / lastPts : 0,
                width: width,
                height: height,
                firstSessionTimestamp: t0,
                writerError: writerError
            )
        }
        guard let writer, let input, writer.status == .writing else {
            done(stats())
            return
        }
        input.markAsFinished()
        writer.finishWriting {
            if writer.status != .completed, self.writerError == nil {
                self.writerError = writer.error?.localizedDescription ?? "書き終わりに失敗"
            }
            done(stats())
        }
    }
}
