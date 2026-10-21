//! Worker progress feed wire types shared with the frontend.
//!
//! Mirrors the payload-less shape of the server-side `Task` enum so the wire
//! protocol stays decoupled from the runtime `Task` type's lifetimes and
//! handler closures.

use serde::{Deserialize, Serialize};

// Mirrors the payload-less shape of the server-side `Task` enum so the wire
// protocol stays decoupled from the runtime `Task` type's lifetimes and handler
// closures. `#[non_exhaustive]` so future worker actions can be added without
// breaking client matches.
/// The kind of a background task. `scan` also covers the jobs that follow a scan and
/// other jobs without a kind of their own. More kinds may come, so clients should accept
/// values they don't know.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum TaskKind {
    Scan,
    GenerateThumbs,
    ResolveAuthorPhoto,
    RefetchAuthorPhotos,
    BackfillChapters,
    ResolveSuggestions,
}

/// Where a background task stands. `state` says which case it is. A `running` task
/// without `total` hasn't counted its work yet. With `total`, `processed` out of `total`
/// is its progress. `done` and `failed` tasks stay in `recent_complete` for about 10
/// seconds.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ProgressState {
    Running {
        processed: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        total: Option<u32>,
    },
    Done {
        processed: u32,
        /// Present when a scan found many books' files missing, though not so many that
        /// it stopped. Clients warn about it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ghost_warning: Option<GhostFilesWarning>,
        // Deliberately just uuids, not error text: this endpoint is readable by any
        // authenticated user and the underlying error can carry a server filesystem
        // path (the full message is logged instead).
        /// The uuids of books whose EPUB couldn't be rebuilt with their edited metadata,
        /// after a rebuild of every EPUB. Absent otherwise, and never present together
        /// with `ghost_warning`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bake_errors: Option<Vec<String>>,
    },
    Failed {
        message: String,
    },
}

/// How many books lost their files in one scan. `removed` books lost theirs, out of the
/// `total` that had files. The share was high enough to warn about, but below the point
/// where the scan stops.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct GhostFilesWarning {
    pub removed: u32,
    pub total: u32,
}

// `current_item` is user-facing display text and must never carry an absolute
// server path: `rpc_worker_status` is readable by any user.
/// Live detail about a task: its phase, the item it is on and, for a scan, its file
/// counts. Every field may be absent.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TaskDetail {
    /// A short label for the task's current phase, such as "Walking the library".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    /// The item the task is working on, such as "books/Author/Title.epub".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_item: Option<String>,
    /// A scan's file counts. They stay on the finished task, so a client can sum up what
    /// the scan changed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tallies: Option<ScanTallies>,
}

impl TaskDetail {
    /// `true` when no field carries anything — the "render nothing" state.
    pub fn is_empty(&self) -> bool {
        self.phase.is_none() && self.current_item.is_none() && self.tallies.is_none()
    }
}

/// File counts from a library scan. `found` is how many files it found on disk, and the
/// other counts say how it sorted them against the index. The counts are final once the
/// scan has compared every file.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ScanTallies {
    pub found: u32,
    pub new: u32,
    pub changed: u32,
    pub removed: u32,
    pub moved: u32,
    pub unchanged: u32,
}

/// One background task in the progress feed. `task_id` identifies it until the server
/// restarts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TaskProgress {
    pub task_id: u64,
    pub kind: TaskKind,
    pub state: ProgressState,
    /// What the task works on, such as a library folder or a book. Tasks with the same
    /// key run one after another. Absent when the task claims nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_key: Option<String>,
    /// Live detail about the task. Absent for kinds of task that don't report it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<TaskDetail>,
    // The server's eviction logic uses a monotonic `Instant`, so these wall-clock
    // timestamps don't have to be precise.
    /// When the task started, in Unix milliseconds by the server's clock. It is for
    /// showing elapsed time only.
    pub started_at_ms: i64,
    /// When the task last reported progress, in Unix milliseconds.
    pub last_update_ms: i64,
}

/// The background task progress feed: tasks running now, and tasks that finished in the
/// last 10 seconds or so. Both lists are sorted by `task_id`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkerStatus {
    pub active: Vec<TaskProgress>,
    pub recent_complete: Vec<TaskProgress>,
}

/// Where a recorded background task run ended up. `running` also covers a run that never
/// finished because the server stopped abruptly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum BackgroundTaskStatus {
    Running,
    Success,
    Failed,
}

impl BackgroundTaskStatus {
    /// The DB `status` column's TEXT representation — also the CHECK
    /// constraint's allowed set (migration `0072`).
    pub fn as_db_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Success => "success",
            Self::Failed => "failed",
        }
    }
}

impl std::str::FromStr for BackgroundTaskStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "running" => Ok(Self::Running),
            "success" => Ok(Self::Success),
            "failed" => Ok(Self::Failed),
            other => Err(format!("unknown background task status: {other}")),
        }
    }
}

// The worker is the sole writer, via `omnibus_db::background_tasks`.
/// One recorded run of a background task: its kind, status and timing. Clients can read
/// these but never write them.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct BackgroundTaskRecord {
    pub id: i64,
    pub task_kind: String,
    pub status: BackgroundTaskStatus,
    /// When the run started, in Unix seconds.
    pub started_at: i64,
    /// When the run finished, in Unix seconds. Null while `status` is `running`.
    pub finished_at: Option<i64>,
    // The worker's `handlers::sanitized_err` convention keeps raw internals out of
    // every `TaskOutcome::Err`, and this carries that same sanitized text.
    /// Why the run failed. Null unless `status` is `failed`. The text is safe to show
    /// and holds no server internals.
    pub error: Option<String>,
}

#[cfg(test)]
mod tests;
