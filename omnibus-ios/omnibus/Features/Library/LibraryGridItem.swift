//  LibraryGridItem.swift
//  What each library grid cell shows once Stack series is on, and the text
//  and progress the stack cells derive from a stack.

import Foundation

/// One cell of the library grid.
enum LibraryGridItem: Hashable, Identifiable, Sendable {
    case book(Book)
    case stack(SeriesStack, lead: Book)
    case cap(SeriesStack, lead: Book)
    case volume(Book, stack: SeriesStack, index: Int, lead: Book)

    var id: String {
        switch self {
        case .book(let book): "book-\(book.uuid)"
        case .stack(let stack, _): "stack-\(stack.leadUuid)"
        case .cap(let stack, _): "cap-\(stack.leadUuid)"
        case .volume(let book, let stack, _, _): "vol-\(stack.leadUuid)-\(book.uuid)"
        }
    }

    /// The loaded page row this cell stands for — what infinite scroll keys off.
    var anchor: Book {
        switch self {
        case .book(let book): book
        case .stack(_, let lead), .cap(_, let lead), .volume(_, _, _, let lead): lead
        }
    }
}

extension LibraryModel {
    /// The cells the grid renders for the loaded pages.
    var gridItems: [LibraryGridItem] {
        Self.gridItems(books: visibleBooks, stacks: stackSeries ? stacks : [:], open: openSeries)
    }

    /// Each stacked series in its lead's slot; the open one as a head card then its volumes.
    nonisolated static func gridItems(
        books: [Book], stacks: [String: SeriesStack], open: String?
    ) -> [LibraryGridItem] {
        books.flatMap { book -> [LibraryGridItem] in
            guard let stack = stacks[book.uuid], stack.members.count >= 2 else {
                return [.book(book)]
            }
            guard stack.leadUuid == open else { return [.stack(stack, lead: book)] }
            let volumes = stack.members.enumerated().map { offset, member in
                LibraryGridItem.volume(member, stack: stack, index: offset, lead: book)
            }
            return [.cap(stack, lead: book)] + volumes
        }
    }

    /// `stacks` keyed by lead uuid.
    nonisolated static func stackIndex(_ stacks: [SeriesStack]?) -> [String: SeriesStack] {
        Dictionary((stacks ?? []).map { ($0.leadUuid, $0) }, uniquingKeysWith: { _, last in last })
    }

    /// The grid after a later page lands, minus rows for a series it already stacks.
    nonisolated static func appending(
        _ page: LibraryPageResult, to books: [Book], stacks: [String: SeriesStack]
    ) -> (books: [Book], stacks: [String: SeriesStack]) {
        let existing = Set(books.map(\.id))
        // Server and mirror can lead one series with different volumes.
        let stacked = Set(stacks.values.compactMap { LibraryIndex.stackKey($0.members.first?.series) })
        let fresh = page.books.filter { book in
            !existing.contains(book.id)
                && !(LibraryIndex.stackKey(book.series).map(stacked.contains) ?? false)
        }
        let kept = Set(fresh.map(\.uuid))
        let incoming = stackIndex(page.stacks).filter { kept.contains($0.key) }
        return (books + fresh, stacks.merging(incoming) { _, new in new })
    }
}

/// The text and progress the stack cells show.
enum StackPresentation {
    /// "Vol. N" from the series index, else the book's title.
    static func volumeTitle(_ book: Book) -> String {
        guard let index = book.seriesIndex?.nilIfBlank else { return book.displayTitle }
        return "Vol. \(index)"
    }

    /// "Read", "N% read", or the author.
    static func volumeSubtitle(_ book: Book, state: StackMemberState?) -> String {
        if state?.finished == true { return "Read" }
        if let percent = state?.percent, percent > 0 { return "\(percent)% read" }
        return book.authorDisplay
    }

    /// The VoiceOver label: the book's title first, since the caption may be only "Vol. N".
    static func volumeLabel(_ book: Book, state: StackMemberState?) -> String {
        let title = volumeTitle(book)
        let subtitle = volumeSubtitle(book, state: state)
        return title == book.displayTitle
            ? "\(title), \(subtitle)" : "\(book.displayTitle), \(title), \(subtitle)"
    }

    /// One fill fraction per member, or nil until any member is started.
    static func segments(_ stack: SeriesStack) -> [Double]? {
        guard stack.states.contains(where: \.started) else { return nil }
        return stack.members.map { member in
            guard let state = stack.state(of: member.uuid) else { return 0 }
            return state.finished ? 1 : Double(state.percent ?? 0) / 100
        }
    }

    /// Accessibility-identifier slug for a series name.
    static func slug(_ name: String) -> String {
        name.lowercased()
            .split { !$0.isLetter && !$0.isNumber }
            .joined(separator: "-")
    }
}
