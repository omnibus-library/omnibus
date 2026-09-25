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
        Self.gridItems(books: visibleBooks, stacks: stacks, open: openSeries)
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
}

/// The text and progress the stack cells show.
enum StackPresentation {
    /// "Vol. N" from the series index, else the book's title.
    static func volumeTitle(_ book: Book) -> String {
        guard let index = book.seriesIndex?.trimmingCharacters(in: .whitespaces), !index.isEmpty else {
            return book.displayTitle
        }
        return "Vol. \(index)"
    }

    /// "Read", "N% read", or the author.
    static func volumeSubtitle(_ book: Book, state: StackMemberState?) -> String {
        if state?.finished == true { return "Read" }
        if let percent = state?.percent, percent > 0 { return "\(percent)% read" }
        return book.authorDisplay
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
