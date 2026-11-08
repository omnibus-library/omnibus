//  ReaderStageScreenTests.swift
//  The stage's report of the window it sits in, and the controller that
//  listens: the pipe that tells the typography sheet whether Two Pages fits.

import Testing
import UIKit
import WebKit

@testable import omnibus

private let windowSize = CGSize(width: 440, height: 956)
private let stageSize = CGSize(width: 400, height: 700)
/// Added to the stage's top inset and not the window's, the way an open iPhone
/// Duo's differ once the status bar hides.
private let stageOnlyTop = UIEdgeInsets(top: 24, left: 0, bottom: 0, right: 0)

/// A stage hosted in a window borrowed from the test host's scene, smaller than
/// the window the way the audio dock leaves it.
@MainActor
private struct StageRig {
    let window: UIWindow
    let root: UIViewController
    let stage: ReaderStageView

    /// `observe` runs before the stage is shown: its first report lands then.
    /// `stageInsets` widen the stage's safe area without touching the window's.
    static func show(
        stageInsets: UIEdgeInsets = .zero, observe: (ReaderStageView) -> Void
    ) async throws -> StageRig {
        // `UIWindow(frame:)` is deprecated, and a scene-less window has no screen.
        let scene = try #require(
            await firstWindowScene(), "the test host has no UIWindowScene to lay out against"
        )
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: windowSize)
        let root = UIViewController()
        root.additionalSafeAreaInsets = stageInsets
        window.rootViewController = root
        let stage = ReaderStageView(webView: WKWebView(), curl: PageCurlHost())
        stage.frame = CGRect(origin: .zero, size: stageSize)
        observe(stage)
        root.view.addSubview(stage)
        window.makeKeyAndVisible()
        window.layoutIfNeeded()
        return StageRig(window: window, root: root, stage: stage)
    }

    func close() {
        window.isHidden = true
        window.rootViewController = nil
    }
}

@Suite("Reader stage screen report")
@MainActor
struct ReaderStageScreenTests {
    @Test("a stage reports the window it sits in, not its own smaller bounds")
    func stageReportsTheWindowNotItsBounds() async throws {
        var reports: [ReaderScreen] = []
        let rig = try await StageRig.show { stage in
            stage.onScreenChange = { screen, _, _ in reports.append(screen) }
        }
        defer { rig.close() }

        #expect(reports.map(\.size) == [windowSize])
        #expect(reports.first?.insets == rig.window.safeAreaInsets)
    }

    @Test("a stage reports its own top inset as the page's, which the web view lays out from")
    func stageReportsItsOwnTopInsetForThePage() async throws {
        var pageTops: [CGFloat] = []
        let rig = try await StageRig.show(stageInsets: stageOnlyTop) { stage in
            stage.onScreenChange = { _, _, pageTop in pageTops.append(pageTop) }
        }
        defer { rig.close() }

        let stageTop = rig.stage.safeAreaInsets.top
        try #require(stageTop != rig.window.safeAreaInsets.top, "the stage's top inset is its own")
        #expect(pageTops.last == stageTop)
    }

    @Test("a stage reports again when only its own top inset changes inside an unchanged window")
    func stageReportsAgainWhenOnlyItsTopInsetChanges() async throws {
        var reports: [(screen: ReaderScreen, pageTop: CGFloat)] = []
        let rig = try await StageRig.show { stage in
            stage.onScreenChange = { screen, _, pageTop in reports.append((screen, pageTop)) }
        }
        defer { rig.close() }
        let firstTop = rig.stage.safeAreaInsets.top

        rig.root.additionalSafeAreaInsets = stageOnlyTop
        rig.window.layoutIfNeeded()

        let newTop = rig.stage.safeAreaInsets.top
        try #require(newTop != firstTop, "the stage's top inset moved")
        #expect(reports.map(\.pageTop) == [firstTop, newTop])
        #expect(reports.map(\.screen.size) == [windowSize, windowSize])
        #expect(reports.last?.screen == reports.first?.screen, "the window did not change")
    }

    @Test("a stage that resizes, leaving the window and its own top inset alone, reports nothing more")
    func stageStaysQuietWhenItResizesUnderTheSameTop() async throws {
        var reports: [ReaderScreen] = []
        let rig = try await StageRig.show { stage in
            stage.onScreenChange = { screen, _, _ in reports.append(screen) }
        }
        defer { rig.close() }

        rig.stage.frame.size.height = 640
        rig.stage.layoutIfNeeded()

        #expect(rig.stage.webView.frame.height == 640, "the stage laid out")
        #expect(reports.count == 1)
    }

    @Test("a stage reports again when the window turns")
    func stageReportsAgainWhenTheWindowChanges() async throws {
        var reports: [ReaderScreen] = []
        let rig = try await StageRig.show { stage in
            stage.onScreenChange = { screen, _, _ in reports.append(screen) }
        }
        defer { rig.close() }

        let turned = CGSize(width: windowSize.height, height: windowSize.width)
        rig.window.frame = CGRect(origin: .zero, size: turned)
        rig.stage.setNeedsLayout()
        rig.window.layoutIfNeeded()

        #expect(reports.map(\.size) == [windowSize, turned])
    }

    @Test("a controller observing the stage learns the window it sits in")
    func observingControllerLearnsTheWindow() async throws {
        let controller = ReaderController(settings: ReaderSettings())
        let rig = try await StageRig.show { controller.observe($0) }
        defer { rig.close() }

        #expect(
            controller.screen
                == ReaderScreen(size: windowSize, insets: rig.window.safeAreaInsets)
        )
    }

    @Test("a controller observing the stage learns when the phone folds and unfolds")
    func observingControllerLearnsOfAFold() {
        let controller = ReaderController(settings: ReaderSettings())
        let stage = ReaderStageView(webView: WKWebView(), curl: PageCurlHost())
        controller.observe(stage)

        stage.onFoldChange?(true)
        #expect(controller.isFolded)

        stage.onFoldChange?(false)
        #expect(!controller.isFolded)
    }

    @Test("a stage does not keep the controller observing it alive")
    func stageHoldsTheControllerWeakly() {
        let stage = ReaderStageView(webView: WKWebView(), curl: PageCurlHost())
        weak var observer: ReaderController?
        do {
            let controller = ReaderController(settings: ReaderSettings())
            controller.observe(stage)
            observer = controller
        }

        #expect(observer == nil)
    }
}
