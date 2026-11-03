import CoreMedia
import Foundation
import QuartzCore
import VideoToolbox

/// ハードウェアの HEVC 符号化(VideoToolbox)。1 コマずつ渡し、符号化できた順に Annex B(開始コード 0x00000001 つき、キーフレームには VPS/SPS/PPS つき)で返す。
/// 低遅れ設定(Bフレームなし、リアルタイム)。送りに使うので、遅れたら呼び出し側がコマを捨てる(inFlight を見る)。
final class HEVCEncoder {
    struct Context {
        var seq: UInt32
        var recFrame: Int32
        var arTimestamp: Double
        var captureMs: Double
        var T: [Float]
        var K: [Float]
        var trackingOk: Bool
        var recording: Bool
    }

    private var session: VTCompressionSession?
    private let lock = NSLock()
    private var inFlightCount = 0
    private(set) var width: Int
    private(set) var height: Int
    var onEncoded: ((Data, Bool, Context, Double) -> Void)?   // (Annex B のデータ, キーフレームか, 文脈, 符号化にかかった ms)
    private var encodeErrors = 0

    var inFlight: Int { lock.lock(); defer { lock.unlock() }; return inFlightCount }
    var errors: Int { lock.lock(); defer { lock.unlock() }; return encodeErrors }

    init?(width: Int, height: Int, fps: Int, kbps: Int) {
        self.width = width
        self.height = height
        let spec: [CFString: Any] = [
            kVTVideoEncoderSpecification_EnableLowLatencyRateControl: true,
        ]
        var s: VTCompressionSession?
        let st = VTCompressionSessionCreate(allocator: kCFAllocatorDefault, width: Int32(width), height: Int32(height), codecType: kCMVideoCodecType_HEVC,
                                            encoderSpecification: spec as CFDictionary, imageBufferAttributes: nil, compressedDataAllocator: nil,
                                            outputCallback: nil, refcon: nil, compressionSessionOut: &s)
        guard st == noErr, let s else { return nil }
        session = s
        func set(_ key: CFString, _ value: CFTypeRef) { VTSessionSetProperty(s, key: key, value: value) }
        set(kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
        set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_HEVC_Main_AutoLevel)
        set(kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
        set(kVTCompressionPropertyKey_AverageBitRate, NSNumber(value: kbps * 1000))
        set(kVTCompressionPropertyKey_DataRateLimits, [NSNumber(value: kbps * 1000 / 8 * 3 / 2), NSNumber(value: 1)] as CFArray)
        set(kVTCompressionPropertyKey_ExpectedFrameRate, NSNumber(value: fps))
        set(kVTCompressionPropertyKey_MaxKeyFrameInterval, NSNumber(value: fps * 2))
        VTCompressionSessionPrepareToEncodeFrames(s)
    }

    deinit {
        if let s = session { VTCompressionSessionInvalidate(s) }
    }

    func encode(_ pixelBuffer: CVPixelBuffer, pts: CMTime, context: Context) {
        guard let s = session else { return }
        lock.lock(); inFlightCount += 1; lock.unlock()
        let t0 = CACurrentMediaTime()
        let st = VTCompressionSessionEncodeFrame(s, imageBuffer: pixelBuffer, presentationTimeStamp: pts, duration: .invalid, frameProperties: nil, infoFlagsOut: nil) { [weak self] status, _, sample in
            guard let self else { return }
            defer { self.lock.lock(); self.inFlightCount -= 1; self.lock.unlock() }
            guard status == noErr, let sample, let (data, key) = Self.annexB(sample) else {
                self.lock.lock(); self.encodeErrors += 1; self.lock.unlock()
                return
            }
            self.onEncoded?(data, key, context, (CACurrentMediaTime() - t0) * 1000)
        }
        if st != noErr {
            lock.lock(); inFlightCount -= 1; encodeErrors += 1; lock.unlock()
        }
    }

    private static let startCode = Data([0, 0, 0, 1])

    static func annexB(_ sample: CMSampleBuffer) -> (Data, Bool)? {
        guard let fd = CMSampleBufferGetFormatDescription(sample), let block = CMSampleBufferGetDataBuffer(sample) else { return nil }
        var key = true
        if let arr = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]], let d = arr.first {
            key = !((d[kCMSampleAttachmentKey_NotSync] as? Bool) ?? false)
        }
        var out = Data()
        if key {
            var count = 0
            CMVideoFormatDescriptionGetHEVCParameterSetAtIndex(fd, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil, parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
            for i in 0..<count {
                var ptr: UnsafePointer<UInt8>?
                var size = 0
                if CMVideoFormatDescriptionGetHEVCParameterSetAtIndex(fd, parameterSetIndex: i, parameterSetPointerOut: &ptr, parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let ptr {
                    out.append(startCode)
                    out.append(ptr, count: size)
                }
            }
        }
        var length = 0
        var dataPtr: UnsafeMutablePointer<CChar>?
        guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPtr) == kCMBlockBufferNoErr, let dataPtr else { return nil }
        let base = UnsafeRawPointer(dataPtr)
        var off = 0
        while off + 4 <= length {
            var l: UInt32 = 0
            memcpy(&l, base + off, 4)
            let n = Int(UInt32(bigEndian: l))
            off += 4
            guard n > 0, off + n <= length else { break }
            out.append(startCode)
            out.append(Data(bytes: base + off, count: n))
            off += n
        }
        return (out, key)
    }
}
