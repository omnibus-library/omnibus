//  ChipEditSheet.swift
//  The book detail's quick genre / tag editor: the "+" chip on the Home
//  section's genre and tag rows opens this sheet, where a chip goes with a
//  tap and a new one comes from the library-wide pool or is typed fresh.
//  Every change saves at once as a `genres` / `subjects` override — the web
//  hero's "+ genres" / "+ tags" editors' contract — so there is no Save.

import SwiftUI

/// Which override-backed chip list the sheet edits. Carries the per-kind
/// copy and dispatches the pool fetch and the payload — the web's
/// `BdChipKind` split.
enum ChipEditKind: String, Identifiable, CaseIterable, Sendable {
    case genres
    case tags

    var id: String { rawValue }

    /// The row's name, as the web labels it.
    var label: String {
        switch self {
        case .genres: "Genres"
        case .tags: "Tags"
        }
    }

    var placeholder: String {
        switch self {
        case .genres: "Add a genre…"
        case .tags: "Add a tag…"
        }
    }

    /// The "+" chip's spoken name.
    var addLabel: String {
        switch self {
        case .genres: "Add genres"
        case .tags: "Add tags"
        }
    }

    var addIdentifier: String {
        switch self {
        case .genres: "book-detail-add-genres"
        case .tags: "book-detail-add-tags"
        }
    }

    /// This kind's list on a book record.
    func values(in book: Book) -> [String] {
        switch self {
        case .genres: book.genres
        case .tags: book.subjects
        }
    }

    /// The full-replacement override body for this kind, and this kind only:
    /// the server merges field-wise, so the other list is left as it was.
    func payload(_ values: [String]) -> MetadataOverridesPayload {
        switch self {
        case .genres: MetadataOverridesPayload(genres: values)
        case .tags: MetadataOverridesPayload(subjects: values)
        }
    }

    /// The library-wide suggestion pool, replica first and the server's
    /// answer after it, each already collected into dropdown order.
    func pool() -> AsyncStream<[SuggestionItem]> {
        AsyncStream { continuation in
            let task = Task {
                switch self {
                case .genres:
                    for await genres in LibraryService.genres().values() {
                        continuation.yield(SuggestionPool.collect(
                            genres.map { SuggestionItem(name: $0.name, count: $0.count) }
                        ))
                    }
                case .tags:
                    for await tags in LibraryService.tags().values() {
                        continuation.yield(SuggestionPool.collect(
                            tags.map { SuggestionItem(name: $0.name, count: $0.count) }
                        ))
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// The save behind each change: a direct call, never queued — a metadata
/// override is library-wide state every reader sees (rule 08, test 1).
enum BookChipEdits {
    /// Replace `kind`'s list on the book and return the merged record the
    /// server answers with. The replica's copy is refreshed from it, and the
    /// two vocabulary clouds dropped: a chip the library has never seen is a
    /// new row in one of them.
    static func save(uuid: String, kind: ChipEditKind, values: [String]) async throws -> Book {
        let merged: Book = try await APIClient.shared.post(
            "/api/ebooks/\(uuid)/overrides", body: kind.payload(values)
        )
        await Cache.write(CacheKey.book(uuid), merged)
        await OfflineStore.shared.cacheDelete(CacheKey.genres)
        await OfflineStore.shared.cacheDelete(CacheKey.tags)
        return merged
    }

    /// The server's current record, for resyncing after a refused save.
    static func current(uuid: String) async throws -> Book {
        let book: Book = try await APIClient.shared.get("/api/ebooks/\(uuid)")
        await Cache.write(CacheKey.book(uuid), book)
        return book
    }
}

/// The editor sheet. Each add or remove is applied to the list at once and
/// saved behind it; a refused save resyncs the list from the server, so a
/// phantom chip never outlives the request that failed to file it.
struct ChipEditSheet: View {
    let book: Book
    let kind: ChipEditKind
    /// The merged record after every successful save, for the page to adopt.
    var onSaved: (Book) -> Void

    @Environment(\.palette) private var palette
    @State private var values: [String]
    @State private var entry = ""
    @State private var pool: [SuggestionItem] = []
    @State private var error: String?
    /// Bumped per change; a response that lands for an older change is
    /// dropped, so two quick taps can't settle on the earlier list.
    @State private var generation = 0
    @FocusState private var entryFocused: Bool
    /// Whether the dropdown may show — closed after a commit until the next
    /// keystroke or refocus, as the metadata editor's chip fields do.
    @State private var open = false

    init(book: Book, kind: ChipEditKind, onSaved: @escaping (Book) -> Void) {
        self.book = book
        self.kind = kind
        self.onSaved = onSaved
        _values = State(initialValue: kind.values(in: book))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(kind.label) · \(book.displayTitle)")
                    .font(.ui(14, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(1)
                MonoNote(text: "Tap × to remove · changes save as you go")
            }
            .padding(.horizontal, 18)
            .padding(.top, 22)
            .padding(.bottom, 14)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if values.isEmpty {
                        Text("Nothing here yet.")
                            .font(.ui(13))
                            .foregroundStyle(palette.ink3Color)
                    } else {
                        FlowLayout(spacing: 7, lineSpacing: 7) {
                            ForEach(values, id: \.self) { value in
                                removableChip(value)
                            }
                        }
                        .accessibilityIdentifier("chip-edit-list")
                    }

                    entryField

                    if open {
                        let rows = SuggestionPool.filtered(
                            pool: pool, current: values, query: entry
                        )
                        let trimmed = entry.trimmingCharacters(in: .whitespacesAndNewlines)
                        let create = SuggestionPool.showsCreateRow(
                            pool: pool, current: values, typed: entry
                        ) ? trimmed : nil
                        if !rows.isEmpty || create != nil {
                            SuggestionList(items: rows, createText: create) { pick($0) }
                                .background(
                                    RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                                        .fill(palette.bg2Color.opacity(0.6))
                                )
                        }
                    }

                    if let error {
                        Text(error)
                            .font(.ui(12))
                            .foregroundStyle(palette.warnColor)
                            .accessibilityIdentifier("chip-edit-error")
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 34)
                .animation(Motion.snap, value: values)
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(palette.bg1Color)
        .task {
            for await items in kind.pool() { pool = items }
        }
        .onAppear { entryFocused = true }
        .onChange(of: entryFocused) { _, focused in open = focused }
        .onChange(of: entry) { _, newValue in
            // Only a keystroke reopens: the commit path clears the entry
            // programmatically, and that clear must not resurface the pool.
            if !newValue.isEmpty { open = true }
        }
    }

    private var entryField: some View {
        HStack(spacing: 7) {
            Image(systemName: "plus.circle")
                .font(.system(size: 14))
                .foregroundStyle(palette.ink3Color)

            TextField(kind.placeholder, text: $entry)
                .font(.ui(15))
                .foregroundStyle(palette.ink0Color)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .tint(palette.accentColor)
                .focused($entryFocused)
                .onSubmit { pick(entry) }
                .accessibilityIdentifier("chip-edit-entry")

            if !entry.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button("Add") { pick(entry) }
                    .font(.ui(13, weight: .semibold))
                    .foregroundStyle(palette.accentColor)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .fill(palette.bg2Color.opacity(0.7))
        )
    }

    private func removableChip(_ value: String) -> some View {
        HStack(spacing: 6) {
            switch kind {
            case .genres: GenreChip(label: value)
            case .tags: TagChip(label: value)
            }
            Button {
                Haptics.tap()
                commit(values.filter { $0 != value })
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(palette.ink3Color)
                    .frame(width: 22, height: 22)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(value)")
        }
    }

    /// Commit `name` as a chip — from the entry field, a suggestion row, or
    /// the "+ Create" row. The entry always clears and the dropdown closes:
    /// a refused duplicate was still understood.
    private func pick(_ name: String) {
        defer {
            entry = ""
            open = false
        }
        guard let chip = ChipEntry.committed(from: name, existing: values, deduplicating: true)
        else { return }
        Haptics.select()
        commit(values + [chip])
    }

    /// Apply the new list and save it. On a refusal the list is resynced
    /// from the server; if even that fails, the change is simply undone.
    private func commit(_ next: [String]) {
        let previous = values
        values = next
        generation += 1
        let mine = generation
        Task {
            do {
                let merged = try await BookChipEdits.save(uuid: book.uuid, kind: kind, values: next)
                guard mine == generation else { return }
                values = kind.values(in: merged)
                error = nil
                onSaved(merged)
            } catch {
                guard mine == generation else { return }
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                Haptics.warning()
                if let current = try? await BookChipEdits.current(uuid: book.uuid),
                    mine == generation
                {
                    values = kind.values(in: current)
                    onSaved(current)
                } else if mine == generation {
                    values = previous
                }
            }
        }
    }
}
