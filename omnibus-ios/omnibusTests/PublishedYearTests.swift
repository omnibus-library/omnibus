//  PublishedYearTests.swift
//  `Book.year` reads the year out of whatever `published` holds.
//
//  `books.pubdate` is normally an ISO date, but a physical-only row written
//  before the server normalized provider dates holds a locale string such as
//  `8/4/2015`, and taking the first four characters rendered it as `8/4/` in
//  the search row and the detail eyebrow (#2510).

import Testing

@testable import omnibus

@Suite("Book.year")
struct PublishedYearTests {
    @Test("reads the leading year of an ISO date or a bare year")
    func isoShapes() {
        #expect(Book.year(in: "2022-06-14") == "2022")
        #expect(Book.year(in: "1965") == "1965")
        #expect(Book.year(in: "2015-08") == "2015")
    }

    @Test("finds the year inside a locale-formatted provider date")
    func localeShapes() {
        #expect(Book.year(in: "8/4/2015") == "2015")
        #expect(Book.year(in: "August 4, 2015") == "2015")
    }

    @Test("never answers a truncated fragment")
    func noYear() {
        #expect(Book.year(in: "8/4/") == nil)
        #expect(Book.year(in: "n.d.") == nil)
        #expect(Book.year(in: "12345") == nil)
    }
}
