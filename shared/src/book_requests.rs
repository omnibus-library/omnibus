//! Wire types for a reader's book requests: asking for one digital format of a book, the
//! versions the search found, and the pick. A version never carries its download link;
//! that stays on the server.

use serde::{Deserialize, Serialize};

/// Which format a request fetches.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum RequestKind {
    Ebook,
    Audiobook,
}

impl RequestKind {
    /// The stored token, matching the table's CHECK constraint.
    pub fn as_str(self) -> &'static str {
        match self {
            RequestKind::Ebook => "ebook",
            RequestKind::Audiobook => "audiobook",
        }
    }

    /// Parse a stored token; `None` for an unrecognized value.
    pub fn from_db(s: &str) -> Option<Self> {
        match s {
            "ebook" => Some(RequestKind::Ebook),
            "audiobook" => Some(RequestKind::Audiobook),
            _ => None,
        }
    }
}

/// Where a request stands.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum RequestState {
    /// Omnibus is searching for versions of the book.
    Looking,
    /// Versions were found and the reader picks one.
    Choose,
    /// The reader picked a version.
    Chosen,
    /// The search came up empty or failed; the reader can try again.
    Stuck,
}

impl RequestState {
    /// The stored token, matching the table's CHECK constraint.
    pub fn as_str(self) -> &'static str {
        match self {
            RequestState::Looking => "looking",
            RequestState::Choose => "choose",
            RequestState::Chosen => "chosen",
            RequestState::Stuck => "stuck",
        }
    }

    /// Parse a stored token; `None` for an unrecognized value.
    pub fn from_db(s: &str) -> Option<Self> {
        match s {
            "looking" => Some(RequestState::Looking),
            "choose" => Some(RequestState::Choose),
            "chosen" => Some(RequestState::Chosen),
            "stuck" => Some(RequestState::Stuck),
            _ => None,
        }
    }
}

/// Why a request is stuck. Both read "Couldn't find it" to the requester.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum StuckReason {
    /// The search ran and no version was worth showing.
    NotFound,
    /// The search could not run, such as Prowlarr being unset or unreachable.
    SearchFailed,
}

impl StuckReason {
    /// The stored token.
    pub fn as_str(self) -> &'static str {
        match self {
            StuckReason::NotFound => "not_found",
            StuckReason::SearchFailed => "search_failed",
        }
    }

    /// Parse a stored token; `None` for an unrecognized value.
    pub fn from_db(s: &str) -> Option<Self> {
        match s {
            "not_found" => Some(StuckReason::NotFound),
            "search_failed" => Some(StuckReason::SearchFailed),
            _ => None,
        }
    }
}

/// Starts a request for one format of a book.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct StartRequest {
    /// Only `ebook` can be requested yet.
    pub kind: RequestKind,
}

/// The version a reader picks. Only an id: the download link is never taken from the caller.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct ChooseVersion {
    /// A version's `id` from the request being answered.
    pub result_id: i64,
}

/// One version of the book the search found.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RequestVersion {
    pub id: i64,
    /// The name the version was published under.
    pub title: String,
    pub size_bytes: Option<i64>,
    /// `EPUB`, `PDF` or `CBZ`. Null when the name does not say.
    pub format: Option<String>,
    /// The source the version came from; shown behind Details.
    pub indexer: Option<String>,
    /// Whether this is the version Omnibus suggests. At most one version has it.
    pub best_match: bool,
}

/// A request and, once the search has run, the versions it found.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct BookRequest {
    pub id: i64,
    /// The requested book's uuid.
    pub book_uuid: String,
    /// The reader who made the request.
    pub user_id: i64,
    pub kind: RequestKind,
    pub state: RequestState,
    /// Set while `state` is `stuck`.
    pub stuck_reason: Option<StuckReason>,
    /// What the search ran into, in technical words. Only an admin is sent it.
    pub stuck_detail: Option<String>,
    /// The picked version's id once `state` is `chosen`.
    pub chosen_result_id: Option<i64>,
    /// ISO 8601 UTC.
    pub created_at: String,
    /// ISO 8601 UTC.
    pub updated_at: String,
    /// The versions found, best first. Empty until the search has run.
    pub versions: Vec<RequestVersion>,
}
