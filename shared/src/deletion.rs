//! Wire types for the admin book-deletion surface
//! (`/api/rpc/books/delete-files`). The dialog deletes *items* — every
//! `book_files` row plus every physical copy — and that distinction decides
//! whether the book row survives: a book whose last remaining item is a
//! physical copy keeps its record.

use serde::{Deserialize, Serialize};

use crate::ebook::BookFileInfo;
use crate::physical::PhysicalCopy;

/// What an admin can delete for one book: its files and physical copies, and the reader
/// data that deleting all of them would take with the book.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct BookDeletionManifest {
    pub files: Vec<BookFileInfo>,
    pub copies: Vec<PhysicalCopy>,
    pub impact: BookDeletionImpact,
}

impl BookDeletionManifest {
    /// Total deletable items — the count a full selection has to reach for the
    /// book record itself to go.
    pub fn item_count(&self) -> usize {
        self.files.len() + self.copies.len()
    }
}

/// The reader data that deleting a book removes, counted across every reader.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct BookDeletionImpact {
    pub highlights: i64,
    pub journal_entries: i64,
    pub bookmarks: i64,
    pub reading_sessions: i64,
    pub listening_sessions: i64,
    pub ratings: i64,
    /// How many hand-picked shelves hold the book.
    pub shelves: i64,
}

impl BookDeletionImpact {
    /// Human-readable phrases for each non-zero count, in the order the dialog
    /// lists them (`["3 highlights", "1 review"]`). Empty when the book
    /// carries no user data at all. `ratings` counts reviews: the wire name
    /// predates them.
    pub fn losses(&self) -> Vec<String> {
        [
            (self.highlights, "highlight", "highlights"),
            (self.journal_entries, "journal entry", "journal entries"),
            (self.bookmarks, "bookmark", "bookmarks"),
            (self.reading_sessions, "reading session", "reading sessions"),
            (
                self.listening_sessions,
                "listening session",
                "listening sessions",
            ),
            (self.ratings, "review", "reviews"),
            (self.shelves, "shelf placement", "shelf placements"),
        ]
        .iter()
        .filter(|(n, _, _)| *n > 0)
        .map(|(n, one, many)| format!("{n} {}", if *n == 1 { one } else { many }))
        .collect()
    }
}

/// The files and physical copies `POST /api/books/{uuid}/delete-files` deletes, by `id`.
/// Either list may be empty or left out. The book itself goes once no file or copy is
/// left, so two empty lists delete a book that has neither.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct DeleteBookFilesRequest {
    #[serde(default)]
    pub file_ids: Vec<i64>,
    #[serde(default)]
    pub copy_ids: Vec<i64>,
}

/// What the delete removed.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct DeleteBookFilesResult {
    pub deleted_file_ids: Vec<i64>,
    pub deleted_copy_ids: Vec<i64>,
    /// True when the book itself was deleted because nothing of it was left. Its uuid
    /// no longer resolves.
    pub book_deleted: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn losses_singularizes_and_skips_zero_counts() {
        let impact = BookDeletionImpact {
            highlights: 3,
            ratings: 1,
            ..Default::default()
        };

        assert_eq!(impact.losses(), vec!["3 highlights", "1 review"]);
    }

    #[test]
    fn losses_names_the_ratings_count_as_reviews() {
        let impact = BookDeletionImpact {
            ratings: 2,
            ..Default::default()
        };

        assert_eq!(impact.losses(), vec!["2 reviews"]);
    }

    #[test]
    fn losses_is_empty_for_a_book_with_no_user_data() {
        assert!(BookDeletionImpact::default().losses().is_empty());
    }

    #[test]
    fn item_count_spans_files_and_physical_copies() {
        let manifest = BookDeletionManifest {
            files: vec![BookFileInfo::default(), BookFileInfo::default()],
            copies: vec![PhysicalCopy {
                id: 1,
                book_uuid: "u".into(),
                isbn: None,
                added_by_user_id: None,
                added_by_name: None,
                checked_in_at: 0,
                checked_in_at_iso: None,
                note: None,
            }],
            ..Default::default()
        };

        assert_eq!(manifest.item_count(), 3);
    }
}
