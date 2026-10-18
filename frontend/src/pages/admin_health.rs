//! Administration › Health. Five read-only
//! groups over one [`AdminHealthReport`], polled every
//! [`POLL_INTERVAL_MS`] from a post-mount `use_future` loop (never the
//! render body, for hydration parity). Web/SSR-only; the real
//! authorization boundary is the `AdminUser` extractor on `rpc_get_admin_health`.
#![cfg(not(feature = "mobile"))]

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::admin_health::{
    AdminHealthReport, FtsHealth, IndexStatus, StorageStats, WorkerQueueEntry,
};
use omnibus_shared::error_ring::CapturedError;

use crate::components::worker_status::kind_label;
use crate::components::{Loading, LoadingKind};
use crate::data::{self, DataError};
use crate::date_fmt::fmt_timestamp;
use crate::platform_sleep::async_sleep_ms;
use crate::{Access, Route};

/// Polling cadence in milliseconds — AC1 asks for "approximately a
/// 5-second cadence". Same self-hosted-single-admin reasoning as
/// `worker_status::POLL_INTERVAL_MS`: no idle-throttling, the report is
/// small and this page has one viewer at a time.
const POLL_INTERVAL_MS: u32 = 5_000;

/// Administration › Health.
#[component]
pub fn HealthOverview() -> Element {
    let access = crate::use_admin_access();
    let result = use_signal(|| None::<AdminHealthReport>);
    let error = use_signal(|| false);

    spawn_admin_health_fetch(access, result, error);

    rsx! {
        div { class: "ah-page", "data-testid": "admin-health-page",
            match access() {
                Access::Allowed => rsx! { AdminHealthBody { result, error } },
                Access::Unknown => rsx! {
                    Loading { kind: LoadingKind::Section, label: "Checking your access\u{2026}" }
                },
                Access::Denied => rsx! {
                    p { class: "settings-status error", "data-testid": "admin-health-forbidden",
                        "Administrator access is required to view server health."
                    }
                },
            }
        }
    }
}

/// Poll the combined report every [`POLL_INTERVAL_MS`] from a post-mount
/// `use_future` loop (fetch, apply, sleep). Dioxus cancels it on unmount, so no
/// `use_drop` is needed. [`should_poll`] gates the fetch each tick so a
/// non-admin visitor never hits the admin-gated RPC.
fn spawn_admin_health_fetch(
    access: ReadSignal<Access>,
    mut result: Signal<Option<AdminHealthReport>>,
    mut error: Signal<bool>,
) {
    use_future(move || async move {
        loop {
            if should_poll(access()) {
                let outcome = data::get_admin_health().await;
                apply_poll_result(outcome, &mut result, &mut error);
            }
            async_sleep_ms(POLL_INTERVAL_MS).await;
        }
    });
}

/// Whether a poll tick should fetch. The RPC already 403s a non-admin, but a
/// visitor who isn't admin (or whose `CurrentUser` hasn't resolved) shouldn't
/// even attempt it. Re-checked every tick, so admin status flipping
/// mid-session starts or stops polling within one interval.
fn should_poll(access: Access) -> bool {
    access == Access::Allowed
}

/// Merge one poll's outcome into the `result`/`error` signals. A success
/// always replaces the report and clears any prior error. A failure flips the
/// page to its error state only when there is no report yet (the first load);
/// a later blip keeps the last known-good report on screen.
fn apply_poll_result(
    outcome: Result<AdminHealthReport, DataError>,
    result: &mut Signal<Option<AdminHealthReport>>,
    error: &mut Signal<bool>,
) {
    match outcome {
        Ok(report) => {
            if result.peek().as_ref() != Some(&report) {
                result.set(Some(report));
            }
            error.set(false);
        }
        Err(_) if result.peek().is_none() => error.set(true),
        Err(_) => {}
    }
}

/// The result region: loading / error / populated states.
#[component]
fn AdminHealthBody(result: Signal<Option<AdminHealthReport>>, error: Signal<bool>) -> Element {
    if error() {
        return rsx! {
            p { class: "settings-status error", role: "status", "data-testid": "admin-health-error",
                "Couldn\u{2019}t load server health. It\u{2019}s retried every few seconds."
            }
        };
    }
    let Some(report) = result() else {
        return rsx! {
            Loading {
                kind: LoadingKind::Section,
                class: "start",
                testid: "admin-health-loading",
                label: "Taking the server's pulse",
            }
        };
    };
    // `report` is an owned local (already cloned out of the signal by
    // `result()`), and each field below is used exactly once, so a plain
    // partial move covers every section without a further clone.
    rsx! {
        div { class: "ah-grid", "data-testid": "admin-health-grid",
            IndexStatusCard { status: report.index }
            WorkerQueueCard { entries: report.worker_queue }
            FtsHealthCard { fts: report.fts }
            StorageCard { storage: report.storage }
        }
        LastErrorsCard { entries: report.last_errors }
    }
}

// ── Index status ─────────────────────────────────────────────────

/// Section 1: configured library paths and row counts.
#[component]
fn IndexStatusCard(status: IndexStatus) -> Element {
    rsx! {
        section { class: "card ah-card", "data-testid": "admin-health-index-card",
            h3 { "Index status" }
            div { class: "ah-kv",
                AhKvRow { label: "Ebook library", value: path_or_unconfigured(status.ebook_library_path.as_deref()) }
                AhKvRow { label: "Audiobook library", value: path_or_unconfigured(status.audiobook_library_path.as_deref()) }
                AhKvRow { label: "Books indexed", value: status.book_count.to_string() }
                AhKvRow { label: "Authors indexed", value: status.author_count.to_string() }
                AhKvRow { label: "Series indexed", value: status.series_count.to_string() }
            }
            if status.ghosted_book_count > 0 {
                p { class: "settings-status error", "data-testid": "admin-health-ghosted-warning",
                    "{ghosted_line(status.ghosted_book_count)}"
                }
            } else {
                p { class: "settings-status success", "data-testid": "admin-health-ghosted-ok",
                    "No ghosted books."
                }
            }
        }
    }
}

/// "N books have no file on disk …", agreeing with the count.
fn ghosted_line(count: i64) -> String {
    let verb = if count == 1 { "has" } else { "have" };
    let books = crate::format::count_label(count, "book");
    format!("{books} {verb} no file on disk (ghosted by a prior reindex).")
}

fn path_or_unconfigured(path: Option<&str>) -> String {
    match path {
        Some(p) if !p.trim().is_empty() => p.to_string(),
        _ => "Not configured".to_string(),
    }
}

// ── Worker queue ─────────────────────────────────────────────────

/// Section 2: live per-`TaskKind` queue depth and recent completion timings.
#[component]
fn WorkerQueueCard(entries: Vec<WorkerQueueEntry>) -> Element {
    rsx! {
        section { class: "card ah-card", "data-testid": "admin-health-worker-card",
            h3 { "Worker queue" }
            if entries.is_empty() {
                p { class: "settings-status", "data-testid": "admin-health-worker-empty",
                    "No active or recently completed background tasks."
                }
            } else {
                div { class: "table-scroll",
                    table { class: "users-table", "data-testid": "admin-health-worker-table",
                        thead {
                            tr {
                                th { "Task" }
                                th { class: "ah-num", "Queued" }
                                th { class: "ah-num", "Done recently" }
                                th { class: "ah-num", "Last took" }
                            }
                        }
                        tbody {
                            for entry in entries {
                                WorkerQueueRow { key: "{entry.kind:?}", entry }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn WorkerQueueRow(entry: WorkerQueueEntry) -> Element {
    let label = kind_label(entry.kind, entry.queue_depth > 0);
    let last_ms = entry.recent_completions_ms.last().copied();
    rsx! {
        tr { "data-testid": "admin-health-worker-row",
            td { "{label}" }
            td { class: "ah-num", "{entry.queue_depth}" }
            td { class: "ah-num", "{entry.recent_completions_ms.len()}" }
            td { class: "ah-num",
                match last_ms {
                    Some(ms) => rsx! { "{format_duration_ms(ms)}" },
                    None => rsx! { "\u{2014}" },
                }
            }
        }
    }
}

/// A task's run time: milliseconds under a second, tenths of a second past it.
fn format_duration_ms(ms: u64) -> String {
    if ms < 1_000 {
        return format!("{ms}\u{a0}ms");
    }
    #[allow(clippy::cast_precision_loss)]
    let secs = ms as f64 / 1_000.0;
    format!("{secs:.1}\u{a0}s")
}

// ── FTS index health ─────────────────────────────────────────────

/// Section 3: `books_fts` vs `books` row-count parity.
#[component]
fn FtsHealthCard(fts: FtsHealth) -> Element {
    rsx! {
        section { class: "card ah-card", "data-testid": "admin-health-fts-card",
            h3 { "Search index (FTS)" }
            div { class: "ah-kv",
                AhKvRow { label: "Books rows", value: fts.books_rows.to_string() }
                AhKvRow { label: "FTS rows", value: fts.fts_rows.to_string() }
            }
            if fts.in_sync {
                p { class: "settings-status success", "data-testid": "admin-health-fts-in-sync",
                    "In sync."
                }
            } else {
                p { class: "settings-status error", "data-testid": "admin-health-fts-out-of-sync",
                    "Out of sync. Search can miss or misreport books until the index is rebuilt with "
                    code { translate: "no", "POST /api/fts/rebuild" }
                    "."
                }
            }
        }
    }
}

// ── Storage utilization ──────────────────────────────────────────

/// Section 4: disk usage across the library and every on-disk cache.
#[component]
fn StorageCard(storage: StorageStats) -> Element {
    rsx! {
        section { class: "card ah-card", "data-testid": "admin-health-storage-card",
            h3 { "Storage" }
            div { class: "ah-kv",
                AhKvRow {
                    label: "Library content",
                    value: format_bytes(u64::try_from(storage.library_bytes).unwrap_or(0)),
                }
                AhKvRow { label: "Covers", value: format_bytes(storage.covers_bytes) }
                AhKvRow {
                    label: "Thumbnail cache",
                    value: format_cache_usage(storage.thumbs_bytes, storage.thumbs_cap_bytes),
                }
                AhKvRow {
                    label: "HLS transcode cache",
                    value: format_cache_usage(storage.hls_bytes, storage.hls_cap_bytes),
                }
                AhKvRow {
                    label: "Export-EPUB cache",
                    value: format_cache_usage(storage.export_epub_bytes, storage.export_epub_cap_bytes),
                }
            }
        }
    }
}

/// `"12.3 MB / 5.0 GB cap"`.
fn format_cache_usage(used: u64, cap: u64) -> String {
    format!("{} / {} cap", format_bytes(used), format_bytes(cap))
}

/// Human-readable byte count (`"3.1 MB"`, `"0 B"`). Unlike
/// `format::file_size`, zero is a real value here (an empty cache), not an
/// absent one, so it always returns a string.
fn format_bytes(bytes: u64) -> String {
    #[allow(clippy::cast_precision_loss)]
    let (value, unit) = if bytes >= 1_000_000_000 {
        (bytes as f64 / 1_000_000_000.0, "GB")
    } else if bytes >= 1_000_000 {
        (bytes as f64 / 1_000_000.0, "MB")
    } else if bytes >= 1_000 {
        (bytes as f64 / 1_000.0, "KB")
    } else {
        return format!("{bytes} B");
    };
    format!("{value:.1} {unit}")
}

// ── Last errors ───────────────────────────────────────────────────

/// Section 5: the in-memory error ring, newest first, each line linking the
/// book or naming the file it was about when the event recorded one.
#[component]
fn LastErrorsCard(entries: Vec<CapturedError>) -> Element {
    rsx! {
        section { class: "card ah-card", "data-testid": "admin-health-errors-card",
            h3 { "Last errors" }
            p { class: "subtitle", "Most recent server errors captured in memory, newest first." }
            if entries.is_empty() {
                p { class: "settings-status", "data-testid": "admin-health-errors-empty",
                    "No errors captured since the server started."
                }
            } else {
                div {
                    class: "logs-stream mono",
                    "data-testid": "admin-health-errors-table",
                    role: "region",
                    "aria-label": "Recent server errors",
                    for (i, entry) in entries.into_iter().enumerate() {
                        AhErrorLine { key: "{entry.timestamp}-{i}", entry }
                    }
                }
            }
        }
    }
}

#[component]
fn AhErrorLine(entry: CapturedError) -> Element {
    rsx! {
        div { class: "logs-line", "data-testid": "admin-health-errors-row",
            span { class: "logs-time", "{fmt_timestamp(entry.timestamp)}" }
            " "
            span { class: "logs-level logs-level-error", "ERROR" }
            " "
            span { class: "logs-module-cell", "{entry.target}" }
            " "
            span { class: "logs-message", "{entry.message}" }
            if let Some(uuid) = entry.book_uuid {
                " "
                Link {
                    to: Route::BookDetail { uuid },
                    class: "logs-ref-link",
                    "data-testid": "admin-health-errors-book-link",
                    "Open book"
                }
            }
            if let Some(file) = entry.file {
                " "
                span { class: "logs-fields", translate: "no", "data-testid": "admin-health-errors-file", "{file}" }
            }
        }
    }
}

/// One label/value row shared by the Index status, FTS, and Storage cards.
#[component]
fn AhKvRow(label: &'static str, value: String) -> Element {
    rsx! {
        div { class: "ah-kv-row",
            span { class: "ah-kv-label", "{label}" }
            span { class: "ah-kv-value", "{value}" }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
