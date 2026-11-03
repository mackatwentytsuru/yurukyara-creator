import AVFoundation
import Foundation

/// マイクの音を、映像と同じ時計(ホスト時間 = ARFrame.timestamp と同じ「端末の起動からの秒」)の時刻つきで取る。
/// 自動の音量調整などを切るため AVAudioSession の mode は measurement。取った音は、録画(video.mov の音声トラック)と PC 送り(AUD1)の両方に渡す。
/// 初回はマイクの許可の窓が出る(本人が「許可」を押す)。
struct AudioSummary: Codable {
    var enabled: Bool
    var sampleRate: Double
    var channels: Int
    var buffers: Int
    var samples: Int
    var peakDbfs: Double
    var route: String
    var firstPtsSeconds: Double?     // 最初の音の時刻(ホスト時間の秒。frames.jsonl の t と同じ時計)
    var note: String
}

final class AudioCapture: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "shootlog.audio", qos: .userInitiated)
    private let lock = NSLock()
    private(set) var running = false
    private var buffers = 0, samples = 0
    private var peak: Float = 0
    private var sampleRate = 0.0
    private var channels = 0
    private var firstPts: Double?
    private var route = ""
    var onSample: ((CMSampleBuffer) -> Void)?

    var peakDbfs: Double { lock.lock(); defer { lock.unlock() }; return peak > 0 ? 20 * log10(Double(peak)) : -120 }

    func start(completion: @escaping (String?) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
            guard let self else { return }
            guard granted else { completion("マイクが許可されていない: 設定 → 撮影記録 → マイク をオン"); return }
            self.queue.async { completion(self.configureAndRun()) }
        }
    }

    private func configureAndRun() -> String? {
        guard !running else { return nil }
        do {
            let a = AVAudioSession.sharedInstance()
            try a.setCategory(.record, mode: .measurement, options: [])
            try a.setPreferredSampleRate(48000)
            try a.setPreferredIOBufferDuration(0.005)
            try a.setActive(true)
            route = a.currentRoute.inputs.map { "\($0.portName)" }.joined(separator: ",")
            guard let dev = AVCaptureDevice.default(for: .audio) else { return "マイクが見つからない" }
            session.beginConfiguration()
            session.automaticallyConfiguresApplicationAudioSession = false
            let input = try AVCaptureDeviceInput(device: dev)
            guard session.canAddInput(input) else { session.commitConfiguration(); return "マイクの入力を足せない" }
            session.addInput(input)
            let out = AVCaptureAudioDataOutput()
            out.setSampleBufferDelegate(self, queue: queue)
            guard session.canAddOutput(out) else { session.commitConfiguration(); return "音の出力を足せない" }
            session.addOutput(out)
            session.commitConfiguration()
            lock.lock(); buffers = 0; samples = 0; peak = 0; firstPts = nil; lock.unlock()
            session.startRunning()
            running = true
            return nil
        } catch {
            return "マイクを始められない: \(error.localizedDescription)"
        }
    }

    func stop() {
        guard running else { return }
        session.stopRunning()
        for i in session.inputs { session.removeInput(i) }
        for o in session.outputs { session.removeOutput(o) }
        running = false
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
        let n = CMSampleBufferGetNumSamples(sampleBuffer)
        if let fd = CMSampleBufferGetFormatDescription(sampleBuffer), let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fd)?.pointee {
            lock.lock(); sampleRate = asbd.mSampleRate; channels = Int(asbd.mChannelsPerFrame); lock.unlock()
            var p: Float = 0
            var blockBuffer: CMBlockBuffer?
            var abl = AudioBufferList()
            if CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: &abl, bufferListSize: MemoryLayout<AudioBufferList>.size,
                                                                       blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &blockBuffer) == noErr,
               let data = abl.mBuffers.mData {
                let bytes = Int(abl.mBuffers.mDataByteSize)
                if asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0 {
                    let c = bytes / 4
                    let ptr = data.assumingMemoryBound(to: Float.self)
                    for i in 0..<c { p = max(p, abs(ptr[i])) }
                } else if asbd.mBitsPerChannel == 16 {
                    let c = bytes / 2
                    let ptr = data.assumingMemoryBound(to: Int16.self)
                    for i in 0..<c { p = max(p, abs(Float(ptr[i])) / 32768) }
                }
            }
            lock.lock(); peak = max(peak, p); lock.unlock()
        }
        lock.lock(); buffers += 1; samples += n; if firstPts == nil { firstPts = pts }; lock.unlock()
        onSample?(sampleBuffer)
    }

    func summary(note: String = "") -> AudioSummary {
        lock.lock(); defer { lock.unlock() }
        return AudioSummary(enabled: running, sampleRate: sampleRate, channels: channels, buffers: buffers, samples: samples,
                            peakDbfs: peak > 0 ? (20 * log10(Double(peak)) * 10).rounded() / 10 : -120, route: route, firstPtsSeconds: firstPts, note: note)
    }

    var statusText: String {
        guard running else { return "" }
        let s = summary()
        return "音: \(Int(s.sampleRate / 1000)) kHz \(s.channels)ch \(String(format: "%.0f", s.peakDbfs)) dBFS(最大) \(s.buffers) 塊"
    }
}
