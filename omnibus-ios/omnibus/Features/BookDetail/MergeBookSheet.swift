//  MergeBookSheet.swift
//  Admin "Merge with…" on book detail: find the other entry, confirm, merge.
//  The page's book is always the target — its metadata wins — and the merge
//  returns the undo handle the parent's toast holds. Port of the web
//  `MergeDialog` (frontend/src/components/merge_dialog.rs).

import SwiftUI

struct MergeBookSheet: View {
    /// The book that survives.
    let target: Book
    /// Run with the merge's result; the sheet dismisses itself first.
    var onMerged: (MergeBooksResult) -> Void

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var candidates: [Book] = []
    @State private var searching = false
    @State private var searchTask: Task<Void, Never>?
    /// The candidate picked from the list — showing means the confirm step.
    @State private var source: Book?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let source {
                    confirm(source)
                } else {
                    search
                }
            }
            .background(ScreenBackground())
            .navigationTitle("Merge with\u{2026}")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        // No dismissal mid-merge — closing would hide the
                        // outcome while the request keeps running.
                        .disabled(busy)
                }
            }
            .interactiveDismissDisabled(busy)
        }
        .presentationDetents([.large])
        .presentationBackground(palette.bg1Color)
        .onChange(of: query) { _, q in schedule(q) }
        .onDisappear { searchTask?.cancel() }
    }

    // MARK: - Step 1: find the other entry

    private var search: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("The other entry merges into \u{201c}\(target.displayTitle)\u{201d}. Nothing is deleted \u{2014} every merge can be undone.")
                .font(.ui(13))
                .foregroundStyle(palette.ink2Color)
                .fixedSize(horizontal: false, vertical: true)

            SearchField(text: $query, prompt: "Search by title or author", identifier: "merge-search")

            if let error {
                Text(error)
                    .font(.ui(12.5))
                    .foregroundStyle(palette.badColor)
            }

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(candidates.enumerated()), id: \.element.uuid) { index, book in
                        candidateRow(book, isFirst: index == 0)
                    }
                    if !candidates.isEmpty { RecordRule() }
                }
            }
            .scrollIndicators(.hidden)
            .overlay {
                if candidates.isEmpty { searchPlaceholder }
            }
        }
        .screenPadding()
        .padding(.top, Spacing.md)
    }

    @ViewBuilder
    private var searchPlaceholder: some View {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if searching {
            ProgressView()
        } else if !trimmed.isEmpty {
            Text("No other book matches \u{201c}\(trimmed)\u{201d}.")
                .font(.ui(13))
                .foregroundStyle(palette.ink3Color)
                .accessibilityIdentifier("merge-empty")
        }
    }

    private func candidateRow(_ book: Book, isFirst: Bool) -> some View {
        Button {
            Haptics.tap()
            source = book
        } label: {
            VStack(spacing: 0) {
                if !isFirst { Hairline() }
                HStack(spacing: Spacing.md) {
                    BookCover(identity: CoverIdentity(book), size: .sm)
                        .frame(width: 38)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(book.displayTitle)
                            .font(.ui(14.5, weight: .medium))
                            .foregroundStyle(palette.ink0Color)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        HStack(spacing: 5) {
                            Text(book.authorDisplay).lineLimit(1)
                            if !book.formats.isEmpty {
                                Text("· \(book.formats.map { $0.uppercased() }.joined(separator: ", "))")
                            }
                        }
                        .font(.ui(11.5))
                        .foregroundStyle(palette.ink3Color)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(palette.ink3Color)
                }
                .padding(.vertical, Spacing.sm)
            }
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier("merge-candidate-\(book.uuid)")
    }

    /// Debounced so a keystroke never fires a request the next one cancels
    /// — the same 250ms the web dialog waits.
    private func schedule(_ q: String) {
        searchTask?.cancel()
        let trimmed = q.trimmingCharacters(in: .whitespacesAndNewlines)
        error = nil
        guard !trimmed.isEmpty else {
            candidates = []
            searching = false
            return
        }
        searching = true
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            do {
                let hits = try await AdminBookService.mergeCandidates(query: trimmed)
                guard !Task.isCancelled else { return }
                candidates = MergeCopy.candidates(hits, excludingTarget: target.uuid)
            } catch {
                guard !Task.isCancelled else { return }
                candidates = []
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
            searching = false
        }
    }

    // MARK: - Step 2: confirm

    private func confirm(_ source: Book) -> some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            SectionLabel("Merge \u{201c}\(source.displayTitle)\u{201d}?")

            Text(MergeCopy.confirmBody(source: source.displayTitle, target: target.displayTitle))
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("merge-confirm-copy")

            if let error {
                Text(error)
                    .font(.ui(12.5))
                    .foregroundStyle(palette.badColor)
                    .accessibilityIdentifier("merge-error")
            }

            Spacer(minLength: 0)

            Button {
                Haptics.tap()
                merge(source)
            } label: {
                Text(busy ? "Merging\u{2026}" : "Merge books")
            }
            .buttonStyle(FilledButtonStyle())
            .disabled(busy)
            .accessibilityIdentifier("merge-confirm")

            Button("Back") {
                error = nil
                self.source = nil
            }
            .buttonStyle(QuietButtonStyle())
            .frame(maxWidth: .infinity)
            .disabled(busy)
        }
        .screenPadding()
        .padding(.vertical, Spacing.lg)
    }

    private func merge(_ source: Book) {
        // A double-tap can land before the disabled state re-renders.
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                let result = try await AdminBookService.mergeBooks(
                    source: source.uuid, into: target.uuid
                )
                dismiss()
                onMerged(result)
            } catch {
                busy = false
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

/// The post-merge receipt the detail screen shows: the merge landed, and one
/// tap takes it back. Held until dismissed or undone — the undo handle is
/// only good while the toast keeps it.
struct MergeUndoToast: View {
    let result: MergeBooksResult
    /// The surviving book, whose cached detail an undo has to drop.
    let target: String
    var onUndone: () -> Void
    var onDismiss: () -> Void

    @Environment(\.palette) private var palette
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: Spacing.md) {
                Text("Books merged.")
                    .font(.ui(14, weight: .medium))
                    .foregroundStyle(palette.ink0Color)
                Spacer(minLength: 0)
                Button(busy ? "Undoing\u{2026}" : "Undo") { undo() }
                    .font(.ui(14, weight: .semibold))
                    .foregroundStyle(palette.accentColor)
                    .disabled(busy)
                    .accessibilityIdentifier("merge-undo")
                Button {
                    onDismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(palette.ink3Color)
                }
                .disabled(busy)
                .accessibilityLabel("Dismiss")
            }
            if let error {
                Text(error)
                    .font(.ui(12.5))
                    .foregroundStyle(palette.badColor)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .background(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .fill(palette.bg1Color)
                .shadow(color: .black.opacity(0.25), radius: 14, y: 6)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .strokeBorder(palette.line2.color, lineWidth: 0.5)
        )
        .accessibilityIdentifier("merge-toast")
    }

    private func undo() {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                try await AdminBookService.undoMerge(id: result.mergeLogId, target: target)
                onUndone()
            } catch {
                busy = false
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
