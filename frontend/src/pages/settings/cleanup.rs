//! Library cleanup settings section — the feature's entry point: per-kind
//! suggestion counts, a link into each kind's review queue, and the button
//! that queues a detection pass. Web/server only, like the other admin
//! sections; the `AdminUser` extractor on the `cleanup/*` server functions is
//! the real authorization boundary.
#![cfg(not(feature = "mobile"))]

use dioxus::prelude::*;
use dioxus_router::Link;
use omnibus_shared::{CleanupCounts, CleanupKind};

use crate::components::{BusyLabel, Loading, LoadingKind};
use crate::data::{self, server_error_message};
use crate::{use_server_url, Route};

/// The Cleanup section of `/admin`: one row per cleanup kind with its pending
/// count and a Review link, plus "Run detection now".
#[component]
pub fn CleanupSection() -> Element {
    let is_admin = crate::use_is_admin();
    let server_url = use_server_url();

    let counts = use_signal(|| None::<Vec<(CleanupKind, CleanupCounts)>>);
    let error = use_signal(|| false);
    let status = use_signal(|| None::<String>);
    let status_is_error = use_signal(|| false);
    let in_flight = use_signal(|| false);
    // Bumped after a detection pass is queued so the counts effect re-runs.
    let generation = use_signal(|| 0u32);

    spawn_counts_fetch(is_admin, server_url.clone(), counts, error, generation);
    let on_detect = detect_handler(server_url, status, status_is_error, in_flight, generation);
    let busy = in_flight();

    rsx! {
        section { class: "card", "data-testid": "cleanup-card",
            h3 { "Suggested fixes" }
            p { class: "subtitle",
                "Near-duplicate authors, series, and tags, plus book titles carrying filename cruft."
            }
            if is_admin() {
                CleanupCountsList { counts, error, generation }
                div { class: "cleanup-actions",
                    button {
                        class: "btn",
                        "data-testid": "cleanup-detect",
                        disabled: busy,
                        "aria-busy": if busy { "true" } else { "false" },
                        onclick: move |_| on_detect(()),
                        BusyLabel { busy, label: "Run detection now", busy_label: "Starting\u{2026}" }
                    }
                }
                if let Some(message) = status() {
                    p {
                        class: if status_is_error() { "settings-status error" } else { "settings-status" },
                        role: "status",
                        "data-testid": "cleanup-detect-status",
                        "{message}"
                    }
                }
            } else {
                p { class: "settings-status error", "data-testid": "cleanup-forbidden",
                    "Administrator access is required to run library cleanup."
                }
            }
        }
    }
}

/// Refresh the per-kind counts once the visitor is known to be an admin, and
/// again whenever `generation` moves.
fn spawn_counts_fetch(
    is_admin: ReadSignal<bool>,
    server_url: String,
    mut counts: Signal<Option<Vec<(CleanupKind, CleanupCounts)>>>,
    mut error: Signal<bool>,
    generation: Signal<u32>,
) {
    use_effect(move || {
        // Both reads happen inside the effect so it re-subscribes to each: the
        // generation so a queued detection pass refreshes the counts, and
        // `is_admin` so the fetch waits for `CurrentUser` to resolve instead of
        // 403ing against the admin-gated route on the first paint.
        let _ = generation();
        if !is_admin() {
            return;
        }
        let server_url = server_url.clone();
        error.set(false);
        spawn(async move {
            match data::get_cleanup_counts(&server_url).await {
                Ok(loaded) => counts.set(Some(loaded)),
                Err(_) => error.set(true),
            }
        });
    });
}

/// Build the "Run detection now" click handler: queue a full detection pass,
/// report the outcome, and bump the counts generation.
fn detect_handler(
    server_url: String,
    status: Signal<Option<String>>,
    status_is_error: Signal<bool>,
    in_flight: Signal<bool>,
    generation: Signal<u32>,
) -> impl Fn(()) {
    move |()| {
        // `Signal` is `Copy`; re-binding here keeps the closure `Fn` (a
        // click handler is called by shared reference) while still writing.
        let (mut status, mut status_is_error, mut in_flight, mut generation) =
            (status, status_is_error, in_flight, generation);
        if in_flight() {
            return;
        }
        let server_url = server_url.clone();
        in_flight.set(true);
        status.set(None);
        spawn(async move {
            match data::run_cleanup_detection(&server_url, None).await {
                Ok(_) => {
                    status.set(Some(
                        "Detection started. Counts update as it finishes.".to_string(),
                    ));
                    status_is_error.set(false);
                    generation.set(generation() + 1);
                }
                Err(e) => {
                    status.set(Some(format!(
                        "Couldn\u{2019}t start detection: {}",
                        server_error_message(&e)
                    )));
                    status_is_error.set(true);
                }
            }
            in_flight.set(false);
        });
    }
}

/// The counts region: loading / error / one row per kind.
#[component]
fn CleanupCountsList(
    counts: Signal<Option<Vec<(CleanupKind, CleanupCounts)>>>,
    error: Signal<bool>,
    mut generation: Signal<u32>,
) -> Element {
    if error() {
        return rsx! {
            div { class: "settings-actions",
                p { class: "settings-status error", role: "status", "data-testid": "cleanup-counts-error",
                    "Couldn\u{2019}t load the cleanup counts."
                }
                button {
                    r#type: "button",
                    class: "btn ghost",
                    "data-testid": "cleanup-counts-retry",
                    onclick: move |_| generation += 1,
                    "Try again"
                }
            }
        };
    }
    let Some(rows) = counts() else {
        return rsx! {
            Loading {
                kind: LoadingKind::Section,
                class: "start",
                testid: "cleanup-counts-loading",
                label: "Counting what needs tidying\u{2026}",
            }
        };
    };
    rsx! {
        ul { class: "cleanup-kinds", "data-testid": "cleanup-kinds",
            for (kind, count) in rows {
                CleanupKindRow { key: "{kind.as_str()}", kind, count }
            }
        }
    }
}

/// One kind's row: its label, its pending count, and the Review link.
#[component]
fn CleanupKindRow(kind: CleanupKind, count: CleanupCounts) -> Element {
    rsx! {
        li { class: "cleanup-kind-row", "data-testid": "cleanup-kind-{kind.as_str()}",
            span { class: "cleanup-kind-label", "{kind_label(kind)}" }
            span {
                class: "cleanup-kind-count",
                "data-testid": "cleanup-count-{kind.as_str()}",
                "{count.pending} pending"
            }
            Link {
                to: Route::CleanupReview { kind: kind.as_str().to_string() },
                class: "btn",
                "data-testid": "cleanup-review-{kind.as_str()}",
                "aria-label": "Review {kind_label(kind).to_lowercase()}",
                "Review"
            }
        }
    }
}

/// Human-readable name for a cleanup kind.
fn kind_label(kind: CleanupKind) -> &'static str {
    match kind {
        CleanupKind::Author => "Authors",
        CleanupKind::Series => "Series",
        CleanupKind::Tag => "Tags",
        CleanupKind::BookTitle => "Book titles",
    }
}

#[cfg(all(test, feature = "server"))]
mod tests {
    use omnibus_shared::{CleanupCounts, CleanupKind};

    use super::{kind_label, CleanupCountsList, CleanupKindRow};
    use crate::test_support::render_in_vdom;
    use dioxus::prelude::*;
    use dioxus_router::{Routable, Router};

    #[test]
    fn kind_label_names_every_cleanup_kind() {
        assert_eq!(kind_label(CleanupKind::Author), "Authors");
        assert_eq!(kind_label(CleanupKind::Series), "Series");
        assert_eq!(kind_label(CleanupKind::Tag), "Tags");
        assert_eq!(kind_label(CleanupKind::BookTitle), "Book titles");
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum RowRoute {
        #[route("/")]
        RowHost {},
    }

    // `CleanupKindRow` renders a router `Link`, which panics without a parent
    // router — so the row is mounted behind a one-route router.
    #[component]
    fn RowHost() -> Element {
        rsx! {
            CleanupKindRow {
                kind: CleanupKind::Tag,
                count: CleanupCounts { pending: 4, accepted: 1, rejected: 0 },
            }
        }
    }

    #[test]
    fn cleanup_kind_row_renders_the_label_pending_count_and_review_link() {
        let html = render_in_vdom(|| rsx! { Router::<RowRoute> {} });
        assert!(html.contains("Tags"));
        assert!(html.contains("4 pending"));
        assert!(html.contains("/admin/cleanup/tag"));
    }

    #[test]
    fn cleanup_kind_row_names_its_kind_in_the_review_link() {
        let html = render_in_vdom(|| rsx! { Router::<RowRoute> {} });
        assert!(html.contains(r#"aria-label="Review tags""#), "{html}");
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum FailedRoute {
        #[route("/")]
        FailedHost {},
    }

    #[component]
    fn FailedHost() -> Element {
        let counts = use_signal(|| None);
        let error = use_signal(|| true);
        let generation = use_signal(|| 0u32);
        rsx! { CleanupCountsList { counts, error, generation } }
    }

    #[test]
    fn cleanup_counts_list_offers_a_retry_after_a_failed_load() {
        let html = render_in_vdom(|| rsx! { Router::<FailedRoute> {} });
        assert!(html.contains("cleanup-counts-error"), "{html}");
        assert!(html.contains("cleanup-counts-retry"), "{html}");
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum LoadingRoute {
        #[route("/")]
        LoadingHost {},
    }

    #[component]
    fn LoadingHost() -> Element {
        let counts = use_signal(|| None);
        let error = use_signal(|| false);
        let generation = use_signal(|| 0u32);
        rsx! { CleanupCountsList { counts, error, generation } }
    }

    #[test]
    fn cleanup_counts_list_renders_the_loading_state_before_counts_arrive() {
        let html = render_in_vdom(|| rsx! { Router::<LoadingRoute> {} });
        assert!(html.contains("cleanup-counts-loading"));
    }
}
