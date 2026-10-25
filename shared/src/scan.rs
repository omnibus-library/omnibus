//! Wire types for the Physical Check-In scan flow: the resolution outcome a
//! scanned/typed ISBN maps to, and the write-request bodies for each branch of
//! the decision tree (check in, add a physical-only book, wishlist).

use serde::{Deserialize, Serialize};

use crate::metadata_lookup::ExternalBookMeta;
use crate::physical::WishlistSource;

/// A library book that an ISBN lookup matched, with enough detail to show it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ScanBook {
    pub uuid: String,
    pub title: String,
    pub authors: Vec<String>,
    pub cover_url: Option<String>,
    /// Whether someone has checked in at least one physical copy of the book.
    pub has_physical: bool,
    // Defaulted so a payload from before the field decodes; nothing before it
    // emitted the flag.
    /// Whether the book has a digital file. False for a book that exists only as a
    /// physical copy or a wishlist entry.
    #[serde(default)]
    pub has_files: bool,
    /// The book's own ISBN, without separators. In a `close_match` it can differ from
    /// the scanned ISBN. Absent when the book has none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isbn: Option<String>,
    /// Who filed each of the book's physical copies, oldest copy first. Empty when the
    /// book has no copy.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub copy_filers: Vec<CopyFiler>,
}

/// Who filed one of a book's physical copies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct CopyFiler {
    /// The reader's id. Null once their account is deleted.
    pub user_id: Option<i64>,
    /// The reader's display name, or username without one. Null once their account is
    /// deleted.
    pub name: Option<String>,
}

/// What an ISBN, or a picked title-search result, matched, and so what a client can
/// offer next. `kind` says which case it is. A `close_match` is never acted on by
/// itself. The reader confirms it before anything is written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub enum ScanOutcome {
    /// The ISBN matches a library book that already has a physical copy.
    AlreadyOwned { book: ScanBook },
    /// The ISBN matches a book on the caller's physical wishlist that has no physical
    /// copy yet. Checking the copy in clears the wishlist entry.
    OnWishlist { book: ScanBook },
    /// The ISBN matches a book the library has digitally, with no physical copy yet.
    InLibraryUnowned { book: ScanBook },
    // Carried as head + tail so the single-candidate wire shape stays
    // byte-identical for older clients.
    /// The providers know the ISBN, and at least one library book has the same title
    /// and author. The reader confirms which one, if any, before anything is written.
    /// Show `book` first, then `others`, as one list to pick from.
    CloseMatch {
        book: ScanBook,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        others: Vec<ScanBook>,
        scanned: ExternalBookMeta,
    },
    /// The providers know the ISBN, but the library has no such book.
    NotInLibrary { online: ExternalBookMeta },
    /// Neither the library nor any provider knows the ISBN.
    Unresolved,
}

/// An ISBN to look up, scanned or typed. It may be an ISBN-10 or ISBN-13, with or
/// without hyphens, up to 32 characters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ResolveRequest {
    pub isbn: String,
}

impl ResolveRequest {
    /// Reject an empty/oversized `isbn`, mirroring the same cap applied to
    /// [`CheckInRequest::isbn`]. Handlers translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        if self.isbn.trim().is_empty() {
            return Err("isbn is required".into());
        }
        if self.isbn.chars().count() > ISBN_MAX_LEN {
            return Err(format!("isbn exceeds {ISBN_MAX_LEN} characters"));
        }
        Ok(())
    }
}

/// Maximum length (in chars) for a free-text physical check-in `note` field.
/// Mirrors `omnibus_shared::highlight::UpdateHighlightNote::NOTE_MAX_LEN`.
pub const NOTE_MAX_LEN: usize = 4096;

/// Maximum length (in chars) for a title-search `query` — generous for any
/// real book title while still bounding the provider request.
pub const SEARCH_QUERY_MAX_LEN: usize = 200;

/// Free text to search the metadata providers for, up to 200 characters. It is the
/// fallback when an ISBN lookup comes back `unresolved`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ScanSearchRequest {
    pub query: String,
}

impl ScanSearchRequest {
    /// Reject a blank or oversized `query`. Handlers translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        if self.query.trim().is_empty() {
            return Err("query is required".into());
        }
        if self.query.chars().count() > SEARCH_QUERY_MAX_LEN {
            return Err(format!("query exceeds {SEARCH_QUERY_MAX_LEN} characters"));
        }
        Ok(())
    }
}

/// The provider results for a title search. Pass the one the reader picks to
/// `POST /api/scan/resolve-meta`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ScanSearchResponse {
    pub results: Vec<ExternalBookMeta>,
}

// No provider round trip: one could miss on an ISBN the search itself just surfaced.
/// A title-search result to match against the library. The server matches it as it
/// would an ISBN, without asking the providers again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ResolveMetaRequest {
    pub meta: ExternalBookMeta,
}

impl ResolveMetaRequest {
    /// Delegates field-length checks to [`ExternalBookMeta::validate`].
    /// Handlers translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        self.meta.validate()
    }
}

/// Maximum length (in chars) for a scanned/typed `isbn` string on
/// [`CheckInRequest`], measured before separators are stripped — generous
/// headroom over the 13-digit canonical form.
pub const ISBN_MAX_LEN: usize = 32;

/// Validate an optional free-text note against [`NOTE_MAX_LEN`]. Shared by
/// every request type in this module that carries a `note` field.
fn validate_note(note: &Option<String>) -> Result<(), String> {
    if let Some(v) = note {
        if v.chars().count() > NOTE_MAX_LEN {
            return Err(format!("note exceeds {NOTE_MAX_LEN} characters"));
        }
    }
    Ok(())
}

/// A physical copy to check in, of a book the library already has. `isbn` may be up to
/// 32 characters and `note` up to 4096.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CheckInRequest {
    pub book_uuid: String,
    #[serde(default)]
    pub isbn: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

impl CheckInRequest {
    /// Reject an empty/oversized `book_uuid`, an oversized `isbn`, or an
    /// oversized `note`. Handlers translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        if self.book_uuid.trim().is_empty() {
            return Err("book_uuid is required".into());
        }
        if self.book_uuid.len() > crate::BOOK_UUID_MAX_LEN {
            return Err(format!(
                "book uuid must be ≤ {} bytes",
                crate::BOOK_UUID_MAX_LEN
            ));
        }
        if let Some(ref isbn) = self.isbn {
            if isbn.chars().count() > ISBN_MAX_LEN {
                return Err(format!("isbn exceeds {ISBN_MAX_LEN} characters"));
            }
        }
        validate_note(&self.note)
    }
}

/// A book the library doesn't have, to add as a physical copy only. The server creates a
/// book with no files and checks in its first copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AddPhysicalOnlyRequest {
    pub meta: ExternalBookMeta,
    #[serde(default)]
    pub note: Option<String>,
}

impl AddPhysicalOnlyRequest {
    /// Delegates field-length checks to [`ExternalBookMeta::validate`], plus
    /// the request's own `note` cap. Handlers translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        self.meta.validate()?;
        validate_note(&self.note)
    }
}

/// A book to add to the caller's physical wishlist. Set `book_uuid` for a library book,
/// or `meta` to create a new book with no files. When both are set, the server uses
/// `book_uuid` and ignores `meta`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WishlistAddRequest {
    #[serde(default)]
    pub book_uuid: Option<String>,
    #[serde(default)]
    pub meta: Option<ExternalBookMeta>,
    pub source: WishlistSource,
}

impl WishlistAddRequest {
    /// Reject an oversized `book_uuid` or a `meta` that fails its own validation.
    /// `meta` is only validated when `book_uuid` is absent ("book_uuid wins, meta is
    /// ignored" on the struct), so a valid `book_uuid` with a junk `meta` isn't
    /// rejected. Whether at least one is set is enforced downstream
    /// (`ScanError::MissingWishlistTarget`). Handlers translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(ref uuid) = self.book_uuid {
            if uuid.trim().is_empty() {
                return Err("book_uuid is required".into());
            }
            if uuid.len() > crate::BOOK_UUID_MAX_LEN {
                return Err(format!(
                    "book uuid must be ≤ {} bytes",
                    crate::BOOK_UUID_MAX_LEN
                ));
            }
        } else if let Some(ref meta) = self.meta {
            meta.validate()?;
        }
        Ok(())
    }
}

/// The uuid of the book a check-in, physical-only add or wishlist add wrote to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookRef {
    pub book_uuid: String,
}

#[cfg(test)]
mod tests;
