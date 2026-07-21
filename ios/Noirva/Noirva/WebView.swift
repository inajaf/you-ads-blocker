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
    private var protectionLabel: UILabel!
    private var shieldIcon: UIImageView!

    private let green = UIColor(red: 0.373, green: 0.788, blue: 0.420, alpha: 1.0) // #5FCA6B
    private let darkBg = UIColor(red: 0.059, green: 0.059, blue: 0.059, alpha: 1.0) // #0F0F0F
    private let greenTop = UIColor(red: 0.110, green: 0.129, blue: 0.110, alpha: 1.0) // #1C211C

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
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 72),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        if let url = URL(string: "https://m.youtube.com") {
            webView.load(URLRequest(url: url))
        }
    }

    private func setupHeader() {
        // Header container
        let header = UIView()
        header.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(header)

        // Gradient background: #1C211C → #0F0F0F
        let gradient = CAGradientLayer()
        gradient.colors = [greenTop.cgColor, darkBg.cgColor]
        gradient.startPoint = CGPoint(x: 0.5, y: 0)
        gradient.endPoint = CGPoint(x: 0.5, y: 1)
        header.layer.insertSublayer(gradient, at: 0)
        header.tag = 100

        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 72),
        ])

        // Status card
        let card = UIView()
        card.translatesAutoresizingMaskIntoConstraints = false
        card.backgroundColor = UIColor(white: 1.0, alpha: 0.05) // #0DFFFFFF
        card.layer.cornerRadius = 12
        card.layer.borderWidth = 1
        card.layer.borderColor = UIColor(white: 1.0, alpha: 0.07).cgColor // #12FFFFFF
        header.addSubview(card)

        NSLayoutConstraint.activate([
            card.topAnchor.constraint(equalTo: header.topAnchor, constant: 10),
            card.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 16),
            card.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -16),
            card.heightAnchor.constraint(equalToConstant: 48),
        ])

        // Shield icon 28x28
        shieldIcon = UIImageView()
        shieldIcon.translatesAutoresizingMaskIntoConstraints = false
        if let img = makeShieldImage(size: 28) {
            shieldIcon.image = img.withRenderingMode(.alwaysOriginal)
        }
        shieldIcon.tag = 200
        shieldIcon.contentMode = .scaleAspectFit
        shieldIcon.clipsToBounds = true
        shieldIcon.isUserInteractionEnabled = true
        let shieldTap = UITapGestureRecognizer(target: self, action: #selector(toggleShield))
        shieldIcon.addGestureRecognizer(shieldTap)
        card.addSubview(shieldIcon)

        // "Protection active" label
        protectionLabel = UILabel()
        protectionLabel.translatesAutoresizingMaskIntoConstraints = false
        protectionLabel.text = "Protection active"
        protectionLabel.textColor = .white
        protectionLabel.font = .systemFont(ofSize: 13, weight: .bold)
        card.addSubview(protectionLabel)

        // Toggle switch 40x24
        shieldToggle = UIView()
        shieldToggle.translatesAutoresizingMaskIntoConstraints = false
        shieldToggle.backgroundColor = green
        shieldToggle.layer.cornerRadius = 12
        shieldToggle.isUserInteractionEnabled = true
        let tapToggle = UITapGestureRecognizer(target: self, action: #selector(toggleShield))
        shieldToggle.addGestureRecognizer(tapToggle)
        card.addSubview(shieldToggle)

        // Toggle knob 18x18
        shieldKnob = UIView()
        shieldKnob.translatesAutoresizingMaskIntoConstraints = false
        shieldKnob.backgroundColor = darkBg
        shieldKnob.layer.cornerRadius = 9
        shieldToggle.addSubview(shieldKnob)

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

        // Bottom spacer 14dp
        let spacer = UIView()
        spacer.translatesAutoresizingMaskIntoConstraints = false
        header.addSubview(spacer)
        NSLayoutConstraint.activate([
            spacer.topAnchor.constraint(equalTo: card.bottomAnchor),
            spacer.leadingAnchor.constraint(equalTo: header.leadingAnchor),
            spacer.trailingAnchor.constraint(equalTo: header.trailingAnchor),
            spacer.heightAnchor.constraint(equalToConstant: 14),
            spacer.bottomAnchor.constraint(equalTo: header.bottomAnchor),
        ])
    }

    private func makeShieldImage(size: CGFloat, fillColor: UIColor? = nil) -> UIImage? {
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

        (fillColor ?? green).setFill()
        shield.fill()

        let check = UIBezierPath()
        check.lineWidth = 1.8 * s
        check.lineCapStyle = .round
        check.lineJoinStyle = .round
        check.move(to: CGPoint(x: 9.5*s, y: 12*s))
        check.addLine(to: CGPoint(x: 11.3*s, y: 13.8*s))
        check.addLine(to: CGPoint(x: 14.7*s, y: 10.2*s))
        darkBg.setStroke()
        check.stroke()

        let image = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        return image
    }

    @objc private func toggleShield() {
        shieldEnabled.toggle()
        adBlocker.toggle()

        // Update label text and color
        protectionLabel.text = shieldEnabled ? "Protection active" : "Protection paused"
        protectionLabel.textColor = shieldEnabled ? .white : UIColor(red: 0.533, green: 0.533, blue: 0.533, alpha: 1.0) // #888888

        // Update shield icon color
        if let img = makeShieldImage(size: 28, fillColor: shieldEnabled ? green : UIColor(red: 0.533, green: 0.533, blue: 0.533, alpha: 1.0)) {
            shieldIcon.image = img.withRenderingMode(.alwaysOriginal)
        }

        // Shield pulse animation (matches Android)
        UIView.animate(withDuration: 0.15, delay: 0, options: .curveEaseOut, animations: {
            self.view.viewWithTag(200)?.transform = self.shieldEnabled
                ? CGAffineTransform(scaleX: 1.3, y: 1.3)
                : CGAffineTransform(scaleX: 0.8, y: 0.8)
        }) { _ in
            UIView.animate(withDuration: 0.2, delay: 0, usingSpringWithDamping: 0.6, initialSpringVelocity: 0, options: [], animations: {
                self.view.viewWithTag(200)?.transform = .identity
            })
        }

        // Toggle knob + color (250ms spring, matches Android)
        UIView.animate(withDuration: 0.25, delay: 0, usingSpringWithDamping: 0.6, initialSpringVelocity: 3, options: [], animations: {
            self.shieldToggle.backgroundColor = self.shieldEnabled ? self.green : UIColor(red: 0.533, green: 0.533, blue: 0.533, alpha: 1.0) // #888888
            if self.shieldEnabled {
                self.shieldKnob.center.x = self.shieldToggle.bounds.maxX - 12
            } else {
                self.shieldKnob.center.x = self.shieldToggle.bounds.minX + 12
            }
        })

        webView.reload()
    }
}
