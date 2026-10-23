//! The device's own reading progress, reconciled against the server's
//! independently for status and bookmark ([`crate::firmware::Quirk::StateArbitration`]):
//! each sub-object is adopted only when the server sends one stamped
//! strictly newer than the device's own. Time is injected as data — nothing
//! here reads the wall clock — so arbitration is testable with no sleeps.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::session::StateSent;
use crate::wire;

/// The wire tokens for where a book sits in its reading lifecycle; any other token fails the decode.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReadStatus {
    #[default]
    ReadyToRead,
    Reading,
    Finished,
}

/// A whole-book read percentage, 0..=100. Only [`Percent::new`] makes one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub struct Percent(u8);

impl Percent {
    /// `value` as a `Percent`, or `None` outside `0..=100`.
    pub fn new(value: u8) -> Option<Self> {
        (value <= 100).then_some(Self(value))
    }

    /// `⌊100·part/whole⌋`, capped to 100, and 0 when `whole` is 0 — the
    /// reader view's book-percent calculation, which never needs an
    /// `unwrap` to land in range.
    pub fn of(part: usize, whole: usize) -> Self {
        if whole == 0 {
            return Self(0);
        }
        let ratio = (part.saturating_mul(100) / whole).min(100);
        Self(u8::try_from(ratio).unwrap_or(100))
    }
}

impl TryFrom<u8> for Percent {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        Self::new(value).ok_or_else(|| format!("{value} is not a percent (0..=100)"))
    }
}

impl From<Percent> for u8 {
    fn from(value: Percent) -> Self {
        value.0
    }
}

/// A `KoboSpan` position anchor (`kobo.N.M`), round-tripped verbatim.
/// Wire shape: `{"Source", "Type": "KoboSpan", "Value"}`; `Type` is ignored on read.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct KoboSpan {
    pub source: String,
    pub value: String,
}

/// The device's bookmark in a book: where, and the event time arbitration compares it by.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bookmark {
    pub percent: Option<Percent>,
    pub location: Option<KoboSpan>,
    pub modified: i64,
}

/// What the device knows about one book's reading progress.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reading {
    pub status: ReadStatus,
    pub status_modified: Option<i64>,
    pub bookmark: Option<Bookmark>,
}

impl Reading {
    /// Reconcile `server`'s reading state onto this one. Status and
    /// bookmark are arbitrated independently: each is adopted only when the
    /// server's sub-object is stamped and strictly newer than the device's
    /// own. A stamped server value beats an unstamped device value; equal
    /// stamps keep the device's; an unparseable stamp counts as unstamped.
    pub fn apply(&mut self, server: &wire::ReadingState) {
        if let Some(at) = parse_stamp(server.status_info.last_modified.as_deref()) {
            if newer(at, self.status_modified) {
                self.status = server.status_info.status;
                self.status_modified = Some(at);
            }
        }
        if let Some(at) = parse_stamp(server.current_bookmark.last_modified.as_deref()) {
            let device_at = self.bookmark.as_ref().map(|b| b.modified);
            if newer(at, device_at) {
                self.bookmark = Some(Bookmark {
                    percent: server
                        .current_bookmark
                        .progress_percent
                        .and_then(|p| u8::try_from(p).ok())
                        .and_then(Percent::new),
                    location: server.current_bookmark.location.clone(),
                    modified: at,
                });
            }
        }
    }
}

/// Parse an RFC 3339 stamp into epoch seconds; absent or unparseable both count as unstamped.
fn parse_stamp(raw: Option<&str>) -> Option<i64> {
    let raw = raw?;
    time::OffsetDateTime::parse(raw, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(|t| t.unix_timestamp())
}

/// Whether a stamped `server` value is strictly newer than `device`'s, which may have none.
fn newer(server: i64, device: Option<i64>) -> bool {
    device.is_none_or(|device_at| server > device_at)
}

/// Format an epoch-seconds instant as the RFC 3339 string Kobo expects.
pub fn rfc3339(epoch: i64) -> String {
    time::OffsetDateTime::from_unix_timestamp(epoch)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH)
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

/// The `PUT library/<book>/state` body for `reading`'s current status (and,
/// for a read, its bookmark), every sub-object stamped RFC 3339.
pub fn state_put_body(reading: &Reading, sent: StateSent) -> Value {
    let status_at = reading.status_modified.unwrap_or(0);
    let mut entry = json!({
        "StatusInfo": { "Status": reading.status, "LastModified": rfc3339(status_at) },
    });
    if sent == StateSent::Read {
        if let Some(bookmark) = &reading.bookmark {
            entry["CurrentBookmark"] = json!({
                "ProgressPercent": bookmark.percent.map(u8::from),
                "Location": bookmark.location.as_ref().map(kobo_span_wire),
                "LastModified": rfc3339(bookmark.modified),
            });
        }
    }
    json!({ "ReadingStates": [entry] })
}

/// `KoboSpan` on the wire: `{"Source", "Type": "KoboSpan", "Value"}`.
fn kobo_span_wire(span: &KoboSpan) -> Value {
    json!({ "Source": span.source, "Type": "KoboSpan", "Value": span.value })
}

#[cfg(test)]
mod tests;
