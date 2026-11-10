//  RequestService.swift
//  One static func per book-request route. Every one is a command — never
//  queued offline (rule 08) — so each goes straight to the server and throws.

import Foundation

enum RequestService {
    static let listPath = "/api/requests"

    static func bookListPath(uuid: String) -> String { "/api/books/\(segment(uuid))/requests" }

    static func path(id: Int64, action: String? = nil) -> String {
        action.map { "/api/requests/\(id)/\($0)" } ?? "/api/requests/\(id)"
    }

    /// A uuid as one path segment: a `/` in it must not open another.
    private static func segment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove("/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    // MARK: - Reads

    /// Every reader's requests, newest first.
    static func list() async throws -> [RequestListing] {
        try await APIClient.shared.get(listPath)
    }

    /// One book's requests, newest first.
    static func list(bookUUID: String) async throws -> [RequestListing] {
        try await APIClient.shared.get(bookListPath(uuid: bookUUID))
    }

    /// One request with every version and any cover offer.
    static func get(id: Int64) async throws -> BookRequest {
        try await APIClient.shared.get(path(id: id))
    }

    // MARK: - Starting

    static func start(bookUUID: String, kind: RequestKind) async throws -> BookRequest {
        try await APIClient.shared.post(bookListPath(uuid: bookUUID), body: StartRequest(kind: kind))
    }

    static func start(meta: ExternalBookMeta) async throws -> BookRequest {
        try await APIClient.shared.post(listPath, body: StartRequestFromMeta(meta: meta))
    }

    // MARK: - Moving a request

    static func choose(id: Int64, resultID: Int64) async throws -> BookRequest {
        try await APIClient.shared.post(path(id: id, action: "choose"), body: ChooseVersion(resultID: resultID))
    }

    static func swap(id: Int64) async throws -> BookRequest { try await post(id, "swap") }
    static func retry(id: Int64) async throws -> BookRequest { try await post(id, "retry") }
    static func cancel(id: Int64) async throws -> BookRequest { try await post(id, "cancel") }
    /// Takes the cancel back, until the server's `cancel_at`.
    static func undoCancel(id: Int64) async throws -> BookRequest {
        try await APIClient.shared.delete(path(id: id, action: "cancel"))
    }

    /// Replaces the book's cover with the one the download brought.
    static func takeCover(id: Int64) async throws -> BookRequest { try await post(id, "cover") }
    /// Keeps the book's current cover and drops the offer.
    static func keepCover(id: Int64) async throws -> BookRequest {
        try await APIClient.shared.delete(path(id: id, action: "cover"))
    }

    private static func post(_ id: Int64, _ action: String) async throws -> BookRequest {
        try await APIClient.shared.post(path(id: id, action: action), body: Empty())
    }
}
