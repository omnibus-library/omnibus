//! Add-books page (`/add-books`) — upload an EPUB, PDF or audiobook into the
//! library, gated on `can_upload` (server's `require_upload` remains the real
//! boundary). One picker for both: the file extensions decide which ingest
//! the pick goes to, the server parses it, and the reader reviews the whole
//! record on the metadata edit form — cover included — while nothing exists
//! yet. Add to library files it, writes the edits and any staged cover in
//! the same request, and redirects to the new book. rsx is target-agnostic —
//! file interop runs only in `spawn`.

use dioxus::prelude::*;
use dioxus_router::use_navigator;
use omnibus_shared::{AudiobookInspection, EbookMetadata, UploadInspection};

use super::metadata_edit::cover_mode::{CoverMode, StagedCover};
use super::metadata_edit::form_grid::FormGrid;
use super::metadata_edit::header::PageHeader;
use super::metadata_edit::save_bar::{DirtyState, SaveBar, SaveBarMode, SaveStatus};
use super::metadata_edit::sidebar::Sidebar;
use super::metadata_edit::state::{
    header_strings, overrides_from_form, use_dirty_fields, use_field_signals, use_suggestion_pools,
};
use crate::data::{self, AudiobookUploadMeta, EbookUploadMeta};
use crate::{use_server_url, Route};

/// Which ingest a pick goes to, decided by [`classify_pick`] from the file
/// extensions — never chosen by the user. Drives which data-layer call the
/// inspect and commit handlers make.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum UploadKind {
    Ebook,
    Audiobook,
}

/// Extensions the ebook ingest takes (`/api/uploads/ebooks`), matching the
/// server's `detect_ebook_format`.
const EBOOK_EXTENSIONS: &[&str] = &["epub", "pdf"];
/// Extensions the audiobook ingest takes (`/api/uploads/audiobooks`), matching
/// the server's `audiobook_ext_of`.
const AUDIOBOOK_EXTENSIONS: &[&str] = &["m4b", "m4a", "mp4", "mp3"];
/// The picker's `accept` list: every extension above plus their MIME types,
/// so a browser filters the dialog without the page having to.
const ACCEPT: &str =
    ".epub,.pdf,.m4b,.m4a,.mp4,.mp3,application/epub+zip,application/pdf,audio/mp4,audio/mpeg";

/// Decide which ingest a set of picked filenames goes to, or say why it can't.
///
/// One EPUB or PDF is an ebook; any number of audiobook files is an audiobook (the
/// server still rejects two `.m4b`s or a mixed set of its own — this only
/// routes). Everything else is refused here so the wrong endpoint is never
/// asked: a mix of the two, several EPUBs, or an extension neither takes.
fn classify_pick(names: &[String]) -> Result<UploadKind, String> {
    let ext_of = |name: &String| {
        std::path::Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default()
    };
    let mut ebooks = 0usize;
    let mut audio = 0usize;
    for name in names {
        let ext = ext_of(name);
        if EBOOK_EXTENSIONS.contains(&ext.as_str()) {
            ebooks += 1;
        } else if AUDIOBOOK_EXTENSIONS.contains(&ext.as_str()) {
            audio += 1;
        } else {
            return Err(format!(
                "{name} isn't a format Omnibus can add — pick an EPUB or PDF, an M4B/M4A/MP4 audiobook, or MP3 parts."
            ));
        }
    }
    match (ebooks, audio) {
        (0, 0) => Err("Choose a file first.".into()),
        (1, 0) => Ok(UploadKind::Ebook),
        (0, _) => Ok(UploadKind::Audiobook),
        (_, 0) => Err("Add one EPUB at a time.".into()),
        _ => Err("Pick either an EPUB or an audiobook's files, not both.".into()),
    }
}

/// What a successful inspect staged: the bytes the commit will send and the
/// record the review form starts from. Nothing here exists on the server.
#[derive(Clone, PartialEq)]
struct StagedPick {
    kind: UploadKind,
    /// What the drop zone shows for the pick.
    label: String,
    /// The single ebook as `(filename, bytes)`, or the audiobook parts.
    files: Vec<(String, Vec<u8>)>,
    /// The review form's baseline — the book as the library would index it.
    book: EbookMetadata,
    /// The file's own cover, as an inline image the form can show.
    cover_preview: Option<String>,
    /// Bumped per pick, so the form remounts with fresh signals instead of
    /// carrying the previous pick's edits into this one.
    generation: u32,
}

/// The page's signals, threaded through the pick and review handlers.
/// `Copy` so the async handlers can capture them.
#[derive(Copy, Clone, PartialEq)]
struct UploadState {
    /// The pick under review; `None` shows only the picker.
    pick: Signal<Option<StagedPick>>,
    busy: Signal<bool>,
    status: Signal<Option<String>>,
    status_is_error: Signal<bool>,
    /// Counts picks, for [`StagedPick::generation`].
    picks: Signal<u32>,
}

/// Upload page: pick a file, review the whole record, add it.
#[component]
pub fn AddBooksPage() -> Element {
    // All hooks run unconditionally on every render — only the rsx output
    // below branches on `can_upload` — so the hook call order stays stable
    // once the boot effect resolves the real permission (rule 07).
    let can_upload = crate::use_can_upload();
    let server_url = use_server_url();

    let state = UploadState {
        pick: use_signal(|| None),
        busy: use_signal(|| false),
        status: use_signal(|| None),
        status_is_error: use_signal(|| false),
        picks: use_signal(|| 0),
    };

    let on_file = make_on_file(server_url, state);

    if !can_upload() {
        return rsx! { AddBooksForbidden {} };
    }

    rsx! {
        section { class: "card",
            h1 { "Upload a book" }

            FileDropZone {
                state,
                on_file: EventHandler::new(on_file),
            }

            if let Some(msg) = (state.status)() {
                p {
                    id: "add-books-status",
                    "data-testid": "add-books-status",
                    role: "status",
                    class: if (state.status_is_error)() { "settings-status error" } else { "settings-status success" },
                    "{msg}"
                }
            }
        }

        if let Some(pick) = (state.pick)() {
            ReviewForm { key: "{pick.generation}", pick, state }
        }
    }
}

/// Not-authorized state shown in place of the form to a user without
/// `can_upload`. Split out (no props, no hooks) so it's directly
/// render-testable without `AddBooksPage`'s router dependency
/// (`use_navigator` panics outside a `Router` ancestor).
#[component]
fn AddBooksForbidden() -> Element {
    rsx! {
        section { class: "card",
            h1 { "Upload a book" }
            p { class: "settings-status error", "data-testid": "add-books-forbidden",
                "You don't have permission to add books to this library."
            }
        }
    }
}

/// Build the file-select handler: classify the pick by extension, then read
/// bytes → inspect → stage the record for review on the ingest it belongs
/// to. A pick that fits neither is refused here with the reason, and nothing
/// is sent.
fn make_on_file(server_url: String, state: UploadState) -> impl FnMut(Event<FormData>) {
    move |evt: Event<FormData>| {
        let mut s = state;
        let names: Vec<String> = evt.files().iter().map(|f| f.name()).collect();
        if names.is_empty() {
            return;
        }
        match classify_pick(&names) {
            Ok(UploadKind::Ebook) => inspect_ebook_file(server_url.clone(), state, evt),
            Ok(UploadKind::Audiobook) => inspect_audiobook_files(server_url.clone(), state, evt),
            Err(reason) => {
                clear_stage(&mut s);
                s.status.set(Some(reason));
                s.status_is_error.set(true);
            }
        }
    }
}

/// Read the single selected EPUB or PDF, inspect it, and stage it for review.
fn inspect_ebook_file(server_url: String, state: UploadState, evt: Event<FormData>) {
    let mut s = state;
    let Some(file) = evt.files().into_iter().next() else {
        return;
    };
    let name = file.name();
    s.busy.set(true);
    s.status.set(Some(format!("Reading {name}\u{2026}")));
    s.status_is_error.set(false);
    spawn(async move {
        match file.read_bytes().await {
            Ok(bytes) => {
                let bytes = bytes.to_vec();
                match data::inspect_ebook(&server_url, name.clone(), &bytes).await {
                    Ok(insp) => {
                        let (book, cover_preview) = book_from_ebook(insp, &name);
                        stage_pick(
                            &mut s,
                            StagedPick {
                                kind: UploadKind::Ebook,
                                label: name.clone(),
                                files: vec![(name, bytes)],
                                book,
                                cover_preview,
                                generation: 0,
                            },
                        );
                    }
                    Err(e) => {
                        clear_stage(&mut s);
                        s.status.set(Some(format!("Could not read that EPUB: {e}")));
                        s.status_is_error.set(true);
                    }
                }
            }
            Err(e) => {
                clear_stage(&mut s);
                s.status.set(Some(format!("Could not read that file: {e}")));
                s.status_is_error.set(true);
            }
        }
        s.busy.set(false);
    });
}

/// Read every selected audiobook part, inspect the set, and stage it for
/// review.
fn inspect_audiobook_files(server_url: String, state: UploadState, evt: Event<FormData>) {
    let mut s = state;
    let picked: Vec<_> = evt.files().into_iter().collect();
    if picked.is_empty() {
        return;
    }
    let count = picked.len();
    s.busy.set(true);
    s.status.set(Some(format!(
        "Reading {count} file{}\u{2026}",
        if count == 1 { "" } else { "s" }
    )));
    s.status_is_error.set(false);
    spawn(async move {
        let mut files: Vec<(String, Vec<u8>)> = Vec::with_capacity(count);
        for file in picked {
            let name = file.name();
            match file.read_bytes().await {
                Ok(bytes) => files.push((name, bytes.to_vec())),
                Err(e) => {
                    clear_stage(&mut s);
                    s.status.set(Some(format!("Could not read {name}: {e}")));
                    s.status_is_error.set(true);
                    s.busy.set(false);
                    return;
                }
            }
        }
        match data::inspect_audiobook(&server_url, &files).await {
            Ok(insp) => {
                let label = audiobook_summary(&files);
                let (book, cover_preview) = book_from_audiobook(insp, &label);
                stage_pick(
                    &mut s,
                    StagedPick {
                        kind: UploadKind::Audiobook,
                        label,
                        files,
                        book,
                        cover_preview,
                        generation: 0,
                    },
                );
            }
            Err(e) => {
                clear_stage(&mut s);
                s.status
                    .set(Some(format!("Could not read that audiobook: {e}")));
                s.status_is_error.set(true);
            }
        }
        s.busy.set(false);
    });
}

/// The review baseline and cover preview from an EPUB/PDF inspection.
fn book_from_ebook(mut insp: UploadInspection, filename: &str) -> (EbookMetadata, Option<String>) {
    let cover_preview = insp.cover_preview.take();
    (insp.into_metadata(filename), cover_preview)
}

/// The review baseline and cover preview from an audiobook inspection. The
/// parser reports no series, so the form's series fields start empty — the
/// only point in the flow where one can be supplied.
fn book_from_audiobook(
    mut insp: AudiobookInspection,
    label: &str,
) -> (EbookMetadata, Option<String>) {
    let cover_preview = insp.cover_preview.take();
    (insp.into_metadata(label), cover_preview)
}

/// Human-readable label for the staged audiobook part(s) in the drop zone.
fn audiobook_summary(files: &[(String, Vec<u8>)]) -> String {
    match files {
        [(name, _)] => name.clone(),
        _ => format!("{} parts selected", files.len()),
    }
}

/// Put a freshly inspected pick under review, on a new generation so the
/// form remounts rather than keeping the last pick's edits.
fn stage_pick(s: &mut UploadState, mut pick: StagedPick) {
    let generation = s.picks.peek().wrapping_add(1);
    s.picks.set(generation);
    pick.generation = generation;
    s.pick.set(Some(pick));
    s.status.set(Some(
        "Review the details, then add it to your library.".into(),
    ));
    s.status_is_error.set(false);
}

/// Drop the staged pick so stale bytes can't be committed after a new pick
/// fails inspect, or once the reader starts over.
fn clear_stage(s: &mut UploadState) {
    s.pick.set(None);
}

/// The two values the commit cannot do without, read from the form: the
/// title and the first author decide the on-disk folder, and a blank either
/// is refused here rather than as a 400 after the upload.
fn confirm_identity(title: &str, authors: &[String]) -> Result<(String, String), String> {
    let title = title.trim().to_string();
    let author = authors
        .first()
        .map(|a| a.trim().to_string())
        .unwrap_or_default();
    if title.is_empty() || author.is_empty() {
        return Err("A title and at least one author are required.".into());
    }
    Ok((title, author))
}

/// The review form over a staged pick: the metadata edit page's grid,
/// sidebar and save bar in their staged modes. Remounted per pick via the
/// generation key, so every signal here seeds from *this* pick.
#[component]
fn ReviewForm(pick: StagedPick, state: UploadState) -> Element {
    let server_url = use_server_url();
    let nav = use_navigator();
    let orig = use_signal(|| pick.book.clone());
    let fields = use_field_signals(&pick.book);
    let suggestions = use_suggestion_pools(&server_url);
    let dirty_fields = use_dirty_fields(orig, fields);
    let dirty_count = use_memo(move || dirty_fields().len());
    let staged = use_signal(|| StagedCover::from_inspection(pick.cover_preview.clone()));
    // The bar describes a staged cover the way it describes a replaced one.
    let mut cover_replaced = use_signal(|| false);
    use_effect(move || {
        let is_staged = staged.read().is_staged();
        cover_replaced.set(is_staged);
    });
    let save_error: Signal<Option<String>> = use_signal(|| None);
    let (display_title, primary_author, _primary_author_id, accent_style) =
        header_strings(&pick.book);
    let mode = CoverMode::Staged(staged);

    let on_save = build_on_add(
        server_url,
        state,
        pick.clone(),
        orig,
        fields,
        staged,
        save_error,
        nav,
    );
    let on_discard = EventHandler::new(move |()| {
        let mut s = state;
        clear_stage(&mut s);
        s.status.set(None);
    });

    rsx! {
        div { class: "me-root", style: "{accent_style}", "data-testid": "add-books-review",
            PageHeader {
                display_title,
                primary_author,
                kicker: "Review before adding",
                hint: "nothing is saved until you add the book",
            }

            div { class: "me-layout",
                FormGrid {
                    orig,
                    fields,
                    suggestions,
                    mode: mode.clone(),
                    book: pick.book.clone(),
                    on_cover_applied: move |_| {},
                }
                Sidebar {
                    book: pick.book.clone(),
                    mode,
                    saving: state.busy,
                    on_revert: move |()| {},
                    on_cover_applied: move |_| {},
                }
            }

            SaveBar {
                mode: SaveBarMode::Create,
                dirty: DirtyState {
                    fields: dirty_fields,
                    count: dirty_count,
                    cover_replaced,
                },
                status: SaveStatus {
                    saving: state.busy,
                    error: save_error,
                },
                on_save,
                on_discard,
            }
        }
    }
}

/// Build the Add handler: read the form back as the commit's payload, file
/// the book with its edits and staged cover in one request, then navigate to
/// it. Everything refusable client-side is refused before the upload starts.
#[allow(clippy::too_many_arguments)]
fn build_on_add(
    server_url: String,
    state: UploadState,
    pick: StagedPick,
    orig: Signal<EbookMetadata>,
    fields: super::metadata_edit::form_grid::FormFields,
    staged: Signal<StagedCover>,
    mut save_error: Signal<Option<String>>,
    nav: dioxus_router::Navigator,
) -> EventHandler<()> {
    EventHandler::new(move |()| {
        let mut s = state;
        let overrides = match overrides_from_form(&orig(), fields) {
            Ok(ov) => ov,
            Err(msg) => {
                save_error.set(Some(msg));
                return;
            }
        };
        let (title, author) = match confirm_identity(&fields.title.peek(), &fields.authors.peek()) {
            Ok(pair) => pair,
            Err(msg) => {
                save_error.set(Some(msg));
                return;
            }
        };
        let series = fields.series.peek().trim().to_string();
        let series_index = fields.series_index.peek().trim().to_string();
        let cover = staged.peek().source.clone();
        let files = pick.files.clone();
        let kind = pick.kind;
        let server_url = server_url.clone();

        s.busy.set(true);
        save_error.set(None);
        s.status.set(Some("Adding to your library\u{2026}".into()));
        s.status_is_error.set(false);
        spawn(async move {
            let result = match kind {
                UploadKind::Ebook => {
                    let (name, bytes) = files.into_iter().next().unwrap_or_default();
                    let meta = EbookUploadMeta {
                        title,
                        author,
                        series,
                        series_index,
                        overrides: Some(overrides),
                        cover,
                    };
                    data::upload_ebook(&server_url, name, bytes, meta).await
                }
                UploadKind::Audiobook => {
                    let meta = AudiobookUploadMeta {
                        title,
                        author,
                        series,
                        series_index,
                        overrides: Some(overrides),
                        cover,
                    };
                    data::upload_audiobook(&server_url, files, meta).await
                }
            };
            match result {
                Ok(result) => {
                    nav.push(Route::BookDetail { uuid: result.uuid });
                }
                Err(e) => {
                    let msg = format!("Upload failed: {e}");
                    save_error.set(Some(msg.clone()));
                    s.status.set(Some(msg));
                    s.status_is_error.set(true);
                    s.busy.set(false);
                }
            }
        });
    })
}

/// File-picker drop zone: prompt icon when empty, filename + checkmark once
/// chosen. One picker for every format — a single EPUB, a single audiobook
/// container, or the `.mp3` parts of one book — sorted out by extension after
/// the pick, so it always allows a multi-select.
#[component]
fn FileDropZone(state: UploadState, on_file: EventHandler<Event<FormData>>) -> Element {
    let label = (state.pick)().map(|p| p.label).unwrap_or_default();
    let busy = state.busy;
    rsx! {
        div { class: "settings-field",
            div {
                class: if label.is_empty() { "file-drop-zone" } else { "file-drop-zone has-file" },
                div { class: "file-drop-content",
                    if label.is_empty() {
                        svg {
                            class: "file-drop-icon",
                            width: "28", height: "28",
                            view_box: "0 0 24 24",
                            fill: "none",
                            stroke: "currentColor",
                            stroke_width: "1.5",
                            stroke_linecap: "round",
                            stroke_linejoin: "round",
                            path { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }
                            polyline { points: "17 8 12 3 7 8" }
                            line { x1: "12", y1: "3", x2: "12", y2: "15" }
                        }
                        span { class: "file-drop-prompt",
                            "Drop an EPUB or audiobook here or "
                            strong { "choose a file" }
                        }
                    } else {
                        svg {
                            class: "file-drop-icon file-drop-icon--ok",
                            width: "28", height: "28",
                            view_box: "0 0 24 24",
                            fill: "none",
                            stroke: "currentColor",
                            stroke_width: "1.5",
                            stroke_linecap: "round",
                            stroke_linejoin: "round",
                            polyline { points: "20 6 9 17 4 12" }
                        }
                        span { class: "file-drop-filename", "{label}" }
                        span { class: "file-drop-change", "Click to change" }
                    }
                }
                input {
                    id: "add-books-file",
                    r#type: "file",
                    accept: ACCEPT,
                    multiple: true,
                    "data-testid": "add-books-file-input",
                    aria_label: "Book files",
                    class: "file-drop-input",
                    disabled: busy(),
                    onchange: move |evt| on_file.call(evt),
                }
            }
            p {
                class: "settings-hint",
                "data-testid": "add-books-formats",
                "EPUB, PDF, M4B, M4A, MP4, or the MP3 parts of one audiobook."
            }
        }
    }
}

#[cfg(test)]
mod tests;
