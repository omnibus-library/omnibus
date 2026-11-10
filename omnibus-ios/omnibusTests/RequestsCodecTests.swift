//  RequestsCodecTests.swift
//  The book-request wire contract with `omnibus_shared::book_requests`.
//
//  These models are hand-mirrored from Rust, so drift is silent: the server's
//  `ChooseVersion` is `deny_unknown_fields`, and the enums are strict on purpose
//  so a state a newer server adds fails here rather than reading as a default.

import Foundation
import Testing

@testable import omnibus

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
}

private func encodedObject(_ value: some Encodable) throws -> [String: Any] {
    let data = try JSONEncoder().encode(value)
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private let requestJSON = """
    {"id":7,"book_uuid":"u-1","user_id":2,"kind":"audiobook","state":"on_its_way",
     "stuck_reason":null,"stuck_detail":null,"chosen_result_id":11,
     "created_at":1790000000,"updated_at":1790000100,"progress":0.62,
     "expected_done_at":1790000400,"cancel_at":1790000500,"cancelled_by":3,
     "note":"Swapped for another version",
     "cover_offer":{"width":1600,"height":2400,"current_width":128,"current_height":196},
     "versions":[{"id":11,"title":"Piranesi [Retail EPUB]","size_bytes":1800000,
      "format":"EPUB","indexer":"MyAnonamouse","seeders":142,"protocol":"torrent",
      "info_url":"https://example.test/11","best_match":true,"rejected":false}]}
    """

private let nullRequestJSON = """
    {"id":8,"book_uuid":"u-2","user_id":1,"kind":"ebook","state":"looking",
     "stuck_reason":null,"stuck_detail":null,"chosen_result_id":null,
     "created_at":1,"updated_at":2,"progress":null,"expected_done_at":null,
     "cancel_at":null,"cancelled_by":null,"note":null,"cover_offer":null,"versions":[]}
    """
@Suite("Book request wire contract")
struct RequestsCodecTests {
    @Test("a listing with every nullable field null decodes its book as the existing Book")
    func decodesListingWithNulls() throws {
        let listing = try decode(
            RequestListing.self,
            """
            {"request":\(nullRequestJSON),
             "book":{"id":4,"filename":"a.epub","title":"Piranesi","unique_identifier":"u-2",
              "creators":[{"name":"Susanna Clarke"}]},
             "requester_name":"Ada","requester_has_avatar":false,"cancelled_by_name":null}
            """
        )
        #expect(listing.book.uuid == "u-2")
        #expect(listing.book.displayTitle == "Piranesi")
        #expect(listing.requesterName == "Ada")
        #expect(!listing.requesterHasAvatar)
        #expect(listing.cancelledByName == nil)
        #expect(listing.request.state == .looking)
        #expect(listing.request.versions.isEmpty)
    }

    @Test("a request decodes every field it carries")
    func decodesEveryField() throws {
        let request = try decode(BookRequest.self, requestJSON)
        #expect(request.id == 7)
        #expect(request.bookUUID == "u-1")
        #expect(request.userID == 2)
        #expect(request.kind == .audiobook)
        #expect(request.state == .onItsWay)
        #expect(request.chosenResultID == 11)
        #expect(request.createdAt == 1_790_000_000)
        #expect(request.updatedAt == 1_790_000_100)
        #expect(request.progress == 0.62)
        #expect(request.expectedDoneAt == 1_790_000_400)
        #expect(request.cancelAt == 1_790_000_500)
        #expect(request.cancelledBy == 3)
        #expect(request.note == "Swapped for another version")
        #expect(request.coverOffer == CoverOffer(width: 1600, height: 2400, currentWidth: 128, currentHeight: 196))
        let version = try #require(request.versions.first)
        #expect(version.id == 11)
        #expect(version.title == "Piranesi [Retail EPUB]")
        #expect(version.sizeBytes == 1_800_000)
        #expect(version.format == "EPUB")
        #expect(version.indexer == "MyAnonamouse")
        #expect(version.seeders == 142)
        #expect(version.protocol == .torrent)
        #expect(version.infoURL == "https://example.test/11")
        #expect(version.bestMatch)
        #expect(!version.rejected)
    }

    @Test("a stuck request decodes its reason and detail")
    func decodesStuckFields() throws {
        let request = try decode(
            BookRequest.self,
            nullRequestJSON.replacingOccurrences(of: #""state":"looking""#, with: #""state":"stuck""#)
                .replacingOccurrences(of: #""stuck_reason":null"#, with: #""stuck_reason":"couldnt_add""#)
                .replacingOccurrences(of: #""stuck_detail":null"#, with: #""stuck_detail":"no room""#)
        )
        #expect(request.stuckReason == .couldntAdd)
        #expect(request.stuckDetail == "no room")
    }

    @Test(
        "each request state maps to its own case",
        arguments: [
            ("looking", RequestState.looking), ("choose", .choose), ("chosen", .chosen),
            ("on_its_way", .onItsWay), ("ready", .ready), ("stuck", .stuck), ("cancelled", .cancelled),
        ])
    func decodesEachState(wire: String, expected: RequestState) throws {
        #expect(try decode(RequestState.self, "\"\(wire)\"") == expected)
    }

    @Test(
        "each stuck reason maps to its own case",
        arguments: [
            ("not_found", StuckReason.notFound), ("search_failed", .searchFailed),
            ("stopped_moving", .stoppedMoving), ("couldnt_add", .couldntAdd),
        ])
    func decodesEachStuckReason(wire: String, expected: StuckReason) throws {
        #expect(try decode(StuckReason.self, "\"\(wire)\"") == expected)
    }

    @Test("each kind and protocol maps to its own case")
    func decodesKindAndProtocol() throws {
        #expect(try decode(RequestKind.self, "\"ebook\"") == .ebook)
        #expect(try decode(RequestKind.self, "\"audiobook\"") == .audiobook)
        #expect(try decode(ReleaseProtocol.self, "\"torrent\"") == .torrent)
        #expect(try decode(ReleaseProtocol.self, "\"usenet\"") == .usenet)
    }

    @Test("a state this build predates fails loudly instead of reading as a default")
    func rejectsAnUnknownState() {
        #expect(throws: DecodingError.self) { try decode(RequestState.self, "\"parked\"") }
    }

    @Test("choosing a version sends exactly result_id, since the server denies unknown fields")
    func encodesChooseVersion() throws {
        let object = try encodedObject(ChooseVersion(resultID: 7))
        #expect(object.keys.sorted() == ["result_id"])
        #expect(object["result_id"] as? Int == 7)
    }

    @Test("starting a request sends the kind alone")
    func encodesStartRequest() throws {
        let object = try encodedObject(StartRequest(kind: .ebook))
        #expect(object.keys.sorted() == ["kind"])
        #expect(object["kind"] as? String == "ebook")
    }

    @Test("starting from a provider record sends kind and meta")
    func encodesStartFromMeta() throws {
        let meta = ExternalBookMeta(
            isbn13: "9780000000002", title: "Verify Book", authors: ["A Author"], year: nil, pages: nil,
            publisher: nil, description: nil, coverURL: nil, source: "open_library"
        )
        let object = try encodedObject(StartRequestFromMeta(meta: meta))
        #expect(object.keys.sorted() == ["kind", "meta"])
        #expect(object["kind"] as? String == "ebook")
        #expect((object["meta"] as? [String: Any])?["isbn13"] as? String == "9780000000002")
    }

    private let base = #""id":1,"username":"ada","is_admin":false,"can_upload":false,"can_edit":false,"can_download":true"#

    @Test("the user decodes the three request flags")
    func decodesFlags() throws {
        let user = try decode(
            UserSummary.self,
            "{\(base),\"book_requests\":true,\"can_start_requests\":true,\"can_choose_request_versions\":true}"
        )
        #expect(user.bookRequests)
        #expect(user.canStartRequests)
        #expect(user.canChooseRequestVersions)
    }

    @Test("a cached user from before the flags decodes them as off")
    func decodesMissingFlagsAsOff() throws {
        let user = try decode(UserSummary.self, "{\(base)}")
        #expect(!user.bookRequests)
        #expect(!user.canStartRequests)
        #expect(!user.canChooseRequestVersions)
    }

    @Test("a scan book decodes has_files, and reads a missing one as false")
    func decodesHasFiles() throws {
        let book = #""uuid":"u","title":"T","authors":[],"cover_url":null,"has_physical":false"#
        #expect(try decode(ScanBook.self, "{\(book),\"has_files\":true}").hasFiles)
        #expect(try !decode(ScanBook.self, "{\(book)}").hasFiles)
    }

    @Test("each route is the exact path and verb the server mounts")
    func routesMatchTheServer() {
        #expect(RequestService.listPath == "/api/requests")
        #expect(RequestService.bookListPath(uuid: "u-1") == "/api/books/u-1/requests")
        #expect(RequestService.path(id: 5) == "/api/requests/5")
        #expect(RequestService.startPath(uuid: "u-1") == "/api/books/u-1/requests")
        #expect(RequestService.startFromMetaPath == "/api/requests")
        #expect(RequestService.path(id: 5, action: "choose") == "/api/requests/5/choose")
        #expect(RequestService.path(id: 5, action: "cover") == "/api/requests/5/cover")
    }

    @Test("a uuid path segment is percent-encoded")
    func encodesTheUUIDSegment() {
        #expect(RequestService.bookListPath(uuid: "a b/c") == "/api/books/a%20b%2Fc/requests")
        #expect(RequestService.startPath(uuid: "a b/c") == "/api/books/a%20b%2Fc/requests")
    }
}
