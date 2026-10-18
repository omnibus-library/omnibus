//! Render tests for the log viewer: its group title, the failed-load retry, and
//! the pagination labels.

use omnibus_shared::logs::{LogPage, LogQuery};

use super::*;
use crate::test_support::{provide_current_user, render, render_in_vdom, test_user};

#[test]
fn logs_page_titles_its_card_as_a_group() {
    let html = render_in_vdom(|| {
        provide_current_user(Some(Some(test_user(true, true))));
        rsx! { LogsPage {} }
    });
    assert!(html.contains("<h3>Server logs</h3>"), "{html}");
}

#[component]
fn FailedHost() -> Element {
    let applied = use_signal(LogQuery::default);
    let result = use_signal(|| None::<LogPage>);
    let error = use_signal(|| true);
    let loading = use_signal(|| false);
    rsx! { LogResults { applied, result, error, loading } }
}

#[test]
fn log_results_offer_a_retry_after_a_failed_load() {
    let html = render(rsx! { FailedHost {} });
    assert!(html.contains("logs-error"), "{html}");
    assert!(html.contains("logs-retry"), "{html}");
}

#[component]
fn PaginationHost() -> Element {
    let applied = use_signal(LogQuery::default);
    rsx! { LogPagination { applied, has_more: true, loading: false } }
}

#[test]
fn log_pagination_labels_its_buttons_in_words() {
    let html = render(rsx! { PaginationHost {} });
    assert!(html.contains("Newer"), "{html}");
    assert!(html.contains("Older"), "{html}");
    assert!(
        !html.contains('\u{2190}') && !html.contains('\u{2192}'),
        "{html}"
    );
}
