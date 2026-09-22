//  AdminBookActionsTests.swift
//  What the merge and delete flows decide before they reach the network:
//  who sees the rows, when they act, what the confirm says, and how the wire
//  shapes decode.
//
//  The gate and the copy are the load-bearing parts: the gate keeps two
//  library-wide writes off the outbox (rule 08 test 1) by refusing to act
//  offline, and the copy is the one place "this deletes the whole book" is
//  said before an irreversible request is sent.

import Foundation
import Testing

@testable import omnibus

@Suite("Admin book actions")
struct AdminBookActionsTests {
    private func file(_ id: Int64, _ format: String) -> BookFileInfo {
        BookFileInfo(id: id, format: format, filename: "book.\(format)", ordinal: 0, label: nil)
    }

    private func copy(_ id: Int64) -> PhysicalCopy {
        PhysicalCopy(id: id, bookUuid: "u", isbn: nil, addedByUserId: nil, checkedInAt: 0)
    }

    private func manifest(files: [BookFileInfo], copies: [PhysicalCopy] = [], impact: BookDeletionImpact = .init())
        -> BookDeletionManifest
    {
        BookDeletionManifest(files: files, copies: copies, impact: impact)
    }

    // MARK: - The gate

    @Test("hides both rows from a reader who is not an admin")
    func hiddenForReaders() {
        let gate = AdminBookGate.resolve(isAdmin: false, isOnline: true)
        #expect(gate.isHidden)
        // Never drawn, so never pressable — the two have to agree.
        #expect(!gate.isEnabled)
    }

    @Test("shows the rows to an admin but disables them offline — neither write is ever queued")
    func disabledOffline() {
        let gate = AdminBookGate.resolve(isAdmin: true, isOnline: false)
        #expect(gate == .offline)
        #expect(!gate.isHidden)
        #expect(!gate.isEnabled)
    }

    @Test("lets an online admin act")
    func readyOnline() {
        #expect(AdminBookGate.resolve(isAdmin: true, isOnline: true).isEnabled)
    }

    // MARK: - Delete copy

    @Test("a partial delete names the file and says the book stays")
    func partialDelete() {
        let m = manifest(files: [file(1, "epub"), file(2, "m4b")])
        let copy = DeleteSelectionCopy.resolve(
            title: "Piranesi", manifest: m, pickedFiles: [1], pickedCopies: []
        )
        #expect(copy.heading == "Delete 1 file?")
        #expect(copy.body.hasPrefix("\u{201c}book.epub\u{201d} will be deleted from disk"))
        #expect(copy.body.hasSuffix("Piranesi stays in your library with its 1 remaining file."))
        #expect(copy.action == "Delete file")
        // Nothing keyed on the book goes with one file.
        #expect(copy.losses.isEmpty)
    }

    @Test("picking every item says the whole book goes, and lists what goes with it")
    func totalDelete() {
        let impact = BookDeletionImpact(highlights: 3, ratings: 1)
        let m = manifest(files: [file(1, "epub"), file(2, "m4b")], impact: impact)
        let copy = DeleteSelectionCopy.resolve(
            title: "Piranesi", manifest: m, pickedFiles: [1, 2], pickedCopies: []
        )
        #expect(copy.heading == "Delete all 2 files?")
        #expect(copy.body.contains("removed from your library entirely"))
        #expect(copy.action == "Delete book")
        #expect(copy.losses == ["3 highlights", "1 rating"])
    }

    @Test("a single-item book names the book rather than reading \"all 1 file\"")
    func totalDeleteOfOneFile() {
        let m = manifest(files: [file(1, "epub")])
        let copy = DeleteSelectionCopy.resolve(
            title: "Piranesi", manifest: m, pickedFiles: [1], pickedCopies: []
        )
        #expect(copy.heading == "Delete \u{201c}Piranesi\u{201d}?")
    }

    @Test("a book with nothing on disk offers the record delete and promises the filesystem is untouched")
    func recordOnlyDelete() {
        let copy = DeleteSelectionCopy.resolve(
            title: "Wanted", manifest: manifest(files: []), pickedFiles: [], pickedCopies: []
        )
        #expect(copy.heading == "Delete \u{201c}Wanted\u{201d}?")
        #expect(copy.body.contains("nothing is deleted from your filesystem"))
        #expect(copy.action == "Delete record")
    }

    @Test("physical copies turn files into items, and a copy left behind keeps the record")
    func copiesAreItems() {
        let m = manifest(files: [file(1, "epub")], copies: [copy(7)])
        let partial = DeleteSelectionCopy.resolve(
            title: "Piranesi", manifest: m, pickedFiles: [1], pickedCopies: []
        )
        #expect(partial.heading == "Delete 1 item?")
        #expect(partial.body.hasSuffix("with its 1 remaining item."))

        let total = DeleteSelectionCopy.resolve(
            title: "Piranesi", manifest: m, pickedFiles: [1], pickedCopies: [7]
        )
        #expect(total.heading == "Delete all 2 items?")
    }

    @Test("a copy-only partial delete says the copy is un-recorded, not deleted from disk")
    func copyOnlyPartialDelete() {
        let m = manifest(files: [file(1, "epub")], copies: [copy(7), copy(8)])
        let partial = DeleteSelectionCopy.resolve(
            title: "Piranesi", manifest: m, pickedFiles: [], pickedCopies: [7]
        )
        #expect(partial.body.contains("will be un-recorded \u{2014} nothing is deleted from disk"))
    }

    @Test("a mixed partial delete separates the file and copy consequences")
    func mixedPartialDelete() {
        let m = manifest(files: [file(1, "epub"), file(2, "m4b")], copies: [copy(7)])
        let partial = DeleteSelectionCopy.resolve(
            title: "Piranesi", manifest: m, pickedFiles: [1], pickedCopies: [7]
        )
        #expect(partial.body.contains("files deleted from disk, physical copies only un-recorded"))
    }

    @Test("a total delete with files and copies says the copies are un-recorded, not deleted")
    func totalDeleteWithCopies() {
        let m = manifest(files: [file(1, "epub")], copies: [copy(7)])
        let total = DeleteSelectionCopy.resolve(
            title: "Piranesi", manifest: m, pickedFiles: [1], pickedCopies: [7]
        )
        #expect(total.body.contains("its physical copies un-recorded"))
    }

    @Test("a paper-only total delete says nothing is deleted from disk")
    func paperOnlyTotalDelete() {
        let m = manifest(files: [], copies: [copy(7)])
        let total = DeleteSelectionCopy.resolve(
            title: "Wanted", manifest: m, pickedFiles: [], pickedCopies: [7]
        )
        #expect(total.body.hasPrefix("\u{201c}Wanted\u{201d} has no files on disk."))
        #expect(total.body.contains("nothing is deleted from your filesystem"))
    }

    @Test("the menu promises files only when there are files")
    func menuLabel() {
        #expect(DeleteSelectionCopy.menuLabel(hasFiles: true) == "Delete files\u{2026}")
        #expect(DeleteSelectionCopy.menuLabel(hasFiles: false) == "Delete record\u{2026}")
    }

    @Test("the choose button names the action at zero and the count after")
    func chooseAction() {
        #expect(DeleteSelectionCopy.chooseAction(picked: 0, hasCopies: false) == "Delete files\u{2026}")
        #expect(DeleteSelectionCopy.chooseAction(picked: 1, hasCopies: false) == "Delete 1 file\u{2026}")
        #expect(DeleteSelectionCopy.chooseAction(picked: 2, hasCopies: true) == "Delete 2 items\u{2026}")
    }

    @Test("losses singularizes and skips zero counts")
    func losses() {
        #expect(BookDeletionImpact().losses.isEmpty)
        #expect(BookDeletionImpact(journalEntries: 1, shelves: 2).losses == ["1 journal entry", "2 shelf placements"])
    }

    // MARK: - Downloads a delete strands

    @Test("deleting the last file of a format drops that format's download, not the other's")
    func orphanedKinds() {
        #expect(AdminBookService.orphanedKinds(remaining: [file(2, "m4b")]) == [.ebook])
        #expect(AdminBookService.orphanedKinds(remaining: [file(1, "epub")]) == [.audio])
        #expect(AdminBookService.orphanedKinds(remaining: [file(1, "epub"), file(2, "mp3")]).isEmpty)
    }

    // MARK: - Merge

    @Test("the candidate list never offers the target itself")
    func candidatesExcludeTarget() {
        var target = Book(id: 1, filename: "a.epub")
        target.uniqueIdentifier = "target"
        var other = Book(id: 2, filename: "b.epub")
        other.uniqueIdentifier = "other"
        let out = MergeCopy.candidates([target, other], excludingTarget: "target")
        #expect(out.map(\.uuid) == ["other"])
    }

    @Test("the confirm names both books and promises the undo")
    func confirmBody() {
        let body = MergeCopy.confirmBody(source: "Dune", target: "Dune (audio)")
        #expect(body.hasPrefix("\u{201c}Dune\u{201d} will be merged into \u{201c}Dune (audio)\u{201d}."))
        #expect(body.hasSuffix("This can be undone."))
    }

    // MARK: - Wire

    @Test("the merge and delete results decode from the server's snake_case")
    func wireDecodes() throws {
        let merge = try JSONDecoder().decode(
            MergeBooksResult.self,
            from: Data(#"{"merge_log_id":42,"target_uuid":"t"}"#.utf8)
        )
        #expect(merge == MergeBooksResult(mergeLogId: 42, targetUuid: "t"))

        let undo = try JSONDecoder().decode(
            UndoMergeResult.self, from: Data(#"{"restored_uuid":"s"}"#.utf8)
        )
        #expect(undo.restoredUuid == "s")

        let deleted = try JSONDecoder().decode(
            DeleteBookFilesResult.self,
            from: Data(#"{"deleted_file_ids":[1],"deleted_copy_ids":[],"book_deleted":true}"#.utf8)
        )
        #expect(deleted == DeleteBookFilesResult(deletedFileIds: [1], deletedCopyIds: [], bookDeleted: true))

        let manifest = try JSONDecoder().decode(
            BookDeletionManifest.self,
            from: Data(#"""
            {"files":[{"id":1,"format":"epub","filename":"a.epub","ordinal":0,"size_bytes":10}],
             "copies":[{"id":7,"book_uuid":"u","isbn":"9780000000001","checked_in_at":5}],
             "impact":{"highlights":2,"journal_entries":0,"bookmarks":0,"reading_sessions":0,"listening_sessions":0,"ratings":0,"shelves":0}}
            """#.utf8)
        )
        #expect(manifest.itemCount == 2)
        #expect(manifest.impact.losses == ["2 highlights"])
        #expect(manifest.copies.first?.isbn == "9780000000001")
    }
}
