//  LibraryFilterBar.swift
//  The library filter on screen: a chip per clause, Add filter and Clear
//  filters over the shared `LibraryFilterStore`, and what a filtered grid says
//  while it has no books to show. Hosted by the library and every shelf page.

import SwiftUI

/// The chips, each removable, then Add filter, then Clear filters once any
/// clause is set.
struct LibraryFilterBar: View {
    let store: LibraryFilterStore
    /// Who is looking, for naming another reader's shelf on its chip.
    var viewerId: Int64?
    /// Whether the host's read also sends `?formats=`, which the server counts as a clause.
    var reservesFormatClause = false

    @Environment(\.palette) private var palette
    /// The shelves a shelf chip is named from; `nil` while they load.
    @State private var shelves: [ShelfSummary]? = nil
    @State private var showPicker = false

    var body: some View {
        FlowLayout(spacing: 7, lineSpacing: 7) {
            ForEach(Array(store.clauses.enumerated()), id: \.offset) { index, clause in
                chip(clause, at: index)
            }
            addButton
            if !store.clauses.isEmpty {
                clearButton
            }
        }
        .sheet(isPresented: $showPicker) {
            FilterClauseSheet(viewerId: viewerId) { store.add($0) }
        }
        .task(id: store.clauses.contains(where: { $0.field == .shelf })) {
            await loadShelves()
        }
    }

    private func chip(_ clause: FilterClause, at index: Int) -> some View {
        let label = clause.chipLabel(shelves: shelves, viewerId: viewerId)
        return HStack(spacing: 4) {
            Text(label)
                .font(.ui(12.5, weight: .medium))
                .foregroundStyle(palette.ink1Color)
                .lineLimit(1)
                // The flow lays chips out at their ideal width; a long value list truncates instead.
                .frame(maxWidth: 260, alignment: .leading)

            Button {
                Haptics.tap()
                store.remove(at: index)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(palette.ink3Color)
                    .frame(width: 22, height: 22)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove filter: \(label)")
        }
        .padding(.leading, 11)
        .padding(.trailing, 4)
        .padding(.vertical, 3)
        .background(Capsule().fill(palette.bg2Color))
        .overlay(Capsule().strokeBorder(palette.line2.color, lineWidth: 0.5))
        .accessibilityIdentifier("library-filter-chip-\(index)")
    }

    private var addButton: some View {
        Button {
            Haptics.tap()
            showPicker = true
        } label: {
            Label("Add filter", systemImage: "plus")
                .font(.ui(12.5, weight: .medium))
                .foregroundStyle(palette.accentColor)
                .padding(.horizontal, 11)
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
        .disabled(!canAdd)
        .opacity(canAdd ? 1 : 0.4)
        .accessibilityIdentifier("library-filter-add")
    }

    private var canAdd: Bool { store.canAdd(reservingFormatClause: reservesFormatClause) }

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

    /// Only a shelf chip needs the list. A failed read still settles, so an id
    /// no list can name reads "unavailable shelf" rather than waiting forever.
    private func loadShelves() async {
        guard store.clauses.contains(where: { $0.field == .shelf }) else { return }
        do {
            for try await read in UserDataService.shelves() {
                shelves = read.value
            }
        } catch {
            if shelves == nil { shelves = [] }
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

extension LibraryModel {
    var hasFilterClauses: Bool { !filterStore.clauses.isEmpty }

    /// The filtered grid's state while it holds no books.
    var filteredPhase: FilteredPhase {
        if isLoading { return .loading }
        if let error { return .failed(error) }
        return .noMatches
    }
}
