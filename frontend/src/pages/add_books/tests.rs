//! Tests for the add-books page: the extension routing every pick goes
//! through, and the SSR-rendered confirm form and not-authorized state.

use super::*;

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|n| n.to_string()).collect()
}

#[test]
fn classify_pick_routes_one_epub_to_the_ebook_ingest() {
    assert_eq!(classify_pick(&names(&["Dune.epub"])), Ok(UploadKind::Ebook));
    assert_eq!(classify_pick(&names(&["DUNE.EPUB"])), Ok(UploadKind::Ebook));
}

#[test]
fn classify_pick_routes_every_audiobook_extension_to_the_audiobook_ingest() {
    for name in [
        "book.m4b",
        "book.m4a",
        "book.mp4",
        "part-01.mp3",
        "BOOK.M4B",
    ] {
        assert_eq!(
            classify_pick(&names(&[name])),
            Ok(UploadKind::Audiobook),
            "{name}"
        );
    }
    // A part set is one pick — the server groups it into one book.
    assert_eq!(
        classify_pick(&names(&["01.mp3", "02.mp3", "03.mp3"])),
        Ok(UploadKind::Audiobook)
    );
}

#[test]
fn classify_pick_refuses_a_mix_of_ebook_and_audiobook_files() {
    let err = classify_pick(&names(&["Dune.epub", "Dune.m4b"])).unwrap_err();
    assert!(err.contains("not both"), "{err}");
}

#[test]
fn classify_pick_refuses_more_than_one_epub() {
    let err = classify_pick(&names(&["a.epub", "b.epub"])).unwrap_err();
    assert!(err.contains("one EPUB"), "{err}");
}

#[test]
fn classify_pick_names_the_file_neither_ingest_takes() {
    for name in ["notes.txt", "comic.cbz", "song.flac", "noextension"] {
        let err = classify_pick(&names(&[name])).unwrap_err();
        assert!(err.starts_with(name), "{err}");
    }
    // One bad file spoils an otherwise valid pick — nothing is sent.
    let err = classify_pick(&names(&["01.mp3", "cover.jpg"])).unwrap_err();
    assert!(err.starts_with("cover.jpg"), "{err}");
}

#[test]
fn classify_pick_refuses_an_empty_pick() {
    assert!(classify_pick(&[]).is_err());
}

#[cfg(feature = "server")]
mod render {
    use super::*;

    /// An audiobook pick must not take the series fields away (#2254): the
    /// audiobook parser usually extracts nothing, so the confirm form is the
    /// only place a series can be supplied.
    #[test]
    fn confirm_form_renders_series_fields_for_an_audiobook_upload() {
        #[component]
        fn Harness(kind: UploadKind) -> Element {
            let state = UploadState {
                kind: use_signal(move || Some(kind)),
                filename: use_signal(String::new),
                file_bytes: use_signal(|| None),
                audio_files: use_signal(Vec::new),
                title: use_signal(String::new),
                author: use_signal(String::new),
                more_creators: use_signal(Vec::new),
                series: use_signal(String::new),
                series_index: use_signal(String::new),
                inspected: use_signal(|| true),
                busy: use_signal(|| false),
                status: use_signal(|| None),
                status_is_error: use_signal(|| false),
            };
            rsx! { ConfirmForm { state, on_submit: EventHandler::new(|_| {}) } }
        }

        for kind in [UploadKind::Audiobook, UploadKind::Ebook] {
            let html = dioxus::ssr::render_element(rsx! { Harness { kind } });
            assert!(html.contains("id=\"add-books-series\""));
            assert!(html.contains("id=\"add-books-series-index\""));
        }
    }

    /// A file naming several creators must not be shown as one (#2355): the
    /// creators after the first are listed under the Author field, and the
    /// line is absent when there are none.
    #[test]
    fn confirm_form_lists_the_creators_after_the_first_under_author() {
        #[component]
        fn Harness(more: Vec<String>) -> Element {
            let state = UploadState {
                kind: use_signal(|| Some(UploadKind::Ebook)),
                filename: use_signal(String::new),
                file_bytes: use_signal(|| None),
                audio_files: use_signal(Vec::new),
                title: use_signal(String::new),
                author: use_signal(|| "Grace Hopper".to_string()),
                more_creators: use_signal(move || more.clone()),
                series: use_signal(String::new),
                series_index: use_signal(String::new),
                inspected: use_signal(|| true),
                busy: use_signal(|| false),
                status: use_signal(|| None),
                status_is_error: use_signal(|| false),
            };
            rsx! { ConfirmForm { state, on_submit: EventHandler::new(|_| {}) } }
        }

        let two = dioxus::ssr::render_element(rsx! {
            Harness { more: vec!["Margaret Hamilton".to_string(), "Joan Clarke".to_string()] }
        });
        assert!(two.contains("data-testid=\"add-books-more-creators\""));
        assert!(two.contains("Also credited: Margaret Hamilton, Joan Clarke."));

        let one = dioxus::ssr::render_element(rsx! { Harness { more: Vec::<String>::new() } });
        assert!(!one.contains("add-books-more-creators"));
    }

    /// An audiobook picked after an EPUB must not inherit the EPUB's series:
    /// the type switch that used to reset the form is gone, so the audiobook
    /// pre-fill has to clear the fields the parser cannot supply.
    #[test]
    fn audiobook_prefill_clears_the_series_a_previous_pick_left_behind() {
        #[component]
        fn Harness() -> Element {
            let mut state = UploadState {
                kind: use_signal(|| Some(UploadKind::Ebook)),
                filename: use_signal(String::new),
                file_bytes: use_signal(|| None),
                audio_files: use_signal(Vec::new),
                title: use_signal(|| "Old Title".to_string()),
                author: use_signal(|| "Old Author".to_string()),
                more_creators: use_signal(|| vec!["Old Co-author".to_string()]),
                series: use_signal(|| "Old Series".to_string()),
                series_index: use_signal(|| "3".to_string()),
                inspected: use_signal(|| true),
                busy: use_signal(|| false),
                status: use_signal(|| None),
                status_is_error: use_signal(|| false),
            };
            prefill_from_audiobook(
                &mut state,
                AudiobookInspection {
                    title: Some("New Title".to_string()),
                    author: Some("New Author".to_string()),
                    creators: vec!["New Author".to_string()],
                    ..Default::default()
                },
            );
            rsx! { ConfirmForm { state, on_submit: EventHandler::new(|_| {}) } }
        }

        let html = dioxus::ssr::render_element(rsx! { Harness {} });
        assert!(html.contains("value=\"New Title\""));
        assert!(html.contains("value=\"New Author\""));
        assert!(!html.contains("Old Series"), "{html}");
        assert!(!html.contains("value=\"3\""), "{html}");
        assert!(!html.contains("Old Co-author"), "{html}");
    }

    /// The single picker takes every format and says so, with no type toggle
    /// to click first — the extension decides.
    #[test]
    fn file_drop_zone_offers_every_format_in_one_multi_select_picker() {
        #[component]
        fn Harness() -> Element {
            let state = UploadState {
                kind: use_signal(|| None),
                filename: use_signal(String::new),
                file_bytes: use_signal(|| None),
                audio_files: use_signal(Vec::new),
                title: use_signal(String::new),
                author: use_signal(String::new),
                more_creators: use_signal(Vec::new),
                series: use_signal(String::new),
                series_index: use_signal(String::new),
                inspected: use_signal(|| false),
                busy: use_signal(|| false),
                status: use_signal(|| None),
                status_is_error: use_signal(|| false),
            };
            rsx! { FileDropZone { state, on_file: EventHandler::new(|_| {}) } }
        }

        let html = dioxus::ssr::render_element(rsx! { Harness {} });
        assert!(html.contains("accept=\".epub,.m4b,.m4a,.mp4,.mp3,"));
        assert!(html.contains("multiple"));
        assert!(html.contains("data-testid=\"add-books-formats\""));
        assert!(!html.contains("add-books-type-"));
    }

    /// A user without `can_upload` sees the not-authorized state, not the
    /// upload form — the markup `AddBooksPage` returns via `AddBooksForbidden`
    /// when its `use_can_upload` gate is (the SSR/pre-hydration default) false.
    #[test]
    fn add_books_forbidden_renders_not_authorized_message_not_the_form() {
        let html = dioxus::ssr::render_element(rsx! { AddBooksForbidden {} });
        assert!(html.contains("data-testid=\"add-books-forbidden\""));
        assert!(html.contains("have permission to add books"));
        assert!(!html.contains("add-books-file-input"));
        assert!(!html.contains("add-books-submit"));
    }
}
