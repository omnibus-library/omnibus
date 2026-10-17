//! The Activity tab of Administration › Health & activity — the admin view
//! over the durable `background_tasks` history table. Web/SSR-only, with the
//! real authorization boundary being the
//! `AdminUser` extractor on `rpc_get_background_tasks`; the in-page
//! `use_is_admin` gate just keeps the chrome off a non-admin screen.
#![cfg(not(feature = "mobile"))]

use dioxus::prelude::*;
use omnibus_shared::{BackgroundTaskRecord, BackgroundTaskStatus};

use crate::components::loading::RowSkeletons;
use crate::data;
use crate::date_fmt::fmt_timestamp;

/// Words for a persisted `task_kind`, falling back to the snake_case name
/// spelled out for a kind this build doesn't know.
fn task_kind_label(kind: &str) -> String {
    let known = match kind {
        "scan" => "Library scan",
        "scan_audiobooks" => "Audiobook library scan",
        "generate_thumbs" => "Thumbnail generation",
        "resolve_author_photo" => "Author photo lookup",
        "hls_transcode" => "Audio transcode for streaming",
        "refetch_author_photos" => "Author photo refetch",
        "backfill_chapters" => "Audiobook chapter extraction",
        "backfill_word_counts" => "Word count backfill",
        "backfill_page_counts" => "Page count backfill",
        "backfill_epub_structure" => "EPUB structure backfill",
        "backfill_covers" => "Cover backfill",
        "backfill_thumbs" => "Thumbnail backfill",
        "backfill_content_fts" => "Book text indexing",
        "rebuild_fts_index" => "Search index rebuild",
        "resolve_suggestions" => "Suggestion lookup",
        "kepub_convert" => "Kobo conversion",
        "convert_format" => "Format conversion",
        "send_to_kindle" => "Send to Kindle",
        "rewrite_all_epubs" => "EPUB override bake",
        "detect_cleanup" => "Cleanup detection",
        _ => {
            let spaced = kind.replace('_', " ");
            let mut chars = spaced.chars();
            return chars
                .next()
                .map(|first| first.to_uppercase().chain(chars).collect())
                .unwrap_or_default();
        }
    };
    known.to_string()
}

/// The Activity tab: recent worker task runs with their status and timing.
#[component]
pub fn BackgroundTasksSection() -> Element {
    let is_admin = crate::use_is_admin();

    let result = use_signal(|| None::<Vec<BackgroundTaskRecord>>);
    let error = use_signal(|| false);
    let reload = use_signal(|| 0u32);

    spawn_background_tasks_fetch(result, error, reload);

    rsx! {
        section { class: "card", "data-testid": "background-tasks-card",
            h3 { "Recent tasks" }
            p { class: "subtitle",
                "Worker task runs, newest first. The history survives a server restart."
            }
            if is_admin() {
                BackgroundTasksResults { result, error, reload }
            } else {
                p { class: "settings-status error", "data-testid": "background-tasks-forbidden",
                    "Administrator access is required to view background tasks."
                }
            }
        }
    }
}

/// Fetch the task history on mount and whenever "Try again" bumps `reload`,
/// mapping success/failure onto the result/error signals.
fn spawn_background_tasks_fetch(
    mut result: Signal<Option<Vec<BackgroundTaskRecord>>>,
    mut error: Signal<bool>,
    reload: Signal<u32>,
) {
    use_effect(move || {
        let _ = reload();
        error.set(false);
        spawn(async move {
            match data::get_background_tasks().await {
                Ok(tasks) => result.set(Some(tasks)),
                Err(_) => error.set(true),
            }
        });
    });
}

/// The result region: loading / error / empty / populated states.
#[component]
fn BackgroundTasksResults(
    result: Signal<Option<Vec<BackgroundTaskRecord>>>,
    error: Signal<bool>,
    mut reload: Signal<u32>,
) -> Element {
    if error() {
        return rsx! {
            div { class: "settings-actions",
                p { class: "settings-status error", role: "status", "data-testid": "background-tasks-error",
                    "Couldn\u{2019}t load the task history."
                }
                button {
                    r#type: "button",
                    class: "btn ghost",
                    "data-testid": "background-tasks-retry",
                    onclick: move |_| reload += 1,
                    "Try again"
                }
            }
        };
    }
    let Some(tasks) = result() else {
        return rsx! {
            div { role: "status", "aria-live": "polite", "data-testid": "background-tasks-loading",
                span { class: "ld-sr", "Reading the task history" }
                RowSkeletons { count: 4, avatar: false }
            }
        };
    };
    if tasks.is_empty() {
        return rsx! {
            p { class: "settings-status", role: "status", "data-testid": "background-tasks-empty",
                "No background tasks have run since this history began."
            }
        };
    }
    rsx! {
        div {
            class: "logs-stream mono",
            "data-testid": "background-tasks-table",
            role: "region",
            "aria-label": "Recent background tasks",
            for task in tasks {
                BackgroundTaskLine { key: "{task.id}", task }
            }
        }
    }
}

/// One task history row as a single preformatted line: status badge, kind,
/// timing, and (on failure) the error text.
#[component]
fn BackgroundTaskLine(task: BackgroundTaskRecord) -> Element {
    let (status_label, status_class) = match task.status {
        BackgroundTaskStatus::Running => ("RUNNING", "logs-level-info"),
        BackgroundTaskStatus::Success => ("SUCCESS", "logs-level-info"),
        BackgroundTaskStatus::Failed => ("FAILED", "logs-level-error"),
    };
    rsx! {
        div { class: "logs-line", "data-testid": "background-tasks-row",
            span { class: "logs-time", "{fmt_timestamp(task.started_at)}" }
            " "
            span { class: "logs-level {status_class}", "{status_label}" }
            " "
            span { class: "logs-module-cell", "{task_kind_label(&task.task_kind)}" }
            " "
            span { class: "logs-fields", "data-testid": "background-tasks-duration",
                "{fmt_duration(task.started_at, task.finished_at)}"
            }
            if let Some(err) = task.error {
                " "
                span { class: "logs-message", "data-testid": "background-tasks-row-error", "{err}" }
            }
        }
    }
}

/// Elapsed time between start and finish in its two largest units (`45s`,
/// `3m 20s`, `1h 2m`), or "running…" while still in flight.
fn fmt_duration(started_at: i64, finished_at: Option<i64>) -> String {
    let Some(finished) = finished_at else {
        return "running\u{2026}".to_string();
    };
    let secs = (finished - started_at).max(0);
    match (secs / 3_600, secs % 3_600 / 60, secs % 60) {
        (0, 0, s) => format!("{s}s"),
        (0, m, s) => format!("{m}m {s}s"),
        (h, m, _) => format!("{h}h {m}m"),
    }
}

#[cfg(test)]
mod tests;
