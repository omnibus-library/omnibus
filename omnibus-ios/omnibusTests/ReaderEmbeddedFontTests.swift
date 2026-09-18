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
    case pageNeverBecameReady(String)
    case badJSResult

    var description: String {
        switch self {
        case let .fixtureMissing(path):
            "the embedded-font fixture is missing at \(path) — regenerate it with "
                + "`cd ui_tests/playwright && pnpm exec tsx tools/make_epub.ts`"
        case let .pageNeverBecameReady(diagnostics):
            "the reader page never reported ready.\n\(diagnostics)"
        case .badJSResult:
            "the page returned something other than the expected object"
        }
    }
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

    init(controller: ReaderController, webView: WKWebView, window: UIWindow,
         coordinator: ReaderWebView.Coordinator, handler: FixtureSchemeHandler)
    {
        self.controller = controller
        self.webView = webView
        self.window = window
        self.coordinator = coordinator
        self.handler = handler
    }

    func teardown() {
        webView.stopLoading()
        webView.configuration.userContentController
            .removeScriptMessageHandler(forName: "omnibus")
        webView.removeFromSuperview()
        window.isHidden = true
        window.windowScene = nil
    }

    /// Everything worth knowing when a boot does not finish. A bare "never
    /// became ready" says which line failed and nothing about why, and this
    /// runs on a simulator in CI where there is nothing to poke at by hand.
    func diagnostics() async -> String {
        let answer: Any? = try? await webView.callAsyncJavaScript(
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
        let page = answer.map { String(describing: $0) } ?? "<page did not answer>"
        return """
        controller: ready=\(controller.isReady) failed=\(controller.failed) \
        message=\(controller.failureMessage ?? "nil") \
        booted=\(controller.appliedSettings != nil) toc=\(controller.toc.count)
        page: \(page)
        served: \(handler.served.joined(separator: ", "))
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
    let window = UIWindow(windowScene: scene)
    window.frame = frame
    let root = UIViewController()
    root.view.addSubview(webView)
    window.rootViewController = root
    window.makeKeyAndVisible()

    controller.webView = webView
    let booted = BootedReader(
        controller: controller, webView: webView, window: window,
        coordinator: coordinator, handler: handler
    )

    // `reader.html` posts `hostReady` on load, which the coordinator routes to
    // the controller, which boots the glue — the app's own sequence, driven by
    // nothing but the page.
    webView.load(URLRequest(url: entry))
    guard await waitUntil({ controller.isReady }) else {
        let why = await booted.diagnostics()
        booted.teardown()
        throw ReaderFontTestError.pageNeverBecameReady(why)
    }
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
/// Generous, because a cold simulator pays for a web-content process launch, a
/// zip parse and a first pagination before anything can be true; a passing run
/// returns as soon as it is.
@MainActor
private func waitUntil(
    timeout: Duration = .seconds(60), _ condition: () async throws -> Bool
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

// Serialized: each test boots its own web-content process and key window, and
// two of those competing for the simulator's main run loop is how a font that
// would have loaded runs out of clock instead.
@Suite("Reader fonts in the WebView", .serialized)
@MainActor
struct ReaderEmbeddedFontTests {
    @Test("a book's embedded face renders from data:, with no blob: copy to fall back to")
    func embeddedFaceIsServedAsData() async throws {
        let reader = try await bootFixtureReader()
        defer { reader.teardown() }

        var state: SectionFontState?
        let painted = await waitUntil {
            state = try? await sectionFontState(reader.webView)
            return state?.loadedFamilies.contains(embeddedFamily) ?? false
        }
        let font = try #require(state)
        #expect(painted, "the embedded face never loaded: \(font)")

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
        let loaded = await waitUntil {
            state = try? await sectionFontState(reader.webView)
            return state?.loadedFamilies.contains(namedFamily) ?? false
        }
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
            "\(namedFamily) never loaded, so the bundled woff2 did not resolve through the scheme handler: \(font)"
        )
        #expect(font.namedFaceUsable)
        #expect(font.paragraphFamily.hasPrefix("\"\(namedFamily)\""))
        #expect(font.erroredEmbedded == 0)
    }
}
