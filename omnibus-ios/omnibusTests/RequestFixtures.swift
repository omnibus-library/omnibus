//  RequestFixtures.swift
//  Builders for book-request values, so a test names only the fields it is about.

import Foundation

@testable import omnibus

func aVersion(
    id: Int64 = 11, title: String = "Piranesi - Susanna Clarke (2020) [Retail EPUB]",
    sizeBytes: Int64? = 2_400_000, format: String? = "EPUB", indexer: String? = "MyAnonamouse",
    seeders: Int64? = 142, protocol releaseProtocol: ReleaseProtocol? = .torrent, infoURL: String? = nil,
    bestMatch: Bool = false, rejected: Bool = false
) -> RequestVersion {
    RequestVersion(
        id: id, title: title, sizeBytes: sizeBytes, format: format, indexer: indexer, seeders: seeders,
        protocol: releaseProtocol, infoURL: infoURL, bestMatch: bestMatch, rejected: rejected
    )
}

func aRequest(
    id: Int64 = 1, uuid: String = "b", userID: Int64 = 1, kind: RequestKind = .ebook,
    state: RequestState = .looking, stuckReason: StuckReason? = nil, stuckDetail: String? = nil,
    chosenResultID: Int64? = nil, createdAt: Int64 = 1_000, updatedAt: Int64 = 1_000,
    progress: Double? = nil, expectedDoneAt: Int64? = nil, cancelAt: Int64? = nil,
    cancelledBy: Int64? = nil, coverOffer: CoverOffer? = nil, versions: [RequestVersion] = []
) -> BookRequest {
    BookRequest(
        id: id, bookUUID: uuid, userID: userID, kind: kind, state: state, stuckReason: stuckReason,
        stuckDetail: stuckDetail, chosenResultID: chosenResultID, createdAt: createdAt,
        updatedAt: updatedAt, progress: progress, expectedDoneAt: expectedDoneAt, cancelAt: cancelAt,
        cancelledBy: cancelledBy, note: nil, coverOffer: coverOffer, versions: versions
    )
}

/// A listed request; the book is titled and identified by the request's `bookUUID`.
func aListing(
    _ request: BookRequest, requesterName: String = "Ada", requesterHasAvatar: Bool = false,
    cancelledByName: String? = nil
) -> RequestListing {
    RequestListing(
        request: request,
        book: Book(id: 1, filename: "\(request.bookUUID).epub", title: request.bookUUID, uniqueIdentifier: request.bookUUID),
        requesterName: requesterName, requesterHasAvatar: requesterHasAvatar, cancelledByName: cancelledByName
    )
}

/// A listed request in one call: `listing("b", id: 2, state: .stuck)`.
func listing(
    _ uuid: String, id: Int64 = 1, userID: Int64 = 1, kind: RequestKind = .ebook, state: RequestState = .looking,
    stuckReason: StuckReason? = nil, progress: Double? = nil, updatedAt: Int64 = 1_000
) -> RequestListing {
    aListing(
        aRequest(
            id: id, uuid: uuid, userID: userID, kind: kind, state: state, stuckReason: stuckReason,
            updatedAt: updatedAt, progress: progress
        )
    )
}

/// A reader who can pick versions and ask for books.
let adaViewer = RequestViewer(id: 1, canStart: true, canChoose: true)
/// A reader who can ask for books but not pick their versions.
let askerViewer = RequestViewer(id: 1, canStart: true, canChoose: false)
