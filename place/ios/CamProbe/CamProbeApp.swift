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
        UIApplication.shared.isIdleTimerDisabled = true
        let docs = try? FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let logURL = docs?.appendingPathComponent("probe_log.txt")
        if let logURL { try? "start \(Date())\n".write(to: logURL, atomically: true, encoding: .utf8) }
        func append(_ line: String) {
            guard let logURL, let h = try? FileHandle(forWritingTo: logURL) else { return }
            h.seekToEndOfFile()
            h.write((line + "\n").data(using: .utf8) ?? Data())
            try? h.close()
        }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            let result = Probe().run { line in append(line); DispatchQueue.main.async { self.text += "\n" + line } }
            if let docs = try? FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true),
               let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: docs.appendingPathComponent("multicam_probe.json"))
            }
            DispatchQueue.main.async { self.text += "\n\n== 終わり(Documents/multicam_probe.json) ==" }
        }
    }
}
