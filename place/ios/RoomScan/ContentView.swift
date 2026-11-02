import SwiftUI

struct ContentView: View {
    @StateObject private var model = ScanModel()

    var body: some View {
        ZStack {
            switch model.phase {
            case .ready:
                ready
            case .scanning, .processing:
                CaptureView(model: model).ignoresSafeArea()
                VStack {
                    Spacer()
                    if model.phase == .scanning {
                        Button("撮り終わり") { model.finishScanning() }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                            .padding(.bottom, 32)
                    } else {
                        ProgressView("部屋の形を整えています…")
                            .padding()
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                            .padding(.bottom, 32)
                    }
                }
            case .done:
                done
            }
        }
    }

    private var ready: some View {
        VStack(spacing: 20) {
            Text("場所スキャン").font(.largeTitle.bold())
            Text("壁ぞいにゆっくり 1 周して、床・ドア・窓・家具をまんべんなく向けてください。人の顔は写さないでください。映像は保存しません。")
                .font(.callout).multilineTextAlignment(.center)
            if ScanModel.isSupported {
                Button("撮りはじめる") { model.start() }
                    .buttonStyle(.borderedProminent).controlSize(.large)
            } else {
                Text("この端末は LiDAR による部屋の撮影に対応していません").foregroundStyle(.red)
            }
        }
        .padding(24)
    }

    private var done: some View {
        VStack(spacing: 16) {
            Text("撮れました").font(.title.bold())
            Text(model.summary).multilineTextAlignment(.center)
            if model.exported.isEmpty {
                Button("ファイルにする") { model.export() }
                    .buttonStyle(.borderedProminent).controlSize(.large)
            } else {
                ShareLink(items: model.exported) {
                    Label("Mac へ送る(AirDrop など)", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
            }
            if !model.message.isEmpty {
                Text(model.message).font(.footnote).foregroundStyle(.secondary)
            }
            Button("もう 1 回撮る") { model.reset() }
        }
        .padding(24)
    }
}
