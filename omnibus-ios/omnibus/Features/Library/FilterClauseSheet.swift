//  FilterClauseSheet.swift
//  One facet's sheet: whether its clause includes or excludes, then any number
//  of values drawn from the reads that already feed the tag, genre, author,
//  series and shelf screens.

import SwiftUI

/// One value the picker offers: what the clause stores, what the reader sees,
/// and how many books carry it when the source says.
struct FilterOption: Hashable, Sendable, Identifiable {
    var value: String
    var label: String
    var count: Int?

    var id: String { value }

    /// The server's longest filter value (`SHELF_RULE_VALUE_MAX_LEN`).
    static let maxValueLength = 512

    /// Rows of a name-matched field as options. The server compares names
    /// with ASCII case folded, so spellings that differ only by case are one
    /// option; a name it would refuse is left out rather than offered.
    static func named(_ rows: [(name: String, count: Int)]) -> [FilterOption] {
        var options: [FilterOption] = []
        var seen: [String: Int] = [:]
        for row in rows {
            let name = row.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, name.unicodeScalars.count <= maxValueLength else { continue }
            let key = asciiFolded(name)
            if let at = seen[key] {
                options[at].count = (options[at].count ?? 0) + row.count
            } else {
                seen[key] = options.count
                options.append(FilterOption(value: name, label: name, count: row.count))
            }
        }
        return options
    }

    /// Hand-picked shelves and wishlists, valued by id. A smart shelf is never
    /// offered: the server matches no book against one.
    static func shelves(_ shelves: [ShelfSummary], viewerId: Int64?) -> [FilterOption] {
        shelves
            .filter { $0.kind != .smart }
            .map {
                FilterOption(
                    value: String($0.id), label: shelfLabel($0, viewerId: viewerId),
                    count: Int($0.bookCount)
                )
            }
    }

    /// A shelf's name, followed by its owner's when it is another reader's, so
    /// two shelves of one name stay apart.
    static func shelfLabel(_ shelf: ShelfSummary, viewerId: Int64?) -> String {
        ShelfCard.showsOwnerAttribution(viewerId: viewerId, ownerUserId: shelf.ownerUserId, kind: shelf.kind)
            ? "\(shelf.name) · \(shelf.ownerUsername)"
            : shelf.name
    }

    /// The picked values `options` doesn't hold (a deleted shelf, a tag no
    /// longer in use), so each can still be seen and unticked.
    static func stranded(_ picked: [String], in options: [FilterOption], field: FilterField) -> [FilterOption] {
        picked
            .filter { value in !options.contains { isPicked($0.value, in: [value]) } }
            .map { value in
                let label = switch field {
                case .format: value.uppercased()
                case .shelf: "unavailable shelf"
                default: value
                }
                return FilterOption(value: value, label: label, count: nil)
            }
    }

    /// Whether `value` is among `picked`, ignoring case as the server does.
    static func isPicked(_ value: String, in picked: [String]) -> Bool {
        picked.contains { $0.caseInsensitiveCompare(value) == .orderedSame }
    }

    /// `picked` with `value` flipped, ignoring case; a new pick past the value
    /// cap is refused.
    static func toggling(_ value: String, in picked: [String]) -> [String] {
        if isPicked(value, in: picked) {
            return picked.filter { $0.caseInsensitiveCompare(value) != .orderedSame }
        }
        return picked.count < FilterClause.maxValues ? picked + [value] : picked
    }

    /// Every format the category strip knows.
    static let formats: [FilterOption] = LibraryCategory.allCases
        .flatMap(\.serverFormats)
        .map { FilterOption(value: $0, label: $0.uppercased(), count: nil) }

    private static func asciiFolded(_ name: String) -> String {
        String(name.map { $0.isASCII ? Character($0.lowercased()) : $0 })
    }
}

/// A facet's sheet: its field's values, multi-select, under an includes /
/// excludes switch, opened on the facet's current clause. Apply hands the
/// finished clause back and closes it.
struct FilterClauseSheet: View {
    let field: FilterField
    var viewerId: Int64?
    var onApply: (FilterClause) -> Void

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var mode: FilterMode
    @State private var picked: [String]
    /// `nil` until the source answers, so a list still loading never reads as empty.
    @State private var options: [FilterOption]? = nil
    @State private var loadFailed = false
    @State private var query = ""

    init(initial: FilterClause, viewerId: Int64?, onApply: @escaping (FilterClause) -> Void) {
        field = initial.field
        self.viewerId = viewerId
        self.onApply = onApply
        _mode = State(initialValue: initial.mode)
        _picked = State(initialValue: initial.values)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Spacing.md) {
                Picker("Match", selection: $mode) {
                    ForEach(FilterMode.allCases, id: \.self) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .screenPadding()
                .accessibilityIdentifier("filter-mode")

                values
            }
            .padding(.top, Spacing.sm)
            .background(ScreenBackground())
            .navigationTitle(field.label)
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        Haptics.success()
                        onApply(FilterClause(field: field, mode: mode, values: picked))
                        dismiss()
                    }
                    .accessibilityIdentifier("filter-apply")
                }
            }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private var values: some View {
        if let options {
            let rows = options + FilterOption.stranded(picked, in: options, field: field)
            if rows.isEmpty {
                note("Nothing in the library to filter by yet.")
            } else {
                List(visible(rows)) { option in
                    row(option)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        } else if loadFailed {
            note("Couldn't load these. They'll be here once the server can be reached.")
        } else {
            LoadingView()
        }
    }

    private func visible(_ options: [FilterOption]) -> [FilterOption] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return options }
        return options.filter { $0.label.localizedCaseInsensitiveContains(needle) }
    }

    private func row(_ option: FilterOption) -> some View {
        let isPicked = FilterOption.isPicked(option.value, in: picked)
        let isFull = picked.count >= FilterClause.maxValues

        return Button {
            Haptics.select()
            picked = FilterOption.toggling(option.value, in: picked)
        } label: {
            HStack(spacing: Spacing.md) {
                Text(option.label)
                    .font(.ui(15, weight: .medium))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                Spacer(minLength: 0)

                if let count = option.count {
                    Text("\(count)")
                        .font(.monoUI(11))
                        .foregroundStyle(palette.ink3Color)
                }

                Image(systemName: isPicked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(isPicked ? palette.accentColor : palette.ink3Color)
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isPicked && isFull)
        .accessibilityLabel(option.label)
        .accessibilityAddTraits(isPicked ? .isSelected : [])
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.ui(13.5))
            .foregroundStyle(palette.ink3Color)
            .screenPadding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// The field's values from the read that already serves its own screen.
    private func load() async {
        do {
            switch field {
            case .format:
                options = FilterOption.formats
            case .shelf:
                for try await read in UserDataService.shelves() {
                    options = FilterOption.shelves(read.value, viewerId: viewerId)
                }
            case .tag:
                for try await read in LibraryService.tags() {
                    options = FilterOption.named(read.value.map { (name: $0.name, count: $0.count) })
                }
            case .genre:
                for try await read in LibraryService.genres() {
                    options = FilterOption.named(read.value.map { (name: $0.name, count: $0.count) })
                }
            case .author:
                for try await read in LibraryService.authors() {
                    options = FilterOption.named(read.value.map { (name: $0.name, count: $0.bookCount) })
                }
            case .series:
                for try await read in LibraryService.series() {
                    options = FilterOption.named(read.value.map { (name: $0.name, count: $0.bookCount) })
                }
            }
        } catch {
            loadFailed = options == nil
        }
    }
}
