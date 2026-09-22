//  AdminBookModels.swift
//  Wire mirrors and the pre-network decisions behind the two admin actions on
//  book detail: merging a book into this one, and deleting its files.
//
//  Ports `shared/src/{merge,deletion}.rs` and the copy logic of the web
//  dialogs (`frontend/src/components/{merge_dialog,delete_book_dialog}.rs`),
//  so the two clients describe the same action in the same words.

import Foundation

// MARK: - Merge wire

/// `POST /api/books/merge` result: the `merge_log` id (the undo handle) and
/// the surviving book's uuid.
struct MergeBooksResult: Codable, Equatable, Sendable {
    var mergeLogId: Int64
    var targetUuid: String

    enum CodingKeys: String, CodingKey {
        case mergeLogId = "merge_log_id"
        case targetUuid = "target_uuid"
    }
}

/// `POST /api/books/merge` body.
struct MergeBooksRequest: Encodable, Sendable {
    var sourceUuid: String
    var targetUuid: String

    enum CodingKeys: String, CodingKey {
        case sourceUuid = "source_uuid"
        case targetUuid = "target_uuid"
    }
}

/// `POST /api/books/merge/undo` body.
struct UndoMergeRequest: Encodable, Sendable {
    var mergeLogId: Int64

    enum CodingKeys: String, CodingKey {
        case mergeLogId = "merge_log_id"
    }
}

/// `POST /api/books/merge/undo` result: the restored (source) book's uuid.
struct UndoMergeResult: Decodable, Equatable, Sendable {
    var restoredUuid: String

    enum CodingKeys: String, CodingKey {
        case restoredUuid = "restored_uuid"
    }
}

// MARK: - Deletion wire

/// A library-wide physical copy of a book (`shared/src/physical.rs`).
struct PhysicalCopy: Codable, Hashable, Sendable, Identifiable {
    var id: Int64
    var bookUuid: String
    var isbn: String?
    var addedByUserId: Int64?
    var checkedInAt: Int64
    var checkedInAtIso: String?
    var note: String?

    enum CodingKeys: String, CodingKey {
        case id, isbn, note
        case bookUuid = "book_uuid"
        case addedByUserId = "added_by_user_id"
        case checkedInAt = "checked_in_at"
        case checkedInAtIso = "checked_in_at_iso"
    }
}

/// What a total delete takes with the book — the counts the confirm names.
struct BookDeletionImpact: Codable, Equatable, Sendable {
    var highlights: Int64 = 0
    var journalEntries: Int64 = 0
    var bookmarks: Int64 = 0
    var readingSessions: Int64 = 0
    var listeningSessions: Int64 = 0
    var ratings: Int64 = 0
    var shelves: Int64 = 0

    enum CodingKeys: String, CodingKey {
        case highlights, bookmarks, ratings, shelves
        case journalEntries = "journal_entries"
        case readingSessions = "reading_sessions"
        case listeningSessions = "listening_sessions"
    }

    /// Human-readable phrases for each non-zero count, in the order the
    /// confirm lists them (`["3 highlights", "1 rating"]`). Empty when the
    /// book carries no user data at all. Mirrors `BookDeletionImpact::losses`.
    var losses: [String] {
        [
            (highlights, "highlight", "highlights"),
            (journalEntries, "journal entry", "journal entries"),
            (bookmarks, "bookmark", "bookmarks"),
            (readingSessions, "reading session", "reading sessions"),
            (listeningSessions, "listening session", "listening sessions"),
            (ratings, "rating", "ratings"),
            (shelves, "shelf placement", "shelf placements"),
        ]
        .filter { $0.0 > 0 }
        .map { "\($0.0) \($0.0 == 1 ? $0.1 : $0.2)" }
    }
}

/// `GET /api/books/{uuid}/deletion-manifest`: every deletable item and the
/// user data a total delete would purge.
struct BookDeletionManifest: Codable, Equatable, Sendable {
    var files: [BookFileInfo] = []
    var copies: [PhysicalCopy] = []
    var impact = BookDeletionImpact()

    /// Total deletable items — the count a full selection has to reach for
    /// the book record itself to go.
    var itemCount: Int { files.count + copies.count }
}

/// `POST /api/books/{uuid}/delete-files` body.
struct DeleteBookFilesRequest: Encodable, Sendable {
    var fileIds: [Int64]
    var copyIds: [Int64]

    enum CodingKeys: String, CodingKey {
        case fileIds = "file_ids"
        case copyIds = "copy_ids"
    }
}

/// What a delete actually removed. `bookDeleted` is how the screen learns the
/// book it is showing is gone.
struct DeleteBookFilesResult: Decodable, Equatable, Sendable {
    var deletedFileIds: [Int64]
    var deletedCopyIds: [Int64]
    var bookDeleted: Bool

    enum CodingKeys: String, CodingKey {
        case deletedFileIds = "deleted_file_ids"
        case deletedCopyIds = "deleted_copy_ids"
        case bookDeleted = "book_deleted"
    }
}

// MARK: - Decisions

/// Whether the admin rows appear in the book-detail menu, and whether they
/// act. Both writes are library-wide (rule 08 test 1), so neither is ever
/// queued: offline they stay visible and disabled rather than failing after
/// the tap, and a non-admin never sees them at all.
enum AdminBookGate: Equatable {
    case hidden
    case offline
    case ready

    static func resolve(isAdmin: Bool, isOnline: Bool) -> AdminBookGate {
        guard isAdmin else { return .hidden }
        return isOnline ? .ready : .offline
    }

    var isHidden: Bool { self == .hidden }
    var isEnabled: Bool { self == .ready }
}

/// The wording of the delete flow, decided from the manifest and the picked
/// items. A pure function of its inputs so the sheet renders it and a test
/// can pin it without a network.
struct DeleteSelectionCopy: Equatable {
    /// The menu row's label. "Delete files…" is a promise about the
    /// filesystem, and a wishlist entry or paper-only book has no files to
    /// make it about — say "record" instead (#2471).
    static func menuLabel(hasFiles: Bool) -> String {
        hasFiles ? "Delete files\u{2026}" : "Delete record\u{2026}"
    }

    var heading: String
    var body: String
    var action: String
    /// What a total delete also takes — `impact.losses` — and empty when the
    /// delete is partial, since nothing keyed on the book goes with a file.
    var losses: [String]

    /// The confirm step's copy for one selection. Mirrors `confirm_labels` in
    /// the web dialog, except physical copies are described as un-recorded
    /// rather than deleted — `db::delete_book_items` deletes files from disk
    /// but only un-records a copy, it never touches the filesystem for one.
    static func resolve(
        title: String,
        manifest: BookDeletionManifest,
        pickedFiles: Set<Int64>,
        pickedCopies: Set<Int64>
    ) -> DeleteSelectionCopy {
        let picked = pickedFiles.count + pickedCopies.count
        let empty = manifest.itemCount == 0
        let total = empty || picked == manifest.itemCount
        let remaining = max(0, manifest.itemCount - picked)
        // "items" once a physical copy is in the mix — not every row is a file.
        let noun = Self.noun(count: picked, hasCopies: !manifest.copies.isEmpty)
        let quoted = "\u{201c}\(title)\u{201d}"

        let heading: String
        if empty || (total && picked == 1) {
            // "Delete all 1 file?" doesn't read — name the book instead.
            heading = "Delete \(quoted)?"
        } else if total {
            heading = "Delete all \(picked) \(noun)?"
        } else {
            heading = "Delete \(picked) \(noun)?"
        }

        let body: String
        if empty {
            body = "This book has no files on disk. Deleting removes the library record only \u{2014} nothing is deleted from your filesystem."
        } else if total {
            if manifest.files.isEmpty {
                // Paper-only: nothing on disk, so nothing to delete there.
                body = "\(quoted) has no files on disk. Its physical copies will be un-recorded and the book removed from your library entirely \u{2014} nothing is deleted from your filesystem."
            } else if !manifest.copies.isEmpty {
                body = "Every file for \(quoted) will be deleted from disk, its physical copies un-recorded, and the book will be removed from your library entirely."
            } else {
                body = "Every file for \(quoted) will be deleted from disk, and the book will be removed from your library entirely."
            }
        } else {
            let left = Self.noun(count: remaining, hasCopies: !manifest.copies.isEmpty)
            let label = pickedLabel(manifest: manifest, pickedFiles: pickedFiles, pickedCopies: pickedCopies)
            if pickedFiles.isEmpty {
                body = "\(label) will be un-recorded \u{2014} nothing is deleted from disk. \(title) stays in your library with its \(remaining) remaining \(left)."
            } else if !pickedCopies.isEmpty {
                body = "\(label) will be removed from this book \u{2014} files deleted from disk, physical copies only un-recorded. \(title) stays in your library with its \(remaining) remaining \(left)."
            } else {
                body = "\(label) will be deleted from disk and removed from this book. \(title) stays in your library with its \(remaining) remaining \(left)."
            }
        }

        let action: String
        if empty {
            action = "Delete record"
        } else if total {
            action = "Delete book"
        } else {
            action = "Delete \(noun)"
        }

        return DeleteSelectionCopy(
            heading: heading,
            body: body,
            action: action,
            losses: total ? manifest.impact.losses : []
        )
    }

    /// The choose step's continue button: names the action rather than a
    /// count while nothing is picked, since the button is disabled at zero.
    static func chooseAction(picked: Int, hasCopies: Bool) -> String {
        let noun = noun(count: picked, hasCopies: hasCopies)
        return picked == 0 ? "Delete \(noun)\u{2026}" : "Delete \(picked) \(noun)\u{2026}"
    }

    private static func noun(count: Int, hasCopies: Bool) -> String {
        switch (hasCopies, count) {
        case (true, 1): "item"
        case (true, _): "items"
        case (false, 1): "file"
        case (false, _): "files"
        }
    }

    /// "The EPUB", "2 files", "1 file and 1 copy" — what a partial delete
    /// names in its body.
    private static func pickedLabel(
        manifest: BookDeletionManifest, pickedFiles: Set<Int64>, pickedCopies: Set<Int64>
    ) -> String {
        let files = manifest.files.filter { pickedFiles.contains($0.id) }
        let copies = pickedCopies.count
        if copies == 0, files.count == 1, let only = files.first {
            return "\u{201c}\(only.label?.nilIfBlank ?? only.filename)\u{201d}"
        }
        var parts: [String] = []
        if !files.isEmpty { parts.append("\(files.count) \(files.count == 1 ? "file" : "files")") }
        if copies > 0 { parts.append("\(copies) \(copies == 1 ? "copy" : "copies")") }
        return parts.joined(separator: " and ")
    }
}

/// The merge sheet's decisions.
enum MergeCopy {
    /// Candidate rows never include the target itself: merging a book into
    /// itself is the one request the server refuses outright, so the row
    /// that could only produce that error is not offered.
    static func candidates(_ hits: [Book], excludingTarget target: String) -> [Book] {
        hits.filter { $0.uuid != target }
    }

    /// The confirm step's body — the same sentence the web dialog shows.
    static func confirmBody(source: String, target: String) -> String {
        "\u{201c}\(source)\u{201d} will be merged into \u{201c}\(target)\u{201d}. Its files, tags, and reading progress move here; the other entry disappears. This can be undone."
    }
}
