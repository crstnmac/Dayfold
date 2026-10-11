// ax-tracker: emits JSON lines describing the focused app/window via the macOS
// Accessibility API. By default it reads only app name, bundle id, window title, the browser
// page URL and idle state.
//
// Only when the parent sends {"snippets":true} (a separate, explicit opt-in) it also samples
// the visible text of the focused window, at most every 30 s, and never from secure/password
// fields, private browser windows, excluded apps or while the user is idle.
//
// Fails closed: window title and URL are withheld whenever the focused element cannot be
// inspected, is a secure (password) field, secure event input is active, the window looks
// like a private/incognito window, or the app is on the exclude list.
//
// Protocol (stdout, one JSON object per line):
//   {"type":"status","trusted":Bool}                      on start and whenever trust changes
//   {"type":"focus","ts":ms,"app","bundleId","title","url","idle","secure","private",
//    "excluded","reason"}                                 only when something changed
//   {"type":"heartbeat","ts":ms}                          every 15 s so the parent can detect gaps
//   {"type":"context","ts":ms,"bundleId","text"}          visible window text, only with snippets on
// stdin: closing it makes the helper exit. A line containing a JSON object may update the
//   config at runtime: {"idle": seconds, "exclude": ["bundle.id", ...], "snippets": Bool}.
// argv: [idleSeconds] [--prompt]   (--prompt asks macOS for Accessibility permission once)
import AppKit
import ApplicationServices
import Carbon.HIToolbox

setvbuf(stdout, nil, _IOLBF, 0)

// MARK: - Output

func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let s = String(data: data, encoding: .utf8) else { return }
    print(s)
}

// MARK: - Accessibility helpers

/// Reads an attribute; returns nil on any error (unsupported, no value, timeout, hung app).
func axCopy(_ el: AXUIElement, _ attr: String) -> CFTypeRef? {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success else { return nil }
    return v
}

func axString(_ el: AXUIElement, _ attr: String) -> String? {
    axCopy(el, attr) as? String
}

func axElement(_ el: AXUIElement, _ attr: String) -> AXUIElement? {
    guard let v = axCopy(el, attr), CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(v, to: AXUIElement.self)
}

func axChildren(_ el: AXUIElement) -> [AXUIElement] {
    (axCopy(el, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

func axURL(_ el: AXUIElement) -> String? {
    guard let v = axCopy(el, kAXURLAttribute as String) else { return nil }
    if let u = v as? URL { return u.absoluteString }
    return v as? String
}

let browsers: Set<String> = [
    "com.apple.safari", "com.apple.safaritechnologypreview", "com.google.chrome",
    "com.google.chrome.beta", "com.google.chrome.canary", "com.brave.browser",
    "com.brave.browser.beta", "com.brave.browser.nightly", "company.thebrowser.browser",
    "company.thebrowser.dia", "com.microsoft.edgemac", "com.microsoft.edgemac.beta",
    "org.mozilla.firefox", "org.mozilla.firefoxdeveloperedition", "org.mozilla.nightly",
    "com.vivaldi.vivaldi", "com.operasoftware.opera", "com.operasoftware.operagx",
    "app.zen-browser.zen", "org.chromium.chromium", "com.kagi.kagimacos",
]

/// Markers that mean "private browsing" in window titles/descriptions of the major browsers.
let privateMarkers = [
    "incognito", "inprivate", "private browsing", "private window", "(private)", "private tab",
]

func looksPrivate(_ s: String) -> Bool {
    let l = s.lowercased()
    return privateMarkers.contains { l.contains($0) }
}

let textualRoles: Set<String> = [
    "AXTextField", "AXTextArea", "AXComboBox", "AXWebArea", "AXSecureTextField", "AXSearchField",
]

// MARK: - Tracker

final class Tracker {
    var idleThreshold: Double
    var exclude: Set<String> = []
    var trusted = AXIsProcessTrusted()
    var awayReasons = Set<String>()
    var lastKey = ""
    var tickCount = 0

    var observer: AXObserver?
    var observedPid: pid_t = 0
    var observedWindow: AXUIElement?
    var pendingEval: DispatchWorkItem?

    var snippets = false
    var lastSnippetAt = Date.distantPast
    var lastSnippetHash = 0

    var manualAXPids = Set<pid_t>()
    var chromiumCache = [String: Bool]()
    var webArea: (pid: pid_t, window: AXUIElement, area: AXUIElement)?

    init(idle: Double) { idleThreshold = idle }

    // MARK: Trust, idle, away

    func checkTrust() {
        let t = AXIsProcessTrusted()
        guard t != trusted else { return }
        trusted = t
        emit(["type": "status", "trusted": t])
        lastKey = ""
        webArea = nil
        manualAXPids.removeAll()
        teardownObserver()
        if t, let app = NSWorkspace.shared.frontmostApplication { observe(app.processIdentifier) }
        evaluate()
    }

    /// Fallback for missed lock/session notifications (private-but-stable CoreGraphics keys).
    func sessionAway() -> String? {
        guard let d = CGSessionCopyCurrentDictionary() as? [String: Any] else { return nil }
        if let onConsole = d["kCGSSessionOnConsoleKey"] as? Bool, !onConsole { return "session" }
        if let locked = d["CGSSessionScreenIsLocked"] as? Bool, locked { return "locked" }
        return nil
    }

    func idleSeconds() -> Double {
        CGEventSource.secondsSinceLastEventType(
            .combinedSessionState, eventType: CGEventType(rawValue: UInt32.max)!)
    }

    func setAway(_ reason: String, _ on: Bool) {
        if on { awayReasons.insert(reason) } else { awayReasons.remove(reason) }
        if !on { lastKey = "" }
        evaluate()
    }

    // MARK: Evaluation

    func scheduleEvaluate() {
        pendingEval?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.evaluate() }
        pendingEval = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: w)
    }

    func tick() {
        tickCount += 1
        checkTrust()
        // Cheap path every second (idle/away state); full AX read every 3 s as a safety net for
        // changes that raise no notification (e.g. single-page-app navigation).
        if tickCount % 3 == 0 || idleStateChanged() { evaluate() }
        if tickCount % 15 == 0 { emit(["type": "heartbeat", "ts": nowMs()]) }
    }

    var lastWasIdle = false
    func idleStateChanged() -> Bool {
        let now = !awayReasons.isEmpty || sessionAway() != nil || idleSeconds() >= idleThreshold
        defer { lastWasIdle = now }
        return now != lastWasIdle
    }

    func evaluate() {
        guard let app = NSWorkspace.shared.frontmostApplication else { return }
        let bundle = app.bundleIdentifier ?? ""
        var reason: String? = awayReasons.sorted().first ?? sessionAway()
        if reason == nil, idleSeconds() >= idleThreshold { reason = "idle" }
        let idle = reason != nil
        let excluded = exclude.contains(bundle.lowercased())

        var title = ""
        var url = ""
        var secure = false
        var isPrivate = false
        var canSample = false
        if !excluded && !idle && trusted {
            (title, url, secure, isPrivate) = inspect(app, bundle: bundle)
            canSample = !secure && !isPrivate && !title.isEmpty
        }
        let name = excluded ? "" : (app.localizedName ?? "Unknown")
        let key = "\(bundle)|\(name)|\(title)|\(url)|\(idle)|\(reason ?? "")|\(secure)|\(isPrivate)|\(excluded)"
        // Text is sampled only after the focus line for this window has been emitted, so the parent
        // always knows which window (and whether it is private or sensitive) a context line is from.
        defer { if snippets && canSample { sampleSnippet(app, bundle: bundle) } }
        if key == lastKey { return }
        lastKey = key
        lastSnippetAt = Date().addingTimeInterval(-25) // new window: sample within ~5 s
        emit([
            "type": "focus",
            "ts": nowMs(),
            "app": name,
            "bundleId": bundle,
            "title": title,
            "url": url,
            "idle": idle,
            "secure": secure,
            "private": isPrivate,
            "excluded": excluded,
            "reason": reason ?? "",
        ])
    }

    // MARK: Visible text (opt-in)

    static let textRoles: Set<String> = ["AXStaticText", "AXTextArea", "AXTextField", "AXHeading"]

    /// Reads a bounded amount of visible text from the focused window and emits it as a
    /// `context` line. Skips secure fields, anything uncertain, and unchanged content.
    func sampleSnippet(_ app: NSRunningApplication, bundle: String) {
        if Date().timeIntervalSince(lastSnippetAt) < 30 { return }
        let ax = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(ax, 0.25)
        guard let win = axElement(ax, kAXFocusedWindowAttribute as String)
                ?? axElement(ax, kAXMainWindowAttribute as String) else { return }
        lastSnippetAt = Date()
        var parts: [String] = []
        var total = 0
        var queue = [win]
        var i = 0
        let deadline = Date().addingTimeInterval(0.3)
        while i < queue.count && i < 1200 && total < 6000 && Date() < deadline {
            let el = queue[i]
            i += 1
            let role = axString(el, kAXRoleAttribute as String) ?? ""
            let sub = axString(el, kAXSubroleAttribute as String) ?? ""
            if role == "AXSecureTextField" || sub == (kAXSecureTextFieldSubrole as String) { continue }
            if Tracker.textRoles.contains(role) {
                let v = (axString(el, kAXValueAttribute as String)
                    ?? axString(el, kAXTitleAttribute as String) ?? "")
                let t = v.trimmingCharacters(in: .whitespacesAndNewlines)
                if t.count >= 8 {
                    let clipped = String(t.prefix(1500))
                    parts.append(clipped)
                    total += clipped.count
                }
            }
            queue.append(contentsOf: axChildren(el))
        }
        let text = parts.joined(separator: "\n")
        if text.isEmpty { return }
        let h = text.hashValue
        if h == lastSnippetHash { return }
        lastSnippetHash = h
        emit(["type": "context", "ts": nowMs(), "bundleId": bundle, "text": String(text.prefix(6000))])
    }

    func isChromium(_ app: NSRunningApplication, bundle: String) -> Bool {
        let key = bundle.lowercased()
        if browsers.contains(key) && !key.contains("safari") && !key.contains("firefox") { return true }
        if let c = chromiumCache[bundle] { return c }
        var result = false
        if let url = app.bundleURL {
            let fw = url.appendingPathComponent("Contents/Frameworks")
            let fm = FileManager.default
            result = fm.fileExists(atPath: fw.appendingPathComponent("Electron Framework.framework").path)
                || fm.fileExists(atPath: fw.appendingPathComponent("Chromium Embedded Framework.framework").path)
        }
        chromiumCache[bundle] = result
        return result
    }

    /// Returns (title, url, secure, private). Title and URL are empty whenever anything is uncertain.
    func inspect(_ app: NSRunningApplication, bundle: String) -> (String, String, Bool, Bool) {
        let pid = app.processIdentifier
        let ax = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(ax, 0.25) // a hung app must not stall tracking
        let chromium = isChromium(app, bundle: bundle)
        let isBrowser = browsers.contains(bundle.lowercased())
        if chromium && !manualAXPids.contains(pid) {
            // Chromium/Electron only build their AX tree once an assistive client asks for it.
            AXUIElementSetAttributeValue(ax, "AXManualAccessibility" as CFString, kCFBooleanTrue)
            manualAXPids.insert(pid)
        }
        if observedPid != pid { observe(pid) }

        var secure = false
        if let focused = axElement(ax, kAXFocusedUIElementAttribute as String) {
            let sub = axString(focused, kAXSubroleAttribute as String)
            let role = axString(focused, kAXRoleAttribute as String) ?? ""
            let desc = (axString(focused, kAXRoleDescriptionAttribute as String) ?? "").lowercased()
            secure = sub == (kAXSecureTextFieldSubrole as String)
                || role == "AXSecureTextField"
                || desc.contains("password") || desc.contains("secure")
            // Secure event input is on while any app has a password field focused.
            if !secure && textualRoles.contains(role) && IsSecureEventInputEnabled() { secure = true }
        } else if chromium || IsSecureEventInputEnabled() {
            secure = true // cannot inspect: fail closed
        }
        if secure { return ("", "", true, false) }

        guard let win = axElement(ax, kAXFocusedWindowAttribute as String)
                ?? axElement(ax, kAXMainWindowAttribute as String) else {
            return ("", "", false, false) // no AX window (menu-bar or background app)
        }
        watchWindow(win)
        let title = axString(win, kAXTitleAttribute as String) ?? ""
        let desc = axString(win, kAXDescriptionAttribute as String) ?? ""
        if isBrowser && (looksPrivate(title) || looksPrivate(desc)) { return ("", "", false, true) }
        var url = ""
        if isBrowser { url = browserURL(pid: pid, window: win) ?? "" }
        return (title, url, false, false)
    }

    // MARK: Browser URL

    /// Finds the page's AXWebArea (cached per window) and reads its AXURL. Never reads page text.
    func browserURL(pid: pid_t, window: AXUIElement) -> String? {
        if let c = webArea, c.pid == pid, CFEqual(c.window, window) {
            if let u = axURL(c.area) { return u }
            webArea = nil
        }
        var queue = [window]
        var i = 0
        let deadline = Date().addingTimeInterval(0.12)
        while i < queue.count && i < 1500 && Date() < deadline {
            let el = queue[i]
            i += 1
            if axString(el, kAXRoleAttribute as String) == "AXWebArea" {
                if let u = axURL(el) {
                    webArea = (pid, window, el)
                    return u
                }
                continue
            }
            queue.append(contentsOf: axChildren(el))
        }
        return nil
    }

    // MARK: Observers

    func teardownObserver() {
        if let o = observer {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(o), .commonModes)
        }
        observer = nil
        observedPid = 0
        observedWindow = nil
    }

    func observe(_ pid: pid_t) {
        teardownObserver()
        guard trusted else { return }
        var obs: AXObserver?
        guard AXObserverCreate(pid, axCallback, &obs) == .success, let o = obs else { return }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        for n in [kAXFocusedWindowChangedNotification, kAXMainWindowChangedNotification,
                  kAXFocusedUIElementChangedNotification, kAXWindowCreatedNotification] {
            _ = AXObserverAddNotification(o, app, n as CFString, nil)
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(o), .commonModes)
        observer = o
        observedPid = pid
    }

    func watchWindow(_ win: AXUIElement) {
        guard let o = observer else { return }
        if let old = observedWindow, CFEqual(old, win) { return }
        if let old = observedWindow {
            _ = AXObserverRemoveNotification(o, old, kAXTitleChangedNotification as CFString)
        }
        _ = AXObserverAddNotification(o, win, kAXTitleChangedNotification as CFString, nil)
        observedWindow = win
    }

    // MARK: Config from the parent

    func apply(config: [String: Any]) {
        var changed = false
        if let s = config["idle"] as? Double {
            let v = min(max(s, 15), 3600)
            changed = changed || v != idleThreshold
            idleThreshold = v
        }
        if let ids = config["exclude"] as? [String] {
            let set = Set(ids.map { $0.lowercased() })
            changed = changed || set != exclude
            exclude = set
        }
        if let on = config["snippets"] as? Bool {
            if on != snippets { lastSnippetAt = .distantPast; lastSnippetHash = 0 }
            snippets = on
        }
        if changed {
            lastKey = ""
            evaluate()
        }
    }
}

let axCallback: AXObserverCallback = { _, _, _, _ in
    DispatchQueue.main.async { tracker.scheduleEvaluate() }
}

// MARK: - Main

let argv = Array(CommandLine.arguments.dropFirst())
let wantPrompt = argv.contains("--prompt")
let initialIdle = argv.compactMap { Double($0) }.first.map { min(max($0, 15), 3600) } ?? 120
let tracker = Tracker(idle: initialIdle)

// The parent closing our stdin means "exit"; JSON lines update the config.
DispatchQueue.global().async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
        DispatchQueue.main.async { tracker.apply(config: obj) }
    }
    exit(0)
}

emit(["type": "status", "trusted": tracker.trusted])
if !tracker.trusted && wantPrompt {
    let opts = ["AXTrustedCheckOptionPrompt" as CFString: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(opts)
}

let ws = NSWorkspace.shared.notificationCenter
let dc = DistributedNotificationCenter.default()

ws.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { n in
    if let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
        tracker.webArea = nil
        tracker.observe(app.processIdentifier)
    }
    tracker.evaluate()
}
ws.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { _ in
    tracker.scheduleEvaluate()
}
let awayPairs: [(NSNotification.Name, String, Bool)] = [
    (NSWorkspace.willSleepNotification, "sleep", true),
    (NSWorkspace.didWakeNotification, "sleep", false),
    (NSWorkspace.screensDidSleepNotification, "display", true),
    (NSWorkspace.screensDidWakeNotification, "display", false),
    (NSWorkspace.sessionDidResignActiveNotification, "session", true),
    (NSWorkspace.sessionDidBecomeActiveNotification, "session", false),
]
for (name, reason, on) in awayPairs {
    ws.addObserver(forName: name, object: nil, queue: .main) { _ in tracker.setAway(reason, on) }
}
let distributedPairs: [(String, String, Bool)] = [
    ("com.apple.screenIsLocked", "locked", true),
    ("com.apple.screenIsUnlocked", "locked", false),
    ("com.apple.screensaver.didstart", "screensaver", true),
    ("com.apple.screensaver.didstop", "screensaver", false),
]
for (name, reason, on) in distributedPairs {
    dc.addObserver(forName: NSNotification.Name(name), object: nil, queue: .main) { _ in
        tracker.setAway(reason, on)
    }
}
// Accessibility permission granted or revoked in System Settings: re-check without a restart.
dc.addObserver(forName: NSNotification.Name("com.apple.accessibility.api"), object: nil, queue: .main) { _ in
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { tracker.checkTrust() }
}

if tracker.trusted, let app = NSWorkspace.shared.frontmostApplication {
    tracker.observe(app.processIdentifier)
}
tracker.evaluate()

let timer = Timer(timeInterval: 1.0, repeats: true) { _ in tracker.tick() }
timer.tolerance = 0.3
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
