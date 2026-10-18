//! Settings › Preferences: how Omnibus looks and behaves for one reader, in
//! four groups — Appearance (this device's theme), Library, Book page and
//! Privacy. Every control saves the moment it changes, so there is no Save
//! button here and nothing for the unsaved-changes guard to track.

use dioxus::prelude::*;

use crate::components::setting_row::SettingRow;
use crate::components::theme_picker::ThemePicker;
use crate::pages::account::hidden_formats::HiddenFormatsField;
use crate::pages::account::user_settings::{UserSetting, UserSettingSwitch};

/// The Preferences section body.
#[component]
pub(crate) fn PreferencesSection() -> Element {
    rsx! {
        section { class: "card", "data-testid": "preferences-appearance",
            h3 { "Appearance" }
            SettingRow {
                label: "Theme",
                description: "Applies to this device.",
                control_id: "theme-picker",
                ThemePicker { id: "theme-picker", described_by: "theme-picker-desc" }
            }
        }
        section { class: "card", "data-testid": "preferences-library",
            h3 { "Library" }
            UserSettingSwitch { setting: UserSetting::StackSeries }
            HiddenFormatsField {}
        }
        section { class: "card", "data-testid": "preferences-book-page",
            h3 { "Book page" }
            UserSettingSwitch { setting: UserSetting::ScrollStops }
        }
        section { class: "card", "data-testid": "preferences-privacy",
            h3 { "Privacy" }
            UserSettingSwitch { setting: UserSetting::ShareStats }
        }
    }
}

#[cfg(all(test, feature = "server"))]
mod tests;
