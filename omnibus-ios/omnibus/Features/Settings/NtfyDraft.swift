//  NtfyDraft.swift
//  The ntfy add/edit sheet's form as plain values, and the one place it turns
//  into what is sent. Pure, so the secret rules are tested without a view.
//
//  A saved token or password never comes back from the server, so an edit
//  opens with both fields blank and remembers only whether each is set. Blank
//  then means "keep it": the key is left out of what is sent. A turn of a
//  row's switch goes through here too, carrying no secret at all.

import Foundation

struct NtfyDraft: Equatable, Sendable {
    var name = ""
    var enabled = true
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

    static let nameLimit = 100

    /// A new connection, sent every event the server offers.
    init(offering available: [NotificationEventName]) {
        events = available
    }

    /// An edit of `connection` with both secrets blank; nil for a provider this build doesn't know.
    init?(editing connection: NotificationConnection) {
        guard case let .ntfy(settings) = connection.settings else { return nil }
        savedID = connection.id
        name = connection.name
        enabled = connection.enabled
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

    /// Whether a blank token field keeps the saved token. Only a token saved for
    /// token auth survives: the server drops it on a switch to another mode.
    var keepsSavedToken: Bool { auth == .token && tokenSaved }
    var keepsSavedPassword: Bool { auth == .basic && passwordSaved }

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
            return token.isBlank && !keepsSavedToken ? "Add an access token." : nil
        case .basic:
            if username.isBlank { return "Add a username." }
            return password.isBlank && !keepsSavedPassword ? "Add a password." : nil
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
            enabled: enabled,
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

    /// What turning a saved connection on or off sends: everything as saved and
    /// no secret, so both are kept. Nil for a provider this build doesn't know.
    static func toggled(_ connection: NotificationConnection, enabled: Bool) -> NotificationConnectionInput? {
        guard var draft = NtfyDraft(editing: connection) else { return nil }
        draft.enabled = enabled
        return draft.input
    }
}

private extension String {
    var isBlank: Bool { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}
