//  DebugScreenLinkTests.swift
//  The DEBUG-only `omnibus://debug/screen/…` links a screenshot tour opens
//  screens with: which URLs are screen links, and the tab and stack each names.

import Foundation
import Testing

@testable import omnibus

private func route(_ link: String) -> ScreenRoute? {
    URL(string: link).flatMap(DebugScreenLink.screenSegments).flatMap(DebugScreenLink.route)
}

struct DebugScreenLinkTests {
    @Test func aTabAloneOpensItsRoot() {
        #expect(route("omnibus://debug/screen/you") == ScreenRoute(tab: .you, path: []))
    }

    @Test func eachWordPushesOneScreenInOrder() {
        #expect(
            route("omnibus://debug/screen/library/shelves/shelf/3")
                == ScreenRoute(tab: .library, path: [.shelves, .shelf(id: 3)])
        )
        #expect(
            route("omnibus://debug/screen/search/author/12/book/u-1")
                == ScreenRoute(tab: .search, path: [.author(id: 12), .book(uuid: "u-1")])
        )
    }

    @Test func seriesIsTheIndexUnlessAnIdFollows() {
        #expect(route("omnibus://debug/screen/you/series")?.path == [.seriesIndex])
        #expect(route("omnibus://debug/screen/you/series/5")?.path == [.series(id: 5)])
        #expect(route("omnibus://debug/screen/you/series/shelves")?.path == [.seriesIndex, .shelves])
    }

    @Test func aNameArgumentIsPercentDecoded() {
        #expect(route("omnibus://debug/screen/you/tag/Science%20Fiction")?.path == [.tag(name: "Science Fiction")])
    }

    @Test func anEncodedSlashStaysInsideItsArgument() {
        #expect(route("omnibus://debug/screen/you/tag/Sci-Fi%2FFantasy")?.path == [.tag(name: "Sci-Fi/Fantasy")])
        #expect(route("omnibus://debug/screen/search/results/a%2Fb")?.path == [.searchResults(query: "a/b")])
    }

    @Test func anUnknownTabOrWordOrAMissingArgumentNamesNoRoute() {
        #expect(route("omnibus://debug/screen/home") == nil)
        #expect(route("omnibus://debug/screen/library/nowhere") == nil)
        #expect(route("omnibus://debug/screen/library/shelf") == nil)
        #expect(route("omnibus://debug/screen/library/shelf/abc") == nil)
        #expect(route("omnibus://debug/screen") == nil)
    }

    @Test func onlyDebugScreenURLsAreScreenLinks() {
        #expect(URL(string: "omnibus://debug/screen/you").flatMap(DebugScreenLink.screenSegments) == ["you"])
        #expect(URL(string: "omnibus://debug/offline?on=1").flatMap(DebugScreenLink.screenSegments) == nil)
        #expect(URL(string: "omnibus://book/u-1").flatMap(DebugScreenLink.screenSegments) == nil)
        #expect(URL(string: "https://debug/screen/you").flatMap(DebugScreenLink.screenSegments) == nil)
    }
}
