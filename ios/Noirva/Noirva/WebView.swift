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
    private var shieldToggle: UIView!
    private var shieldKnob: UIView!
    private var shieldEnabled = true

    private let green = UIColor(red: 0.37, green: 0.79, blue: 0.42, alpha: 1.0)
    private let darkBg = UIColor(red: 0.06, green: 0.06, blue: 0.06, alpha: 1.0)
    private let gradientTop = UIColor(red: 0.11, green: 0.13, blue: 0.11, alpha: 1.0)

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
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 110),
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
        view.addSubview(header)

        let gradient = CAGradientLayer()
        gradient.colors = [gradientTop.cgColor, darkBg.cgColor]
        gradient.startPoint = CGPoint(x: 0.5, y: 0)
        gradient.endPoint = CGPoint(x: 0.5, y: 1)
        header.layer.insertSublayer(gradient, at: 0)
        header.tag = 100

        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 110),
        ])

        // Row 1: App name + search button
        let row1 = UIView()
        row1.translatesAutoresizingMaskIntoConstraints = false
        header.addSubview(row1)

        NSLayoutConstraint.activate([
            row1.topAnchor.constraint(equalTo: header.topAnchor, constant: 10),
            row1.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 16),
            row1.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -16),
            row1.heightAnchor.constraint(equalToConstant: 24),
        ])

        let appName = UILabel()
        appName.translatesAutoresizingMaskIntoConstraints = false
        appName.text = "Noirva"
        appName.textColor = .white
        appName.font = .systemFont(ofSize: 17, weight: .heavy)
        appName.setContentCompressionResistancePriority(.required, for: .horizontal)
        row1.addSubview(appName)

        let searchBtn = UIButton(type: .system)
        searchBtn.translatesAutoresizingMaskIntoConstraints = false
        searchBtn.backgroundColor = UIColor(white: 1.0, alpha: 0.06)
        searchBtn.layer.cornerRadius = 18
        searchBtn.tintColor = .white
        let searchConfig = UIImage.SymbolConfiguration(pointSize: 19, weight: .regular)
        searchBtn.setImage(UIImage(systemName: "magnifyingglass", withConfiguration: searchConfig), for: .normal)
        searchBtn.addTarget(self, action: #selector(searchTapped), for: .touchUpInside)
        row1.addSubview(searchBtn)

        NSLayoutConstraint.activate([
            appName.leadingAnchor.constraint(equalTo: row1.leadingAnchor),
            appName.centerYAnchor.constraint(equalTo: row1.centerYAnchor),
            searchBtn.trailingAnchor.constraint(equalTo: row1.trailingAnchor),
            searchBtn.centerYAnchor.constraint(equalTo: row1.centerYAnchor),
            searchBtn.widthAnchor.constraint(equalToConstant: 36),
            searchBtn.heightAnchor.constraint(equalToConstant: 36),
        ])

        // Row 2: Status card
        let card = UIView()
        card.translatesAutoresizingMaskIntoConstraints = false
        card.backgroundColor = UIColor(white: 1.0, alpha: 0.05)
        card.layer.cornerRadius = 12
        card.layer.borderWidth = 1
        card.layer.borderColor = UIColor(white: 1.0, alpha: 0.07).cgColor
        header.addSubview(card)

        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: row1.bottomAnchor, constant: 10),
            card.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 16),
            card.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -16),
            card.heightAnchor.constraint(equalToConstant: 48),
        ])

        // Shield icon — draw colored image, no tint override
        let shieldIcon = UIImageView()
        shieldIcon.translatesAutoresizingMaskIntoConstraints = false
        if let img = makeShieldImage(size: 28) {
            shieldIcon.image = img.withRenderingMode(.alwaysOriginal)
        }
        shieldIcon.contentMode = .scaleAspectFit
        shieldIcon.clipsToBounds = true
        card.addSubview(shieldIcon)

        let shieldTap = UITapGestureRecognizer(target: self, action: #selector(toggleShield))
        shieldIcon.isUserInteractionEnabled = true
        shieldIcon.addGestureRecognizer(shieldTap)

        let protectionLabel = UILabel()
        protectionLabel.translatesAutoresizingMaskIntoConstraints = false
        protectionLabel.text = "Protection active"
        protectionLabel.textColor = .white
        protectionLabel.font = .systemFont(ofSize: 13, weight: .bold)
        card.addSubview(protectionLabel)

        // Toggle switch
        shieldToggle = UIView()
        shieldToggle.translatesAutoresizingMaskIntoConstraints = false
        shieldToggle.backgroundColor = green
        shieldToggle.layer.cornerRadius = 12
        shieldToggle.isUserInteractionEnabled = true
        card.addSubview(shieldToggle)

        shieldKnob = UIView()
        shieldKnob.translatesAutoresizingMaskIntoConstraints = false
        shieldKnob.backgroundColor = darkBg
        shieldKnob.layer.cornerRadius = 9
        shieldToggle.addSubview(shieldKnob)

        let tapToggle = UITapGestureRecognizer(target: self, action: #selector(toggleShield))
        shieldToggle.addGestureRecognizer(tapToggle)

        NSLayoutConstraint.activate([
            shieldIcon.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            shieldIcon.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            shieldIcon.widthAnchor.constraint(equalToConstant: 28),
            shieldIcon.heightAnchor.constraint(equalToConstant: 28),

            protectionLabel.leadingAnchor.constraint(equalTo: shieldIcon.trailingAnchor, constant: 12),
            protectionLabel.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            protectionLabel.trailingAnchor.constraint(lessThanOrEqualTo: shieldToggle.leadingAnchor, constant: -12),

            shieldToggle.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            shieldToggle.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            shieldToggle.widthAnchor.constraint(equalToConstant: 40),
            shieldToggle.heightAnchor.constraint(equalToConstant: 24),

            shieldKnob.trailingAnchor.constraint(equalTo: shieldToggle.trailingAnchor, constant: -3),
            shieldKnob.centerYAnchor.constraint(equalTo: shieldToggle.centerYAnchor),
            shieldKnob.widthAnchor.constraint(equalToConstant: 18),
            shieldKnob.heightAnchor.constraint(equalToConstant: 18),
        ])
    }

    private func makeShieldImage(size: CGFloat) -> UIImage? {
        let sz = CGSize(width: size, height: size)
        UIGraphicsBeginImageContextWithOptions(sz, false, 0)
        guard let _ = UIGraphicsGetCurrentContext() else { return nil }

        let s = size / 26.0
        let shield = UIBezierPath()
        shield.move(to: CGPoint(x: 13*s, y: 3*s))
        shield.addLine(to: CGPoint(x: 21*s, y: 6.5*s))
        shield.addLine(to: CGPoint(x: 21*s, y: 11.5*s))
        shield.addCurve(to: CGPoint(x: 13*s, y: 22.5*s),
                        controlPoint1: CGPoint(x: 21*s, y: 15.5*s),
                        controlPoint2: CGPoint(x: 16*s, y: 19.7*s))
        shield.addCurve(to: CGPoint(x: 5*s, y: 11.5*s),
                        controlPoint1: CGPoint(x: 10*s, y: 19.7*s),
                        controlPoint2: CGPoint(x: 5*s, y: 15.5*s))
        shield.close()

        green.setFill()
        shield.fill()

        let check = UIBezierPath()
        check.lineWidth = 1.8 * s
        check.move(to: CGPoint(x: 9.5*s, y: 12*s))
        check.addLine(to: CGPoint(x: 11.3*s, y: 13.8*s))
        check.addLine(to: CGPoint(x: 14.7*s, y: 10.2*s))
        darkBg.setStroke()
        check.stroke()

        let image = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        return image
    }

    @objc private func searchTapped() {}

    @objc private func toggleShield() {
        shieldEnabled.toggle()
        adBlocker.toggle()

        UIView.animate(withDuration: 0.25, delay: 0, usingSpringWithDamping: 0.6, initialSpringVelocity: 3, options: [], animations: {
            self.shieldToggle.backgroundColor = self.shieldEnabled ? self.green : .gray
            if self.shieldEnabled {
                self.shieldKnob.center.x = self.shieldToggle.bounds.maxX - 12
            } else {
                self.shieldKnob.center.x = self.shieldToggle.bounds.minX + 12
            }
        })

        webView.reload()
    }
}
