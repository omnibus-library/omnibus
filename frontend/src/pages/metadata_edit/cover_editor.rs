//! Cover upload/replace/revert control for the metadata edit sidebar.
//! Against a saved book, upload posts a multipart body directly to the REST
//! `/api/ebooks/:uuid/cover` route (binary can't ride the server-function
//! transport) and revert goes through the analogous `DELETE`; both update
//! the local preview and bump the app-wide `CoverCacheBust` registry. Under
//! review ([`CoverMode::Staged`]) the same controls stage the pick for the
//! upload commit and write nothing.

use dioxus::prelude::*;
use omnibus_shared::EbookMetadata;

use super::bust_query;
use super::cover_mode::{CoverMode, StagedCover};
use crate::components::atrium::Cover;
use crate::contexts::{bump_cover_cache_bust, use_cover_cache_bust};
use crate::data::UploadCover;
use crate::{data, media_url, use_server_url};

/// Cover preview card: image/plate + upload + revert-override controls.
/// `on_change` fires with the server's merged `EbookMetadata` after a
/// successful upload or revert, so the parent sidebar's "Override active"
/// card can stay in sync without re-fetching the whole book. Under review
/// it never fires — nothing is written.
#[component]
pub(crate) fn CoverEditor(
    book: EbookMetadata,
    mode: CoverMode,
    on_change: EventHandler<EbookMetadata>,
) -> Element {
    let server_url = use_server_url();
    let global_bust = use_cover_cache_bust().0;
    let bust_key = mode.uuid().unwrap_or_default().to_string();
    let mut state = CoverState {
        busy: use_signal(|| false),
        status: use_signal(|| None),
        cover_url: use_signal(|| book.cover_url.clone()),
        has_cover_override: use_signal(|| book.has_cover_override),
        // Read from the app-wide registry rather than counted locally, so a
        // cover applied *elsewhere on this page* — the compare view's cover
        // row — busts this preview too. The cover route caches for a day
        // (`Cache-Control: private, max-age=86400`) and this preview already
        // fetched the pre-change image, so without a changing query string
        // the browser keeps serving the old bytes for an unchanged URL.
        //
        // Starts at 0 on a fresh registry, so SSR and the first WASM paint
        // both render no `src_override` (rule 07).
        cover_bust: use_memo(move || global_bust.read().get(&bust_key).copied().unwrap_or(0)),
        global_bust,
    };

    // Re-seed when the page hands down a book the server has since changed —
    // the compare view's cover row writes one without this component being
    // remounted, and its status line would otherwise still read
    // "extracted from file" over the new image.
    use_effect(use_reactive!(|book| {
        state.cover_url.set(book.cover_url.clone());
        state.has_cover_override.set(book.has_cover_override);
    }));

    rsx! {
        div { class: "card me-sidebar-card",
            div { class: "me-sidebar-head",
                div { class: "label", "Cover" }
            }
            {match &mode {
                CoverMode::Live { uuid } => rsx! {
                    {cover_preview(&book, &server_url, state)}
                    div { class: "mono me-cover-hint", "data-testid": "cover-hint",
                        if (state.cover_url)().is_none() {
                            "no cover available"
                        } else if (state.has_cover_override)() {
                            "custom upload"
                        } else {
                            "extracted from file"
                        }
                    }
                    {cover_controls(uuid.clone(), server_url.clone(), state, on_change)}
                },
                CoverMode::Staged(staged) => rsx! {
                    {staged_preview(&book, *staged)}
                    div { class: "mono me-cover-hint", "data-testid": "cover-hint",
                        {staged_hint(&staged.read())}
                    }
                    {staged_controls(*staged, state)}
                },
            }}
            if let Some(msg) = (state.status)() {
                p {
                    class: "mono me-cover-hint",
                    role: "status",
                    "data-testid": "cover-upload-status",
                    "{msg}"
                }
            }
        }
    }
}

/// The signals a cover edit in flight needs, grouped into one `Copy` bundle
/// (mirrors `PhotoEditStatus` in `author_photo_edit.rs`) so the upload and
/// revert handlers don't each thread five separate signal params.
#[derive(Clone, Copy)]
struct CoverState {
    busy: Signal<bool>,
    status: Signal<Option<String>>,
    cover_url: Signal<Option<String>>,
    has_cover_override: Signal<bool>,
    /// This book's entry in the app-wide registry — a memo, not a counter,
    /// so any writer of a cover for this book moves it.
    cover_bust: Memo<u32>,
    global_bust: Signal<std::collections::HashMap<String, u32>>,
}

impl CoverState {
    /// Mark an action in flight and show its "…ing" status line.
    fn start(&mut self, msg: &str) {
        self.busy.set(true);
        self.status.set(Some(msg.to_string()));
    }

    /// Fold a successful server response into the local preview state,
    /// bump the app-wide cache-bust counter for `uuid` — which this
    /// component's own preview reads back, alongside every other view of the
    /// book (issue #1087) — and bubble the merged book up to the parent
    /// sidebar.
    fn apply(
        &mut self,
        uuid: &str,
        updated: EbookMetadata,
        msg: &str,
        on_change: EventHandler<EbookMetadata>,
    ) {
        self.cover_url.set(updated.cover_url.clone());
        self.has_cover_override.set(updated.has_cover_override);
        // One bump, which `cover_bust` reads back — no separate local
        // counter to keep in step.
        bump_cover_cache_bust(self.global_bust, uuid);
        self.status.set(Some(msg.to_string()));
        on_change.call(updated);
    }

    /// Surface a failure message. Callers still clear `busy` themselves
    /// afterward — shared with the success path's cleanup.
    fn fail(&mut self, msg: String) {
        self.status.set(Some(msg));
    }
}

/// Renders the `Cover` image/plate. `src_override` is only set once
/// `cover_bust > 0` (i.e. after a client-side change) so the initial render
/// is byte-identical between SSR and the first WASM paint — `Cover` falls
/// back to `book.cover_url` (via its own `media_url` call) exactly as it did
/// before this component existed.
fn cover_preview(book: &EbookMetadata, server_url: &str, state: CoverState) -> Element {
    let cover_url = (state.cover_url)();
    let bust = (state.cover_bust)();
    let display_book = EbookMetadata {
        cover_url: cover_url.clone(),
        ..book.clone()
    };
    let src_override = (bust > 0)
        .then(|| cover_url.map(|path| bust_query(&media_url(server_url, &path), bust)))
        .flatten();

    rsx! {
        div { class: "me-cover-preview",
            Cover { book: display_book, src_override }
        }
    }
}

/// The review preview: whatever the stage holds, straight into `src_override`
/// — there is no cover route to fall back to, so a `None` is the plate.
fn staged_preview(book: &EbookMetadata, staged: Signal<StagedCover>) -> Element {
    let src_override = staged.read().preview.clone();
    rsx! {
        div { class: "me-cover-preview", "data-testid": "cover-staged-preview",
            Cover { book: book.clone(), src_override }
        }
    }
}

/// The hint line under a review preview: which cover the commit will carry.
fn staged_hint(staged: &StagedCover) -> &'static str {
    match &staged.source {
        UploadCover::Bytes { .. } => "your image \u{b7} saved with the book",
        UploadCover::Url(_) => "from the edition picker \u{b7} saved with the book",
        UploadCover::Keep if staged.preview.is_some() => "extracted from file",
        UploadCover::Keep => "no cover available",
    }
}

/// File-upload input plus the "revert to scanned cover" button (shown only
/// while a cover override is active).
fn cover_controls(
    uuid: String,
    server_url: String,
    mut state: CoverState,
    on_change: EventHandler<EbookMetadata>,
) -> Element {
    let on_upload = {
        let uuid = uuid.clone();
        let server_url = server_url.clone();
        move |evt: Event<FormData>| {
            let uuid = uuid.clone();
            let server_url = server_url.clone();
            let Some(file) = evt.files().into_iter().next() else {
                return;
            };
            let filename = file.name();
            let mime = file
                .content_type()
                .unwrap_or_else(|| "application/octet-stream".into());
            state.start(&format!("Uploading {filename}\u{2026}"));
            spawn(async move {
                match file.read_bytes().await {
                    Ok(bytes) => {
                        let result = data::upload_ebook_cover(
                            &server_url,
                            &uuid,
                            filename,
                            mime,
                            bytes.to_vec(),
                        )
                        .await;
                        match result {
                            Ok(Some(updated)) => {
                                state.apply(&uuid, updated, "Cover updated.", on_change)
                            }
                            Ok(None) => state.fail("Upload failed: book not found.".into()),
                            Err(e) => state.fail(format!("Upload failed: {e}")),
                        }
                    }
                    Err(e) => state.fail(format!("Read file failed: {e}")),
                }
                state.busy.set(false);
            });
        }
    };

    let on_revert_cover = move |_| {
        let uuid = uuid.clone();
        let server_url = server_url.clone();
        state.start("Reverting\u{2026}");
        spawn(async move {
            match data::delete_ebook_cover(&server_url, &uuid).await {
                Ok(Some(updated)) => {
                    state.apply(&uuid, updated, "Reverted to scanned cover.", on_change)
                }
                Ok(None) => state.fail("Revert failed: book not found.".into()),
                Err(e) => state.fail(format!("Revert failed: {e}")),
            }
            state.busy.set(false);
        });
    };

    rsx! {
        div { class: "me-cover-actions",
            label { class: "label", r#for: "cover-file-input", "Replace cover" }
            input {
                id: "cover-file-input",
                class: "me-cover-file",
                r#type: "file",
                accept: "image/jpeg,image/png,image/webp,image/gif",
                "data-testid": "cover-upload-input",
                disabled: (state.busy)(),
                onchange: on_upload,
            }
            if (state.has_cover_override)() {
                button {
                    r#type: "button",
                    class: "btn ghost sm",
                    style: "margin-top: 8px; width: 100%; justify-content: center;",
                    "data-testid": "cover-remove-override",
                    disabled: (state.busy)(),
                    onclick: on_revert_cover,
                    "Revert to scanned cover"
                }
            }
        }
    }
}

/// The same two controls under review: the picker stages the image and
/// previews it, and the revert puts the file's own cover back. Same test ids
/// as the live controls, so the one spec shape drives both.
fn staged_controls(mut staged: Signal<StagedCover>, mut state: CoverState) -> Element {
    let on_pick = move |evt: Event<FormData>| {
        let Some(file) = evt.files().into_iter().next() else {
            return;
        };
        let filename = file.name();
        let mime = file
            .content_type()
            .unwrap_or_else(|| "application/octet-stream".into());
        state.start(&format!("Reading {filename}\u{2026}"));
        spawn(async move {
            match file.read_bytes().await {
                Ok(bytes) => {
                    let bytes = bytes.to_vec();
                    let preview = data::image_preview_url(&bytes, &mime);
                    staged.write().stage(
                        UploadCover::Bytes {
                            filename,
                            mime,
                            bytes,
                        },
                        preview,
                    );
                    state.status.set(Some("Cover staged.".into()));
                }
                Err(e) => state.fail(format!("Read file failed: {e}")),
            }
            state.busy.set(false);
        });
    };

    let on_revert = move |_| {
        staged.write().reset();
        state.status.set(Some("Using the file's cover.".into()));
    };

    let is_staged = staged.read().is_staged();
    rsx! {
        div { class: "me-cover-actions",
            label { class: "label", r#for: "cover-file-input", "Replace cover" }
            input {
                id: "cover-file-input",
                class: "me-cover-file",
                r#type: "file",
                accept: "image/jpeg,image/png,image/webp,image/gif",
                "data-testid": "cover-upload-input",
                disabled: (state.busy)(),
                onchange: on_pick,
            }
            if is_staged {
                button {
                    r#type: "button",
                    class: "btn ghost sm",
                    style: "margin-top: 8px; width: 100%; justify-content: center;",
                    "data-testid": "cover-remove-override",
                    disabled: (state.busy)(),
                    onclick: on_revert,
                    "Use the file\u{2019}s cover"
                }
            }
        }
    }
}
