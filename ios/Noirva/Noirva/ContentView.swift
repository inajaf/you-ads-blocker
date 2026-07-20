import SwiftUI

struct ContentView: View {
    @StateObject private var adBlocker = AdBlocker()
    @State private var canGoBack = false
    @State private var canGoForward = false

    var body: some View {
        WebView(
            adBlocker: adBlocker,
            canGoBack: $canGoBack,
            canGoForward: $canGoForward
        )
        .ignoresSafeArea()
        .onAppear {
            adBlocker.loadAssets()
        }
    }
}

#Preview {
    ContentView()
}
