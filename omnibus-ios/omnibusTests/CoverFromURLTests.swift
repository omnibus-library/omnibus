//  CoverFromURLTests.swift
//  Staging a cover from a pasted URL: what the box accepts, and the wire shape
//  of the request a save sends. No network stub exists for this suite, so this
//  is what stands in for the route itself.

import Foundation
import Testing

@testable import omnibus

@Suite("Paste a cover URL — what the box accepts")
struct StagedCoverPastedTests {
    @Test("trims surrounding whitespace and newlines")
    func trimsSurroundingWhitespace() {
        #expect(StagedCover.pasted("  https://x.example/c.jpg \n") == .url("https://x.example/c.jpg"))
    }

    @Test("nil for an empty or whitespace-only box")
    func nilForBlankInput() {
        #expect(StagedCover.pasted("") == nil)
        #expect(StagedCover.pasted("   ") == nil)
    }

    @Test("nil for anything the server couldn't fetch")
    func nilForANonWebAddress() {
        #expect(StagedCover.pasted("cover.jpg") == nil)
        #expect(StagedCover.pasted("file:///tmp/cover.jpg") == nil)
    }
}

@Suite("Paste a cover URL — the request body")
struct CoverFromURLRequestShapeTests {
    @Test("encodes to exactly the url field")
    func encodesToExactlyTheURLField() throws {
        let data = try JSONEncoder().encode(CoverFromURLRequest(url: "https://x.example/c.jpg"))
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json.count == 1)
        #expect(json["url"] as? String == "https://x.example/c.jpg")
    }
}
