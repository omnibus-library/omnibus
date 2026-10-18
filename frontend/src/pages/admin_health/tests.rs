//! Tests for the admin server-health page: the pure formatters, the
//! live-poll merge logic, and a render assertion per section (rendered
//! output contains the expected content, per
//! `.claude/rules/03-unit-testing.md`'s frontend guidance).

use omnibus_shared::worker::TaskKind;

use crate::test_support::in_root_scope;

use super::*;

// ---------- poll gating ----------

#[test]
fn should_poll_fetches_only_for_an_admin_viewer() {
    assert!(should_poll(Access::Allowed));
    assert!(
        !should_poll(Access::Denied),
        "a non-admin viewer must never trigger the admin-gated RPC"
    );
    assert!(
        !should_poll(Access::Unknown),
        "an unresolved viewer must wait for `/me` before polling"
    );
}

// ---------- live-poll merge logic ----------

fn sample_report(book_count: i64) -> AdminHealthReport {
    AdminHealthReport {
        index: IndexStatus {
            book_count,
            ..Default::default()
        },
        ..Default::default()
    }
}

#[test]
fn apply_poll_result_populates_result_and_clears_error_on_first_success() {
    in_root_scope(|| {
        let mut result = Signal::new(None::<AdminHealthReport>);
        let mut error = Signal::new(false);

        apply_poll_result(Ok(sample_report(1)), &mut result, &mut error);

        assert_eq!(result().map(|r| r.index.book_count), Some(1));
        assert!(!error());
    });
}

#[test]
fn apply_poll_result_sets_error_when_the_first_fetch_fails() {
    in_root_scope(|| {
        let mut result = Signal::new(None::<AdminHealthReport>);
        let mut error = Signal::new(false);

        apply_poll_result(
            Err(DataError::Other("boom".to_string())),
            &mut result,
            &mut error,
        );

        assert!(result().is_none());
        assert!(error());
    });
}

#[test]
fn apply_poll_result_keeps_the_last_known_report_when_a_later_poll_fails() {
    in_root_scope(|| {
        let mut result = Signal::new(None::<AdminHealthReport>);
        let mut error = Signal::new(false);
        apply_poll_result(Ok(sample_report(7)), &mut result, &mut error);

        apply_poll_result(
            Err(DataError::Other("transient".to_string())),
            &mut result,
            &mut error,
        );

        assert_eq!(result().map(|r| r.index.book_count), Some(7));
        assert!(
            !error(),
            "a transient poll failure must not flip an already-loaded page to the error state"
        );
    });
}

#[test]
fn apply_poll_result_replaces_a_stale_report_on_the_next_success() {
    in_root_scope(|| {
        let mut result = Signal::new(None::<AdminHealthReport>);
        let mut error = Signal::new(false);
        apply_poll_result(Ok(sample_report(7)), &mut result, &mut error);
        apply_poll_result(
            Err(DataError::Other("transient".to_string())),
            &mut result,
            &mut error,
        );

        apply_poll_result(Ok(sample_report(9)), &mut result, &mut error);

        assert_eq!(result().map(|r| r.index.book_count), Some(9));
        assert!(!error());
    });
}

// ---------- pure formatters ----------

#[test]
fn format_bytes_scales_the_unit_to_the_byte_count() {
    assert_eq!(format_bytes(0), "0 B");
    assert_eq!(format_bytes(512), "512 B");
    assert_eq!(format_bytes(3_100), "3.1 KB");
    assert_eq!(format_bytes(3_100_000), "3.1 MB");
    assert_eq!(format_bytes(2_500_000_000), "2.5 GB");
}

#[test]
fn format_cache_usage_joins_the_used_and_cap_figures() {
    assert_eq!(format_cache_usage(0, 0), "0 B / 0 B cap");
    assert_eq!(
        format_cache_usage(3_100_000, 5_000_000_000),
        "3.1 MB / 5.0 GB cap"
    );
}

#[test]
fn path_or_unconfigured_reports_the_path_when_present() {
    assert_eq!(path_or_unconfigured(Some("/library")), "/library");
}

#[test]
fn path_or_unconfigured_falls_back_when_absent_or_blank() {
    assert_eq!(path_or_unconfigured(None), "Not configured");
    assert_eq!(path_or_unconfigured(Some("   ")), "Not configured");
}

#[test]
fn fmt_timestamp_formats_a_known_epoch_second() {
    assert_eq!(fmt_timestamp(1_700_000_000), "2023-11-14 22:13:20 UTC");
}

#[test]
fn fmt_timestamp_formats_the_epoch_itself() {
    assert_eq!(fmt_timestamp(0), "1970-01-01 00:00:00 UTC");
}

// ---------- render tests (SSR markup) ----------

fn index_status() -> IndexStatus {
    IndexStatus {
        ebook_library_path: Some("/lib/ebooks".into()),
        audiobook_library_path: None,
        book_count: 42,
        author_count: 7,
        series_count: 3,
        ghosted_book_count: 0,
    }
}

#[test]
fn index_status_card_renders_paths_and_counts() {
    let html = dioxus::ssr::render_element(rsx! { IndexStatusCard { status: index_status() } });
    assert!(html.contains("data-testid=\"admin-health-index-card\""));
    assert!(html.contains("/lib/ebooks"));
    assert!(html.contains("Not configured"));
    assert!(html.contains("42"));
    assert!(html.contains("data-testid=\"admin-health-ghosted-ok\""));
    assert!(!html.contains("admin-health-ghosted-warning"));
}

#[test]
fn index_status_card_warns_when_books_are_ghosted() {
    let mut status = index_status();
    status.ghosted_book_count = 2;
    let html = dioxus::ssr::render_element(rsx! { IndexStatusCard { status } });
    assert!(html.contains("data-testid=\"admin-health-ghosted-warning\""));
    assert!(html.contains("2 books have no file on disk"), "{html}");
}

#[test]
fn index_status_card_counts_one_ghosted_book_in_the_singular() {
    let mut status = index_status();
    status.ghosted_book_count = 1;
    let html = dioxus::ssr::render_element(rsx! { IndexStatusCard { status } });
    assert!(html.contains("1 book has no file on disk"), "{html}");
}

#[test]
fn index_status_card_titles_itself_as_a_group() {
    let html = dioxus::ssr::render_element(rsx! { IndexStatusCard { status: index_status() } });
    assert!(html.contains("<h3>Index status</h3>"), "{html}");
}

#[test]
fn worker_queue_card_renders_empty_state_when_no_entries() {
    let html = dioxus::ssr::render_element(rsx! { WorkerQueueCard { entries: Vec::new() } });
    assert!(html.contains("data-testid=\"admin-health-worker-empty\""));
    assert!(!html.contains("admin-health-worker-table"));
}

#[test]
fn worker_queue_card_renders_a_row_per_entry() {
    let entries = vec![WorkerQueueEntry {
        kind: TaskKind::Scan,
        queue_depth: 1,
        recent_completions_ms: vec![120, 340],
    }];
    let html = dioxus::ssr::render_element(rsx! { WorkerQueueCard { entries } });
    assert!(html.contains("data-testid=\"admin-health-worker-table\""));
    assert!(html.contains("Scanning library"));
    assert!(html.contains("340\u{a0}ms"), "{html}");
}

#[test]
fn worker_queue_card_scrolls_its_table_inside_the_card() {
    let entries = vec![WorkerQueueEntry {
        kind: TaskKind::Scan,
        queue_depth: 0,
        recent_completions_ms: vec![14_497],
    }];
    let html = dioxus::ssr::render_element(rsx! { WorkerQueueCard { entries } });
    let wrap = html.find("table-scroll").expect("scroll wrapper");
    assert!(
        wrap < html.find("admin-health-worker-table").unwrap(),
        "{html}"
    );
    assert!(html.contains("ah-num"), "{html}");
}

#[test]
fn format_duration_ms_switches_to_seconds_past_one_second() {
    assert_eq!(format_duration_ms(340), "340\u{a0}ms");
    assert_eq!(format_duration_ms(14_497), "14.5\u{a0}s");
}

#[test]
fn fts_health_card_reports_in_sync() {
    let fts = FtsHealth {
        books_rows: 10,
        fts_rows: 10,
        in_sync: true,
    };
    let html = dioxus::ssr::render_element(rsx! { FtsHealthCard { fts } });
    assert!(html.contains("data-testid=\"admin-health-fts-in-sync\""));
    assert!(!html.contains("admin-health-fts-out-of-sync"));
}

#[test]
fn fts_health_card_reports_out_of_sync() {
    let fts = FtsHealth {
        books_rows: 10,
        fts_rows: 4,
        in_sync: false,
    };
    let html = dioxus::ssr::render_element(rsx! { FtsHealthCard { fts } });
    assert!(html.contains("data-testid=\"admin-health-fts-out-of-sync\""));
    // Settings has no rebuild control; the copy names the one that exists.
    assert!(!html.contains("Settings"), "{html}");
    assert!(html.contains("/api/fts/rebuild"), "{html}");
}

#[test]
fn storage_card_renders_every_figure() {
    let storage = StorageStats {
        library_bytes: 3_100_000,
        covers_bytes: 512,
        thumbs_bytes: 1_000,
        thumbs_cap_bytes: 5_000_000_000,
        hls_bytes: 0,
        hls_cap_bytes: 5_000_000_000,
        export_epub_bytes: 2_000,
        export_epub_cap_bytes: 5_000_000_000,
    };
    let html = dioxus::ssr::render_element(rsx! { StorageCard { storage } });
    assert!(html.contains("data-testid=\"admin-health-storage-card\""));
    assert!(html.contains("3.1 MB"));
    assert!(html.contains("512 B"));
    assert!(html.contains("Export-EPUB cache"));
    assert!(html.contains("2.0 KB"));
    assert!(html.contains("cap"));
}

#[test]
fn last_errors_card_renders_empty_state() {
    let html = dioxus::ssr::render_element(rsx! { LastErrorsCard { entries: Vec::new() } });
    assert!(html.contains("data-testid=\"admin-health-errors-empty\""));
}

#[test]
fn last_errors_card_renders_a_row_per_entry() {
    let entries = vec![CapturedError {
        timestamp: 1_700_000_000,
        target: "omnibus::test".into(),
        message: "boom".into(),
        book_uuid: None,
        file: None,
    }];
    let html = dioxus::ssr::render_element(rsx! { LastErrorsCard { entries } });
    assert!(html.contains("data-testid=\"admin-health-errors-table\""));
    assert!(html.contains("boom"));
    assert!(html.contains("2023-11-14 22:13:20 UTC"));
}

#[derive(Clone, Debug, PartialEq, dioxus_router::Routable)]
enum ErrorsRoute {
    #[route("/")]
    ErrorsHost {},
}

// The book link is a router `Link`, so the card mounts under a router.
#[component]
fn ErrorsHost() -> Element {
    let entries = vec![CapturedError {
        timestamp: 1_700_000_000,
        target: "omnibus::scanner".into(),
        message: "unreadable epub".into(),
        book_uuid: Some("uuid-1".into()),
        file: Some("/lib/broken.epub".into()),
    }];
    rsx! { LastErrorsCard { entries } }
}

#[test]
fn last_errors_card_links_the_book_and_names_the_file() {
    let html = crate::test_support::render_in_vdom(|| {
        rsx! { dioxus_router::Router::<ErrorsRoute> {} }
    });
    assert!(html.contains("admin-health-errors-book-link"), "{html}");
    assert!(html.contains(r#"href="/books/uuid-1""#), "{html}");
    assert!(html.contains("/lib/broken.epub"), "{html}");
}

// ---------- access gate (first paint vs resolved) ----------

#[test]
fn health_overview_first_paint_checks_access_rather_than_refusing() {
    let html = crate::test_support::render_in_vdom(|| rsx! { HealthOverview {} });
    assert!(html.contains("Checking your access"), "{html}");
    assert!(!html.contains("admin-health-forbidden"), "{html}");
}

#[test]
fn health_overview_refuses_a_resolved_reader_who_is_not_an_admin() {
    fn app() -> Element {
        crate::test_support::provide_current_user(Some(Some(crate::test_support::test_user(
            false, true,
        ))));
        rsx! { HealthOverview {} }
    }
    let html = crate::test_support::render_in_vdom(app);
    assert!(html.contains("admin-health-forbidden"), "{html}");
}
