//  TaxonomyMatchesView.swift
//  Where a search's Tags or Genres "All N" leads: the palette's own matches.
//
//  Not the index cloud filtered on the device — `/api/tags` and `/api/genres`
//  carry only the 500 most-used names, so a rare match falls outside them.

import SwiftUI

/// One facet's hits out of a palette answer, and whether the server handed
/// over all of them.
struct TaxonomyMatches: Equatable {
    var entries: [TagWeight]
    var total: UInt32

    init(_ results: PaletteResults, facet: SearchFacet) {
        switch facet {
        case .tag:
            entries = results.tags.map { TagWeight(name: $0.name, count: Int($0.bookCount)) }
            total = results.tagTotal
        case .genre:
            entries = results.genres.map { TagWeight(name: $0.name, count: Int($0.bookCount)) }
            total = results.genreTotal ?? 0
        }
        total = max(total, UInt32(entries.count))
    }

    /// `nil` when every match is on the screen.
    var cutNote: String? {
        guard Int(total) > entries.count else { return nil }
        return "Showing the first \(entries.count) of \(total) \u{2014} narrow your search to see the rest."
    }
}

struct TaxonomyMatchesView: View {
    let facet: SearchFacet
    let query: String
    let total: UInt32

    @Environment(\.palette) private var palette
    @State private var matches: TaxonomyMatches?
    @State private var error: String?

    var body: some View {
        Group {
            if let matches, matches.entries.isEmpty {
                EmptyStateView(
                    icon: "questionmark.circle",
                    title: "No \(facet.plural.lowercased()) match",
                    message: "Nothing in the library is filed under \u{201C}\(query)\u{201D}."
                )
            } else if let matches {
                ScrollView {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        Text(matches.cutNote ?? "Matching \u{201C}\(query)\u{201D}")
                            .font(.ui(12.5))
                            .foregroundStyle(palette.ink3Color)
                            .accessibilityIdentifier("taxonomy-matches-note")
                        TaxonomyCloud(facet: facet, entries: matches.entries)
                    }
                    .screenPadding()
                    .padding(.vertical, Spacing.lg)
                }
            } else if let error {
                ErrorStateView(message: error) { Task { await load() } }
            } else {
                LoadingView()
            }
        }
        .background(ScreenBackground())
        .navigationTitle(facet.plural)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        error = nil
        do {
            let results = try await LibraryService.paletteSection(query: query, total: total)
            matches = TaxonomyMatches(results, facet: facet)
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
