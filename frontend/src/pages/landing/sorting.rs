//! Sort-control vocabulary and row-identity helpers for the landing page.
//!
//! The toolbar's sort axes, labels, and lock reason, plus the per-book testid
//! slug and keyed-list diff key. Sorting itself is server-side.
// The mobile build renders its own compact grid (no sort toolbar), so several
// of these web-facing helpers are dead there by design.
#![cfg_attr(feature = "mobile", allow(dead_code))]

use omnibus_shared::{Contributor, EbookMetadata, ShelfKind, SortDir, SortKey};

/// Join contributor names into one comma-separated display string.
pub(crate) fn contributor_names(list: &[Contributor]) -> String {
    let mut out = String::new();
    for (i, c) in list.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        out.push_str(&c.name);
    }
    out
}

/// The opposite of `d` — what the toolbar's direction button lands on.
pub(crate) fn toggle_dir(d: SortDir) -> SortDir {
    match d {
        SortDir::Asc => SortDir::Desc,
        SortDir::Desc => SortDir::Asc,
    }
}

/// Why the landing's sort controls are inert for the current gallery pick, or
/// `None` when they act.
///
/// A hand-picked shelf's member order is the reader's own
/// (`ORDER BY sb.position, sb.added_at`) and the wishlist's is when they
/// wished for it (`ORDER BY we.added_at DESC`) — both settled server-side in
/// `db::shelves::read::detail`, where neither the axis nor the direction is
/// consulted. The queries are deliberate and unchanged; what was wrong is a
/// control that stayed live and pretended to act.
pub(crate) fn sort_lock_reason(kind: Option<ShelfKind>) -> Option<&'static str> {
    match kind? {
        ShelfKind::Manual | ShelfKind::Wishlist => Some("shelf order"),
        ShelfKind::Smart => None,
    }
}

/// The direction a freshly-picked sort key starts in — descending for the
/// two recency keys, ascending otherwise.
pub(crate) fn default_dir_for(key: SortKey) -> SortDir {
    // The recency keys feel natural with newest first.
    match key {
        SortKey::NewestAdded | SortKey::LastUpdated | SortKey::RecentlyInteracted => SortDir::Desc,
        _ => SortDir::Asc,
    }
}

/// The sort axes the toolbar dropdown offers, in display order.
pub(crate) const SORT_KEYS: [SortKey; 6] = [
    SortKey::Title,
    SortKey::Author,
    SortKey::Series,
    SortKey::RecentlyInteracted,
    SortKey::LastUpdated,
    SortKey::NewestAdded,
];

/// The key's wire token, as used by the dropdown, the REST query, and the
/// page cursor.
pub(crate) fn sort_key_value(key: SortKey) -> &'static str {
    // Delegate to the shared wire vocabulary so the dropdown, the REST query,
    // and the cursor axis can't drift.
    key.as_wire()
}

/// The key's human-readable dropdown label.
pub(crate) fn sort_key_label(key: SortKey) -> &'static str {
    match key {
        SortKey::Title => "Title",
        SortKey::Author => "Author",
        SortKey::Series => "Series",
        SortKey::LastUpdated => "Last Updated",
        SortKey::NewestAdded => "Newest Added",
        SortKey::RecentlyInteracted => "Recently Interacted",
    }
}

/// Parse a wire token back into a sort key; `None` for anything unknown.
pub(crate) fn sort_key_from_value(value: &str) -> Option<SortKey> {
    SortKey::from_wire(value)
}

/// Stable Playwright row id derived from the ebook's on-disk filename:
/// strip directories and extension, then [`slugify`]. The Playwright fixture
/// table mirrors this derivation so each `FIXTURE_BOOKS[i].slug` matches the
/// row's testid.
pub(crate) fn row_slug(filename: &str) -> String {
    let basename = filename.rsplit('/').next().unwrap_or(filename);
    let stem = basename
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(basename);
    slugify(stem)
}

/// Lowercase `s`, collapse every run of non-alphanumeric ASCII into one `-`,
/// and trim dashes at either end — the testid slug shape.
pub(crate) fn slugify(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut last_was_dash = true;
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_was_dash = false;
        } else if !last_was_dash {
            out.push('-');
            last_was_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// Stable per-book testid slug for a row/tile.
///
/// A fileless book (physical-only, or a ghost) has no `book_files` row, and
/// `row_to_ebook` leaves its `filename` empty — slugging that alone would
/// collapse every such book onto one testid and make Playwright selectors
/// ambiguous. Fall back to the uuid, which is always present.
///
/// **Not a diff key.** `filename` is the file's *basename*, so two books slug
/// alike whenever their files are named alike, however far apart the folders
/// holding them sit. Keyed lists take [`row_diff_key`].
pub(crate) fn row_ident(book: &EbookMetadata) -> String {
    if book.filename.is_empty() {
        return row_slug(book.unique_identifier.as_deref().unwrap_or_default());
    }
    row_slug(&book.filename)
}

/// Stable per-book key for a keyed list — `books.id`, unique library-wide.
///
/// Deliberately not [`row_ident`]: that slug is cut from the file's basename,
/// so `vol.epub` under two folders — or `A Book!.epub` beside `A Book.epub` —
/// collapses two books onto one string. An ambiguous testid is a nuisance;
/// duplicate keyed siblings corrupt Dioxus's keyed diff and take the whole
/// page's event handling down with it (#2633, rule 07).
pub(crate) fn row_diff_key(book: &EbookMetadata) -> String {
    book.id.to_string()
}

#[cfg(test)]
mod tests;
