//  NotificationsModel.swift
//  The Notifications screen's state and the add/edit sheet's, behind an API
//  seam of closures so every transition is tested without a server.
//
//  Instance configuration under rule 08: every write goes straight to the
//  server and nothing is queued, so a failed one says so and puts the screen
//  back rather than claim a change that exists nowhere.

import Foundation
import Observation

/// The calls the Notifications screens make, as closures so tests can hand in a fake.
struct NotificationsAPI: Sendable {
    var publicURL: @Sendable () async throws -> PublicURLStatus
    var setPublicURL: @Sendable (String?) async throws -> PublicURLStatus
    var connections: @Sendable () async throws -> NotificationConnections
    var create: @Sendable (NotificationConnectionInput) async throws -> NotificationConnection
    var update: @Sendable (Int64, NotificationConnectionInput) async throws -> NotificationConnection
    var delete: @Sendable (Int64) async throws -> Void
    var test: @Sendable (NotificationTest) async throws -> Void

    static let live = NotificationsAPI(
        publicURL: { try await NotificationService.publicURL() },
        setPublicURL: { try await NotificationService.setPublicURL($0) },
        connections: { try await NotificationService.connections() },
        create: { try await NotificationService.create($0) },
        update: { try await NotificationService.update(id: $0, $1) },
        delete: { try await NotificationService.delete(id: $0) },
        test: { try await NotificationService.test($0) }
    )
}

@Observable @MainActor
final class NotificationsModel {
    /// Nil until the first read answers.
    private(set) var publicURL: PublicURLStatus?
    /// What the field holds. Editing it clears the last save's outcome.
    var publicURLText = "" {
        didSet {
            guard publicURLText != oldValue else { return }
            publicURLError = nil
            publicURLSaved = false
        }
    }
    private(set) var publicURLError: String?
    private(set) var isSavingPublicURL = false
    /// True from a landed save until the field is edited again.
    private(set) var publicURLSaved = false

    /// Nil until the first read answers.
    private(set) var list: NotificationConnections?
    /// Why the first read failed; shown only while nothing else is on screen.
    private(set) var failure: String?
    /// Connections whose switch is saving.
    private(set) var toggling: Set<Int64> = []
    /// A row's failed switch, by connection.
    private(set) var rowErrors: [Int64: String] = [:]

    /// The field's value as last seeded, so a refresh doesn't overwrite typing.
    private var seededText = ""
    let api: NotificationsAPI

    init(api: NotificationsAPI = .live) {
        self.api = api
    }

    var isLoaded: Bool { publicURL != nil && list != nil }
    /// Whether the field differs from what the server last said, so there is something to save.
    var isPublicURLEdited: Bool { publicURLText != seededText }
    var connections: [NotificationConnection] { list?.connections ?? [] }
    var availableEvents: [NotificationEventName] { list?.availableEvents ?? [] }

    /// Reads the URL and the connections together. A failure shows only while
    /// nothing is on screen; a failed refresh leaves the screen as it was.
    func load() async {
        do {
            async let status = api.publicURL()
            async let connections = api.connections()
            let (freshStatus, freshList) = try await (status, connections)
            seed(freshStatus)
            list = freshList
            failure = nil
        } catch {
            if !isLoaded { failure = NotificationsFlow.message(error) }
        }
    }

    // MARK: - Public URL

    /// Saves what the field holds; a blank field clears the saved URL.
    func savePublicURL() async {
        await writePublicURL(publicURLText.nilIfBlank)
    }

    func clearPublicURL() async {
        await writePublicURL(nil)
    }

    /// A refusal keeps what was typed and shows the server's reason under it.
    private func writePublicURL(_ url: String?) async {
        guard !isSavingPublicURL else { return }
        isSavingPublicURL = true
        defer { isSavingPublicURL = false }
        do {
            let status = try await api.setPublicURL(url)
            publicURL = status
            seededText = Self.fieldText(status)
            publicURLText = seededText
            publicURLSaved = true
        } catch {
            publicURLError = NotificationsFlow.message(error)
        }
    }

    /// Only a value saved here fills the field: an environment value isn't one to edit.
    static func fieldText(_ status: PublicURLStatus) -> String {
        status.source == .settings ? status.url ?? "" : ""
    }

    private func seed(_ status: PublicURLStatus) {
        publicURL = status
        let next = Self.fieldText(status)
        // Untouched since the last seed, so it follows the server.
        if publicURLText == seededText { publicURLText = next }
        seededText = next
    }

    // MARK: - Connections

    /// Turns a connection on or off in place; a refusal turns it back and says why.
    func setEnabled(_ connection: NotificationConnection, _ enabled: Bool) async {
        guard !toggling.contains(connection.id),
              let input = NtfyDraft.toggled(connection, enabled: enabled)
        else { return }
        toggling.insert(connection.id)
        rowErrors[connection.id] = nil
        replace(connection.id) { $0.enabled = enabled }
        do {
            upsert(try await api.update(connection.id, input))
        } catch {
            replace(connection.id) { $0.enabled = connection.enabled }
            rowErrors[connection.id] = NotificationsFlow.message(error)
        }
        toggling.remove(connection.id)
    }

    /// Deletes a connection. Answers why it couldn't, or nil once it is gone.
    func delete(id: Int64) async -> String? {
        do {
            try await api.delete(id)
            remove(id: id)
            return nil
        } catch {
            return NotificationsFlow.message(error)
        }
    }

    /// Puts a saved connection on the list, kept in the server's name order.
    func upsert(_ connection: NotificationConnection) {
        guard var current = list else { return }
        current.connections.removeAll { $0.id == connection.id }
        current.connections.append(connection)
        current.connections.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        list = current
        rowErrors[connection.id] = nil
    }

    func remove(id: Int64) {
        list?.connections.removeAll { $0.id == id }
        rowErrors[id] = nil
    }

    private func replace(_ id: Int64, _ change: (inout NotificationConnection) -> Void) {
        guard var current = list,
              let index = current.connections.firstIndex(where: { $0.id == id })
        else { return }
        change(&current.connections[index])
        list = current
    }
}

/// Where a test send stands.
enum NtfyTestState: Equatable, Sendable {
    case idle, sending, sent
    case failed(String)
}

/// The add/edit sheet: the form, and its save and test.
@Observable @MainActor
final class NtfySheetModel {
    /// The form as it opened, to tell whether anything changed.
    let original: NtfyDraft
    /// Editing the form clears a save's error and a finished test's result,
    /// which spoke for other values.
    var draft: NtfyDraft {
        didSet {
            guard draft != oldValue else { return }
            saveError = nil
            if testState != .sending { testState = .idle }
        }
    }
    private(set) var isSaving = false
    private(set) var saveError: String?
    private(set) var testState: NtfyTestState = .idle

    private let api: NotificationsAPI

    init(draft: NtfyDraft, api: NotificationsAPI = .live) {
        original = draft
        self.draft = draft
        self.api = api
    }

    var isDirty: Bool { draft != original }
    var canSave: Bool { !isSaving && draft.saveIssue == nil }
    var canTest: Bool { testState != .sending && draft.settingsIssue == nil }

    /// Creates or replaces the connection. Answers what the server saved, or nil
    /// with `saveError` set to its reason.
    func save() async -> NotificationConnection? {
        guard canSave else { return nil }
        isSaving = true
        defer { isSaving = false }
        let input = draft.input
        do {
            if let id = draft.savedID {
                return try await api.update(id, input)
            }
            return try await api.create(input)
        } catch {
            saveError = NotificationsFlow.message(error)
            return nil
        }
    }

    /// Sends a sample through the form's current values and saves nothing. A
    /// result that lands after the form changed is dropped.
    func test() async {
        guard canTest else { return }
        let sent = draft
        testState = .sending
        let outcome: NtfyTestState
        do {
            try await api.test(sent.testRequest)
            outcome = .sent
        } catch {
            outcome = .failed(NotificationsFlow.message(error))
        }
        testState = draft == sent ? outcome : .idle
    }
}
