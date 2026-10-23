//! The device's own reading progress, reconciled against the server's
//! independently for status and bookmark ([`crate::firmware::Quirk::StateArbitration`]):
//! each sub-object is adopted only when the server sends one stamped
//! strictly newer than the device's own. Time is injected as data — nothing
//! here reads the wall clock — so arbitration is testable with no sleeps.

use serde::{Deserialize, Serialize};

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
    pub fn new(value: u8) -> Option<Self> {
        (value <= 100).then_some(Self(value))
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

#[cfg(test)]
mod tests;
