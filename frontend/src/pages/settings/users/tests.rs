//! Tests for the Users settings section's date helpers: `fmt_date`
//! formatting known epochs in UTC and staying stable within a civil day,
//! and `civil_from_days` round-tripping the epoch.

use super::*;

#[test]
fn fmt_date_formats_known_epochs_utc() {
    assert_eq!(fmt_date(0), "Jan 1, 1970");
    // 2024-01-01T00:00:00Z
    assert_eq!(fmt_date(1_704_067_200), "Jan 1, 2024");
    // 2026-07-25T00:00:00Z
    assert_eq!(fmt_date(1_784_937_600), "Jul 25, 2026");
}

#[test]
fn fmt_date_is_stable_within_a_day() {
    // Any second within the civil day maps to the same date (SSR/hydration
    // must not disagree because of sub-day drift).
    assert_eq!(fmt_date(1_704_067_200), fmt_date(1_704_067_200 + 86_399));
}

#[test]
fn civil_from_days_round_trips_epoch() {
    assert_eq!(civil_from_days(0), (1970, 1, 1));
}

#[cfg(feature = "server")]
mod render {
    use dioxus::prelude::*;
    use dioxus_router::{Routable, Router};

    use super::super::UsersSection;
    use crate::test_support::render_in_vdom;

    // The section's modals navigate, so it mounts under a router.
    #[derive(Clone, Debug, PartialEq, Routable)]
    enum UsersRoute {
        #[route("/")]
        UsersHost {},
    }

    #[component]
    fn UsersHost() -> Element {
        rsx! { UsersSection {} }
    }

    #[test]
    fn users_section_first_paint_holds_skeleton_rows_rather_than_an_empty_table() {
        let html = render_in_vdom(|| rsx! { Router::<UsersRoute> {} });
        assert!(html.contains("users-loading"), "{html}");
        assert!(!html.contains("data-testid=\"users-table\""), "{html}");
    }
}
