//  Requests.swift
//  Wire types for book requests — the Swift side of `omnibus_shared::book_requests`.
//  The enums are strict: a state a newer server adds should fail the codec test
//  that lists every case, not read as a default.

import Foundation

/// Which format a request fetches.
enum RequestKind: String, Codable, Sendable, CaseIterable {
    case ebook, audiobook
}

/// Where a request stands.
enum RequestState: String, Codable, Sendable, CaseIterable {
    case looking, choose, chosen
    case onItsWay = "on_its_way"
    case ready, stuck, cancelled
}

/// Why a request is stuck.
enum StuckReason: String, Codable, Sendable {
    case notFound = "not_found"
    case searchFailed = "search_failed"
    case stoppedMoving = "stopped_moving"
    case couldntAdd = "couldnt_add"
}

/// How a version is fetched.
enum ReleaseProtocol: String, Codable, Sendable {
    case torrent, usenet
}

/// One version of the book the search found.
struct RequestVersion: Codable, Hashable, Sendable {
    var id: Int64
    var title: String
    var sizeBytes: Int64?
    var format: String?
    var indexer: String?
    var seeders: Int64?
    var `protocol`: ReleaseProtocol?
    var infoURL: String?
    var bestMatch: Bool
    var rejected: Bool

    enum CodingKeys: String, CodingKey {
        case id, title, format, indexer, seeders, `protocol`, rejected
        case sizeBytes = "size_bytes"
        case infoURL = "info_url"
        case bestMatch = "best_match"
    }
}

/// A sharper cover a finished download brought, with both sizes in pixels.
struct CoverOffer: Codable, Hashable, Sendable {
    var width: UInt32
    var height: UInt32
    var currentWidth: UInt32
    var currentHeight: UInt32

    enum CodingKeys: String, CodingKey {
        case width, height
        case currentWidth = "current_width"
        case currentHeight = "current_height"
    }
}

struct BookRequest: Codable, Hashable, Sendable, Identifiable {
    var id: Int64
    var bookUUID: String
    var userID: Int64
    var kind: RequestKind
    var state: RequestState
    var stuckReason: StuckReason?
    var stuckDetail: String?
    var chosenResultID: Int64?
    /// Unix seconds.
    var createdAt: Int64
    var updatedAt: Int64
    /// 0 to 1 while the download runs.
    var progress: Double?
    var expectedDoneAt: Int64?
    /// While cancelled, when the request stops being undoable.
    var cancelAt: Int64?
    var cancelledBy: Int64?
    var note: String?
    /// Only on a single request's read; null in lists.
    var coverOffer: CoverOffer?
    var versions: [RequestVersion] = []

    enum CodingKeys: String, CodingKey {
        case id, kind, state, progress, note, versions
        case bookUUID = "book_uuid"
        case userID = "user_id"
        case stuckReason = "stuck_reason"
        case stuckDetail = "stuck_detail"
        case chosenResultID = "chosen_result_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case expectedDoneAt = "expected_done_at"
        case cancelAt = "cancel_at"
        case cancelledBy = "cancelled_by"
        case coverOffer = "cover_offer"
    }
}

/// A request as a list shows it: its book, who made it and who cancelled it.
struct RequestListing: Codable, Hashable, Sendable {
    var request: BookRequest
    var book: Book
    var requesterName: String
    var requesterHasAvatar: Bool
    var cancelledByName: String?

    enum CodingKeys: String, CodingKey {
        case request, book
        case requesterName = "requester_name"
        case requesterHasAvatar = "requester_has_avatar"
        case cancelledByName = "cancelled_by_name"
    }
}

/// Body of `POST /api/books/{uuid}/requests`.
struct StartRequest: Encodable, Sendable {
    var kind: RequestKind
}

/// Body of `POST /api/requests`: a request for a book the library doesn't have yet.
struct StartRequestFromMeta: Encodable, Sendable {
    var kind: RequestKind = .ebook
    var meta: ExternalBookMeta
}

/// Body of `POST /api/requests/{id}/choose`. The server denies unknown fields.
struct ChooseVersion: Encodable, Sendable {
    var resultID: Int64

    enum CodingKeys: String, CodingKey { case resultID = "result_id" }
}
