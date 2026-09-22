//  ReaderEmbeddedFontTests.swift
//  Fonts inside the reader, proved in a real WKWebView rather than reasoned about.
//
//  Both halves of the typeface work are unobservable from Swift: the glue does
//  them inside the page, and the page is the only thing that can say whether
//  they worked. So this suite boots the *real* `reader.html` over the *real*
//  `omnibus-reader://` scheme handler with the *real* committed EPUB fixture,
//  and reads the section document back out.
//
//  What it pins, and why each is load-bearing:
//
//  1. A book's own embedded face renders under Original. epub.js rewrites a
//     book's `@font-face` urls to `blob:`; the glue re-points them to `data:`
//     in epub.js's resource table before the first section is serialized. The
//     assertion that matters is **zero `blob:` sources declared** — a mechanism
//     that merely out-orders the blob copy instead of preventing it would still
//     render correctly, because both engines fall through from a refused face
//     to the next declared one. On iOS there is also no CSP to refuse anything
//     (custom scheme, bundle-served, no headers), so unlike the web suite a
//     console check would prove nothing here: the structure is the only
//     evidence.
//  2. A named face resolves from the app bundle. Editorial's woff2 travels
//     through the same scheme handler as the scripts, so this is the offline
//     proof — with no network, the face has to come from `Reader/Web/`.
//
//  Mirrors `sectionFontState` in `ui_tests/playwright/tests/flows/reader.spec.ts`
//  deliberately: the two clients run the same glue and must assert the same
//  contract. Keep them in step.

import Foundation
import Testing
import UIKit
import WebKit

@testable import omnibus

/// The family `standalone-lagoon.epub` embeds — see `embeddedFont` in
/// `ui_tests/playwright/tools/make_epub.ts`. A fixture-only name, so a pass can
/// never be the reader's own EB Garamond standing in.
private let embeddedFamily = "Fixture Serif"

/// The face Editorial asks for, and the one bundled as a woff2.
private let namedFamily = "Instrument Serif"

/// The committed EPUB with an embedded font, resolved from this file's own
/// source location: `omnibus-ios/omnibusTests/` → repo root → `test_data/`.
///
/// Read off the host filesystem rather than copied into the test bundle so the
/// suite and the Playwright specs assert against the *same* bytes; a second
/// copy would be free to drift from the one the web tests use.
private func fixtureEPUB() throws -> Data {
    let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // omnibusTests
        .deletingLastPathComponent() // omnibus-ios
        .deletingLastPathComponent() // repo root
    let epub = repoRoot
        .appendingPathComponent("test_data/epubs/generated/standalone-lagoon.epub")
    guard let data = try? Data(contentsOf: epub) else {
        throw ReaderFontTestError.fixtureMissing(epub.path)
    }
    return data
}

private enum ReaderFontTestError: Error, CustomStringConvertible {
    case fixtureMissing(String)
    case processNeverLaunched(String)
    case pageNeverBecameReady(String)
    case badJSResult

    var description: String {
        switch self {
        case let .fixtureMissing(path):
            "the embedded-font fixture is missing at \(path) — regenerate it with "
                + "`cd ui_tests/playwright && pnpm exec tsx tools/make_epub.ts`"
        case let .processNeverLaunched(diagnostics):
            "WebKit never asked for reader.html, so no web-content process came up "
                + "within \(processLaunchBudget).\n\(diagnostics)"
        case let .pageNeverBecameReady(diagnostics):
            "the reader page never reported ready within \(readerBootBudget) of its "
                + "first request.\n\(diagnostics)"
        case .badJSResult:
            "the page returned something other than the expected object"
        }
    }
}

/// How long WebKit may take to spawn its processes and issue the first request
/// for `reader.html`. Nothing of ours runs during it, and it is the one phase
/// that scales with how starved the machine is: 0.6 s on an idle Mac, 13 s on
/// a passing run of GitHub's three-core runner with the rest of the suite
/// executing alongside, and past 60 s on the runs that failed. It used to share
/// one 60 s deadline with the reader's own boot, which this launch then ate.
private let processLaunchBudget: Duration = .seconds(240)

/// From that first request to the glue reporting ready: script load, zip parse
/// and first pagination, all inside a process that now exists. Half a second on
/// the runner; the budget is headroom, not an expectation.
private let readerBootBudget: Duration = .seconds(60)

/// From ready to the face under test reporting `loaded`. The font is already
/// declared in the section by then, so this is a fetch inside the page.
private let fontLoadBudget: Duration = .seconds(30)

/// How long the failure path may spend asking the page what it sees. Covers
/// the slowest answer observed on a failing CI run (~23 s) with headroom, and
/// exists at all because a failure path that can hang is the bug this file is
/// fixing, not a diagnostic.
private let diagnosticsBudget: Duration = .seconds(30)

/// Where a boot spent its time, so a failure names the phase that ran out
/// rather than just the line that noticed.
@MainActor
private final class PhaseLog: CustomStringConvertible {
    private let start = ContinuousClock.now
    private var marks: [String] = []

    func mark(_ name: String) {
        let elapsed = (ContinuousClock.now - start).components
        let millis = elapsed.seconds * 1000 + elapsed.attoseconds / 1_000_000_000_000_000
        marks.append("\(name)@\(millis)ms")
    }

    var description: String { marks.joined(separator: " ") }
}

/// Serves the book from a local file and hands everything else to the real
/// `ReaderWebView.Coordinator`.
///
/// The app's own handler reaches for `DownloadManager` and then the network for
/// `omnibus-reader://book/…`, neither of which a test has. Everything under
/// `omnibus-reader://app/…` — `reader.html`, the three scripts, the reader's
/// `@font-face` sheet and its woff2 siblings, each with the MIME type the
/// handler assigns — goes to the real coordinator unchanged, because that path
/// is precisely what assertion 2 is about.
@MainActor
private final class FixtureSchemeHandler: NSObject, WKURLSchemeHandler {
    private let bundled: ReaderWebView.Coordinator
    private let epub: Data
    /// Every URL the page asked for, in order — the first thing worth seeing
    /// when a boot does not finish, since it says how far the page got.
    private(set) var served: [String] = []

    init(bundled: ReaderWebView.Coordinator, epub: Data) {
        self.bundled = bundled
        self.epub = epub
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        served.append(urlSchemeTask.request.url?.absoluteString ?? "<no url>")
        guard let url = urlSchemeTask.request.url, url.host == "book" else {
            bundled.webView(webView, start: urlSchemeTask)
            return
        }
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": "application/epub+zip",
                "Content-Length": String(epub.count),
                // Not optional, and the reason the first draft of this test sat
                // at "no section ever rendered": `omnibus-reader://app` and
                // `omnibus-reader://book` are different origins (scheme + host),
                // so epub.js's fetch of the book is cross-origin and is blocked
                // without this. The app's own handler sets it for the same
                // reason — mirror it or the page silently never opens the book.
                "Access-Control-Allow-Origin": "*",
            ]
        ) else {
            urlSchemeTask.didFailWithError(URLError(.badServerResponse))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(epub)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        bundled.webView(webView, stop: urlSchemeTask)
    }
}

/// A booted reader page, held together so nothing it depends on is released
/// mid-test (a configuration does not keep its scheme handler alive).
@MainActor
private final class BootedReader {
    let controller: ReaderController
    let webView: WKWebView
    private let window: UIWindow
    private let coordinator: ReaderWebView.Coordinator
    private let handler: FixtureSchemeHandler
    /// When each boot phase landed, from the moment the window was made.
    let phases: PhaseLog

    init(controller: ReaderController, webView: WKWebView, window: UIWindow,
         coordinator: ReaderWebView.Coordinator, handler: FixtureSchemeHandler,
         phases: PhaseLog)
    {
        self.controller = controller
        self.webView = webView
        self.window = window
        self.coordinator = coordinator
        self.handler = handler
        self.phases = phases
    }

    func teardown() {
        webView.stopLoading()
        webView.configuration.userContentController
            .removeScriptMessageHandler(forName: "omnibus")
        webView.removeFromSuperview()
        window.isHidden = true
        window.windowScene = nil
    }

    /// The page's own answer, landed by the probe below.
    private var probedPage: String?

    /// Ask the page what it sees, and give up if it does not answer.
    ///
    /// `callAsyncJavaScript` is answered by the web-content process and has no
    /// timeout of its own, so awaiting it bare on a failure path would hang
    /// the test instead of failing it — the same unbounded wait the budgets
    /// above exist to remove, in the one place nothing would catch it. The
    /// probe is unstructured and simply abandoned at the deadline: a wedged
    /// process then holds a task, not the suite.
    private func askPage() async -> String {
        probedPage = nil
        let probe = Task { @MainActor [weak self] in
            guard let self else { return }
            let answer: Any? = try? await self.webView.callAsyncJavaScript(
                """
                const stage = document.querySelector("#stage");
                const rect = stage ? stage.getBoundingClientRect() : null;
                return {
                  href: location.href,
                  readyState: document.readyState,
                  glue: typeof window.OmnibusReader,
                  epubjs: typeof window.ePub,
                  jszip: typeof window.JSZip,
                  stageBox: rect ? Math.round(rect.width) + "x" + Math.round(rect.height) : "none",
                  sections: document.querySelectorAll("#stage iframe").length,
                  errors: window.__omnibusTestErrors || [],
                };
                """,
                arguments: [:], contentWorld: .page
            )
            self.probedPage = answer.map { String(describing: $0) } ?? "<page refused the query>"
        }
        guard await waitUntil(timeout: diagnosticsBudget, { self.probedPage != nil }) else {
            probe.cancel()
            return "<page did not answer within \(diagnosticsBudget)>"
        }
        return probedPage ?? "<page did not answer>"
    }

    /// Everything worth knowing when a boot does not finish. A bare "never
    /// became ready" says which line failed and nothing about why, and this
    /// runs on a simulator in CI where there is nothing to poke at by hand.
    func diagnostics() async -> String {
        // Asked only once WebKit has asked us for something first. An empty
        // served list is the launch having failed, so there is provably no
        // document — and the query would be put to the very process whose
        // absence is the thing being reported.
        let page = handler.served.isEmpty
            ? "<no request ever arrived, so there is no document to ask>"
            : await askPage()
        return """
        controller: ready=\(controller.isReady) failed=\(controller.failed) \
        message=\(controller.failureMessage ?? "nil") \
        booted=\(controller.appliedSettings != nil) toc=\(controller.toc.count)
        page: \(page)
        served: \(handler.served.joined(separator: ", "))
        phases: \(phases)
        """
    }
}

/// Boot `reader.html` on the fixture book and wait for the glue to report ready.
///
/// The web view is in a real key window at a real phone size on purpose:
/// epub.js paginates from the stage's measured box, and a zero-sized or
/// unhosted view never lays a section out — so nothing would ever render, and
/// a font that is never used is never loaded.
@MainActor
private func bootFixtureReader() async throws -> BootedReader {
    let phases = PhaseLog()
    let epub = try fixtureEPUB()
    let entry = try #require(ReaderWebView.entryURL)

    // Explicit settings: Original, and nothing read from the host's stored
    // blob. This suite never writes `omnibus.readerSettings` — see the named
    // -face test for why it drives the glue directly instead.
    let controller = ReaderController(settings: ReaderSettings())
    let book = Book(
        id: 1, filename: "standalone-lagoon.epub", title: "Lagoon of Ligatures",
        uniqueIdentifier: "lagoon-fixture-uuid"
    )
    controller.configure(book: book, startCFI: nil, highlights: [])

    let coordinator = ReaderWebView.Coordinator(
        controller: controller, bookUUID: book.uuid
    )
    let handler = FixtureSchemeHandler(bundled: coordinator, epub: epub)

    let configuration = WKWebViewConfiguration()
    configuration.setURLSchemeHandler(handler, forURLScheme: ReaderWebView.scheme)
    configuration.userContentController.add(coordinator, name: "omnibus")
    // Test-only: a page-level error recorder, so a boot that dies on a script
    // error says so instead of just timing out. The reader page itself is
    // untouched.
    configuration.userContentController.addUserScript(WKUserScript(
        source: """
        window.__omnibusTestErrors = [];
        window.addEventListener("error", function (e) {
          window.__omnibusTestErrors.push(
            String(e.message) + " @ " + String(e.filename) + ":" + String(e.lineno)
          );
        });
        window.addEventListener("unhandledrejection", function (e) {
          window.__omnibusTestErrors.push("unhandled rejection: " + String(e.reason));
        });
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    ))

    let frame = CGRect(x: 0, y: 0, width: 390, height: 844)
    let webView = WKWebView(frame: frame, configuration: configuration)
    // Borrow the test host's own scene. `UIWindow(frame:)` is deprecated, and a
    // scene-less window is not attached to a screen at all — which is the thing
    // this window exists to provide.
    let scene = try #require(
        await firstWindowScene(),
        "the test host has no UIWindowScene, so the reader has no screen to lay out against"
    )
    phases.mark("scene")
    let window = UIWindow(windowScene: scene)
    window.frame = frame
    let root = UIViewController()
    root.view.addSubview(webView)
    window.rootViewController = root
    window.makeKeyAndVisible()

    controller.webView = webView
    let booted = BootedReader(
        controller: controller, webView: webView, window: window,
        coordinator: coordinator, handler: handler, phases: phases
    )

    // `reader.html` posts `hostReady` on load, which the coordinator routes to
    // the controller, which boots the glue — the app's own sequence, driven by
    // nothing but the page.
    webView.load(URLRequest(url: entry))
    phases.mark("load")
    // Two deadlines, not one: the first request is the earliest sign that
    // WebKit's processes exist, and everything before it is the launch —
    // which is what a starved runner is slow at. Bounded on its own so a slow
    // launch can neither eat the reader's budget nor be mistaken for a page
    // that loaded and then hung.
    guard await waitUntil(timeout: processLaunchBudget, { !handler.served.isEmpty }) else {
        phases.mark("launchTimeout")
        let why = await booted.diagnostics()
        booted.teardown()
        throw ReaderFontTestError.processNeverLaunched(why)
    }
    phases.mark("firstRequest")
    guard await waitUntil(timeout: readerBootBudget, { controller.isReady }) else {
        phases.mark("readyTimeout")
        let why = await booted.diagnostics()
        booted.teardown()
        throw ReaderFontTestError.pageNeverBecameReady(why)
    }
    phases.mark("ready")
    return booted
}

/// The test host's window scene, once UIKit has connected one.
///
/// The host app launches its own UI around these tests, but not necessarily
/// before the first one runs — so this waits rather than assuming.
@MainActor
private func firstWindowScene() async -> UIWindowScene? {
    var scene: UIWindowScene?
    _ = await waitUntil(timeout: .seconds(10)) {
        scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first
        return scene != nil
    }
    return scene
}

/// Poll `condition` on the main actor until it holds or the deadline passes.
///
/// Every caller names its budget: a wait that covers two phases of unequal
/// cost has no right size, which is how the boot came to time out on a launch
/// that was merely slow. A passing wait returns as soon as its condition holds.
@MainActor
private func waitUntil(
    timeout: Duration, _ condition: () async throws -> Bool
) async rethrows -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if try await condition() { return true }
        try? await Task.sleep(for: .milliseconds(50))
    }
    return try await condition()
}

/// What the section document says about its fonts. The Swift half of
/// `sectionFontState` in the Playwright spec — same fields, same reasons.
private struct SectionFontState {
    /// Every `src` declared for `embeddedFamily`, across every stylesheet the
    /// section holds (the blob-linked one included).
    var embeddedSrcs: [String]
    /// How many `FontFace`s for `embeddedFamily` are in `error` — a face that
    /// was requested and could not be had.
    var erroredEmbedded: Int
    /// Families with at least one `loaded` face. The only field here that is
    /// evidence a face was actually *had*.
    var loadedFamilies: [String]
    /// The paragraph's computed `font-family` — the **declared** stack, not the
    /// font in use. It says whose rule won the cascade (publisher's or the
    /// reader's override) and nothing about whether that face loaded; a missing
    /// woff2 falls back to Georgia while this still reads "Instrument Serif".
    var paragraphFamily: String
    /// `FontFaceSet.check` for the named face at a real size. Weaker than it
    /// looks — see the note in the named-face test.
    var namedFaceUsable: Bool
}

@MainActor
private func sectionFontState(_ webView: WKWebView) async throws -> SectionFontState? {
    let js = """
    const iframe = document.querySelector("#stage iframe");
    const doc = iframe && iframe.contentDocument;
    const p = doc && doc.body && doc.body.querySelector("p");
    if (!doc || !p) { return null; }

    const embeddedSrcs = [];
    for (const sheet of Array.from(doc.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const rule of Array.from(rules || [])) {
        // Numeric type, not `instanceof CSSFontFaceRule`: the constructor in
        // this realm is not the one the section's rules were built with.
        if (rule.type !== CSSRule.FONT_FACE_RULE) { continue; }
        const declared = rule.style
          .getPropertyValue("font-family").replace(/["']/g, "").trim();
        if (declared !== embedded) { continue; }
        embeddedSrcs.push(rule.style.getPropertyValue("src"));
      }
    }

    const faces = Array.from(doc.fonts).map((f) => ({
      family: f.family.replace(/["']/g, ""), status: f.status,
    }));
    return {
      embeddedSrcs: embeddedSrcs,
      erroredEmbedded: faces.filter(
        (f) => f.family === embedded && f.status === "error").length,
      loadedFamilies: faces.filter((f) => f.status === "loaded").map((f) => f.family),
      paragraphFamily: getComputedStyle(p).fontFamily,
      namedFaceUsable: doc.fonts.check('16px "' + named + '"'),
    };
    """
    let result = try await webView.callAsyncJavaScript(
        js,
        arguments: ["embedded": embeddedFamily, "named": namedFamily],
        contentWorld: .page
    )
    guard let result else { return nil }
    guard let dict = result as? [String: Any],
          let srcs = dict["embeddedSrcs"] as? [String],
          let errored = dict["erroredEmbedded"] as? Int,
          let loaded = dict["loadedFamilies"] as? [String],
          let paragraph = dict["paragraphFamily"] as? String,
          let usable = dict["namedFaceUsable"] as? Bool
    else { throw ReaderFontTestError.badJSResult }
    return SectionFontState(
        embeddedSrcs: srcs, erroredEmbedded: errored, loadedFamilies: loaded,
        paragraphFamily: paragraph, namedFaceUsable: usable
    )
}

// Serialized: each test boots its own page and key window, and two of those
// competing for the simulator's main run loop is how a font that would have
// loaded runs out of clock instead. WebKit's processes are shared, so only the
// first boot pays their launch; the second is warm.
@Suite("Reader fonts in the WebView", .serialized)
@MainActor
struct ReaderEmbeddedFontTests {
    @Test("a book's embedded face renders from data:, with no blob: copy to fall back to")
    func embeddedFaceIsServedAsData() async throws {
        let reader = try await bootFixtureReader()
        defer { reader.teardown() }

        var state: SectionFontState?
        let painted = await waitUntil(timeout: fontLoadBudget) {
            state = try? await sectionFontState(reader.webView)
            return state?.loadedFamilies.contains(embeddedFamily) ?? false
        }
        reader.phases.mark(painted ? "embeddedLoaded" : "fontTimeout")
        let font = try #require(state)
        #expect(painted, "the embedded face never loaded: \(font); \(reader.phases)")

        // The book's own face, under the reader's default. Original declares no
        // `font-family` at all, so this is the publisher's `p` rule winning.
        #expect(font.paragraphFamily.hasPrefix("\"\(embeddedFamily)\""))

        // The archive's bytes reached the section as a data: URI …
        #expect(
            font.embeddedSrcs.contains { $0.contains("data:font/woff2;base64,") },
            "no data: source declared for \(embeddedFamily): \(font.embeddedSrcs)"
        )
        // … and — the assertion that can actually fail on a wrong mechanism —
        // no blob: copy exists at all.
        //
        // Verified by disabling the mechanism: the section then declares
        // `url("blob:omnibus-reader://app/…")`, the face still reports `loaded`,
        // and the paragraph still renders in Fixture Serif. WKWebView resolves
        // its own blob under the custom scheme and there is no CSP here to
        // refuse it, so on iOS the wrong mechanism *works* — by accident, and
        // divergently from web, where the same copy is refused. These two lines
        // are the only thing that tells the two apart.
        #expect(
            font.embeddedSrcs.filter { $0.contains("blob:") } == [],
            "a blob: source is declared for \(embeddedFamily): \(font.embeddedSrcs)"
        )
        #expect(font.erroredEmbedded == 0, "a face for \(embeddedFamily) errored")
    }

    @Test("a named face loads from the app bundle, with nothing to fetch it from but the bundle")
    func namedFaceLoadsFromTheBundle() async throws {
        let reader = try await bootFixtureReader()
        defer { reader.teardown() }

        // Drive the glue with exactly the script a settings change sends.
        // Assigning `controller.settings` would be the fuller path, but its
        // `didSet` writes the shared `omnibus.readerSettings` key, and the
        // guard that serializes access to it cannot be held across an `await`.
        // `ReaderRebootTests` already pins that the assignment emits this; what
        // is unproven — and what this test is for — is what the page does with
        // it.
        var editorial = ReaderSettings()
        editorial.typeface = .editorial
        for script in ReaderController.settingsScripts(
            from: ReaderSettings(), to: editorial
        ) {
            _ = try? await reader.webView.evaluateJavaScript(script)
        }

        var state: SectionFontState?
        let loaded = await waitUntil(timeout: fontLoadBudget) {
            state = try? await sectionFontState(reader.webView)
            return state?.loadedFamilies.contains(namedFamily) ?? false
        }
        reader.phases.mark(loaded ? "namedLoaded" : "fontTimeout")
        let font = try #require(state)

        // A `loaded` FontFace is the assertion. The other two below look like
        // they say the same thing and do not — verified by pointing `fontsHref`
        // at a file that does not exist, where **only** this one failed:
        //   - `FontFaceSet.check` answers true when the family is not declared
        //     at all, because then nothing unloaded is needed in order to
        //     render. A missing sheet passes it.
        //   - the computed `font-family` is the declared stack, so it still
        //     names the face while the page renders in Georgia.
        // Both are kept as corroboration; neither can carry this test.
        #expect(
            loaded,
            "\(namedFamily) never loaded, so the bundled woff2 did not resolve through the scheme handler: \(font); \(reader.phases)"
        )
        #expect(font.namedFaceUsable)
        #expect(font.paragraphFamily.hasPrefix("\"\(namedFamily)\""))
        #expect(font.erroredEmbedded == 0)
    }
}
