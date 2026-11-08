//  BookEntity.swift
//  A library book as Siri, Shortcuts and Spotlight see it.
//
//  Resolved from the on-device mirror, so naming a book works offline. Siri
//  resolves a spoken title through `entities(matching:)`; more than one match
//  makes it ask which book was meant.

import AppIntents
import CoreSpotlight
import Foundation

struct BookEntity: AppEntity, IndexedEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Book"
    static let defaultQuery = BookEntityQuery()

    let id: String

    @Property(title: "Title")
    var title: String

    @Property(title: "Author")
    var author: String

    @Property(title: "Series")
    var series: String?

    /// Whether the book has an audiobook to play.
    var hasAudiobook: Bool

    init(_ book: Book) {
        id = book.uuid
        hasAudiobook = book.hasAudiobook
        title = book.displayTitle
        author = book.authorDisplay
        series = book.series?.nilIfBlank
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(author)")
    }

    /// Metadata only: no book text, no reading state.
    var attributeSet: CSSearchableItemAttributeSet {
        let set = defaultAttributeSet
        set.title = title
        set.displayName = title
        set.authorNames = [author]
        set.contentDescription = series.map { "\(author) · \($0)" } ?? author
        return set
    }
}

struct BookEntityQuery: EntityStringQuery {
    /// How many books a spoken title resolves to before Siri asks which.
    static let matchLimit = 10

    func entities(for identifiers: [BookEntity.ID]) async throws -> [BookEntity] {
        var found: [BookEntity] = []
        for uuid in identifiers {
            if let book = await SiriLibrary.book(uuid: uuid) { found.append(BookEntity(book)) }
        }
        return found
    }

    func entities(matching string: String) async throws -> [BookEntity] {
        try await SiriLibrary.requireReady()
        return await SiriLibrary.search(spoken: string, limit: Self.matchLimit).map(BookEntity.init)
    }

    /// The Continue rail: what someone is most likely to name. The replica's
    /// only: a rail change re-offers it once stored, and asking the server
    /// here would race that store.
    func suggestedEntities() async throws -> [BookEntity] {
        guard await SiriLibrary.readiness() == .ready else { return [] }
        let rail: [ResumePoint]? = await Cache.cachedOnly(CacheKey.recentProgress)
        return (rail ?? []).map { BookEntity($0.book) }
    }
}
