import Foundation
import RoomPlan

/// 撮影の状態と結果。画面(SwiftUI)と RoomCaptureView の橋渡し。
@MainActor
final class ScanModel: ObservableObject {
    enum Phase {
        case ready        // 開始前
        case scanning     // 歩いて撮っている
        case processing   // 「終わり」を押したあと、整えている
        case done         // 結果ができた
    }

    @Published var phase: Phase = .ready
    @Published var message = ""
    @Published var summary = ""
    @Published var exported: [URL] = []

    weak var captureView: RoomCaptureView?
    private(set) var room: CapturedRoom?

    static var isSupported: Bool { RoomCaptureSession.isSupported }

    func start() {
        room = nil
        exported = []
        summary = ""
        message = ""
        phase = .scanning
    }

    func finishScanning() {
        guard phase == .scanning else { return }
        phase = .processing
        captureView?.captureSession.stop()
    }

    func receive(_ room: CapturedRoom, error: Error?) {
        if let error {
            message = "整える途中で問題: \(error.localizedDescription)"
        }
        self.room = room
        summary = ScanExporter.summary(of: room)
        phase = .done
    }

    func export() {
        guard let room else { return }
        do {
            exported = try ScanExporter.write(room)
            message = "\(exported.count) 個のファイルを保存した"
        } catch {
            message = "保存に失敗: \(error.localizedDescription)"
        }
    }

    func reset() {
        room = nil
        exported = []
        summary = ""
        message = ""
        phase = .ready
    }
}
