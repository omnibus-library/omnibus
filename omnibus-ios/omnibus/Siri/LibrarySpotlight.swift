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

    /// Meta key holding the ids the last completed pass indexed, so the next
    /// one removes only the books that left the mirror.
    private static let indexedKey = "spotlight_indexed_books"

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

    /// Upserts every mirrored book, then drops the ones the last pass indexed
    /// that are gone, so Spotlight never goes empty while a pass runs.
    private static func runPass() async {
        let index = CSSearchableIndex.default()
        do {
            guard await APIClient.shared.hasToken() else { return try await clear(index) }
            // With no record of the last pass, nothing says what is stale.
            let previous: Set<String>
            if let known = await indexedIDs() {
                previous = known
            } else {
                try await clear(index)
                previous = []
            }
            try await indexMirror(into: index, removingStale: previous)
        } catch {
            spotlightLog.error("Spotlight pass failed: \(error.localizedDescription, privacy: .public)")
        }
        await updateShortcuts()
    }

    private static func indexMirror(
        into index: CSSearchableIndex, removingStale previous: Set<String>
    ) async throws {
        var indexed = Set<String>()
        var offset = 0
        do {
            while true {
                let batch = await LibraryIndex.shared.allBooks(limit: batchSize, offset: offset)
                // Checked per batch: a sign-out can land inside a long pass.
                guard await APIClient.shared.hasToken() else { return try await clear(index) }
                if !batch.books.isEmpty {
                    try await index.indexAppEntities(batch.books.map(BookEntity.init))
                }
                indexed.formUnion(batch.books.map(\.uuid))
                guard batch.rows == batchSize else { break }
                offset += batchSize
            }
        } catch {
            // A failed pass still left these in the index; the next one must know.
            await storeIndexedIDs(previous.union(indexed))
            throw error
        }
        let stale = previous.subtracting(indexed)
        if !stale.isEmpty {
            try await index.deleteAppEntities(identifiedBy: Array(stale), ofType: BookEntity.self)
        }
        await storeIndexedIDs(indexed)
    }

    private static func clear(_ index: CSSearchableIndex) async throws {
        try await index.deleteAppEntities(ofType: BookEntity.self)
        await OfflineStore.shared.metaPut(indexedKey, "[]")
    }

    private static func indexedIDs() async -> Set<String>? {
        guard let raw = await OfflineStore.shared.metaGet(indexedKey),
              let ids = try? JSONDecoder().decode([String].self, from: Data(raw.utf8))
        else { return nil }
        return Set(ids)
    }

    private static func storeIndexedIDs(_ ids: Set<String>) async {
        guard let data = try? JSONEncoder().encode(ids.sorted()) else { return }
        await OfflineStore.shared.metaPut(indexedKey, String(decoding: data, as: UTF8.self))
    }

    @MainActor
    private static func updateShortcuts() {
        OmnibusShortcuts.updateAppShortcutParameters()
    }
}
