//! The per-user preference switches in Settings › Preferences — Stack series,
//! the book page's scroll stops, sharing stats with the household — plus the
//! inline autosave status every Preferences control shares. Each switch is
//! account configuration (rule 08): a change saves straight to the server,
//! patching the cached viewer optimistically and putting it back if the
//! server refuses, the way the landing's Stack series toggle does.

use dioxus::prelude::*;
use omnibus_shared::UserSummary;

use crate::components::setting_row::SettingRow;
use crate::data;

/// One preference switch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UserSetting {
    StackSeries,
    ScrollStops,
    ShareStats,
}

impl UserSetting {
    /// Testid stem: `user-setting-{slug}`, `{slug}-toggle`, `{slug}-status`.
    fn slug(self) -> &'static str {
        match self {
            UserSetting::StackSeries => "stack-series",
            UserSetting::ScrollStops => "scroll-stops",
            UserSetting::ShareStats => "share-stats",
        }
    }

    /// The row's label, which is also the switch's accessible name.
    fn name(self) -> &'static str {
        match self {
            UserSetting::StackSeries => "Stack series",
            UserSetting::ScrollStops => "Scroll stops",
            UserSetting::ShareStats => "Share stats with household",
        }
    }

    /// What the setting does, under its label.
    fn description(self) -> &'static str {
        match self {
            UserSetting::StackSeries => "Fold each series into one stack in the library grid.",
            UserSetting::ScrollStops => {
                "Snap a book\u{2019}s page through one panel at a time instead of scrolling it."
            }
            UserSetting::ShareStats => {
                "Let other readers on this server see your Stats page. On by default."
            }
        }
    }

    /// This setting's value on the cached viewer.
    pub(crate) fn read(self, user: &UserSummary) -> bool {
        match self {
            UserSetting::StackSeries => user.stack_series,
            UserSetting::ScrollStops => user.book_detail_scroll_stops,
            UserSetting::ShareStats => user.share_stats,
        }
    }

    /// Write this setting's value onto the cached viewer.
    pub(crate) fn write(self, user: &mut UserSummary, enabled: bool) {
        match self {
            UserSetting::StackSeries => user.stack_series = enabled,
            UserSetting::ScrollStops => user.book_detail_scroll_stops = enabled,
            UserSetting::ShareStats => user.share_stats = enabled,
        }
    }

    /// Save this setting's new value.
    async fn save(self, enabled: bool) -> Result<(), data::DataError> {
        match self {
            UserSetting::StackSeries => data::set_stack_series("", enabled).await,
            UserSetting::ScrollStops => data::set_book_detail_scroll_stops("", enabled).await,
            UserSetting::ShareStats => data::set_share_stats("", enabled).await,
        }
    }
}

/// How an autosaving control's last save went.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SaveState {
    Idle,
    Saving,
    Saved,
    Failed,
}

/// The inline status beside an autosaving control.
pub(crate) fn save_state_text(state: SaveState) -> &'static str {
    match state {
        SaveState::Idle => "",
        SaveState::Saving => "Saving\u{2026}",
        SaveState::Saved => "Saved",
        SaveState::Failed => "Couldn\u{2019}t save. Try again.",
    }
}

/// The status as a live region, mounted before the first save so that save is
/// announced too.
pub(crate) fn save_status(testid: &str, state: SaveState) -> Element {
    let class = match state {
        SaveState::Failed => "pref-status error",
        SaveState::Saving => "pref-status ld-sheen",
        SaveState::Idle | SaveState::Saved => "pref-status",
    };
    rsx! {
        span { role: "status", class, "data-testid": "{testid}", "{save_state_text(state)}" }
    }
}

/// One switch row. It reads the cached viewer directly, so it is unknown (and
/// disabled) until `/me` resolves and never claims off before then.
#[component]
pub(crate) fn UserSettingSwitch(setting: UserSetting) -> Element {
    let viewer = crate::use_current_user().0;
    let state = use_signal(|| SaveState::Idle);
    let value = match &*viewer.read() {
        Some(Some(user)) => Some(setting.read(user)),
        _ => None,
    };
    let slug = setting.slug();
    let id = format!("{slug}-toggle");

    rsx! {
        SettingRow {
            label: setting.name(),
            description: setting.description(),
            control_id: id.clone(),
            testid: format!("user-setting-{slug}"),
            div { class: "pref-control",
                {save_status(&format!("{slug}-status"), state())}
                span { class: "settings-switch",
                    input {
                        r#type: "checkbox",
                        role: "switch",
                        id: "{id}",
                        "aria-describedby": "{id}-desc",
                        // Unknown: the knob waits at centre rather than claim off.
                        class: if value.is_none() { "ld-unknown" },
                        "data-testid": "{id}",
                        checked: value == Some(true),
                        disabled: value.is_none() || state() == SaveState::Saving,
                        onchange: move |_| toggle(setting, viewer, state),
                    }
                }
            }
        }
    }
}

/// Flip `setting` on the cached viewer and save it, putting it back on failure.
/// The click already flipped the DOM checkbox, so the rendered value has to
/// move with it for a revert to be a real vdom change.
fn toggle(
    setting: UserSetting,
    viewer: Signal<Option<Option<UserSummary>>>,
    mut state: Signal<SaveState>,
) {
    let Some(Some(was)) = viewer
        .peek()
        .as_ref()
        .map(|v| v.as_ref().map(|u| setting.read(u)))
    else {
        return;
    };
    if *state.peek() == SaveState::Saving {
        return;
    }
    state.set(SaveState::Saving);
    write_viewer(viewer, setting, !was);
    spawn(async move {
        match setting.save(!was).await {
            Ok(()) => state.set(SaveState::Saved),
            Err(_) => {
                write_viewer(viewer, setting, was);
                state.set(SaveState::Failed);
            }
        }
    });
}

/// Write `enabled` into the cached viewer, if one is cached.
fn write_viewer(
    mut viewer: Signal<Option<Option<UserSummary>>>,
    setting: UserSetting,
    enabled: bool,
) {
    viewer.with_mut(|slot| {
        if let Some(Some(user)) = slot.as_mut() {
            setting.write(user, enabled);
        }
    });
}

#[cfg(all(test, feature = "server"))]
mod tests;
