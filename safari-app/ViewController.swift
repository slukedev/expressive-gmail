import Cocoa
import SafariServices
import WebKit

/// The Mac app's window: pick a browser, switch the new Gmail on or off there, open Gmail.
///
/// The switch works by opening `https://mail.google.com/mail/u/0/#better-gmail=on` (or `=off`)
/// in that browser; the extension reads it at page start (src/shared/switch-link.ts). That needs
/// no native messaging host, so it works whatever ID the browser gave the extension.
class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    private let extensionBundleIdentifier = (Bundle.main.bundleIdentifier ?? "") + ".Extension"
    private let defaults = UserDefaults.standard

    /// Browsers the extension runs in, in the order they're offered.
    private let supported: [(id: String, name: String)] = [
        ("com.google.Chrome", "Chrome"),
        ("com.apple.Safari", "Safari"),
        ("company.thebrowser.dia", "Dia"),
        ("company.thebrowser.Browser", "Arc"),
        ("com.microsoft.edgemac", "Edge"),
        ("com.brave.Browser", "Brave"),
        ("org.mozilla.firefox", "Firefox"),
        ("org.mozilla.firefoxdeveloperedition", "Firefox Developer"),
    ]

    private var installed: [(id: String, name: String, url: URL)] {
        supported.compactMap { b in
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: b.id).map { (b.id, b.name, $0) }
        }
    }

    /// The Chrome extension a release build carries (scripts/release-mac.sh), loaded unpacked from here so `brew upgrade` updates it.
    private let chromiumExtension = Bundle.main.url(forResource: "Chromium Extension", withExtension: nil)

    private var selected: String? {
        get { defaults.string(forKey: "selectedBrowser") }
        set { defaults.set(newValue, forKey: "selectedBrowser") }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.configuration.userContentController.add(self, name: "controller")
        webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
        NotificationCenter.default.addObserver(self, selector: #selector(refreshSafari), name: NSApplication.didBecomeActiveNotification, object: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let browsers = installed.map { b -> [String: Any] in
            ["id": b.id, "name": b.name, "icon": iconData(b.url), "on": defaults.object(forKey: "on.\(b.id)") as? Bool ?? true,
             "addable": chromiumExtension != nil && !["com.apple.Safari", "org.mozilla.firefox", "org.mozilla.firefoxdeveloperedition"].contains(b.id)]
        }
        let pick = browsers.contains { $0["id"] as? String == selected } ? selected : browsers.first?["id"] as? String
        send(["browsers": browsers, "selected": pick ?? NSNull()])
        refreshSafari()
    }

    /// Safari's own on/off for the extension; only Safari Settings can change it.
    @objc private func refreshSafari() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            let enabled: Any = state.map { $0.isEnabled } ?? NSNull()
            DispatchQueue.main.async { self.send(["safari": enabled]) }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        let browser = (body["browser"] as? String).flatMap { id in installed.first { $0.id == id } }
        switch action {
        case "height":
            guard let height = body["value"] as? Double, let window = view.window else { return }
            var frame = window.frameRect(forContentRect: NSRect(x: 0, y: 0, width: view.bounds.width, height: height))
            frame.origin = NSPoint(x: window.frame.minX, y: window.frame.maxY - frame.height)
            window.setFrame(frame, display: true, animate: window.isVisible)
        case "select":
            selected = browser?.id
        case "switch":
            guard let browser, let on = body["on"] as? Bool else { return }
            defaults.set(on, forKey: "on.\(browser.id)")
            open("https://mail.google.com/mail/u/0/#better-gmail=\(on ? "on" : "off")", in: browser.url)
        case "open":
            guard let browser else { return }
            open("https://mail.google.com/mail/u/0/", in: browser.url)
        case "add":
            // Chromium browsers only load an extension from outside their store by hand: show the folder,
            // put the extensions page's address on the clipboard and bring the browser forward.
            guard let browser, let folder = chromiumExtension else { return }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString("chrome://extensions", forType: .string)
            NSWorkspace.shared.activateFileViewerSelecting([folder])
            NSWorkspace.shared.openApplication(at: browser.url, configuration: NSWorkspace.OpenConfiguration())
        case "safari-settings":
            SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in }
        default:
            break
        }
    }

    private func open(_ link: String, in app: URL) {
        guard let url = URL(string: link) else { return }
        NSWorkspace.shared.open([url], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
    }

    private func send(_ state: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: state), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("render(\(json))")
    }

    private func iconData(_ app: URL) -> String {
        let icon = NSWorkspace.shared.icon(forFile: app.path)
        let size = NSSize(width: 64, height: 64)
        let image = NSImage(size: size, flipped: false) { rect in
            icon.draw(in: rect)
            return true
        }
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { return "" }
        return "data:image/png;base64," + png.base64EncodedString()
    }
}
