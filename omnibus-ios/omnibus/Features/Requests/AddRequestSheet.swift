//  AddRequestSheet.swift
//  "Request a book": search the library and the online providers, then start an
//  ebook request on a result or open the one already going.

import SwiftUI

struct AddRequestSheet: View {
    let model: RequestsModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openDestination) private var openDestination

    @State private var error: String?

    /// One width for Request and Open, so a row's button doesn't change size with its label.
    private static let buttonWidth: CGFloat = 100

    var body: some View {
        BookSearchSheet(
            title: "Request a book",
            hint: "Title, author or ISBN. The scan button reads the barcode on the back cover. Starts an ebook request.",
            isBusy: model.isStarting, error: $error, note: note
        ) { hit, _ in
            control(hit)
        }
    }

    /// What a result asks of the reader: the library book it stands for decides, a bare provider record always starts.
    private func action(_ hit: BookSearchHit) -> (action: RequestsFlow.AddAction, uuid: String?) {
        switch hit {
        case let .library(book, formats):
            return (RequestsFlow.addAction(uuid: book.uuid, formats: formats, hasFiles: book.hasFiles, requested: model.requested), book.uuid)
        case let .online(_, lookup):
            // An ISBN lookup has already matched the record to a library book.
            guard let lookup, let found = WishlistsFlow.isbnResults(lookup).library.first else { return (.start, nil) }
            return (RequestsFlow.addAction(uuid: found.uuid, formats: nil, hasFiles: found.hasFiles, requested: model.requested), found.uuid)
        }
    }

    private func note(_ hit: BookSearchHit) -> String? {
        switch action(hit).action {
        case .open: "requested"
        case .held: "in the library"
        case .start: nil
        }
    }

    @ViewBuilder
    private func control(_ hit: BookSearchHit) -> some View {
        let decision = action(hit)
        switch decision.action {
        case .held:
            EmptyView()
        case .open:
            Button("Open") { if let uuid = decision.uuid { show(uuid) } }
                .buttonStyle(RequestButtonStyle(width: Self.buttonWidth))
                .accessibilityLabel("Open \(hit.title)")
        case .start:
            Button(model.isStarting ? "Requesting\u{2026}" : "Request") { Task { await request(hit) } }
                .buttonStyle(RequestButtonStyle(width: Self.buttonWidth))
                .disabled(model.isStarting || !Connectivity.shared.isOnline)
                .accessibilityLabel("Request \(hit.title)")
        }
    }

    private func request(_ hit: BookSearchHit) async {
        error = nil
        let outcome: AddOutcome
        switch hit {
        case let .library(book, _): outcome = await model.startFromLibrary(uuid: book.uuid)
        case let .online(meta, lookup): outcome = await model.startFromRecord(meta, lookup: lookup)
        }
        switch outcome {
        case let .show(uuid): show(uuid)
        case let .failed(message): error = message
        }
    }

    private func show(_ uuid: String) {
        dismiss()
        openDestination(.bookRequest(uuid: uuid))
    }
}
