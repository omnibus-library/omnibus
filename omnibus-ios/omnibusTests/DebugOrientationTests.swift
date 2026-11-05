//  DebugOrientationTests.swift
//  The DEBUG-only `omnibus://debug/orientation/…` links a screenshot tour
//  rotates the interface with: which URLs are orientation links, and the mask
//  each names. A malformed one is still an orientation link, so it is consumed
//  and logged rather than handed to the deep-link router to drop silently.

import Foundation
import Testing
import UIKit

@testable import omnibus

#if DEBUG

private func mask(_ link: String) -> UIInterfaceOrientationMask? {
    URL(string: link).flatMap(DebugOrientation.orientationSegments).flatMap(DebugOrientation.mask(from:))
}

private func segments(_ link: String) -> [String]? {
    URL(string: link).flatMap(DebugOrientation.orientationSegments)
}

struct DebugOrientationTests {
    @Test func maskFromSegmentsNamesEachAcceptedOrientation() {
        #expect(mask("omnibus://debug/orientation/portrait") == .portrait)
        #expect(mask("omnibus://debug/orientation/landscape") == .landscapeLeft)
        #expect(mask("omnibus://debug/orientation/landscapeleft") == .landscapeLeft)
        #expect(mask("omnibus://debug/orientation/landscaperight") == .landscapeRight)
    }

    @Test func maskFromSegmentsIgnoresCaseInTheLink() {
        #expect(mask("OMNIBUS://Debug/Orientation/LandscapeRight") == .landscapeRight)
    }

    @Test func maskNamedReturnsNilForAnUnknownName() {
        #expect(DebugOrientation.mask(named: "sideways") == nil)
        #expect(DebugOrientation.mask(named: "") == nil)
        #expect(mask("omnibus://debug/orientation/upsidedown") == nil)
    }

    @Test func maskFromSegmentsReturnsNilWhenTheWordIsMissingOrExtra() {
        #expect(segments("omnibus://debug/orientation") == [])
        #expect(mask("omnibus://debug/orientation") == nil)
        #expect(segments("omnibus://debug/orientation/landscape/extra") == ["landscape", "extra"])
        #expect(mask("omnibus://debug/orientation/landscape/extra") == nil)
    }

    @Test func orientationSegmentsKeepsAnEncodedSlashInsideOneWord() {
        #expect(segments("omnibus://debug/orientation/landscape%2Fx") == ["landscape/x"])
        #expect(mask("omnibus://debug/orientation/landscape%2Fx") == nil)
    }

    @Test func orientationSegmentsReturnsNilForAForeignSchemeHostOrPath() {
        #expect(segments("https://debug/orientation/landscape") == nil)
        #expect(segments("omnibus://book/orientation/landscape") == nil)
        #expect(segments("omnibus://debug/screen/you") == nil)
        #expect(segments("omnibus://debug/offline?on=1") == nil)
        #expect(segments("omnibus://book/u-1") == nil)
    }
}

#endif
