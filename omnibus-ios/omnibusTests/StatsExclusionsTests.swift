//  StatsExclusionsTests.swift
//  The `stats_exclusions` wire decode on `/me`, what the "Leave out of my
//  stats" screen sends from its draft, and the one-line summary the You tab
//  row shows for a rule.

import Foundation
import Testing

@testable import omnibus

private let minimalUserFields =
    #""id":1,"username":"a","is_admin":false,"can_upload":false,"can_edit":false,"can_download":true"#

private let sports = FilterClause(field: .tag, mode: .include, values: ["Sports"])

struct StatsExclusionsTests {
    @Test func userSummaryDecodesStatsExclusionsFromMe() throws {
        let json = Data(
            #"{\#(minimalUserFields),"stats_exclusions":{"clauses":[{"field":"tag","mode":"include","values":["Sports"]}]}}"#.utf8)
        let me = try JSONDecoder().decode(UserSummary.self, from: json)
        #expect(me.statsExclusionsSetting?.clauses == [sports])
    }

    @Test func userSummaryDecodesAMissingStatsExclusionsAsNil() throws {
        let me = try JSONDecoder().decode(UserSummary.self, from: Data("{\(minimalUserFields)}".utf8))
        #expect(me.statsExclusionsSetting == nil)
    }

    @Test func userSummaryKeepsTheClausesItKnowsWhenOneNamesAFieldItDoesNot() throws {
        let json = Data(
            #"{\#(minimalUserFields),"stats_exclusions":{"clauses":[{"field":"mood","mode":"include","values":["x"]},{"field":"tag","mode":"include","values":["Sports"]}]}}"#.utf8)
        let me = try JSONDecoder().decode(UserSummary.self, from: json)
        #expect(me.statsExclusionsSetting?.clauses == [sports])
    }

    private func user(saved: StatsExclusions?) -> UserSummary {
        var me = UserSummary(
            id: 1, username: "a", isAdmin: false, canUpload: false, canEdit: false,
            canDownload: true)
        me.statsExclusionsSetting = saved
        return me
    }

    @MainActor @Test func savingFromTheScreenSendsTheDraftClauses() throws {
        let draft = StatsExclusionsDraft(seededFrom: user(saved: StatsExclusions(clauses: [])))
        let store = LibraryFilterStore(clauses: draft.saved)
        #expect(draft.update(for: store.clauses) == nil, "an unchanged draft has nothing to send")

        store.apply(sports)

        let body = try #require(draft.update(for: store.clauses))
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        #expect(
            String(decoding: try encoder.encode(body), as: UTF8.self)
                == #"{"clauses":[{"field":"tag","mode":"include","values":["Sports"]}]}"#)
    }

    @MainActor @Test func aRuleSavedInAnotherClauseOrderIsNotAnUnsavedEdit() {
        let author = FilterClause(field: .author, mode: .include, values: ["A"])
        let draft = StatsExclusionsDraft(
            seededFrom: user(saved: StatsExclusions(clauses: [author, sports])))
        let store = LibraryFilterStore(clauses: draft.saved)

        #expect(draft.update(for: store.clauses) == nil)
    }

    @Test func previewKeepsTwoSameNamedSameSizedSeriesApart() {
        func stack(_ lead: String) -> SeriesStack {
            SeriesStack(leadUuid: lead, name: "Saga", members: [Book(id: 1, filename: "\(lead).epub")])
        }
        let page = LibraryPageResult(
            books: [], nextCursor: nil, total: 2, hiddenCount: nil, stacks: [stack("a"), stack("b")])

        let ids = StatsExclusionsPreview(page: page).seriesLines.map(\.id)

        #expect(ids == ["a", "b"])
    }

    @MainActor @Test func clearingTheLastClauseSendsAnEmptyRule() throws {
        let draft = StatsExclusionsDraft(seededFrom: user(saved: StatsExclusions(clauses: [sports])))
        let store = LibraryFilterStore(clauses: draft.saved)

        store.clear()

        #expect(draft.update(for: store.clauses)?.clauses == [])
    }

    @MainActor @Test func memoryOnlyStoreLeavesTheLibrarysSavedFilterAlone() {
        let before = LibraryFilterPreference.load().clauses

        LibraryFilterStore(clauses: []).apply(sports)

        #expect(LibraryFilterPreference.load().clauses == before)
    }

    @Test func summarySaysNothingIsLeftOutForAnEmptyRule() {
        #expect(StatsExclusions(clauses: []).summary == "Nothing left out.")
    }

    @Test func summaryNamesEachClauseByFieldAndFirstValue() {
        let rule = StatsExclusions(clauses: [
            sports,
            FilterClause(field: .author, mode: .exclude, values: ["A", "B", "C"]),
            FilterClause(field: .shelf, mode: .include, values: ["4", "9"]),
        ])
        #expect(rule.summary == "Tag: Sports · Author: not A +2 · Shelf: 2 shelves")
    }
}
