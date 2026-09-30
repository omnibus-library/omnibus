//  SearchSectionTests.swift
//  A results section that counts more than it shows offers "All N", and that
//  link reaches the N it counted: books to a book grid, every other section to
//  its own index narrowed to the query.

import Testing

@testable import omnibus

struct SearchSectionTests {
    @Test("the tags section offers All N, onto the tag index narrowed to the query")
    func tagsSeeAllOpensTheNarrowedTagIndex() {
        #expect(
            SearchSection.taxonomy(.tag).seeAll(query: "fiction", total: 20, shown: 5)
                == .taxonomyMatching(.tag, query: "fiction")
        )
    }

    @Test("genres reach their own index, not the tags'")
    func genresSeeAllOpensTheGenreIndex() {
        #expect(
            SearchSection.taxonomy(.genre).seeAll(query: "fic", total: 9, shown: 5)
                == .taxonomyMatching(.genre, query: "fic")
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

    @Test("the narrowed index keeps the names containing the query, in any case")
    func narrowedIndexIsACaseInsensitiveSubstringMatch() {
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
