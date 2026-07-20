import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    @ObservedObject var adBlocker: AdBlocker
    @Binding var canGoBack: Bool
    @Binding var canGoForward: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(adBlocker: adBlocker, canGoBack: $canGoBack, canGoForward: $canGoForward)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        if !adBlocker.injectScript.isEmpty {
            let userScript = WKUserScript(
                source: adBlocker.injectScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: false
            )
            config.userContentController.addUserScript(userScript)
        }

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

        if let url = URL(string: "https://m.youtube.com") {
            webView.load(URLRequest(url: url))
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        let adBlocker: AdBlocker
        var canGoBack: Binding<Bool>
        var canGoForward: Binding<Bool>
        weak var webView: WKWebView?

        init(adBlocker: AdBlocker, canGoBack: Binding<Bool>, canGoForward: Binding<Bool>) {
            self.adBlocker = adBlocker
            self.canGoBack = canGoBack
            self.canGoForward = canGoForward
            super.init()
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleAction),
                name: .webViewAction,
                object: nil
            )
        }

        deinit {
            NotificationCenter.default.removeObserver(self, name: .webViewAction, object: nil)
        }

        @objc private func handleAction(_ notification: Notification) {
            guard let action = notification.userInfo?["action"] as? String else { return }
            DispatchQueue.main.async { [weak self] in
                guard let webView = self?.webView else { return }
                switch action {
                case "goBack": webView.goBackIfPossible()
                case "goForward": webView.goForwardIfPossible()
                case "reload": webView.reload()
                default: break
                }
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if let url = navigationAction.request.url, adBlocker.shouldBlock(url) {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            self.webView = webView
            canGoBack.wrappedValue = webView.canGoBack
            canGoForward.wrappedValue = webView.canGoForward
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            self.webView = webView
            canGoBack.wrappedValue = webView.canGoBack
            canGoForward.wrappedValue = webView.canGoForward
        }
    }
}

extension WKWebView {
    func goBackIfPossible() {
        if canGoBack { goBack() }
    }

    func goForwardIfPossible() {
        if canGoForward { goForward() }
    }
}
