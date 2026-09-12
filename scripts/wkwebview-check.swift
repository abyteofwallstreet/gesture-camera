import Cocoa
import WebKit

final class Check: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
    var web: WKWebView!
    var window: NSWindow!
    let source: String
    init(url: URL, script: String) {
        source = script
        super.init()
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "report")
        config.userContentController.add(self, name: "nativeClick")
        config.userContentController.addUserScript(WKUserScript(source: "window.__TAURI__={core:{invoke:async(cmd)=>cmd==='is_self_test'?true:({folder:'WebKit test',photos:[]})}}", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1320, height: 900), configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect: web.frame, styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = web
        if CommandLine.arguments[2].contains("settings-script") {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            window.makeFirstResponder(web)
        }
        web.load(URLRequest(url: url))
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        web.evaluateJavaScript(source) { _, error in
            if let error = error { print("EVALUATION ERROR: \(error)"); exit(1) }
        }
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.deny) // This harness never opens a real camera.
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "nativeClick", let click = message.body as? [String: Double], let x = click["x"], let y = click["y"] {
            window.makeKeyAndOrderFront(nil)
            let point = web.convert(NSPoint(x: x, y: web.isFlipped ? y : web.bounds.height - y), to: nil)
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)!
                if type == .leftMouseDown { web.mouseDown(with: event) }
                else { web.mouseUp(with: event) }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                self.web.evaluateJavaScript("window.nativeClickDone?.()", completionHandler: nil)
            }
            return
        }
        print(message.body)
        let body = message.body as? [String: Any]
        exit(body?["ok"] as? Bool == true ? 0 : 1)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let source = try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
let runner = Check(url: URL(string: CommandLine.arguments[1])!, script: source)
DispatchQueue.main.asyncAfter(deadline: .now() + 60) { print("WebKit check timed out"); exit(1) }
app.run()
