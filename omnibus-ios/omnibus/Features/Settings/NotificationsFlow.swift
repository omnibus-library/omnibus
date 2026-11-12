//  NotificationsFlow.swift
//  What the Notifications screen says, decided apart from the views so it can
//  be tested without one: event and priority names, where the public URL
//  comes from, a connection's one-line address, its last delivery, and the
//  words an error is shown in.

import Foundation

/// How a line of the screen is coloured.
enum NotificationTone: Equatable, Sendable {
    case ok, bad, quiet
}

/// A connection's last delivery as its row shows it.
struct DeliveryLine: Equatable, Sendable {
    var text: String
    var tone: NotificationTone
    /// The provider's answer to a failed delivery, shown under the line.
    var error: String?
}

enum NotificationsFlow {
    /// ntfy's own names for its five priorities, lowest first.
    static let priorities = Array(1...5)

    static func priorityName(_ priority: Int) -> String {
        switch priority {
        case 1: "Min"
        case 2: "Low"
        case 4: "High"
        case 5: "Urgent"
        default: "Default"
        }
    }

    /// An event in plain words; one this build doesn't know reads as its own name.
    static func eventLabel(_ event: NotificationEventName) -> String {
        switch event {
        case .requestNeedsChooser: "A request needs a version picked"
        default:
            event.rawValue.replacingOccurrences(of: "_", with: " ").capitalizedFirst
        }
    }

    static let publicURLExplainer =
        "Links in notifications open the request at this address. Without one, notifications still send, with no link."

    /// Where the URL in effect comes from. A source this build doesn't know claims none.
    static func sourceLine(_ status: PublicURLStatus) -> String {
        switch status.source {
        case .settings: "Saved here."
        case .env:
            "In use: \(status.url ?? "none"), from the server\u{2019}s environment. Saving one here takes its place."
        case .none: "Not set."
        case .unknown: status.url == nil ? "Not set." : "Set."
        }
    }

    /// Whether a connection can be edited and switched here: a provider and
    /// sign-in mode this build knows. Any other is shown, and may be deleted.
    static func isEditable(_ connection: NotificationConnection) -> Bool {
        NtfyDraft(editing: connection) != nil
    }

    /// "ntfy · ntfy.sh/books": the provider, then where it posts.
    static func detail(_ connection: NotificationConnection) -> String {
        switch connection.settings {
        case let .ntfy(settings):
            if case .unknown = settings.auth {
                "ntfy \u{00B7} \(endpoint(serverURL: settings.serverURL, topic: settings.topic)) \u{00B7} update the app to change it"
            } else {
                "ntfy \u{00B7} \(endpoint(serverURL: settings.serverURL, topic: settings.topic))"
            }
        case let .unknown(kind):
            "\(kind) \u{00B7} update the app to change it"
        }
    }

    /// The server's host and any sub-path, then the topic, without the scheme.
    /// A sub-path is shown the same with or without its trailing slash.
    static func endpoint(serverURL: String, topic: String) -> String {
        let base: String
        if let parts = URLComponents(string: serverURL), let host = parts.host, !host.isEmpty {
            let port = parts.port.map { ":\($0)" } ?? ""
            base = host + port + parts.path
        } else {
            base = serverURL.replacingOccurrences(of: "https://", with: "")
                .replacingOccurrences(of: "http://", with: "")
        }
        let trimmed = base.hasSuffix("/") ? String(base.dropLast()) : base
        return "\(trimmed)/\(topic)"
    }

    static func delivery(_ last: NotificationLastDelivery?, now: Date = Date()) -> DeliveryLine {
        guard let last else { return DeliveryLine(text: "Nothing sent yet", tone: .quiet) }
        let when = Format.relative(unix: last.at, relativeTo: now)
        if last.ok { return DeliveryLine(text: "Delivered \(when)", tone: .ok) }
        return DeliveryLine(text: "Failed \(when)", tone: .bad, error: last.error?.nilIfBlank)
    }

    /// Where an error is shown, which decides what a 404 means.
    enum Place: Sendable {
        /// The screen's first read: a 404 is a server without these routes.
        case load
        /// A row of the list: a 404 is a connection deleted elsewhere.
        case list
        /// The add/edit sheet, where there is no list to refresh.
        case sheet
    }

    /// Whether the answer is a 404: the route, or the connection, isn't there.
    static func isGone(_ error: Error) -> Bool {
        if case .http(status: 404, _)? = error as? APIError { return true }
        return false
    }

    /// An error in the words the screen shows: the server's own text for a
    /// refused value (422) or a provider's answer (502).
    static func message(_ error: Error, in place: Place = .list) -> String {
        switch error as? APIError {
        case .http(status: 404, _)?:
            switch place {
            case .load: "Notifications aren\u{2019}t available on this server. Updating the server adds them."
            case .list: "That connection was deleted elsewhere."
            case .sheet: "This connection was deleted elsewhere."
            }
        case .http(status: 403, _)?:
            "Only an admin can change notification settings."
        case let api?:
            api.errorDescription ?? "Something went wrong."
        case nil:
            error.localizedDescription
        }
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
