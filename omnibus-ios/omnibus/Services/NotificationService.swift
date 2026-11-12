//  NotificationService.swift
//  One static func per notification route: the server's public URL and the
//  admin's notification connections. All of it is instance configuration, so
//  nothing here is ever queued offline (rule 08): each call goes straight to
//  the server and throws, and a 422 or 502 carries the server's own words.

import Foundation

/// A route's verb and path, so the two are pinned together in one place.
struct NotificationRoute: Equatable, Sendable {
    var method: String
    var path: String
}

enum NotificationService {
    /// Every route the service calls.
    enum Routes {
        static let publicURLPath = "/api/settings/public-url"
        static let connectionsPath = "/api/admin/notifications/connections"

        static let readPublicURL = NotificationRoute(method: "GET", path: publicURLPath)
        static let savePublicURL = NotificationRoute(method: "POST", path: publicURLPath)
        static let list = NotificationRoute(method: "GET", path: connectionsPath)
        static let create = NotificationRoute(method: "POST", path: connectionsPath)
        static let test = NotificationRoute(method: "POST", path: "/api/admin/notifications/test")

        static func update(id: Int64) -> NotificationRoute {
            NotificationRoute(method: "PUT", path: "\(connectionsPath)/\(id)")
        }

        static func delete(id: Int64) -> NotificationRoute {
            NotificationRoute(method: "DELETE", path: "\(connectionsPath)/\(id)")
        }
    }

    // MARK: - Public URL

    static func publicURL() async throws -> PublicURLStatus {
        try await send(Routes.readPublicURL, body: Optional<Empty>.none)
    }

    /// Saves `url`, or clears the saved one when nil. Answers with what is now in effect.
    static func setPublicURL(_ url: String?) async throws -> PublicURLStatus {
        try await send(Routes.savePublicURL, body: PublicURLUpdate(url: url))
    }

    // MARK: - Connections

    static func connections() async throws -> NotificationConnections {
        try await send(Routes.list, body: Optional<Empty>.none)
    }

    static func create(_ input: NotificationConnectionInput) async throws -> NotificationConnection {
        try await send(Routes.create, body: input)
    }

    /// Replaces every field; a secret the input leaves out keeps the saved one.
    static func update(id: Int64, _ input: NotificationConnectionInput) async throws -> NotificationConnection {
        try await send(Routes.update(id: id), body: input)
    }

    /// Answers 204.
    static func delete(id: Int64) async throws {
        let _: Empty = try await send(Routes.delete(id: id), body: Optional<Empty>.none)
    }

    /// Sends a sample through `test.settings` now and saves nothing. Answers 204
    /// when the provider took it; a 502's body is the provider's answer.
    static func test(_ test: NotificationTest) async throws {
        let _: Empty = try await send(Routes.test, body: test)
    }

    /// Dispatches on the route's verb, so a route's method is the one it is sent with.
    private static func send<Body: Encodable & Sendable, T: Decodable & Sendable>(
        _ route: NotificationRoute, body: Body?
    ) async throws -> T {
        let client = APIClient.shared
        switch (route.method, body) {
        case ("GET", _): return try await client.get(route.path)
        case let ("POST", body?): return try await client.post(route.path, body: body)
        case let ("PUT", body?): return try await client.put(route.path, body: body)
        case ("DELETE", _): return try await client.delete(route.path)
        default: throw APIError.transport("no request for \(route.method) \(route.path)")
        }
    }
}
