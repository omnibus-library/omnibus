//  ShelfContextMenu.swift
//  Long-press quick actions for a shelf card: edit its name, visibility and
//  rules, or delete it — after asking. One modifier shared by the shelves
//  grid and the landing rail, so a held-down shelf means the same thing on
//  both, and the delete can't run off a slipped finger on either.

import SwiftUI

/// The glyphs the shared menu draws, named so a test can prove they resolve —
/// `Image(systemName:)` neither warns nor fails on a name that doesn't exist.
enum ShelfMenuGlyph {
    static let edit = "pencil"
    static let delete = "trash"
}

/// What the viewer may do to a shelf, and the words the delete asks with.
/// Pure, so the rules are testable without a screen.
enum ShelfActions {
    /// Whether the viewer may rename, re-rule or delete a shelf. Mirrors
    /// `db::shelves::can_edit` (owner or admin) plus the system-shelf lock the
    /// write path applies: offering an item the server would refuse only turns
    /// a long-press into a 403. `nil` withholds rather than guesses, as
    /// attribution does — the viewer's own shelves stay uneditable for as
    /// long as the identity takes to confirm, never someone else's editable.
    nonisolated static func canEdit(
        viewerId: Int64?, isAdmin: Bool, ownerUserId: Int64, kind: ShelfKind
    ) -> Bool {
        guard let viewerId, !kind.isSystem else { return false }
        return viewerId == ownerUserId || isAdmin
    }

    /// The confirmation names the shelf and says what goes with it: the
    /// shelf, never the books — a reader who curated it by hand should not
    /// have to guess whether "delete" reaches into the library.
    nonisolated static func deleteTitle(name: String) -> String {
        "Delete \u{201C}\(name)\u{201D}?"
    }

    nonisolated static func deleteMessage(bookCount: Int64) -> String {
        switch bookCount {
        case 0: "The shelf is empty. This can't be undone."
        case 1: "The book on it stays in your library. This can't be undone."
        default: "Its \(bookCount) books stay in your library. This can't be undone."
        }
    }
}

extension View {
    /// Attach the shared long-press menu to a shelf card. `onChanged` runs
    /// after an edit saves or a delete lands, so the surface can refresh the
    /// cards behind the sheet. A shelf the viewer can't change gets no menu
    /// at all rather than an empty one.
    func shelfContextMenu(
        _ shelf: ShelfSummary,
        onChanged: @escaping () -> Void
    ) -> some View {
        modifier(ShelfContextMenuModifier(shelf: shelf, onChanged: onChanged))
    }
}

private struct ShelfContextMenuModifier: ViewModifier {
    let shelf: ShelfSummary
    var onChanged: () -> Void

    @Environment(AppState.self) private var app
    @State private var showEditor = false
    @State private var confirmDelete = false

    private var canEdit: Bool {
        ShelfActions.canEdit(
            viewerId: app.user?.id,
            isAdmin: app.user?.isAdmin == true,
            ownerUserId: shelf.ownerUserId,
            kind: shelf.kind
        )
    }

    func body(content: Content) -> some View {
        content
            .contextMenu {
                if canEdit {
                    Button {
                        showEditor = true
                    } label: {
                        Label("Edit shelf", systemImage: ShelfMenuGlyph.edit)
                    }
                    Button(role: .destructive) {
                        confirmDelete = true
                    } label: {
                        Label("Delete shelf", systemImage: ShelfMenuGlyph.delete)
                    }
                }
            }
            // A sheet rather than a push: the grid and the rail sit in
            // different NavigationStacks, and a sheet needs neither's path.
            .sheet(isPresented: $showEditor) {
                EditShelfSheet(shelf: shelf, onSaved: onChanged)
            }
            .confirmationDialog(
                ShelfActions.deleteTitle(name: shelf.name),
                isPresented: $confirmDelete,
                titleVisibility: .visible
            ) {
                Button("Delete shelf", role: .destructive) {
                    Task {
                        await UserDataService.deleteShelf(id: shelf.id)
                        onChanged()
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(ShelfActions.deleteMessage(bookCount: shelf.bookCount))
            }
    }
}
