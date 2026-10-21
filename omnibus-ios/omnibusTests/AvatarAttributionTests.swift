//  AvatarAttributionTests.swift
//  The avatar flags on other users' reviews and journal entries.
//
//  Both are persisted into the offline replica (`CacheKey.reviews`,
//  `CacheKey.journals`), so a payload without the avatar key must still decode
//  (as `false`) rather than failing a book's cached reviews or journals.

import Foundation
import Testing

@testable import omnibus

@Suite struct AttributedReviewDecodeTests {
    @Test func decodesTheAvatarFlagFromAFullPayload() throws {
        let json = """
            {"user_id":7,"username":"Alice A.","has_avatar":true,"stars":4.5,
             "body_md":null,"body_html":null,"spoiler":false,"rated_at":1700000000,
             "created_at":1700000000,"updated_at":1700000000}
            """
        let decoded = try JSONDecoder().decode(AttributedReview.self, from: Data(json.utf8))
        #expect(decoded.hasAvatar == true)
        #expect(decoded.userId == 7)
        #expect(decoded.stars == 4.5)
    }

    @Test func decodesAPayloadWithoutTheAvatarFlag() throws {
        // The server marks the flag `serde(default)`; absent means `false`.
        let json = """
            {"user_id":7,"username":"alice","stars":3.0,"spoiler":false,
             "created_at":1700000000,"updated_at":1700000000}
            """
        let decoded = try JSONDecoder().decode(AttributedReview.self, from: Data(json.utf8))
        #expect(decoded.hasAvatar == false)
    }
}

@Suite struct JournalEntryDecodeTests {
    @Test func decodesTheAuthorAvatarFlagFromAFullPayload() throws {
        let json = """
            {"id":3,"book_uuid":"b-1","author_id":7,"author_name":"Alice A.",
             "author_has_avatar":true,"body_md":"hi","body_html":"<p>hi</p>",
             "progress":null,"status":"published","client_id":null,
             "created_at":1700000000,"updated_at":1700000000}
            """
        let decoded = try JSONDecoder().decode(JournalEntry.self, from: Data(json.utf8))
        #expect(decoded.authorHasAvatar == true)
        #expect(decoded.authorId == 7)
    }

    @Test func decodesAPayloadWithoutTheAuthorAvatarFlag() throws {
        // A pre-upgrade `CacheKey.journals` blob; absent means `false`.
        let json = """
            {"id":3,"book_uuid":"b-1","author_id":7,"author_name":"alice",
             "body_md":"hi","body_html":"<p>hi</p>","progress":null,
             "status":"published","client_id":null,
             "created_at":1700000000,"updated_at":1700000000}
            """
        let decoded = try JSONDecoder().decode(JournalEntry.self, from: Data(json.utf8))
        #expect(decoded.authorHasAvatar == false)
    }
}
