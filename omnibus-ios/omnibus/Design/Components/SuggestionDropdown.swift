//  SuggestionDropdown.swift
//  Autocomplete pools + dropdown shared by the chip fields and `PlateField`,
//  mirroring the web's `frontend/src/components/suggestion_dropdown/`: at most
//  five case-insensitive substring matches, values already present excluded,
//  an optional "+ Create" trailing row, and a name + book-count row layout.

import SwiftUI

/// One entry in an autocomplete pool: the canonical name plus the number of
/// books currently linked to it. Counts are display-only — nothing branches
/// on them.
struct SuggestionItem: Hashable, Sendable {
    let name: String
    let count: Int
}

/// The pure half of the dropdown, shared by the chip fields and the series
/// field. Ported from the web's `collect_suggestions` / `compute_suggestions`
/// / `should_show_create_row` so both clients rank and filter identically.
enum SuggestionPool {
    /// Cap on visible rows — matches the web's `MAX_SUGGESTIONS`.
    static let maxSuggestions = 5

    /// Dedup raw `(name, count)` pairs into a sorted pool. Case-insensitive
    /// on the name (first-seen casing wins); on collision the higher count
    /// wins, so a freshly-linked row beats a stale empty one.
    static func collect(_ items: [SuggestionItem]) -> [SuggestionItem] {
        var seen: [String: SuggestionItem] = [:]
        for item in items {
            let key = item.name.lowercased()
            if let existing = seen[key] {
                if item.count > existing.count {
                    seen[key] = SuggestionItem(name: existing.name, count: item.count)
                }
            } else {
                seen[key] = item
            }
        }
        return seen.sorted { $0.key < $1.key }.map(\.value)
    }

    /// The ≤`maxSuggestions` candidates for the current query: substring
    /// match ignoring case, minus anything already in `current`. An empty
    /// query surfaces the head of the pool (open-on-focus).
    static func filtered(
        pool: [SuggestionItem], current: [String], query: String
    ) -> [SuggestionItem] {
        guard !pool.isEmpty else { return [] }
        let currentLC = Set(current.map { $0.lowercased() })
        let queryLC = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let matches = pool.lazy.filter { item in
            let lc = item.name.lowercased()
            return (queryLC.isEmpty || lc.contains(queryLC)) && !currentLC.contains(lc)
        }
        return Array(matches.prefix(maxSuggestions))
    }

    /// Whether the trailing "+ Create" row shows: the user has typed
    /// something, and no pool entry or already-chosen value is an exact
    /// case-insensitive match. Checked against the *full* pool, not the
    /// truncated view — an exact match pushed off the top five must still
    /// suppress the row.
    static func showsCreateRow(
        pool: [SuggestionItem], current: [String], typed: String
    ) -> Bool {
        let trimmed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let lc = trimmed.lowercased()
        return !pool.contains { $0.name.lowercased() == lc }
            && !current.contains { $0.lowercased() == lc }
    }
}

/// The dropdown itself: tappable rows under an entry field, each carrying the
/// name and a quiet book count, plus the optional "+ Create" trailing row.
/// Rendered inline inside the plate (content below shifts down) rather than
/// floating — a popover under the keyboard is unreachable on touch.
struct SuggestionList: View {
    let items: [SuggestionItem]
    /// Non-nil renders the "+ Create "…"" trailing row quoting this text.
    var createText: String?
    let onPick: (String) -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            ForEach(items, id: \.name) { item in
                row(item)
            }
            if let createText {
                createRow(createText)
            }
        }
    }

    private func row(_ item: SuggestionItem) -> some View {
        Button {
            onPick(item.name)
        } label: {
            HStack(spacing: Spacing.sm) {
                Text(item.name)
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
                    .lineLimit(1)

                Spacer(minLength: Spacing.sm)

                Text(item.count == 1 ? "1 book" : "\(item.count) books")
                    .font(.ui(11))
                    .foregroundStyle(palette.ink3Color)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) { Hairline().padding(.horizontal, 14) }
    }

    private func createRow(_ text: String) -> some View {
        Button {
            onPick(text)
        } label: {
            HStack(spacing: 0) {
                Text("+ Create ")
                    .font(.ui(14, weight: .medium))
                    .foregroundStyle(palette.accentColor)
                Text("\u{201c}\(text)\u{201d}")
                    .font(.ui(14))
                    .foregroundStyle(palette.ink1Color)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) { Hairline().padding(.horizontal, 14) }
    }
}

/// The add-a-chip row — a "+" icon, a text field, an "Add" button, and the
/// autocomplete dropdown beneath it — shared by every chip-valued field: the
/// metadata editor's authors/tags/genres fields and the book detail's quick
/// chip editor.
struct ChipEntryField: View {
    let placeholder: String
    @Binding var entry: String
    /// The list a pick is checked against, so an already-present value never
    /// shows twice — as a suggestion row or as the "+ Create" row.
    let current: [String]
    let pool: [SuggestionItem]
    var autofocus = false
    var isEnabled = true
    /// Called for a submit, the Add button, a suggestion row, or the create
    /// row. The field clears its own entry and closes its dropdown after,
    /// whether or not this accepts the name — a refused duplicate was still
    /// understood.
    let onPick: (String) -> Void

    @Environment(\.palette) private var palette
    @FocusState private var entryFocused: Bool
    /// Whether the dropdown may show. Tracks focus, but stays closed after a
    /// commit until the next keystroke or refocus — the just-emptied entry
    /// must not instantly resurface the pool.
    @State private var open = false

    var body: some View {
        // The field row carries its own horizontal inset so a caller can
        // place this flush against its own edge, the way `SuggestionList`
        // already insets its own rows — the two then line up without the
        // caller having to coordinate padding between them.
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 7) {
                Image(systemName: "plus.circle")
                    .font(.system(size: 14))
                    .foregroundStyle(palette.ink3Color)

                TextField(placeholder, text: $entry)
                    .font(.ui(15))
                    .foregroundStyle(palette.ink0Color)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .tint(palette.accentColor)
                    .focused($entryFocused)
                    .onSubmit { pick(entry) }

                if !entry.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button("Add") { pick(entry) }
                        .font(.ui(13, weight: .semibold))
                        .foregroundStyle(palette.accentColor)
                }
            }
            .padding(.horizontal, 14)
            .disabled(!isEnabled)
            .opacity(isEnabled ? 1 : 0.4)

            if open, isEnabled {
                let rows = SuggestionPool.filtered(pool: pool, current: current, query: entry)
                let trimmed = entry.trimmingCharacters(in: .whitespacesAndNewlines)
                let create = SuggestionPool.showsCreateRow(
                    pool: pool, current: current, typed: entry
                ) ? trimmed : nil
                if !rows.isEmpty || create != nil {
                    SuggestionList(items: rows, createText: create) { pick($0) }
                        .padding(.top, 9)
                }
            }
        }
        .onAppear { if autofocus { entryFocused = true } }
        .onChange(of: entryFocused) { _, focused in open = focused }
        .onChange(of: entry) { _, newValue in
            // Only a keystroke reopens: the commit path clears the entry
            // programmatically, and that clear must not resurface the pool.
            if !newValue.isEmpty { open = true }
        }
    }

    private func pick(_ name: String) {
        defer {
            entry = ""
            open = false
        }
        onPick(name)
    }
}
