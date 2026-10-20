//! Your review card, always first in the section: the one-tap stars and their
//! status line, your rendered text with its spoiler checkbox, your private
//! notes (marked private), Write/Edit to open the composer, and Delete review
//! behind the app's confirm modal. Only this card carries edit controls.

use dioxus::prelude::*;
use omnibus_shared::Review;

use crate::components::{
    confirm_modal_body, fmt_stars, ConfirmModal, ConfirmModalAction, ConfirmModalTone,
};
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
    let mut composer_open = use_signal(|| false);
    let delete_confirm = use_signal(|| false);
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
    let pick_uuid = uuid.clone();
    let pick_url = server_url.clone();

    rsx! {
        section { class: "bd-review-mine", "data-testid": "my-review", aria_label: "Your review",
            div { class: "label bd-review-mine-k", "Your review" }
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
                    MyReviewWriting {
                        uuid: uuid.clone(),
                        ctx,
                        body_html,
                        notes_html,
                        spoiler: mine.as_ref().is_some_and(|r| r.spoiler),
                    }
                    div { class: "bd-review-actions",
                        button {
                            r#type: "button",
                            class: "btn sm",
                            "data-testid": "review-write",
                            onclick: move |_| composer_open.set(true),
                            if has_writing { "\u{270e} Edit review" } else { "\u{270e} Write review" }
                        }
                        // Mounted even with nothing to delete: the delete's own
                        // task re-reads the household after the card empties.
                        DeleteReviewButton {
                            uuid: uuid.clone(),
                            ctx,
                            shown: mine.is_some(),
                            confirm: delete_confirm,
                        }
                    }
                }
            }
            // Deliberately not click-outside-dismissable: a stray click must
            // not throw away an open draft.
            if composer_open() && overlay_composer {
                div { class: "bdmq-overlay bdmq-overlay-static", "data-testid": "review-composer-overlay",
                    div { class: "bdmq-ocard bdmq-ocard-composer",
                        BdReviewComposer { uuid: uuid.clone(), ctx, seed, open: composer_open }
                    }
                }
            }
        }
    }
}

/// Your rendered text with its spoiler checkbox, then your private notes,
/// marked as private. Either is absent until written.
#[component]
fn MyReviewWriting(
    uuid: String,
    ctx: ReviewsCtx,
    body_html: Option<String>,
    notes_html: Option<String>,
    spoiler: bool,
) -> Element {
    let server_url = use_server_url();
    let failed = (ctx.failure)() == Some(QuickWrite::Spoiler);
    rsx! {
        if let Some(html) = body_html {
            div {
                class: "bd-journal-entry-body bd-review-text",
                "data-testid": "my-review-text",
                dangerous_inner_html: "{html}",
            }
            div { class: "bd-review-spoilerrow",
                label { class: "bd-review-spoiler", "data-testid": "review-spoiler",
                    input {
                        r#type: "checkbox",
                        checked: spoiler,
                        oninput: move |e| {
                            let on = e.value() == "true";
                            writes::set_spoiler(ctx, uuid.clone(), server_url.clone(), on)
                        },
                    }
                    "Contains spoilers"
                }
                if failed {
                    span { class: "mono bd-journal-error", role: "alert", "data-testid": "review-spoiler-error",
                        "Couldn\u{2019}t save \u{2014} try again"
                    }
                }
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

/// Delete review and its confirm modal. The delete fires only from the
/// modal's own button and lands only on success; a refusal keeps the modal
/// open with the reason, and your review stays as it was. `shown` hides the
/// button once there is nothing to delete.
#[component]
fn DeleteReviewButton(
    uuid: String,
    ctx: ReviewsCtx,
    shown: bool,
    confirm: Signal<bool>,
) -> Element {
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
        if shown {
            button {
                r#type: "button",
                class: "btn ghost sm bd-journal-delete",
                "data-testid": "review-delete",
                onclick: move |_| {
                    error.set(None);
                    confirm.set(true);
                },
                "Delete review"
            }
        }
        if confirm() {
            ConfirmModal {
                testid: "review-delete-modal".to_string(),
                aria_label: "Delete your review?".to_string(),
                dialog_class: "mg-modal confirm-modal".to_string(),
                busy: is_busy,
                on_dismiss: move |_| {
                    if !busy() {
                        confirm.set(false);
                    }
                },
                {confirm_modal_body(
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
                            disabled: is_busy,
                            on_click: EventHandler::new(move |_| {
                                if !busy() {
                                    confirm.set(false);
                                }
                            }),
                        },
                        ConfirmModalAction {
                            testid: "review-delete-confirm".to_string(),
                            label: "Delete".to_string(),
                            busy_label: Some("Deleting\u{2026}".to_string()),
                            busy: is_busy,
                            tone: ConfirmModalTone::Danger,
                            disabled: is_busy,
                            on_click: EventHandler::new(do_delete),
                        },
                    ],
                )}
            }
        }
    }
}
