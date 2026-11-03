//  AddToWishlistSheet.swift
//  Search the library and the online providers by title, author or ISBN (typed
//  or scanned) and put a result on your wishlist.

import SwiftUI
import VisionKit

struct AddToWishlistSheet: View {
    let model: WishlistsModel

    /// One section's search state.
    private enum Results {
        case loading, failed
        case done([WishlistHit])
    }

    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var library = Results.loading
    @State private var online = Results.loading
    @State private var scannedISBN: String?
    @State private var scanning = false
    @State private var addError: String?
    @State private var scannerAvailable = DataScannerViewController.isSupported
        && DataScannerViewController.isAvailable

    private var search: WishlistSearch { WishlistsFlow.search(for: query) }

    /// Only the camera is a scan; a typed ISBN is manual and a title search is neither.
    private var via: FoundVia {
        guard case let .isbn(isbn) = search else { return .titleSearch }
        return isbn == scannedISBN ? .barcodeScan : .isbnEntry
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    if let addError {
                        Text(addError)
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
            }
            .scrollDismissesKeyboard(.interactively)
            .background(ScreenBackground())
            .navigationTitle("Add to your wishlist")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .top, spacing: 0) { field }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(model.isAdding)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(model.isAdding)
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await run(search)
        }
        .fullScreenCover(isPresented: $scanning) { scanner }
    }

    private var field: some View {
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
        .screenPadding()
        .padding(.vertical, Spacing.sm)
        .background(ScreenBackground())
    }

    private var scanner: some View {
        NavigationStack {
            BarcodeScannerView { code in
                Haptics.success()
                scannedISBN = WishlistsFlow.search(for: code).isbnValue
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
                note("Couldn\u{2019}t search just now.")
            case let .done(hits) where hits.isEmpty:
                note("Nothing matches")
            case let .done(hits):
                ForEach(Array(hits.enumerated()), id: \.offset) { _, hit in
                    row(hit)
                    Hairline()
                }
            }
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.ui(13.5))
            .foregroundStyle(palette.ink3Color)
    }

    private func row(_ hit: WishlistHit) -> some View {
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
            Button("Add") { Task { await add(hit) } }
                .buttonStyle(EmptyStateActionStyle())
                .disabled(model.isAdding)
                .accessibilityLabel("Add \(hit.title)")
        }
        .padding(.vertical, Spacing.xs)
    }

    @ViewBuilder
    private func cover(_ hit: WishlistHit) -> some View {
        switch hit {
        case let .library(book):
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

    private func byline(_ hit: WishlistHit) -> String {
        switch hit {
        case let .library(book):
            book.authors.joined(separator: ", ")
        case let .online(meta, _):
            ([meta.authors.joined(separator: ", ")] + [meta.publisher, meta.year].compactMap { $0?.nilIfBlank })
                .filter { !$0.isEmpty }
                .joined(separator: " \u{b7} ")
        }
    }

    // MARK: - Data

    private func add(_ hit: WishlistHit) async {
        addError = nil
        addError = await model.add(hit, via: via)
        if addError == nil { dismiss() }
    }

    private func run(_ search: WishlistSearch) async {
        addError = nil
        switch search {
        case .idle:
            return
        case let .isbn(isbn):
            library = .loading
            online = .loading
            await lookUp(isbn)
        case let .text(text):
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
            library = .done(found.library.map(WishlistHit.library))
            online = .done(found.online.map { WishlistHit.online($0, lookup: outcome) })
        } catch {
            guard !Task.isCancelled else { return }
            library = .failed
            online = .failed
        }
    }

    private func searchLibrary(_ text: String) async {
        for await results in LibraryService.searchPalette(query: text) {
            guard !Task.isCancelled else { return }
            library = .done(results.books.map { .library(CheckInFlow.linkTarget(from: $0, isbn: nil)) })
        }
    }

    private func searchProviders(_ text: String) async {
        do {
            let response: ScanSearchResponse = try await APIClient.shared.post(
                "/api/scan/search", body: ScanSearchRequest(query: text)
            )
            guard !Task.isCancelled else { return }
            online = .done(response.results.map { WishlistHit.online($0, lookup: nil) })
        } catch {
            guard !Task.isCancelled else { return }
            online = .failed
        }
    }
}
