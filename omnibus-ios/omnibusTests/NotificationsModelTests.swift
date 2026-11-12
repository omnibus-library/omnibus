//  NotificationsModelTests.swift
//  The Notifications screen and its sheet against a hand-written fake of
//  their API: what a load shows, how the public URL and a row's switch save
//  and fail, and how a save and a test settle.

import Foundation
import Testing

@testable import omnibus

/// Holds what the fake was sent, for a test to read back.
actor Sent<Value: Sendable> {
    private(set) var values: [Value] = []
    func record(_ value: Value) { values.append(value) }
}

private let noneStatus = PublicURLStatus(url: nil, source: .none)

/// A `NotificationsAPI` whose every call fails unless the test gives it an answer.
func fakeNotificationsAPI(
    publicURL: @escaping @Sendable () async throws -> PublicURLStatus = { throw FakeFailure() },
    setPublicURL: @escaping @Sendable (String?) async throws -> PublicURLStatus = { _ in throw FakeFailure() },
    connections: @escaping @Sendable () async throws -> NotificationConnections = { throw FakeFailure() },
    create: @escaping @Sendable (NotificationConnectionInput) async throws -> NotificationConnection = { _ in throw FakeFailure() },
    update: @escaping @Sendable (Int64, NotificationConnectionInput) async throws -> NotificationConnection = { _, _ in throw FakeFailure() },
    delete: @escaping @Sendable (Int64) async throws -> Void = { _ in throw FakeFailure() },
    test: @escaping @Sendable (NotificationTest) async throws -> Void = { _ in throw FakeFailure() }
) -> NotificationsAPI {
    NotificationsAPI(
        publicURL: publicURL, setPublicURL: setPublicURL, connections: connections,
        create: create, update: update, delete: delete, test: test
    )
}

private func list(_ connections: [NotificationConnection]) -> NotificationConnections {
    NotificationConnections(connections: connections, availableEvents: [.requestNeedsChooser])
}

@MainActor
private func loadedModel(
    status: PublicURLStatus = noneStatus,
    connections: [NotificationConnection],
    api: (NotificationsAPI) -> NotificationsAPI = { $0 }
) async -> NotificationsModel {
    let base = fakeNotificationsAPI(publicURL: { status }, connections: { list(connections) })
    let model = NotificationsModel(api: api(base))
    await model.load()
    return model
}

@MainActor
struct NotificationsModelTests {
    // MARK: - Loading

    @Test func loadShowsTheURLAndTheConnections() async throws {
        let saved = try savedConnections()
        let model = await loadedModel(
            status: PublicURLStatus(url: "https://b.example", source: .settings), connections: saved
        )
        #expect(model.isLoaded)
        #expect(model.connections == saved)
        #expect(model.availableEvents == [.requestNeedsChooser])
        #expect(model.publicURLText == "https://b.example")
        #expect(!model.isPublicURLEdited)
        #expect(model.failure == nil)
    }

    @Test func anEnvironmentURLDoesNotFillTheField() async {
        let model = await loadedModel(status: PublicURLStatus(url: "https://env.example", source: .env), connections: [])
        #expect(model.publicURLText.isEmpty)
        #expect(model.publicURL?.source == .env)
    }

    @Test func aFailedFirstLoadShowsTheFailureAndNothingElse() async {
        let model = NotificationsModel(api: fakeNotificationsAPI(publicURL: { noneStatus }))
        await model.load()
        #expect(!model.isLoaded)
        #expect(model.failure == "boom")
    }

    @Test func aFailedRefreshKeepsTheScreen() async throws {
        let calls = CallCounter()
        let saved = try savedConnections()
        let model = NotificationsModel(api: fakeNotificationsAPI(
            publicURL: { noneStatus },
            connections: {
                if await calls.next() == 1 { return list(saved) }
                throw FakeFailure()
            }
        ))
        await model.load()
        await model.load()
        #expect(model.connections == saved)
        #expect(model.failure == nil)
    }

    @Test func aRefreshDoesNotOverwriteWhatIsBeingTyped() async {
        let model = await loadedModel(status: PublicURLStatus(url: "https://a.example", source: .settings), connections: [])
        model.publicURLText = "https://typing"
        await model.load()
        #expect(model.publicURLText == "https://typing")
    }

    // MARK: - Public URL

    @Test func aRefusedURLShowsTheServersReasonAndKeepsWhatWasTyped() async {
        let model = await loadedModel(connections: []) { api in
            var api = api
            api.setPublicURL = { _ in
                throw APIError.http(status: 422, message: "public url must start with http:// or https://")
            }
            return api
        }
        model.publicURLText = "ftp://books"
        await model.savePublicURL()
        #expect(model.publicURLError == "public url must start with http:// or https://")
        #expect(model.publicURLText == "ftp://books")
        #expect(!model.publicURLSaved)
        #expect(model.publicURL == noneStatus)

        model.publicURLText = "https://books"
        #expect(model.publicURLError == nil)
    }

    @Test func aSavedURLTakesTheServersNormalisedValue() async {
        let sent = Sent<String?>()
        let model = await loadedModel(connections: []) { api in
            var api = api
            api.setPublicURL = { url in
                await sent.record(url)
                return PublicURLStatus(url: "https://books.example", source: .settings)
            }
            return api
        }
        model.publicURLText = "  https://books.example/  "
        await model.savePublicURL()
        #expect(await sent.values == ["https://books.example/"])
        #expect(model.publicURLText == "https://books.example")
        #expect(model.publicURLSaved)
        #expect(!model.isPublicURLEdited)

        model.publicURLText = "https://other"
        #expect(!model.publicURLSaved)
    }

    @Test func clearingSendsNilAndEmptiesTheField() async {
        let sent = Sent<String?>()
        let model = await loadedModel(
            status: PublicURLStatus(url: "https://b.example", source: .settings), connections: []
        ) { api in
            var api = api
            api.setPublicURL = { url in
                await sent.record(url)
                return PublicURLStatus(url: nil, source: .none)
            }
            return api
        }
        await model.clearPublicURL()
        #expect(await sent.values == [nil])
        #expect(model.publicURLText.isEmpty)
        #expect(model.publicURL?.source == PublicURLSource.none)
    }

    // MARK: - A row's switch

    @Test func turningOffSavesInPlaceWithNoSecret() async throws {
        let saved = try savedConnections()
        let sent = Sent<NotificationConnectionInput>()
        let model = await loadedModel(connections: saved) { api in
            var api = api
            api.update = { id, input in
                await sent.record(input)
                var answer = saved[0]
                answer.id = id
                answer.enabled = input.enabled
                return answer
            }
            return api
        }
        await model.setEnabled(saved[0], false)
        #expect(model.connections[0].enabled == false)
        #expect(model.toggling.isEmpty)
        let input = try #require(await sent.values.first)
        #expect(!input.enabled)
        switch input.settings {
        case let .ntfy(settings):
            #expect(settings.token == nil)
            #expect(settings.password == nil)
        }
    }

    @Test func aRefusedSwitchTurnsBackAndSaysWhy() async throws {
        let saved = try savedConnections()
        let model = await loadedModel(connections: saved) { api in
            var api = api
            api.update = { _, _ in throw APIError.http(status: 422, message: "a token is required when auth is token") }
            return api
        }
        await model.setEnabled(saved[0], false)
        #expect(model.connections[0].enabled)
        #expect(model.rowErrors[1] == "a token is required when auth is token")
        #expect(model.toggling.isEmpty)
    }

    @Test func aProviderThisBuildDoesntKnowIsNeverSwitched() async throws {
        let saved = try savedConnections()
        let calls = CallCounter()
        let model = await loadedModel(connections: saved) { api in
            var api = api
            api.update = { _, _ in
                _ = await calls.next()
                throw FakeFailure()
            }
            return api
        }
        await model.setEnabled(saved[3], false)
        #expect(await calls.next() == 1)
        #expect(model.connections[3].enabled)
    }

    // MARK: - Delete and upsert

    @Test func aDeleteRemovesTheRow() async throws {
        let saved = try savedConnections()
        let model = await loadedModel(connections: saved) { api in
            var api = api
            api.delete = { _ in }
            return api
        }
        #expect(await model.delete(id: 2) == nil)
        #expect(model.connections.map(\.id) == [1, 3, 4])
    }

    @Test func aFailedDeleteKeepsTheRowAndSaysWhy() async throws {
        let saved = try savedConnections()
        let model = await loadedModel(connections: saved)
        #expect(await model.delete(id: 2) == "boom")
        #expect(model.connections.count == 4)
    }

    @Test func aSavedConnectionIsFiledByName() async throws {
        let saved = try savedConnections()
        let model = await loadedModel(connections: Array(saved.prefix(2)))
        var added = saved[2]
        added.name = "Basement"
        model.upsert(added)
        #expect(model.connections.map(\.name) == ["Ada\u{2019}s phone", "Basement", "Den"])
        var renamed = saved[0]
        renamed.name = "Zed"
        model.upsert(renamed)
        #expect(model.connections.map(\.name) == ["Basement", "Den", "Zed"])
    }

    // MARK: - The sheet

    private func filledDraft() -> NtfyDraft {
        var draft = NtfyDraft(offering: [.requestNeedsChooser])
        draft.name = "Phone"
        draft.serverURL = "https://ntfy.sh"
        draft.topic = "books"
        return draft
    }

    @Test func aNewConnectionIsCreated() async throws {
        let saved = try savedConnections()
        let created = Sent<NotificationConnectionInput>()
        let sheet = NtfySheetModel(draft: filledDraft(), api: fakeNotificationsAPI(create: { input in
            await created.record(input)
            return saved[2]
        }))
        #expect(await sheet.save() == saved[2])
        #expect(await created.values.first?.name == "Phone")
        #expect(sheet.saveError == nil)
    }

    @Test func anEditReplacesTheSavedConnection() async throws {
        let saved = try savedConnections()
        let ids = Sent<Int64>()
        let draft = try #require(NtfyDraft(editing: saved[0]))
        let sheet = NtfySheetModel(draft: draft, api: fakeNotificationsAPI(update: { id, _ in
            await ids.record(id)
            return saved[0]
        }))
        #expect(await sheet.save() == saved[0])
        #expect(await ids.values == [1])
    }

    @Test func aRefusedSaveShowsTheServersReasonUntilTheFormChanges() async {
        let sheet = NtfySheetModel(draft: filledDraft(), api: fakeNotificationsAPI(create: { _ in
            throw APIError.http(status: 422, message: "topic must be 1 to 64 letters, digits, hyphens or underscores")
        }))
        #expect(await sheet.save() == nil)
        #expect(sheet.saveError == "topic must be 1 to 64 letters, digits, hyphens or underscores")
        #expect(!sheet.isSaving)
        sheet.draft.topic = "books2"
        #expect(sheet.saveError == nil)
    }

    @Test func anIncompleteFormCanNeitherSaveNorTest() {
        var draft = filledDraft()
        draft.topic = ""
        let sheet = NtfySheetModel(draft: draft, api: fakeNotificationsAPI())
        #expect(!sheet.canSave)
        #expect(!sheet.canTest)
        #expect(!sheet.isDirty)
        sheet.draft.topic = "t"
        #expect(sheet.canSave)
        #expect(sheet.isDirty)
    }

    @Test func aTestShowsItIsSendingThenThatItWasSent() async {
        let gate = Gate()
        let sent = Sent<NotificationTest>()
        let sheet = NtfySheetModel(draft: filledDraft(), api: fakeNotificationsAPI(test: { request in
            await sent.record(request)
            await gate.wait()
        }))
        let running = Task { await sheet.test() }
        #expect(await eventually { sheet.testState == .sending })
        #expect(!sheet.canTest)
        await gate.open()
        await running.value
        #expect(sheet.testState == .sent)
        #expect(await sent.values.first?.id == nil)
    }

    @Test func aFailedTestShowsTheProvidersAnswer() async {
        let sheet = NtfySheetModel(draft: filledDraft(), api: fakeNotificationsAPI(test: { _ in
            throw APIError.http(status: 502, message: "the server answered 401 Unauthorized: {\"code\":40101}")
        }))
        await sheet.test()
        #expect(sheet.testState == .failed("the server answered 401 Unauthorized: {\"code\":40101}"))
    }

    @Test func aTestOfAnEditNamesTheSavedConnection() async throws {
        let sent = Sent<NotificationTest>()
        let draft = try #require(NtfyDraft(editing: try savedConnections()[0]))
        let sheet = NtfySheetModel(draft: draft, api: fakeNotificationsAPI(test: { await sent.record($0) }))
        await sheet.test()
        #expect(await sent.values.first?.id == 1)
    }

    @Test func aResultForValuesSinceChangedIsDropped() async {
        let gate = Gate()
        let sheet = NtfySheetModel(draft: filledDraft(), api: fakeNotificationsAPI(test: { _ in await gate.wait() }))
        let running = Task { await sheet.test() }
        #expect(await eventually { sheet.testState == .sending })
        sheet.draft.topic = "other"
        await gate.open()
        await running.value
        #expect(sheet.testState == .idle)
    }

    @Test func editingAfterATestClearsItsResult() async {
        let sheet = NtfySheetModel(draft: filledDraft(), api: fakeNotificationsAPI(test: { _ in }))
        await sheet.test()
        #expect(sheet.testState == .sent)
        sheet.draft.priority = 5
        #expect(sheet.testState == .idle)
    }
}
