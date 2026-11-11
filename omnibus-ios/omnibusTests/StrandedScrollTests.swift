//  StrandedScrollTests.swift
//  Where a scroll view left past its edge is put back, and when it is left
//  alone: a system swipe that cancels a pull strands the page with a still
//  spinner showing, and nothing but this brings it back.

import CoreGraphics
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
