import SwiftUI

@main
struct ShootLogApp: App {
    var body: some Scene {
        WindowGroup {
            ShootLogRepresentable()
                .ignoresSafeArea()
                .statusBarHidden(true)
        }
    }
}
