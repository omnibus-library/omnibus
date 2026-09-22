//  ShelfActionsTests.swift
//  Who may change a shelf from a long-press, and what the delete asks.
//
//  Mirrors `db::shelves::can_edit` — owner or admin — plus the system-shelf
//  lock the write path applies. Offering an item the server would refuse turns
//  a long-press into a 403, and the delete used to run with no question at all.

import Testing

@testable import omnibus

@Suite("Shelf long-press actions")
struct ShelfActionsTests {
    @Test("the owner may edit their own shelf")
    func ownerMayEdit() {
        #expect(ShelfActions.canEdit(viewerId: 7, isAdmin: false, ownerUserId: 7, kind: .manual))
        #expect(ShelfActions.canEdit(viewerId: 7, isAdmin: false, ownerUserId: 7, kind: .smart))
    }

    @Test("an admin may edit anyone's shelf")
    func adminMayEditAnyones() {
        #expect(ShelfActions.canEdit(viewerId: 7, isAdmin: true, ownerUserId: 9, kind: .manual))
    }

    @Test("another reader's shelf is read-only")
    func anotherReadersShelfIsReadOnly() {
        #expect(!ShelfActions.canEdit(viewerId: 7, isAdmin: false, ownerUserId: 9, kind: .manual))
    }

    @Test("withholds the menu while the viewer is unknown")
    func withholdsWhileTheViewerIsUnresolved() {
        // Guessing "yours" before `confirmIdentity` returns would offer a
        // delete on a shelf that turns out to be someone else's.
        #expect(!ShelfActions.canEdit(viewerId: nil, isAdmin: true, ownerUserId: 7, kind: .manual))
    }

    @Test("never offers to edit a wishlist, even to its owner or an admin")
    func neverEditsAWishlist() {
        // The server locks the system shelf outright (`ShelfError::SystemShelf`).
        #expect(!ShelfActions.canEdit(viewerId: 7, isAdmin: true, ownerUserId: 7, kind: .wishlist))
    }

    @Test("the delete prompt names the shelf")
    func deletePromptNamesTheShelf() {
        #expect(ShelfActions.deleteTitle(name: "Lunch Break Picks") == "Delete “Lunch Break Picks”?")
    }

    @Test("the delete prompt says what goes with it, and what stays")
    func deletePromptSaysWhatStays() {
        #expect(ShelfActions.deleteMessage(bookCount: 0).hasPrefix("The shelf is empty."))
        #expect(ShelfActions.deleteMessage(bookCount: 1).hasPrefix("The book on it stays"))
        #expect(ShelfActions.deleteMessage(bookCount: 2).hasPrefix("Its 2 books stay"))
    }
}
