//! Sticky bottom save bar for the metadata edit page: dirty-field
//! summary on the left, error text, then `Discard edits` link + `Save`
//! button. The upload review form mounts the same bar in
//! [`SaveBarMode::Create`], where the primary action files the book and
//! "discard" means back to the picker rather than back to a detail page.
//!
//! Save click invokes the parent-provided `on_save` so the async
//! `save_overrides` call and navigation stay in `MetadataEditForm`.

use dioxus::prelude::*;
use dioxus_router::Link;

use crate::Route;

/// Dirty-tracking memos forwarded to the save bar.
///
/// `cover_replaced` is not a dirty *field*: against a saved book a cover
/// write lands on the server the moment it is picked, so it can never be part
/// of what Save sends. It is tracked here anyway because the bar's job is to
/// describe the state of the editor, and "No changes" over a book whose
/// cover just changed is a lie the reader acts on (#2241). Under review the
/// same flag means "a cover is staged", and Add does carry it.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct DirtyState {
    pub(crate) fields: Memo<Vec<&'static str>>,
    pub(crate) count: Memo<usize>,
    pub(crate) cover_replaced: Signal<bool>,
}

/// In-flight save status: in-progress flag plus last error message.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct SaveStatus {
    pub(crate) saving: Signal<bool>,
    pub(crate) error: Signal<Option<String>>,
}

/// What the bar's two actions mean.
#[derive(Clone, PartialEq)]
pub(crate) enum SaveBarMode {
    /// Editing a saved book: Discard is a link back to its detail page, and
    /// Save is only offered once there is something to save.
    Edit { uuid: String },
    /// Reviewing an upload: Discard drops the staged file, and the primary
    /// action adds the book whether or not a field was edited.
    Create,
}

/// Dirty-field summary + Discard/Save actions.
#[component]
pub(crate) fn SaveBar(
    mode: SaveBarMode,
    dirty: DirtyState,
    status: SaveStatus,
    on_save: EventHandler<()>,
    /// The Create-mode discard. Unused in Edit mode, where discard is a link.
    #[props(default)]
    on_discard: EventHandler<()>,
) -> Element {
    let DirtyState {
        fields: dirty_fields,
        count: dirty_count,
        cover_replaced,
    } = dirty;
    let creating = mode == SaveBarMode::Create;
    // Save is an exit, not only a write: once the cover has been replaced the
    // editor holds a change the reader can't take back here, so the button
    // has to let them leave through it rather than sitting greyed out. Under
    // review the book has to be addable untouched, so it is always live.
    let can_leave_via_save = creating || dirty_count() > 0 || cover_replaced();
    let SaveStatus {
        saving,
        error: save_error,
    } = status;
    rsx! {
        div { class: "me-save-bar",
            if dirty_count() > 0 {
                span { class: "me-dirty-dot" }
                span { class: "me-dirty-label",
                    {format!("{} field{} edited", dirty_count(), if dirty_count() != 1 { "s" } else { "" })}
                }
                span { class: "mono me-dirty-names",
                    {dirty_fields().join(" \u{b7} ")}
                }
            } else if cover_replaced() {
                span { class: "mono me-dirty-label", "data-testid": "me-cover-replaced",
                    if creating {
                        "Cover replaced \u{b7} saved with the book"
                    } else {
                        "Cover replaced \u{b7} already saved"
                    }
                }
            } else {
                span { class: "mono me-dirty-label", style: "color: var(--ink-3);",
                    "No changes"
                }
            }

            if let Some(err) = save_error() {
                span { class: "mono", style: "color: var(--bad); font-size: 12px; margin-left: 8px;",
                    "{err}"
                }
            }

            div { class: "me-save-actions",
                {match &mode {
                    // Leaves the field edits unsent. Labelled for what it
                    // actually drops: a replaced cover is already on the
                    // server and no button on this page can take it back.
                    SaveBarMode::Edit { uuid } => rsx! {
                        Link {
                            to: Route::BookDetail { uuid: uuid.clone() },
                            class: "btn ghost",
                            "data-testid": "me-discard",
                            "Discard edits"
                        }
                    },
                    SaveBarMode::Create => rsx! {
                        button {
                            r#type: "button",
                            class: "btn ghost",
                            "data-testid": "me-discard",
                            disabled: saving(),
                            onclick: move |_| on_discard.call(()),
                            "Start over"
                        }
                    },
                }}

                button {
                    class: "btn primary",
                    "data-testid": "me-save",
                    disabled: !can_leave_via_save || saving(),
                    onclick: move |_| on_save.call(()),
                    {save_label(creating, saving(), dirty_count())}
                }
            }
        }
    }
}

/// The primary button's text: what pressing it does right now.
fn save_label(creating: bool, saving: bool, dirty_count: usize) -> String {
    match (creating, saving) {
        (true, true) => "Adding\u{2026}".to_string(),
        (true, false) => "Add to library".to_string(),
        (false, true) => "Saving\u{2026}".to_string(),
        (false, false) if dirty_count > 0 => format!(
            "Save \u{b7} {dirty_count} field{}",
            if dirty_count != 1 { "s" } else { "" }
        ),
        (false, false) => "Done".to_string(),
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
