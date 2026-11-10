//  RequestsModel.swift
//  The Requests list's state — what the last read answered and which groups are
//  folded — and the API seam both request screens read and write through, so
//  decisions can be tested without a server.

import Foundation
import Observation

/// The calls the request screens make, as closures so tests can hand in a fake.
struct RequestsAPI: Sendable {
    var list: @Sendable () async throws -> [RequestListing]
    var bookList: @Sendable (String) async throws -> [RequestListing]
    var request: @Sendable (Int64) async throws -> BookRequest
    var book: @Sendable (String) async throws -> Book
    /// The readers who have the book on a wishlist.
    var wanters: @Sendable (String) async throws -> [WishlistWanter]
    var start: @Sendable (String, RequestKind) async throws -> BookRequest
    var startFromMeta: @Sendable (ExternalBookMeta) async throws -> BookRequest
    /// Matches a provider record against the library.
    var resolveMeta: @Sendable (ExternalBookMeta) async throws -> ScanOutcome
    /// Picks a version: the request id, then the version id.
    var choose: @Sendable (Int64, Int64) async throws -> BookRequest
    var swap: @Sendable (Int64) async throws -> BookRequest
    var retry: @Sendable (Int64) async throws -> BookRequest
    var cancel: @Sendable (Int64) async throws -> BookRequest
    var undoCancel: @Sendable (Int64) async throws -> BookRequest
    var takeCover: @Sendable (Int64) async throws -> BookRequest
    var keepCover: @Sendable (Int64) async throws -> BookRequest

    static let live = RequestsAPI(
        list: { try await RequestService.list() },
        bookList: { try await RequestService.list(bookUUID: $0) },
        request: { try await RequestService.get(id: $0) },
        book: { try await APIClient.shared.get("/api/ebooks/\($0)") },
        wanters: { uuid in
            try await UserDataService.wishlists(scope: .everyone).first { $0.id == uuid }?.wantedBy ?? []
        },
        start: { try await RequestService.start(bookUUID: $0, kind: $1) },
        startFromMeta: { try await RequestService.start(meta: $0) },
        resolveMeta: { try await APIClient.shared.post("/api/scan/resolve-meta", body: ResolveMetaRequest(meta: $0)) },
        choose: { try await RequestService.choose(id: $0, resultID: $1) },
        swap: { try await RequestService.swap(id: $0) },
        retry: { try await RequestService.retry(id: $0) },
        cancel: { try await RequestService.cancel(id: $0) },
        undoCancel: { try await RequestService.undoCancel(id: $0) },
        takeCover: { try await RequestService.takeCover(id: $0) },
        keepCover: { try await RequestService.keepCover(id: $0) }
    )
}

@Observable @MainActor
final class RequestsModel {
    static let foldsKey = "omnibus.requests_folds"

    /// Nil until the first read answers.
    private(set) var listings: [RequestListing]?
    private(set) var failure: String?
    /// The reader's own fold choices by group; a group with none follows `RequestsFlow.defaultFolds`.
    private var folds: [String: Bool]

    private let api: RequestsAPI
    private let defaults: UserDefaults

    init(api: RequestsAPI = .live, defaults: UserDefaults = .standard) {
        self.api = api
        self.defaults = defaults
        folds = defaults.dictionary(forKey: Self.foldsKey) as? [String: Bool] ?? [:]
    }

    /// Reads the list. A failure shows only while there is nothing else on screen.
    func load() async {
        do {
            listings = try await api.list()
            failure = nil
        } catch {
            failure = Self.message(error)
        }
    }

    /// Reads the list again in the background; a failure leaves the rows as they were.
    func poll() async {
        if let fresh = try? await api.list() { listings = fresh }
    }

    func groups(viewer: RequestViewer) -> [RequestGroup] {
        RequestsFlow.groups(listings ?? [], viewer: viewer)
    }

    func isFolded(_ key: RequestGroupKey) -> Bool {
        folds[key.rawValue] ?? RequestsFlow.defaultFolds[key] ?? false
    }

    func toggleFold(_ key: RequestGroupKey) {
        folds[key.rawValue] = !isFolded(key)
        defaults.set(folds, forKey: Self.foldsKey)
    }

    static func message(_ error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
