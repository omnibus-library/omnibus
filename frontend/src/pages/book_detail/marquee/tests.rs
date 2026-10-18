//! The running order is a cross-client contract. iOS pins the same six
//! sections in the same order (`detailStopsRunHomeToMoreInSixSections` in
//! `omnibus-ios/omnibusTests/`), so a reorder on this side has to fail this
//! build too — a guard on one client notices drift, it doesn't stop it.

use super::MARQUEE_SECTIONS;

#[test]
fn marquee_sections_run_home_to_more_in_six_sections() {
    let names: Vec<&str> = MARQUEE_SECTIONS.iter().map(|(_, name)| *name).collect();
    assert_eq!(
        names,
        [
            "Home",
            "Stats",
            "Highlights",
            "Journals",
            "The files",
            "More"
        ]
    );
}

#[test]
fn marquee_section_numbers_match_their_position() {
    // The `NN` is written out rather than derived from the index, and it is
    // rendered in two places (the dot rail and the section label). A reorder
    // that moved a row without renumbering it would leave both reading a
    // position the section no longer holds.
    for (i, (no, name)) in MARQUEE_SECTIONS.iter().enumerate() {
        assert_eq!(
            *no,
            format!("{:02}", i + 1),
            "{name} carries the wrong number for its position"
        );
    }
}

#[cfg(feature = "server")]
mod scroll_stops_toggle {
    use dioxus::prelude::*;

    use super::super::{ScrollStopsToggle, ScrollStopsView};
    use crate::test_support::render_in_vdom;

    #[component]
    fn PendingHost() -> Element {
        rsx! { ScrollStopsToggle { view: ScrollStopsView::default(), on_toggle: move |_| {} } }
    }

    #[component]
    fn OnHost() -> Element {
        let view = ScrollStopsView {
            on: true,
            ready: true,
            failed: false,
        };
        rsx! { ScrollStopsToggle { view, on_toggle: move |_| {} } }
    }

    #[component]
    fn FailedHost() -> Element {
        let view = ScrollStopsView {
            on: false,
            ready: true,
            failed: true,
        };
        rsx! { ScrollStopsToggle { view, on_toggle: move |_| {} } }
    }

    // Unknown is not off (rule 12): no pressed state either way, and the
    // switch waits at centre until `/me` answers.
    #[test]
    fn scroll_stops_toggle_claims_neither_reading_until_the_viewer_resolves() {
        let html = render_in_vdom(PendingHost);
        assert!(html.contains("data-testid=\"bdmq-mode-toggle\""), "{html}");
        assert!(html.contains("disabled"), "{html}");
        assert!(!html.contains("aria-pressed"), "{html}");
        assert!(html.contains("ld-toggle-unknown"), "{html}");
    }

    #[test]
    fn scroll_stops_toggle_is_pressed_while_the_page_snaps() {
        let html = render_in_vdom(OnHost);
        assert!(html.contains("Scroll stops"), "{html}");
        assert!(html.contains("aria-pressed=\"true\""), "{html}");
        assert!(!html.contains("disabled"), "{html}");
        assert!(!html.contains("ld-toggle-unknown"), "{html}");
    }

    #[test]
    fn scroll_stops_toggle_says_so_when_a_save_fails() {
        let html = render_in_vdom(FailedHost);
        assert!(html.contains("data-testid=\"bdmq-mode-error\""), "{html}");
        assert!(html.contains("role=\"alert\""), "{html}");
    }
}

// The rail is positioned over the panel's edge, so its box must be the dots'
// own: anything sharing it widens the box over the panel and takes its clicks.
#[cfg(feature = "server")]
#[test]
fn dot_rail_is_the_six_dots_alone() {
    let html = crate::test_support::render_in_vdom(super::DotRail);
    assert!(html.starts_with("<nav class=\"bdmq-dots\""), "{html}");
    assert!(html.ends_with("</nav>"), "{html}");
    assert_eq!(html.matches("<button").count(), 6, "{html}");
}
