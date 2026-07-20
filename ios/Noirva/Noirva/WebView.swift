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

class WebViewController: UIViewController, UITextFieldDelegate {
    private let coordinator: WebView.Coordinator
    private let adBlocker: AdBlocker
    private var webView: WKWebView!
    private var searchField: UITextField!
    private var shieldBadge: UIView!
    private var shieldDot: UIView!
    private var shieldLabel: UILabel!
    private var blockedCount = 0

    private let green = UIColor(red: 0.38, green: 0.82, blue: 0.42, alpha: 1.0)
    private let darkBg = UIColor(red: 0.06, green: 0.06, blue: 0.06, alpha: 1.0)
    private let pillBg = UIColor(red: 0.14, green: 0.14, blue: 0.14, alpha: 1.0)

    init(coordinator: WebView.Coordinator, adBlocker: AdBlocker) {
        self.coordinator = coordinator
        self.adBlocker = adBlocker
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = darkBg
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

        setupHeader()

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 62),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        if let url = URL(string: "https://m.youtube.com") {
            webView.load(URLRequest(url: url))
        }
    }

    private func setupHeader() {
        let header = UIView()
        header.translatesAutoresizingMaskIntoConstraints = false
        header.backgroundColor = darkBg
        view.addSubview(header)

        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 56),
        ])

        // Shield icon (green circle with shield SVG)
        let shieldIcon = UIView()
        shieldIcon.translatesAutoresizingMaskIntoConstraints = false
        shieldIcon.backgroundColor = green
        shieldIcon.layer.cornerRadius = 15
        header.addSubview(shieldIcon)

        let shieldPath = UIImageView(image: UIImage(systemName: "shield.fill"))
        shieldPath.translatesAutoresizingMaskIntoConstraints = false
        shieldPath.tintColor = darkBg
        shieldIcon.addSubview(shieldPath)

        // App name
        let appName = UILabel()
        appName.translatesAutoresizingMaskIntoConstraints = false
        appName.text = "Noirva"
        appName.textColor = .white
        appName.font = .systemFont(ofSize: 17, weight: .heavy)
        appName.setContentHuggingPriority(.defaultLow, for: .horizontal)
        header.addSubview(appName)

        // Search pill
        let searchPill = UIView()
        searchPill.translatesAutoresizingMaskIntoConstraints = false
        searchPill.backgroundColor = pillBg
        searchPill.layer.cornerRadius = 20
        header.addSubview(searchPill)

        let searchIcon = UIImageView(image: UIImage(systemName: "magnifyingglass"))
        searchIcon.translatesAutoresizingMaskIntoConstraints = false
        searchIcon.tintColor = .gray
        searchPill.addSubview(searchIcon)

        searchField = UITextField()
        searchField.translatesAutoresizingMaskIntoConstraints = false
        searchField.attributedPlaceholder = NSAttributedString(
            string: "Search or paste a link",
            attributes: [.foregroundColor: UIColor.gray]
        )
        searchField.textColor = .white
        searchField.font = .systemFont(ofSize: 14)
        searchField.borderStyle = .none
        searchField.autocorrectionType = .no
        searchField.autocapitalizationType = .none
        searchField.keyboardType = .webSearch
        searchField.returnKeyType = .go
        searchField.delegate = self
        searchPill.addSubview(searchField)

        let tapPill = UITapGestureRecognizer(target: self, action: #selector(searchPillTapped))
        searchPill.addGestureRecognizer(tapPill)

        // Shield badge (green dot + ON)
        shieldBadge = UIView()
        shieldBadge.translatesAutoresizingMaskIntoConstraints = false
        shieldBadge.backgroundColor = UIColor(red: 0.16, green: 0.22, blue: 0.16, alpha: 1.0)
        shieldBadge.layer.cornerRadius = 16
        header.addSubview(shieldBadge)

        shieldDot = UIView()
        shieldDot.translatesAutoresizingMaskIntoConstraints = false
        shieldDot.backgroundColor = green
        shieldDot.layer.cornerRadius = 3.5
        shieldBadge.addSubview(shieldDot)

        shieldLabel = UILabel()
        shieldLabel.translatesAutoresizingMaskIntoConstraints = false
        shieldLabel.text = "ON"
        shieldLabel.textColor = green
        shieldLabel.font = .systemFont(ofSize: 12, weight: .heavy)
        shieldBadge.addSubview(shieldLabel)

        let tapBadge = UITapGestureRecognizer(target: self, action: #selector(toggleShield))
        shieldBadge.addGestureRecognizer(tapBadge)

        NSLayoutConstraint.activate([
            shieldIcon.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 16),
            shieldIcon.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            shieldIcon.widthAnchor.constraint(equalToConstant: 30),
            shieldIcon.heightAnchor.constraint(equalToConstant: 30),

            shieldPath.centerXAnchor.constraint(equalTo: shieldIcon.centerXAnchor),
            shieldPath.centerYAnchor.constraint(equalTo: shieldIcon.centerYAnchor),
            shieldPath.widthAnchor.constraint(equalToConstant: 16),
            shieldPath.heightAnchor.constraint(equalToConstant: 16),

            appName.leadingAnchor.constraint(equalTo: shieldIcon.trailingAnchor, constant: 8),
            appName.centerYAnchor.constraint(equalTo: header.centerYAnchor),

            searchPill.leadingAnchor.constraint(equalTo: header.trailingAnchor, constant: -120),
            searchPill.trailingAnchor.constraint(equalTo: shieldBadge.leadingAnchor, constant: -8),
            searchPill.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            searchPill.heightAnchor.constraint(equalToConstant: 38),

            searchIcon.leadingAnchor.constraint(equalTo: searchPill.leadingAnchor, constant: 12),
            searchIcon.centerYAnchor.constraint(equalTo: searchPill.centerYAnchor),
            searchIcon.widthAnchor.constraint(equalToConstant: 16),
            searchIcon.heightAnchor.constraint(equalToConstant: 16),

            searchField.leadingAnchor.constraint(equalTo: searchIcon.trailingAnchor, constant: 8),
            searchField.trailingAnchor.constraint(equalTo: searchPill.trailingAnchor, constant: -12),
            searchField.centerYAnchor.constraint(equalTo: searchPill.centerYAnchor),

            shieldBadge.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -16),
            shieldBadge.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            shieldBadge.heightAnchor.constraint(equalToConstant: 32),

            shieldDot.leadingAnchor.constraint(equalTo: shieldBadge.leadingAnchor, constant: 10),
            shieldDot.centerYAnchor.constraint(equalTo: shieldBadge.centerYAnchor),
            shieldDot.widthAnchor.constraint(equalToConstant: 7),
            shieldDot.heightAnchor.constraint(equalToConstant: 7),

            shieldLabel.leadingAnchor.constraint(equalTo: shieldDot.trailingAnchor, constant: 5),
            shieldLabel.trailingAnchor.constraint(equalTo: shieldBadge.trailingAnchor, constant: -10),
            shieldLabel.centerYAnchor.constraint(equalTo: shieldBadge.centerYAnchor),
        ])
    }

    @objc private func searchPillTapped() {
        searchField.becomeFirstResponder()
    }

    @objc private func toggleShield() {
        adBlocker.toggle()
        let on = adBlocker.enabled
        shieldDot.backgroundColor = on ? green : .gray
        shieldLabel.text = on ? "ON" : "OFF"
        shieldLabel.textColor = on ? green : .gray
        shieldBadge.backgroundColor = on
            ? UIColor(red: 0.16, green: 0.22, blue: 0.16, alpha: 1.0)
            : UIColor(red: 0.22, green: 0.16, blue: 0.16, alpha: 1.0)
        webView.reload()
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        guard let text = textField.text, !text.isEmpty else { return true }

        let query = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? text
        let url: URL
        if text.contains(".") && !text.contains(" ") {
            if text.hasPrefix("http") {
                url = URL(string: text)!
            } else {
                url = URL(string: "https://\(text)")!
            }
        } else {
            url = URL(string: "https://m.youtube.com/results?search_query=\(query)")!
        }
        webView.load(URLRequest(url: url))
        textField.text = ""
        return true
    }
}
