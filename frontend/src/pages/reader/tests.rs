//! Tests for `derive_reader_display` (needs a Dioxus runtime for
//! `Signal::new`, the pattern in `frontend/src/pages/reader/prefs/tests.rs`)
//! and SSR render-smoke checks on `ReaderViewerStage`'s overlays.

use super::*;

#[test]
fn derive_reader_display_blanks_chapter_title_while_loading_and_restores_it_once_ready() {
    #[component]
    fn AssertDisplay() -> Element {
        let loc = Signal::new(RelocateData {
            chapter: 5,
            total_chapters: 94,
            chapter_title: "Chapter Five".to_string(),
            pct: 12,
            ..Default::default()
        });
        let book_meta: Signal<Option<omnibus_shared::EbookMetadata>> = Signal::new(None);

        let loading = derive_reader_display(loc, book_meta, ReaderStatus::Loading);
        assert_eq!(loading.chapter_title, "");
        assert_eq!(loading.title_sub, "");

        let ready = derive_reader_display(loc, book_meta, ReaderStatus::Ready);
        assert_eq!(ready.chapter_title, "Chapter Five");
        assert!(!ready.title_sub.is_empty());

        rsx! {}
    }
    VirtualDom::new(AssertDisplay).rebuild_in_place();
}

#[test]
fn reader_status_from_glue_maps_nav_error_to_a_non_blocking_nav_failed() {
    assert_eq!(ReaderStatus::from_glue("ready"), ReaderStatus::Ready);
    assert_eq!(ReaderStatus::from_glue("error"), ReaderStatus::Failed);
    assert_eq!(
        ReaderStatus::from_glue("nav-error"),
        ReaderStatus::NavFailed
    );
    assert_eq!(ReaderStatus::from_glue("loading"), ReaderStatus::Loading);
}

#[test]
fn reader_status_cleared_by_relocate_covers_a_pending_or_failed_jump_but_not_a_load_failure() {
    assert!(ReaderStatus::Loading.cleared_by_relocate());
    assert!(ReaderStatus::NavFailed.cleared_by_relocate());
    assert!(!ReaderStatus::Failed.cleared_by_relocate());
    assert!(!ReaderStatus::Ready.cleared_by_relocate());
}

// SSR render-smoke coverage of the error overlay — separate module because
// this needs the `server` feature (`dioxus::ssr`), while the pure
// `derive_reader_display` test above runs under any target.
#[cfg(all(test, feature = "server"))]
mod render_tests {
    use super::*;
    use crate::test_support::render;

    #[component]
    fn ViewerStageHarness(status: ReaderStatus) -> Element {
        rsx! {
            ReaderViewerStage {
                status,
                on_retry: EventHandler::new(|_| {}),
            }
        }
    }

    #[test]
    fn reader_viewer_stage_renders_a_retry_action_when_failed() {
        let html = render(rsx! { ViewerStageHarness { status: ReaderStatus::Failed } });
        assert!(html.contains("data-testid=\"reader-error\""));
        assert!(html.contains("data-testid=\"reader-retry\""));
        assert!(html.contains("Retry"));
    }

    #[test]
    fn reader_viewer_stage_covers_the_page_with_an_opaque_stage_loader_while_loading() {
        let html = render(rsx! { ViewerStageHarness { status: ReaderStatus::Loading } });
        assert!(html.contains("ld ld-stage rd-overlay"), "{html}");
        assert!(html.contains("data-testid=\"reader-loading\""), "{html}");
        assert!(html.contains("ld-riffle"), "{html}");
    }

    #[test]
    fn reader_viewer_stage_shows_a_nav_error_notice_without_a_blocking_overlay() {
        let html = render(rsx! { ViewerStageHarness { status: ReaderStatus::NavFailed } });
        assert!(html.contains("data-testid=\"reader-nav-error\""), "{html}");
        assert!(!html.contains("rd-overlay"), "{html}");
        assert!(!html.contains("reader-loading"), "{html}");
    }

    #[test]
    fn reader_viewer_stage_omits_the_error_overlay_when_ready() {
        let html = render(rsx! { ViewerStageHarness { status: ReaderStatus::Ready } });
        assert!(!html.contains("reader-error"));
        assert!(!html.contains("reader-retry"));
    }
}
