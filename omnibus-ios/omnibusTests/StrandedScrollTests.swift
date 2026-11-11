//  StrandedScrollTests.swift
//  Where a scroll view left past its edge is put back, and when it is left
//  alone: a system swipe that cancels a pull strands the page with a still
//  spinner showing, and nothing but this brings it back.

import CoreGraphics
import SwiftUI
import Testing
import UIKit

@testable import omnibus

/// A 300×500 viewport over 1000 points of content, at `offset`.
@MainActor
private func scroller(offset: CGPoint) -> UIScrollView {
    let view = UIScrollView(frame: CGRect(x: 0, y: 0, width: 300, height: 500))
    view.contentSize = CGSize(width: 300, height: 1000)
    view.contentOffset = offset
    return view
}

/// Spin the main run loop until `done` holds or `timeout` passes, so UIKit's
/// own animations and SwiftUI's layout get to run.
@MainActor
private func runLoop(until done: () -> Bool, timeout: TimeInterval = 3) {
    let deadline = Date().addingTimeInterval(timeout)
    while !done(), Date() < deadline {
        RunLoop.main.run(until: Date().addingTimeInterval(0.05))
    }
}

/// The first scroll view at or under `view`.
@MainActor
private func firstScrollView(in view: UIView) -> UIScrollView? {
    if let scroll = view as? UIScrollView { return scroll }
    return view.subviews.lazy.compactMap(firstScrollView(in:)).first
}

/// Hide a test's window and drop its views, so no stale key window outlives
/// the test in the app-hosted suite.
@MainActor
private func tearDown(_ window: UIWindow) {
    window.isHidden = true
    window.rootViewController = nil
}

@Suite("Stranded scroll views")
@MainActor
struct StrandedScrollTests {
    @Test("a view pulled past its top rests back at the top")
    func pulledPastTopRestsAtTop() {
        #expect(scroller(offset: CGPoint(x: 0, y: -400)).strandedRest == .zero)
    }

    @Test("a view pushed past its bottom rests back at the bottom")
    func pushedPastBottomRestsAtBottom() {
        let view = scroller(offset: CGPoint(x: 0, y: 700))
        #expect(view.strandedRest == CGPoint(x: 0, y: 500))
    }

    @Test("the top rest leaves room for the content inset")
    func topRestHonoursTheInset() {
        let view = scroller(offset: .zero)
        // Before the offset: UIKit moves the offset when the inset changes.
        view.contentInset.top = 82
        view.contentOffset = CGPoint(x: 0, y: -400)
        #expect(view.strandedRest == CGPoint(x: 0, y: -82))
    }

    @Test("a view inside its range is not stranded")
    func inRangeIsNotStranded() {
        #expect(scroller(offset: CGPoint(x: 0, y: 250)).strandedRest == nil)
    }

    @Test("a running refresh holds the view open, so it is left alone")
    func runningRefreshIsLeftAlone() {
        let view = scroller(offset: CGPoint(x: 0, y: -400))
        view.refreshControl = UIRefreshControl()
        view.refreshControl?.beginRefreshing()
        #expect(view.strandedRest == nil)
    }

    @Test("a view a finger can't scroll is left alone, wherever it rests")
    func unscrollableIsLeftAlone() {
        let view = scroller(offset: CGPoint(x: 0, y: -400))
        view.isScrollEnabled = false
        #expect(view.strandedRest == nil)
    }

    @Test("a view that doesn't bounce is left alone, wherever it rests")
    func unbouncingIsLeftAlone() {
        let view = scroller(offset: CGPoint(x: 0, y: -400))
        view.bounces = false
        #expect(view.strandedRest == nil)
    }

    // Why skipping a refreshing view is safe: ending the refresh puts the
    // view back itself, however deep the pull it was left at.
    @Test("ending a refresh brings a view left past its top back to rest")
    func endingRefreshSettlesTheView() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = UIViewController()
        window.makeKeyAndVisible()
        defer { tearDown(window) }
        let view = UIScrollView(frame: window.bounds)
        view.contentSize = CGSize(width: 390, height: 2000)
        view.contentInsetAdjustmentBehavior = .never
        view.contentInset.top = 82
        view.contentOffset = CGPoint(x: 0, y: -82)
        window.rootViewController?.view.addSubview(view)
        let refresh = UIRefreshControl()
        view.refreshControl = refresh
        refresh.beginRefreshing()
        view.contentOffset = CGPoint(x: 0, y: -600)

        refresh.endRefreshing()
        // The half-point slack `strandedRest` allows for layout rounding.
        runLoop { abs(view.contentOffset.y + 82) <= 0.5 }

        #expect(abs(view.contentOffset.y + 82) <= 0.5)
        #expect(view.strandedRest == nil)
    }

    // SwiftUI right-aligns a short row with an inset, not an offset past the
    // edge; were it the offset, settling would snap the rail to its start.
    @Test("a short rail anchored to its trailing end is not stranded")
    func trailingAnchoredRailIsNotStranded() throws {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let host = UIHostingController(rootView:
            ScrollView(.horizontal) {
                HStack { ForEach(0 ..< 2) { _ in Color.red.frame(width: 60, height: 60) } }
            }
            .defaultScrollAnchor(.trailing)
        )
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { tearDown(window) }
        var rail: UIScrollView?
        runLoop {
            // A window with no scene isn't laid out by the run loop alone.
            host.view.layoutIfNeeded()
            rail = firstScrollView(in: host.view)
            // Laid out and anchored: the row shows its trailing end, inset
            // in from the leading edge.
            return (rail?.contentSize.width ?? 0) > 0 && (rail?.contentOffset.x ?? 0) < 0
        }

        let scroll = try #require(rail)
        #expect(scroll.contentOffset.x < 0)
        #expect(scroll.strandedRest == nil)
    }

    @Test("settling reaches a stranded view nested anywhere under the root")
    func settleWalksTheHierarchy() {
        let root = UIView(frame: CGRect(x: 0, y: 0, width: 300, height: 500))
        let wrapper = UIView(frame: root.bounds)
        let view = scroller(offset: CGPoint(x: 0, y: -400))
        wrapper.addSubview(view)
        root.addSubview(wrapper)

        settleStrandedScrollViews(in: root, animated: false)

        #expect(view.contentOffset == .zero)
    }
}
