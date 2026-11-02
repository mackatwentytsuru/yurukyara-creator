import SwiftUI
import RoomPlan

/// RoomCaptureViewDelegate は NSCoding を求めるので、入れ子にせず外に置く(名前が不安定になるため)。
final class CaptureCoordinator: NSObject, RoomCaptureViewDelegate {
    let model: ScanModel
    init(model: ScanModel) { self.model = model }

    // 保存はしないので空でよい。
    required init?(coder: NSCoder) { return nil }
    func encode(with coder: NSCoder) {}

    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        true
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        Task { @MainActor in model.receive(processedResult, error: error) }
    }
}

/// RoomCaptureView(Apple の撮影画面)を SwiftUI に載せる。
struct CaptureView: UIViewRepresentable {
    @ObservedObject var model: ScanModel

    func makeCoordinator() -> CaptureCoordinator { CaptureCoordinator(model: model) }

    func makeUIView(context: Context) -> RoomCaptureView {
        let view = RoomCaptureView(frame: .zero)
        view.delegate = context.coordinator
        model.captureView = view
        view.captureSession.run(configuration: RoomCaptureSession.Configuration())
        return view
    }

    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}

    static func dismantleUIView(_ uiView: RoomCaptureView, coordinator: CaptureCoordinator) {
        uiView.captureSession.stop()
    }
}
