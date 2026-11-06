//! Wire types for a reader's book requests: asking for one digital format of a book, the
//! versions the search found, and the pick. A version never carries its download link;
//! that stays on the server.

use serde::{Deserialize, Serialize};

use crate::metadata_lookup::ExternalBookMeta;

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
    /// The chosen version is downloading, then being added to the library.
    OnItsWay,
    /// The download is in the library, filed under the requested book.
    Ready,
    /// The search came up empty or failed, or the download stopped; the reader can try again.
    Stuck,
    /// The reader cancelled it.
    Cancelled,
}

impl RequestState {
    /// The stored token, matching the table's CHECK constraint.
    pub fn as_str(self) -> &'static str {
        match self {
            RequestState::Looking => "looking",
            RequestState::Choose => "choose",
            RequestState::Chosen => "chosen",
            RequestState::OnItsWay => "on_its_way",
            RequestState::Ready => "ready",
            RequestState::Stuck => "stuck",
            RequestState::Cancelled => "cancelled",
        }
    }

    /// Parse a stored token; `None` for an unrecognized value.
    pub fn from_db(s: &str) -> Option<Self> {
        match s {
            "looking" => Some(RequestState::Looking),
            "choose" => Some(RequestState::Choose),
            "chosen" => Some(RequestState::Chosen),
            "on_its_way" => Some(RequestState::OnItsWay),
            "ready" => Some(RequestState::Ready),
            "stuck" => Some(RequestState::Stuck),
            "cancelled" => Some(RequestState::Cancelled),
            _ => None,
        }
    }
}

/// Why a request is stuck. The two search reasons read "Couldn't find it" to the requester;
/// `stopped_moving` reads "Stopped moving" and `couldnt_add` reads "Couldn't add it".
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum StuckReason {
    /// The search ran and no version was worth showing.
    NotFound,
    /// The search could not run, such as Prowlarr being unset or unreachable.
    SearchFailed,
    /// The download stalled, failed, vanished from the client or the client went unreachable.
    StoppedMoving,
    /// The download finished but could not be added to the library; Try again re-runs only the add.
    CouldntAdd,
}

impl StuckReason {
    /// The stored token.
    pub fn as_str(self) -> &'static str {
        match self {
            StuckReason::NotFound => "not_found",
            StuckReason::SearchFailed => "search_failed",
            StuckReason::StoppedMoving => "stopped_moving",
            StuckReason::CouldntAdd => "couldnt_add",
        }
    }

    /// Parse a stored token; `None` for an unrecognized value.
    pub fn from_db(s: &str) -> Option<Self> {
        match s {
            "not_found" => Some(StuckReason::NotFound),
            "search_failed" => Some(StuckReason::SearchFailed),
            "stopped_moving" => Some(StuckReason::StoppedMoving),
            "couldnt_add" => Some(StuckReason::CouldntAdd),
            _ => None,
        }
    }
}

/// How a version is fetched, as Prowlarr names it.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ReleaseProtocol {
    Torrent,
    Usenet,
}

impl ReleaseProtocol {
    /// The stored token, matching the table's CHECK constraint.
    pub fn as_str(self) -> &'static str {
        match self {
            ReleaseProtocol::Torrent => "torrent",
            ReleaseProtocol::Usenet => "usenet",
        }
    }

    /// Parse a stored or Prowlarr token; `None` for any other, such as Prowlarr's `unknown`.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "torrent" => Some(ReleaseProtocol::Torrent),
            "usenet" => Some(ReleaseProtocol::Usenet),
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

/// Starts a request for one format of a book the library doesn't have yet, made from a
/// provider's record of it. The book is created without files; no wishlist entry is made.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct StartRequestFromMeta {
    /// Only `ebook` can be requested yet.
    pub kind: RequestKind,
    /// The provider's record, as a metadata search returned it.
    pub meta: ExternalBookMeta,
}

impl StartRequestFromMeta {
    /// Why the request can't start, as a message for a 400: not an ebook, or a field of
    /// `meta` over its cap.
    pub fn validate(&self) -> Result<(), String> {
        if self.kind != RequestKind::Ebook {
            return Err("only ebooks can be requested yet".into());
        }
        self.meta.validate()
    }
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
    /// The source the version came from.
    pub indexer: Option<String>,
    /// How many peers share it. Null for sources that have none, such as Usenet.
    pub seeders: Option<i64>,
    /// How it is fetched. Null when the source did not say.
    pub protocol: Option<ReleaseProtocol>,
    /// Whether this is the version Omnibus suggests. At most one version has it.
    pub best_match: bool,
    /// Whether this version was picked and given up. It is shown as one that did not work
    /// and cannot be chosen again.
    pub rejected: bool,
}

/// A request and, once the search has run, the versions it found.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    /// When the request started, in Unix seconds.
    pub created_at: i64,
    /// When the request last changed state, in Unix seconds.
    pub updated_at: i64,
    /// How much of the download is done, 0 to 1, once `state` is `on_its_way`.
    pub progress: Option<f64>,
    /// While `on_its_way`, when the download client expects the download to finish, in Unix
    /// seconds. Null when it can't tell.
    pub expected_done_at: Option<i64>,
    /// While `cancelled`, when the download is told to stop, in Unix seconds; the request can
    /// be undone until then. Null once it has stopped, and for a request never cancelled.
    pub cancel_at: Option<i64>,
    /// The user who cancelled it, once `state` is `cancelled`.
    pub cancelled_by: Option<i64>,
    /// What Omnibus knows about why it moved on, such as "Swapped for another version".
    pub note: Option<String>,
    /// The versions found, best first. Empty until the search has run. In a list of
    /// requests, only the version picked and then those given up: read one request for the rest.
    pub versions: Vec<RequestVersion>,
}

/// A request as a list shows it: its book, who made it and who cancelled it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RequestListing {
    pub request: BookRequest,
    /// The requested book, without its description.
    pub book: crate::EbookMetadata,
    /// The requester's display name, or their username when they have none.
    pub requester_name: String,
    /// Whether `GET /api/users/{id}/avatar` has the requester's photo to serve.
    pub requester_has_avatar: bool,
    /// Who cancelled it, named the same way. Null unless it was cancelled, or once that
    /// account is deleted.
    pub cancelled_by_name: Option<String>,
}

/// Which requests `GET /api/requests` returns. Leave a field out to match every request.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct RequestListQuery {
    /// Only requests in this state.
    pub state: Option<RequestState>,
    /// Only requests this reader made, by user id.
    pub user: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata_lookup::MetadataProvider;

    #[test]
    fn request_state_and_stuck_reason_round_trip_their_tokens() {
        assert_eq!(RequestState::from_db("ready"), Some(RequestState::Ready));
        assert_eq!(RequestState::Ready.as_str(), "ready");
        assert_eq!(
            StuckReason::from_db("couldnt_add"),
            Some(StuckReason::CouldntAdd)
        );
        assert_eq!(StuckReason::CouldntAdd.as_str(), "couldnt_add");
    }

    fn start_from(kind: RequestKind, title: &str) -> StartRequestFromMeta {
        StartRequestFromMeta {
            kind,
            meta: ExternalBookMeta {
                isbn13: "9781635575637".into(),
                title: title.into(),
                authors: vec!["Susanna Clarke".into()],
                year: None,
                pages: None,
                publisher: None,
                description: None,
                cover_url: None,
                series: None,
                first_publish_year: None,
                format: None,
                source: MetadataProvider::OpenLibrary,
            },
        }
    }

    #[test]
    fn start_request_from_meta_accepts_an_ebook_of_a_small_record() {
        assert_eq!(
            start_from(RequestKind::Ebook, "Piranesi").validate(),
            Ok(())
        );
    }

    #[test]
    fn start_request_from_meta_rejects_a_field_of_meta_over_its_cap() {
        let long = "x".repeat(ExternalBookMeta::TITLE_MAX_LEN + 1);
        assert_eq!(
            start_from(RequestKind::Ebook, &long).validate(),
            Err("title exceeds 500 characters".into())
        );
    }

    #[test]
    fn start_request_from_meta_rejects_an_audiobook() {
        assert!(start_from(RequestKind::Audiobook, "Piranesi")
            .validate()
            .is_err());
    }

    #[test]
    fn release_protocol_round_trips_its_tokens_and_knows_no_other() {
        assert_eq!(
            ReleaseProtocol::parse("usenet"),
            Some(ReleaseProtocol::Usenet)
        );
        assert_eq!(ReleaseProtocol::Torrent.as_str(), "torrent");
        assert_eq!(ReleaseProtocol::parse("unknown"), None);
    }
}
