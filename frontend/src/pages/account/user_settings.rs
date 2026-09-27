//! "Omnibus User Settings" account card (Settings → Account): the table of
//! per-user feature switches, the book detail's scroll stops being the first.
//! A table because the list is expected to grow — a new switch is a row, not
//! a section — and each row saves on change, since independent switches have
//! nothing to batch a Save across.

use dioxus::prelude::*;
use omnibus_shared::UserSummary;

use crate::data;

/// One row of the user-settings table.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UserSetting {
    ScrollStops,
}

/// Every row the table renders, in display order.
const USER_SETTINGS: [UserSetting; 1] = [UserSetting::ScrollStops];

impl UserSetting {
    /// Testid stem: `user-setting-{slug}`, `{slug}-toggle`, `{slug}-error`.
    fn slug(self) -> &'static str {
        match self {
            UserSetting::ScrollStops => "scroll-stops",
        }
    }

    /// The row's name cell.
    fn name(self) -> &'static str {
        match self {
            UserSetting::ScrollStops => "Book details scroll stops",
        }
    }

    /// The switch's `aria-label`.
    fn aria_label(self) -> &'static str {
        match self {
            UserSetting::ScrollStops => "Use book details scroll stops",
        }
    }

    /// Subtitle describing what the setting currently does, in terms of how
    /// the page reads rather than restating the switch.
    fn status_line(self, enabled: Option<bool>) -> &'static str {
        match self {
            UserSetting::ScrollStops => match enabled {
                None => "Checking…",
                Some(true) => "Book details snap through one panel at a time.",
                Some(false) => "Book details scroll continuously, top to bottom.",
            },
        }
    }

    /// Read this setting's current value off the resolved viewer.
    fn read(self, user: &UserSummary) -> bool {
        match self {
            UserSetting::ScrollStops => user.book_detail_scroll_stops,
        }
    }

    /// Patch this setting's value onto the app-wide viewer after a save.
    fn write(self, user: &mut UserSummary, enabled: bool) {
        match self {
            UserSetting::ScrollStops => user.book_detail_scroll_stops = enabled,
        }
    }

    /// Save this setting's new value.
    async fn save(self, enabled: bool) -> Result<(), data::DataError> {
        match self {
            UserSetting::ScrollStops => data::set_book_detail_scroll_stops("", enabled).await,
        }
    }
}

/// `onchange` for a row's switch, shared by every [`UserSetting`] and
/// extracted so its guards and its failure revert are reachable from a test
/// without a browser. Mirrors the self-registration toggle in
/// `pages/settings/users/registration.rs`.
///
/// Ignores the event: the click already flipped the DOM checkbox, and the
/// value this writes comes from `confirmed`, not from the input.
fn user_setting_toggle_handler(
    setting: UserSetting,
    confirmed: Signal<Option<bool>>,
    mut shown: Signal<Option<bool>>,
    mut error: Signal<Option<String>>,
    mut saving: Signal<bool>,
    mut viewer_slot: Signal<Option<Option<UserSummary>>>,
) -> impl FnMut(Event<FormData>) {
    move |_| {
        let Some(current) = confirmed() else {
            return;
        };
        if saving() {
            return;
        }
        saving.set(true);
        // Track the native flip so a later revert is a real vdom change.
        let next = !current;
        shown.set(Some(next));
        let mut confirmed = confirmed;
        spawn(async move {
            match setting.save(next).await {
                Ok(()) => {
                    confirmed.set(Some(next));
                    error.set(None);
                    // Patch the app-wide viewer so a page opened next reads
                    // the new value — written from the value the server just
                    // accepted rather than re-fetched, since a failed
                    // refetch would leave the context stale with nothing to
                    // report.
                    viewer_slot.with_mut(|slot| {
                        if let Some(Some(user)) = slot.as_mut() {
                            setting.write(user, next);
                        }
                    });
                }
                Err(e) => {
                    // Push the checkbox back to what the server still holds.
                    shown.set(Some(current));
                    error.set(Some(e.to_string()));
                }
            }
            saving.set(false);
        });
    }
}

/// One row of the user-settings table, owning its own
/// confirmed/shown/error/saving signals.
///
/// Both `confirmed` and `shown` start `None` so SSR and the first WASM paint
/// emit the same markup (rule 07), and the switch stays disabled until the
/// viewer resolves so it can never be flipped against a value that hasn't
/// arrived. `confirmed` is what the server has acknowledged and drives the
/// subtitle; `shown` is what the checkbox renders. They are separate because
/// a click flips the DOM checkbox natively — if the rendered value never
/// moved, Dioxus would diff it as unchanged and a rejected save would leave
/// the box sitting in a state the server refused.
#[component]
fn UserSettingRow(setting: UserSetting) -> Element {
    let confirmed = use_signal(|| None::<bool>);
    let shown = use_signal(|| None::<bool>);
    let error = use_signal(|| None::<String>);
    let saving = use_signal(|| false);

    // Seed once from the resolved viewer. A later context refresh (another
    // row's save) must not clobber a value this row has since changed, so
    // the seed only ever fires while `confirmed` is still unresolved.
    let viewer = crate::use_current_user_summary();
    use_effect(move || {
        if confirmed.peek().is_some() {
            return;
        }
        if let Some(user) = viewer() {
            let mut confirmed = confirmed;
            let mut shown = shown;
            confirmed.set(Some(setting.read(&user)));
            shown.set(Some(setting.read(&user)));
        }
    });

    // Captured before the async save: `use_current_user` is a hook and can
    // only run during render.
    let viewer_slot = crate::use_current_user().0;
    let toggle = user_setting_toggle_handler(setting, confirmed, shown, error, saving, viewer_slot);
    let is_on = shown() == Some(true);
    let pending = confirmed().is_none();
    let slug = setting.slug();

    rsx! {
        tr { "data-testid": "user-setting-{slug}",
            td {
                div { class: "settings-row-name", "{setting.name()}" }
                div { class: "settings-row-note",
                    span {
                        class: if pending { "ld-sheen" } else { "{slug}-status" },
                        "{setting.status_line(confirmed())}"
                    }
                }
                if let Some(err) = error() {
                    p {
                        role: "alert",
                        class: "settings-status error",
                        "data-testid": "{slug}-error",
                        "{err}"
                    }
                }
            }
            td { class: "settings-col-switch",
                label { class: "settings-switch",
                    input {
                        r#type: "checkbox",
                        role: "switch",
                        "aria-label": "{setting.aria_label()}",
                        // Unknown: the knob waits at centre rather than claim off.
                        class: if pending { "ld-unknown" } else { "{slug}-check" },
                        "data-testid": "{slug}-toggle",
                        checked: is_on,
                        disabled: confirmed().is_none() || saving(),
                        onchange: toggle,
                    }
                }
            }
        }
    }
}

/// The per-user settings table (Settings → Account): one row per
/// [`UserSetting`], each saving independently on change.
#[cfg(not(feature = "mobile"))]
#[component]
pub(crate) fn UserSettingsCard() -> Element {
    rsx! {
        section { class: "card", "data-testid": "account-user-settings-card",
            h2 { "Omnibus User Settings" }
            p { class: "subtitle", "Features you can turn on for your account alone." }

            table { class: "users-table settings-table", "data-testid": "user-settings-table",
                thead {
                    tr {
                        th { "Setting" }
                        th { class: "settings-col-switch", "Enabled" }
                    }
                }
                tbody {
                    for setting in USER_SETTINGS {
                        UserSettingRow { key: "{setting.slug()}", setting }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
