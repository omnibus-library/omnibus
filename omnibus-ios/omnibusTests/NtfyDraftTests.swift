//  NtfyDraftTests.swift
//  The ntfy sheet's form rules: what a new and an edited form open with, when
//  it may be tested and saved, how tags are read, and that an event the
//  server no longer offers is kept rather than dropped.

import Foundation
import Testing

@testable import omnibus

/// The server's sentence for an ntfy 403, exactly as the contract writes it.
private let forbiddenSentence =
    "ntfy didn't let this sign-in post to the topic. Check that the token or account can write to it."

/// A form that passes every check, to break one field at a time.
private func valid() -> NtfyDraft {
    var draft = NtfyDraft(offering: [.requestNeedsChooser])
    draft.name = "Phone"
    draft.serverURL = "https://ntfy.sh"
    draft.topic = "books"
    return draft
}

@Suite("ntfy form")
struct NtfyDraftTests {
    @Test("a new form is sent every offered event, signs in with nothing, and starts at Default")
    func newFormDefaults() {
        let draft = NtfyDraft(offering: [.requestNeedsChooser])
        #expect(!draft.isEditing)
        #expect(draft.events == [.requestNeedsChooser])
        #expect(draft.auth == .none)
        #expect(draft.priority == 3)
        #expect(NotificationsFlow.priorityName(draft.priority) == "Default")
        #expect(draft.includeDetails)
        #expect(draft.testRequest.id == nil)
    }

    @Test("an edit opens with both secrets blank and remembers which are saved")
    func editOpensWithBlankSecrets() throws {
        let saved = try savedConnections()
        let token = try #require(NtfyDraft(editing: saved[0]))
        #expect(token.isEditing)
        #expect(token.token.isEmpty)
        #expect(token.password.isEmpty)
        #expect(token.keepsSavedToken)
        #expect(!token.keepsSavedPassword)
        #expect(token.tags == "books, bell")
        #expect(token.priority == 4)

        let basic = try #require(NtfyDraft(editing: saved[1]))
        #expect(basic.username == "sam")
        #expect(basic.keepsSavedPassword)
        #expect(!basic.includeDetails)
    }

    @Test("a provider this build doesn't know opens no form")
    func unknownKindOpensNoForm() throws {
        #expect(NtfyDraft(editing: try savedConnections()[3]) == nil)
    }

    @Test("a complete form may be saved and tested")
    func validFormPasses() {
        #expect(valid().saveIssue == nil)
        #expect(valid().settingsIssue == nil)
    }

    @Test("a form needs a name, an address and a topic to save")
    func requiredFields() {
        var draft = valid()
        draft.name = "   "
        #expect(draft.saveIssue == "Add a name.")
        // A test needs no name: nothing is saved.
        #expect(draft.settingsIssue == nil)

        draft = valid()
        draft.name = String(repeating: "a", count: NtfyDraft.nameLimit + 1)
        #expect(draft.saveIssue?.contains("100") == true)

        draft = valid()
        draft.serverURL = ""
        #expect(draft.settingsIssue == "Add the ntfy server\u{2019}s address.")
        #expect(draft.saveIssue == draft.settingsIssue)

        draft = valid()
        draft.topic = " "
        #expect(draft.settingsIssue == "Add a topic.")
    }

    @Test("token sign-in needs a token unless one is saved for it")
    func tokenRequiredWithoutASavedOne() throws {
        var draft = valid()
        draft.auth = .token
        #expect(draft.settingsIssue == "Add an access token.")
        draft.token = "   "
        #expect(draft.settingsIssue == "Add an access token.")
        draft.token = "tk"
        #expect(draft.settingsIssue == nil)

        let edit = try #require(NtfyDraft(editing: try savedConnections()[0]))
        #expect(edit.saveIssue == nil)
    }

    @Test("a saved token is kept only while the form signs in with a token")
    func savedTokenFollowsTheMode() throws {
        var draft = try #require(NtfyDraft(editing: try savedConnections()[0]))
        draft.auth = .basic
        draft.username = "ada"
        #expect(!draft.keepsSavedToken)
        // The saved connection has no password: switching mode drops the old secret server-side.
        #expect(draft.settingsIssue == "Add a password.")
        draft.auth = .token
        #expect(draft.keepsSavedToken)
        #expect(draft.settingsIssue == nil)
    }

    @Test("a changed server URL stops keeping the saved token until it is typed again or the URL goes back")
    func changedURLAsksForTheTokenAgain() throws {
        var draft = try #require(NtfyDraft(editing: try savedConnections()[0]))
        #expect(draft.tokenState == .kept)

        draft.serverURL = "https://ntfy.example.org"
        #expect(draft.tokenState == .reenter(because: "the server URL changed"))
        #expect(!draft.keepsSavedToken)
        #expect(draft.settingsIssue == "Enter the access token again: the server URL changed.")
        #expect(draft.saveIssue == draft.settingsIssue)
        #expect(NtfyConnectionSheet.secretPlaceholder(draft.tokenState) == "Enter it again")

        draft.token = "tk_again"
        #expect(draft.settingsIssue == nil)
        #expect(draft.settings.token == "tk_again")
        #expect(draft.testRequest.settings == .ntfy(draft.settings))

        // Back to the saved address, spaces aside: blank keeps it once more.
        draft.token = ""
        draft.serverURL = " https://ntfy.sh "
        #expect(draft.tokenState == .kept)
        #expect(draft.settingsIssue == nil)
        #expect(draft.settings.token == nil)
        #expect(NtfyConnectionSheet.secretPlaceholder(draft.tokenState) == "Saved \u{2014} leave blank to keep")
    }

    @Test("a changed server URL or username stops keeping the saved password")
    func changedURLOrUsernameAsksForThePasswordAgain() throws {
        var draft = try #require(NtfyDraft(editing: try savedConnections()[1]))
        #expect(draft.passwordState == .kept)

        draft.username = "ada"
        #expect(draft.passwordState == .reenter(because: "the username changed"))
        #expect(draft.settingsIssue == "Enter the password again: the username changed.")
        draft.password = "pw2"
        #expect(draft.settingsIssue == nil)
        #expect(draft.settings.password == "pw2")

        draft.password = ""
        draft.username = " sam "
        #expect(draft.passwordState == .kept)

        // A trailing slash is a different address to the server, so it asks too.
        draft.serverURL = "https://example.com/ntfy/"
        #expect(draft.passwordState == .reenter(because: "the server URL changed"))
        #expect(draft.settingsIssue == "Enter the password again: the server URL changed.")
    }

    @Test("a new form has no saved secret to keep")
    func newFormHasNothingSaved() {
        var draft = valid()
        draft.auth = .token
        #expect(draft.tokenState == .none)
        #expect(NtfyConnectionSheet.secretPlaceholder(draft.tokenState).isEmpty)
    }

    @Test("basic sign-in needs a username, and a password unless one is saved")
    func basicRequirements() throws {
        var draft = valid()
        draft.auth = .basic
        draft.password = "pw"
        #expect(draft.settingsIssue == "Add a username.")
        draft.username = "sam"
        #expect(draft.settingsIssue == nil)
        draft.password = ""
        #expect(draft.settingsIssue == "Add a password.")

        var edit = try #require(NtfyDraft(editing: try savedConnections()[1]))
        #expect(edit.settingsIssue == nil)
        edit.username = ""
        #expect(edit.settingsIssue == "Add a username.")
    }

    @Test("tags are read comma by comma, trimmed, with blanks dropped")
    func tagsParsing() {
        var draft = valid()
        draft.tags = " books, ,bell ,, warning "
        #expect(draft.tagList == ["books", "bell", "warning"])
        #expect(draft.settings.tags == ["books", "bell", "warning"])
        draft.tags = ""
        #expect(draft.tagList.isEmpty)
    }

    @Test("an event the server no longer offers is listed after the offered ones and still sent")
    func unofferedEventIsKept() throws {
        let saved = try savedConnections()[3]
        var connection = try savedConnections()[0]
        connection.events = saved.events
        var draft = try #require(NtfyDraft(editing: connection))
        let unknown = NotificationEventName(rawValue: "something_new")

        #expect(draft.eventChoices(available: [.requestNeedsChooser]) == [.requestNeedsChooser, unknown])
        #expect(draft.input.events == [unknown])
        #expect(NotificationsFlow.eventLabel(unknown) == "Something new")

        draft.setEvent(.requestNeedsChooser, on: true)
        draft.setEvent(.requestNeedsChooser, on: true)
        #expect(draft.events == [unknown, .requestNeedsChooser])
        draft.setEvent(unknown, on: false)
        #expect(draft.events == [.requestNeedsChooser])
        // Off, it is no longer offered at all.
        #expect(draft.eventChoices(available: []) == [.requestNeedsChooser])
    }

    @Test("events read in plain words and priorities by ntfy's names")
    func labels() {
        #expect(NotificationsFlow.eventLabel(.requestNeedsChooser) == "A request needs a version picked")
        #expect(NotificationsFlow.priorities.map(NotificationsFlow.priorityName) == ["Min", "Low", "Default", "High", "Urgent"])
    }

    @Test("a row says where a connection posts, without the scheme")
    func rowDetail() throws {
        let saved = try savedConnections()
        #expect(NotificationsFlow.detail(saved[0]) == "ntfy \u{00B7} ntfy.sh/books")
        #expect(NotificationsFlow.detail(saved[1]) == "ntfy \u{00B7} example.com/ntfy/den")
        #expect(NotificationsFlow.detail(saved[2]) == "ntfy \u{00B7} 10.0.0.2:8080/t")
        #expect(NotificationsFlow.detail(saved[3]).hasPrefix("gotify \u{00B7} "))
        // A sub-path reads the same with or without the slash the admin typed.
        #expect(NotificationsFlow.endpoint(serverURL: "https://example.com/ntfy/", topic: "den") == "example.com/ntfy/den")
        #expect(NotificationsFlow.endpoint(serverURL: "https://ntfy.sh/", topic: "books") == "ntfy.sh/books")
    }

    @Test("a row's last delivery says none yet, when it was delivered, or when and why it failed")
    func deliveryLine() {
        let now = Date(timeIntervalSince1970: 1_790_003_600)
        #expect(NotificationsFlow.delivery(nil, now: now) == DeliveryLine(text: "Nothing sent yet", tone: .quiet))

        let delivered = NotificationsFlow.delivery(NotificationLastDelivery(at: 1_790_000_000, ok: true), now: now)
        #expect(delivered.tone == .ok)
        #expect(delivered.text == "Delivered \(Format.relative(unix: 1_790_000_000, relativeTo: now))")
        #expect(delivered.error == nil)

        let failed = NotificationsFlow.delivery(
            NotificationLastDelivery(at: 1_790_000_000, ok: false, error: forbiddenSentence), now: now
        )
        #expect(failed.tone == .bad)
        #expect(failed.text.hasPrefix("Failed "))
        // The server's sentence, untouched.
        #expect(failed.error == forbiddenSentence)
    }

    @Test("the public URL's source is said in plain words")
    func sourceLine() {
        #expect(NotificationsFlow.sourceLine(PublicURLStatus(url: "https://a.example", source: .settings)) == "Saved here.")
        #expect(NotificationsFlow.sourceLine(PublicURLStatus(url: "https://e.example", source: .env)).contains("https://e.example"))
        #expect(NotificationsFlow.sourceLine(PublicURLStatus(url: nil, source: .none)) == "Not set.")
    }
}
