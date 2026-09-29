use super::*;

#[test]
fn group_thousands_handles_short_and_negative_inputs() {
    assert_eq!(group_thousands(0), "0");
    assert_eq!(group_thousands(9), "9");
    assert_eq!(group_thousands(999), "999");
    assert_eq!(group_thousands(1000), "1,000");
    assert_eq!(group_thousands(1_234_567), "1,234,567");
    assert_eq!(group_thousands(-42), "-42");
}

#[test]
fn month_name_spells_the_month_the_window_label_reads_as_prose() {
    assert_eq!(month_name(1), "January");
    assert_eq!(month_name(8), "August");
    assert_eq!(month_name(12), "December");
}

#[test]
fn window_label_says_what_each_range_actually_covers() {
    // Every one is "to date": the current window is period-to-date, and a
    // label reading "August 2026" alone claims a whole month has been counted.
    assert_eq!(
        window_label(StatsRange::Month, "2026-08-14"),
        "August 2026 \u{00B7} month to date"
    );
    assert_eq!(
        window_label(StatsRange::Year, "2026-08-14"),
        "2026 \u{00B7} year to date"
    );
    assert_eq!(
        window_label(StatsRange::AllTime, "2026-08-14"),
        "Everything you have tracked"
    );
}

#[test]
fn window_label_names_the_week_by_its_own_monday() {
    // 2026-08-14 is a Friday; the week it belongs to opened on the 10th. The
    // week's own start, so the label holds whether or not the reader happened
    // to read on the Monday.
    assert_eq!(
        window_label(StatsRange::Week, "2026-08-14"),
        "Week of 10 Aug 2026 \u{00B7} to date"
    );
    // A Monday labels itself.
    assert_eq!(
        window_label(StatsRange::Week, "2026-08-10"),
        "Week of 10 Aug 2026 \u{00B7} to date"
    );
}

#[test]
fn window_label_falls_back_to_the_ranges_own_label_without_a_server_day() {
    // A server too old to send `as_of_day` leaves nothing to date the window
    // against — better the range's plain name than a date the client invented.
    assert_eq!(
        window_label(StatsRange::Month, ""),
        StatsRange::Month.label()
    );
    assert_eq!(
        window_label(StatsRange::Week, "not-a-day"),
        StatsRange::Week.label()
    );
}

#[test]
fn freshness_note_text_states_the_real_ttl_in_seconds() {
    assert_eq!(
        freshness_note_text(),
        format!("Stats are accurate to the last ~{STATS_TTL_SECS} seconds.")
    );
}

#[cfg(feature = "server")]
fn unanswered_window() -> Element {
    let period = use_signal(|| None::<StatsSummary>);
    let expanded = use_signal(|| None::<Metric>);
    rsx! { WindowContents { period, expanded } }
}

#[cfg(feature = "server")]
#[test]
fn window_contents_show_a_loader_in_the_plate_before_the_period_lands() {
    let html = crate::test_support::render_in_vdom(unanswered_window);
    assert!(html.contains("st-card-placeholder"), "{html}");
    assert!(html.contains("stats-window-loading"), "{html}");
}

#[test]
fn failure_from_data_error_maps_a_refusal_to_not_sharing() {
    assert_eq!(
        Failure::from(&DataError::Http {
            status: 404,
            body: String::new(),
        }),
        Failure::NotSharing
    );
    assert_eq!(
        Failure::from(&DataError::Other(
            "this reader isn't sharing their stats".to_string()
        )),
        Failure::NotSharing
    );
}

#[test]
fn failure_from_data_error_keeps_any_other_message_verbatim() {
    assert_eq!(
        Failure::from(&DataError::Other("boom".to_string())),
        Failure::Other("boom".to_string())
    );
}

#[cfg(feature = "server")]
#[test]
fn stats_empty_reports_third_person_for_another_reader_and_first_person_for_the_caller() {
    let theirs = crate::test_support::render(rsx! {
        StatsEmpty { who_name: Some("Alice".to_string()) }
    });
    assert!(
        theirs.contains("Alice hasn&#39;t tracked any reading yet."),
        "{theirs}"
    );

    let mine = crate::test_support::render(rsx! { StatsEmpty {} });
    assert!(
        mine.contains("Open a book or start an audiobook and your stats will begin to fill in."),
        "{mine}"
    );
}

// `StatsFailure` wraps `PageError`, which renders a `dioxus_router::Link` —
// needs a live router (see `components::page_state`'s module comment), so
// each state gets a one-route host mounted through `dioxus_router::Router`.
#[cfg(feature = "server")]
mod failure_render_tests {
    use dioxus_router::{Routable, Router};

    use crate::test_support::render_in_vdom;

    use super::*;

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum NotSharingRoute {
        #[route("/")]
        NotSharingHost {},
    }

    #[component]
    fn NotSharingHost() -> Element {
        rsx! {
            StatsFailure { failure: Failure::NotSharing, other: true }
        }
    }

    #[test]
    fn stats_failure_not_sharing_names_the_reason_and_returns_to_your_own_stats() {
        let html = render_in_vdom(|| rsx! { Router::<NotSharingRoute> {} });
        assert!(html.contains("role=\"alert\""), "{html}");
        assert!(
            html.contains("This reader isn&#39;t sharing their stats"),
            "{html}"
        );
        assert!(html.contains("href=\"/stats\""), "{html}");
        assert!(html.contains("Back to your stats"), "{html}");
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum OtherFailureOnAnotherReaderRoute {
        #[route("/")]
        OtherFailureOnAnotherReaderHost {},
    }

    #[component]
    fn OtherFailureOnAnotherReaderHost() -> Element {
        rsx! {
            StatsFailure { failure: Failure::Other("server error".to_string()), other: true }
        }
    }

    #[test]
    fn stats_failure_other_while_viewing_another_reader_returns_to_your_own_stats() {
        let html = render_in_vdom(|| rsx! { Router::<OtherFailureOnAnotherReaderRoute> {} });
        assert!(html.contains("server error"), "{html}");
        assert!(html.contains("href=\"/stats\""), "{html}");
        assert!(html.contains("Back to your stats"), "{html}");
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum OtherFailureOnOwnPageRoute {
        #[route("/")]
        OtherFailureOnOwnPageHost {},
    }

    #[component]
    fn OtherFailureOnOwnPageHost() -> Element {
        rsx! {
            StatsFailure { failure: Failure::Other("server error".to_string()), other: false }
        }
    }

    #[test]
    fn stats_failure_other_on_the_callers_own_page_keeps_back_to_library() {
        let html = render_in_vdom(|| rsx! { Router::<OtherFailureOnOwnPageRoute> {} });
        assert!(html.contains("server error"), "{html}");
        assert!(html.contains("href=\"/\""), "{html}");
        assert!(html.contains("Back to library"), "{html}");
    }
}
