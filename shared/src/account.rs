//! Wire types for the caller's own account: reading preferences, profile, avatar and
//! Send to Kindle.
//!
//! These are the `/api/account/*`, `/api/users/{user_id}/avatar` and `/api/kindle/*`
//! bodies. The saved preference values come back as `UserSummary` fields on
//! `GET /api/auth/me`, so only the write bodies live here.

use serde::{Deserialize, Serialize};

/// The formats to hide from your library view.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SetHiddenFormats {
    /// Format names such as `cbz`, each 1 to 16 letters or digits, at most 32. Case and
    /// duplicates don't matter. An empty or missing list hides nothing.
    #[serde(default)]
    pub formats: Vec<String>,
}

/// Whether a book's detail page stops at each section as you scroll.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SetBookDetailScrollStops {
    /// `true` stops at each section; `false` scrolls the page in one piece.
    pub enabled: bool,
}

/// Whether your library grid shows each series as one tile.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SetStackSeries {
    /// `true` folds a series into one tile; `false` shows every book on its own.
    pub enabled: bool,
}

/// Whether other readers on this server can see your reading stats.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SetShareStats {
    /// `true` shares your stats with the household; `false` keeps them to yourself.
    pub enabled: bool,
}

/// Your display name.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SetProfile {
    /// The name other readers see, up to 64 characters with no control characters.
    /// Null, missing or blank clears it, and your username shows instead.
    #[serde(default)]
    pub display_name: Option<String>,
}

/// Which version of an avatar to fetch.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct AvatarQuery {
    /// `full` for the image as uploaded. Anything else, or leaving it out, gets a WebP
    /// thumbnail at most 160 pixels on its longest edge.
    #[serde(default)]
    pub size: Option<String>,
}

/// Describes the multipart form `POST /api/account/avatar` takes: one image part.
#[derive(Debug, Clone, Default)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AvatarUpload {
    /// A JPEG, PNG, GIF or WebP image of at most 10 MiB, sent with an `image/*` content type.
    /// SVG is refused.
    #[cfg_attr(feature = "openapi", schema(value_type = String, format = Binary))]
    pub avatar: Vec<u8>,
}

/// Your Send to Kindle address.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SetKindleEmail {
    /// The address books are emailed to, such as `name@kindle.com`. Null, missing or
    /// blank clears it.
    #[serde(default)]
    pub email: Option<String>,
}

/// The book to email to your Kindle address.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct KindleSendRequest {
    /// The book's uuid, at most 64 bytes.
    pub book_uuid: String,
    /// The `id` of one of the book's files, for a book with several. Leave it out to
    /// send the book's EPUB, or its PDF when it has no EPUB.
    #[serde(default)]
    pub file_id: Option<i64>,
}

/// A Send to Kindle that is queued to go out.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct KindleSendQueued {
    /// Pass this to `GET /api/kindle/send/status` to follow the send.
    pub task_id: u64,
}

/// Which Send to Kindle to check on.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct KindleSendStatusQuery {
    /// The `task_id` from `POST /api/kindle/send`.
    pub task_id: u64,
}
