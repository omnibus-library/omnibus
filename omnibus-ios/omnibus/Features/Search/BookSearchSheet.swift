//  BookSearchSheet.swift
//  The sheet two flows share: search the library and the online providers by
//  title, author or ISBN (typed or scanned), and put one control per result.
//  The Wishlists Add sheet and the Requests "Request a book" sheet differ only
//  in that control and in what they say about a result.

import SwiftUI
import VisionKit

/// A search hit: a library book, or a provider's record of one.
enum BookSearchHit: Equatable {
    /// `formats` are the library's own for a title search; nil for an ISBN lookup, which sends none.
    case library(ScanBook, formats: [String]?)
    /// `lookup` is the ISBN outcome that surfaced the record; nil means resolve-meta first.
    case online(ExternalBookMeta, lookup: ScanOutcome?)

    var title: String {
        switch self {
        case let .library(book, _): book.title
        case let .online(meta, _): meta.title
        }
    }
}

struct BookSearchSheet<Control: View>: View {
    let title: String
    /// Under the field; nothing when nil.
    var hint: String?
    /// Whether a write is running, so the sheet can't be closed on it.
    let isBusy: Bool
    /// A message from the caller's last action, cleared when a new search starts.
    @Binding var error: String?
    /// A word to add after a result's byline, such as "requested".
    var note: (BookSearchHit) -> String? = { _ in nil }
    /// The trailing control for one result, told how its results were found.
    @ViewBuilder let control: (BookSearchHit, FoundVia) -> Control

    /// One section's search state.
    private enum Results {
        case loading, failed
        case done([BookSearchHit])
    }

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var library = Results.loading
    @State private var online = Results.loading
    @State private var scannedCode: String?
    /// How the results on screen were found, fixed when their search started.
    @State private var resultsVia = FoundVia.titleSearch
    @State private var scanning = false
    @State private var scannerAvailable = DataScannerViewController.isSupported
        && DataScannerViewController.isAvailable

    private var search: WishlistSearch { WishlistsFlow.search(for: query) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    if let error {
                        Text(error)
                            .font(.ui(13.5))
                            .foregroundStyle(palette.badColor)
                    }
                    if search == .idle {
                        Text("Search for a book by title, author or ISBN.")
                            .font(.ui(13.5))
                            .foregroundStyle(palette.ink3Color)
                    } else {
                        section("In your library", library)
                        section(onlineHeading, online)
                    }
                }
                .screenPadding()
                .padding(.vertical, Spacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(ScreenBackground())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .top, spacing: 0) { field }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(isBusy)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(isBusy)
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await run(search)
        }
        .fullScreenCover(isPresented: $scanning) { scanner }
    }

    private var field: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                SearchField(text: $query, prompt: "Title, author or ISBN")
                if scannerAvailable {
                    Button { scanning = true } label: {
                        Image(systemName: "barcode.viewfinder")
                            .font(.system(size: 22))
                            .foregroundStyle(palette.accentColor)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Scan a barcode")
                }
            }
            if let hint {
                Text(hint).font(.ui(12.5)).foregroundStyle(palette.ink3Color)
            }
        }
        .screenPadding()
        .padding(.vertical, Spacing.sm)
        .background(ScreenBackground())
    }

    private var scanner: some View {
        NavigationStack {
            BarcodeScannerView { code in
                Haptics.success()
                scannedCode = code
                query = code
                scanning = false
            }
            .ignoresSafeArea()
            .navigationTitle("Scan a barcode")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { scanning = false }
                }
            }
        }
    }

    // MARK: - Results

    private var onlineHeading: String {
        guard case let .done(hits) = online else { return WishlistsFlow.onlineHeading([]) }
        return WishlistsFlow.onlineHeading(hits.compactMap { hit in
            if case let .online(meta, _) = hit { meta } else { nil }
        })
    }

    private func section(_ heading: String, _ results: Results) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text(heading)
                .font(.display(20))
                .foregroundStyle(palette.ink0Color)
            switch results {
            case .loading:
                LoadingView().frame(height: 120)
            case .failed:
                message("Couldn\u{2019}t search just now.")
            case let .done(hits) where hits.isEmpty:
                message("Nothing matches")
            case let .done(hits):
                ForEach(Array(hits.enumerated()), id: \.offset) { _, hit in
                    row(hit)
                    Hairline()
                }
            }
        }
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(.ui(13.5))
            .foregroundStyle(palette.ink3Color)
    }

    private func row(_ hit: BookSearchHit) -> some View {
        HStack(spacing: Spacing.md) {
            cover(hit).frame(width: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(hit.title)
                    .font(.ui(15, weight: .medium))
                    .foregroundStyle(palette.ink0Color)
                    .lineLimit(2)
                Text(byline(hit))
                    .font(.ui(12))
                    .foregroundStyle(palette.ink3Color)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            control(hit, resultsVia)
        }
        .padding(.vertical, Spacing.xs)
    }

    @ViewBuilder
    private func cover(_ hit: BookSearchHit) -> some View {
        switch hit {
        case let .library(book, _):
            BookCover(
                identity: CoverIdentity(
                    uuid: book.uuid, title: book.title, author: book.authors.first,
                    hasCover: book.coverURL != nil
                ),
                size: .sm, cornerRadius: 4
            )
        case let .online(meta, _):
            let plate = BookCover(
                identity: CoverIdentity(
                    uuid: meta.isbn13, title: meta.title, author: meta.authors.first, hasCover: false
                ),
                size: .sm, cornerRadius: 4
            )
            if let url = meta.coverURL, CheckInFlow.isExternalURL(url) {
                ExternalImage(url: url) { plate }
                    .aspectRatio(2.0 / 3.0, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            } else {
                plate
            }
        }
    }

    private func byline(_ hit: BookSearchHit) -> String {
        let base: [String]
        switch hit {
        case let .library(book, _):
            base = [book.authors.joined(separator: ", ")]
        case let .online(meta, _):
            base = [meta.authorDisplay] + CheckInFlow.detailLines(for: meta)
        }
        return (base + [note(hit)].compactMap { $0 }).filter { !$0.isEmpty }.joined(separator: " \u{b7} ")
    }

    // MARK: - Data

    private func run(_ search: WishlistSearch) async {
        error = nil
        switch search {
        case .idle:
            return
        case let .isbn(isbn):
            resultsVia = WishlistsFlow.foundVia(search, scanned: scannedCode)
            library = .loading
            online = .loading
            await lookUp(isbn)
        case let .text(text):
            resultsVia = .titleSearch
            library = .loading
            online = .loading
            async let books: Void = searchLibrary(text)
            async let providers: Void = searchProviders(text)
            _ = await (books, providers)
        }
    }

    /// One lookup answers both sections.
    private func lookUp(_ isbn: String) async {
        do {
            let outcome: ScanOutcome = try await APIClient.shared.post(
                "/api/scan/resolve", body: ScanResolveRequest(isbn: isbn)
            )
            guard !Task.isCancelled else { return }
            let found = WishlistsFlow.isbnResults(outcome)
            library = .done(found.library.map { BookSearchHit.library($0, formats: nil) })
            online = .done(found.online.map { BookSearchHit.online($0, lookup: outcome) })
        } catch {
            guard !Task.isCancelled else { return }
            library = .failed
            online = .failed
        }
    }

    private func searchLibrary(_ text: String) async {
        for await results in LibraryService.searchPalette(query: text) {
            guard !Task.isCancelled else { return }
            library = .done(results.books.map { .library(CheckInFlow.linkTarget(from: $0, isbn: nil), formats: $0.formats) })
        }
    }

    private func searchProviders(_ text: String) async {
        do {
            let response: ScanSearchResponse = try await APIClient.shared.post(
                "/api/scan/search", body: ScanSearchRequest(query: text)
            )
            guard !Task.isCancelled else { return }
            online = .done(response.results.map { BookSearchHit.online($0, lookup: nil) })
        } catch {
            guard !Task.isCancelled else { return }
            online = .failed
        }
    }
}
