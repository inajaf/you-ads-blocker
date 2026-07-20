import SwiftUI
import WebKit

/// UIViewRepresentable wrapper around WKWebView with two-layer ad blocking:
///   1. Network layer — WKNavigationDelegate blocks requests matching the blocklist.
///   2. Page layer — WKUserScript injects ad-stripping JS at document-start.
struct WebView: UIViewRepresentable {
    @ObservedObject var adBlocker: AdBlocker

    func makeCoordinator() -> Coordinator {
        Coordinator(adBlocker: adBlocker)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // Register the inject script to run at document-start in the main world.
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

        // Use a mobile Chrome user-agent so YouTube serves the phone site.
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

        // Load YouTube mobile.
        if let url = URL(string: "https://m.youtube.com") {
            webView.load(URLRequest(url: url))
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    // MARK: - Coordinator (Navigation Delegate)

    class Coordinator: NSObject, WKNavigationDelegate {
        let adBlocker: AdBlocker

        init(adBlocker: AdBlocker) {
            self.adBlocker = adBlocker
        }

        // Network-layer blocking: cancel navigation AND subresource requests matching the blocklist.
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

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // Page loaded successfully.
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            // Navigation failed — YouTube will retry.
        }
    }
}
