//! The events a connection can be sent, each with the payload queued for it and the words
//! it is told in. The payload is captured when the event happens, so a message says what
//! was true then; only the link is built at send time, from the public URL in effect. Every
//! provider renders the same [`Notice`], so the wording lives here once.

use omnibus_shared::{NotificationEvent, RequestKind};
use serde::{Deserialize, Serialize};

use super::render::Notice;

/// Something that happened that a connection may be told about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    RequestNeedsChooser(RequestNeedsChooser),
}

/// A request reached "Choose a version" for a reader who may not pick one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestNeedsChooser {
    pub request_id: i64,
    pub book_uuid: String,
    pub title: String,
    /// The book's first author, when it has one.
    pub author: Option<String>,
    pub kind: RequestKind,
    /// The requester's display name, or their username.
    pub requester: String,
    /// How many versions are on offer.
    pub versions: i64,
}

impl Event {
    /// The event's wire name, the `event` column.
    pub fn name(&self) -> NotificationEvent {
        match self {
            Self::RequestNeedsChooser(_) => NotificationEvent::RequestNeedsChooser,
        }
    }

    /// A made-up event, for trying a provider's rendering without a real request.
    pub fn sample() -> Self {
        Self::RequestNeedsChooser(RequestNeedsChooser {
            request_id: 1,
            book_uuid: "00000000-0000-4000-8000-000000000000".to_string(),
            title: "Dune".to_string(),
            author: Some("Frank Herbert".to_string()),
            kind: RequestKind::Ebook,
            requester: "Ada".to_string(),
            versions: 4,
        })
    }

    /// The words and link this event is told in. Without `details` the message names
    /// neither the book nor who asked; the link, which needs a sign-in, stays.
    pub fn notice(&self, details: bool, public_url: Option<&str>) -> Notice {
        match self {
            Self::RequestNeedsChooser(e) => Notice {
                title: "A request needs a version picked".to_string(),
                message: if details {
                    chooser_message(e)
                } else {
                    "A book request is waiting for someone to pick a version.".to_string()
                },
                click: public_url.map(|url| {
                    format!("{url}/requests?book={}", urlencoding::encode(&e.book_uuid))
                }),
            },
        }
    }

    /// The payload as queued, the `payload` column.
    pub(super) fn payload(&self) -> Result<String, serde_json::Error> {
        match self {
            Self::RequestNeedsChooser(e) => serde_json::to_string(e),
        }
    }

    /// The event a queued row holds; `None` for a name this build doesn't know or a payload
    /// that doesn't read as that event's.
    pub(super) fn from_stored(name: &str, payload: &str) -> Option<Self> {
        match NotificationEvent::from_db(name)? {
            NotificationEvent::RequestNeedsChooser => serde_json::from_str(payload)
                .ok()
                .map(Self::RequestNeedsChooser),
        }
    }
}

/// `Ada asked for the ebook of “Dune” by Frank Herbert. 4 versions to choose from.`
fn chooser_message(e: &RequestNeedsChooser) -> String {
    let by = e
        .author
        .as_deref()
        .map(|author| format!(" by {author}"))
        .unwrap_or_default();
    let versions = match e.versions {
        1 => "1 version".to_string(),
        n => format!("{n} versions"),
    };
    format!(
        "{} asked for the {} of \u{201c}{}\u{201d}{by}. {versions} to choose from.",
        e.requester,
        e.kind.as_str(),
        e.title
    )
}
