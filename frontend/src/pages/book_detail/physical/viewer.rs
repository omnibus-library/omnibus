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

    /// Who checked the copy in, as the card names them: "you" for the
    /// viewer's own copy, `None` once the filer's account is gone.
    pub(super) fn filer_label(self, copy: &PhysicalCopy) -> Option<String> {
        if self.id.is_some() && copy.added_by_user_id == self.id {
            return Some("you".to_string());
        }
        copy.added_by_name.clone()
    }
}
