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
enum ChipEditKind: String, Identifiable, Sendable {
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
}

/// The "+" that opens a chip row for a reader who may edit metadata — the
/// web hero's "+ genres" / "+ tags" pill. It leads the row rather than
/// trailing it as the web's does: the strip scrolls sideways instead of
/// wrapping, so a trailing "+" on a well-tagged book sits screens away.
/// Greyed rather than gone while offline: the save it opens onto is never
/// queued (rule 08).
struct AddChip: View {
    let kind: ChipEditKind
    var enabled = true
    var action: () -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(palette.accentColor)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .overlay(
                    Capsule().strokeBorder(
                        palette.accentColor.opacity(0.55),
                        style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                    )
                )
                .contentShape(Capsule())
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(kind.addLabel)
        .accessibilityIdentifier(kind.addIdentifier)
    }
}

/// The save behind each change: a direct call, never queued — a metadata
/// override is library-wide state every reader sees (rule 08, test 1).
enum BookChipEdits {
    /// Replace `kind`'s list on the book and return the merged record the
    /// server answers with. The two vocabulary clouds are dropped: a chip
    /// the library has never seen is a new row in one of them. The caller
    /// owns writing the merged record into the replica, once it knows this
    /// answer is still the newest one in flight.
    static func save(uuid: String, kind: ChipEditKind, values: [String]) async throws -> Book {
        let merged: Book = try await APIClient.shared.post(
            "/api/ebooks/\(uuid)/overrides", body: kind.payload(values)
        )
        await OfflineStore.shared.cacheDelete(CacheKey.genres)
        await OfflineStore.shared.cacheDelete(CacheKey.tags)
        return merged
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
    private var connectivity = Connectivity.shared
    @State private var values: [String]
    @State private var entry = ""
    @State private var pool: [SuggestionItem] = []
    @State private var error: String?
    /// Bumped per change; a response that lands for an older change is
    /// dropped, so two quick taps can't settle on the earlier list.
    @State private var generation = 0
    /// The in-flight save, if any. Each new commit awaits it before issuing
    /// its own request, so two full-list POSTs always leave in tap order —
    /// otherwise a later edit's request could land at the server before an
    /// earlier one's, and the server would settle on the wrong list.
    @State private var saveTask: Task<Void, Never>?

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

                    ChipEntryField(
                        placeholder: kind.placeholder,
                        entry: $entry,
                        current: values,
                        pool: pool,
                        autofocus: true,
                        isEnabled: connectivity.isOnline,
                        entryIdentifier: "chip-edit-entry"
                    ) { pick($0) }

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
            switch kind {
            case .genres:
                for await genres in LibraryService.genres().values() {
                    pool = SuggestionPool.collect(
                        genres.map { SuggestionItem(name: $0.name, count: $0.count) }
                    )
                }
            case .tags:
                for await tags in LibraryService.tags().values() {
                    pool = SuggestionPool.collect(
                        tags.map { SuggestionItem(name: $0.name, count: $0.count) }
                    )
                }
            }
        }
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
            .disabled(!connectivity.isOnline)
            .opacity(connectivity.isOnline ? 1 : 0.4)
            .accessibilityLabel("Remove \(value)")
        }
    }

    /// Commit `name` as a chip — from the entry field, a suggestion row, or
    /// the "+ Create" row. `ChipEntryField` clears its own entry and closes
    /// its dropdown regardless of the outcome here, so a refused duplicate
    /// still reads as understood.
    private func pick(_ name: String) {
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
        let waitFor = saveTask
        saveTask = Task {
            // Chained onto the previous commit's task, not spawned
            // independently — that's what keeps this tap's request from
            // reaching the server ahead of one the reader made earlier.
            await waitFor?.value
            do {
                let merged = try await BookChipEdits.save(uuid: book.uuid, kind: kind, values: next)
                guard mine == generation else { return }
                values = kind.values(in: merged)
                error = nil
                await Cache.write(CacheKey.book(book.uuid), merged)
                onSaved(merged)
            } catch {
                guard mine == generation else { return }
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
                Haptics.warning()
                if let current = try? await LibraryService.settledBook(uuid: book.uuid),
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
