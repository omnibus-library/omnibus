//! Cross-format resume on the web reader, plus the "Synced here" footer pill.
//! Opening a linked book whose listening position is newer moves the text to
//! the mapped spot (the server-derived CFI when available): silently with
//! follow on, through a banner under the top bar with it off. Web-only.
#![cfg(not(feature = "mobile"))]

use dioxus::prelude::*;
use omnibus_shared::cross_format::CrossFormatCandidate;

use crate::components::BusyLabel;
use crate::pages::listen::sync_prompt::{
    dismissed_clock, reader_offer_copy, reader_offer_visible, store_dismissed_clock, use_offer,
    SyncOfferCard, SYNCING,
};

/// The reader's cross-format resume: with follow on, applies the mapped
/// position at open and renders nothing; with it off, offers it. SSR and
/// the first WASM paint both render nothing, so they agree. `failed` hides
/// it behind the load error (see [`reader_offer_visible`]).
#[component]
pub(super) fn SyncJumpBanner(uuid: String, failed: bool) -> Element {
    let user = crate::use_current_user_summary();
    let mut offer = use_offer(uuid.clone(), "epub", true, jump_to);

    let Some(c) = offer() else {
        return rsx! {};
    };
    let Some(user_id) = user().map(|u| u.id) else {
        return rsx! {};
    };
    let clock = c.source_client_updated_at;
    if !reader_offer_visible(&c, failed, dismissed_clock(user_id, &uuid, "epub")) {
        return rsx! {};
    }
    let Some((title, detail)) = reader_offer_copy(&c) else {
        return rsx! {};
    };
    let go_uuid = uuid.clone();
    rsx! {
        SyncOfferCard {
            class: "rd-sync-banner",
            title,
            detail,
            on_go: move |_| {
                store_dismissed_clock(user_id, &go_uuid, "epub", clock);
                offer.set(None);
                jump_to(&c);
                refocus_surface();
            },
            on_dismiss: move |_| {
                store_dismissed_clock(user_id, &uuid, "epub", clock);
                offer.set(None);
                refocus_surface();
            },
        }
    }
}

/// Hand focus back to the page surface: the clicked button is removed with
/// the card, and focus left on `<body>` stops the arrow keys turning pages.
fn refocus_surface() {
    #[cfg(feature = "web")]
    let _ = dioxus::document::eval(
        "requestAnimationFrame(() => document.querySelector('.rd-surface')?.focus({ preventScroll: true }));",
    );
}

/// Move the text to the candidate's spot. The server-derived CFI is the
/// precise target (one ruler end to end); the locations-scale percentage is
/// only the fallback. Only the web target has a glue to drive.
fn jump_to(c: &CrossFormatCandidate) {
    #[cfg(feature = "web")]
    {
        if let Some(cfi) = c.epub_cfi.as_deref() {
            super::reader_call_json("displayCfi", cfi);
        } else if let Some(pct) = c
            .fraction
            .map(|f| (f * 100.0).clamp(0.0, 100.0))
            .or(c.percent.map(|p| p as f64))
        {
            super::reader_call("displayPercentage", &pct.to_string());
        }
    }
    #[cfg(not(feature = "web"))]
    let _ = c;
}

/// "Synced here" footer pill: declares the current reading position (full
/// precision) as a sync point, leaving an existing link's follow setting
/// alone. Configuration-shaped (rule 08): direct call, never queued,
/// failure shown in place.
#[component]
pub(super) fn SyncHerePill(uuid: String, loc: Signal<super::signals::RelocateData>) -> Element {
    let mut label = use_signal(|| "Synced here");
    let syncing = label() == SYNCING;
    // Seeded online for SSR parity (rule 07); reconciled post-mount.
    let mut online = use_signal(|| true);
    use_effect(move || online.set(crate::pages::listen::sync_prompt::browser_online()));
    // An anchor is only as good as the fraction it records: until the
    // locations pass resolves, `frac` is the rounded spine approximation
    // (and before the first relocate it's the 0.0 default with no CFI) —
    // declaring from either would bend every later mapping around a wrong
    // "ground truth" pair. Reactive read: the pill enables itself the
    // moment a precise relocate lands.
    let precise = {
        let l = loc.read();
        !l.pct_approx && l.cfi.is_some()
    };
    rsx! {
        button {
            class: "btn ghost sm rd-sync-here",
            r#type: "button",
            "data-testid": "reader-sync-here",
            title: "Declare the ebook and audiobook aligned at this spot",
            disabled: !online() || !precise || syncing,
            "aria-busy": if syncing { "true" } else { "false" },
            onclick: move |_| {
                if !crate::pages::listen::sync_prompt::browser_online() {
                    return;
                }
                let uuid = uuid.clone();
                let frac = loc.peek().frac;
                // The CFI names this spot on the server's own ruler; the
                // locations-scale fraction rides along as the fallback.
                let cfi = loc.peek().cfi.clone();
                spawn(async move {
                    label.set(SYNCING);
                    let decl = omnibus_shared::cross_format::DeclareSyncPoint {
                        book_uuid: uuid,
                        format: omnibus_shared::ProgressFormat::Epub,
                        ebook_fraction: Some(frac.clamp(0.0, 1.0)),
                        epub_cfi: cfi,
                        audio_book_file_id: None,
                        audio_seconds: None,
                    };
                    label.set(crate::data::declare_sync_and_label(decl).await);
                });
            },
            BusyLabel { busy: syncing, label: label(), busy_label: SYNCING }
        }
    }
}
