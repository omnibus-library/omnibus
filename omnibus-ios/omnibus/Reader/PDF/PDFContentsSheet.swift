//  PDFContentsSheet.swift
//  Contents, bookmarks, and notes for the PDF reader, behind one segmented
//  sheet — the EPUB reader's sheet, with page numbers where it has CFIs.
//  Every row is a jump to a 0-based page.

import SwiftUI

struct PDFContentsSheet: View {
    let book: Book
    let outline: [PDFOutlineItem]
    let currentPage: Int
    let pageCount: Int
    let highlights: [Highlight]
    var initialTab: Tab = .contents
    var onJump: (Int) -> Void
    var onRemoveHighlight: (Highlight) -> Void
    var onBookmarkCountChanged: (Int) -> Void = { _ in }

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var tab: Tab?
    @State private var bookmarks: [Bookmark] = []
    @State private var isLoadingBookmarks = true

    enum Tab: String, CaseIterable {
        case contents, bookmarks, notes

        var label: String {
            switch self {
            case .contents: "Contents"
            case .bookmarks: "Bookmarks"
            case .notes: "Notes"
            }
        }
    }

    private var selectedTab: Binding<Tab> {
        Binding(get: { tab ?? initialTab }, set: { tab = $0 })
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            Picker("View", selection: selectedTab) {
                ForEach(Tab.allCases, id: \.self) { tab in
                    Text(tab.label).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .screenPadding()
            .padding(.bottom, Spacing.md)

            Group {
                switch selectedTab.wrappedValue {
                case .contents: contentsList
                case .bookmarks: bookmarksList
                case .notes: notesList
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(ScreenBackground())
        .presentationDetents([.large])
        .task { await loadBookmarks() }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            BookCover(identity: CoverIdentity(book), size: .sm, cornerRadius: 4)
                .frame(width: 46)

            VStack(alignment: .leading, spacing: 2) {
                Text(book.displayTitle)
                    .font(.display(23))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(2)
                if pageCount > 0 {
                    Text("Page \(currentPage + 1) of \(pageCount)")
                        .font(.ui(13))
                        .foregroundStyle(palette.ink2Color)
                }
            }

            Spacer(minLength: Spacing.sm)

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(palette.ink1Color)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(palette.bg2Color))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Done")
        }
        .screenPadding()
        .padding(.top, Spacing.lg)
        .padding(.bottom, Spacing.lg)
    }

    private func jump(to page: Int) {
        onJump(page)
        dismiss()
    }

    // MARK: - Contents

    /// The outline entry the reader is inside: the last one whose page is
    /// at or before the current page.
    private var currentItemID: Int? {
        outline.last { ($0.page ?? .max) <= currentPage }?.id
    }

    @ViewBuilder
    private var contentsList: some View {
        if outline.isEmpty {
            EmptyStateView(
                icon: "list.bullet",
                title: "No table of contents",
                message: "This PDF ships without an outline — the slider still moves you through it."
            )
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(outline) { item in
                            outlineRow(item, isFirst: item.id == outline.first?.id)
                                .id(item.id)
                        }
                        RecordRule()
                    }
                    .screenPadding()
                    .padding(.bottom, 32)
                }
                .scrollIndicators(.hidden)
                .onAppear {
                    guard let current = currentItemID else { return }
                    proxy.scrollTo(current, anchor: .center)
                }
            }
        }
    }

    private func outlineRow(_ item: PDFOutlineItem, isFirst: Bool) -> some View {
        let isCurrent = item.id == currentItemID
        let isPart = item.level == 0

        return Button {
            if let page = item.page { jump(to: page) }
        } label: {
            VStack(spacing: 0) {
                if !isFirst { Hairline() }

                HStack(alignment: .firstTextBaseline, spacing: Spacing.md) {
                    Capsule()
                        .fill(isCurrent ? palette.accentColor : .clear)
                        .frame(width: 2.5, height: 15)

                    Text(item.label)
                        .font(.ui(15.5, weight: isCurrent ? .semibold : (isPart ? .medium : .regular)))
                        .foregroundStyle(isCurrent ? palette.accentColor : palette.ink1Color)
                        .multilineTextAlignment(.leading)
                        .padding(.leading, CGFloat(item.level) * 16)

                    Spacer(minLength: Spacing.sm)

                    if let page = item.page {
                        Text("\(page + 1)")
                            .font(.ui(14))
                            .foregroundStyle(isCurrent ? palette.accentColor : palette.ink3Color)
                            .monospacedDigit()
                    }
                }
                .padding(.vertical, 13)
                .contentShape(Rectangle())
            }
        }
        .buttonStyle(PressableStyle())
        .disabled(item.page == nil)
    }

    // MARK: - Bookmarks

    @ViewBuilder
    private var bookmarksList: some View {
        if isLoadingBookmarks {
            LoadingView()
        } else if bookmarks.isEmpty {
            EmptyStateView(
                icon: "bookmark",
                title: "No bookmarks",
                message: "Tap the ribbon while reading to save your place."
            )
        } else {
            List {
                ForEach(bookmarks) { bookmark in
                    Button {
                        if let page = PDFAnchor.page(of: bookmark.position) { jump(to: page) }
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(bookmark.title?.nilIfBlank ?? "Saved position")
                                .font(.ui(15, weight: .medium))
                                .foregroundStyle(palette.ink0Color)
                            Text(Format.relative(unix: bookmark.createdAt))
                                .font(.ui(11))
                                .foregroundStyle(palette.ink3Color)
                        }
                    }
                    .listRowBackground(palette.bg1Color)
                }
                .onDelete { offsets in
                    Task { await deleteBookmarks(at: offsets) }
                }
            }
            .scrollContentBackground(.hidden)
        }
    }

    private func loadBookmarks() async {
        for await items in UserDataService.bookmarks(uuid: book.uuid).values() {
            bookmarks = items
            isLoadingBookmarks = false
            onBookmarkCountChanged(items.count)
        }
        isLoadingBookmarks = false
    }

    private func deleteBookmarks(at offsets: IndexSet) async {
        let doomed = offsets.map { bookmarks[$0] }
        bookmarks.remove(atOffsets: offsets)
        onBookmarkCountChanged(bookmarks.count)
        for bookmark in doomed {
            await UserDataService.deleteBookmark(bookmark)
        }
    }

    // MARK: - Notes

    @ViewBuilder
    private var notesList: some View {
        if highlights.isEmpty {
            EmptyStateView(
                icon: "highlighter",
                title: "No highlights",
                message: "Select any passage to highlight it or attach a note."
            )
        } else {
            List {
                ForEach(sortedHighlights) { highlight in
                    Button {
                        // Anchorless (Kobo-origin) rows and a mixed book's
                        // EPUB highlights have nowhere on these pages to go.
                        if let anchor = highlight.epubCFIRange, let page = PDFAnchor.page(of: anchor) {
                            jump(to: page)
                        }
                    } label: {
                        highlightRow(highlight)
                    }
                    .listRowBackground(palette.bg1Color)
                }
                .onDelete { offsets in
                    for index in offsets {
                        onRemoveHighlight(sortedHighlights[index])
                    }
                }
            }
            .scrollContentBackground(.hidden)
        }
    }

    private var sortedHighlights: [Highlight] {
        highlights.sorted { $0.createdAt > $1.createdAt }
    }

    private func highlightRow(_ highlight: Highlight) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Capsule()
                .fill(highlight.color.tint)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 5) {
                if let text = highlight.text?.nilIfBlank {
                    Text(text)
                        .font(.display(18))
                        .foregroundStyle(palette.ink1Color)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
                if let note = highlight.note?.nilIfBlank {
                    Text(note)
                        .font(.ui(12))
                        .foregroundStyle(palette.ink2Color)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                HStack(spacing: Spacing.xs) {
                    if let anchor = highlight.epubCFIRange, let page = PDFAnchor.page(of: anchor) {
                        Text("Page \(page + 1) ·")
                    }
                    Text(Format.relative(unix: highlight.createdAt))
                }
                .font(.ui(11))
                .foregroundStyle(palette.ink3Color)
            }
        }
        .padding(.vertical, 4)
    }
}
