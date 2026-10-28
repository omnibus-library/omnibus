//! Cross-format resume on the web reader and player: the resume fetch, the
//! offer both surfaces show when follow is off, its dismissal memory, and
//! the "Synced here" toolbar control. With follow on there is no offer — the
//! listen boot and the reader's resolver move to the mapped spot silently.
//! With it off nothing moves until the reader takes the offer, the shape the
//! iOS client shares. Web-only surface, like the mini dock.
#![cfg(not(feature = "mobile"))]

use dioxus::prelude::*;
use omnibus_shared::cross_format::{
    CrossFormatCandidate, CrossFormatResume, CrossFormatResumeState,
};

use crate::components::BusyLabel;

#[cfg(test)]
mod tests;

/// The candidate a follow-off link offers. Follow on resolves silently
/// instead, so it never offers.
pub(crate) fn offer_candidate(resume: CrossFormatResume) -> Option<CrossFormatCandidate> {
    if resume.follow || resume.state != CrossFormatResumeState::Candidate {
        return None;
    }
    resume.candidate
}

/// Re-arm rule: an offer the reader declined or took stays quiet until the
/// other format's position is saved again.
pub(crate) fn should_offer(source_clock: i64, dismissed: Option<i64>) -> bool {
    dismissed.is_none_or(|seen| source_clock > seen)
}

/// Keyed per account: household readers can share a browser.
fn dismissed_key(user_id: i64, uuid: &str, target: &str) -> String {
    format!("omn.syncprompt::{user_id}::{uuid}::{target}")
}

/// The newest source clock this account declined or took for `(book, target)`.
pub(crate) fn dismissed_clock(user_id: i64, uuid: &str, target: &str) -> Option<i64> {
    crate::client_store::get(&dismissed_key(user_id, uuid, target))?
        .parse()
        .ok()
}

/// Remember an answered offer (see [`should_offer`]). Never a progress write.
pub(crate) fn store_dismissed_clock(user_id: i64, uuid: &str, target: &str, clock: i64) {
    let stored = newest_dismissed(dismissed_clock(user_id, uuid, target), clock);
    crate::client_store::set(&dismissed_key(user_id, uuid, target), &stored.to_string());
}

/// The clock to store: never older than what another tab already answered,
/// or that tab's newer offer would resurface.
fn newest_dismissed(stored: Option<i64>, clock: i64) -> i64 {
    stored.map_or(clock, |seen| seen.max(clock))
}

/// The reader offer's title and detail. An earlier listening position must
/// not read as further on. `None` without a percent to name.
pub(crate) fn reader_offer_copy(c: &CrossFormatCandidate) -> Option<(&'static str, String)> {
    let pct = c.percent?;
    Some(if c.source_ahead == Some(false) {
        (
            "Audiobook is earlier in the book",
            format!("Your listening maps to about {pct}% \u{2014} before this page."),
        )
    } else {
        (
            "Listened further in the audiobook",
            format!("Your listening maps to about {pct}% through."),
        )
    })
}

/// The player offer's title and detail (see [`reader_offer_copy`]).
fn player_offer_copy(c: &CrossFormatCandidate) -> Option<(&'static str, String)> {
    let at = super::helpers::format_hms(c.audio_position_seconds?);
    let title = if c.source_ahead == Some(false) {
        "Re-reading earlier in the ebook"
    } else {
        "Read further in the ebook"
    };
    Some((title, format!("Your reading maps to about {at}.")))
}

/// The offer's markup on both surfaces; `class` places it.
#[component]
pub(crate) fn SyncOfferCard(
    class: &'static str,
    title: &'static str,
    detail: String,
    on_go: EventHandler<()>,
    on_dismiss: EventHandler<()>,
) -> Element {
    rsx! {
        div { class: "{class} card", role: "status", "data-testid": "sync-offer",
            div { class: "sync-offer-copy",
                strong { "{title}" }
                span { "{detail}" }
            }
            button {
                class: "btn sm",
                r#type: "button",
                "data-testid": "sync-offer-go",
                onclick: move |_| on_go.call(()),
                "Go"
            }
            button {
                class: "btn ghost sm",
                r#type: "button",
                "data-testid": "sync-offer-dismiss",
                "aria-label": "Dismiss",
                onclick: move |_| on_dismiss.call(()),
                "\u{2715}"
            }
        }
    }
}

/// Whether the player shows `c`: this book's boot has restored its position,
/// playback hasn't failed, the mapped file is the one loaded (the candidate's
/// seconds count from its start), and the offer hasn't been answered.
pub(crate) fn player_offer_visible(
    c: &CrossFormatCandidate,
    restored: bool,
    failed: bool,
    loaded_file: Option<i64>,
    dismissed: Option<i64>,
) -> bool {
    restored
        && !failed
        && c.book_file_id.is_some()
        && c.book_file_id == loaded_file
        && should_offer(c.source_client_updated_at, dismissed)
}

/// The player's offer: the candidate the boot that loaded this book fetched
/// (see [`player_offer_visible`]).
#[component]
pub(super) fn SyncJumpPrompt(uuid: String) -> Element {
    let playback = crate::use_playback();
    let user = crate::use_current_user_summary();
    let landed = use_restore_landed(playback);
    let mut offer = playback.sync_offer;

    let Some(c) = offer()
        .filter(|(for_uuid, _)| *for_uuid == uuid)
        .map(|(_, c)| c)
    else {
        return rsx! {};
    };
    let Some(user_id) = user().map(|u| u.id) else {
        return rsx! {};
    };
    let restored = landed() && (playback.uuid)().as_deref() == Some(uuid.as_str());
    let clock = c.source_client_updated_at;
    if !player_offer_visible(
        &c,
        restored,
        (playback.playback_failed)(),
        (playback.loaded_file_id)(),
        dismissed_clock(user_id, &uuid, "audio"),
    ) {
        return rsx! {};
    }
    let (Some(seconds), Some((title, detail))) = (c.audio_position_seconds, player_offer_copy(&c))
    else {
        return rsx! {};
    };
    let go_uuid = uuid.clone();
    rsx! {
        SyncOfferCard {
            class: "lp-sync-prompt",
            title,
            detail,
            on_go: move |_| {
                store_dismissed_clock(user_id, &go_uuid, "audio", clock);
                offer.set(None);
                super::helpers::seek_to(seconds);
            },
            on_dismiss: move |_| {
                store_dismissed_clock(user_id, &uuid, "audio", clock);
                offer.set(None);
            },
        }
    }
}

/// Whether the current boot's resume seek has run. The boot restores in a
/// `loadedmetadata` listener, so a Go before then would be rewound to the
/// stored row; the card waits for it instead. Armed only once the boot has
/// committed its source: the element keeps the previous book's ready state
/// until then.
fn use_restore_landed(playback: crate::PlaybackState) -> Signal<bool> {
    let mut landed = use_signal(|| false);
    let mut generation = use_signal(|| 0_u64);
    use_effect(move || {
        let waiting = (playback.hls_ready)() && playback.sync_offer.read().is_some();
        landed.set(false);
        let mine = *generation.peek() + 1;
        generation.set(mine);
        if !waiting {
            return;
        }
        spawn(async move {
            if metadata_loaded().await && *generation.peek() == mine {
                landed.set(true);
            }
        });
    });
    landed
}

/// Resolves once the player's element has metadata — true — or fails to load.
async fn metadata_loaded() -> bool {
    #[cfg(feature = "web")]
    {
        let mut eval = dioxus::document::eval(
            "const el = document.getElementById('omnibus-audio');\n\
             if (!el) { dioxus.send(false); }\n\
             else if (el.readyState >= 1) { dioxus.send(true); }\n\
             else {\n\
               el.addEventListener('loadedmetadata', () => dioxus.send(true), { once: true });\n\
               el.addEventListener('error', () => dioxus.send(false), { once: true });\n\
             }",
        );
        eval.recv::<bool>().await.unwrap_or(false)
    }
    #[cfg(not(feature = "web"))]
    {
        false
    }
}

/// The follow-off candidate for `uuid`, fetched after mount and again on a
/// book swap: the page outlives its route param, so an answer for a book no
/// longer open is dropped. With follow on, `on_follow` takes the candidate
/// instead and the signal stays empty.
pub(crate) fn use_offer(
    uuid: String,
    target: &'static str,
    derive_cfi: bool,
    on_follow: fn(&CrossFormatCandidate),
) -> Signal<Option<CrossFormatCandidate>> {
    let mut offer = use_signal(|| None::<CrossFormatCandidate>);
    let mut current = use_signal(String::new);
    use_effect(use_reactive!(|uuid| {
        offer.set(None);
        current.set(uuid.clone());
        spawn(async move {
            let Some(resume) = fetch_resume_with(&uuid, target, derive_cfi).await else {
                return;
            };
            if *current.peek() != uuid {
                return;
            }
            match (resume.follow, &resume.candidate) {
                (true, Some(c)) if resume.state == CrossFormatResumeState::Candidate => {
                    on_follow(c)
                }
                _ => offer.set(offer_candidate(resume)),
            }
        });
    }));
    offer
}

/// Fetch the full cross-format resume for `(uuid, target)` — raw REST
/// over the same-origin cookie session. `derive_cfi` asks the server to
/// attach the mapped point CFI (`?derive=cfi`) — only the
/// reader surfaces ask (`derive=cfi` opens the EPUB server-side), so the
/// audio callers stay on the plain fetch.
pub(crate) async fn fetch_resume_with(
    uuid: &str,
    target: &str,
    derive_cfi: bool,
) -> Option<omnibus_shared::cross_format::CrossFormatResume> {
    #[cfg(feature = "web")]
    {
        let derive = if derive_cfi { "&derive=cfi" } else { "" };
        let url = format!("/api/books/{uuid}/cross-format-resume?target={target}{derive}");
        let resp = gloo_net::http::Request::get(&url).send().await.ok()?;
        if resp.status() != 200 {
            return None;
        }
        resp.json().await.ok()
    }
    #[cfg(not(feature = "web"))]
    {
        let _ = (uuid, target, derive_cfi);
        None
    }
}

/// "Synced here" toolbar control: declares the current listening position
/// as a sync point, leaving an existing link's follow setting alone.
/// Configuration-shaped (rule 08): direct call, never queued, failure
/// shown in place.
#[component]
pub(super) fn SyncHereButton() -> Element {
    let playback = crate::use_playback();
    let mut label = use_signal(|| "Synced here");
    let syncing = label() == SYNCING;
    // Seeded online for SSR parity (rule 07); reconciled post-mount.
    let mut online = use_signal(|| true);
    use_effect(move || online.set(browser_online()));
    rsx! {
        button {
            class: "btn sm lp-toolbar-btn",
            r#type: "button",
            "data-testid": "listen-sync-here",
            title: "Declare the ebook and audiobook aligned at this spot",
            disabled: !online() || syncing,
            "aria-busy": if syncing { "true" } else { "false" },
            onclick: move |_| {
                if !browser_online() {
                    return;
                }
                let Some(uuid) = (playback.uuid)() else { return };
                let decl = omnibus_shared::cross_format::DeclareSyncPoint {
                    book_uuid: uuid,
                    format: omnibus_shared::ProgressFormat::Audio,
                    ebook_fraction: None,
                    epub_cfi: None,
                    // The RESOLVED file, not the picker request: `file_id`
                    // is `None` on every ordinary resume path, and a
                    // file-less audio declaration on a multi-file timeline
                    // is (correctly) rejected server-side.
                    audio_book_file_id: (playback.loaded_file_id)(),
                    audio_seconds: Some((playback.elapsed)()),
                };
                spawn(async move {
                    label.set(SYNCING);
                    label.set(crate::data::declare_sync_and_label(decl).await);
                });
            },
            BusyLabel { busy: syncing, label: label(), busy_label: SYNCING }
        }
    }
}

/// The "synced here" controls' label while a declaration is in flight.
pub(crate) const SYNCING: &str = "Syncing\u{2026}";

/// Whether the browser reports connectivity — the "synced here" controls
/// disable offline (rule 08). Always `true` off-web.
pub(crate) fn browser_online() -> bool {
    #[cfg(feature = "web")]
    {
        web_sys::window()
            .map(|w| w.navigator().on_line())
            .unwrap_or(true)
    }
    #[cfg(not(feature = "web"))]
    {
        true
    }
}
