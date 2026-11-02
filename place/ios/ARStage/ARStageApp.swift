import SwiftUI

@main
struct ARStageApp: App {
    var body: some Scene {
        WindowGroup {
            ARHostView().ignoresSafeArea()
        }
    }
}

struct ARHostView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> ARHostController { ARHostController() }
    func updateUIViewController(_ uiViewController: ARHostController, context: Context) {}
}
