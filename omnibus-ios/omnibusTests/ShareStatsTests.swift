//  ShareStatsTests.swift
//  The `share_stats` wire decode (missing means on, per the household
//  contract) and the exact shape of the toggle's POST body.

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
