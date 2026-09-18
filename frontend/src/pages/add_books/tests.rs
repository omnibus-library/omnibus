//! Tests for the add-books page: the extension routing every pick goes
//! through, the identity check the commit refuses on, the review baseline a
//! pick is staged with, and the SSR-rendered picker and not-authorized state.

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

#[test]
fn confirm_identity_trims_and_takes_the_first_author() {
    let (title, author) =
        confirm_identity("  Dune ", &names(&[" Frank Herbert ", "Brian Herbert"])).unwrap();
    assert_eq!(title, "Dune");
    assert_eq!(author, "Frank Herbert");
}

#[test]
fn confirm_identity_refuses_a_blank_title_or_an_empty_author_list() {
    assert!(confirm_identity("  ", &names(&["Frank Herbert"])).is_err());
    assert!(confirm_identity("Dune", &[]).is_err());
    assert!(confirm_identity("Dune", &names(&["   "])).is_err());
}

/// An audiobook picked after an EPUB must not inherit the EPUB's series
/// (#2254): the baseline is built from *this* inspection alone, and the
/// tags carry no series, so the fields start empty and the form is the only
/// place a series can be supplied.
#[test]
fn book_from_audiobook_starts_the_series_fields_empty() {
    let (book, preview) = book_from_audiobook(
        AudiobookInspection {
            title: Some("New Title".to_string()),
            author: Some("New Author".to_string()),
            creators: vec!["New Author".to_string()],
            cover_preview: Some("data:image/webp;base64,AA==".to_string()),
            ..Default::default()
        },
        "2 parts selected",
    );
    assert_eq!(book.title.as_deref(), Some("New Title"));
    assert_eq!(book.filename, "2 parts selected");
    assert!(book.series.is_none());
    assert!(book.series_index.is_none());
    assert_eq!(preview.as_deref(), Some("data:image/webp;base64,AA=="));
    assert!(
        book.cover_url.is_none(),
        "the preview travels apart from the book"
    );
}

/// A file naming several creators must not be shown as one (#2355): every
/// creator becomes an author chip, in file order.
#[test]
fn book_from_ebook_keeps_every_creator_as_an_author() {
    let (book, _) = book_from_ebook(
        UploadInspection {
            title: Some("Beta".to_string()),
            author: Some("Grace Hopper".to_string()),
            creators: vec![
                "Grace Hopper".to_string(),
                "Margaret Hamilton".to_string(),
                "Joan Clarke".to_string(),
            ],
            ..Default::default()
        },
        "beta.epub",
    );
    let authors: Vec<&str> = book.creators.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(
        authors,
        ["Grace Hopper", "Margaret Hamilton", "Joan Clarke"]
    );
    assert_eq!(book.filename, "beta.epub");
}

#[cfg(feature = "server")]
mod render {
    use super::*;

    fn empty_state() -> UploadState {
        UploadState {
            pick: use_signal(|| None),
            busy: use_signal(|| false),
            status: use_signal(|| None),
            status_is_error: use_signal(|| false),
            picks: use_signal(|| 0),
        }
    }

    /// The single picker takes every format and says so, with no type toggle
    /// to click first — the extension decides.
    #[test]
    fn file_drop_zone_offers_every_format_in_one_multi_select_picker() {
        #[component]
        fn Harness() -> Element {
            let state = empty_state();
            rsx! { FileDropZone { state, on_file: EventHandler::new(|_| {}) } }
        }

        let html = dioxus::ssr::render_element(rsx! { Harness {} });
        assert!(html.contains("accept=\".epub,.pdf,.m4b,.m4a,.mp4,.mp3,"));
        assert!(html.contains("multiple"));
        assert!(html.contains("data-testid=\"add-books-formats\""));
        assert!(!html.contains("add-books-type-"));
    }

    /// Once a pick is staged the drop zone names it and offers to change it.
    #[test]
    fn file_drop_zone_names_the_staged_pick() {
        #[component]
        fn Harness() -> Element {
            let state = UploadState {
                pick: use_signal(|| {
                    Some(StagedPick {
                        kind: UploadKind::Ebook,
                        label: "dune.epub".to_string(),
                        files: Vec::new(),
                        book: EbookMetadata::default(),
                        cover_preview: None,
                        generation: 1,
                    })
                }),
                ..empty_state()
            };
            rsx! { FileDropZone { state, on_file: EventHandler::new(|_| {}) } }
        }

        let html = dioxus::ssr::render_element(rsx! { Harness {} });
        assert!(html.contains("dune.epub"), "{html}");
        assert!(html.contains("Click to change"));
        assert!(html.contains("has-file"));
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
        assert!(!html.contains("me-save"));
    }
}
