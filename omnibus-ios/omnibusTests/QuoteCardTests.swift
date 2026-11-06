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

@Suite("Quote card type")
struct QuoteTypeTests {
    @Test("the passage steps down at each length boundary", arguments: [
        (89, 82.0), (90, 66.0), (179, 66.0), (180, 52.0),
        (319, 52.0), (320, 42.0), (519, 42.0), (520, 34.0),
    ])
    func passageSizeStepsAtLengthBoundaries(_ characters: Int, _ expected: Double) {
        let size = QuoteCard.passageSize(characters: characters, width: 1000, size: .m)
        #expect(abs(Double(size) - expected) < 0.001)
    }

    @Test("the S and L sizes scale the stepped size")
    func passageSizeScalesWithTheSizeControl() {
        let small = QuoteCard.passageSize(characters: 50, width: 1000, size: .s)
        let large = QuoteCard.passageSize(characters: 50, width: 1000, size: .l)
        #expect(abs(Double(small) - 69.7) < 0.001)
        #expect(abs(Double(large) - 96.76) < 0.001)
    }

    @Test("a new card is Serif, M, upright and not bold")
    func quoteTypeDefaultsToUprightMediumSerif() {
        let type = QuoteType()
        #expect(type.face == .serif)
        #expect(type.size == .m)
        #expect(!type.bold)
        #expect(!type.italic)
    }
}
