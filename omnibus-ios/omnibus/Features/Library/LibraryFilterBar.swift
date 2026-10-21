//  LibraryFilterBar.swift
//  The library filter on screen: a facet per field and Clear filters over the
//  shared `LibraryFilterStore`, what a filtered grid says while it has no books
//  to show, and how the library grid follows the filter. Hosted by the library
//  and every shelf page.

import Observation
import SwiftUI

/// One facet per field in a row that scrolls sideways, then Clear filters once
/// any clause is set. A facet opens its field's sheet; an active one names what
/// it keeps and carries its own clear.
struct LibraryFilterBar: View {
    let store: LibraryFilterStore
    /// Who is looking, for naming another reader's shelf on its facet.
    var viewerId: Int64?

    @Environment(\.palette) private var palette
    /// The shelves a shelf facet is named from.
    @State private var shelves: ShelfList = .loading
    @State private var openField: FilterField?

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 7) {
                ForEach(FilterField.allCases) { field in
                    facet(field)
                }
                if !store.clauses.isEmpty {
                    clearButton
                }
            }
            .screenPadding()
        }
        .scrollIndicators(.hidden)
        .sheet(item: $openField) { field in
            FilterClauseSheet(initial: FilterClause.opening(field, in: store.clauses), viewerId: viewerId) {
                store.apply($0)
            }
        }
        .task(id: store.clauses.contains(where: { $0.field == .shelf })) {
            await loadShelves()
        }
    }

    private func facet(_ field: FilterField) -> some View {
        let clause = store.clauses.first { $0.field == field }
        let isActive = clause != nil
        return HStack(spacing: 0) {
            Button {
                Haptics.tap()
                openField = field
            } label: {
                HStack(spacing: 5) {
                    Text(field.label)
                        .foregroundStyle(palette.ink1Color)
                    if let clause {
                        Text(clause.facetValue(shelves: shelves, viewerId: viewerId))
                            .foregroundStyle(palette.ink0Color)
                            .lineLimit(1)
                            .frame(maxWidth: 180, alignment: .leading)
                    }
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(palette.ink3Color)
                        .accessibilityHidden(true)
                }
                .font(.ui(12.5, weight: .medium))
                .padding(.leading, 12)
                .padding(.trailing, isActive ? 4 : 11)
                .padding(.vertical, 8)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("library-filter-facet-\(field.rawValue)")

            if isActive {
                Button {
                    Haptics.tap()
                    store.clear(field)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(palette.ink3Color)
                        .frame(width: 22, height: 22)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .padding(.trailing, 5)
                .accessibilityLabel("Clear the \(field.label) filter")
                .accessibilityIdentifier("library-filter-facet-clear-\(field.rawValue)")
            }
        }
        .background(Capsule().fill(isActive ? palette.bg2Color : Color.clear))
        .overlay(
            Capsule().strokeBorder(
                isActive ? palette.accentColor.opacity(0.45) : palette.line2.color,
                lineWidth: isActive ? 1 : 0.5
            )
        )
    }

    private var clearButton: some View {
        Button {
            Haptics.tap()
            store.clear()
        } label: {
            Text("Clear filters")
                .font(.ui(12.5, weight: .medium))
                .foregroundStyle(palette.ink2Color)
                .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("library-filter-clear")
    }

    /// Only a shelf facet needs the list. A failed read still settles, so a
    /// facet names its id rather than waiting forever.
    private func loadShelves() async {
        guard store.clauses.contains(where: { $0.field == .shelf }) else { return }
        do {
            for try await read in UserDataService.shelves() {
                shelves = .loaded(read.value)
            }
        } catch {
            if case .loading = shelves { shelves = .failed }
        }
    }
}

/// What a filtered grid with no books is waiting on, or why it has none.
enum FilteredPhase: Equatable {
    case loading
    case noMatches
    case failed(String)
}

/// The filtered grid's empty states. Each keeps Clear filters in reach, so a
/// filter that can't be answered never traps the reader.
struct FilteredResultsState: View {
    let phase: FilteredPhase
    var onClear: () -> Void

    var body: some View {
        Group {
            switch phase {
            case .loading:
                LoadingView(label: "Applying filters")
            case .noMatches:
                EmptyStateView(
                    icon: "line.3.horizontal.decrease",
                    title: "No matches",
                    message: "Nothing here matches these filters.",
                    kicker: "Filtered",
                    fanned: true,
                    actionTitle: "Clear filters",
                    action: onClear
                )
            case .failed(let message):
                EmptyStateView(
                    icon: "wifi.slash",
                    title: "Can't apply these filters",
                    message: message,
                    kicker: "Filtered",
                    actionTitle: "Clear filters",
                    action: onClear
                )
            }
        }
        .frame(minHeight: 380)
    }
}

/// What fills the library tab: its content, or one whole-tab state while it has none.
enum LibraryTabState: Equatable {
    case loading
    case failed(String)
    case empty
    case content
}

extension LibraryModel {
    var hasFilterClauses: Bool { !filterStore.clauses.isEmpty }

    /// Re-reads the grid each time the shared clause list changes, whichever
    /// screen made the edit. Observation fires once, so each change re-arms it.
    func watchClauses() {
        withObservationTracking {
            _ = filterStore.clauses
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.watchClauses()
                await self.reload(clearingGrid: true)
            }
        }
    }

    /// The shelves moved under the rail. A grid narrowed by a shelf clause moved
    /// with them: its rows answer a membership that no longer holds.
    func shelvesMoved() async {
        if filterStore.clauses.contains(where: { $0.field == .shelf }) {
            await reload(clearingGrid: true)
        } else {
            await refreshShelves()
        }
    }

    var tabState: LibraryTabState {
        Self.tabState(
            hasBooks: !books.isEmpty, isLoading: isLoading || !hasAnswered, error: error,
            keepsContent: hasFilterClauses || isApplyingFilters
        )
    }

    /// A filtered tab, or one a filter change just cleared, keeps its content:
    /// the grid's own state says why it holds no books.
    nonisolated static func tabState(
        hasBooks: Bool, isLoading: Bool, error: String?, keepsContent: Bool
    ) -> LibraryTabState {
        if hasBooks || keepsContent { return .content }
        if isLoading { return .loading }
        if let error { return .failed(error) }
        return .empty
    }

    /// The filtered grid's state while it holds no books.
    var filteredPhase: FilteredPhase {
        Self.filteredPhase(isLoading: isLoading, hasAnswered: hasAnswered, error: error)
    }

    nonisolated static func filteredPhase(isLoading: Bool, hasAnswered: Bool, error: String?) -> FilteredPhase {
        if isLoading || !hasAnswered { return .loading }
        if let error { return .failed(error) }
        return .noMatches
    }
}
