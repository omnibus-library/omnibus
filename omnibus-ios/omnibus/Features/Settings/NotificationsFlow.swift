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

    /// Where the URL in effect comes from.
    static func sourceLine(_ status: PublicURLStatus) -> String {
        switch status.source {
        case .settings: "Saved here."
        case .env:
            "In use: \(status.url ?? "none"), from the server\u{2019}s environment. Saving one here takes its place."
        case .none: "Not set."
        }
    }

    /// "ntfy · ntfy.sh/books": the provider, then where it posts.
    static func detail(_ connection: NotificationConnection) -> String {
        switch connection.settings {
        case let .ntfy(settings):
            "ntfy \u{00B7} \(endpoint(serverURL: settings.serverURL, topic: settings.topic))"
        case let .unknown(kind):
            "\(kind) \u{00B7} update the app to change it"
        }
    }

    /// The server's host and any sub-path, then the topic, without the scheme.
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

    /// An error in the words the screen shows: the server's own text for a
    /// refused value (422) or a provider's answer (502).
    static func message(_ error: Error) -> String {
        switch error as? APIError {
        case .http(status: 404, _)?:
            "That connection is gone. Pull down to refresh the list."
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
