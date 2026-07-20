import SwiftUI

struct ContentView: View {
    @StateObject private var adBlocker = AdBlocker()

    var body: some View {
        WebView(adBlocker: adBlocker)
            .ignoresSafeArea()
            .onAppear {
                adBlocker.loadAssets()
            }
    }
}

#Preview {
    ContentView()
}
