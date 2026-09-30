//  GenreSearchTests.swift
//  Genres as a search surface: the palette decodes them (and tolerates a
//  server that predates them), and a genre opens its own books.

import Foundation
import Testing
import UIKit

@testable import omnibus

struct GenreSearchTests {
    private func decode(_ json: String) throws -> PaletteResults {
        try JSONDecoder().decode(PaletteResults.self, from: Data(json.utf8))
    }

    @Test("the palette's genre hits and their total decode")
    func paletteDecodesGenres() throws {
        let results = try decode("""
            {"query":"fic","books":[],"authors":[],"series":[],"tags":[],
             "genres":[{"name":"Contemporary Fiction","book_count":3}],
             "duration_ms":1,"book_total":0,"author_total":0,"series_total":0,
             "tag_total":0,"genre_total":7}
            """)
        #expect(results.genres == [PaletteGenreHit(name: "Contemporary Fiction", bookCount: 3)])
        #expect(results.genreTotal == 7)
    }

    @Test("a server from before genres still decodes, with none")
    func paletteWithoutGenresStillDecodes() throws {
        let results = try decode("""
            {"query":"fic","books":[],"authors":[],"series":[],"tags":[],
             "duration_ms":1,"book_total":0,"author_total":0,"series_total":0,"tag_total":0}
            """)
        #expect(results.genres.isEmpty)
        #expect(results.genreTotal == nil)
    }

    @Test("a genre hit alone is a result, not the no-matches state")
    func genreOnlyResultsAreNotEmpty() {
        var results = PaletteResults()
        results.genres = [PaletteGenreHit(name: "Horror", bookCount: 1)]
        #expect(!results.isEmpty)
    }

    @Test("a genre opens its own books, a tag its own")
    func facetsOpenTheirOwnScreens() {
        #expect(SearchFacet.genre.destination("Horror") == .genre(name: "Horror"))
        #expect(SearchFacet.tag.destination("Horror") == .tag(name: "Horror"))
    }

    @Test("the browse tiles' glyphs resolve")
    func facetGlyphsResolve() {
        #expect(UIImage(systemName: SearchFacet.tag.glyph) != nil)
        #expect(UIImage(systemName: SearchFacet.genre.glyph) != nil)
    }
}
