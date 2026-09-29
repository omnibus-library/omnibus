//! Reader-picker logic tests: when the picker shows, whom a selection resolves to, and the page heading.

use super::*;

fn reader(id: i64, name: &str, is_you: bool) -> HouseholdReader {
    HouseholdReader {
        id,
        name: name.to_string(),
        has_avatar: false,
        is_you,
    }
}

#[test]
fn shows_picker_is_false_for_only_the_caller_or_an_empty_list_and_true_once_another_reader_shares()
{
    assert!(!shows_picker(&[]));
    assert!(!shows_picker(&[reader(1, "You", true)]));
    assert!(shows_picker(&[
        reader(1, "You", true),
        reader(2, "Alice", false)
    ]));
}

#[test]
fn viewing_resolves_no_selection_and_the_callers_own_id_to_you() {
    let readers = vec![reader(1, "You", true), reader(2, "Alice", false)];
    assert_eq!(viewing(None, &readers), Viewing::You);
    assert_eq!(viewing(Some(1), &readers), Viewing::You);
}

#[test]
fn viewing_names_a_listed_other_reader() {
    let readers = vec![reader(1, "You", true), reader(2, "Alice", false)];
    assert_eq!(
        viewing(Some(2), &readers),
        Viewing::Reader {
            name: "Alice".to_string()
        }
    );
}

#[test]
fn viewing_falls_back_to_another_reader_for_an_id_the_list_does_not_carry() {
    let readers = vec![reader(1, "You", true)];
    assert_eq!(
        viewing(Some(99), &readers),
        Viewing::Reader {
            name: "Another reader".to_string()
        }
    );
}

#[test]
fn heading_is_none_for_you_and_the_possessive_for_another_reader() {
    assert_eq!(Viewing::You.heading(), None);
    assert_eq!(
        Viewing::Reader {
            name: "Alice".to_string()
        }
        .heading(),
        Some("Alice's stats".to_string())
    );
}

// SSR render coverage. `ReaderPicker` renders a `dioxus_router::Link`, which
// panics without a live router (see `components::page_state`'s module
// comment), so each state gets a one-route host mounted through
// `dioxus_router::Router` rather than a bare `render`.
#[cfg(feature = "server")]
mod render_tests {
    use dioxus_router::{Routable, Router};

    use crate::test_support::render_in_vdom;

    use super::*;

    /// The `<tag ...>` opening `html` starts with, for asserting on an
    /// attribute (`hidden`, boolean or otherwise) that could render several
    /// ways depending on its value.
    fn opening_tag<'a>(html: &'a str, needle: &str) -> &'a str {
        let start = html.find(needle).expect("tag present");
        let end = html[start..].find('>').expect("tag closes") + start;
        &html[start..=end]
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum PickerRoute {
        #[route("/")]
        PickerHost {},
    }

    #[component]
    fn PickerHost() -> Element {
        let readers = vec![
            reader(1, "You", true),
            reader(2, "Alice", false),
            reader(3, "Bob", false),
        ];
        rsx! {
            ReaderPicker { readers, selected: Some(2) }
        }
    }

    #[test]
    fn reader_picker_lists_you_first_then_the_others_in_order_and_marks_the_selection() {
        let html = render_in_vdom(|| rsx! { Router::<PickerRoute> {} });
        assert!(html.contains("stats-reader-option-you"), "{html}");
        assert!(html.contains("stats-reader-option-2"), "{html}");
        assert!(html.contains("stats-reader-option-3"), "{html}");
        assert!(html.contains("aria-label=\"Stats for Alice\""), "{html}");
        assert!(html.contains("href=\"/stats\""), "{html}");
        assert!(html.contains("href=\"/stats?user=2\""), "{html}");
        assert!(html.contains("href=\"/stats?user=3\""), "{html}");
        assert!(html.matches("st-reader-avatar").count() >= 3, "{html}");
        // You is listed before Alice, which is listed before Bob.
        let you_pos = html.find("stats-reader-option-you").unwrap();
        let alice_pos = html.find("stats-reader-option-2").unwrap();
        let bob_pos = html.find("stats-reader-option-3").unwrap();
        assert!(you_pos < alice_pos && alice_pos < bob_pos, "{html}");
        // The menu starts closed.
        assert!(
            opening_tag(&html, "id=\"stats-reader-menu\"").contains("hidden"),
            "{html}"
        );
        // Only the selected reader's own option (Alice) carries aria-current.
        assert!(
            opening_tag(&html, "stats-reader-option-2").contains("aria-current=\"page\""),
            "{html}"
        );
        assert!(
            !opening_tag(&html, "stats-reader-option-you").contains("aria-current=\"page\""),
            "{html}"
        );
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum NoPickerRoute {
        #[route("/")]
        NoPickerHost {},
    }

    #[component]
    fn NoPickerHost() -> Element {
        let readers = vec![reader(1, "You", true)];
        rsx! {
            ReaderPicker { readers, selected: None }
        }
    }

    #[test]
    fn reader_picker_renders_nothing_when_no_one_else_shares() {
        let html = render_in_vdom(|| rsx! { Router::<NoPickerRoute> {} });
        assert!(!html.contains("stats-reader-picker"), "{html}");
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum YouRoute {
        #[route("/")]
        YouHost {},
    }

    #[component]
    fn YouHost() -> Element {
        let readers = vec![reader(1, "You", true), reader(2, "Alice", false)];
        rsx! {
            ReaderPicker { readers, selected: None }
        }
    }

    #[test]
    fn reader_picker_trigger_reads_stats_for_you_on_the_callers_own_page() {
        let html = render_in_vdom(|| rsx! { Router::<YouRoute> {} });
        assert!(html.contains("aria-label=\"Stats for You\""), "{html}");
    }
}
