//  SettingsPathsLoadTests.swift
//  When Server settings may read and save the library paths: only paths the
//  server answered with are posted back, a read that never landed is tried
//  again, and coming back to the screen doesn't read over what was typed.

import Foundation
import Testing

@testable import omnibus

struct SettingsPathsLoadTests {
    @Test func aFreshScreenReadsAndCannotSave() {
        let load = LibraryPathsLoad()
        #expect(load.needsLoad)
        #expect(!load.canSave)
        #expect(load.isWaiting)
    }

    @Test func aReadThatLandsAllowsSavingAndIsNotRepeated() {
        var load = LibraryPathsLoad()
        load.begin()
        #expect(!load.needsLoad)
        load.succeeded()
        #expect(load.canSave)
        // Coming back from Notifications appears again; nothing is read over the fields.
        #expect(!load.needsLoad)
        #expect(!load.isWaiting)
    }

    @Test func aCancelledReadIsNoFailureAndIsReadAgain() {
        var load = LibraryPathsLoad()
        load.begin()
        load.failed(CancellationError())
        #expect(load.failure == nil)
        #expect(load.needsLoad)
        #expect(!load.canSave)
        #expect(load.isWaiting)

        load.begin()
        load.failed(URLError(.cancelled))
        #expect(load.failure == nil)
        #expect(load.needsLoad)
    }

    @Test func aFailedReadSaysWhyIsReadAgainAndCannotSave() {
        var load = LibraryPathsLoad()
        load.begin()
        load.failed(APIError.http(status: 500, message: "database is locked"))
        #expect(load.failure == "database is locked")
        #expect(load.needsLoad)
        #expect(!load.canSave)
        #expect(!load.isWaiting)

        load.begin()
        load.succeeded()
        #expect(load.failure == nil)
        #expect(load.canSave)
    }
}
