//  ReviewModels.swift
//  Wire mirrors of `shared/src/reviews.rs` — one review per reader per book:
//  half stars, public Markdown text, private notes and a spoiler flag — plus
//  the field-level patch the book page writes and the optimistic replica
//  patch that shows a queued write before the server has seen it.
//
//  The patch is JSON merge-patch shaped: a field left out stays as it is and a
//  field sent as `null` is cleared. Swift's synthesized `Encodable` can only
//  omit a `nil`, so `ReviewPatch` encodes itself.

import Foundation

// MARK: - Wire

/// Your review of a book, private notes included.
struct Review: Codable, Equatable, Sendable {
    var bookUUID: String
    /// Half stars, 0.5 to 5. `nil` when you gave none.
    var stars: Double?
    var bodyMd: String?
    /// `nil` until the server has rendered `bodyMd` — an optimistic edit
    /// clears it rather than guessing with a second renderer.
    var bodyHtml: String?
    /// Private notes. Only their author ever receives them.
    var notesMd: String?
    var notesHtml: String?
    var spoiler: Bool
    var ratedAt: Int64?
    var createdAt: Int64
    var updatedAt: Int64

    enum CodingKeys: String, CodingKey {
        case stars, spoiler
        case bookUUID = "book_uuid"
        case bodyMd = "body_md"
        case bodyHtml = "body_html"
        case notesMd = "notes_md"
        case notesHtml = "notes_html"
        case ratedAt = "rated_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// Another reader's review. The wire type has no notes field at all, so
/// nothing here can leak someone else's private notes.
struct AttributedReview: Codable, Equatable, Sendable, Identifiable {
    var userId: Int64
    var username: String
    /// Defaults to `false` when absent, via the lenient `Bool` decode in
    /// `Models.swift`.
    var hasAvatar: Bool = false
    var stars: Double?
    var bodyMd: String?
    var bodyHtml: String?
    var spoiler: Bool
    var ratedAt: Int64?
    var createdAt: Int64
    var updatedAt: Int64

    var id: Int64 { userId }

    /// Whether this is a written review rather than a bare rating.
    var hasText: Bool { bodyMd?.nilIfBlank != nil }

    enum CodingKeys: String, CodingKey {
        case username, stars, spoiler
        case userId = "user_id"
        case hasAvatar = "has_avatar"
        case bodyMd = "body_md"
        case bodyHtml = "body_html"
        case ratedAt = "rated_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// How many readers gave a book one half-star value.
struct ReviewBucket: Codable, Equatable, Sendable, Identifiable {
    /// 1 through 10; divide by two for stars.
    var halfStars: Int64
    var readers: Int64

    var id: Int64 { halfStars }

    /// Axis label in stars — "0.5", "1" … "5", as `RatingBucket` labels them.
    var starLabel: String {
        RatingBucket(halfStars: halfStars, books: readers).starLabel
    }

    enum CodingKeys: String, CodingKey {
        case readers
        case halfStars = "half_stars"
    }
}

/// Every reader's stars for a book, summed up. The server sends it only once
/// enough readers have rated — the client never decides that threshold.
struct ReviewSummary: Codable, Equatable, Sendable {
    var averageStars: Double
    var ratings: Int64
    var buckets: [ReviewBucket]

    enum CodingKeys: String, CodingKey {
        case ratings, buckets
        case averageStars = "average_stars"
    }
}

/// `GET /api/reviews/{uuid}`.
struct BookReviews: Codable, Equatable, Sendable {
    var mine: Review?
    /// Text reviews first, newest first, then bare ratings — the server's order.
    var others: [AttributedReview]
    var summary: ReviewSummary?

    /// What the replica starts from when a write lands before any read has.
    static let empty = BookReviews(mine: nil, others: [], summary: nil)
}

// MARK: - The patch

/// One field of a merge patch: left out, set, or cleared with an explicit `null`.
enum PatchField<Value: Equatable & Sendable>: Equatable, Sendable {
    case unchanged
    case set(Value)
    case cleared
}

/// Body of `PATCH /api/reviews/{uuid}`.
struct ReviewPatch: Encodable, Equatable, Sendable {
    var stars: PatchField<Double> = .unchanged
    var bodyMd: PatchField<String> = .unchanged
    var notesMd: PatchField<String> = .unchanged
    /// Never `null` on the wire: the server reads that as "unchanged".
    var spoiler: Bool?

    enum CodingKeys: String, CodingKey {
        case stars, spoiler
        case bodyMd = "body_md"
        case notesMd = "notes_md"
    }

    /// Whether sending this would change nothing.
    var isEmpty: Bool {
        stars == .unchanged && bodyMd == .unchanged && notesMd == .unchanged && spoiler == nil
    }

    /// A stars-only patch; `0` is the star row's "none", so it clears.
    static func stars(_ value: Double) -> ReviewPatch {
        ReviewPatch(stars: value > 0 ? .set(value) : .cleared)
    }

    /// The fields the composer changed against `original`. Blank text counts
    /// as none, as it does on the server, so emptying a field clears it and
    /// leaving an absent one blank sends nothing.
    static func edits(
        from original: Review?, body: String, notes: String, spoiler: Bool
    ) -> ReviewPatch {
        var patch = ReviewPatch()
        patch.bodyMd = textEdit(from: original?.bodyMd, to: body)
        patch.notesMd = textEdit(from: original?.notesMd, to: notes)
        if spoiler != (original?.spoiler ?? false) { patch.spoiler = spoiler }
        return patch
    }

    private static func textEdit(from old: String?, to new: String) -> PatchField<String> {
        let had = old?.nilIfBlank != nil
        guard new.nilIfBlank != nil else { return had ? .cleared : .unchanged }
        return new == old ? .unchanged : .set(new)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try Self.encode(stars, forKey: .stars, in: &container)
        try Self.encode(bodyMd, forKey: .bodyMd, in: &container)
        try Self.encode(notesMd, forKey: .notesMd, in: &container)
        try container.encodeIfPresent(spoiler, forKey: .spoiler)
    }

    private static func encode<Value: Encodable>(
        _ field: PatchField<Value>, forKey key: CodingKeys,
        in container: inout KeyedEncodingContainer<CodingKeys>
    ) throws {
        switch field {
        case .unchanged: break
        case .set(let value): try container.encode(value, forKey: key)
        case .cleared: try container.encodeNil(forKey: key)
        }
    }
}

// MARK: - Optimistic replica patch

extension Review {
    /// This review once `patch` lands, `nil` when the patch leaves it empty —
    /// the server deletes an empty review rather than storing one. Text shows
    /// as its Markdown source until the server's answer brings the HTML.
    func applying(_ patch: ReviewPatch, now: Int64) -> Review? {
        var next = self
        var publicChange = false

        switch patch.stars {
        case .unchanged: break
        case .set(let value):
            if value != stars { next.ratedAt = now }
            next.stars = value
            publicChange = true
        case .cleared:
            next.stars = nil
            next.ratedAt = nil
            publicChange = true
        }
        if patch.bodyMd != .unchanged {
            next.bodyMd = patch.bodyMd.storedText
            next.bodyHtml = nil
            publicChange = true
        }
        if patch.notesMd != .unchanged {
            next.notesMd = patch.notesMd.storedText
            next.notesHtml = nil
        }
        if let spoiler = patch.spoiler {
            next.spoiler = spoiler
            publicChange = true
        }
        // Notes are private, so editing only them moves nothing other
        // readers see — the server's rule for `updated_at`.
        if publicChange { next.updatedAt = now }

        guard next.stars != nil || next.bodyMd != nil || next.notesMd != nil else { return nil }
        return next
    }

    /// An empty review for `uuid`, created at `now` — what the first write
    /// starts from.
    static func blank(uuid: String, now: Int64) -> Review {
        Review(
            bookUUID: uuid, stars: nil, bodyMd: nil, bodyHtml: nil, notesMd: nil,
            notesHtml: nil, spoiler: false, ratedAt: nil, createdAt: now, updatedAt: now
        )
    }
}

extension PatchField where Value == String {
    /// What the server stores for this field once it is sent: the text, or
    /// `nil` for a clear or for blank text.
    var storedText: String? {
        guard case .set(let value) = self, value.nilIfBlank != nil else { return nil }
        return value
    }
}

extension BookReviews {
    /// The page once your `patch` lands. Only `mine` moves: the summary is the
    /// server's arithmetic, and is refetched once the write has landed.
    func applying(_ patch: ReviewPatch, uuid: String, now: Int64) -> BookReviews {
        var next = self
        next.mine = (mine ?? .blank(uuid: uuid, now: now)).applying(patch, now: now)
        return next
    }

    /// The page once your review is deleted.
    func deletingMine() -> BookReviews {
        var next = self
        next.mine = nil
        return next
    }
}
