//  MetadataFetchView.swift
//  "Fetch metadata": what the editor sheet turns into to find this book at every
//  configured provider, then take what you tick from one edition.
//
//  It asks straight away, with the book's own title and first author, so the
//  common case is one tap from a list. The query folds away above the results
//  and opens again whenever a search comes back with nothing to choose from.
//
//  Nothing here saves. Applying writes into the editor's draft and its staged
//  cover, so the editor's Save stays the single writer and its dirty tracking,
//  validation and changed-fields-only payload keep working untouched.

import SwiftUI

struct MetadataFetchView: View {
    let book: Book
    /// Written into as an edition is applied. The editor owns it.
    @Binding var draft: MetadataDraft
    @Binding var staged: StagedCover?
    /// Runs with the rows just taken, once they are in the draft.
    var onApplied: ([MetadataDiffRow]) -> Void
    var onBack: () -> Void

    @Environment(\.palette) private var palette

    @State private var stage = MetadataFetchStage.asking
    @State private var query: String
    @State private var author: String
    @State private var queryOpen = false
    @FocusState private var queryFocused: Bool

    @State private var editions: [ProviderEdition] = []
    @State private var sources: [ProviderSearchSource] = []
    /// The search that may still report. A newer one makes an older one's
    /// answer old news.
    @State private var searchGeneration = 0
    /// True for a list that just landed; back from a comparison it is already
    /// on the table.
    @State private var dealing = true

    /// A selected candidate is re-fetched in full. Until it lands the search
    /// hit is a partial answer, so nothing about it may be taken.
    @State private var isHydrating = false
    /// Set when the detail fetch failed rather than missing: "we couldn't ask"
    /// must not read as "this source has none".
    @State private var hydrateFailure: String?
    /// What the reader has ticked or unticked; a row they haven't touched
    /// keeps its default.
    @State private var marks: [String: Bool] = [:]

    init(
        book: Book,
        draft: Binding<MetadataDraft>,
        staged: Binding<StagedCover?>,
        onApplied: @escaping ([MetadataDiffRow]) -> Void,
        onBack: @escaping () -> Void
    ) {
        self.book = book
        _draft = draft
        _staged = staged
        self.onApplied = onApplied
        self.onBack = onBack
        let current = draft.wrappedValue
        _query = State(
            initialValue: current.title.nilIfBlank ?? current.isbn13.nilIfBlank ?? book.displayTitle
        )
        _author = State(initialValue: current.authors.first?.nilIfBlank ?? "")
    }

    private var comparing: ProviderEdition? {
        if case let .compare(edition) = stage { return edition }
        return nil
    }

    private func rows(_ edition: ProviderEdition) -> [MetadataDiffRow] {
        MetadataFetchFlow.diffRows(
            edition: edition, draft: draft, hasCover: book.coverURL != nil, staged: staged
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            backRow

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Fetch metadata")
                        .font(.display(30, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                        .padding(.top, 2)
                        .padding(.bottom, 10)
                        .accessibilityAddTraits(.isHeader)

                    if comparing == nil {
                        if queryOpen { queryForm } else { queryRow }
                    }

                    phase
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 34)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)

            if let edition = comparing, !isHydrating {
                let rows = rows(edition)
                if !rows.isEmpty { applyBar(edition, rows: rows) }
            }
        }
        .padding(.top, 14)
        .task { await search() }
    }

    private var backRow: some View {
        Button {
            Haptics.tap()
            if comparing != nil {
                dealing = false
                withAnimation(Motion.settle) { stage = .results }
            } else {
                searchGeneration += 1
                onBack()
            }
        } label: {
            HStack(spacing: 2) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                Text(comparing != nil ? "All editions" : "Back to editing")
                    .font(.ui(16, weight: .medium))
            }
            .foregroundStyle(palette.ink0Color)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 8)
        .accessibilityIdentifier("fetch-back")
    }

    // MARK: - The query

    private var queryLine: String {
        [query.nilIfBlank, author.nilIfBlank].compactMap { $0 }.joined(separator: " \u{b7} ")
    }

    private var queryRow: some View {
        Button {
            Haptics.tap()
            queryOpen = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(palette.ink1Color)
                Text(queryLine)
                    .font(.ui(15))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text("Change")
                    .font(.ui(15, weight: .semibold))
                    .foregroundStyle(palette.bookText)
            }
            .padding(.leading, 12)
            .padding(.trailing, 14)
            .frame(minHeight: 46)
            .editInputBox(corner: 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Change the search")
        .accessibilityValue(queryLine)
        .accessibilityIdentifier("fetch-query")
    }

    private var queryForm: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("Title or ISBN")
                .font(.ui(14, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
            queryField($query, label: "Title or ISBN", identifier: "fetch-query-title")

            Text("Author")
                .font(.ui(14, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
                .padding(.top, 5)
            HStack(spacing: 8) {
                queryField($author, label: "Author", identifier: "fetch-query-author")
                Button {
                    Task { await search() }
                } label: {
                    Text("Search")
                        .font(.ui(16, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18)
                        .frame(height: 46)
                        .background(Capsule().fill(palette.bookDeep))
                }
                .buttonStyle(PressableStyle())
                .disabled(MetadataFetchFlow.searchRequest(query: query, author: author) == nil)
                .accessibilityIdentifier("fetch-search")
            }
        }
    }

    private func queryField(
        _ text: Binding<String>, label: String, identifier: String
    ) -> some View {
        TextField("", text: text)
            .font(.ui(16))
            .foregroundStyle(palette.ink0Color)
            .tint(palette.bookText)
            .textInputAutocapitalization(.words)
            .autocorrectionDisabled()
            .submitLabel(.search)
            .focused($queryFocused)
            .onSubmit { Task { await search() } }
            .padding(.horizontal, 12)
            .frame(height: 46)
            .editInputBox()
            .accessibilityLabel(label)
            .accessibilityIdentifier(identifier)
    }

    // MARK: - Phases

    @ViewBuilder
    private var phase: some View {
        switch stage {
        case .asking:
            FetchWaitLine(text: "Asking every configured source\u{2026}")
                .padding(.top, 14)
                .padding(.bottom, 12)
            MetadataFetchSkeleton()
        case .failed:
            Text("The search didn\u{2019}t go through. Check your connection and try again.")
                .font(.ui(15))
                .foregroundStyle(palette.ink1Color)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 14)
                .accessibilityIdentifier("fetch-failed")
        case .results:
            results
        case let .compare(edition):
            compare(edition)
        }
    }

    @ViewBuilder
    private var results: some View {
        FetchSourceLine(sources: sources)
            .padding(.top, 12)
            .padding(.bottom, 8)

        if editions.isEmpty {
            Text("No editions matched. Try a shorter title, or the ISBN.")
                .font(.ui(15))
                .foregroundStyle(palette.ink1Color)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)
                .accessibilityIdentifier("fetch-no-match")
        } else {
            LazyVStack(spacing: 0) {
                ForEach(Array(editions.enumerated()), id: \.element.id) { index, edition in
                    EditionRow(
                        edition: edition,
                        changes: rows(edition).count,
                        deal: dealing ? index : nil
                    ) {
                        Task { await select(edition) }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func compare(_ edition: ProviderEdition) -> some View {
        EditionRail(editions: editions, selected: edition) { other in
            Task { await select(other) }
        }

        VStack(alignment: .leading, spacing: 3) {
            Text(edition.title)
                .font(.display(23, weight: .semibold))
                .foregroundStyle(palette.ink0Color)
            Text(MetadataFetchFlow.metaLine(edition))
                .font(.ui(14))
                .foregroundStyle(palette.ink1Color)
                .lineLimit(3)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 4)

        // Nothing real is shown until the record has settled: rows appearing
        // and rearranging under the reader is worse than a moment's placeholder.
        if isHydrating {
            FetchWaitLine(text: "Loading the full record\u{2026}")
                .padding(.top, 16)
                .padding(.bottom, 10)
            FetchPulseBars()
        } else {
            if let hydrateFailure {
                Text("Couldn\u{2019}t load the full record: \(hydrateFailure) This is what the search returned, and it may be missing fields this source has.")
                    .font(.ui(14))
                    .foregroundStyle(palette.warnColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 14)
            }

            let rows = rows(edition)
            if rows.isEmpty {
                Text("This edition matches what you have.")
                    .font(.ui(15))
                    .foregroundStyle(palette.ink1Color)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.bg2Color))
                    .padding(.top, 16)
                    .accessibilityIdentifier("fetch-matches")
            } else {
                ForEach(MetadataFetchFlow.groups(rows)) { group in
                    Text(group.head)
                        .font(.ui(15, weight: .semibold))
                        .foregroundStyle(palette.ink0Color)
                        .padding(.top, 18)
                        .padding(.bottom, 2)
                        .accessibilityAddTraits(.isHeader)
                    Text(group.note)
                        .font(.ui(13))
                        .foregroundStyle(palette.ink1Color)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 6)
                    ForEach(group.rows) { row in
                        EditionDiffRow(
                            row: row,
                            isOn: MetadataFetchFlow.isOn(row, marks: marks),
                            book: book,
                            staged: staged
                        ) {
                            Haptics.select()
                            marks[row.id] = !MetadataFetchFlow.isOn(row, marks: marks)
                        }
                    }
                }
            }
        }
    }

    private func applyBar(_ edition: ProviderEdition, rows: [MetadataDiffRow]) -> some View {
        let chosen = rows.filter { MetadataFetchFlow.isOn($0, marks: marks) }

        return Button {
            Haptics.success()
            MetadataFetchFlow.apply(
                rows, marks: marks, edition: edition, draft: &draft, staged: &staged
            )
            onApplied(chosen)
        } label: {
            Text(MetadataFetchFlow.applyLabel(chosen: chosen.count))
        }
        .buttonStyle(ApplyPillStyle(enabled: !chosen.isEmpty))
        .disabled(chosen.isEmpty)
        .accessibilityIdentifier("fetch-apply")
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background {
            palette.bg2Color.opacity(0.45)
                .overlay(alignment: .top) {
                    Rectangle().fill(palette.ink0Color.opacity(0.12)).frame(height: 1)
                }
                .ignoresSafeArea(edges: .bottom)
        }
    }

    // MARK: - Network

    private func search() async {
        guard let request = MetadataFetchFlow.searchRequest(query: query, author: author) else {
            queryOpen = true
            stage = .results
            return
        }
        queryFocused = false
        queryOpen = false
        searchGeneration += 1
        let mine = searchGeneration
        withAnimation(Motion.settle) { stage = .asking }

        do {
            let response: EditionSearchResponse = try await APIClient.shared.post(
                "/api/metadata/editions/search", body: request
            )
            guard mine == searchGeneration else { return }
            editions = MetadataFetchFlow.ordered(response.editions, query: request.query)
            sources = response.sources
            queryOpen = editions.isEmpty
            dealing = true
            Haptics.tap()
            withAnimation(Motion.settle) { stage = .results }
        } catch {
            guard mine == searchGeneration else { return }
            queryOpen = true
            withAnimation(Motion.settle) { stage = .failed }
        }
    }

    /// Open the comparison for one candidate, and re-fetch it in full behind
    /// the reveal.
    ///
    /// The merge is one-directional on purpose: the detail record fills in what
    /// the list row lacked and can never take a field away from it, so the row
    /// the reader tapped is still the row they get.
    private func select(_ edition: ProviderEdition) async {
        Haptics.tap()
        hydrateFailure = nil
        marks = [:]
        isHydrating = true
        withAnimation(Motion.settle) { stage = .compare(edition) }

        var fetched: ProviderEdition?
        var failure: String?
        do {
            fetched = try await APIClient.shared.post(
                "/api/metadata/editions/hydrate",
                body: EditionHydrateRequest(
                    source: edition.source,
                    providerRef: edition.providerRef,
                    isbn13: edition.isbn13
                )
            )
        } catch {
            // Both a clean miss and a failure leave the thin search hit on
            // screen — there is nothing better to show either way. But the
            // server keeps them apart deliberately (200 `null` vs 502), and so
            // does this.
            failure = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        let showingOurs = MetadataFetchFlow.hydrateShouldApply(stage: stage, asked: edition)
        if showingOurs {
            hydrateFailure = failure
            if let fetched {
                withAnimation(Motion.settle) {
                    stage = .compare(MetadataFetchFlow.merged(fetched: fetched, thinner: edition))
                }
            }
        }
        // Left alone only while a *newer* selection is in flight — that
        // request owns the flag and will clear it when it lands.
        if showingOurs || comparing == nil {
            isHydrating = false
        }
    }
}

/// The apply button, which can't apply until something is ticked.
private struct ApplyPillStyle: ButtonStyle {
    let enabled: Bool

    @Environment(\.palette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(17, weight: .semibold))
            .foregroundStyle(enabled ? .white : palette.ink0Color.opacity(0.6))
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(Capsule().fill(enabled ? palette.bookDeep : palette.quietFill))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Motion.lift, value: configuration.isPressed)
    }
}
