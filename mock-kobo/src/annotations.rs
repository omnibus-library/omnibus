//! The annotation channel over Kobo Reading Services: after a library sync,
//! `POST checkforchanges` names the books whose annotation set moved, each is
//! then `GET`-ed and applied through [`crate::device::Device::receive_annotations`].
//! A failed exchange here is never a sync failure — only covers and downloads
//! behave the same way — so a stalled Reading Services host just leaves the
//! device's annotations as they were, retried on the next sync.

use serde::{Deserialize, Serialize};

use crate::client::Client;
use crate::device::Device;
use crate::firmware::ANNOTATIONS_IF_NONE_MATCH;
use crate::wire::ServedAnnotation;

/// One of Kobo's four highlight swatches ([`crate::firmware::Quirk::HighlightColor`]).
/// The discriminant is the swatch's `Bookmark.Color` index; only yellow = 0
/// is observed (#1629) — the rest follow the order Kobo's own highlight
/// picker is believed to use, unverified.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Swatch {
    Yellow = 0,
    Pink = 1,
    Blue = 2,
    Green = 3,
}

impl Swatch {
    /// The hex swatch Kobo firmware's own highlight menu renders for this colour.
    pub fn hex(self) -> &'static str {
        match self {
            Self::Yellow => "#F6F3B3",
            Self::Pink => "#E8AFCF",
            Self::Blue => "#B2E1E8",
            Self::Green => "#C6E09E",
        }
    }

    /// `raw`'s swatch, when it names one of the four hex values
    /// (ASCII case-insensitive). Anything else — a CSS colour name, an
    /// unrecognized hex value, or no value at all — lands on yellow
    /// ([`crate::firmware::Quirk::HighlightColor`]).
    pub fn from_wire(raw: Option<&str>) -> Self {
        let Some(raw) = raw else {
            return Self::Yellow;
        };
        [Self::Yellow, Self::Pink, Self::Blue, Self::Green]
            .into_iter()
            .find(|swatch| raw.eq_ignore_ascii_case(swatch.hex()))
            .unwrap_or(Self::Yellow)
    }
}

/// One highlight or note, as the device holds it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Annotation {
    pub id: String,
    pub text: String,
    pub note: Option<String>,
    pub color: Swatch,
    /// The device's own location object, round-tripped verbatim.
    pub location: serde_json::Value,
}

impl Annotation {
    fn from_served(served: ServedAnnotation) -> Self {
        Self {
            id: served.id,
            text: served.highlighted_text,
            note: served.note_text,
            color: Swatch::from_wire(served.highlight_color.as_deref()),
            location: served.location,
        }
    }
}

/// After a library sync: `POST checkforchanges`, then `GET .../annotations`
/// for each id it names, with [`ANNOTATIONS_IF_NONE_MATCH`]. A non-2xx
/// answer, an unreadable body, or no answer at all on either request is
/// never cached and never fails the sync — the next sync's checkforchanges
/// asks again. A device with no `reading_services_host` yet (no sync has
/// completed) makes no request.
pub async fn fetch_changed_annotations(client: &mut Client, device: &mut Device) {
    let Some(host) = device.reading_services_host.clone() else {
        return;
    };
    let Ok(response) = client.check_for_changes(&host).await else {
        return;
    };
    if !response.status().is_success() {
        return;
    }
    let Ok(ids) = client.decode::<Vec<String>>(response).await else {
        return;
    };
    for id in ids {
        fetch_one(client, device, &host, &id, Some(ANNOTATIONS_IF_NONE_MATCH)).await;
    }
}

/// Fetch and apply one book's annotation set. Shared by the checkforchanges
/// phase (conditional) and the post-download phase (unconditional, Task 3).
async fn fetch_one(
    client: &mut Client,
    device: &mut Device,
    host: &str,
    book: &str,
    if_none_match: Option<&str>,
) {
    let Ok(response) = client.annotations(host, book, if_none_match).await else {
        return;
    };
    if !response.status().is_success() {
        // A 304 (nothing changed) lands here too, same as a real rejection:
        // neither carries a body worth decoding.
        return;
    }
    let Ok(reply) = client.decode::<crate::wire::AnnotationsReply>(response).await else {
        return;
    };
    let served = reply
        .annotations
        .into_iter()
        .map(Annotation::from_served)
        .collect();
    device.receive_annotations(book, served);
}

#[cfg(test)]
mod tests;
