//! SSR render-smoke coverage for `PdfReadPage` (the hydration-parity contract
//! of rule 07: effects never run on the server, so the loading state is what
//! both SSR and the first WASM paint must render) and the glue-event
//! dispatch in `apply_event`, driven without a live WebView. Needs the
//! `server` feature (`dioxus::ssr`).

use dioxus_router::{Routable, Router};

use super::interop::PdfEvent;
use super::*;
use crate::test_support::render_in_vdom;

// The page calls `use_navigator`, which panics without a parent router, so
// the test mounts it behind a one-route router at `/` — the comic pager's
// test pattern.
#[derive(Clone, Debug, PartialEq, Routable)]
enum PdfRoute {
    #[route("/")]
    PdfHost {},
}

#[component]
fn PdfHost() -> Element {
    rsx! {
        PdfReadPage { uuid: "some-uuid".to_string(), file_id: None, page: None }
    }
}

#[test]
fn pdf_read_page_renders_the_loading_state_and_every_control_before_the_glue_mounts() {
    let html = render_in_vdom(|| {
        rsx! {
            Router::<PdfRoute> {}
        }
    });
    // The stage, its host, and the chrome exist on SSR so the glue has
    // somewhere to mount and hydration adopts the same tree.
    for testid in [
        "pdf-loading",
        "pdf-back",
        "pdf-fit-width",
        "pdf-fit-height",
        "pdf-highlights",
        "pdf-bookmarks",
        "pdf-stage",
        "pdf-page-host",
        "pdf-prev",
        "pdf-next",
        "pdf-slider",
        "pdf-footer",
        "pdf-page-label",
    ] {
        assert!(
            html.contains(&format!("data-testid=\"{testid}\"")),
            "{testid}: {html}"
        );
    }
    assert!(html.contains("id=\"omnibus-pdf-page\""), "{html}");
    assert!(!html.contains("data-testid=\"pdf-error\""), "{html}");
    // No overlay is open on first paint.
    assert!(!html.contains("reader-highlights-drawer"), "{html}");
    assert!(!html.contains("reader-bookmarks-drawer"), "{html}");
    assert!(!html.contains("rd-selection-popover"), "{html}");
}

fn signals() -> PdfSignals {
    PdfSignals {
        meta: Signal::new(None),
        status: Signal::new(PdfStatus::Loading),
        page: Signal::new(0),
        count: Signal::new(0),
        fit: Signal::new(FitMode::Height),
        highlights: Signal::new(Vec::new()),
        selection: Signal::new(None),
        note_target: Signal::new(None),
        quote_target: Signal::new(None),
        show_highlights: Signal::new(false),
        show_bookmarks: Signal::new(false),
        last_saved: Signal::new(None),
        error: Signal::new(None),
        retry: Signal::new(0),
    }
}

#[test]
fn reset_document_state_clears_every_per_document_signal_but_keeps_fit_and_retry() {
    #[component]
    fn AssertReset() -> Element {
        let sigs = signals();
        let mut fit = sigs.fit;
        fit.set(FitMode::Width);
        let mut retry = sigs.retry;
        retry.set(2);
        apply_event(
            PdfEvent::Ready {
                json: r#"{"page":4,"pageCount":30}"#.into(),
            },
            "book-a",
            "",
            sigs,
        );
        let mut show_highlights = sigs.show_highlights;
        show_highlights.set(true);
        let mut error = sigs.error;
        error.set(Some("boom".into()));

        reset_document_state(sigs);

        assert_eq!(*sigs.status.read(), PdfStatus::Loading);
        assert_eq!(*sigs.page.read(), 0);
        assert_eq!(*sigs.count.read(), 0);
        assert!(sigs.last_saved.read().is_none());
        assert!(sigs.error.read().is_none());
        assert!(!*sigs.show_highlights.read());
        // A preference and the reload trigger itself survive the reset.
        assert_eq!(*sigs.fit.read(), FitMode::Width);
        assert_eq!(*sigs.retry.read(), 2);
        rsx! {}
    }
    VirtualDom::new(AssertReset).rebuild_in_place();
}

#[test]
fn apply_event_ready_lands_the_position_without_marking_it_unsaved() {
    #[component]
    fn AssertReady() -> Element {
        let sigs = signals();
        apply_event(
            PdfEvent::Ready {
                json: r#"{"page":4,"pageCount":30}"#.into(),
            },
            "book-a",
            "",
            sigs,
        );
        assert_eq!(*sigs.status.read(), PdfStatus::Ready);
        assert_eq!(*sigs.page.read(), 4);
        assert_eq!(*sigs.count.read(), 30);
        // The opening report is the resumed position, not a turn: it must
        // read as already saved so no echo POST follows.
        assert_eq!(*sigs.last_saved.read(), Some(4));
        rsx! {}
    }
    VirtualDom::new(AssertReady).rebuild_in_place();
}

#[test]
fn apply_event_page_moves_the_position_and_marks_it_for_saving() {
    #[component]
    fn AssertPage() -> Element {
        let sigs = signals();
        apply_event(
            PdfEvent::Ready {
                json: r#"{"page":0,"pageCount":8}"#.into(),
            },
            "book-a",
            "",
            sigs,
        );
        apply_event(
            PdfEvent::Page {
                json: r#"{"page":3,"pageCount":8}"#.into(),
            },
            "book-a",
            "",
            sigs,
        );
        assert_eq!(*sigs.page.read(), 3);
        assert_eq!(*sigs.last_saved.read(), Some(3));
        rsx! {}
    }
    VirtualDom::new(AssertPage).rebuild_in_place();
}

#[test]
fn apply_event_error_and_selection_events_drive_their_signals() {
    #[component]
    fn AssertOthers() -> Element {
        let sigs = signals();
        apply_event(
            PdfEvent::Error {
                message: "boom".into(),
            },
            "book-a",
            "",
            sigs,
        );
        assert_eq!(*sigs.status.read(), PdfStatus::Failed);
        assert_eq!(sigs.error.read().as_deref(), Some("boom"));

        apply_event(
            PdfEvent::Selection {
                json: r#"{"page":2,"quads":[[1,2,3,4,5,6,7,8]],"text":"hi","rect":{"x":1,"y":2,"width":3}}"#
                    .into(),
            },
            "book-a",
            "",
            sigs,
        );
        let sel = sigs.selection.read().clone().expect("selection set");
        assert_eq!(sel.page, 2);
        assert_eq!(sel.text, "hi");

        apply_event(PdfEvent::SelectionCleared, "book-a", "", sigs);
        assert!(sigs.selection.read().is_none());

        // A tap on an anchor the list doesn't hold opens nothing.
        apply_event(
            PdfEvent::HighlightTap {
                anchor: "pdf:2".into(),
            },
            "book-a",
            "",
            sigs,
        );
        assert!(!*sigs.show_highlights.read());
        let mut highlights = sigs.highlights;
        highlights.write().push(Highlight {
            id: 1,
            book_uuid: "book-a".into(),
            epub_cfi_range: Some("pdf:2".into()),
            color: HighlightColor::Amber,
            note: None,
            text: None,
            client_id: None,
            created_at: 0,
            created_at_iso: None,
            spine_index: None,
            chapter_title: None,
            percent_through_book: None,
        });
        apply_event(
            PdfEvent::HighlightTap {
                anchor: "pdf:2".into(),
            },
            "book-a",
            "",
            sigs,
        );
        assert!(*sigs.show_highlights.read());
        rsx! {}
    }
    VirtualDom::new(AssertOthers).rebuild_in_place();
}

#[test]
fn apply_event_ignores_a_malformed_position_payload() {
    #[component]
    fn AssertMalformed() -> Element {
        let sigs = signals();
        apply_event(
            PdfEvent::Page {
                json: "not json".into(),
            },
            "book-a",
            "",
            sigs,
        );
        assert_eq!(*sigs.page.read(), 0);
        assert_eq!(*sigs.count.read(), 0);
        assert!(sigs.last_saved.read().is_none());
        rsx! {}
    }
    VirtualDom::new(AssertMalformed).rebuild_in_place();
}
