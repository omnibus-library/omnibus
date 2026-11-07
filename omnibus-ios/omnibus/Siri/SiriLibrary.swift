//  SiriLibrary.swift
//  The reads behind every Siri and Shortcuts action, answered from the replica.
//
//  An intent can launch the app in the background with no window, so nothing
//  here assumes `AppState.bootstrap` ran: each read opens the store first. The
//  replica outlives a sign-out (the account wipe keys on the next sign-in), so
//  every answer is gated on a session, never on the replica having rows.

import Foundation

/// Whether there is anything Siri may answer from.
enum SiriReadiness: Equatable {
    case ready
    case signedOut
    /// Signed in, but the library has never reached this device.
    case notLoaded
}

/// An answer that may be unknown — offline with nothing cached — as distinct
/// from known to be empty.
enum SiriLookup<Value> {
    case found(Value)
    case none
    case unknown
}

enum SiriLibrary {
    /// How many of your reviews the latest-review read considers.
    static let reviewWindow = 20

    static func readiness() async -> SiriReadiness {
        await Startup.prepare()
        guard ServerURLStore.load() != nil, await APIClient.shared.hasToken() else { return .signedOut }
        guard await LibraryIndex.shared.isPopulated() else { return .notLoaded }
        return .ready
    }

    /// Throw the reader-facing reason Siri can't answer yet, if there is one.
    static func requireReady() async throws {
        switch await readiness() {
        case .ready: return
        case .signedOut: throw SiriError.signedOut
        case .notLoaded: throw SiriError.libraryNotLoaded
        }
    }

    /// The Continue rail: the server's if it answers promptly, else the replica's.
    /// `nil` when neither has an answer.
    static func currentlyReading() async -> [ResumePoint]? {
        await Cache.settled(CacheKey.recentProgress, within: PositionSync.openDeadline) {
            try await APIClient.shared.get(
                "/api/progress/recent", query: UserDataService.recentProgressQuery(userID: nil)
            )
        }
    }

    /// Books matching a spoken title, trying looser readings of it until one hits.
    static func search(spoken: String, limit: Int) async -> [Book] {
        for candidate in SiriAnswers.searchCandidates(for: spoken) {
            let books = await LibraryIndex.shared.search(candidate, limit: limit)
            if !books.isEmpty { return books }
        }
        return []
    }

    /// One book out of the mirror, falling back to the server for one it hasn't seen.
    static func book(uuid: String) async -> Book? {
        await Startup.prepare()
        if let local = await LibraryIndex.shared.book(uuid: uuid) { return local }
        return await LibraryService.firstBook(uuid: uuid)
    }

    /// Where the reader is in a book, whichever format they used last. A
    /// Continue card wins: the server fills in the duration and percent there.
    static func position(in book: Book, rail: [ResumePoint]?) async -> ResumePoint? {
        if let point = rail?.first(where: { $0.book.uuid == book.uuid }) { return point }
        var newest: ProgressRecord?
        for format in [ProgressFormat.epub, .audio] {
            newest = PositionSync.newest(newest, await record(uuid: book.uuid, format: format))
        }
        return newest.map { ResumePoint(record: $0, book: book) }
    }

    private static func record(uuid: String, format: ProgressFormat) async -> ProgressRecord? {
        if let local = await UserDataService.localProgress(uuid: uuid, format: format) { return local }
        let fetched: ProgressRecord?? = await Cache.settled(
            CacheKey.progress(uuid, format), within: PositionSync.openDeadline
        ) {
            let progress: BookProgress? = try await APIClient.shared.get(
                "/api/progress/\(uuid)", query: ["format": format.rawValue]
            )
            return progress?.record(for: format)
        }
        return fetched ?? nil
    }

    /// Your review of one book.
    static func review(of uuid: String) async -> SiriLookup<Review> {
        let reviews: BookReviews? = await Cache.settled(
            CacheKey.reviews(uuid), within: PositionSync.openDeadline
        ) {
            try await APIClient.shared.get("/api/reviews/\(uuid)")
        }
        guard let reviews else { return .unknown }
        return reviews.mine.map(SiriLookup.found) ?? .none
    }

    /// The review you most recently wrote, across every book.
    static func latestReview() async -> SiriLookup<Review> {
        let reviews: [Review]? = await Cache.settled(
            CacheKey.myReviews, within: PositionSync.openDeadline
        ) {
            try await APIClient.shared.get(
                "/api/reviews/mine", query: ["limit": String(reviewWindow)]
            )
        }
        guard let reviews else { return .unknown }
        return SiriAnswers.latest(of: reviews).map(SiriLookup.found) ?? .none
    }
}
