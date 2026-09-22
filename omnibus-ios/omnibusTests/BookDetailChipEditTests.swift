//  BookDetailChipEditTests.swift
//  The book detail's quick genre / tag editor: which list each kind reads
//  and writes, the override body a change files, and the Home section's
//  lifted shape under each layout — the flow never trims, so its tags and
//  blurb can't jump as the list rises.

import Testing

@testable import omnibus

struct BookDetailChipEditTests {
    private func book(genres: [String] = [], subjects: [String] = []) -> Book {
        var book = Book(id: 7, filename: "book.epub")
        book.genres = genres
        book.subjects = subjects
        return book
    }

    // MARK: - Which list a kind edits

    @Test func genresKindReadsTheBooksGenres() {
        let kind = ChipEditKind.genres
        #expect(kind.values(in: book(genres: ["Fantasy"], subjects: ["epic"])) == ["Fantasy"])
    }

    @Test func tagsKindReadsTheBooksSubjects() {
        let kind = ChipEditKind.tags
        #expect(kind.values(in: book(genres: ["Fantasy"], subjects: ["epic"])) == ["epic"])
    }

    @Test func genresPayloadReplacesGenresAndLeavesSubjectsAlone() {
        let payload = ChipEditKind.genres.payload(["Fantasy", "Romance"])
        #expect(payload.genres == ["Fantasy", "Romance"])
        #expect(payload.subjects == nil)
    }

    @Test func tagsPayloadReplacesSubjectsAndLeavesGenresAlone() {
        let payload = ChipEditKind.tags.payload(["epic", "dragons"])
        #expect(payload.subjects == ["epic", "dragons"])
        #expect(payload.genres == nil)
    }

    @Test func anEmptyListStillFilesAsAReplacementNotANoOp() {
        // Removing the last chip must clear the override list, not send `{}`
        // — which the server treats as an empty-but-present override row.
        let payload = ChipEditKind.tags.payload([])
        #expect(payload.subjects == [])
        #expect(!payload.isEmpty)
    }

    // MARK: - The Home section's shape

    @Test func marqueeHomeTrimsAtRestAndFillsOutOnceLifted() {
        #expect(!DetailRead.homeLifted(scrollStops: true, lifted: false))
        #expect(DetailRead.homeLifted(scrollStops: true, lifted: true))
    }

    @Test func flowHomeIsAlwaysWholeSoNothingJumpsAsTheListRises() {
        #expect(DetailRead.homeLifted(scrollStops: false, lifted: false))
        #expect(DetailRead.homeLifted(scrollStops: false, lifted: true))
    }

    // MARK: - Chip rows

    @Test func anEmptyRowStillShowsForAnEditorSoTheFirstChipCanBeAdded() {
        #expect(DetailRead.showsChipRow(values: [], canEdit: true))
    }

    @Test func anEmptyRowIsHiddenFromAReaderWhoCannotEdit() {
        #expect(!DetailRead.showsChipRow(values: [], canEdit: false))
    }
}
