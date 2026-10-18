//! Tests for the Activity tab: the task-name and duration formatters, and the
//! failed-load state.

use super::*;

#[test]
fn task_kind_label_names_a_known_task_in_words() {
    assert_eq!(task_kind_label("scan"), "Library scan");
    assert_eq!(
        task_kind_label("backfill_content_fts"),
        "Book text indexing"
    );
    assert_eq!(task_kind_label("rewrite_all_epubs"), "EPUB override bake");
}

#[test]
fn task_kind_label_spells_out_a_task_this_build_does_not_know() {
    assert_eq!(task_kind_label("prune_old_things"), "Prune old things");
}

#[test]
fn fmt_duration_reports_seconds_under_a_minute() {
    assert_eq!(fmt_duration(1_000, Some(1_045)), "45s");
}

#[test]
fn fmt_duration_reports_minutes_and_seconds_under_an_hour() {
    assert_eq!(fmt_duration(0, Some(200)), "3m 20s");
}

#[test]
fn fmt_duration_reports_hours_and_minutes_past_an_hour() {
    assert_eq!(fmt_duration(0, Some(3_600 + 120 + 9)), "1h 2m");
}

#[test]
fn fmt_duration_reports_running_when_not_yet_finished() {
    assert_eq!(fmt_duration(1_000, None), "running\u{2026}");
}

#[cfg(feature = "server")]
#[component]
fn FailedHost() -> Element {
    let result = use_signal(|| None);
    let error = use_signal(|| true);
    let reload = use_signal(|| 0u32);
    rsx! { BackgroundTasksResults { result, error, reload } }
}

#[cfg(feature = "server")]
#[test]
fn background_tasks_results_offer_a_retry_after_a_failed_load() {
    let html = crate::test_support::render(rsx! { FailedHost {} });
    assert!(html.contains("background-tasks-error"), "{html}");
    assert!(html.contains("background-tasks-retry"), "{html}");
}
