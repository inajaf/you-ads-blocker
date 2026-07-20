import Foundation

/// Loads and holds the shared ad-block assets from the /adblock core.
/// Network layer: blocklist substrings for URL interception.
/// Page layer: inject.js for document-start JavaScript injection.
class AdBlocker: ObservableObject {
    @Published var blockList: [String] = []
    @Published var injectScript: String = ""

    func loadAssets() {
        blockList = loadBlockList()
        injectScript = loadInjectScript()
    }

    private func loadBlockList() -> [String] {
        guard let url = Bundle.main.url(forResource: "hosts", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let block = json["block"] as? [String] else {
            return []
        }
        return block.filter { !$0.isEmpty }
    }

    private func loadInjectScript() -> String {
        guard let url = Bundle.main.url(forResource: "inject", withExtension: "js"),
              let script = try? String(contentsOf: url, encoding: .utf8) else {
            return ""
        }
        return script
    }

    /// Returns true if the given URL should be blocked (contains a blocklist substring).
    func shouldBlock(_ url: URL) -> Bool {
        let urlString = url.absoluteString
        return blockList.contains { urlString.contains($0) }
    }
}
