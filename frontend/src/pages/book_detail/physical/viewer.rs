//! Who is looking at the physical panel, and so which of a copy's controls it
//! offers. Mirrors the server's rules so a reader is never shown a control
//! the server would refuse: a copy's note and removal belong to its filer or
//! an admin, deleting the book itself to an editor or admin.

use omnibus_shared::physical::PhysicalCopy;
use omnibus_shared::UserSummary;

/// The signed-in reader as the panel sees it. The default — no user resolved
/// yet — may change nothing.
#[derive(Clone, Copy, PartialEq, Default)]
pub(super) struct PhysViewer {
    pub(super) id: Option<i64>,
    pub(super) is_admin: bool,
    pub(super) can_edit: bool,
}

impl PhysViewer {
    /// The viewer for a resolved (or still-unresolved) session.
    pub(super) fn from_user(user: Option<&UserSummary>) -> Self {
        user.map(|u| Self {
            id: Some(u.id),
            is_admin: u.is_admin,
            can_edit: u.can_edit,
        })
        .unwrap_or_default()
    }

    /// Whether the copy's note and removal controls render for this viewer.
    pub(super) fn may_change(self, copy: &PhysicalCopy) -> bool {
        self.id.is_some_and(|id| copy.can_change(id, self.is_admin))
    }

    /// Whether the last-copy prompt may offer "Remove from library", which
    /// deletes the book for everyone.
    pub(super) fn may_remove_book(self) -> bool {
        self.is_admin || self.can_edit
    }

    /// Whose physical collection one copy sits in: the viewer's own, the
    /// reader who filed it, or the household's once the filer is gone. An
    /// unresolved viewer is never guessed at.
    pub(super) fn copy_collection_label(self, copy: &PhysicalCopy) -> String {
        let Some(id) = self.id else {
            return collection_of(None);
        };
        if copy.added_by_user_id == Some(id) {
            return "In your physical collection".to_string();
        }
        collection_of(copy.added_by_name.as_deref())
    }

    /// The section pill for a book's copies: yours when you filed any of them,
    /// else the one reader who filed them all, else the household's.
    pub(super) fn collection_label(self, copies: &[PhysicalCopy]) -> String {
        if let Some(own) = copies
            .iter()
            .find(|c| self.id.is_some() && c.added_by_user_id == self.id)
        {
            return self.copy_collection_label(own);
        }
        let mut filers = copies.iter().map(|c| c.added_by_name.as_deref());
        match filers.next() {
            Some(first) if first.is_some() && filers.all(|f| f == first) => collection_of(first),
            _ => collection_of(None),
        }
    }

    /// Who checked the copy in, as the card names them: "you" for the
    /// viewer's own copy, `None` once the filer's account is gone.
    pub(super) fn filer_label(self, copy: &PhysicalCopy) -> Option<String> {
        if self.id.is_some() && copy.added_by_user_id == self.id {
            return Some("you".to_string());
        }
        copy.added_by_name.clone()
    }
}

/// "In Sam's physical collection", or the household's when no reader is named.
fn collection_of(filer: Option<&str>) -> String {
    match filer {
        Some(name) => format!("In {name}'s physical collection"),
        None => "In the household's physical collection".to_string(),
    }
}
