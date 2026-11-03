//  StatsExclusionsView.swift
//  "Leave out of my stats": the filter whose matching books don't count toward
//  the reader's stats, edited with the library's own filter bar over a store
//  that lives in memory, with a preview of the books it leaves out. Account
//  configuration under rule 08: saved directly, never queued, disabled offline.

import SwiftUI

/// What the screen opened on and what saving would send, apart from the view
/// so the save rules are testable without a UI or a server.
struct StatsExclusionsDraft: Equatable {
    /// The rule the server held when the screen opened, in the order the filter store keeps it,
    /// so a rule saved elsewhere in another order doesn't read as an edit.
    let saved: [FilterClause]

    init(seededFrom user: UserSummary?) {
        saved = LibraryFilterStore.onePerField(user?.statsExclusionsSetting?.clauses ?? [])
    }

    /// The body to save for `clauses`; `nil` while they match what the server holds.
    func update(for clauses: [FilterClause]) -> StatsExclusions? {
        clauses == saved ? nil : StatsExclusions(clauses: clauses)
    }
}

/// One stack's line, keyed on its lead book since two series can share a name and a count.
struct SeriesLine: Equatable, Identifiable {
    let id: String
    let text: String
}

/// What the rule would leave out, read from the library's first page folded by series.
struct StatsExclusionsPreview: Equatable {
    /// How many books match; the page's own count when the server sent none.
    let total: Int64
    /// One "<series> · n" line per stack on the page.
    let seriesLines: [SeriesLine]
    /// Books on the page that sit in no stack.
    let loose: Int
    /// More books than the page holds, so the series lines are partial.
    let isPartial: Bool

    init(page: LibraryPageResult) {
        let stacks = page.stacks ?? []
        let leads = Set(stacks.map(\.leadUuid))
        total = page.total ?? Int64(page.books.count)
        seriesLines = stacks.map {
            SeriesLine(id: $0.leadUuid, text: "\($0.name) · \($0.members.count)")
        }
        loose = page.books.filter { !leads.contains($0.uuid) }.count
        isPartial = page.nextCursor != nil
    }
}

private enum PreviewPhase: Equatable {
    case none
    case loading
    case loaded(StatsExclusionsPreview)
    case failed(String)
}

/// Reads the saved rule off the signed-in user, then hands it to the form,
/// which owns the draft from there on.
struct StatsExclusionsView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        StatsExclusionsForm(draft: StatsExclusionsDraft(seededFrom: app.user))
    }
}

private struct StatsExclusionsForm: View {
    let draft: StatsExclusionsDraft

    @Environment(AppState.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var store: LibraryFilterStore
    @State private var phase = PreviewPhase.none
    @State private var isSaving = false
    @State private var error: String?

    init(draft: StatsExclusionsDraft) {
        self.draft = draft
        _store = State(initialValue: LibraryFilterStore(clauses: draft.saved))
    }

    private var pending: StatsExclusions? { draft.update(for: store.clauses) }
    private var canSave: Bool { pending != nil && !isSaving && Connectivity.shared.isOnline }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    SectionLabel("Books to leave out")
                        .screenPadding()
                    LibraryFilterBar(store: store, viewerId: app.user?.id)
                }
                preview.screenPadding()
                if let error {
                    Text(error)
                        .font(.ui(12))
                        .foregroundStyle(palette.badColor)
                        .screenPadding()
                }
            }
            .padding(.top, Spacing.md)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.hidden)
        .background(ScreenBackground())
        .navigationTitle("Leave out of my stats")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }
                    .disabled(!canSave)
                    .accessibilityIdentifier("stats-exclusions-save")
            }
        }
        .task(id: FilterClause.signature(store.clauses)) { await loadPreview(store.clauses) }
    }

    @ViewBuilder private var preview: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            switch phase {
            case .none:
                caption("Pick a filter to see which books it leaves out.")
            case .loading:
                caption("Counting books…")
            case .failed(let message):
                caption(message, isError: true)
            case .loaded(let preview):
                Text("\(preview.total) book\(preview.total == 1 ? "" : "s") left out")
                    .font(.ui(14, weight: .semibold))
                    .foregroundStyle(palette.ink0Color)
                    .accessibilityIdentifier("stats-exclusions-total")
                ForEach(preview.seriesLines) { line in
                    caption(line.text)
                }
                if preview.loose > 0 { caption("\(preview.loose) outside a series") }
                if preview.isPartial { caption("The series list covers the first page of these books.") }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("stats-exclusions-preview")
    }

    private func caption(_ text: String, isError: Bool = false) -> some View {
        Text(text)
            .font(.ui(12))
            .foregroundStyle(isError ? palette.badColor : palette.ink3Color)
    }

    /// Counts the books `clauses` match from the library's first page, folded by series.
    private func loadPreview(_ clauses: [FilterClause]) async {
        guard !clauses.isEmpty else { return phase = .none }
        phase = .loading
        do {
            for try await read in LibraryService.page(
                sort: .title, direction: .asc,
                filter: LibraryFilter(stackSeries: true, clauses: clauses), cursor: nil
            ) {
                phase = .loaded(StatsExclusionsPreview(page: read.value))
            }
        } catch {
            if !Task.isCancelled { phase = .failed(LibraryFilterError.message(for: error)) }
        }
    }

    /// Writes the draft; a refusal keeps it, with the reason beneath.
    private func save() {
        guard let body = pending else { return }
        isSaving = true
        error = nil
        Task {
            do {
                try await AuthService.setStatsExclusions(body)
                // Before the refresh, which keeps the old identity if it fails.
                app.applyConfirmed { $0.statsExclusionsSetting = body }
                await app.refreshUser()
                Haptics.success()
                dismiss()
            } catch let failure {
                error = (failure as? APIError)?.errorDescription ?? failure.localizedDescription
                Haptics.warning()
            }
            isSaving = false
        }
    }
}
