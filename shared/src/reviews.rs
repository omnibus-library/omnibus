//! Book review wire types: one review per reader per book, holding half stars,
//! public Markdown text, private notes and a spoiler flag. Stars and text are
//! public to every signed-in reader; notes reach only their author, so another
//! reader's review is its own type with no notes field to leak through.
//!
//! Writes are field-level patches ([`ReviewPatch`]): an offline client that
//! edits the text can't overwrite stars set from another device meanwhile.

use serde::{Deserialize, Deserializer, Serialize};

use crate::ratings::validate_stars;

/// Maximum byte length of a review's text, and separately of its notes.
pub const REVIEW_TEXT_MAX_LEN: usize = 64 * 1024;

/// How many ratings a book needs before its household summary is shown.
pub const SUMMARY_MIN_RATINGS: i64 = 2;

/// Your review of a book, private notes included.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct Review {
    pub book_uuid: String,
    /// Your star rating, from 0.5 to 5 in half-star steps. Null when you gave none.
    pub stars: Option<f32>,
    /// Your public review text, as Markdown. Null when you wrote none.
    pub body_md: Option<String>,
    /// `body_md` rendered to HTML, with unsafe markup removed.
    pub body_html: Option<String>,
    /// Your private notes, as Markdown. Only you ever see them. Null when you wrote none.
    pub notes_md: Option<String>,
    /// `notes_md` rendered to HTML, with unsafe markup removed.
    pub notes_html: Option<String>,
    /// Whether you marked the review as containing spoilers.
    pub spoiler: bool,
    /// When you last changed the stars, in Unix seconds. Null when there are none.
    pub rated_at: Option<i64>,
    /// When the review first had stars or text, in Unix seconds. Adding text to a review that
    /// had none restarts it, so a text review dates from its text. For a review holding only
    /// notes, when you wrote them.
    pub created_at: i64,
    /// When you last changed the stars, text or spoiler flag, in Unix seconds. Editing
    /// your notes doesn't move it, because other readers see it too.
    pub updated_at: i64,
    // Absent only on a value a client built itself.
    /// The same moment as `rated_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rated_at_iso: Option<String>,
    // Absent only on a value a client built itself.
    /// The same moment as `created_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at_iso: Option<String>,
    // Absent only on a value a client built itself.
    /// The same moment as `updated_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at_iso: Option<String>,
}

impl Review {
    /// Fill the ISO siblings from the epochs already on the review.
    #[must_use]
    pub fn with_iso(mut self) -> Self {
        self.rated_at_iso = crate::to_iso8601_opt(self.rated_at);
        self.created_at_iso = Some(crate::to_iso8601(self.created_at));
        self.updated_at_iso = Some(crate::to_iso8601(self.updated_at));
        self
    }
}

/// Another reader's review of a book, with who wrote it. Never carries their private notes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct AttributedReview {
    pub user_id: i64,
    /// The reviewer's display name, or their username when they have none.
    pub username: String,
    /// Whether the reviewer has an avatar. `GET /api/users/{user_id}/avatar` serves it.
    #[serde(default)]
    pub has_avatar: bool,
    /// The star rating, from 0.5 to 5 in half-star steps. Null when they gave none.
    pub stars: Option<f32>,
    /// The public review text, as Markdown. Null for a rating with no text.
    pub body_md: Option<String>,
    /// `body_md` rendered to HTML, with unsafe markup removed.
    pub body_html: Option<String>,
    /// Whether the reviewer marked the review as containing spoilers. The stars are never
    /// a spoiler; hide only the text.
    pub spoiler: bool,
    /// When they last changed the stars, in Unix seconds. Null when there are none.
    pub rated_at: Option<i64>,
    /// When the review first had stars or text, in Unix seconds. Adding text to a review that
    /// had none restarts it, so a text review dates from its text.
    pub created_at: i64,
    /// When they last changed the stars, text or spoiler flag, in Unix seconds.
    pub updated_at: i64,
    // Absent only on a value a client built itself.
    /// The same moment as `rated_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rated_at_iso: Option<String>,
    // Absent only on a value a client built itself.
    /// The same moment as `created_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at_iso: Option<String>,
    // Absent only on a value a client built itself.
    /// The same moment as `updated_at`, as an ISO 8601 string in UTC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at_iso: Option<String>,
}

impl AttributedReview {
    /// Fill the ISO siblings from the epochs already on the review.
    #[must_use]
    pub fn with_iso(mut self) -> Self {
        self.rated_at_iso = crate::to_iso8601_opt(self.rated_at);
        self.created_at_iso = Some(crate::to_iso8601(self.created_at));
        self.updated_at_iso = Some(crate::to_iso8601(self.updated_at));
        self
    }
}

/// How many readers gave a book one star value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ReviewBucket {
    /// The rating in half stars, from 1 to 10. Divide by 2 for stars, so 10 is 5 stars.
    pub half_stars: i64,
    pub readers: i64,
}

/// Every reader's rating of a book, yours included, summed up.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct ReviewSummary {
    /// The mean rating, in stars.
    pub average_stars: f32,
    /// How many readers rated the book.
    pub ratings: i64,
    /// All ten half-star values, lowest first, zeros included.
    pub buckets: Vec<ReviewBucket>,
}

/// Everything readers have said about one book.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schemars", derive(schemars::JsonSchema))]
pub struct BookReviews {
    /// Your own review. Null when you haven't reviewed the book.
    pub mine: Option<Review>,
    /// Other readers' reviews: those with text first, newest first by when the text was
    /// first written, then ratings with no text, most recently rated first. A review
    /// holding only private notes isn't listed.
    pub others: Vec<AttributedReview>,
    /// The book's ratings summed up. Null until at least two readers have rated it.
    pub summary: Option<ReviewSummary>,
}

/// The changes `PATCH /api/reviews/{uuid}` makes to your review of a book. A field left
/// out stays as it is; `stars`, `body_md` or `notes_md` sent as null is cleared. Blank
/// text counts as null. A review left with no stars, text or notes is deleted.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ReviewPatch {
    /// The star rating, from 0.5 to 5 in half-star steps. Null clears the stars and keeps
    /// any text and notes.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "openapi", schema(value_type = Option<f32>))]
    pub stars: Option<Option<f32>>,
    /// The public review text, as Markdown, up to 65,536 bytes.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "openapi", schema(value_type = Option<String>))]
    pub body_md: Option<Option<String>>,
    /// Private notes only you see, as Markdown, up to 65,536 bytes.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "openapi", schema(value_type = Option<String>))]
    pub notes_md: Option<Option<String>>,
    /// Whether the review contains spoilers: true or false. Leave it out to keep it; a null
    /// counts as leaving it out and doesn't clear the flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "openapi", schema(value_type = bool))]
    pub spoiler: Option<bool>,
}

impl ReviewPatch {
    /// Reject out-of-range stars or oversized text. Handlers translate `Err(_)` into 400.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(Some(stars)) = self.stars {
            validate_stars(stars)?;
        }
        for (field, text) in [("body_md", &self.body_md), ("notes_md", &self.notes_md)] {
            if text
                .as_ref()
                .and_then(Option::as_ref)
                .map_or(0, String::len)
                > REVIEW_TEXT_MAX_LEN
            {
                return Err(format!(
                    "{field} must be {REVIEW_TEXT_MAX_LEN} bytes or fewer"
                ));
            }
        }
        Ok(())
    }
}

/// A field that is present deserializes to `Some`, even when it is `null`, so a
/// patch can tell "clear this" (`Some(None)`) from "leave it" (`None`, via `default`).
fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests;
