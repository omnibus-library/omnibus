//! Tests for the palette results list's Settings group.

use super::super::model::build_flat_items;
use super::*;

#[test]
fn book_thumb_url_uses_uuid_not_id() {
    let book = PaletteBookHit {
        id: 99,
        uuid: "abc-def-uuid".to_string(),
        title: "Test Book".to_string(),
        ..PaletteBookHit::default()
    };
    // On the (non-mobile) test build the URL is relative — same-origin,
    // cookie-authed. Mobile prefixes the server base + `?token=`.
    let url = book_thumb_url("http://localhost:3000", &book);
    assert_eq!(url, "/api/thumbs/abc-def-uuid/sm");
    // Guard: the integer id must never appear in the thumb URL.
    assert!(
        !url.contains("99"),
        "thumb URL must not contain the numeric id"
    );
}

#[test]
fn build_flat_items_is_empty_when_results_are_none() {
    let items = build_flat_items(&None, &[]);
    assert!(items.is_empty());
}

#[test]
fn palette_row_year_suppresses_the_calibre_sentinel() {
    // `year` arrives pre-extracted as the four-digit string, so the
    // sentinel reaches the palette as "0101" rather than a full date.
    assert_eq!(palette_row_year(Some("0101")), "");
    assert_eq!(palette_row_year(Some("0101-01-01T00:00:00+00:00")), "");
    assert_eq!(palette_row_year(None), "");
}

#[test]
fn palette_row_year_keeps_a_real_year() {
    assert_eq!(palette_row_year(Some("2016")), "2016");
}

#[test]
fn settings_target_place_names_a_personal_section_under_settings() {
    let theme = crate::pages::matching_settings("theme", false)[0];
    assert_eq!(theme.target.place(), "Settings \u{203A} Preferences");
}

#[test]
fn settings_target_place_names_an_admin_section_under_administration() {
    let smtp = crate::pages::matching_settings("smtp", true)[0];
    assert_eq!(smtp.target.place(), "Administration \u{203A} Integrations");
}

#[cfg(feature = "server")]
mod render {
    use dioxus_router::{Routable, Router};

    use super::*;
    use crate::test_support::render_in_vdom;

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum Harness {
        #[route("/")]
        SettingsOnlyHost {},
    }

    /// The list as the palette draws it before the server has answered, with
    /// no results yet and one matching setting.
    #[component]
    fn SettingsOnlyHost() -> Element {
        let results = use_signal(|| None::<PaletteResults>);
        let settings = use_memo(|| crate::pages::matching_settings("kobo", false));
        let flat_items = use_memo(move || build_flat_items(&results.read(), &settings.read()));
        rsx! {
            SpResultsList {
                results,
                settings,
                flat_items,
                selected: use_signal(|| 0_usize),
                has_navigated: use_signal(|| false),
                open: PaletteOpen(use_signal(|| true)),
            }
        }
    }

    #[test]
    fn sp_results_list_shows_matching_settings_before_the_server_answers() {
        let html = render_in_vdom(|| rsx! { Router::<Harness> {} });

        assert!(html.contains("Settings · 1"), "{html}");
        assert_eq!(
            html.matches("data-testid=\"sp-setting-row\"").count(),
            1,
            "{html}"
        );
        assert!(html.contains("Kobo devices"), "{html}");
        assert!(html.contains("Settings \u{203A} Devices"), "{html}");
    }

    /// A book and an author with the highlight on the author, as the palette
    /// draws it after one ArrowDown.
    #[component]
    fn ResultsHost() -> Element {
        let results = use_signal(|| {
            Some(PaletteResults {
                books: vec![PaletteBookHit {
                    id: 1,
                    uuid: "book-uuid".into(),
                    title: "Dracula".into(),
                    ..PaletteBookHit::default()
                }],
                authors: vec![omnibus_shared::PaletteAuthorHit {
                    id: 7,
                    name: "Bram Stoker".into(),
                    book_count: 1,
                    ..Default::default()
                }],
                ..PaletteResults::default()
            })
        });
        let settings = use_memo(Vec::new);
        let flat_items = use_memo(move || build_flat_items(&results.read(), &settings.read()));
        rsx! {
            SpResultsList {
                results,
                settings,
                flat_items,
                selected: use_signal(|| 1_usize),
                has_navigated: use_signal(|| true),
                open: PaletteOpen(use_signal(|| true)),
            }
        }
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum ResultsRoute {
        #[route("/")]
        ResultsHost {},
    }

    #[test]
    fn sp_results_list_is_a_listbox_of_labelled_groups_of_options() {
        let html = render_in_vdom(|| rsx! { Router::<ResultsRoute> {} });

        assert!(html.contains("role=\"listbox\""), "{html}");
        assert!(html.contains("id=\"sp-listbox\""), "{html}");
        assert_eq!(html.matches("role=\"group\"").count(), 2, "{html}");
        assert!(
            html.contains("aria-labelledby=\"sp-group-books\""),
            "{html}"
        );
        assert!(html.contains("id=\"sp-group-books\""), "{html}");
        assert_eq!(html.matches("role=\"option\"").count(), 2, "{html}");
    }

    #[test]
    fn sp_results_list_gives_each_option_its_flat_index_id_and_marks_only_the_highlighted_one() {
        let html = render_in_vdom(|| rsx! { Router::<ResultsRoute> {} });

        assert!(html.contains("id=\"sp-option-0\""), "{html}");
        assert!(html.contains("id=\"sp-option-1\""), "{html}");
        assert_eq!(html.matches("aria-selected=\"true\"").count(), 1, "{html}");
        assert_eq!(html.matches("aria-selected=\"false\"").count(), 1, "{html}");
    }

    #[component]
    fn EmptyHost() -> Element {
        let results = use_signal(|| None::<PaletteResults>);
        let settings = use_memo(Vec::new);
        let flat_items = use_memo(move || build_flat_items(&results.read(), &settings.read()));
        rsx! {
            SpResultsList {
                results,
                settings,
                flat_items,
                selected: use_signal(|| 0_usize),
                has_navigated: use_signal(|| false),
                open: PaletteOpen(use_signal(|| true)),
            }
        }
    }

    #[derive(Clone, Debug, PartialEq, Routable)]
    enum EmptyRoute {
        #[route("/")]
        EmptyHost {},
    }

    #[test]
    fn sp_results_list_is_not_a_listbox_while_it_lists_nothing() {
        let html = render_in_vdom(|| rsx! { Router::<EmptyRoute> {} });

        assert!(!html.contains("role=\"listbox\""), "{html}");
        assert!(!html.contains("id=\"sp-listbox\""), "{html}");
    }
}
