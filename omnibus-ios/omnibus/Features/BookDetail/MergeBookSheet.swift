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
    @State private var detent: PresentationDetent = .large

    private static let confirmDetent = PresentationDetent.fraction(0.72)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // No dismissal mid-merge — closing would hide the outcome while
            // the request keeps running.
            BookSheetHeader(title: "Merge with\u{2026}", closes: !busy) { dismiss() }

            if let source {
                confirm(source)
            } else {
                search
            }
        }
        .presentationDetents([.large, Self.confirmDetent], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(Radius.xl)
        .presentationBackground(palette.bg1Color)
        .interactiveDismissDisabled(busy)
        .onChange(of: query) { _, q in schedule(q) }
        .onChange(of: source) { _, picked in
            withAnimation(Motion.settle) { detent = picked == nil ? .large : Self.confirmDetent }
        }
        .onDisappear { searchTask?.cancel() }
    }

    // MARK: - Step 1: find the other entry

    private var search: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Find the other copy of this book. Its files, tags, highlights and reading progress move onto this entry, and the duplicate disappears.")
                    .font(.ui(15))
                    .foregroundStyle(palette.ink1Color)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)

                targetPanel
                    .padding(.top, 12)

                Text("Search your library")
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .padding(.top, 16)

                SearchField(text: $query, prompt: "Title, author or series", identifier: "merge-search")
                    .padding(.top, 6)

                if let error {
                    Text(error)
                        .font(.ui(14))
                        .foregroundStyle(palette.dangerText)
                        .padding(.top, 12)
                } else {
                    resultNote
                        .padding(.top, 14)
                        .padding(.bottom, 2)
                }

                LazyVStack(spacing: 0) {
                    ForEach(candidates, id: \.uuid) { book in
                        candidateRow(book)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    /// Says up front which entry survives, since that is the part easy to get
    /// backwards.
    private var targetPanel: some View {
        HStack(spacing: 12) {
            BookCover(identity: CoverIdentity(target), size: .sm, cornerRadius: 2)
                .frame(width: 34, height: 51)
                .shadow(color: .black.opacity(0.5), radius: 5, x: 3, y: 4)
            VStack(alignment: .leading, spacing: 0) {
                Text("Everything folds into")
                    .font(.ui(13))
                    .foregroundStyle(palette.ink1Color)
                Text(target.displayTitle)
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
            }
            Spacer(minLength: 0)
            Text("This entry stays")
                .font(.ui(13))
                .foregroundStyle(palette.ink1Color)
                .fixedSize()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.bg2Color))
    }

    @ViewBuilder
    private var resultNote: some View {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if searching {
            ProgressView().controlSize(.small).tint(palette.ink1Color)
        } else {
            Text(MergeCopy.resultNote(count: candidates.count, query: trimmed))
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)
                .accessibilityIdentifier(
                    candidates.isEmpty && !trimmed.isEmpty ? "merge-empty" : "merge-note"
                )
        }
    }

    private func candidateRow(_ book: Book) -> some View {
        Button {
            Haptics.tap()
            source = book
        } label: {
            HStack(spacing: 12) {
                BookCover(identity: CoverIdentity(book), size: .sm, cornerRadius: 2)
                    .frame(width: 40, height: 60)
                    .shadow(color: .black.opacity(0.45), radius: 5, x: 3, y: 4)
                VStack(alignment: .leading, spacing: 2) {
                    Text(book.displayTitle)
                        .font(.display(19, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                    Text(MergeCopy.meta(book))
                        .font(.ui(14))
                        .foregroundStyle(palette.ink1Color)
                    let tags = MergeCopy.tags(book, target: target)
                    if !tags.isEmpty {
                        Text(tags)
                            .font(.ui(13))
                            .foregroundStyle(palette.ink1Color)
                    }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(palette.ink1Color)
            }
            .padding(.vertical, 8)
            .frame(minHeight: 76)
            .overlay(alignment: .top) {
                Rectangle().fill(palette.ink0Color.opacity(0.1)).frame(height: 1)
            }
            .contentShape(Rectangle())
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
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 20) {
                    BookCover(identity: CoverIdentity(source), size: .md, cornerRadius: 3)
                        .frame(width: 92, height: 138)
                        .shadow(color: .black.opacity(0.5), radius: 12, x: 8, y: 12)
                        .rotationEffect(.degrees(5))
                        .offset(y: 4)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(palette.ink1Color)
                    BookCover(identity: CoverIdentity(target), size: .md, cornerRadius: 3)
                        .frame(width: 104, height: 156)
                        .shadow(color: .black.opacity(0.5), radius: 12, x: 8, y: 12)
                        .rotationEffect(.degrees(-2.5))
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 18)
                .padding(.bottom, 20)
                .accessibilityHidden(true)

                Text(MergeCopy.confirmBody(source: source.displayTitle, target: target.displayTitle))
                    .font(.ui(17))
                    .foregroundStyle(palette.ink0Color)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("merge-confirm-copy")

                if let error {
                    Text(error)
                        .font(.ui(14))
                        .foregroundStyle(palette.dangerText)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)
                        .accessibilityIdentifier("merge-error")
                }

                HStack(spacing: 10) {
                    Button("Back") {
                        error = nil
                        self.source = nil
                    }
                    .buttonStyle(QuietPillStyle(fills: true))
                    .disabled(busy)

                    Button {
                        Haptics.tap()
                        merge(source)
                    } label: {
                        Text(busy ? "Merging\u{2026}" : "Merge")
                    }
                    .buttonStyle(BarCTAStyle())
                    .disabled(busy)
                    .accessibilityIdentifier("merge-confirm")
                }
                .padding(.top, 22)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
        }
        .scrollIndicators(.hidden)
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

    @State private var busy = false
    @State private var error: String?

    var body: some View {
        StageToast(
            text: error ?? "Books merged",
            actionLabel: busy ? "Undoing\u{2026}" : "Undo",
            action: undo,
            onDismiss: busy ? nil : onDismiss
        )
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
