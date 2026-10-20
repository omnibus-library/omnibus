//! The review composer: the journal's Markdown editor twice over, once for the
//! public review text (with the Contains spoilers flag under it) and once for
//! your private notes, each with the formatting toolbar, image upload and
//! insert-from-highlights. Everything saves on Save only, as one patch of the
//! fields that changed.

use dioxus::prelude::*;
use omnibus_shared::{Review, ReviewPatch};

use crate::components::BusyLabel;
use crate::pages::book_detail::journal_editor::{
    use_highlights_insert_state, BdHighlightsInsert, BdJournalToolbar, BdMarkdownSurface,
    HighlightsInsertState,
};
use crate::use_server_url;

use super::{writes, ReviewsCtx};

/// What the composer opens with: your saved text and notes, as Markdown, and
/// your spoiler flag.
#[derive(Clone, PartialEq)]
pub(super) struct ComposerSeed {
    pub(super) body: String,
    pub(super) notes: String,
    pub(super) spoiler: bool,
}

impl ComposerSeed {
    /// The seed for `mine`, empty fields where nothing is written.
    pub(super) fn of(mine: Option<&Review>) -> Self {
        Self {
            body: mine.and_then(|r| r.body_md.clone()).unwrap_or_default(),
            notes: mine.and_then(|r| r.notes_md.clone()).unwrap_or_default(),
            spoiler: mine.is_some_and(|r| r.spoiler),
        }
    }
}

/// The patch Save sends: the changed text fields, plus the spoiler flag only
/// when it moved. Empty when nothing changed, which just closes the composer.
pub(super) fn save_patch(
    seed: &ComposerSeed,
    body: &str,
    notes: &str,
    spoiler: bool,
) -> ReviewPatch {
    ReviewPatch {
        spoiler: (spoiler != seed.spoiler).then_some(spoiler),
        ..writes::text_patch(&seed.body, &seed.notes, body, notes)
    }
}

/// The two-field composer. Cancel drops the draft; Save sends the changed
/// fields and flag, closes on success, and keeps the draft with the reason on
/// failure.
#[component]
pub(super) fn BdReviewComposer(
    uuid: String,
    ctx: ReviewsCtx,
    seed: ComposerSeed,
    open: Signal<bool>,
) -> Element {
    let server_url = use_server_url();
    let body = use_signal(|| seed.body.clone());
    let notes = use_signal(|| seed.notes.clone());
    let mut spoiler = use_signal(|| seed.spoiler);
    let mut saving = use_signal(|| false);
    let mut error = use_signal(|| None::<String>);
    let body_highlights = use_highlights_insert_state();
    let notes_highlights = use_highlights_insert_state();
    let mut open = open;

    let save_url = server_url.clone();
    let save_uuid = uuid.clone();
    let on_save = move |_| {
        if saving() {
            return;
        }
        let patch = save_patch(&seed, &body(), &notes(), spoiler());
        if patch == ReviewPatch::default() {
            open.set(false);
            return;
        }
        let url = save_url.clone();
        let uuid = save_uuid.clone();
        saving.set(true);
        error.set(None);
        spawn(async move {
            match writes::save_text(ctx, &uuid, &url, patch).await {
                Ok(()) => open.set(false),
                Err(e) => error.set(Some(e.to_string())),
            }
            saving.set(false);
        });
    };

    rsx! {
        div { class: "card bd-journal-composer bd-review-composer", "data-testid": "review-composer",
            ReviewField {
                field: ReviewFieldKind::Body,
                uuid: uuid.clone(),
                server_url: server_url.clone(),
                body,
                error,
                highlights: body_highlights,
            }
            label { class: "bd-review-spoiler", "data-testid": "review-spoiler",
                input {
                    r#type: "checkbox",
                    checked: spoiler(),
                    oninput: move |e| spoiler.set(e.value() == "true"),
                }
                "Contains spoilers"
            }
            ReviewField {
                field: ReviewFieldKind::Notes,
                uuid: uuid.clone(),
                server_url: server_url.clone(),
                body: notes,
                error,
                highlights: notes_highlights,
            }
            div { class: "bd-journal-composer-foot",
                if let Some(msg) = error() {
                    span { class: "mono bd-journal-error", role: "alert", "{msg}" }
                }
                span { class: "bd-journal-foot-spacer" }
                button {
                    r#type: "button",
                    class: "btn ghost sm",
                    "data-testid": "review-cancel",
                    disabled: saving(),
                    onclick: move |_| open.set(false),
                    "Cancel"
                }
                button {
                    r#type: "button",
                    class: "btn primary sm",
                    "data-testid": "review-save",
                    disabled: saving(),
                    "aria-busy": if saving() { "true" } else { "false" },
                    onclick: on_save,
                    BusyLabel { busy: saving(), label: "Save review", busy_label: "Saving\u{2026}" }
                }
            }
        }
    }
}

/// Which of the composer's two fields a [`ReviewField`] edits.
#[derive(Clone, Copy, PartialEq)]
enum ReviewFieldKind {
    Body,
    Notes,
}

impl ReviewFieldKind {
    /// The id stem for the field's textarea, editor and testids.
    fn stem(self) -> &'static str {
        match self {
            Self::Body => "review-body",
            Self::Notes => "review-notes",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Body => "Review text",
            Self::Notes => "Private notes",
        }
    }

    fn placeholder(self) -> &'static str {
        match self {
            Self::Body => "What did you make of it? Everyone who opens this book can read this.",
            Self::Notes => "Notes to yourself \u{2014} only you will ever see these.",
        }
    }
}

/// One labelled Markdown field: its head, the toolbar row, the editor.
#[component]
fn ReviewField(
    field: ReviewFieldKind,
    uuid: String,
    server_url: String,
    body: Signal<String>,
    error: Signal<Option<String>>,
    highlights: HighlightsInsertState,
) -> Element {
    let stem = field.stem();
    let editor_id = format!("{stem}-editor");
    let private = field == ReviewFieldKind::Notes;
    rsx! {
        div {
            class: if private { "bd-review-field bd-review-field-private" } else { "bd-review-field" },
            "data-testid": "{stem}-field",
            div { class: "bd-review-field-head",
                span { class: "label", "{field.label()}" }
                span { class: "bd-journal-foot-spacer" }
                if private {
                    span { class: "mono bd-review-private-tag",
                        span { aria_hidden: "true", "\u{1F512} " }
                        "only you can see these"
                    }
                } else {
                    span {
                        class: "mono bd-journal-spoiler-help",
                        title: "Hide spoilers with ||double pipes|| \u{2014} they appear blurred until clicked.",
                        "Spoilers? Wrap text in ||double pipes||"
                    }
                }
            }
            div { class: "bd-journal-toolbar-row",
                BdJournalToolbar { target_id: editor_id.clone(), server_url: server_url.clone(), error }
                BdHighlightsInsert {
                    uuid,
                    server_url,
                    target_id: editor_id.clone(),
                    testid_prefix: stem.to_string(),
                    state: highlights,
                }
            }
            BdMarkdownSurface {
                source_id: format!("{stem}-src"),
                editor_id,
                body,
                label: field.label().to_string(),
                placeholder: field.placeholder().to_string(),
                source_testid: format!("{stem}-markdown"),
                editor_testid: format!("{stem}-editor"),
            }
        }
    }
}
