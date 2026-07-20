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
    private var shieldEnabled = true

    private let green = UIColor(red: 0.37, green: 0.79, blue: 0.42, alpha: 1.0) // oklch(0.62 0.17 155)
    private let darkBg = UIColor(red: 0.06, green: 0.06, blue: 0.06, alpha: 1.0)
    private let pillBg = UIColor(red: 0.14, green: 0.14, blue: 0.14, alpha: 1.0)
    private let badgeBg = UIColor(red: 0.18, green: 0.22, blue: 0.18, alpha: 1.0) // oklch(0.28 0.05 155)
    private let badgeOnText = UIColor(red: 0.52, green: 0.80, blue: 0.52, alpha: 1.0) // oklch(0.85 0.1 155)
    private let dotGreen = UIColor(red: 0.45, green: 0.80, blue: 0.45, alpha: 1.0) // oklch(0.72 0.2 155)

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
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 56),
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

        // Shield icon — standalone green shield SVG, no background
        let shieldIcon = UIImageView()
        shieldIcon.translatesAutoresizingMaskIntoConstraints = false
        shieldIcon.image = makeShieldImage()
        shieldIcon.tintColor = green
        header.addSubview(shieldIcon)

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
        shieldBadge.backgroundColor = badgeBg
        shieldBadge.layer.cornerRadius = 16
        header.addSubview(shieldBadge)

        shieldDot = UIView()
        shieldDot.translatesAutoresizingMaskIntoConstraints = false
        shieldDot.backgroundColor = dotGreen
        shieldDot.layer.cornerRadius = 3.5
        shieldBadge.addSubview(shieldDot)

        shieldLabel = UILabel()
        shieldLabel.translatesAutoresizingMaskIntoConstraints = false
        shieldLabel.text = "ON"
        shieldLabel.textColor = badgeOnText
        shieldLabel.font = .systemFont(ofSize: 12, weight: .bold)
        shieldBadge.addSubview(shieldLabel)

        let tapBadge = UITapGestureRecognizer(target: self, action: #selector(toggleShield))
        shieldBadge.addGestureRecognizer(tapBadge)

        NSLayoutConstraint.activate([
            // Shield icon: 26x26, leading 14
            shieldIcon.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 14),
            shieldIcon.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            shieldIcon.widthAnchor.constraint(equalToConstant: 26),
            shieldIcon.heightAnchor.constraint(equalToConstant: 26),

            // Search pill: flex 1, leading 10 from shield
            searchPill.leadingAnchor.constraint(equalTo: shieldIcon.trailingAnchor, constant: 10),
            searchPill.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            searchPill.heightAnchor.constraint(equalToConstant: 38),

            // Search icon inside pill
            searchIcon.leadingAnchor.constraint(equalTo: searchPill.leadingAnchor, constant: 14),
            searchIcon.centerYAnchor.constraint(equalTo: searchPill.centerYAnchor),
            searchIcon.widthAnchor.constraint(equalToConstant: 16),
            searchIcon.heightAnchor.constraint(equalToConstant: 16),

            // Search field fills pill
            searchField.leadingAnchor.constraint(equalTo: searchIcon.trailingAnchor, constant: 8),
            searchField.trailingAnchor.constraint(equalTo: searchPill.trailingAnchor, constant: -14),
            searchField.centerYAnchor.constraint(equalTo: searchPill.centerYAnchor),

            // Shield badge: trailing, centered
            shieldBadge.leadingAnchor.constraint(equalTo: searchPill.trailingAnchor, constant: 10),
            shieldBadge.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -14),
            shieldBadge.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            shieldBadge.heightAnchor.constraint(equalToConstant: 32),

            // Dot inside badge
            shieldDot.leadingAnchor.constraint(equalTo: shieldBadge.leadingAnchor, constant: 11),
            shieldDot.centerYAnchor.constraint(equalTo: shieldBadge.centerYAnchor),
            shieldDot.widthAnchor.constraint(equalToConstant: 7),
            shieldDot.heightAnchor.constraint(equalToConstant: 7),

            // Label inside badge
            shieldLabel.leadingAnchor.constraint(equalTo: shieldDot.trailingAnchor, constant: 5),
            shieldLabel.trailingAnchor.constraint(equalTo: shieldBadge.trailingAnchor, constant: -11),
            shieldLabel.centerYAnchor.constraint(equalTo: shieldBadge.centerYAnchor),
        ])
    }

    private func makeShieldImage() -> UIImage? {
        let size = CGSize(width: 26, height: 26)
        UIGraphicsBeginImageContextWithOptions(size, false, 0)
        guard let ctx = UIGraphicsGetCurrentContext() else { return nil }

        // Shield path
        let shield = UIBezierPath()
        shield.move(to: CGPoint(x: 13, y: 3))
        shield.addLine(to: CGPoint(x: 21, y: 6.5))
        shield.addLine(to: CGPoint(x: 21, y: 11.5))
        shield.addCurve(to: CGPoint(x: 13, y: 22.5),
                        controlPoint1: CGPoint(x: 21, y: 15.5),
                        controlPoint2: CGPoint(x: 16, y: 19.7))
        shield.addCurve(to: CGPoint(x: 5, y: 11.5),
                        controlPoint1: CGPoint(x: 10, y: 19.7),
                        controlPoint2: CGPoint(x: 5, y: 15.5))
        shield.close()

        green.setFill()
        shield.fill()

        // Checkmark
        let check = UIBezierPath()
        check.lineWidth = 1.8
        check.move(to: CGPoint(x: 9.5, y: 12))
        check.addLine(to: CGPoint(x: 11.3, y: 13.8))
        check.addLine(to: CGPoint(x: 14.7, y: 10.2))

        darkBg.setStroke()
        check.stroke()

        let image = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        return image
    }

    @objc private func searchPillTapped() {
        searchField.becomeFirstResponder()
    }

    @objc private func toggleShield() {
        shieldEnabled.toggle()
        adBlocker.toggle()
        let on = shieldEnabled
        shieldDot.backgroundColor = on ? dotGreen : .gray
        shieldLabel.text = on ? "ON" : "OFF"
        shieldLabel.textColor = on ? badgeOnText : .gray
        shieldBadge.backgroundColor = on ? badgeBg : UIColor(red: 0.22, green: 0.16, blue: 0.16, alpha: 1.0)
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
