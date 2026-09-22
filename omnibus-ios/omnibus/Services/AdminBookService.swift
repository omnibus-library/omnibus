//  AdminBookService.swift
//  The two admin writes on book detail — merge and delete-files — and the
//  cache work each one leaves behind.
//
//  Both are library-wide (every reader sees the result), so neither passes
//  rule 08 test 1 and neither ever touches the outbox: every call here goes
//  straight to the server, throws on failure, and is offered only while
//  online. Mirrors `frontend/src/data/books/manage.rs`.

import Foundation

enum AdminBookService {
    // MARK: - Merge

    /// Partner search for the merge sheet: FTS across both libraries, deduped
    /// and capped by the server. Includes the target itself when it matches;
    /// `MergeCopy.candidates` drops it before the list is shown.
    static func mergeCandidates(query: String) async throws -> [Book] {
        try await APIClient.shared.get("/api/books/merge/candidates", query: ["q": query])
    }

    /// Merge `source` into `target`. The target absorbs the source's files,
    /// links, identifiers, and every reader's state; the source row is gone.
    /// Returns the `merge_log` id, which is the undo handle.
    static func mergeBooks(source: String, into target: String) async throws -> MergeBooksResult {
        let result: MergeBooksResult = try await APIClient.shared.post(
            "/api/books/merge",
            body: MergeBooksRequest(sourceUuid: source, targetUuid: target)
        )
        await forgetBook(source)
        // The target's cached detail predates the files it just gained.
        await OfflineStore.shared.cacheDelete(CacheKey.book(target))
        await UploadService.invalidateLibrary()
        return result
    }

    /// Reverse a merge by its log id.
    static func undoMerge(id: Int64, target: String) async throws {
        let _: UndoMergeResult = try await APIClient.shared.post(
            "/api/books/merge/undo",
            body: UndoMergeRequest(mergeLogId: id)
        )
        await OfflineStore.shared.cacheDelete(CacheKey.book(target))
        await UploadService.invalidateLibrary()
    }

    // MARK: - Delete

    /// Everything the delete sheet lists: the book's files and physical
    /// copies, and the user data a total delete would take with them. Fetched
    /// fresh rather than read off the detail's `Book` — the listing projection
    /// only carries `bookFiles` for multi-file formats.
    static func deletionManifest(uuid: String) async throws -> BookDeletionManifest {
        try await APIClient.shared.get("/api/books/\(uuid)/deletion-manifest")
    }

    /// Delete the given items. Files are removed from disk, copies are
    /// un-recorded; when every item goes, so does the book and everything
    /// keyed on its uuid — irreversible, which is why the sheet confirms.
    ///
    /// `remaining` is what the manifest listed minus what was picked, so a
    /// download of a format that no longer exists on the server is dropped
    /// here rather than left for the staleness sweep, which has no validator
    /// to compare a vanished file against.
    static func deleteBookItems(
        uuid: String,
        fileIDs: [Int64],
        copyIDs: [Int64],
        remaining: [BookFileInfo]
    ) async throws -> DeleteBookFilesResult {
        let result: DeleteBookFilesResult = try await APIClient.shared.post(
            "/api/books/\(uuid)/delete-files",
            body: DeleteBookFilesRequest(fileIds: fileIDs, copyIds: copyIDs)
        )
        if result.bookDeleted {
            await forgetBook(uuid)
        } else {
            await OfflineStore.shared.cacheDelete(CacheKey.book(uuid))
            for kind in Self.orphanedKinds(remaining: remaining) {
                await DownloadManager.shared.remove(uuid, kind: kind)
            }
        }
        await UploadService.invalidateLibrary()
        return result
    }

    /// Which download kinds a delete left with nothing on the server to back
    /// them: every kind no remaining file belongs to.
    static func orphanedKinds(remaining: [BookFileInfo]) -> [DownloadKind] {
        let stillServed = Set(remaining.map { DownloadKind.inferred(fromFormat: $0.format) })
        return DownloadKind.allCases.filter { !stillServed.contains($0) }
    }

    /// A book the server no longer has: its cached detail would keep answering
    /// for it, and its downloaded bytes have no record to belong to.
    private static func forgetBook(_ uuid: String) async {
        await OfflineStore.shared.cacheDelete(CacheKey.book(uuid))
        await DownloadManager.shared.removeAll(uuid)
    }
}
