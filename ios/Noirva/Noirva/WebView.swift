import SwiftUI
import WebKit

struct WebView: UIViewControllerRepresentable {
    @ObservedObject var adBlocker: AdBlocker

    func makeCoordinator() -> Coordinator {
        Coordinator(adBlocker: adBlocker)
    }

    func makeUIViewController(context: Context) -> WebViewController {
        WebViewController(coordinator: context.coordinator, adBlocker: adBlocker)
    }

    func updateUIViewController(_ vc: WebViewController, context: Context) {}

    class Coordinator: NSObject, WKNavigationDelegate {
        let adBlocker: AdBlocker
        weak var webView: WKWebView?

        init(adBlocker: AdBlocker) {
            self.adBlocker = adBlocker
        }

        func webView(_ webView: WKWebView, decidePolicyFor navAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            self.webView = webView
            if let url = navAction.request.url, adBlocker.shouldBlock(url) {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}

class WebViewController: UIViewController {
    private let coordinator: WebView.Coordinator
    private let adBlocker: AdBlocker
    private var webView: WKWebView!
    private var shieldBtn: UIButton!
    private var toolbar: UIView!

    init(coordinator: WebView.Coordinator, adBlocker: AdBlocker) {
        self.coordinator = coordinator
        self.adBlocker = adBlocker
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        compileRulesThenSetup()
    }

    private func compileRulesThenSetup() {
        guard let rulesURL = Bundle.main.url(forResource: "adblock-rules", withExtension: "json"),
              let json = try? String(contentsOf: rulesURL, encoding: .utf8) else {
            setupWebView(with: nil)
            return
        }

        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "noirva-adblock",
            encodedContentRuleList: json
        ) { [weak self] ruleList, error in
            DispatchQueue.main.async {
                if let error = error {
                    NSLog("[Noirva] WKContentRuleList compile error: %@", error.localizedDescription)
                }
                self?.setupWebView(with: ruleList)
            }
        }
    }

    private func setupWebView(with ruleList: WKContentRuleList?) {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        if let rules = ruleList {
            config.userContentController.add(rules)
        }

        if !adBlocker.injectScript.isEmpty {
            let script = WKUserScript(source: adBlocker.injectScript, injectionTime: .atDocumentStart, forMainFrameOnly: false)
            config.userContentController.addUserScript(script)
        }

        if let domLayerURL = Bundle.main.url(forResource: "dom-layer", withExtension: "js"),
           let domLayerJS = try? String(contentsOf: domLayerURL, encoding: .utf8), !domLayerJS.isEmpty {
            let domScript = WKUserScript(source: domLayerJS, injectionTime: .atDocumentEnd, forMainFrameOnly: false)
            config.userContentController.addUserScript(domScript)
        }

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        view.addSubview(webView)

        setupToolbar()

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        if let url = URL(string: "https://m.youtube.com") {
            webView.load(URLRequest(url: url))
        }
    }

    private func setupToolbar() {
        let bar = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
        bar.translatesAutoresizingMaskIntoConstraints = false

        let contentView = bar.contentView

        let shield = makeButton(systemName: "shield.fill", action: #selector(toggleShield))
        shieldBtn = shield
        let reload = makeButton(systemName: "arrow.clockwise", action: #selector(reloadPage))

        contentView.addSubview(shield)
        contentView.addSubview(reload)
        view.addSubview(bar)

        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.heightAnchor.constraint(equalToConstant: 44),

            shield.trailingAnchor.constraint(equalTo: reload.leadingAnchor, constant: -2),
            shield.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            shield.widthAnchor.constraint(equalToConstant: 44),
            shield.heightAnchor.constraint(equalToConstant: 44),

            reload.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -6),
            reload.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            reload.widthAnchor.constraint(equalToConstant: 44),
            reload.heightAnchor.constraint(equalToConstant: 44),
        ])

        updateShieldIcon()
        toolbar = bar
    }

    private func makeButton(systemName: String, action: Selector) -> UIButton {
        let btn = UIButton(type: .system)
        btn.translatesAutoresizingMaskIntoConstraints = false
        let config = UIImage.SymbolConfiguration(pointSize: 20, weight: .medium)
        btn.setImage(UIImage(systemName: systemName, withConfiguration: config), for: .normal)
        btn.addTarget(self, action: action, for: .touchUpInside)
        return btn
    }

    private func updateShieldIcon() {
        let name = adBlocker.enabled ? "shield.fill" : "shield.slash"
        let config = UIImage.SymbolConfiguration(pointSize: 20, weight: .medium)
        shieldBtn.setImage(UIImage(systemName: name, withConfiguration: config), for: .normal)
        shieldBtn.tintColor = adBlocker.enabled ? .systemGreen : .gray
    }

    @objc private func reloadPage() { webView.reload() }

    @objc private func toggleShield() {
        adBlocker.toggle()
        updateShieldIcon()
    }
}
