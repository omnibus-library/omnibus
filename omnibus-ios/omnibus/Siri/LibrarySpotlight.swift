//  LibrarySpotlight.swift
//  Keeps the library's books in Spotlight, which is also where Siri finds them.
//
//  Book details only — title, author, series — never book text or reading
//  state, and nothing at all while signed out: the index lives outside the
//  app's sandbox, where whoever picks the phone up next can search it.

import AppIntents
import CoreSpotlight
import Foundation
import os

private let spotlightLog = Logger(subsystem: "com.omnibus.mobile", category: "spotlight")

actor LibrarySpotlight {
    static let shared = LibrarySpotlight()

    /// Books read from the mirror and handed to Spotlight per batch.
    private static let batchSize = 500

    private var pass: Task<Void, Never>?

    /// Re-index the whole mirror, or clear the index when signed out.
    ///
    /// Passes are serialized, as in `WidgetSnapshotWriter`: a sign-out's clear
    /// must not be overtaken by an index pass that started while signed in.
    func refresh() async {
        let previous = pass
        let mine = Task { [previous] in
            _ = await previous?.value
            await Self.runPass()
        }
        pass = mine
        await mine.value
    }

    private static func runPass() async {
        let index = CSSearchableIndex.default()
        do {
            try await index.deleteAppEntities(ofType: BookEntity.self)
            guard await APIClient.shared.hasToken() else { return await updateShortcuts() }
            var offset = 0
            while true {
                let payloads = await OfflineStore.shared.bookPayloads(
                    whereClause: "", orderClause: "title", bindings: [],
                    limit: batchSize, offset: offset
                )
                let entities = payloads
                    .compactMap { try? JSONDecoder().decode(Book.self, from: $0) }
                    .map(BookEntity.init)
                // Checked per batch: a sign-out can land inside a long pass.
                guard await APIClient.shared.hasToken() else {
                    try await index.deleteAppEntities(ofType: BookEntity.self)
                    break
                }
                if !entities.isEmpty { try await index.indexAppEntities(entities) }
                guard payloads.count == batchSize else { break }
                offset += batchSize
            }
        } catch {
            spotlightLog.error("Spotlight pass failed: \(error.localizedDescription, privacy: .public)")
        }
        await updateShortcuts()
    }

    @MainActor
    private static func updateShortcuts() {
        OmnibusShortcuts.updateAppShortcutParameters()
    }
}
