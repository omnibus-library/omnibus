//! Immersive PDF reader (`/pdf/:uuid?file_id&page`). PDF.js (vendored beside
//! epub.js) range-fetches `/api/ebooks/{uuid}/file` and rasterises one page
//! at a time into the stage — the comic pager's shape (`comic_reader.rs`),
//! with the epub reader's highlight, note, quote, and bookmark surfaces laid
//! over PDF.js's text layer. Position rides the Epub-format progress record
//! as a `pdf-page:N` anchor (`omnibus_shared::pdf_page_anchor`), highlights
//! as `pdf:{page}:{quads}` anchors (`omnibus_shared::PdfAnchor`), so the
//! saved-passages card, the Continue stack, and iOS's PDFKit reader all read
//! the same rows.
//!
//! Chrome compiles identically on every target (rule 07); the JS interop is
//! post-mount only and runs on web + mobile through the `dioxus.send` event
//! channel (`interop.rs`).

// SSR never mounts the glue: the bootstrap, event dispatch, and asset URLs
// are reached only on the interactive targets (and from the tests), so the
// server build sees them unused.
#![cfg_attr(not(any(feature = "web", feature = "mobile")), allow(dead_code))]

mod highlights;
mod interop;
#[cfg(all(test, feature = "server"))]
mod tests;

use dioxus::prelude::*;
use dioxus_router::use_navigator;
use omnibus_shared::{
    parse_pdf_page_anchor, pdf_page_anchor, EbookMetadata, Highlight, HighlightColor,
    ProgressFormat, ProgressUpdate,
};

use super::comic_reader::{FitButton, FitMode};
use super::reader::highlights::{
    spawn_create_highlight, HighlightTargets, NewHighlight, PostCreate,
};
use super::reader::highlights_drawer::HighlightsDrawer;
use super::reader::note_composer::NoteComposer;
use super::reader::quote_panel::QuotePanel;
use super::reader::reader_bookmarks::ReaderBookmarksDrawer;
use super::reader::selection::{SelectionActions, SelectionAnchor, SelectionPopover};
use crate::{data, media_url, use_server_url, Route};
use highlights::{paint_all, pdf_bridge, PdfSelection};

const PDFJS_MJS: Asset = asset!("/assets/vendor/pdf.min.mjs");
const PDFJS_WORKER_MJS: Asset = asset!("/assets/vendor/pdf.worker.min.mjs");
const PDF_GLUE_JS: Asset = asset!("/assets/vendor/pdf-reader-glue.js");
// A folder, not per-file assets: the worker builds `${wasmUrl}openjpeg.wasm`
// itself, so the decoders must keep their names under one bundled directory.
const PDFJS_WASM_DIR: Asset = asset!("/assets/vendor/pdfjs-wasm", AssetOptions::folder());

/// The element the glue renders the canvas + text layer into.
const HOST_ID: &str = "omnibus-pdf-page";

/// Load state of the document. `Loading` is the SSR / first-paint seed
/// (rule 07); the glue's ready/error events move it on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
enum PdfStatus {
    #[default]
    Loading,
    Ready,
    Failed,
}

/// Whole-book percent for a 0-based `page` of `count` — the cross-surface
/// half of the saved position (the landing hero's bar, Kobo's percent-only
/// sync). Last page reads as 100. Same arithmetic as the comic pager.
fn pdf_percent(page: usize, count: usize) -> i64 {
    if count == 0 {
        return 0;
    }
    (((page + 1) * 100) as f64 / count as f64).round() as i64
}

/// The 0-based page a `?page=` deep link names. The URL is 1-based — it is
/// what a reader sees and types — so `?page=1` is the first page; zero,
/// negative, and unparseable values fall back to resume.
fn deep_link_page(page: Option<i64>) -> Option<usize> {
    page.filter(|p| *p >= 1).map(|p| (p - 1) as usize)
}

/// The 0-based page the reader opens on: a `?page=` deep link (the
/// saved-passages "open in book" link — the whole point of the link is to
/// land *there*), else the exact [`pdf_page_anchor`] of the saved record,
/// else the inverse of [`pdf_percent`], else page 0. Clamped against `count`
/// when it is known; the glue clamps again against PDF.js's own page count.
fn start_page(
    deep_link: Option<usize>,
    anchor: Option<&str>,
    percent: Option<i64>,
    count: usize,
) -> usize {
    let clamp = |page: usize| {
        if count == 0 {
            page
        } else {
            page.min(count - 1)
        }
    };
    if let Some(page) = deep_link {
        return clamp(page);
    }
    if let Some(page) = anchor.and_then(parse_pdf_page_anchor) {
        return clamp(page);
    }
    if let (Some(pct), true) = (percent, count > 0) {
        let approx = (pct.clamp(0, 100) as f64 / 100.0 * count as f64).round() as usize;
        return approx.saturating_sub(1).min(count - 1);
    }
    0
}

/// Build the progress-save payload for landing on `page` of `count` pages —
/// one place for the field list so it can't drift from [`pdf_percent`] /
/// [`pdf_page_anchor`]. `book_file_id` stays `None` like the comic pager:
/// the anchor is per book, and the server's PDF resolution goes by format.
fn progress_update_for_page(uuid: &str, page: usize, count: usize) -> ProgressUpdate {
    ProgressUpdate {
        book_uuid: uuid.to_string(),
        format: ProgressFormat::Epub,
        epub_cfi: Some(pdf_page_anchor(page)),
        audio_position_seconds: None,
        progress_percent: Some(pdf_percent(page, count)),
        kobo_location: None,
        book_file_id: None,
        client_updated_at: None,
    }
}

/// The document URL PDF.js range-fetches: the shared file route, narrowed to
/// one `book_files` row when the file picker named it (a mixed EPUB+PDF book
/// serves its EPUB from the bare route).
fn file_url(server_url: &str, uuid: &str, file_id: Option<i64>) -> String {
    let base = media_url(server_url, &format!("/api/ebooks/{uuid}/file"));
    with_file_id(&base, file_id)
}

/// Append `?file_id=` / `&file_id=` to an already-built media URL. The
/// mobile [`media_url`] carries the bearer token as its own `?token=` query,
/// so the file id has to join that query rather than open a second one —
/// `/file?file_id=N?token=…` is a token the server can't parse (a 401).
fn with_file_id(base: &str, file_id: Option<i64>) -> String {
    match file_id {
        Some(id) => {
            let sep = if base.contains('?') { '&' } else { '?' };
            format!("{base}{sep}file_id={id}")
        }
        None => base.to_string(),
    }
}

/// The glue's name for a [`FitMode`].
fn fit_name(fit: FitMode) -> &'static str {
    match fit {
        FitMode::Width => "width",
        FitMode::Height => "height",
    }
}

/// Every signal `PdfReadPage` owns, passed as one `Copy` bundle to the hooks
/// and sub-components (`PartialEq` so it can ride a component prop).
#[derive(Clone, Copy, PartialEq)]
struct PdfSignals {
    meta: Signal<Option<EbookMetadata>>,
    status: Signal<PdfStatus>,
    /// 0-based page showing.
    page: Signal<usize>,
    /// PDF.js's page count once the document opened; 0 until then.
    count: Signal<usize>,
    fit: Signal<FitMode>,
    highlights: Signal<Vec<Highlight>>,
    selection: Signal<Option<PdfSelection>>,
    note_target: Signal<Option<Highlight>>,
    quote_target: Signal<Option<Highlight>>,
    show_highlights: Signal<bool>,
    show_bookmarks: Signal<bool>,
    /// The last page whose position was POSTed, so an echo (the ready report,
    /// a fit re-render) never re-stamps an unmoved position.
    last_saved: Signal<Option<usize>>,
    /// The glue's reason for a `Failed` status, shown under the retry
    /// action so a load failure is diagnosable from the page.
    error: Signal<Option<String>>,
    /// Bumped by the error overlay's Retry: the bootstrap effect reads it,
    /// so a retry re-runs the whole path — the metadata/position fetch, the
    /// glue load, and the mount — not just the glue's own re-init, which
    /// can't recover a fetch failure or a glue that never loaded.
    retry: Signal<u32>,
}

/// Resolve a PDF's metadata and saved position for the bootstrap:
/// `get_ebook`, then (when found) `get_progress` to pick the starting page via
/// [`start_page`]. `None` on a missing book or a fetch failure — the caller
/// turns that into the error state.
async fn fetch_bootstrap(
    server_url: &str,
    uuid: &str,
    deep_link: Option<usize>,
) -> Option<(EbookMetadata, usize)> {
    let book = match data::get_ebook(server_url, uuid).await {
        Ok(Some(book)) => book,
        Ok(None) | Err(_) => return None,
    };
    let count = book.page_count.unwrap_or(0).max(0) as usize;
    let saved = data::get_progress(server_url, uuid, ProgressFormat::Epub)
        .await
        .ok()
        .flatten();
    let start = start_page(
        deep_link,
        saved.as_ref().and_then(|r| r.epub_cfi.as_deref()),
        saved.as_ref().and_then(|r| r.progress_percent),
        count,
    );
    Some((book, start))
}

/// Persist `page` as the reading position unless it is the page already
/// on record. Best-effort, like the comic pager's turn save: a failed write
/// must not interrupt reading, and the next turn retries.
fn persist_position(uuid: &str, server_url: &str, page: usize, sigs: PdfSignals) {
    let mut last_saved = sigs.last_saved;
    if *last_saved.peek() == Some(page) {
        return;
    }
    let count = *sigs.count.peek();
    if count == 0 {
        return;
    }
    last_saved.set(Some(page));
    let update = progress_update_for_page(uuid, page, count);
    let server_url = server_url.to_string();
    spawn(async move {
        let _ = data::save_progress(&server_url, update).await;
    });
}

/// Apply one glue event to the signals. Split out of the drain closure so the
/// dispatch is a plain function the tests can drive without a live WebView.
fn apply_event(event: interop::PdfEvent, uuid: &str, server_url: &str, sigs: PdfSignals) {
    use interop::{PdfEvent, PdfPosition};
    let PdfSignals {
        mut status,
        mut page,
        mut count,
        mut selection,
        mut show_highlights,
        highlights,
        mut last_saved,
        mut error,
        ..
    } = sigs;
    match event {
        PdfEvent::Ready { json } => {
            if let Ok(pos) = serde_json::from_str::<PdfPosition>(&json) {
                count.set(pos.page_count);
                page.set(pos.page);
                // The opening report restates the position we resumed at —
                // record it as already saved so it never POSTs an echo.
                last_saved.set(Some(pos.page));
            }
            status.set(PdfStatus::Ready);
            // The paint effect may have run before the glue was resident;
            // push the list again now that it can be drawn.
            paint_all(&highlights.peek());
        }
        PdfEvent::Page { json } => {
            if let Ok(pos) = serde_json::from_str::<PdfPosition>(&json) {
                count.set(pos.page_count);
                page.set(pos.page);
                persist_position(uuid, server_url, pos.page, sigs);
            }
        }
        PdfEvent::Error { message } => {
            error.set(Some(message));
            status.set(PdfStatus::Failed);
        }
        PdfEvent::Selection { json } => {
            if let Ok(sel) = serde_json::from_str::<PdfSelection>(&json) {
                selection.set(Some(sel));
            }
        }
        PdfEvent::SelectionCleared => selection.set(None),
        // A tap on a painted highlight opens the drawer, where the row
        // carries its note, quote, recolor, and delete actions — only for an
        // anchor the list actually holds, so a stale paint can't open an
        // empty drawer.
        PdfEvent::HighlightTap { anchor } => {
            let known = highlights
                .peek()
                .iter()
                .any(|h| h.epub_cfi_range.as_deref() == Some(anchor.as_str()));
            if known {
                show_highlights.set(true);
            }
        }
    }
}

/// Metadata + saved-position bootstrap, the glue mount, the highlight load,
/// and the event drain — post-mount only (rule 07: SSR and the first WASM
/// paint both render the loading state). Every hook is declared on every
/// target so the hook order never diverges between SSR and the client; only
/// the effect body that talks to the WebView is gated.
///
/// `use_reactive!` re-runs this whenever the route params change on an
/// already-mounted instance — the router reuses the page across a same-route
/// param swap rather than remounting it (#1612) — and again on Retry (the
/// `retry` signal read inside). The retained task is cancelled first so the
/// previous document's drain can't land events on the new one, and every
/// per-document signal is reset so the previous title, annotations, and open
/// drawers never show over the next document.
fn use_pdf_bootstrap(
    uuid: String,
    file_id: Option<i64>,
    deep_link: Option<usize>,
    server_url: String,
    sigs: PdfSignals,
) {
    use dioxus::core::Task;

    let mut task = use_signal(|| None::<Task>);
    use_effect(use_reactive!(|uuid, file_id, deep_link| {
        // Subscribes this effect to Retry.
        let _attempt = *sigs.retry.read();
        if let Some(prev) = task.write().take() {
            prev.cancel();
        }
        reset_document_state(sigs);
        #[cfg(any(feature = "web", feature = "mobile"))]
        {
            let server_url = server_url.clone();
            let uuid = uuid.clone();
            task.set(Some(spawn(bootstrap_and_drain(
                uuid, file_id, deep_link, server_url, sigs,
            ))));
        }
        #[cfg(not(any(feature = "web", feature = "mobile")))]
        let _ = (&uuid, &file_id, &deep_link, &server_url);
    }));

    use_drop(move || {
        if let Some(prev) = task.write().take() {
            prev.cancel();
        }
        interop::pdf_call("destroy", "");
    });
}

/// Put every per-document signal back to its first-paint value before a
/// (re)load: status, error, position, the highlight list, the selection, and
/// every overlay. `fit` and `retry` survive — one is a preference, the other
/// is what triggered the reload.
fn reset_document_state(sigs: PdfSignals) {
    let PdfSignals {
        mut meta,
        mut status,
        mut page,
        mut count,
        mut highlights,
        mut selection,
        mut note_target,
        mut quote_target,
        mut show_highlights,
        mut show_bookmarks,
        mut last_saved,
        mut error,
        ..
    } = sigs;
    status.set(PdfStatus::Loading);
    error.set(None);
    meta.set(None);
    page.set(0);
    count.set(0);
    highlights.set(Vec::new());
    selection.set(None);
    note_target.set(None);
    quote_target.set(None);
    show_highlights.set(false);
    show_bookmarks.set(false);
    last_saved.set(None);
}

/// The interactive-target body of [`use_pdf_bootstrap`]: fetch metadata +
/// position, mount the glue, load the highlights, then drain glue events
/// until the task is cancelled.
#[cfg(any(feature = "web", feature = "mobile"))]
async fn bootstrap_and_drain(
    uuid: String,
    file_id: Option<i64>,
    deep_link: Option<usize>,
    server_url: String,
    sigs: PdfSignals,
) {
    let PdfSignals {
        mut meta,
        mut status,
        mut page,
        mut highlights,
        ..
    } = sigs;
    let Some((book, start)) = fetch_bootstrap(&server_url, &uuid, deep_link).await else {
        status.set(PdfStatus::Failed);
        return;
    };
    // The restore lands in `page` before the glue paints so the slider and
    // label never flash page 1.
    page.set(start);
    meta.set(Some(book));
    let eval = interop::install_pdf_surface(
        HOST_ID,
        &interop::MountOptions {
            url: file_url(&server_url, &uuid, file_id),
            start_page: start,
            fit: fit_name(*sigs.fit.peek()),
        },
        &interop::PdfScripts {
            glue: PDF_GLUE_JS.to_string(),
            pdfjs: PDFJS_MJS.to_string(),
            worker: PDFJS_WORKER_MJS.to_string(),
            wasm_dir: PDFJS_WASM_DIR.to_string(),
        },
    );
    if let Ok(list) = data::list_highlights(&server_url, &uuid).await {
        highlights.set(list);
    }
    crate::js_interop::drain_events(eval, move |event: interop::PdfEvent| {
        apply_event(event, &uuid, &server_url, sigs);
    })
    .await;
}

/// Pre-derived chrome values for one paint (the `PagerDisplay` pattern in
/// `comic_reader.rs`).
struct PdfDisplay {
    title: String,
    author: String,
    accent: String,
}

impl PdfDisplay {
    fn from_meta(meta: Option<&EbookMetadata>) -> Self {
        Self {
            title: meta.map(|m| m.display_title()).unwrap_or_default(),
            author: meta
                .and_then(|m| m.creators.first().map(|c| c.name.clone()))
                .unwrap_or_default(),
            // Same fallback the epub reader uses when a book carries no accent.
            accent: meta
                .and_then(|m| m.accent.clone())
                .unwrap_or_else(|| "#3a3027".to_string()),
        }
    }
}

/// The full-page PDF reader: top bar (back, title, highlight/bookmark tools,
/// fit modes), the PDF.js stage with edge page-turn buttons, a footer slider
/// + page label, and the annotation overlays. Over the line cap by design,
/// for the comic pager's reason: the hooks (session tracking, auto
/// read-status, bootstrap, the paint and fit effects) must run
/// unconditionally before the declarative tree.
#[component]
pub fn PdfReadPage(uuid: String, file_id: Option<i64>, page: Option<i64>) -> Element {
    let server_url = use_server_url();
    let nav = use_navigator();
    let sigs = PdfSignals {
        meta: use_signal(|| None),
        status: use_signal(PdfStatus::default),
        page: use_signal(|| 0),
        count: use_signal(|| 0),
        fit: use_signal(|| FitMode::Height),
        highlights: use_signal(Vec::new),
        selection: use_signal(|| None),
        note_target: use_signal(|| None),
        quote_target: use_signal(|| None),
        show_highlights: use_signal(|| false),
        show_bookmarks: use_signal(|| false),
        last_saved: use_signal(|| None),
        error: use_signal(|| None),
        retry: use_signal(|| 0),
    };
    let PdfSignals {
        meta,
        status,
        page: page_sig,
        count,
        fit,
        highlights,
        selection,
        note_target,
        quote_target,
        show_highlights,
        show_bookmarks,
        ..
    } = sigs;

    // Record reading time against this PDF while the reader is open (and,
    // on web, the tab visible) — the rows behind the `/stats` aggregates,
    // exactly as the EPUB reader and comic pager do. Effect-only.
    crate::session_tracker::use_reading_session(uuid.clone(), server_url.clone());

    // Auto read-status: opening an `Unread` PDF marks it `Reading`, landing
    // on the last page marks it `Finished` (never a downgrade). Effect-only.
    let at_end = use_memo(move || {
        let count = count();
        count > 0 && page_sig() + 1 == count
    });
    crate::read_status_auto::use_auto_read_status(uuid.clone(), server_url.clone(), at_end);

    use_pdf_bootstrap(
        uuid.clone(),
        file_id,
        deep_link_page(page),
        server_url.clone(),
        sigs,
    );

    // Painting is list-driven: every change to the highlights (create,
    // recolor, delete, the initial load) pushes the whole set, and the glue
    // repaints the ones on the current page after each render.
    use_effect(move || {
        let list = highlights.read().clone();
        paint_all(&list);
    });

    // Fit changes re-render the current page in place; the initial value
    // also rides `init()`, so the first run is a harmless echo.
    use_effect(move || {
        interop::pdf_call_json("setFit", fit_name(*fit.read()));
    });

    // Shared page-turn entry point: clamp, persist, render. Every control
    // (buttons, slider, arrow keys) funnels through here so a position is
    // never shown without being saved.
    let goto = {
        let uuid = uuid.clone();
        let server_url = server_url.clone();
        use_callback(move |target: usize| {
            let count = *count.peek();
            if count == 0 {
                return;
            }
            let clamped = target.min(count - 1);
            if clamped == *page_sig.peek() {
                return;
            }
            let mut page_sig = page_sig;
            page_sig.set(clamped);
            let mut selection = selection;
            selection.set(None);
            persist_position(&uuid, &server_url, clamped, sigs);
            interop::go_to(clamped);
        })
    };

    let close_overlays = move || {
        let mut a = show_highlights;
        a.set(false);
        let mut b = show_bookmarks;
        b.set(false);
        let mut c = note_target;
        c.set(None);
        let mut d = quote_target;
        d.set(None);
        let mut e = selection;
        e.set(None);
        interop::pdf_call("clearSelection", "");
    };

    let back_uuid = uuid.clone();
    let on_back = move |_| {
        if nav.can_go_back() {
            nav.go_back();
        } else {
            let _ = nav.push(Route::BookDetail {
                uuid: back_uuid.clone(),
            });
        }
    };

    let current = page_sig();
    let total = count();
    let display = PdfDisplay::from_meta(meta.read().as_ref());
    let PdfDisplay {
        title,
        author,
        accent,
    } = display;
    let status_now = status();
    let error_detail = sigs.error.read().clone().unwrap_or_default();
    let pct = pdf_percent(current, total);

    rsx! {
        {quote_card_script()}
        div {
            class: "cr-root pr-root",
            tabindex: "0",
            autofocus: true,
            onkeydown: move |evt: KeyboardEvent| match evt.key() {
                Key::ArrowRight => goto.call(current + 1),
                Key::ArrowLeft if current > 0 => goto.call(current - 1),
                Key::Escape => close_overlays(),
                _ => {}
            },
            PdfTopBar {
                title: title.clone(),
                author,
                fit,
                highlight_count: highlights.read().len(),
                show_highlights,
                show_bookmarks,
                on_back,
            }
            div { class: "{fit.read().stage_class()} pr-stage", "data-testid": "pdf-stage",
                button {
                    class: "cr-nav cr-nav-prev",
                    "data-testid": "pdf-prev",
                    aria_label: "Previous page",
                    disabled: current == 0 || status_now != PdfStatus::Ready,
                    onclick: move |_| {
                        if current > 0 {
                            goto.call(current - 1);
                        }
                    },
                    "‹"
                }
                // PDF.js renders the canvas, highlight layer, and text layer
                // inside this host; it is empty on SSR and the first paint.
                div { id: HOST_ID, class: "pr-host", "data-testid": "pdf-page-host" }
                button {
                    class: "cr-nav cr-nav-next",
                    "data-testid": "pdf-next",
                    aria_label: "Next page",
                    disabled: total == 0 || current + 1 >= total,
                    onclick: move |_| goto.call(current + 1),
                    "›"
                }
                match status_now {
                    PdfStatus::Loading => rsx! {
                        div { class: "cr-state pr-overlay", "data-testid": "pdf-loading", "Loading PDF…" }
                    },
                    PdfStatus::Failed => rsx! {
                        div { class: "cr-state pr-overlay", "data-testid": "pdf-error", role: "alert",
                            p { "This PDF could not be opened." }
                            if !error_detail.is_empty() {
                                p { class: "pr-error-detail", "data-testid": "pdf-error-detail", "{error_detail}" }
                            }
                            button {
                                r#type: "button",
                                class: "btn sm",
                                "data-testid": "pdf-retry",
                                // Bumping `retry` re-runs the whole bootstrap
                                // (fetch, glue load, mount) — see
                                // `use_pdf_bootstrap`.
                                onclick: move |_| {
                                    let mut retry = sigs.retry;
                                    retry += 1;
                                },
                                "Retry"
                            }
                        }
                    },
                    PdfStatus::Ready => rsx! {},
                }
            }
            footer { class: "cr-bottom", "data-testid": "pdf-footer",
                input {
                    class: "cr-slider",
                    "data-testid": "pdf-slider",
                    r#type: "range",
                    min: "0",
                    max: "{total.saturating_sub(1)}",
                    value: "{current}",
                    disabled: total == 0,
                    aria_label: "Page slider",
                    oninput: move |evt| {
                        if let Ok(target) = evt.value().parse::<usize>() {
                            goto.call(target);
                        }
                    },
                    // Arrow keys on a focused slider already step the range
                    // natively (firing `oninput`); without this the same
                    // keydown would bubble to the root and double-turn.
                    onkeydown: move |evt| evt.stop_propagation(),
                }
                span { class: "cr-page-label", "data-testid": "pdf-page-label",
                    if total > 0 { "Page {current + 1} of {total}" } else { "\u{2014}" }
                }
                div { class: "cr-ribbon", i { style: "width:{pct}%" } }
            }
            PdfSelectionPopover { uuid: uuid.clone(), sigs }
            PdfOverlays {
                uuid,
                sigs,
                current_page: current,
                book_title: title,
                book_accent: accent,
                on_navigate_page: goto,
            }
        }
    }
}

/// The standalone quote-card renderer (`window.OmnibusQuoteCard`) the quote
/// panel's export actions call into — the same script the epub reader and
/// the book-detail passages card load. Mobile loads its runtime from the
/// native shell and has no SSR to keep in step.
#[cfg(not(feature = "mobile"))]
fn quote_card_script() -> Element {
    rsx! {
        document::Script { src: crate::components::quote_card::QUOTE_CARD_JS }
    }
}

#[cfg(feature = "mobile")]
fn quote_card_script() -> Element {
    rsx! {}
}

/// Top bar: back, title block, the highlights + bookmarks tools, and the
/// fit-mode toggle group. Each tool closes the other before opening its own.
#[component]
fn PdfTopBar(
    title: String,
    author: String,
    fit: Signal<FitMode>,
    highlight_count: usize,
    show_highlights: Signal<bool>,
    show_bookmarks: Signal<bool>,
    on_back: EventHandler<MouseEvent>,
) -> Element {
    let highlights_on = show_highlights();
    let bookmarks_on = show_bookmarks();
    rsx! {
        header { class: "cr-top",
            button {
                class: "cr-btn cr-back",
                "data-testid": "pdf-back",
                aria_label: "Back",
                onclick: move |evt| on_back.call(evt),
                "‹"
            }
            div { class: "cr-title-block",
                h1 { class: "cr-title", "{title}" }
                if !author.is_empty() {
                    span { class: "cr-author", "{author}" }
                }
            }
            div { class: "cr-fit-controls", role: "group", aria_label: "Annotations",
                button {
                    class: if highlights_on { "cr-btn cr-fit active pr-tool" } else { "cr-btn cr-fit pr-tool" },
                    r#type: "button",
                    "data-testid": "pdf-highlights",
                    aria_label: "Highlights and notes",
                    aria_pressed: if highlights_on { "true" } else { "false" },
                    onclick: move |_| {
                        let mut b = show_bookmarks;
                        b.set(false);
                        let mut h = show_highlights;
                        h.set(!highlights_on);
                    },
                    svg {
                        width: "17", height: "17", view_box: "0 0 24 24",
                        fill: "none", stroke: "currentColor",
                        stroke_width: "1.7", stroke_linecap: "round", stroke_linejoin: "round",
                        path { d: "M4 19.5l1.6-4 8.2-8.2 3 3-8.2 8.2-4.6 0z" }
                        path { d: "M13.2 6.1l2.7-2.7a1.3 1.3 0 0 1 1.9 0l1.8 1.8a1.3 1.3 0 0 1 0 1.9l-2.7 2.7" }
                    }
                    if highlight_count > 0 {
                        span { class: "rd-badge", "{highlight_count}" }
                    }
                }
                button {
                    class: if bookmarks_on { "cr-btn cr-fit active pr-tool" } else { "cr-btn cr-fit pr-tool" },
                    r#type: "button",
                    "data-testid": "pdf-bookmarks",
                    aria_label: "Bookmarks",
                    aria_pressed: if bookmarks_on { "true" } else { "false" },
                    onclick: move |_| {
                        let mut h = show_highlights;
                        h.set(false);
                        let mut b = show_bookmarks;
                        b.set(!bookmarks_on);
                    },
                    svg {
                        width: "17", height: "17", view_box: "0 0 24 24",
                        fill: "none", stroke: "currentColor",
                        stroke_width: "1.7", stroke_linecap: "round", stroke_linejoin: "round",
                        path { d: "M7 4h10v16l-5-3.6L7 20V4z" }
                    }
                }
            }
            div { class: "cr-fit-controls", role: "group", aria_label: "Fit mode",
                FitButton { fit, mode: FitMode::Width, label: "Fit width", testid: "pdf-fit-width" }
                FitButton { fit, mode: FitMode::Height, label: "Fit height", testid: "pdf-fit-height" }
            }
        }
    }
}

/// Selection popover over a live text-layer selection: highlight swatches
/// plus Note / Copy / Quote / Share, the epub reader's component driven by a
/// `pdf:` anchor. Renders nothing when there is no selection.
#[component]
fn PdfSelectionPopover(uuid: String, sigs: PdfSignals) -> Element {
    let server_url = use_server_url();
    let PdfSignals {
        selection,
        highlights,
        note_target,
        quote_target,
        ..
    } = sigs;
    let targets = HighlightTargets {
        highlights,
        note_target,
        quote_target,
    };
    let Some(sel) = selection.read().as_ref().cloned() else {
        return rsx! {};
    };
    let dismiss = move || {
        let mut selection = selection;
        selection.set(None);
        interop::pdf_call("clearSelection", "");
    };
    let create = {
        let uuid = uuid.clone();
        let server_url = server_url.clone();
        move |anchor: String, color: HighlightColor, text: String, post: PostCreate| {
            dismiss();
            spawn_create_highlight(
                server_url.clone(),
                uuid.clone(),
                NewHighlight {
                    anchor,
                    color,
                    text,
                    post,
                },
                targets,
                pdf_bridge(),
            );
        }
    };
    rsx! {
        SelectionPopover {
            anchor: SelectionAnchor {
                sel_rect_x: sel.rect.x,
                sel_rect_y: sel.rect.y,
                sel_rect_width: sel.rect.width,
                sel_cfi: sel.anchor(),
                sel_text: sel.text.clone(),
            },
            actions: SelectionActions {
                on_dismiss: EventHandler::new(move |_| dismiss()),
                on_highlight: EventHandler::new({
                    let create = create.clone();
                    move |(anchor, color, text): (String, HighlightColor, String)| {
                        create(anchor, color, text, PostCreate::None)
                    }
                }),
                on_note: EventHandler::new({
                    let create = create.clone();
                    move |(anchor, text): (String, String)| {
                        create(anchor, HighlightColor::Amber, text, PostCreate::Note)
                    }
                }),
                on_quote: EventHandler::new({
                    let create = create.clone();
                    move |(anchor, text): (String, String)| {
                        create(anchor, HighlightColor::Amber, text, PostCreate::Quote)
                    }
                }),
                on_copy: EventHandler::new(move |text: String| {
                    interop::pdf_call_json("copyText", &text);
                    dismiss();
                }),
                on_share: EventHandler::new(move |text: String| {
                    interop::pdf_call_json("shareText", &text);
                    dismiss();
                }),
            },
        }
    }
}

/// The toggleable overlays: highlights drawer, bookmarks drawer, quote
/// panel, and note composer. Each renders only when its backing signal is
/// set — the epub reader's components over the PDF bridge.
#[component]
fn PdfOverlays(
    uuid: String,
    sigs: PdfSignals,
    current_page: usize,
    book_title: String,
    book_accent: String,
    on_navigate_page: Callback<usize>,
) -> Element {
    let PdfSignals {
        meta,
        highlights,
        note_target,
        quote_target,
        show_highlights,
        show_bookmarks,
        ..
    } = sigs;
    let author = meta
        .read()
        .as_ref()
        .and_then(|m| m.creators.first().map(|c| c.name.clone()))
        .unwrap_or_default();
    let bookmark_label = format!("Page {}", current_page + 1);

    rsx! {
        if show_highlights() {
            HighlightsDrawer {
                highlights,
                bridge: pdf_bridge(),
                on_quote: move |h: Highlight| {
                    let mut quote_target = quote_target;
                    let mut show_highlights = show_highlights;
                    quote_target.set(Some(h));
                    show_highlights.set(false);
                },
                on_edit_note: move |h: Highlight| {
                    let mut note_target = note_target;
                    let mut show_highlights = show_highlights;
                    note_target.set(Some(h));
                    show_highlights.set(false);
                },
                on_close: move |_| {
                    let mut show_highlights = show_highlights;
                    show_highlights.set(false);
                },
            }
        }
        if show_bookmarks() {
            ReaderBookmarksDrawer {
                uuid: uuid.clone(),
                current_cfi: pdf_page_anchor(current_page),
                current_label: bookmark_label,
                on_navigate: move |position: String| {
                    if let Some(page) = parse_pdf_page_anchor(&position) {
                        on_navigate_page.call(page);
                    }
                    let mut show_bookmarks = show_bookmarks;
                    show_bookmarks.set(false);
                },
                on_close: move |_| {
                    let mut show_bookmarks = show_bookmarks;
                    show_bookmarks.set(false);
                },
            }
        }
        if let Some(h) = quote_target.read().clone() {
            QuotePanel {
                quote_text: h.text.clone().unwrap_or_default(),
                author,
                subtitle: book_title,
                accent: book_accent,
                on_close: move |_| {
                    let mut quote_target = quote_target;
                    quote_target.set(None);
                },
            }
        }
        if let Some(h) = note_target.read().clone() {
            NoteComposer {
                highlight: h,
                on_saved: move |(id, note): (i64, Option<String>)| {
                    let mut highlights = highlights;
                    let idx = highlights.read().iter().position(|x| x.id == id);
                    if let Some(i) = idx {
                        highlights.write()[i].note = note;
                    }
                },
                on_close: move |_| {
                    let mut note_target = note_target;
                    note_target.set(None);
                },
            }
        }
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn pdf_percent_maps_first_and_last_pages_to_ends() {
        assert_eq!(pdf_percent(0, 219), 0);
        assert_eq!(pdf_percent(218, 219), 100);
        assert_eq!(pdf_percent(0, 1), 100);
        assert_eq!(pdf_percent(0, 0), 0);
    }

    #[test]
    fn deep_link_page_is_one_based_and_rejects_nonsense() {
        assert_eq!(deep_link_page(Some(1)), Some(0));
        assert_eq!(deep_link_page(Some(12)), Some(11));
        assert_eq!(deep_link_page(Some(0)), None);
        assert_eq!(deep_link_page(Some(-3)), None);
        assert_eq!(deep_link_page(None), None);
    }

    #[test]
    fn start_page_prefers_the_deep_link_then_the_anchor_then_percent_then_zero() {
        // The link wins over a saved position — that is the point of it.
        assert_eq!(start_page(Some(6), Some("pdf-page:41"), Some(90), 100), 6);
        assert_eq!(start_page(None, Some("pdf-page:41"), Some(10), 219), 41);
        // Percent fallback inverts pdf_percent within rounding.
        let restored = start_page(None, None, Some(pdf_percent(107, 219)), 219);
        assert!((restored as i64 - 107).abs() <= 1, "restored {restored}");
        assert_eq!(start_page(None, None, None, 219), 0);
    }

    #[test]
    fn start_page_clamps_when_the_count_is_known_and_passes_through_when_not() {
        assert_eq!(start_page(Some(999), None, None, 12), 11);
        assert_eq!(start_page(None, Some("pdf-page:999"), None, 12), 11);
        // An unindexed page count leaves the clamp to the glue.
        assert_eq!(start_page(Some(999), None, None, 0), 999);
        assert_eq!(start_page(None, None, Some(50), 0), 0);
    }

    #[test]
    fn start_page_ignores_foreign_anchors() {
        // A comic anchor or a CFI on a mixed book is not a PDF position.
        assert_eq!(start_page(None, Some("comic-page:7"), None, 20), 0);
        assert_eq!(start_page(None, Some("epubcfi(/6/4!/4/2)"), None, 20), 0);
        assert_eq!(start_page(None, Some("pdf:7"), None, 20), 0);
    }

    #[test]
    fn progress_update_for_page_carries_the_pdf_anchor_and_percent() {
        let u = progress_update_for_page("book-a", 3, 8);
        assert_eq!(u.book_uuid, "book-a");
        assert_eq!(u.format, ProgressFormat::Epub);
        assert_eq!(u.epub_cfi.as_deref(), Some("pdf-page:3"));
        assert_eq!(u.progress_percent, Some(50));
        assert_eq!(u.book_file_id, None);
    }

    #[test]
    fn file_url_narrows_to_the_picked_file() {
        assert_eq!(file_url("", "book-a", None), "/api/ebooks/book-a/file");
        assert_eq!(
            file_url("", "book-a", Some(917)),
            "/api/ebooks/book-a/file?file_id=917"
        );
    }

    #[test]
    fn with_file_id_joins_an_existing_query_rather_than_opening_a_second_one() {
        // The mobile media URL already carries `?token=`; a second `?` would
        // hand the server an unparseable token.
        assert_eq!(
            with_file_id("https://h/api/ebooks/b/file?token=abc", Some(3)),
            "https://h/api/ebooks/b/file?token=abc&file_id=3"
        );
        assert_eq!(
            with_file_id("/api/ebooks/b/file", Some(3)),
            "/api/ebooks/b/file?file_id=3"
        );
        assert_eq!(
            with_file_id("https://h/api/ebooks/b/file?token=abc", None),
            "https://h/api/ebooks/b/file?token=abc"
        );
    }

    #[test]
    fn fit_name_matches_the_glue_vocabulary() {
        assert_eq!(fit_name(FitMode::Width), "width");
        assert_eq!(fit_name(FitMode::Height), "height");
    }
}
