//! The "Visible to your household" switch on the caller's own stats page: the
//! same `share_stats` preference Settings → Preferences holds, offered where
//! its effect is felt. Account configuration (rule 08), so a flip saves
//! straight to the server and a refusal puts the switch back with an inline
//! alert; nothing is queued.

use dioxus::prelude::*;

/// Shown when a save fails; the switch has already gone back.
#[cfg(not(feature = "mobile"))]
const SHARE_SAVE_ERROR: &str = "Couldn't change who can see your stats. Try again.";

/// The switch, bound to the app-wide viewer. Disabled at unknown until the
/// viewer resolves (rule 12); a flip patches the viewer at once so every
/// surface reading it agrees, and reverts it if the server refuses.
#[cfg(not(feature = "mobile"))]
#[component]
pub(super) fn ShareStatsToggle() -> Element {
    let viewer_slot = crate::use_current_user().0;
    let mut error = use_signal(|| None::<String>);
    let mut saving = use_signal(|| false);
    let shared = match &*viewer_slot.read() {
        Some(Some(user)) => Some(user.share_stats),
        _ => None,
    };
    let pending = shared.is_none();

    let on_change = move |_| {
        let was = match &*viewer_slot.peek() {
            Some(Some(user)) => user.share_stats,
            _ => return,
        };
        if *saving.peek() {
            return;
        }
        saving.set(true);
        error.set(None);
        set_viewer_share_stats(viewer_slot, !was);
        spawn(async move {
            if crate::data::set_share_stats("", !was).await.is_err() {
                set_viewer_share_stats(viewer_slot, was);
                error.set(Some(SHARE_SAVE_ERROR.to_string()));
            }
            saving.set(false);
        });
    };

    rsx! {
        div { class: "st-share",
            label { class: "settings-switch st-share-switch",
                input {
                    r#type: "checkbox",
                    role: "switch",
                    class: if pending { "ld-unknown" },
                    "data-testid": "stats-share-toggle",
                    checked: shared == Some(true),
                    disabled: pending || saving(),
                    onchange: on_change,
                }
                span { "Visible to your household" }
            }
            if let Some(message) = error() {
                span { class: "st-share-error", role: "alert", "data-testid": "stats-share-error",
                    "{message}"
                }
            }
        }
    }
}

/// The native shell sets sharing from its own settings screen.
#[cfg(feature = "mobile")]
#[component]
pub(super) fn ShareStatsToggle() -> Element {
    rsx! {}
}

/// Write `value` into the cached viewer's `share_stats`, if one is cached.
#[cfg(not(feature = "mobile"))]
fn set_viewer_share_stats(
    mut slot: Signal<Option<Option<omnibus_shared::UserSummary>>>,
    value: bool,
) {
    slot.with_mut(|s| {
        if let Some(Some(user)) = s.as_mut() {
            user.share_stats = value;
        }
    });
}

#[cfg(all(test, feature = "server"))]
mod tests;
