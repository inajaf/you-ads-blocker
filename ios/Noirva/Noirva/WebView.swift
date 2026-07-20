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
    private var toolbar: UIView!
    private var toolbarBottom: NSLayoutConstraint!
    private var toolbarHideWork: DispatchWorkItem?

    init(coordinator: WebView.Coordinator, adBlocker: AdBlocker) {
        self.coordinator = coordinator
        self.adBlocker = adBlocker
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
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

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        setupToolbar()

        if let url = URL(string: "https://m.youtube.com") {
            webView.load(URLRequest(url: url))
        }
    }

    private func setupToolbar() {
        let bar = UIView()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.85)

        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.distribution = .equalCentering
        stack.alignment = .center

        let shieldBtn = toolbarButton(systemName: "shield.fill", action: #selector(toggleShield))
        let reloadBtn = toolbarButton(systemName: "arrow.clockwise", action: #selector(reloadPage))

        let spacerL = UIView()
        spacerL.translatesAutoresizingMaskIntoConstraints = false
        let spacerR = UIView()
        spacerR.translatesAutoresizingMaskIntoConstraints = false

        stack.addArrangedSubview(spacerL)
        stack.addArrangedSubview(shieldBtn)
        stack.addArrangedSubview(reloadBtn)
        stack.addArrangedSubview(spacerR)

        spacerL.widthAnchor.constraint(equalTo: spacerR.widthAnchor).isActive = true

        bar.addSubview(stack)
        view.addSubview(bar)

        toolbarBottom = bar.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: 100)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbarBottom,
            bar.heightAnchor.constraint(equalToConstant: 56),

            stack.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: bar.topAnchor),
            stack.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
        ])

        let tap = UITapGestureRecognizer(target: self, action: #selector(didTapWebView))
        tap.cancelsTouchesInView = false
        webView.addGestureRecognizer(tap)

        toolbar = bar
        updateShieldIcon(shieldBtn)
        showToolbar()
    }

    private func toolbarButton(systemName: String, action: Selector) -> UIButton {
        let btn = UIButton(type: .system)
        btn.translatesAutoresizingMaskIntoConstraints = false
        let config = UIImage.SymbolConfiguration(pointSize: 22, weight: .medium)
        btn.setImage(UIImage(systemName: systemName, withConfiguration: config), for: .normal)
        btn.tintColor = .white
        btn.addTarget(self, action: action, for: .touchUpInside)
        btn.widthAnchor.constraint(equalToConstant: 52).isActive = true
        btn.heightAnchor.constraint(equalToConstant: 48).isActive = true
        return btn
    }

    private func updateShieldIcon(_ button: UIButton? = nil) {
        guard let btn = button ?? toolbar?.subviews.first?.subviews.compactMap({ $0 as? UIButton }).first else { return }
        let name = adBlocker.enabled ? "shield.fill" : "shield.slash"
        let config = UIImage.SymbolConfiguration(pointSize: 22, weight: .medium)
        btn.setImage(UIImage(systemName: name, withConfiguration: config), for: .normal)
        btn.tintColor = adBlocker.enabled ? .systemGreen : .gray
    }

    @objc private func didTapWebView() {
        showToolbar()
    }

    @objc private func reloadPage() { webView.reload() }

    @objc private func toggleShield() {
        adBlocker.toggle()
        updateShieldIcon()
        showToolbar()
    }

    private func showToolbar() {
        toolbarHideWork?.cancel()
        toolbarBottom.constant = 0
        UIView.animate(withDuration: 0.25) { self.view.layoutIfNeeded() }
        scheduleHide()
    }

    private func scheduleHide() {
        let work = DispatchWorkItem { [weak self] in
            UIView.animate(withDuration: 0.25) {
                self?.toolbarBottom.constant = 100
                self?.view.layoutIfNeeded()
            }
        }
        toolbarHideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: work)
    }
}
