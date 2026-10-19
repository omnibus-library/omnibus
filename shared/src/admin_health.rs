//! Wire types for the admin server-health page: index status, worker queue
//! depth, FTS index health, and storage utilization. The fifth section
//! (last errors) reuses [`crate::error_ring::CapturedError`] directly
//! rather than a redundant wrapper.

use serde::{Deserialize, Serialize};

use crate::error_ring::CapturedError;
use crate::worker::TaskKind;

/// What the library index holds: the configured library folders and how many books,
/// authors and series it lists.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct IndexStatus {
    pub ebook_library_path: Option<String>,
    pub audiobook_library_path: Option<String>,
    pub book_count: i64,
    pub author_count: i64,
    pub series_count: i64,
    // Ghosted books keep their identity with their content gone; see
    // `.claude/rules/06-migrations.md`'s book-identity section.
    /// Books that have lost every file because a scan no longer found them on disk. The
    /// book records stay.
    pub ghosted_book_count: i64,
}

/// One kind of background task: how many are queued or running, and how long recent ones
/// took.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkerQueueEntry {
    pub kind: TaskKind,
    pub queue_depth: usize,
    /// How long each of the last 20 finished tasks took, in milliseconds, oldest first.
    /// Failed tasks count too.
    pub recent_completions_ms: Vec<u64>,
}

/// Whether the search index lists every book. A mismatch means an earlier write failed
/// to update the index. `POST /api/fts/rebuild` brings it back in sync.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FtsHealth {
    pub books_rows: i64,
    pub fts_rows: i64,
    pub in_sync: bool,
}

/// Disk use, in bytes, of the book library and each cache Omnibus keeps.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct StorageStats {
    /// The total size of every indexed book file. It is not a cache, so it has no cap.
    pub library_bytes: i64,
    pub covers_bytes: u64,
    pub thumbs_bytes: u64,
    pub thumbs_cap_bytes: u64,
    pub hls_bytes: u64,
    pub hls_cap_bytes: u64,
    pub export_epub_bytes: u64,
    pub export_epub_cap_bytes: u64,
}

/// The server health report from `GET /api/admin/health`: the library index, the task
/// queue, the search index, disk use and recent errors, in one response.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AdminHealthReport {
    pub index: IndexStatus,
    pub worker_queue: Vec<WorkerQueueEntry>,
    pub fts: FtsHealth,
    pub storage: StorageStats,
    pub last_errors: Vec<CapturedError>,
}
