//! Admin log-viewer wire types, produced by `db::logs` from the on-disk rolling
//! JSON logs and served to the admin `/logs` page. A [`LogQuery`] carries the
//! level/module/time-range filters and page cursor; a [`LogPage`] returns one
//! newest-first page of [`LogRecord`]s plus a `has_more` flag.

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

/// Default page size when a query leaves `per_page` at 0.
pub const LOG_PER_PAGE_DEFAULT: u32 = 50;

/// Upper bound on page size — a query asking for more is clamped to this so a
/// single request can't force the reader to buffer an unbounded slice.
pub const LOG_PER_PAGE_MAX: u32 = 200;

/// One parsed structured-log record surfaced to the admin log viewer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct LogRecord {
    /// ISO-8601 UTC timestamp as logged. Fixed-width, so sorting the strings sorts by time.
    pub timestamp: String,
    /// Level string as written: `ERROR` / `WARN` / `INFO` / `DEBUG` / `TRACE`.
    pub level: String,
    /// The module that logged the event, which the `module` filter matches against.
    pub target: String,
    /// The event's `message` field, or empty when the event carried none.
    pub message: String,
    /// The event's other fields and its request's method and path, as compact JSON.
    /// Absent when there was nothing beyond the message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<String>,
}

/// Filter + pagination parameters for a log-viewer query. Every filter is
/// optional; an absent or empty filter does not narrow the results.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema, utoipa::IntoParams))]
#[cfg_attr(feature = "openapi", into_params(parameter_in = Query))]
pub struct LogQuery {
    /// Only records at this level, ignoring case, e.g. `ERROR`. Leave it out or empty to
    /// keep every level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
    /// Only records whose module contains this text, ignoring case, e.g.
    /// `omnibus::backend`. Leave it out or empty to keep every module.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
    /// Earliest time to include, as an ISO-8601 prefix such as `2026-07-19T00:00`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// Latest time to include, as an ISO-8601 prefix. A bound to the minute includes that
    /// whole minute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    /// Zero-based page index.
    #[serde(default)]
    pub page: u32,
    /// Requested page size. 0 means 50, and a size over 200 is cut to 200.
    #[serde(default)]
    pub per_page: u32,
}

/// One page of matching log records, newest first.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct LogPage {
    /// Matching records for this page, newest first.
    pub records: Vec<LogRecord>,
    /// The zero-based page index that was read.
    pub page: u32,
    /// The page size that was used, after the default and the cap.
    pub per_page: u32,
    /// Whether more matching records follow this page.
    pub has_more: bool,
}

impl LogQuery {
    /// Resolve the effective page size: 0 → default, otherwise clamped to the
    /// max. Kept here so the client and server agree on the bound.
    pub fn effective_per_page(&self) -> u32 {
        if self.per_page == 0 {
            LOG_PER_PAGE_DEFAULT
        } else {
            self.per_page.min(LOG_PER_PAGE_MAX)
        }
    }
}
