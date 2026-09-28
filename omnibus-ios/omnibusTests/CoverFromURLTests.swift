//  CoverFromURLTests.swift
//  Applying a cover from a pasted URL: the gate before the network call, and
//  the wire shape of the request it sends. No network stub exists for this
//  suite, so this is what stands in for the route itself.

import Foundation
import Testing

@testable import omnibus

@Suite("Paste a cover URL — the apply gate")
struct CoverURLToApplyTests {
    @Test("trims surrounding whitespace and newlines")
    func trimsSurroundingWhitespace() {
        let result = LibraryService.coverURLToApply(
            "  https://x.example/c.jpg \n", isBusy: false, isOnline: true
        )
        #expect(result == "https://x.example/c.jpg")
    }

    @Test("nil for an empty or whitespace-only box")
    func nilForBlankInput() {
        #expect(LibraryService.coverURLToApply("", isBusy: false, isOnline: true) == nil)
        #expect(LibraryService.coverURLToApply("   ", isBusy: false, isOnline: true) == nil)
    }

    @Test("nil while a previous apply is still in flight")
    func nilWhileBusy() {
        #expect(
            LibraryService.coverURLToApply("https://x.example/c.jpg", isBusy: true, isOnline: true)
                == nil
        )
    }

    @Test("nil while offline — rule 08: a direct write, never queued")
    func nilWhileOffline() {
        #expect(
            LibraryService.coverURLToApply("https://x.example/c.jpg", isBusy: false, isOnline: false)
                == nil
        )
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
