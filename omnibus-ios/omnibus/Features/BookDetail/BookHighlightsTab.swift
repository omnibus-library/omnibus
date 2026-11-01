//  BookHighlightsTab.swift
//  The Highlights tab: every kept line with its color hung off it as a ribbon,
//  then the journal everyone reading this book writes in — and the drawer an
//  entry opens into.

import SwiftUI

struct BookHighlightsTab: View {
    let book: Book
    let model: BookDetailModel
    /// The signed-in reader, whose own entries read without a name.
    var viewerId: Int64?
    var onQuote: (Highlight) -> Void
    var onOpenInBook: (Highlight) -> Void
    var onWrite: () -> Void
    var onOpenEntry: (JournalEntry) -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            heading("Highlights", count: model.highlights.count)

            if model.highlights.isEmpty {
                Text("Highlight while you read to keep passages here.")
                    .font(.ui(16))
                    .foregroundStyle(palette.ink1Color)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            } else {
                // Lazy: a heavily-annotated book's list has no upper bound.
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(model.highlights) { highlight in
                        KeptLineRow(
                            highlight: highlight,
                            chapter: ChapterLocator.label(
                                chapters: model.chapters, cfi: highlight.epubCFIRange
                            ),
                            opensInBook: DetailRead.opensInBook(
                                hasEpub: book.hasEpub, anchor: highlight.epubCFIRange
                            ),
                            onQuote: { onQuote(highlight) },
                            onOpenInBook: { onOpenInBook(highlight) },
                            onChange: { Task { await model.load(uuid: book.uuid) } }
                        )
                    }
                }
            }

            HStack(spacing: 16) {
                heading("Journal", count: model.journals.count)
                Spacer(minLength: 0)
                Button {
                    Haptics.tap()
                    onWrite()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "plus")
                            .font(.system(size: 12, weight: .bold))
                        Text("New entry")
                            .font(.ui(15, weight: .semibold))
                    }
                    .foregroundStyle(palette.ink0Color)
                    .padding(.horizontal, 2)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("journal-new-entry")
            }
            .padding(.top, 32)

            if model.journals.isEmpty {
                switch model.journalsAnswer {
                case .waiting:
                    EmptyView()
                case .failed:
                    Text("Entries couldn\u{2019}t be loaded.")
                        .font(.ui(16))
                        .foregroundStyle(palette.ink1Color)
                        .padding(.top, 4)
                    Button("Try again") { Task { await model.load(uuid: book.uuid) } }
                        .font(.ui(15, weight: .semibold))
                        .foregroundStyle(palette.bookText)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("journal-retry")
                case .known:
                    Text("No entries yet. Be the first to write one. Anyone reading this book can add to the journal.")
                        .font(.ui(16))
                        .foregroundStyle(palette.ink1Color)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                }
            } else {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(model.journals) { entry in
                        JournalCard(entry: entry, viewerId: viewerId) { onOpenEntry(entry) }
                    }
                }
                .padding(.top, 10)
            }
        }
    }

    private func heading(_ title: String, count: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(.display(30, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .accessibilityAddTraits(.isHeader)
            if count > 0 {
                Text("\(count)")
                    .font(.ui(17, weight: .medium))
                    .foregroundStyle(palette.ink2Color)
            }
        }
    }
}

/// One kept line: the passage in the reading face, its color hung off the edge
/// as a ribbon, where it was and when, and what can be done with it.
struct KeptLineRow: View {
    let highlight: Highlight
    var chapter: String?
    /// Whether the line can be opened at: a CFI in a book that has an EPUB. A
    /// PDF's kept line anchors differently, and a Kobo's has no anchor at all.
    var opensInBook = false
    var onQuote: () -> Void
    var onOpenInBook: () -> Void
    /// Run after a write, for the page to read the list again.
    var onChange: () -> Void

    @Environment(\.palette) private var palette
    @State private var editingNote = false
    @State private var noteDraft = ""

    /// The passage a card can be made from, or `nil` when the row carries
    /// none — Kobo-origin rows can arrive without text, and a card of nothing
    /// is not worth a sheet.
    static func quotable(_ highlight: Highlight) -> String? {
        highlight.text?.nilIfBlank
    }

    /// Where the footer places it: its chapter when known, then the day.
    static func footer(
        chapter: String?, createdAt: Int64, now: Date = Date()
    ) -> String {
        [chapter, DetailFormat.shortDay(unix: createdAt, now: now)]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let text = highlight.text?.nilIfBlank {
                Text(text)
                    .font(.display(22, weight: .medium))
                    .foregroundStyle(palette.ink0Color)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("A passage kept on another device, with no text to show here.")
                    .font(.ui(15))
                    .foregroundStyle(palette.ink1Color)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let note = highlight.note?.nilIfBlank {
                Text(note)
                    .font(.ui(15))
                    .foregroundStyle(palette.ink1Color)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }

            HStack(spacing: Spacing.md) {
                Text(Self.footer(chapter: chapter, createdAt: highlight.createdAt))
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
                Spacer(minLength: 0)
                actions
            }
        }
        .padding(.top, 18)
        .padding(.bottom, 6)
        .padding(.trailing, 30)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .topTrailing) {
            RibbonShape()
                .fill(highlight.color.tint)
                .frame(width: 13, height: 32)
                .shadow(color: .black.opacity(0.45), radius: 1, x: 1, y: 2)
                .offset(x: -2, y: -1)
                .accessibilityLabel("\(highlight.color.label) highlight")
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(palette.line.color).frame(height: 0.5)
        }
        .alert(
            highlight.note?.nilIfBlank == nil ? "Add a note" : "Edit note",
            isPresented: $editingNote
        ) {
            TextField("Note", text: $noteDraft, axis: .vertical)
            Button("Save") {
                Task {
                    await UserDataService.setHighlightNote(highlight, note: noteDraft.nilIfBlank)
                    onChange()
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var actions: some View {
        Menu {
            if Self.quotable(highlight) != nil {
                Button {
                    onQuote()
                } label: {
                    Label("Make a quote card", systemImage: "quote.bubble")
                }
            }
            if opensInBook {
                Button {
                    onOpenInBook()
                } label: {
                    Label("Open in book", systemImage: "book")
                }
            }
            Button {
                noteDraft = highlight.note ?? ""
                editingNote = true
            } label: {
                Label(
                    highlight.note?.nilIfBlank == nil ? "Add a note" : "Edit note",
                    systemImage: "square.and.pencil"
                )
            }
            Menu {
                ForEach(HighlightColor.allCases, id: \.self) { color in
                    Button {
                        Haptics.select()
                        Task {
                            await UserDataService.setHighlightColor(highlight, color: color)
                            onChange()
                        }
                    } label: {
                        if color == highlight.color {
                            Label(color.label, systemImage: "checkmark")
                        } else {
                            Text(color.label)
                        }
                    }
                }
            } label: {
                Label("Color", systemImage: "paintpalette")
            }
            Divider()
            Button(role: .destructive) {
                Task {
                    await UserDataService.deleteHighlight(highlight)
                    onChange()
                }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(palette.ink1Color)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .padding(.trailing, -42)
        .accessibilityLabel("Highlight actions")
    }
}

/// One journal entry on the tab: who and when, and how it opens.
private struct JournalCard: View {
    let entry: JournalEntry
    var viewerId: Int64?
    var onOpen: () -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        Button {
            Haptics.tap()
            onOpen()
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(DetailJournal.byline(entry, viewerId: viewerId))
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
                MaskedText(runs: DetailJournal.preview(entry.bodyMd))
                    .font(.ui(16))
                    .foregroundStyle(palette.ink0Color.opacity(0.9))
                    .lineLimit(4)
                    .multilineTextAlignment(.leading)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.bg1Color)
            )
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressableStyle())
    }
}

/// One entry, in the drawer the tab opens: takes the height it needs, caps at
/// the medium detent, leaves the page visible behind it.
struct JournalDrawer: View {
    let entry: JournalEntry
    let isMine: Bool
    var onEdit: () -> Void
    var onDelete: () -> Void

    @Environment(\.palette) private var palette
    @State private var confirmDelete = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            JournalByline(entry: entry, avatarSize: 34, isMine: isMine)
                .padding(.horizontal, 18)
                .padding(.top, 20)
                .padding(.bottom, 12)

            ScrollView {
                JournalBody(md: entry.bodyMd)
                    .padding(.horizontal, 18)
                    .padding(.bottom, 20)
            }

            if isMine {
                HStack(spacing: 10) {
                    Button {
                        Haptics.tap()
                        onEdit()
                    } label: {
                        Text("Edit")
                    }
                    .buttonStyle(BarCTAStyle())

                    Button {
                        confirmDelete = true
                    } label: {
                        Text("Delete")
                            .font(.ui(17, weight: .semibold))
                            .foregroundStyle(palette.badColor)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .background(Capsule().fill(palette.quietFill))
                    }
                    .buttonStyle(PressableStyle())
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background {
                    palette.bg2Color.opacity(0.4)
                        .overlay(alignment: .top) { Hairline() }
                        .ignoresSafeArea(edges: .bottom)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(palette.bg1Color)
        .confirmationDialog(
            "Delete this entry?", isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { onDelete() }
            Button("Cancel", role: .cancel) {}
        }
    }
}

/// Who wrote an entry, and where they were in the book.
struct JournalByline: View {
    let entry: JournalEntry
    var avatarSize: CGFloat
    var isMine = false

    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 10) {
            UserAvatar(
                id: entry.authorId,
                name: entry.authorName,
                hasAvatar: entry.authorHasAvatar,
                size: avatarSize
            )
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(entry.authorName)
                        .foregroundStyle(palette.ink0Color)
                    if isMine {
                        Text("· you")
                            .foregroundStyle(palette.bookText)
                    }
                }
                .font(.ui(14, weight: .semibold))
                Text(bylineDetail)
                    .font(.ui(13))
                    .foregroundStyle(palette.ink1Color)
            }
        }
    }

    private var bylineDetail: String {
        var parts: [String] = []
        if let progress = entry.progress { parts.append("At \(progress)%") }
        parts.append(DetailFormat.day(unix: entry.createdAt))
        if entry.status == .draft { parts.append("Draft") }
        return parts.joined(separator: " · ")
    }
}
