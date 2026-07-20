import SwiftUI

struct ContentView: View {
    @StateObject private var adBlocker = AdBlocker()
    @State private var canGoBack = false
    @State private var canGoForward = false
    @State private var toolbarVisible = true
    @State private var toolbarHideTask: Task<Void, Never>?

    var body: some View {
        ZStack(alignment: .bottom) {
            WebView(
                adBlocker: adBlocker,
                canGoBack: $canGoBack,
                canGoForward: $canGoForward
            )
            .ignoresSafeArea()
            .onAppear {
                adBlocker.loadAssets()
                scheduleToolbarHide()
            }
            .onTapGesture {
                showToolbar()
            }

            if toolbarVisible {
                toolbar
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onAppear { scheduleToolbarHide() }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: toolbarVisible)
    }

    private var toolbar: some View {
        HStack(spacing: 0) {
            toolbarButton(
                systemName: "chevron.left",
                action: { notifyWebView("goBack") },
                disabled: !canGoBack
            )
            toolbarButton(
                systemName: "chevron.right",
                action: { notifyWebView("goForward") },
                disabled: !canGoForward
            )
            Spacer()
            toolbarButton(
                systemName: adBlocker.enabled ? "shield.fill" : "shield.slash",
                action: { adBlocker.toggle() },
                disabled: false
            )
            toolbarButton(
                systemName: "arrow.clockwise",
                action: { notifyWebView("reload") },
                disabled: false
            )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }

    private func toolbarButton(systemName: String, action: @escaping () -> Void, disabled: Bool) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(disabled ? .gray.opacity(0.4) : .white)
                .frame(width: 44, height: 44)
        }
        .disabled(disabled)
    }

    private func notifyWebView(_ action: String) {
        showToolbar()
        let userInfo = ["action": action]
        NotificationCenter.default.post(name: .webViewAction, object: nil, userInfo: userInfo)
    }

    private func showToolbar() {
        toolbarHideTask?.cancel()
        toolbarVisible = true
        scheduleToolbarHide()
    }

    private func scheduleToolbarHide() {
        toolbarHideTask?.cancel()
        toolbarHideTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if !Task.isCancelled {
                toolbarVisible = false
            }
        }
    }
}

extension Notification.Name {
    static let webViewAction = Notification.Name("webViewAction")
}

#Preview {
    ContentView()
}
