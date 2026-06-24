import Foundation
import WebKit
import Combine
import AppKit

struct UsageBar {
    var label: String
    var percent: Double
    var resetAt: String
}

struct ServiceUsage {
    var bars: [UsageBar] = []
    var daily: Int = 0
    var dailyLimit: Int = 0
    var weekly: Int = 0
    var weeklyLimit: Int = 0
    var isLoggedIn: Bool = false
    var isLoading: Bool = false
    var error: String? = nil
    var debugRaw: String = ""
    // ChatGPT exposes plan info but no usage counters.
    var planName: String = ""
    var planStatus: String = ""
}

/// Holds ONE persistent WKWebView per service for the whole app lifetime.
/// Both login and data-fetching happen in the same web view, so cookies/session
/// are guaranteed to be shared.
class UsageStore: NSObject, ObservableObject, WKNavigationDelegate {
    @Published var claude = ServiceUsage()
    @Published var chatgpt = ServiceUsage()

    // Persistent web views (created once, reused). Default data store persists cookies to disk.
    lazy var claudeWebView: WKWebView = makeWebView(url: "https://claude.ai")
    lazy var chatgptWebView: WKWebView = makeWebView(url: "https://chatgpt.com")

    /// Hosts that have finished at least one successful navigation.
    private var loadedHosts = Set<String>()
    /// Actions waiting for a navigation to finish, keyed by web view identity.
    private var pendingLoad: [ObjectIdentifier: [() -> Void]] = [:]

    private func makeWebView(url: String) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()   // persistent, shared
        let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 900, height: 700), configuration: cfg)
        wv.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        wv.navigationDelegate = self
        wv.load(URLRequest(url: URL(string: url)!))
        return wv
    }

    func refresh() {
        fetchClaude()
        fetchChatGPT()
    }

    // MARK: - Claude

    func fetchClaude() {
        DispatchQueue.main.async { self.claude.isLoading = true }
        ensureLoaded(claudeWebView, host: "claude.ai", url: "https://claude.ai") { [weak self] in
            self?.runClaudeUsageJS()
        }
    }

    private func runClaudeUsageJS() {
        // NOTE: this is a callAsyncJavaScript *function body* (use `return`, not an IIFE).
        let js = """
        let log = [];
        try {
            const orgsResp = await fetch('/api/organizations', { credentials: 'include' });
            log.push('orgs:' + orgsResp.status);
            if (orgsResp.status === 401 || orgsResp.status === 403) {
                return { loggedIn: false, log: log.join(' ') };
            }
            if (!orgsResp.ok) {
                return { loggedIn: false, error: 'orgs HTTP ' + orgsResp.status, log: log.join(' ') };
            }
            const orgs = await orgsResp.json();
            if (!orgs || orgs.length === 0) {
                return { loggedIn: true, error: 'no orgs', log: log.join(' ') };
            }
            const orgId = orgs[0].uuid;
            log.push('org:' + orgId);

            const usageResp = await fetch('/api/organizations/' + orgId + '/usage', { credentials: 'include' });
            log.push('usage:' + usageResp.status);
            if (!usageResp.ok) {
                return { loggedIn: true, error: 'usage HTTP ' + usageResp.status, log: log.join(' ') };
            }
            const usage = await usageResp.json();
            return { loggedIn: true, usage: usage, log: log.join(' '), raw: JSON.stringify(usage).substring(0, 1800) };
        } catch (e) {
            return { loggedIn: false, error: e.toString(), log: log.join(' ') };
        }
        """

        claudeWebView.callAsyncJavaScript(js, in: nil, in: .page) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                self.claude.isLoading = false

                let json: [String: Any]
                switch result {
                case .success(let value):
                    json = (value as? [String: Any]) ?? [:]
                case .failure(let err):
                    self.claude.debugRaw = "JS error: \(err.localizedDescription)"
                    NSLog("[AIUsageBar] Claude JS error: \(err)")
                    return
                }

                self.claude.isLoggedIn = json["loggedIn"] as? Bool ?? false
                let log = json["log"] as? String ?? ""
                let raw = json["raw"] as? String ?? ""
                let err = json["error"] as? String
                self.claude.error = err
                self.claude.debugRaw = [log, err.map { "error: \($0)" } ?? "", raw]
                    .filter { !$0.isEmpty }
                    .joined(separator: "\n")
                NSLog("[AIUsageBar] Claude: loggedIn=\(self.claude.isLoggedIn) \(self.claude.debugRaw)")

                if let usage = json["usage"] as? [String: Any] {
                    self.parseClaudeUsage(usage)
                }
            }
        }
    }

    private func parseClaudeUsage(_ usage: [String: Any]) {
        var bars: [UsageBar] = []

        func fmt(_ iso: String?) -> String {
            guard let str = iso else { return "" }
            // resets_at looks like "2026-06-25T00:29:59.925737+00:00" — needs fractional seconds.
            let withFrac = ISO8601DateFormatter()
            withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let plain = ISO8601DateFormatter()
            guard let d = withFrac.date(from: str) ?? plain.date(from: str) else { return "" }
            let f = DateFormatter()
            f.dateFormat = "MMM d 'at' h:mma"; f.amSymbol = "am"; f.pmSymbol = "pm"
            f.timeZone = .current
            let tz = TimeZone.current.identifier.components(separatedBy: "/").last ?? ""
            return "Resets \(f.string(from: d)) (\(tz))"
        }

        func label(kind: String, scope: [String: Any]?) -> String {
            switch kind {
            case "session":        return "Current session"
            case "weekly_all":     return "Current week (all models)"
            case "weekly_scoped":
                let model = (scope?["model"] as? [String: Any])?["display_name"] as? String
                return "Current week (\(model ?? "scoped") only)"
            default:               return kind.replacingOccurrences(of: "_", with: " ").capitalized
            }
        }

        // The `limits` array is the source of truth (kind / percent / resets_at / scope).
        if let limits = usage["limits"] as? [[String: Any]] {
            for limit in limits {
                let kind = limit["kind"] as? String ?? "unknown"
                let pct = (limit["percent"] as? Double ?? 0) / 100.0
                bars.append(UsageBar(label: label(kind: kind, scope: limit["scope"] as? [String: Any]),
                                     percent: pct,
                                     resetAt: fmt(limit["resets_at"] as? String)))
            }
        }

        DispatchQueue.main.async {
            self.claude.bars = bars
            if !bars.isEmpty { self.claude.error = nil }
        }
    }

    // MARK: - ChatGPT

    func fetchChatGPT() {
        DispatchQueue.main.async { self.chatgpt.isLoading = true }
        ensureLoaded(chatgptWebView, host: "chatgpt.com", url: "https://chatgpt.com") { [weak self] in
            self?.runChatGPTJS()
        }
    }

    private func runChatGPTJS() {
        // /backend-api/usage_limits returns 404 — there is no obvious public usage endpoint.
        // Probe several candidates and report which respond, so we can pick the right one.
        let js = """
        let log = [];
        try {
            const meR = await fetch('/backend-api/me', { credentials: 'include' });
            log.push('me:' + meR.status);
            if (meR.status === 401 || meR.status === 403) {
                return { loggedIn: false, log: log.join(' ') };
            }

            const r = await fetch('/backend-api/accounts/check/v4-2023-04-27', { credentials: 'include' });
            log.push('check:' + r.status);
            if (!r.ok) {
                return { loggedIn: true, error: 'check HTTP ' + r.status, log: log.join(' ') };
            }
            const data = await r.json();
            const accts = data.accounts || {};
            const acct = accts.default || Object.values(accts)[0] || {};
            const ent = acct.entitlement || null;
            const sub = acct.last_active_subscription || acct.active_subscription || null;
            return {
                loggedIn: true,
                entitlement: ent,
                subscription: sub,
                log: log.join(' '),
                raw: JSON.stringify({ entitlement: ent, subscription: sub }, null, 1).substring(0, 1800)
            };
        } catch (e) {
            return { loggedIn: false, error: e.toString(), log: log.join(' ') };
        }
        """

        chatgptWebView.callAsyncJavaScript(js, in: nil, in: .page) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                self.chatgpt.isLoading = false

                let json: [String: Any]
                switch result {
                case .success(let value):
                    json = (value as? [String: Any]) ?? [:]
                case .failure(let err):
                    self.chatgpt.debugRaw = "JS error: \(err.localizedDescription)"
                    NSLog("[AIUsageBar] ChatGPT JS error: \(err)")
                    return
                }

                self.chatgpt.isLoggedIn = json["loggedIn"] as? Bool ?? false
                let log = json["log"] as? String ?? ""
                let raw = json["raw"] as? String ?? ""
                let err = json["error"] as? String
                self.chatgpt.error = err
                self.chatgpt.debugRaw = [log, err.map { "error: \($0)" } ?? "", raw]
                    .filter { !$0.isEmpty }
                    .joined(separator: "\n")
                NSLog("[AIUsageBar] ChatGPT: loggedIn=\(self.chatgpt.isLoggedIn) \(self.chatgpt.debugRaw)")

                if let ent = json["entitlement"] as? [String: Any] {
                    self.parseChatGPTPlan(ent, subscription: json["subscription"] as? [String: Any])
                }
            }
        }
    }

    /// ChatGPT has no usage-counter API, so we surface the subscription plan instead.
    private func parseChatGPTPlan(_ ent: [String: Any], subscription: [String: Any]?) {
        let slug = ent["subscription_plan"] as? String ?? ""
        let hasActive = ent["has_active_subscription"] as? Bool ?? false

        let names: [String: String] = [
            "chatgptguestplan": "Гость",
            "chatgptfreeplan": "Free",
            "chatgptplusplan": "Plus",
            "chatgptproplan": "Pro",
            "chatgptteamplan": "Team",
            "chatgptenterpriseplan": "Enterprise"
        ]
        let name = names[slug] ?? (slug.isEmpty ? "Неизвестно" : slug)

        var status: String
        if hasActive {
            status = "Активная подписка"
            if let renews = ent["renews_at"] as? String, !renews.isEmpty {
                status += " · продление \(renews.prefix(10))"
            } else if subscription?["will_renew"] as? Bool == false {
                status += " · без автопродления"
            }
        } else {
            status = "Без платной подписки"
        }

        DispatchQueue.main.async {
            self.chatgpt.planName = name
            self.chatgpt.planStatus = status
            self.chatgpt.error = nil
        }
    }

    // MARK: - Navigation tracking

    /// Runs `action` once the web view has a real page loaded for `host`.
    /// Waits for the navigation delegate instead of guessing with a fixed delay.
    private func ensureLoaded(_ wv: WKWebView, host: String, url: String, action: @escaping () -> Void) {
        DispatchQueue.main.async {
            if self.loadedHosts.contains(host),
               wv.url?.host?.contains(host) == true {
                action()
                return
            }

            let id = ObjectIdentifier(wv)
            self.pendingLoad[id, default: []].append(action)

            // Kick off a load if one isn't already in flight / hasn't been started.
            if !wv.isLoading && (wv.url == nil || wv.url?.host?.contains(host) != true) {
                wv.load(URLRequest(url: URL(string: url)!))
            }

            // Safety net: if didFinish never fires, run anyway after 8s so we surface an error.
            DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) {
                self.drainPending(for: id)
            }
        }
    }

    private func drainPending(for id: ObjectIdentifier) {
        let actions = pendingLoad[id] ?? []
        pendingLoad[id] = nil
        actions.forEach { $0() }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let host = webView.url?.host { loadedHosts.insert(host) }
        drainPending(for: ObjectIdentifier(webView))
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("[AIUsageBar] nav failed: \(error.localizedDescription)")
        drainPending(for: ObjectIdentifier(webView))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("[AIUsageBar] provisional nav failed: \(error.localizedDescription)")
        drainPending(for: ObjectIdentifier(webView))
    }

    // MARK: - Login (opens the SAME persistent web view in a window)

    func openClaudeLogin() {
        LoginWindowController.open(webView: claudeWebView,
                                   loginURL: URL(string: "https://claude.ai/login")!,
                                   title: "Войти в Claude") { [weak self] in
            self?.loadedHosts.remove("claude.ai")
            self?.fetchClaude()
        }
    }

    func openChatGPTLogin() {
        LoginWindowController.open(webView: chatgptWebView,
                                   loginURL: URL(string: "https://chatgpt.com/auth/login")!,
                                   title: "Войти в ChatGPT") { [weak self] in
            self?.loadedHosts.remove("chatgpt.com")
            self?.fetchChatGPT()
        }
    }
}
