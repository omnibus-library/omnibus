//  Notifications.swift
//  Wire types for the server's public URL and its notification connections —
//  the Swift side of `omnibus_shared::notifications` and `PublicUrl*`.
//
//  A connection's secrets go one way: an input carries a token or password
//  only when one was typed, and leaves the key out otherwise so the server
//  keeps the saved one; a response says only whether one is set. Settings are
//  tagged by `kind`; a kind, sign-in mode or URL source this build doesn't know
//  decodes as `.unknown`, so one newer value can't fail a whole response.

import Foundation

// MARK: - Public URL

/// Where the public URL in effect comes from.
enum PublicURLSource: Hashable, Sendable {
    /// Saved through the API.
    case settings
    /// Read from the server's `OMNIBUS_PUBLIC_URL`, since none is saved.
    case env
    case none
    /// A source a newer server names; the screen claims none.
    case unknown(String)

    init(rawValue: String) {
        switch rawValue {
        case "settings": self = .settings
        case "env": self = .env
        case "none": self = .none
        default: self = .unknown(rawValue)
        }
    }

    var rawValue: String {
        switch self {
        case .settings: "settings"
        case .env: "env"
        case .none: "none"
        case let .unknown(name): name
        }
    }
}

extension PublicURLSource: Codable {
    init(from decoder: Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

struct PublicURLStatus: Codable, Hashable, Sendable {
    /// The URL in effect, normalised, with no trailing slash.
    var url: String?
    var source: PublicURLSource
}

/// What to save as the public URL; nil clears the saved one.
struct PublicURLUpdate: Encodable, Hashable, Sendable {
    var url: String?

    enum CodingKeys: String, CodingKey { case url }

    // An explicit null rather than a missing key: clearing is the point of sending nil.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(url, forKey: .url)
    }
}

// MARK: - Events and auth

/// Something the server sends a notification about. A plain string underneath,
/// so an event a newer server saved round-trips through an edit unchanged.
struct NotificationEventName: RawRepresentable, Codable, Hashable, Sendable {
    var rawValue: String

    init(rawValue: String) { self.rawValue = rawValue }

    /// A request found versions and the reader who asked may not pick one.
    static let requestNeedsChooser = NotificationEventName(rawValue: "request_needs_chooser")
}

/// How the server signs in to an ntfy server.
enum NtfyAuth: Hashable, Sendable {
    case none, token, basic
    /// A mode a newer server saved; its connection is shown, never edited.
    case unknown(String)

    /// The modes the form offers.
    static let choices: [NtfyAuth] = [.none, .token, .basic]

    init(rawValue: String) {
        switch rawValue {
        case "none": self = .none
        case "token": self = .token
        case "basic": self = .basic
        default: self = .unknown(rawValue)
        }
    }

    var rawValue: String {
        switch self {
        case .none: "none"
        case .token: "token"
        case .basic: "basic"
        case let .unknown(name): name
        }
    }
}

extension NtfyAuth: Codable {
    init(from decoder: Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

// MARK: - What the server returns

/// An ntfy connection's settings as the server returns them: never a secret.
struct NtfySettingsStatus: Codable, Hashable, Sendable {
    var serverURL: String
    var topic: String
    var auth: NtfyAuth
    var username: String?
    var tokenSet: Bool
    var passwordSet: Bool
    var priority: Int
    var tags: [String]
    var includeDetails: Bool

    enum CodingKeys: String, CodingKey {
        case topic, auth, username, priority, tags
        case serverURL = "server_url"
        case tokenSet = "token_set"
        case passwordSet = "password_set"
        case includeDetails = "include_details"
    }
}

/// A connection's provider settings, tagged by `kind`.
enum ConnectionSettingsStatus: Hashable, Sendable {
    case ntfy(NtfySettingsStatus)
    /// A provider this build doesn't know; shown, never edited.
    case unknown(kind: String)

    var kind: String {
        switch self {
        case .ntfy: "ntfy"
        case let .unknown(kind): kind
        }
    }
}

extension ConnectionSettingsStatus: Codable {
    private enum KindKey: String, CodingKey { case kind }

    init(from decoder: Decoder) throws {
        let kind = try decoder.container(keyedBy: KindKey.self).decode(String.self, forKey: .kind)
        switch kind {
        case "ntfy": self = .ntfy(try NtfySettingsStatus(from: decoder))
        default: self = .unknown(kind: kind)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: KindKey.self)
        try container.encode(kind, forKey: .kind)
        if case let .ntfy(settings) = self { try settings.encode(to: encoder) }
    }
}

/// How the most recent notification a connection finished with went.
struct NotificationLastDelivery: Codable, Hashable, Sendable {
    /// Unix seconds.
    var at: Int64
    var ok: Bool
    /// Why it was given up on; nil when `ok`.
    var error: String?
}

struct NotificationConnection: Codable, Hashable, Sendable, Identifiable {
    var id: Int64
    var name: String
    var enabled: Bool
    var events: [NotificationEventName]
    var settings: ConnectionSettingsStatus
    /// Nil until a real notification has finished; a test never sets it.
    var lastDelivery: NotificationLastDelivery?

    enum CodingKeys: String, CodingKey {
        case id, name, enabled, events, settings
        case lastDelivery = "last_delivery"
    }
}

/// Every connection, sorted by name, and the events this server offers now.
struct NotificationConnections: Codable, Hashable, Sendable {
    var connections: [NotificationConnection]
    /// Empty while book requests are off.
    var availableEvents: [NotificationEventName]

    enum CodingKeys: String, CodingKey {
        case connections
        case availableEvents = "available_events"
    }
}

// MARK: - What the app sends

/// An ntfy connection's settings as the app sends them.
struct NtfySettingsInput: Encodable, Hashable, Sendable {
    var serverURL: String
    var topic: String
    var auth: NtfyAuth
    /// Sent only for `basic`.
    var username: String?
    /// Nil leaves the key out, which keeps the saved token.
    var token: String?
    /// Nil leaves the key out, which keeps the saved password.
    var password: String?
    var priority: Int
    var tags: [String]
    var includeDetails: Bool

    enum CodingKeys: String, CodingKey {
        case kind, topic, auth, username, token, password, priority, tags
        case serverURL = "server_url"
        case includeDetails = "include_details"
    }

    // `encodeIfPresent`, never `encode(nil)`: a null secret would also keep the
    // saved one, but a missing key is the contract's first choice.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("ntfy", forKey: .kind)
        try container.encode(serverURL, forKey: .serverURL)
        try container.encode(topic, forKey: .topic)
        try container.encode(auth, forKey: .auth)
        try container.encodeIfPresent(username, forKey: .username)
        try container.encodeIfPresent(token, forKey: .token)
        try container.encodeIfPresent(password, forKey: .password)
        try container.encode(priority, forKey: .priority)
        try container.encode(tags, forKey: .tags)
        try container.encode(includeDetails, forKey: .includeDetails)
    }
}

/// A connection's provider settings as the app sends them; `kind` names the provider.
enum ConnectionSettingsInput: Encodable, Hashable, Sendable {
    case ntfy(NtfySettingsInput)

    func encode(to encoder: Encoder) throws {
        switch self {
        case let .ntfy(settings): try settings.encode(to: encoder)
        }
    }
}

/// A connection to create, or everything to replace a saved one with. A create
/// leaves `enabled` out, so every server starts it on; a save sends the saved
/// connection's confirmed value, so a server that reads a missing one as on
/// keeps it. Only the row's switch changes it.
struct NotificationConnectionInput: Encodable, Hashable, Sendable {
    var name: String
    var enabled: Bool?
    var events: [NotificationEventName]
    var settings: ConnectionSettingsInput

    enum CodingKeys: String, CodingKey { case name, enabled, events, settings }

    // A missing key, never null: a server that predates the optional field refuses null.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(enabled, forKey: .enabled)
        try container.encode(events, forKey: .events)
        try container.encode(settings, forKey: .settings)
    }
}

/// Turns a saved connection on or off, and changes nothing else about it.
struct NotificationConnectionEnabled: Encodable, Hashable, Sendable {
    var enabled: Bool
}

/// Settings to send a test with. `id` names the saved connection whose secrets
/// fill in the ones `settings` leaves out.
struct NotificationTest: Encodable, Hashable, Sendable {
    var id: Int64?
    var settings: ConnectionSettingsInput

    enum CodingKeys: String, CodingKey { case id, settings }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(id, forKey: .id)
        try container.encode(settings, forKey: .settings)
    }
}
