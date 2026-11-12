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
    setEnabled: @escaping @Sendable (Int64, Bool) async throws -> NotificationConnection = { _, _ in throw FakeFailure() },
    delete: @escaping @Sendable (Int64) async throws -> Void = { _ in throw FakeFailure() },
    test: @escaping @Sendable (NotificationTest) async throws -> Void = { _ in throw FakeFailure() }
) -> NotificationsAPI {
    NotificationsAPI(
        publicURL: publicURL, setPublicURL: setPublicURL, connections: connections,
        create: create, update: update, setEnabled: setEnabled, delete: delete, test: test
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

    @Test func aSwitchSendsOnlyWhetherItIsOnAndTakesTheServersAnswer() async throws {
        let saved = try savedConnections()
        let sent = Sent<String>()
        let model = await loadedModel(connections: saved) { api in
            var api = api
            api.setEnabled = { id, enabled in
                await sent.record("\(id):\(enabled)")
                // Another admin renamed it meanwhile; the answer carries that too.
                var answer = saved[0]
                answer.enabled = enabled
                answer.name = "Ada\u{2019}s kitchen phone"
                return answer
            }
            api.update = { _, _ in
                await sent.record("put")
                throw FakeFailure()
            }
            return api
        }
        await model.setEnabled(saved[0], false)
        #expect(await sent.values == ["1:false"])
        let row = try #require(model.connections.first { $0.id == 1 })
        #expect(!row.enabled)
        #expect(row.name == "Ada\u{2019}s kitchen phone")
        #expect(model.toggling.isEmpty)
        #expect(model.rowErrors[1] == nil)
    }

    @Test func aRefusedSwitchTurnsBackAndSaysWhy() async throws {
        let saved = try savedConnections()
        let model = await loadedModel(connections: saved) { api in
            var api = api
            api.setEnabled = { _, _ in throw APIError.http(status: 500, message: "database is locked") }
            return api
        }
        await model.setEnabled(saved[0], false)
        #expect(model.connections[0].enabled)
        #expect(model.rowErrors[1] == "database is locked")
        #expect(model.toggling.isEmpty)
    }

    @Test func aProviderThisBuildCantEditCanStillBeSwitched() async throws {
        let saved = try savedConnections()
        let sent = Sent<String>()
        let model = await loadedModel(connections: saved) { api in
            var api = api
            api.setEnabled = { id, enabled in
                await sent.record("\(id):\(enabled)")
                var answer = saved[3]
                answer.enabled = enabled
                return answer
            }
            return api
        }
        #expect(!NotificationsFlow.isEditable(saved[3]))
        await model.setEnabled(saved[3], false)
        #expect(await sent.values == ["4:false"])
        #expect(model.connections.first { $0.id == 4 }?.enabled == false)
        #expect(model.connections.first { $0.id == 4 }?.settings == .unknown(kind: "gotify"))
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
            throw APIError.http(status: 502, message: unauthorizedSentence)
        }))
        await sheet.test()
        #expect(sheet.testState == .failed(unauthorizedSentence))
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

/// Counts a fake's calls, and can be read without counting one.
actor Calls {
    private(set) var count = 0

    func next() -> Int {
        count += 1
        return count
    }
}

private let notFound = APIError.http(status: 404, message: "no such notification connection")

/// What the screen does with a read, a write and a 404 that cross.
@MainActor
struct NotificationsRaceTests {
    // MARK: - Loading

    @Test func aCancelledLoadIsNotAFailureAndTheNextLoadReads() async throws {
        let calls = Calls()
        let saved = try savedConnections()
        let model = NotificationsModel(api: fakeNotificationsAPI(
            publicURL: { noneStatus },
            connections: {
                if await calls.next() == 1 { throw CancellationError() }
                return list(saved)
            }
        ))
        await model.load()
        #expect(model.failure == nil)
        #expect(!model.isLoaded)
        await model.load()
        #expect(model.isLoaded)
    }

    @Test func aFirstRead404SaysTheServerHasNoNotifications() async {
        let model = NotificationsModel(api: fakeNotificationsAPI(publicURL: { throw notFound }, connections: { throw notFound }))
        await model.load()
        #expect(model.failure?.contains("aren\u{2019}t available on this server") == true)
        #expect(model.failure?.contains("Pull down") == false)
    }

    /// A model whose second connections read waits on `gate` and answers `stale`,
    /// and whose later reads answer `fresh`.
    private func racingModel(
        stale: [NotificationConnection], fresh: [NotificationConnection], gate: Gate, calls: Calls,
        configure: (inout NotificationsAPI) -> Void
    ) -> NotificationsModel {
        var api = fakeNotificationsAPI(
            publicURL: { noneStatus },
            connections: {
                switch await calls.next() {
                case 1: return list(stale)
                case 2:
                    await gate.wait()
                    return list(stale)
                default: return list(fresh)
                }
            }
        )
        configure(&api)
        return NotificationsModel(api: api)
    }

    @Test func aRefreshOutWhenASwitchLandsIsReadAgainRatherThanUndoIt() async throws {
        let saved = try savedConnections()
        let off: [NotificationConnection] = {
            var turned = saved
            turned[0].enabled = false
            return turned
        }()
        let gate = Gate()
        let calls = Calls()
        let model = racingModel(stale: saved, fresh: off, gate: gate, calls: calls) { api in
            api.setEnabled = { _, _ in off[0] }
        }
        await model.load()
        let refresh = Task { await model.load() }
        while await calls.count < 2 { await Task.yield() }

        await model.setEnabled(saved[0], false)
        #expect(model.connections[0].enabled == false)
        await gate.open()
        await refresh.value
        #expect(model.connections[0].enabled == false)
        #expect(await calls.count == 3)
    }

    @Test func aRefreshOutWhenADeleteLandsDoesNotBringTheRowBack() async throws {
        let saved = try savedConnections()
        let gate = Gate()
        let calls = Calls()
        let model = racingModel(stale: saved, fresh: Array(saved.dropFirst()), gate: gate, calls: calls) { api in
            api.delete = { _ in }
        }
        await model.load()
        let refresh = Task { await model.load() }
        while await calls.count < 2 { await Task.yield() }

        #expect(await model.delete(id: 1) == nil)
        await gate.open()
        await refresh.value
        #expect(!model.connections.contains { $0.id == 1 })
    }

    @Test func aSwitchAnsweringAfterItsRowWasDeletedLeavesNoGhost() async throws {
        let saved = try savedConnections()
        let gate = Gate()
        let model = await loadedModel(connections: saved) { api in
            var api = api
            api.setEnabled = { _, _ in
                await gate.wait()
                return saved[0]
            }
            api.delete = { _ in }
            return api
        }
        let toggle = Task { await model.setEnabled(saved[0], false) }
        #expect(await eventually { model.toggling.contains(1) })
        #expect(await model.delete(id: 1) == nil)
        await gate.open()
        await toggle.value
        #expect(!model.connections.contains { $0.id == 1 })
        #expect(model.toggling.isEmpty)
    }

    // MARK: - Once at a time

    @Test func aSecondSwitchWhileOneIsOutSendsNothing() async throws {
        let saved = try savedConnections()
        let gate = Gate()
        let calls = Calls()
        let model = await loadedModel(connections: saved) { api in
            var api = api
            api.setEnabled = { _, enabled in
                _ = await calls.next()
                await gate.wait()
                var answer = saved[0]
                answer.enabled = enabled
                return answer
            }
            return api
        }
        let first = Task { await model.setEnabled(saved[0], false) }
        #expect(await eventually { model.toggling.contains(1) })
        await model.setEnabled(saved[0], true)
        await gate.open()
        await first.value
        #expect(await calls.count == 1)
        #expect(model.connections[0].enabled == false)
    }

    @Test func aSecondSaveWhileOneIsOutSendsNothing() async throws {
        let saved = try savedConnections()
        let gate = Gate()
        let calls = Calls()
        var draft = NtfyDraft(offering: [])
        draft.name = "Phone"
        draft.serverURL = "https://ntfy.sh"
        draft.topic = "t"
        let sheet = NtfySheetModel(draft: draft, api: fakeNotificationsAPI(create: { _ in
            _ = await calls.next()
            await gate.wait()
            return saved[2]
        }))
        let first = Task { await sheet.save() }
        #expect(await eventually { sheet.isSaving })
        #expect(await sheet.save() == nil)
        await gate.open()
        #expect(await first.value == saved[2])
        #expect(await calls.count == 1)
    }

    // MARK: - Deleted elsewhere

    @Test func aSwitchThatFindsItsRowGoneRemovesItAndSaysSo() async throws {
        let saved = try savedConnections()
        let model = await loadedModel(connections: saved) { api in
            var api = api
            api.setEnabled = { _, _ in throw notFound }
            return api
        }
        await model.setEnabled(saved[0], false)
        #expect(!model.connections.contains { $0.id == 1 })
        #expect(model.listNotice == "That connection was deleted elsewhere.")
        #expect(model.rowErrors[1] == nil)
    }

    @Test func aDeleteThatFindsTheRowGoneCountsAsDeleted() async throws {
        let saved = try savedConnections()
        let model = await loadedModel(connections: saved) { api in
            var api = api
            api.delete = { _ in throw notFound }
            return api
        }
        #expect(await model.delete(id: 2) == nil)
        #expect(model.connections.map(\.id) == [1, 3, 4])
    }

    @Test func aSaveThatFindsTheConnectionGoneSaysSoAndStops() async throws {
        let draft = try #require(NtfyDraft(editing: try savedConnections()[0]))
        let sheet = NtfySheetModel(draft: draft, api: fakeNotificationsAPI(
            update: { _, _ in throw notFound },
            test: { _ in throw notFound }
        ))
        #expect(await sheet.save() == nil)
        #expect(sheet.isGone)
        #expect(sheet.saveError == "This connection was deleted elsewhere.")
        #expect(!sheet.canSave)
        #expect(!sheet.canTest)
    }

    @Test func aTestThatFindsTheConnectionGoneSaysSo() async throws {
        let draft = try #require(NtfyDraft(editing: try savedConnections()[0]))
        let sheet = NtfySheetModel(draft: draft, api: fakeNotificationsAPI(test: { _ in throw notFound }))
        await sheet.test()
        #expect(sheet.isGone)
        #expect(sheet.testState == .failed("This connection was deleted elsewhere."))
    }
}
