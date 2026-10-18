//! Library-cleanup review page (`/admin/cleanup/:kind`) — one suggestion card
//! at a time, decided with Accept / Reject / Skip, with an Undo for the last
//! change this sitting applied. Web/SSR only: the real
//! authorization boundary is the `AdminUser` extractor on the `cleanup/*`
//! server functions; the in-page `use_admin_access` gate keeps the chrome off a
//! non-admin screen.
#![cfg(not(feature = "mobile"))]

use dioxus::prelude::*;
use omnibus_shared::{CleanupAction, CleanupCounts, CleanupKind, Decision, SuggestionCard};

use crate::components::{BusyLabel, Loading, LoadingKind};
use crate::data::{self, CLEANUP_QUEUE_PAGE};
use crate::focus_after_paint::focus_after_paint;
use crate::{use_admin_access, use_server_url, Access};

pub(crate) mod card;
pub(crate) mod frame;

use card::{initial_value, is_editable, DecideBar, SuggestionCardView};
use frame::{kind_title, CleanupCrumb, CleanupKindLine, CleanupProgress};

/// What a pass did, counted as it goes so the end-of-pass card can report it.
/// Session-local by design: nothing on the server records "the reviewer typed
/// their own wording", and a tally that survived a reload would be claiming
/// more than it knows.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Tally {
    accepted: i64,
    accepted_edited: i64,
    rejected: i64,
    skipped: i64,
    undone: i64,
}

/// The change the reviewer applied last, which this page can still undo.
#[derive(Clone, PartialEq)]
struct Applied {
    log_id: i64,
    summary: String,
}

/// What the undo bar offers: nothing yet, the last applied change, or word
/// that it was undone.
#[derive(Clone, PartialEq)]
enum UndoState {
    None,
    Offer(Applied),
    Undone,
}

/// Signals the queue reducer owns, threaded together so the handlers below
/// take one argument instead of seven.
#[derive(Clone, Copy, PartialEq)]
struct QueueState {
    /// `None` until the first fetch resolves — the loading state.
    cards: Signal<Option<Vec<SuggestionCard>>>,
    /// Index of the card on screen. Past the end means the queue is worked
    /// through and the end-of-pass card shows.
    cursor: Signal<usize>,
    error: Signal<Option<String>>,
    in_flight: Signal<bool>,
    /// The proposed value as it currently reads, which the reviewer may have
    /// typed over.
    draft: Signal<String>,
    /// True while the caret is in the proposal field, which suspends the
    /// single-letter hotkeys.
    typing: Signal<bool>,
    tally: Signal<Tally>,
    undo: Signal<UndoState>,
    /// Bumped after an undo so the queue refetches and a reopened card returns.
    generation: Signal<u32>,
}

/// The `/settings/cleanup/:kind` review surface. An unrecognized `kind` slug
/// renders the not-found notice rather than silently reviewing another kind.
#[component]
pub fn CleanupReviewPage(kind: String) -> Element {
    let access = use_admin_access();
    let server_url = use_server_url();
    let parsed = CleanupKind::from_str(&kind);
    let state = QueueState {
        cards: use_signal(|| None),
        cursor: use_signal(|| 0usize),
        error: use_signal(|| None),
        in_flight: use_signal(|| false),
        draft: use_signal(String::new),
        typing: use_signal(|| false),
        tally: use_signal(Tally::default),
        undo: use_signal(|| UndoState::None),
        generation: use_signal(|| 0u32),
    };
    let counts = use_signal(|| None::<Vec<(CleanupKind, CleanupCounts)>>);

    spawn_queue_fetch(access, server_url.clone(), parsed, state);
    spawn_counts_fetch(access, server_url.clone(), counts);
    sync_draft_to_card(state);

    rsx! {
        div { class: "crx-root",
            CleanupCrumb { kind: parsed }
            div { class: "crx-stage",
                div {
                    class: "crx-column cleanup-review",
                    "data-testid": "cleanup-review",
                    tabindex: "0",
                    autofocus: true,
                    // `autofocus` only fires for markup the browser parsed at
                    // page load. This page is reached by a router `Link` from
                    // the settings dashboard, so the column is created after
                    // that — the attribute does nothing, focus stays on the
                    // link, and the hotkeys below never receive a keydown
                    // until somebody clicks the card.
                    onmounted: move |evt: MountedEvent| focus_after_paint(&evt),
                    onkeydown: move |evt: KeyboardEvent| {
                        on_review_key(evt, server_url.clone(), state);
                    },
                    div { class: "crx-head",
                        h1 { class: "crx-head-title", "{kind_title(parsed)}" }
                        if let Some(total) = loaded_total(state) {
                            CleanupProgress { index: (state.cursor)(), total }
                        }
                    }
                    CleanupKindLine { current: parsed, counts: ReadSignal::from(counts) }
                    match access() {
                        Access::Allowed => rsx! { CleanupReviewBody { kind: parsed, state } },
                        Access::Unknown => rsx! {
                            Loading {
                                kind: LoadingKind::Section,
                                testid: "cleanup-review-access-loading",
                                label: "Checking your access\u{2026}",
                            }
                        },
                        Access::Denied => rsx! {
                            p { class: "settings-status error", "data-testid": "cleanup-review-forbidden",
                                "Administrator access is required to review library cleanup."
                            }
                        },
                    }
                }
            }
        }
    }
}

/// How many cards this pass holds, once the queue has arrived and is not empty.
fn loaded_total(state: QueueState) -> Option<usize> {
    let cards = (state.cards)();
    let len = cards.as_ref()?.len();
    (len > 0).then_some(len)
}

/// Load the pending queue once the visitor is known to be an admin. An unknown
/// kind slug resolves to an empty queue so the page still renders its not-found
/// notice rather than hanging on the loading state.
fn spawn_queue_fetch(
    access: ReadSignal<Access>,
    server_url: String,
    kind: Option<CleanupKind>,
    state: QueueState,
) {
    let mut cards = state.cards;
    let mut cursor = state.cursor;
    let mut error = state.error;
    let generation = state.generation;
    use_effect(move || {
        let _ = generation();
        // Read inside the effect so it re-subscribes and re-runs when
        // `CurrentUser` resolves. It is `Unknown` on the first paint — firing
        // then is a guaranteed 401/403 against the admin-gated route, and the
        // non-admin branch never renders the body these signals feed.
        if access() != Access::Allowed {
            return;
        }
        let server_url = server_url.clone();
        error.set(None);
        cursor.set(0);
        spawn(async move {
            let Some(kind) = kind else {
                cards.set(Some(Vec::new()));
                return;
            };
            match data::get_cleanup_queue(&server_url, kind, CLEANUP_QUEUE_PAGE).await {
                Ok(queue) => cards.set(Some(queue)),
                Err(e) => {
                    cards.set(Some(Vec::new()));
                    error.set(Some(crate::data::server_error_message(&e)));
                }
            }
        });
    });
}

/// Load the per-kind pending counts that the kind chips wear. A failure here
/// leaves the chips countless rather than failing the page — the queue is what
/// the reviewer came for.
fn spawn_counts_fetch(
    access: ReadSignal<Access>,
    server_url: String,
    mut counts: Signal<Option<Vec<(CleanupKind, CleanupCounts)>>>,
) {
    use_effect(move || {
        if access() != Access::Allowed {
            return;
        }
        let server_url = server_url.clone();
        spawn(async move {
            if let Ok(loaded) = data::get_cleanup_counts(&server_url).await {
                counts.set(Some(loaded));
            }
        });
    });
}

/// Seed the editable proposal from whichever card is on screen, and re-seed it
/// on every move. Without this the reviewer's wording for one card would
/// follow them onto the next one.
fn sync_draft_to_card(state: QueueState) {
    let mut draft = state.draft;
    let cards = state.cards;
    let cursor = state.cursor;
    use_effect(move || {
        let value = current_card(&cards.read(), cursor())
            .map(|card| initial_value(&card))
            .unwrap_or_default();
        draft.set(value);
    });
}

/// Route a review hotkey to its action: `y` accepts, `n` rejects, Space skips.
/// Every other key falls through so the page keeps normal keyboard behaviour.
fn on_review_key(evt: KeyboardEvent, server_url: String, state: QueueState) {
    // A single letter is only a hotkey when it isn't being typed into the
    // proposal field.
    if (state.typing)() {
        return;
    }
    match review_key_action(&evt.key()) {
        Some(ReviewKey::Accept) => decide(server_url, state, Decision::Accepted),
        Some(ReviewKey::Reject) => decide(server_url, state, Decision::Rejected),
        Some(ReviewKey::Skip) => {
            evt.prevent_default();
            skip(state);
        }
        None => {}
    }
}

/// What a keypress means on the review surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReviewKey {
    Accept,
    Reject,
    Skip,
}

/// Map a `KeyboardEvent` key to its review action. Case-insensitive so
/// shift-held `Y` works, and deliberately narrow — anything else is not a
/// review hotkey.
fn review_key_action(key: &Key) -> Option<ReviewKey> {
    let Key::Character(c) = key else {
        return None;
    };
    match c.as_str() {
        "y" | "Y" => Some(ReviewKey::Accept),
        "n" | "N" => Some(ReviewKey::Reject),
        " " => Some(ReviewKey::Skip),
        _ => None,
    }
}

/// Move to the next card without deciding — Skip leaves the suggestion pending
/// so it comes back on the next pass.
///
/// A no-op once the queue is worked through, like Accept and Reject, so Space
/// on the end-of-pass screen doesn't keep counting skips into the tally — and
/// while a decision is in flight, whose own success is what advances.
fn skip(state: QueueState) {
    if (state.in_flight)() || current_card(&state.cards.read(), (state.cursor)()).is_none() {
        return;
    }
    let mut tally = state.tally;
    tally.write().skipped += 1;
    advance(state);
}

/// Move to the next card.
fn advance(state: QueueState) {
    let mut cursor = state.cursor;
    cursor.set(cursor() + 1);
}

/// The reviewer's wording, when it differs from what the detector proposed and
/// this kind can carry one. `None` means "apply the proposal as detected",
/// which is what the server does with an absent value.
fn edited_value(card: &SuggestionCard, draft: &str) -> Option<String> {
    if !is_editable(card) || draft == initial_value(card) {
        return None;
    }
    Some(draft.to_string())
}

/// What an applied card changed, for the undo bar.
fn applied_summary(card: &SuggestionCard, value: &str) -> String {
    match card.action {
        CleanupAction::Merge => format!("Merged into \u{201c}{value}\u{201d}."),
        CleanupAction::Rename => format!("Renamed to \u{201c}{value}\u{201d}."),
        CleanupAction::Split => format!("Split \u{201c}{}\u{201d}.", card.primary_name),
        CleanupAction::Delete => format!("Deleted \u{201c}{}\u{201d}.", card.primary_name),
    }
}

/// Send one Accept / Reject through `cleanup/decide`, then advance. Guarded on
/// `in_flight` so a held hotkey can't double-decide the same card. An applied
/// accept becomes the change the undo bar offers.
fn decide(server_url: String, state: QueueState, decision: Decision) {
    let QueueState {
        cards,
        cursor,
        mut error,
        mut in_flight,
        draft,
        mut tally,
        mut undo,
        ..
    } = state;
    if in_flight() {
        return;
    }
    let Some(card) = current_card(&cards.read(), cursor()) else {
        return;
    };
    let id = card.id;
    let summary = applied_summary(&card, &draft());
    let value = edited_value(&card, &draft());
    let was_edited = value.is_some();
    in_flight.set(true);
    error.set(None);
    spawn(async move {
        match data::decide_cleanup_suggestion(&server_url, id, decision, value).await {
            Ok(log_id) => {
                if let Some(log_id) = log_id {
                    undo.set(UndoState::Offer(Applied { log_id, summary }));
                }
                {
                    let mut t = tally.write();
                    match (decision, was_edited) {
                        (Decision::Accepted, true) => t.accepted_edited += 1,
                        (Decision::Accepted, false) => t.accepted += 1,
                        _ => t.rejected += 1,
                    }
                }
                advance(state);
            }
            Err(e) => error.set(Some(crate::data::server_error_message(&e))),
        }
        in_flight.set(false);
    });
}

/// Reverse the change the undo bar offers, then refetch the queue: undo
/// reopens its suggestion, so the card comes back if it still applies.
fn undo_last(server_url: String, state: QueueState) {
    let QueueState {
        mut error,
        mut in_flight,
        mut tally,
        mut undo,
        mut generation,
        ..
    } = state;
    let UndoState::Offer(applied) = undo() else {
        return;
    };
    if in_flight() {
        return;
    }
    in_flight.set(true);
    error.set(None);
    spawn(async move {
        match data::undo_cleanup(&server_url, applied.log_id).await {
            Ok(()) => {
                undo.set(UndoState::Undone);
                tally.write().undone += 1;
                generation.set(generation() + 1);
            }
            Err(e) => error.set(Some(crate::data::server_error_message(&e))),
        }
        in_flight.set(false);
    });
}

/// The card at `cursor`, or `None` once the queue is worked through.
fn current_card(cards: &Option<Vec<SuggestionCard>>, cursor: usize) -> Option<SuggestionCard> {
    cards.as_ref()?.get(cursor).cloned()
}

/// Loading / error / empty / card states for the review queue.
#[component]
fn CleanupReviewBody(kind: Option<CleanupKind>, state: QueueState) -> Element {
    let server_url = use_server_url();
    let error = (state.error)();
    let cards = (state.cards)();
    let card = current_card(&cards, (state.cursor)());
    rsx! {
        UndoBar {
            state: (state.undo)(),
            busy: (state.in_flight)(),
            on_undo: {
                let server_url = server_url.clone();
                move |()| undo_last(server_url.clone(), state)
            },
        }
        if kind.is_none() {
            p { class: "settings-status error", role: "status", "data-testid": "cleanup-review-unknown-kind",
                "Unknown cleanup kind."
            }
        }
        if let Some(message) = error {
            p { class: "settings-status error", role: "status", "data-testid": "cleanup-review-error",
                "{message}"
            }
        }
        if cards.is_none() {
            Loading {
                kind: LoadingKind::Section,
                testid: "cleanup-review-loading",
                label: "Gathering the suggestions\u{2026}",
            }
        } else if let Some(card) = card {
            SuggestionCardView {
                card: card.clone(),
                draft: state.draft,
                typing: state.typing,
                on_commit: {
                    let server_url = server_url.clone();
                    move |()| decide(server_url.clone(), state, Decision::Accepted)
                },
            }
            DecideBar {
                edited: edited_value(&card, &(state.draft)()).is_some(),
                editable: is_editable(&card),
                in_flight: (state.in_flight)(),
                on_accept: {
                    let server_url = server_url.clone();
                    move |()| decide(server_url.clone(), state, Decision::Accepted)
                },
                on_reject: {
                    let server_url = server_url.clone();
                    move |()| decide(server_url.clone(), state, Decision::Rejected)
                },
                on_skip: move |()| skip(state),
            }
        } else if kind.is_some() {
            PassDone { tally: (state.tally)() }
        }
    }
}

/// The last applied change and its Undo, or word that it was undone.
#[component]
fn UndoBar(state: UndoState, busy: bool, on_undo: EventHandler<()>) -> Element {
    match state {
        UndoState::None => rsx! {},
        UndoState::Offer(applied) => rsx! {
            div { class: "crx-undo", "data-testid": "cleanup-undo-bar",
                p { role: "status", "{applied.summary}" }
                button {
                    r#type: "button",
                    class: "btn ghost sm",
                    "data-testid": "cleanup-undo",
                    disabled: busy,
                    "aria-busy": if busy { "true" } else { "false" },
                    onclick: move |_| on_undo.call(()),
                    BusyLabel { busy, label: "Undo", busy_label: "Undoing\u{2026}" }
                }
            }
        },
        UndoState::Undone => rsx! {
            div { class: "crx-undo", "data-testid": "cleanup-undone",
                p { role: "status", "Change undone. The library is back as it was." }
            }
        },
    }
}

/// End of the pass: what this sitting actually did, and the way back.
#[component]
fn PassDone(tally: Tally) -> Element {
    let rows = [
        (tally.accepted, "accepted as proposed"),
        (tally.accepted_edited, "accepted with your wording"),
        (tally.rejected, "rejected"),
        (tally.skipped, "skipped \u{2014} comes back next pass"),
        (tally.undone, "undone"),
    ];
    rsx! {
        section { class: "card crx-card crx-card-done", "data-testid": "cleanup-card-done",
            p { class: "settings-status", role: "status", "data-testid": "cleanup-review-empty",
                "No suggestions pending."
            }
            // Only what this sitting did: a row for something that never
            // happened is noise, and an all-zero list is a reviewer who
            // arrived at an empty queue rather than one who worked through it.
            if rows.iter().any(|(n, _)| *n > 0) {
                ul { class: "crx-tally", "data-testid": "cleanup-tally",
                    for (n, label) in rows.iter().filter(|(n, _)| *n > 0) {
                        li { key: "{label}",
                            span { class: "crx-tally-n", "{n}" }
                            span { class: "crx-tally-l", "{label}" }
                        }
                    }
                }
            }
            p { class: "mes-foot", "The most recent change you applied can be undone from this page." }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
