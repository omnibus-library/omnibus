//  PDFStageGestureTests.swift
//  One finger pages, two fingers pan — pinned at the mechanism: PDFKit's
//  per-page scrollers (the pinch-bearing ones) take two-finger pans, the
//  page view controller's pager takes one finger, and the walk hands the
//  pinch recognisers back for the zoom capture's attribution.
//
//  The stage is stood up through the same `PDFStage.configure` the app
//  calls, so the predicate the walk selects on cannot drift from what
//  ships — a future PDFKit giving the pager a pinch recogniser would
//  otherwise make the walk disable one-finger paging entirely.

import PDFKit
import Testing
import UIKit

@testable import omnibus

@Suite("PDF stage gestures")
@MainActor
struct PDFStageGestureTests {
    @Test("per-page scrollers pan on two fingers, the pager takes one")
    func twoFingerPanning() throws {
        let data = UIGraphicsPDFRenderer(
            bounds: CGRect(x: 0, y: 0, width: 612, height: 792)
        ).pdfData { context in
            context.beginPage()
            "Page".draw(at: CGPoint(x: 72, y: 72), withAttributes: [
                .font: UIFont.systemFont(ofSize: 24),
            ])
        }
        let document = try #require(PDFDocument(data: data))
        let view = QuietPDFView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
        PDFStage.configure(view, document: document)

        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
        window.addSubview(view)
        window.makeKeyAndVisible()
        view.layoutIfNeeded()

        let pinches = PDFStage.applyTwoFingerPanning(in: view)

        // The zoomable page scrollers: two-finger pans only.
        #expect(!pinches.isEmpty, "the page's zoomable scroller should exist")
        for pinch in pinches {
            let scroller = pinch.view as? UIScrollView
            #expect(scroller?.panGestureRecognizer.minimumNumberOfTouches == 2)
        }

        // The pager: one finger only, so a two-finger drag cannot chain to
        // it at the page's content edge.
        var pager: UIScrollView?
        var queue: [UIView] = [view]
        while let next = queue.popLast() {
            if let scroll = next as? UIScrollView, scroll.pinchGestureRecognizer == nil {
                pager = scroll
            }
            queue.append(contentsOf: next.subviews)
        }
        let pagerScroll = try #require(pager, "the pager should exist")
        #expect(pagerScroll.panGestureRecognizer.minimumNumberOfTouches == 1)
        #expect(pagerScroll.panGestureRecognizer.maximumNumberOfTouches == 1)
    }
}
