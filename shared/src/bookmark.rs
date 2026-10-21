//! Bookmark wire types shared between web and mobile clients. One model
//! serves both surfaces: `position` is an opaque location token (seconds for
//! the audiobook player, an EPUB CFI for the reader) and `title` is the
//! optional user name/note (the `bookmarks` table has no separate note column).

use serde::{Deserialize, Serialize};

use crate::highlight::CreateHighlight;

// `PartialEq` but not `Eq`: `percent_through_book` is a float.
/// A saved place in a book, in an ebook or an audiobook.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct Bookmark {
    pub id: i64,
    pub book_uuid: String,
    /// Where the bookmark is: an EPUB CFI in an ebook, or a number of seconds as a decimal
    /// string in an audiobook. The server stores it as the client sent it.
    pub position: String,
    /// The bookmark's name or note. Null when it has none.
    pub title: Option<String>,
    /// The id the creating device gave the bookmark. Null when the device sent none, and
    /// for bookmarks made by old versions of Omnibus.
    #[serde(default)]
    pub client_id: Option<String>,
    /// When the bookmark was made, in Unix seconds.
    pub created_at: i64,
    // Null only on a value a client built itself.
    /// The same moment as `created_at`, as an ISO 8601 string in UTC.
    #[serde(default)]
    pub created_at_iso: Option<String>,
    /// The 0-based index of the spine document the bookmark is in, as
    /// `GET /api/ebooks/{uuid}/chapters` numbers them. Null for an audiobook bookmark, one
    /// made on a Kobo, and any position the server can't read.
    #[serde(default)]
    pub spine_index: Option<i64>,
    /// The title of the chapter the bookmark is in, from the book's table of contents.
    /// Null when the server doesn't know the book's chapters.
    #[serde(default)]
    pub chapter_title: Option<String>,
    /// How far through the book the bookmark is, from 0 to 100. It measures to the start of
    /// the spine document the bookmark is in, not to the bookmark itself.
    #[serde(default)]
    pub percent_through_book: Option<f64>,
}

/// A new bookmark, as `POST /api/bookmarks` takes it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CreateBookmark {
    pub book_uuid: String,
    /// Where the bookmark is: an EPUB CFI in an ebook, or a number of seconds as a decimal
    /// string in an audiobook. Up to 4,096 characters.
    pub position: String,
    /// The bookmark's name or note, up to 512 characters.
    pub title: Option<String>,
    /// An id the device makes up for the bookmark, such as a UUID, up to 64 characters. The
    /// `/api/bookmarks/{id}` routes accept it in place of `id`, so an offline client can
    /// use the bookmark before the server has numbered it. Sending the same `client_id`
    /// again returns the bookmark already stored instead of making a second one.
    #[serde(default)]
    pub client_id: Option<String>,
}

impl CreateBookmark {
    /// Maximum length (in chars) of a position token. An audiobook position is
    /// a short decimal and a CFI rarely exceeds a few hundred bytes; 4 KiB is a
    /// generous ceiling that stops an authed client persisting huge blobs.
    pub const POSITION_MAX_LEN: usize = 4096;
    /// Maximum length (in chars) of the user-entered title/note.
    pub const TITLE_MAX_LEN: usize = 512;

    /// Mirror of [`CreateHighlight::CLIENT_ID_MAX_LEN`] — both hold the same
    /// kind of device-minted handle, so the two ceilings can't drift apart.
    pub const CLIENT_ID_MAX_LEN: usize = CreateHighlight::CLIENT_ID_MAX_LEN;

    /// Validate field lengths and required-ness. Call at the handler boundary
    /// before persisting so over-long inputs surface as 400 instead of falling
    /// through to the DB. Lengths are measured in Unicode scalar values.
    pub fn validate(&self) -> Result<(), String> {
        if self.book_uuid.trim().is_empty() {
            return Err("book_uuid is required".into());
        }
        if self.position.trim().is_empty() {
            return Err("position is required".into());
        }
        if self.position.chars().count() > Self::POSITION_MAX_LEN {
            return Err(format!(
                "position exceeds {} characters",
                Self::POSITION_MAX_LEN
            ));
        }
        if let Some(ref title) = self.title {
            if title.chars().count() > Self::TITLE_MAX_LEN {
                return Err(format!("title exceeds {} characters", Self::TITLE_MAX_LEN));
            }
        }
        if let Some(ref client_id) = self.client_id {
            if client_id.trim().is_empty() {
                return Err("client_id must not be blank".into());
            }
            if client_id.chars().count() > Self::CLIENT_ID_MAX_LEN {
                return Err(format!(
                    "client_id exceeds {} characters",
                    Self::CLIENT_ID_MAX_LEN
                ));
            }
        }
        Ok(())
    }
}

/// The new name or note `PUT /api/bookmarks/{id}` gives a bookmark.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct UpdateBookmark {
    /// The bookmark's name or note, up to 512 characters. Null or absent clears it.
    pub title: Option<String>,
}

impl UpdateBookmark {
    /// Mirror of [`CreateBookmark::TITLE_MAX_LEN`] so both boundaries agree.
    pub const TITLE_MAX_LEN: usize = CreateBookmark::TITLE_MAX_LEN;

    /// Validate the title length. `None` clears the title and is always
    /// permitted. Returns `Err` with a human-readable message when over cap.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(ref title) = self.title {
            if title.chars().count() > Self::TITLE_MAX_LEN {
                return Err(format!("title exceeds {} characters", Self::TITLE_MAX_LEN));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;

impl Bookmark {
    /// Fill [`Self::created_at_iso`] from the epoch already on the row.
    #[must_use]
    pub fn with_iso(mut self) -> Self {
        self.created_at_iso = Some(crate::to_iso8601(self.created_at));
        self
    }
}
