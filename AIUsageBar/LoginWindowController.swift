import AppKit
import WebKit

/// Shows the SAME persistent WKWebView inside a window for login.
/// Because it's the same web view used for data fetching, the session is shared.
class LoginWindowController: NSWindowController {

    private let webView: WKWebView
    private var onDone: (() -> Void)?
    private var didFinish = false

    static func open(webView: WKWebView,
                     loginURL: URL,
                     title: String,
                     onDone: @escaping () -> Void) {
        let wc = LoginWindowController(webView: webView, loginURL: loginURL, title: title, onDone: onDone)
        wc.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        objc_setAssociatedObject(NSApp!, "loginWC", wc, .OBJC_ASSOCIATION_RETAIN)
    }

    init(webView: WKWebView, loginURL: URL, title: String, onDone: @escaping () -> Void) {
        self.webView = webView
        self.onDone = onDone

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 740),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = title
        window.center()

        super.init(window: window)

        let container = NSView(frame: NSRect(x: 0, y: 0, width: 960, height: 740))

        // Toolbar with Done button
        let toolbar = NSView(frame: NSRect(x: 0, y: 700, width: 960, height: 40))
        toolbar.wantsLayer = true
        toolbar.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        toolbar.autoresizingMask = [.width, .minYMargin]

        let label = NSTextField(labelWithString: "Войдите в аккаунт, затем нажмите «Готово»")
        label.frame = NSRect(x: 16, y: 10, width: 600, height: 20)
        label.font = .systemFont(ofSize: 13)
        label.textColor = .secondaryLabelColor
        toolbar.addSubview(label)

        let doneButton = NSButton(title: "Готово ✓", target: self, action: #selector(doneTapped))
        doneButton.frame = NSRect(x: 820, y: 6, width: 120, height: 28)
        doneButton.bezelStyle = .rounded
        doneButton.keyEquivalent = "\r"
        doneButton.autoresizingMask = [.minXMargin]
        toolbar.addSubview(doneButton)

        // Attach the shared web view
        webView.frame = NSRect(x: 0, y: 0, width: 960, height: 700)
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
        webView.load(URLRequest(url: loginURL))
        container.addSubview(toolbar)

        window.contentView = container
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc private func doneTapped() {
        guard !didFinish else { return }
        didFinish = true

        // Remove web view from window so it can be reused for fetching
        webView.removeFromSuperview()

        window?.close()
        let cb = onDone
        onDone = nil

        // Give cookies a moment, then trigger fetch
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            cb?()
        }
        objc_setAssociatedObject(NSApp!, "loginWC", nil, .OBJC_ASSOCIATION_RETAIN)
    }
}
