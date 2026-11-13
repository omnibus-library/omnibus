//  NtfyDraft.swift
//  The ntfy add/edit sheet's form as plain values, and the one place it turns
//  into what is sent. Pure, so the secret rules are tested without a view.
//
//  A saved token or password never comes back from the server, so an edit
//  opens with both fields blank and remembers only whether each is set. Blank
//  then means "keep it": the key is left out of what is sent. The server keeps
//  a secret only for the address (and username) it was saved with, so editing
//  either asks for it again.

import Foundation

/// What a blank secret field means.
enum SavedSecret: Equatable, Sendable {
    /// Nothing saved for this sign-in mode: it must be typed.
    case none
    /// Saved, and left blank it is kept.
    case kept
    /// Saved, but the server won't keep it, for the reason given: it must be typed again.
    case reenter(because: String)
}

struct NtfyDraft: Equatable, Sendable {
    var name = ""
    var serverURL = ""
    var topic = ""
    var auth: NtfyAuth = .none
    var username = ""
    var token = ""
    var password = ""
    var priority = 3
    /// Comma-separated, as typed.
    var tags = ""
    var includeDetails = true
    var events: [NotificationEventName] = []

    /// The saved connection this edits; nil for a new one.
    private(set) var savedID: Int64?
    /// Whether the saved connection holds a token, or a password.
    private(set) var tokenSaved = false
    private(set) var passwordSaved = false
    /// The address and username the saved secret belongs to.
    private(set) var savedServerURL: String?
    private(set) var savedUsername: String?
    /// The saved connection's confirmed on/off value, echoed on save; never edited here.
    private(set) var savedEnabled: Bool?

    static let nameLimit = 100

    /// A new connection, sent every event the server offers.
    init(offering available: [NotificationEventName]) {
        events = available
    }

    /// An edit of `connection` with both secrets blank; nil for a provider or
    /// sign-in mode this build doesn't know, which is never edited or resent.
    init?(editing connection: NotificationConnection) {
        guard case let .ntfy(settings) = connection.settings,
              NtfyAuth.choices.contains(settings.auth)
        else { return nil }
        savedID = connection.id
        savedServerURL = settings.serverURL
        savedUsername = settings.username
        savedEnabled = connection.enabled
        name = connection.name
        events = connection.events
        serverURL = settings.serverURL
        topic = settings.topic
        auth = settings.auth
        username = settings.username ?? ""
        tokenSaved = settings.tokenSet
        passwordSaved = settings.passwordSet
        priority = settings.priority
        tags = settings.tags.joined(separator: ", ")
        includeDetails = settings.includeDetails
    }

    var isEditing: Bool { savedID != nil }

    /// What a blank token field means. A token exists only while token auth was
    /// saved (the server drops it on a switch of mode), and is kept only for the
    /// address it was saved with.
    var tokenState: SavedSecret {
        guard auth == .token, tokenSaved else { return .none }
        return addressChanged ? .reenter(because: "the server URL changed") : .kept
    }

    /// What a blank password field means: kept only for the saved address and username.
    var passwordState: SavedSecret {
        guard auth == .basic, passwordSaved else { return .none }
        if addressChanged { return .reenter(because: "the server URL changed") }
        if username.trimmingCharacters(in: .whitespacesAndNewlines) != (savedUsername ?? "") {
            return .reenter(because: "the username changed")
        }
        return .kept
    }

    var keepsSavedToken: Bool { tokenState == .kept }
    var keepsSavedPassword: Bool { passwordState == .kept }

    /// Whether the address differs from the one the saved secret belongs to.
    private var addressChanged: Bool {
        serverURL.trimmingCharacters(in: .whitespacesAndNewlines) != (savedServerURL ?? "")
    }

    /// The tags typed, trimmed, blanks dropped.
    var tagList: [String] {
        tags.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    // MARK: - Checks

    /// Why the settings can't be sent, even as a test; nil when they can.
    var settingsIssue: String? {
        if serverURL.isBlank { return "Add the ntfy server\u{2019}s address." }
        if topic.isBlank { return "Add a topic." }
        switch auth {
        case .none: return nil
        case .token:
            return token.isBlank ? Self.missing("an access token", "access token", tokenState) : nil
        case .basic:
            if username.isBlank { return "Add a username." }
            return password.isBlank ? Self.missing("a password", "password", passwordState) : nil
        case .unknown: return "This sign-in can\u{2019}t be changed in this version of the app."
        }
    }

    /// A blank secret's issue; nil when the saved one is kept.
    private static func missing(_ some: String, _ noun: String, _ state: SavedSecret) -> String? {
        switch state {
        case .kept: nil
        case .none: "Add \(some)."
        case let .reenter(reason): "Enter the \(noun) again: \(reason)."
        }
    }

    /// Why the connection can't be saved; nil when it can.
    var saveIssue: String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Add a name." }
        if trimmed.count > Self.nameLimit { return "A name can be up to \(Self.nameLimit) characters." }
        return settingsIssue
    }

    // MARK: - What is sent

    /// A blank secret, or one the auth mode doesn't use, is left out.
    var settings: NtfySettingsInput {
        NtfySettingsInput(
            serverURL: serverURL.trimmingCharacters(in: .whitespacesAndNewlines),
            topic: topic.trimmingCharacters(in: .whitespacesAndNewlines),
            auth: auth,
            username: auth == .basic ? username.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
            token: auth == .token && !token.isBlank
                ? token.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
            password: auth == .basic && !password.isBlank ? password : nil,
            priority: priority,
            tags: tagList,
            includeDetails: includeDetails
        )
    }

    var input: NotificationConnectionInput {
        NotificationConnectionInput(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            enabled: savedEnabled,
            events: events,
            settings: .ntfy(settings)
        )
    }

    /// The sheet's current values, naming the saved connection so a secret left blank falls back to it.
    var testRequest: NotificationTest {
        NotificationTest(id: savedID, settings: .ntfy(settings))
    }

    // MARK: - Events

    /// What the sheet offers a switch for: every event the server offers, then
    /// any this connection is sent that it doesn't offer now, so none is lost.
    func eventChoices(available: [NotificationEventName]) -> [NotificationEventName] {
        available + events.filter { !available.contains($0) }
    }

    mutating func setEvent(_ event: NotificationEventName, on: Bool) {
        if on {
            if !events.contains(event) { events.append(event) }
        } else {
            events.removeAll { $0 == event }
        }
    }
}

private extension String {
    var isBlank: Bool { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}
