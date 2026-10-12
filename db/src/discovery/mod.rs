//! Discovery-detail reads: a single author or series with their books,
//! plus the global tag and genre clouds. Membership and ordering follow
//! the merged (override-aware) view via the BOOK_COLUMNS template shared
//! with the book read path. The library is shared, so every reader gets the
//! same rows.

// Submodules are private — `db/src/lib.rs` does `pub use discovery::*`,
// so any `pub mod` here would expose `omnibus_db::authors`, etc. to
// downstream crates, which is a new public path that didn't exist
// before the split. Matches the leaf-submodule-private precedent in
// `db/src/books.rs`; only the named items are re-exported below.
mod authors;
mod genres;
mod series;
mod tags;

#[cfg(test)]
mod tests;

pub use authors::{get_author, get_author_for_paths, MAX_DISCOVERY_BOOKS};
pub use genres::get_genre_cloud;
pub use series::get_series;
pub use tags::get_tag_cloud;

/// The "in the library" predicate the detail reads share with the browse
/// indexes (`browse::visible`): under a real scan root (ghosted or not) or
/// holding a checked-in physical copy. A wishlist-only book under the
/// `physical://local` pseudo-root is excluded. `book` / `root` name the `books`
/// / `scan_roots` aliases in the enclosing query.
fn library_member(book: &str, root: &str) -> String {
    // `IS NOT` keeps a book with no root row at all (none exist, but a `LEFT JOIN`
    // must answer for it) on the library side.
    format!(
        "({root}.path IS NOT '{}' \
          OR EXISTS (SELECT 1 FROM physical_copies pc WHERE pc.book_uuid = {book}.uuid))",
        crate::physical::PHYSICAL_LIBRARY_PATH
    )
}

/// Errors returned by the discovery-detail reads.
#[derive(Debug, thiserror::Error)]
pub enum DiscoveryError {
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// A non-database failure surfaced from a dependency of these reads.
    /// Coarse and message-carrying: no caller branches on the source, and
    /// folding it into `Db` would make that variant mean "a database error
    /// occurred" only most of the time.
    #[error("{0}")]
    Other(String),
}

impl From<crate::metadata_overrides::MetadataOverridesError> for DiscoveryError {
    fn from(e: crate::metadata_overrides::MetadataOverridesError) -> Self {
        match e {
            crate::metadata_overrides::MetadataOverridesError::Db(inner) => {
                DiscoveryError::Db(inner)
            }
            crate::metadata_overrides::MetadataOverridesError::Serialization(inner) => {
                DiscoveryError::Db(sqlx::Error::Decode(Box::new(inner)))
            }
            crate::metadata_overrides::MetadataOverridesError::Io(inner) => {
                DiscoveryError::Db(sqlx::Error::Io(inner))
            }
            // Bulk-write-only variants that can't arise on the discovery read
            // path; folded with their message preserved rather than panicking
            // (mirrors `BooksError`'s `From<MetadataOverridesError>`).
            other @ (crate::metadata_overrides::MetadataOverridesError::BookNotFound(_)
            | crate::metadata_overrides::MetadataOverridesError::TooManyValues {
                ..
            }) => DiscoveryError::Other(other.to_string()),
        }
    }
}
