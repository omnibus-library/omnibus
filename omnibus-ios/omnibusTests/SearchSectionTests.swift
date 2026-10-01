//  SearchSectionTests.swift
//  A results section that counts more than it shows offers "All N", and that
//  link reaches the N it counted: books to a book grid, authors and series to
//  their own index narrowed to the query, tags and genres to the palette's own
//  matches — and says so when the server handed over fewer than it counted.

import Foundation
import Testing

@testable import omnibus

struct SearchSectionTests {
    @Test("the tags section offers All N, onto the palette's matches for the query")
    func tagsSeeAllOpensThePaletteMatches() {
        #expect(
            SearchSection.taxonomy(.tag).seeAll(query: "fiction", total: 20, shown: 5)
                == .taxonomyMatching(.tag, query: "fiction", total: 20)
        )
    }

    @Test("genres reach their own matches, not the tags'")
    func genresSeeAllOpensTheGenreMatches() {
        #expect(
            SearchSection.taxonomy(.genre).seeAll(query: "fic", total: 9, shown: 5)
                == .taxonomyMatching(.genre, query: "fic", total: 9)
        )
    }

    @Test("books keep their grid; authors and series reach their own lists")
    func eachSectionReachesItsOwnList() {
        #expect(
            SearchSection.books.seeAll(query: "the", total: 12, shown: 5)
                == .searchResults(query: "the")
        )
        #expect(
            SearchSection.authors.seeAll(query: "le", total: 7, shown: 5)
                == .authorsMatching(query: "le")
        )
        #expect(
            SearchSection.series.seeAll(query: "sea", total: 6, shown: 5)
                == .seriesMatching(query: "sea")
        )
    }

    @Test("a section that shows everything it counted offers no link")
    func noLinkWhenNothingIsHidden() {
        #expect(SearchSection.taxonomy(.tag).seeAll(query: "x", total: 5, shown: 5) == nil)
        #expect(SearchSection.books.seeAll(query: "x", total: 3, shown: 3) == nil)
    }

    @Test("All N asks the palette for all N, up to the server's ceiling")
    func sectionRequestAsksForTheWholeSection() throws {
        let url = try #require(APIClient.requestURL(
            base: "http://library.test", path: "/api/search/palette",
            query: LibraryService.paletteSectionQuery("science fiction", total: 37)
        ))
        let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(url.path == "/api/search/palette")
        #expect(items.first { $0.name == "q" }?.value == "science fiction")
        #expect(items.first { $0.name == "limit" }?.value == "37")

        #expect(LibraryService.paletteSectionQuery("a", total: 812)["limit"] == "500")
    }

    @Test("every tag the palette returned is listed, with no note when it is all of them")
    func matchesListEveryHitWhenComplete() {
        var results = PaletteResults()
        results.tags = [
            PaletteTagHit(id: 1, name: "Fiction", bookCount: 9),
            PaletteTagHit(id: 2, name: "Obscure Fiction", bookCount: 1),
        ]
        results.tagTotal = 2
        let matches = TaxonomyMatches(results, facet: .tag)
        #expect(matches.entries == [
            TagWeight(name: "Fiction", count: 9),
            TagWeight(name: "Obscure Fiction", count: 1),
        ])
        #expect(matches.cutNote == nil)
    }

    @Test("past the ceiling the screen says how many it is showing of how many")
    func matchesDiscloseTheCeiling() {
        var results = PaletteResults()
        results.tags = (1...500).map { PaletteTagHit(id: Int64($0), name: "t\($0)", bookCount: 1) }
        results.tagTotal = 812
        #expect(
            TaxonomyMatches(results, facet: .tag).cutNote
                == "Showing the first 500 of 812 \u{2014} narrow your search to see the rest."
        )
    }

    @Test("a server that ignores limit answers five, and the screen says so")
    func olderServerFiveHitsAreDisclosed() throws {
        let results = try JSONDecoder().decode(PaletteResults.self, from: Data("""
            {"query":"fic","books":[],"authors":[],"series":[],"tags":[],
             "genres":[{"name":"a","book_count":1},{"name":"b","book_count":1},
                       {"name":"c","book_count":1},{"name":"d","book_count":1},
                       {"name":"e","book_count":1}],
             "duration_ms":1,"book_total":0,"author_total":0,"series_total":0,
             "tag_total":0,"genre_total":9}
            """.utf8))
        let matches = TaxonomyMatches(results, facet: .genre)
        #expect(matches.entries.map(\.name) == ["a", "b", "c", "d", "e"])
        #expect(matches.cutNote?.hasPrefix("Showing the first 5 of 9") == true)
    }

    @Test("the tag index's filter keeps the names containing the query, in any case")
    func indexFilterIsACaseInsensitiveSubstringMatch() {
        let tags = [
            TagWeight(name: "Science Fiction", count: 4),
            TagWeight(name: "Fiction", count: 9),
            TagWeight(name: "Unicorns", count: 1),
        ]
        #expect(
            TaxonomyCloudView.filtered(tags, by: "FICTION").map(\.name)
                == ["Science Fiction", "Fiction"]
        )
        #expect(TaxonomyCloudView.filtered(tags, by: "  ").count == 3)
    }
}
