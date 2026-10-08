//  ReaderStageScreenTests.swift
//  The stage's report of the window it sits in, and the controller that
//  listens: the pipe that tells the typography sheet whether Two Pages fits.

import Testing
import UIKit
import WebKit

@testable import omnibus

private let windowSize = CGSize(width: 440, height: 956)
private let stageSize = CGSize(width: 400, height: 700)

/// A stage hosted in a window borrowed from the test host's scene, smaller than
/// the window the way the audio dock leaves it.
@MainActor
private struct StageRig {
    let window: UIWindow
    let stage: ReaderStageView

    /// `observe` runs before the stage is shown: its first report lands then.
    static func show(observe: (ReaderStageView) -> Void) async throws -> StageRig {
        // `UIWindow(frame:)` is deprecated, and a scene-less window has no screen.
        let scene = try #require(
            await firstWindowScene(), "the test host has no UIWindowScene to lay out against"
        )
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: windowSize)
        let root = UIViewController()
        window.rootViewController = root
        let stage = ReaderStageView(webView: WKWebView(), curl: PageCurlHost())
        stage.frame = CGRect(origin: .zero, size: stageSize)
        observe(stage)
        root.view.addSubview(stage)
        window.makeKeyAndVisible()
        window.layoutIfNeeded()
        return StageRig(window: window, stage: stage)
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
            stage.onScreenChange = { reports.append($0) }
        }
        defer { rig.close() }

        #expect(reports.map(\.size) == [windowSize])
        #expect(reports.first?.insets == rig.window.safeAreaInsets)
    }

    @Test("a stage that resizes inside an unchanged window reports nothing more")
    func stageStaysQuietWhenOnlyItResizes() async throws {
        var reports: [ReaderScreen] = []
        let rig = try await StageRig.show { stage in
            stage.onScreenChange = { reports.append($0) }
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
            stage.onScreenChange = { reports.append($0) }
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
