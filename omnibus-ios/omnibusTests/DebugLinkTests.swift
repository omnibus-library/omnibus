//  DebugLinkTests.swift
//  The path parser the DEBUG-only `omnibus://debug/<word>/…` links share: which
//  URLs it claims, and how it splits the words after the link's own word.

import Foundation
import Testing

@testable import omnibus

#if DEBUG

private func segments(_ link: String, after word: String) -> [String]? {
    URL(string: link).flatMap { DebugLink.segments($0, after: word) }
}

struct DebugLinkTests {
    @Test func segmentsReturnsTheWordsAfterTheLinksOwnWord() {
        #expect(segments("omnibus://debug/screen/library/shelves", after: "screen") == ["library", "shelves"])
        #expect(segments("omnibus://debug/screen", after: "screen") == [])
    }

    @Test func segmentsKeepsAnEncodedSlashInsideItsWord() {
        #expect(segments("omnibus://debug/screen/search/tag/sci%2Ffi", after: "screen") == ["search", "tag", "sci/fi"])
        #expect(segments("omnibus://debug/orientation/landscape%2Fx", after: "orientation") == ["landscape/x"])
    }

    @Test func segmentsMatchesSchemeHostAndWordInAnyCaseButKeepsTheWordsCase() {
        #expect(segments("OMNIBUS://Debug/Screen/You", after: "screen") == ["You"])
    }

    @Test func segmentsReturnsNilForAForeignSchemeHostOrWord() {
        #expect(segments("https://debug/screen/you", after: "screen") == nil)
        #expect(segments("omnibus://book/screen/you", after: "screen") == nil)
        #expect(segments("omnibus://debug/orientation/landscape", after: "screen") == nil)
        #expect(segments("omnibus://debug/offline?on=1", after: "screen") == nil)
    }
}

#endif
