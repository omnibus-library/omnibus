//  QuoteCardTests.swift
//  The quote card's shapes, type, backgrounds and cover palette — the parts
//  of the editor that are decisions rather than drawing.

import SwiftUI
import Testing

@testable import omnibus

@Suite("Quote card shapes")
struct QuoteRatioTests {
    @Test("the shapes come in the order the editor shows them")
    func ratiosAreOrderedSquarePostPortraitStory() {
        #expect(QuoteRatio.allCases == [.square, .post, .portrait, .story])
    }

    @Test("each shape keeps its name and the ratio beneath it", arguments: [
        (QuoteRatio.square, 1.0, "Square", "1:1"),
        (QuoteRatio.post, 4.0 / 5.0, "Post", "4:5"),
        (QuoteRatio.portrait, 3.0 / 4.0, "Portrait", "3:4"),
        (QuoteRatio.story, 9.0 / 16.0, "Story", "9:16"),
    ])
    func ratioCarriesValueLabelAndDetail(
        _ ratio: QuoteRatio, _ value: Double, _ label: String, _ detail: String
    ) {
        #expect(abs(Double(ratio.value) - value) < 0.001)
        #expect(ratio.label == label)
        #expect(ratio.detail == detail)
    }
}
