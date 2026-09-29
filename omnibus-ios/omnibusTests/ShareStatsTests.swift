//  ShareStatsTests.swift
//  The `share_stats` wire decode (missing means on, per the household
//  contract), the exact shape of the toggle's POST body, and the switch's
//  save rules.

import Foundation
import Testing

@testable import omnibus

private let minimalUserFields =
    #""id":1,"username":"a","is_admin":false,"can_upload":false,"can_edit":false,"can_download":true"#

struct ShareStatsCodecTests {
    @Test func userSummaryDecodesAMissingShareStatsAsOn() throws {
        let json = Data("{\(minimalUserFields)}".utf8)
        let me = try JSONDecoder().decode(UserSummary.self, from: json)
        #expect(me.shareStats)
    }

    @Test func userSummaryDecodesShareStatsOff() throws {
        let json = Data(#"{\#(minimalUserFields),"share_stats":false}"#.utf8)
        let me = try JSONDecoder().decode(UserSummary.self, from: json)
        #expect(!me.shareStats)
    }

    @Test func userSummaryDecodesShareStatsOn() throws {
        let json = Data(#"{\#(minimalUserFields),"share_stats":true}"#.utf8)
        let me = try JSONDecoder().decode(UserSummary.self, from: json)
        #expect(me.shareStats)
    }

    @Test func shareStatsUpdateEncodesExactlyItsEnabledFlag() throws {
        let data = try JSONEncoder().encode(ShareStatsUpdate(enabled: false))
        #expect(String(data: data, encoding: .utf8) == #"{"enabled":false}"#)
    }
}

@Suite("Share stats switch")
struct ShareStatsToggleTests {
    private func seeded(_ value: Bool) -> ShareStatsToggle {
        var toggle = ShareStatsToggle()
        toggle.seed(value)
        return toggle
    }

    @Test func seedAdoptsTheServerValueOnlyOnce() {
        var toggle = seeded(false)
        #expect(!toggle.value && !toggle.saved)
        toggle.seed(true)
        #expect(!toggle.value && !toggle.saved)
    }

    @Test func aFlipAwayFromTheSavedValueStartsASaveAndLocksTheSwitch() {
        var toggle = seeded(false)
        toggle.value = true
        let started = toggle.beginSave()
        #expect(started)
        #expect(toggle.isSaving)
        #expect(toggle.isDisabled(online: true))
    }

    @Test func aFlipThatMatchesTheSavedValueSendsNothing() {
        var toggle = seeded(true)
        let started = toggle.beginSave()
        #expect(!started)
        #expect(!toggle.isSaving)
    }

    @Test func aSuccessfulSaveConfirmsTheValueAndClearsTheError() {
        var toggle = seeded(false)
        toggle.error = "earlier failure"
        toggle.value = true
        _ = toggle.beginSave()
        toggle.saveSucceeded(wrote: true)
        toggle.finishSave()
        #expect(toggle.value && toggle.saved)
        #expect(toggle.error == nil)
        #expect(!toggle.isSaving)
    }

    @Test func aFailedSaveRevertsTheSwitchWithoutASecondWrite() {
        var toggle = seeded(true)
        toggle.value = false
        _ = toggle.beginSave()
        toggle.saveFailed(revertTo: true, message: "boom")
        // The revert lands back on the saved value, so it must not start another save.
        let restarted = toggle.beginSave()
        #expect(!restarted)
        toggle.finishSave()
        #expect(toggle.value && toggle.saved)
        #expect(toggle.error == "boom")
        #expect(!toggle.isSaving)
    }

    @Test func theServerValueIsIgnoredMidSaveAndFollowedOtherwise() {
        var toggle = seeded(false)
        toggle.value = true
        _ = toggle.beginSave()
        toggle.serverChanged(to: false)
        #expect(toggle.value && !toggle.saved)
        toggle.saveSucceeded(wrote: true)
        toggle.finishSave()
        toggle.serverChanged(to: false)
        #expect(!toggle.value && !toggle.saved)
        toggle.serverChanged(to: nil)
        #expect(!toggle.value)
    }

    @Test func theServerValueIsIgnoredBeforeTheFirstSeed() {
        var toggle = ShareStatsToggle()
        toggle.serverChanged(to: false)
        #expect(toggle.value && toggle.saved)
    }

    @Test func theSwitchIsDisabledOffline() {
        let toggle = seeded(true)
        #expect(toggle.isDisabled(online: false))
        #expect(!toggle.isDisabled(online: true))
    }
}
