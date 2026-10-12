//  MirrorFixture.swift
//  A scratch offline mirror for the suites that read the library index.

import Foundation

@testable import omnibus

/// A scratch mirror holding `books`, promoted the way a sync pass does;
/// returns it and its path. `filePrefix` names the file after its suite.
func scratchMirror(_ books: [Book], filePrefix: String) async throws -> (OfflineStore, String) {
    let path = FileManager.default.temporaryDirectory
        .appendingPathComponent("\(filePrefix)-\(UUID().uuidString).sqlite").path
    let store = OfflineStore(path: path)
    await store.open()
    let encoder = JSONEncoder()
    let rows = try books.map { LibraryIndex.row(for: $0, payload: try encoder.encode($0)) }
    await store.appendStagedBooks(rows)
    await store.promoteCompletedStaging()
    return (store, path)
}
