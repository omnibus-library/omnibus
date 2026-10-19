//  StackedBookGrid.swift
//  Stack series on every book grid: the cell each one draws, and a grid that
//  folds a whole list — a shelf, an author, a tag, a search — client-side,
//  the way the server folds a library page. Each screen still supplies its
//  own link and long-press menu around a book's cover.

import SwiftUI

/// One grid cell: a book, a folded series, an opened series' head card, or one of its volumes.
struct StackedGridCell<BookLink: View>: View {
    let item: LibraryGridItem
    /// Opens a series in place by its lead uuid, or folds it with nil.
    let setOpen: (String?) -> Void
    let link: (Book, BookGridCell) -> BookLink

    @Environment(\.palette) private var palette

    // Explicit: the private environment property would make the memberwise init private.
    init(
        item: LibraryGridItem,
        setOpen: @escaping (String?) -> Void,
        @ViewBuilder link: @escaping (Book, BookGridCell) -> BookLink
    ) {
        self.item = item
        self.setOpen = setOpen
        self.link = link
    }

    var body: some View {
        switch item {
        case .book(let book):
            link(book, BookGridCell(book: book))
        case .stack(let stack, _):
            Button { setOpen(stack.leadUuid) } label: {
                SeriesStackCell(stack: stack)
            }
            .buttonStyle(BookPressStyle())
            .accessibilityLabel("\(stack.name), \(stack.members.count) books")
            .accessibilityHint("Opens the series in place")
            .accessibilityIdentifier("library-stack-\(StackPresentation.slug(stack.name))")
        case .cap(let stack, _):
            SeriesCapCell(stack: stack) { setOpen(nil) }
        case .volume(let book, let stack, let index, _):
            volume(book, stack: stack, index: index)
        }
    }

    private func volume(_ book: Book, stack: SeriesStack, index: Int) -> some View {
        let tint = stack.palette(over: palette).accentColor
        let state = stack.state(of: book.uuid)
        let progress: (fraction: Double, tint: Color)? = {
            guard let state, state.started, !state.finished, let percent = state.percent, percent > 0
            else { return nil }
            return (Double(percent) / 100, tint)
        }()
        let cell = BookGridCell(
            book: book,
            caption: (
                StackPresentation.volumeTitle(book),
                StackPresentation.volumeSubtitle(book, state: state)
            ),
            progress: progress
        )
        return link(book, cell)
            .accessibilityLabel(StackPresentation.volumeLabel(book, state: state))
            .background { SeriesBand(tint: tint, trailing: index == stack.members.count - 1) }
    }
}

/// A cover grid over a whole list, stacked while the viewer's Stack series is on.
struct StackedBookGrid<BookLink: View>: View {
    let books: [Book]
    let density: CoverGridDensity
    let link: (Book, BookGridCell) -> BookLink

    @Environment(AppState.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The lead uuid of the series dealt out in place, if any.
    @State private var openSeries: String?

    init(
        _ books: [Book],
        density: CoverGridDensity = .regular,
        @ViewBuilder link: @escaping (Book, BookGridCell) -> BookLink
    ) {
        self.books = books
        self.density = density
        self.link = link
    }

    private var items: [LibraryGridItem] {
        LibraryGridItem.items(books, stacking: app.user?.stackSeries == true, open: openSeries)
    }

    var body: some View {
        CoverGrid(items, density: density) { item in
            StackedGridCell(item: item, setOpen: setOpen, link: link)
        }
    }

    /// One series is open at a time.
    private func setOpen(_ lead: String?) {
        Haptics.select()
        withAnimation(reduceMotion ? nil : Motion.glide) { openSeries = lead }
    }
}
