//  SeriesStacksTests.swift
//  Stack series on the client: the wire decode (old payloads keep loading),
//  the request and cache key, the grid projection, and the cell captions.

import Foundation
import Testing

@testable import omnibus

private func book(_ id: Int64, _ title: String, series: String? = nil, index: String? = nil) -> Book {
    var b = Book(id: id, filename: "\(id).epub", title: title, uniqueIdentifier: "u\(id)")
    b.series = series
    b.seriesIndex = index
    return b
}

private func stack(lead: Book, members: [Book], states: [StackMemberState] = []) -> SeriesStack {
    SeriesStack(leadUuid: lead.uuid, name: lead.series ?? "", seriesId: 7, members: members, states: states)
}

struct SeriesStackDecodeTests {
    @Test func userSummaryDecodesAMissingStackSeriesAsOff() throws {
        let json = #"{"id":1,"username":"a","is_admin":false,"can_upload":false,"can_edit":false,"can_download":true}"#
        let me = try JSONDecoder().decode(UserSummary.self, from: Data(json.utf8))
        #expect(me.stackSeries == false)
    }

    @Test func userSummaryCarriesStackSeriesWhenSet() throws {
        let json = #"{"id":1,"username":"a","is_admin":false,"can_upload":false,"can_edit":false,"can_download":true,"stack_series":true}"#
        let me = try JSONDecoder().decode(UserSummary.self, from: Data(json.utf8))
        #expect(me.stackSeries)
    }

    @Test func ebookLibraryDecodesWithAndWithoutStacks() throws {
        let plain = #"{"path":"/lib","books":[],"error":null,"total":null}"#
        #expect(try JSONDecoder().decode(EbookLibrary.self, from: Data(plain.utf8)).stacks.isEmpty)

        let stacked = """
            {"path":"/lib","books":[],"error":null,"total":null,"stacks":[{
              "lead_uuid":"u1","name":"Saga","series_id":7,
              "members":[{"id":1,"filename":"a.epub","unique_identifier":"u1"}],
              "states":[{"uuid":"u1","percent":40,"started":true,"finished":false}]}]}
            """
        let library = try JSONDecoder().decode(EbookLibrary.self, from: Data(stacked.utf8))
        let first = try #require(library.stacks.first)
        #expect(first.leadUuid == "u1")
        #expect(first.seriesId == 7)
        #expect(first.members.map(\.uuid) == ["u1"])
        #expect(first.state(of: "u1")?.percent == 40)
    }

    @Test func frontIsTheFirstStartedUnfinishedVolumeElseTheFirst() {
        let one = book(1, "One", series: "Saga", index: "1")
        let two = book(2, "Two", series: "Saga", index: "2")
        #expect(stack(lead: one, members: [one, two]).front?.id == 1)
        let reading = stack(lead: one, members: [one, two], states: [
            StackMemberState(uuid: "u1", percent: nil, started: true, finished: true),
            StackMemberState(uuid: "u2", percent: 30, started: true, finished: false),
        ])
        #expect(reading.front?.id == 2)
    }
}

struct SeriesStackRequestTests {
    @Test func pageSignatureDiffersWhenStacked() {
        var stacked = LibraryFilter()
        stacked.stackSeries = true
        #expect(
            LibraryService.pageSignature(sort: .title, direction: .asc, filter: .none)
                != LibraryService.pageSignature(sort: .title, direction: .asc, filter: stacked),
            "a toggle must miss the cached first page"
        )
    }

    @Test func pageQueryAsksForStacksOnlyWhenStacked() {
        let off = LibraryService.pageQuery(
            sort: .title, direction: .asc, formats: [], excludeFormats: [],
            stackSeries: false, cursor: nil
        )
        let on = LibraryService.pageQuery(
            sort: .title, direction: .asc, formats: [], excludeFormats: [],
            stackSeries: true, cursor: nil
        )
        #expect(off["stack_series"] == nil)
        #expect(on["stack_series"] == "true")
    }

    @Test func aCachedPageFromBeforeStacksStillDecodes() throws {
        let cached = #"{"books":[],"nextCursor":"c1"}"#
        let page = try JSONDecoder().decode(LibraryPageResult.self, from: Data(cached.utf8))
        #expect(page.stacks == nil)
        #expect(page.nextCursor == "c1")
    }
}
