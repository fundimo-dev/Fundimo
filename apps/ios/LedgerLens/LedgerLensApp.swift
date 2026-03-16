import SwiftUI

@main
struct FundimoApp: App {
    @StateObject private var sessionStore = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView(sessionStore: sessionStore)
                .task {
                    await sessionStore.checkSession()
                }
                .onOpenURL { url in
                    sessionStore.handleOAuthCallback(url: url)
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL else { return }
                    sessionStore.handleOAuthCallback(url: url)
                }
        }
    }
}
