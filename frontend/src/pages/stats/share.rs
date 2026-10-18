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
/// viewer resolves (rule 12); it saves the way Preferences' switch does.
#[cfg(not(feature = "mobile"))]
#[component]
pub(super) fn ShareStatsToggle() -> Element {
    use crate::pages::account::user_settings::{saving, toggle, SaveState, UserSetting};

    let viewer = crate::use_current_user().0;
    let state = use_signal(|| SaveState::Idle);
    let shared = match &*viewer.read() {
        Some(Some(user)) => Some(user.share_stats),
        _ => None,
    };
    let pending = shared.is_none();

    rsx! {
        div { class: "st-share",
            label { class: "settings-switch st-share-switch",
                input {
                    r#type: "checkbox",
                    role: "switch",
                    class: if pending { "ld-unknown" },
                    "data-testid": "stats-share-toggle",
                    checked: shared == Some(true),
                    disabled: pending || saving(UserSetting::ShareStats),
                    onchange: move |_| toggle(UserSetting::ShareStats, viewer, state),
                }
                span { "Visible to your household" }
            }
            if state() == SaveState::Failed {
                span { class: "st-share-error", role: "alert", "data-testid": "stats-share-error",
                    "{SHARE_SAVE_ERROR}"
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

#[cfg(all(test, feature = "server"))]
mod tests;
