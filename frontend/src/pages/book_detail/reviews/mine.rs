//! Your review card, always first in the section: a head row with the pencil
//! (write or edit, opening the composer) and the trash can (delete, behind the
//! app's confirm modal), the one-tap stars and their status line, then your
//! rendered text and your private notes, marked private. Only this card
//! carries edit controls, and they are icons so the card reads as the review.

use dioxus::prelude::*;
use omnibus_shared::Review;

use crate::components::shelf_facets::pencil_glyph;
use crate::components::{
    confirm_modal_body, fmt_stars, ConfirmModal, ConfirmModalAction, ConfirmModalTone,
};
use crate::focus_after_paint::focus_after_paint;
use crate::time::now_unix;
use crate::use_server_url;

use super::composer::{BdReviewComposer, ComposerSeed};
use super::stars::BdStarPicker;
use super::{writes, QuickWrite, ReviewsCtx};

/// Your review card. `mine` is `None` until you rate or write something.
#[component]
pub(super) fn BdMyReview(
    uuid: String,
    ctx: ReviewsCtx,
    mine: Option<Review>,
    overlay_composer: bool,
) -> Element {
    let server_url = use_server_url();
    let composer_open = use_signal(|| false);
    let failure = (ctx.failure)();
    let stars = mine.as_ref().and_then(|r| r.stars);
    let body_html = mine
        .as_ref()
        .and_then(|r| rendered(r.body_md.as_deref(), r.body_html.as_deref()));
    let notes_html = mine
        .as_ref()
        .and_then(|r| rendered(r.notes_md.as_deref(), r.notes_html.as_deref()));
    let has_writing = body_html.is_some() || notes_html.is_some();
    let seed = ComposerSeed::of(mine.as_ref());
    // Inline, the composer takes the place of what it edits.
    let composing_inline = composer_open() && !overlay_composer;
    let dialog_title = if has_writing {
        "Edit your review"
    } else {
        "Write your review"
    };
    let pick_uuid = uuid.clone();
    let pick_url = server_url.clone();

    rsx! {
        section { class: "bd-review-mine", "data-testid": "my-review", aria_label: "Your review",
            MyReviewHead {
                uuid: uuid.clone(),
                ctx,
                has_writing,
                has_review: mine.is_some(),
                composer_open,
            }
            div { class: "bd-review-starsline",
                BdStarPicker {
                    value: stars,
                    on_pick: move |picked| {
                        writes::pick_stars(ctx, pick_uuid.clone(), pick_url.clone(), picked)
                    },
                }
                div { class: "mono bd-review-starsmeta", role: "status", "data-testid": "review-stars-meta",
                    {stars_meta(now_unix(), failure == Some(QuickWrite::Stars), mine.as_ref())}
                }
            }
            // One stable element around the swap, so the stars beside it keep
            // their handlers when the composer opens in place (rule 07).
            div { class: "bd-review-mine-body",
                if composing_inline {
                    BdReviewComposer { uuid: uuid.clone(), ctx, seed: seed.clone(), open: composer_open }
                } else {
                    MyReviewWriting { body_html, notes_html }
                }
            }
            if composer_open() && overlay_composer {
                ComposerDialog {
                    uuid: uuid.clone(),
                    ctx,
                    seed,
                    open: composer_open,
                    title: dialog_title,
                }
            }
        }
    }
}

/// The composer as a modal over the stage: a dialog that takes focus and
/// keeps Tab inside. Deliberately not dismissable by a stray click or Escape,
/// which must not throw away an open draft; Cancel and Save close it.
#[component]
fn ComposerDialog(
    uuid: String,
    ctx: ReviewsCtx,
    seed: ComposerSeed,
    open: Signal<bool>,
    title: &'static str,
) -> Element {
    rsx! {
        ConfirmModal {
            testid: "review-composer-overlay".to_string(),
            aria_label: title.to_string(),
            backdrop_class: "bdmq-overlay bdmq-overlay-static".to_string(),
            dialog_class: "bdmq-ocard bdmq-ocard-composer".to_string(),
            busy: false,
            on_dismiss: move |_| {},
            focus_on_open: true,
            BdReviewComposer { uuid, ctx, seed, open }
        }
    }
}

/// The card's head row: the label, then the pencil (hidden while the editor
/// is open, since that is what it opens) and the trash can at the far right.
#[component]
fn MyReviewHead(
    uuid: String,
    ctx: ReviewsCtx,
    has_writing: bool,
    has_review: bool,
    composer_open: Signal<bool>,
) -> Element {
    let mut composer_open = composer_open;
    let delete_confirm = use_signal(|| false);
    // Set when the pencil opens the editor, so focus comes back to it when
    // the editor closes rather than falling to the page.
    let mut refocus = use_signal(|| false);
    let write_label = if has_writing {
        "Edit review"
    } else {
        "Write review"
    };
    rsx! {
        div { class: "bd-review-mine-head",
            div { class: "label bd-review-mine-k", "Your review" }
            div { class: "bd-review-tools",
                if !composer_open() {
                    button {
                        r#type: "button",
                        class: "bd-review-tool",
                        "data-testid": "review-write",
                        aria_label: "{write_label}",
                        title: "{write_label}",
                        onclick: move |_| {
                            refocus.set(true);
                            composer_open.set(true);
                        },
                        onmounted: move |evt| {
                            if *refocus.peek() {
                                refocus.set(false);
                                focus_after_paint(&evt);
                            }
                        },
                        {pencil_glyph()}
                    }
                }
                if has_review {
                    DeleteReviewButton { uuid, ctx, confirm: delete_confirm }
                }
            }
        }
    }
}

/// Your rendered text, then your private notes, marked as private. Either is
/// absent until written. The spoiler flag is set in the composer, so read
/// mode carries no marker of it.
#[component]
fn MyReviewWriting(body_html: Option<String>, notes_html: Option<String>) -> Element {
    rsx! {
        if let Some(html) = body_html {
            div {
                class: "bd-journal-entry-body bd-review-text",
                "data-testid": "my-review-text",
                dangerous_inner_html: "{html}",
            }
        }
        if let Some(html) = notes_html {
            div { class: "bd-review-notes", "data-testid": "my-review-notes",
                div { class: "mono bd-review-notes-k",
                    span { aria_hidden: "true", "\u{1F512} " }
                    "Private notes \u{b7} only you can see these"
                }
                div { class: "bd-journal-entry-body", dangerous_inner_html: "{html}" }
            }
        }
    }
}

/// A written field's HTML, or its escaped source until the server has
/// rendered it. `None` when the field is empty.
pub(super) fn rendered(md: Option<&str>, html: Option<&str>) -> Option<String> {
    let md = md?;
    Some(html.map_or_else(|| escape_text(md), str::to_string))
}

/// Plain text, escaped for `dangerous_inner_html`.
fn escape_text(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The line beside your stars: a refused save first, then the rating and its
/// age, else an invitation.
pub(super) fn stars_meta(now: i64, failed: bool, mine: Option<&Review>) -> String {
    if failed {
        return "Couldn\u{2019}t save your rating \u{2014} try again".to_string();
    }
    match mine.and_then(|r| r.stars.map(|s| (s, r.rated_at.unwrap_or(r.updated_at)))) {
        Some((stars, at)) => format!("{} \u{b7} {} of 5", rated_ago(now, at), fmt_stars(stars)),
        None => "Not rated yet".to_string(),
    }
}

/// "rated N ago" from unix seconds against an injected `now`.
pub(super) fn rated_ago(now: i64, at: i64) -> String {
    let secs = (now - at).max(0);
    let plural = |n: i64| if n == 1 { "" } else { "s" };
    if secs < 60 {
        "rated just now".to_string()
    } else if secs < 3600 {
        let m = secs / 60;
        format!("rated {m} minute{} ago", plural(m))
    } else if secs < 86_400 {
        let h = secs / 3600;
        format!("rated {h} hour{} ago", plural(h))
    } else {
        let d = secs / 86_400;
        format!("rated {d} day{} ago", plural(d))
    }
}

/// The trash can and its confirm modal. The delete fires only from the
/// modal's own button and lands only on success; a refusal keeps the modal
/// open with the reason, and your review stays as it was.
#[component]
fn DeleteReviewButton(uuid: String, ctx: ReviewsCtx, confirm: Signal<bool>) -> Element {
    let server_url = use_server_url();
    let mut confirm = confirm;
    let mut busy = use_signal(|| false);
    let mut error = use_signal(|| None::<String>);
    let do_delete = move |_| {
        // A double-click can land before the disabled state re-renders.
        if busy() {
            return;
        }
        let uuid = uuid.clone();
        let url = server_url.clone();
        busy.set(true);
        error.set(None);
        spawn(async move {
            match writes::delete(ctx, &uuid, &url).await {
                Ok(()) => confirm.set(false),
                Err(e) => error.set(Some(e.to_string())),
            }
            busy.set(false);
        });
    };
    let is_busy = busy();
    let note = error().map(|msg| {
        rsx! {
            p { class: "mono bd-journal-error", role: "alert", "data-testid": "review-delete-error", "{msg}" }
        }
    });
    rsx! {
        button {
            r#type: "button",
            class: "bd-review-tool bd-review-tool-danger",
            "data-testid": "review-delete",
            aria_label: "Delete review",
            title: "Delete review",
            onclick: move |_| {
                error.set(None);
                confirm.set(true);
            },
            {trash_glyph()}
        }
        if confirm() {
            ConfirmModal {
                testid: "review-delete-modal".to_string(),
                aria_label: "Delete your review?".to_string(),
                dialog_class: "mg-modal confirm-modal".to_string(),
                busy: is_busy,
                focus_on_open: true,
                on_dismiss: move |_| {
                    if !busy() {
                        confirm.set(false);
                    }
                },
                {delete_modal_body(is_busy, note, EventHandler::new(move |_| {
                    if !busy() {
                        confirm.set(false);
                    }
                }), EventHandler::new(do_delete))}
            }
        }
    }
}

/// The delete dialog's copy and its Cancel / Delete row, with `note` (the
/// refusal, when there was one) above the buttons.
fn delete_modal_body(
    busy: bool,
    note: Option<Element>,
    on_cancel: EventHandler<()>,
    on_delete: EventHandler<()>,
) -> Element {
    confirm_modal_body(
        "Delete your review?",
        "This removes your stars, your review and your private notes for good. This can\u{2019}t be undone.",
        note,
        vec![
            ConfirmModalAction {
                testid: "review-delete-cancel".to_string(),
                label: "Cancel".to_string(),
                busy_label: None,
                busy: false,
                tone: ConfirmModalTone::Ghost,
                disabled: busy,
                on_click: on_cancel,
            },
            ConfirmModalAction {
                testid: "review-delete-confirm".to_string(),
                label: "Delete".to_string(),
                busy_label: Some("Deleting\u{2026}".to_string()),
                busy,
                tone: ConfirmModalTone::Danger,
                disabled: busy,
                on_click: on_delete,
            },
        ],
    )
}

/// Trash-can icon for the delete tool, stroked like the pencil beside it.
fn trash_glyph() -> Element {
    rsx! {
        svg {
            width: "15", height: "15", view_box: "0 0 24 24", fill: "none",
            stroke: "currentColor", stroke_width: "2", stroke_linecap: "round", stroke_linejoin: "round",
            "aria-hidden": "true",
            polyline { points: "3 6 5 6 21 6" }
            path { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }
            line { x1: "10", y1: "11", x2: "10", y2: "17" }
            line { x1: "14", y1: "11", x2: "14", y2: "17" }
        }
    }
}
