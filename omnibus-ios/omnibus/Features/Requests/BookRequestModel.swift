//  BookRequestModel.swift
//  The request page's state: a book's lanes (the request the page opened on and
//  each other one going or stuck), its history, and the reads that keep them
//  current. The API sits behind a seam so decisions can be tested without a server.

import Foundation
import Observation

@Observable @MainActor
final class BookRequestModel {
    let uuid: String
    private(set) var book: Book?
    /// The readers with the book on a wishlist; nil when that read failed, so the clause stays out.
    private(set) var wanters: [WishlistWanter]?
    private(set) var listings: [RequestListing]?
    /// The full reads of each lane's request, by id: only these carry every version and any cover offer.
    private(set) var reads: [Int64: BookRequest] = [:]
    /// The request the page opened on; it stays the main lane for the page's life.
    private(set) var mainID: Int64?
    private(set) var failure: String?
    /// The book itself is gone.
    private(set) var isMissing = false
    private(set) var viewer = RequestViewer(id: 0, canStart: false, canChoose: false)

    let api: RequestsAPI
    let now: @Sendable () -> Date

    init(uuid: String, api: RequestsAPI = .live, now: @escaping @Sendable () -> Date = Date.init) {
        self.uuid = uuid
        self.api = api
        self.now = now
    }

    // MARK: - Derived

    /// The main lane, then each other request going or stuck; one whose full read hasn't arrived waits.
    var lanes: [BookRequest] {
        guard let mainID, let listings else { return [] }
        let others = BookRequestFlow.splitBookRequests(listings, shown: mainID).lanes.map(\.request.id)
        return ([mainID] + others).compactMap { reads[$0] }
    }

    /// The book's past requests: the cancelled ones and any that swapped a version.
    var history: [RequestListing] {
        guard let listings else { return [] }
        return BookRequestFlow.splitBookRequests(listings, shown: mainID ?? 0).history
    }

    /// The kinds the viewer may request that nothing yet covers.
    var unrequested: [RequestKind] {
        guard let listings, let book else { return [] }
        return BookRequestFlow.unrequestedKinds(formats: book.formats, listings: listings, viewer: viewer)
    }

    var pollInterval: Duration? { BookRequestFlow.detailPollInterval(lanes) }

    /// Who asked for `lane`, as the list names them.
    func listing(for lane: BookRequest) -> RequestListing? {
        listings?.first { $0.request.id == lane.id }
    }

    // MARK: - Reads

    /// Reads the book, its listings and wishers, then each lane's full request.
    func load(viewer: RequestViewer) async {
        self.viewer = viewer
        let uuid = uuid, api = api
        async let bookRead = Self.attempt { try await api.book(uuid) }
        async let listRead = Self.attempt { try await api.bookList(uuid) }
        async let wishRead = Self.attempt { try await api.wanters(uuid) }
        let (bookResult, listResult, wishResult) = await (bookRead, listRead, wishRead)
        isMissing = false
        failure = nil
        if case let .failure(error) = bookResult {
            if case .http(404, _) = error as? APIError { isMissing = true } else { failure = RequestsModel.message(error) }
            return
        }
        guard case let .success(found) = bookResult, case let .success(listed) = listResult else {
            if case let .failure(error) = listResult { failure = RequestsModel.message(error) }
            return
        }
        book = found
        listings = listed
        wanters = try? wishResult.get()
        guard let main = BookRequestFlow.mainRequest(listings ?? [], viewer: viewer) else { return }
        mainID = main.request.id
        let others = BookRequestFlow.splitBookRequests(listings ?? [], shown: main.request.id).lanes.map(\.request.id)
        async let mainRead = Self.attempt { try await api.request(main.request.id) }
        let otherReads = await readAll(others)
        switch await mainRead {
        case let .success(request): reads = otherReads.merging([request.id: request]) { $1 }
        case let .failure(error): failure = RequestsModel.message(error)
        }
    }

    /// Reads the listings and every moving lane again; a failure leaves the page as it was.
    func poll() async {
        guard let fresh = try? await api.bookList(uuid), let mainID else { return }
        let others = BookRequestFlow.splitBookRequests(fresh, shown: mainID).lanes.map(\.request.id)
        let moving = lanes.filter { BookRequestFlow.isMoving($0.state) }.map(\.id)
        // A lane that appeared since the last read has no full request yet.
        let unread = ([mainID] + others).filter { reads[$0] == nil }
        let answers = await readAll(Array(Set(moving + unread)))
        listings = fresh
        reads.merge(answers) { $1 }
    }

    /// Each id's full request, concurrently; one that fails is left out.
    func readAll(_ ids: [Int64]) async -> [Int64: BookRequest] {
        let api = api
        return await withTaskGroup(of: BookRequest?.self) { group in
            for id in ids { group.addTask { try? await api.request(id) } }
            var found: [Int64: BookRequest] = [:]
            for await request in group { if let request { found[request.id] = request } }
            return found
        }
    }

    private static func attempt<T: Sendable>(_ read: @Sendable () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await read()) } catch { return .failure(error) }
    }
}
