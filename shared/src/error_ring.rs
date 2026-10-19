//! Wire types for the in-memory "last errors" ring buffer. Populated by the
//! tracing `Layer` in `server::logging::init_tracing` from ERROR-level events
//! and read by the admin health report (Administration › Health). A fast,
//! bounded companion to the durable JSON log sink ([`crate::logs`]), not a
//! replacement.

use serde::{Deserialize, Serialize};

/// Max entries retained by the ring buffer (`omnibus_db::error_ring`),
/// oldest evicted first.
pub const ERROR_RING_CAPACITY: usize = 200;

/// One error the server logged recently. The server keeps the last 200.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CapturedError {
    /// When the error was logged, in Unix seconds.
    pub timestamp: i64,
    /// The part of the server code that logged the error.
    pub target: String,
    /// The error message, or an empty string when there is none.
    pub message: String,
    // Read from the event's `book_uuid` or `uuid` field.
    /// The uuid of the book the error names. Absent when it names none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_uuid: Option<String>,
    // Read from the event's `file`, `path` or `file_path` field.
    /// The file path the error names. Absent when it names none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}
