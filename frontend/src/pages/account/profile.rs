//! Profile card (Settings › Profile): display name + avatar. Both writes are
//! account configuration, so they go straight to the server and surface
//! failures inline (rule 08). Signals start empty so SSR and the first WASM
//! paint agree (rule 07); the name's Save waits for the seeded value and
//! reports unsaved edits to the settings shell.

use dioxus::prelude::*;
use omnibus_shared::UserSummary;

use crate::components::confirm_modal::{confirm_dialog, Confirm};
use crate::components::credential_card::live_status;
use crate::components::image_upload::use_file_upload;
use crate::components::unsaved::use_unsaved_guard;
use crate::components::user_avatar::UserAvatar;
use crate::components::BusyLabel;
use crate::{data, use_server_url};

/// Whether the name field holds an edit worth saving: never before it has
/// been seeded from the saved name, and never for whitespace alone.
fn display_name_changed(seeded: bool, input: &str, saved: Option<&str>) -> bool {
    seeded && input.trim() != saved.unwrap_or_default()
}

/// Signals backing the profile card — grouped so the seeding effect and the
/// three write-handler builders don't each take seven signal params. Mirrors
/// `KindleEmailSignals` in `account.rs`.
#[derive(Clone, Copy)]
struct ProfileSignals {
    name_input: Signal<String>,
    msg: Signal<Option<String>>,
    msg_is_error: Signal<bool>,
    in_flight: Signal<bool>,
    uploading: Signal<bool>,
    upload_error: Signal<Option<String>>,
    confirm_remove: Signal<bool>,
    // Seeded once from the resolved user; a later refresh must not clobber
    // what the user is mid-way through typing.
    seeded: Signal<bool>,
}

/// Seeds `name_input` from the resolved `CurrentUser` once. Mirrors
/// `use_kindle_email_hydration`'s shape in `account.rs`.
fn use_profile_seed_hydration(
    current_user: Signal<Option<Option<UserSummary>>>,
    mut signals: ProfileSignals,
) {
    use_effect(move || {
        if (signals.seeded)() {
            return;
        }
        if let Some(u) = current_user().flatten() {
            signals
                .name_input
                .set(u.display_name.clone().unwrap_or_default());
            signals.seeded.set(true);
        }
    });
}

/// Re-reads `/api/auth/me` into the app-wide `CurrentUser` context, so the
/// user menu and journal bylines repaint without a reload rather than each
/// guessing at the new value.
fn refresh_current_user(mut current_user: Signal<Option<Option<UserSummary>>>) {
    spawn(async move {
        if let Ok(u) = data::current_user().await {
            current_user.set(Some(u));
        }
    });
}

/// Report a profile write on the card's one status line, so every save —
/// name or picture — confirms the same way.
fn report_profile_saved(mut signals: ProfileSignals, message: &str) {
    signals.msg.set(Some(message.to_string()));
    signals.msg_is_error.set(false);
}

/// Drop the status line's last report, so an earlier save's confirmation
/// never passes for the write now in flight.
fn clear_profile_status(mut signals: ProfileSignals) {
    signals.msg.set(None);
}

/// Submit handler for the display-name save form. Mirrors
/// `kindle_save_handler`'s shape in `account.rs`.
fn profile_save_handler(
    server_url: String,
    current_user: Signal<Option<Option<UserSummary>>>,
    mut signals: ProfileSignals,
) -> impl FnMut(Event<FormData>) + 'static {
    move |evt: Event<FormData>| {
        evt.prevent_default();
        let trimmed = (signals.name_input)().trim().to_string();
        let value = (!trimmed.is_empty()).then_some(trimmed);
        let url = server_url.clone();
        signals.in_flight.set(true);
        clear_profile_status(signals);
        spawn(async move {
            match data::set_display_name(&url, value.clone()).await {
                Ok(()) => {
                    report_profile_saved(signals, "Profile saved.");
                    // Written from what the server accepted, so Save settles
                    // at once instead of waiting on a refetch.
                    let mut current_user = current_user;
                    current_user.with_mut(|slot| {
                        if let Some(Some(user)) = slot.as_mut() {
                            user.display_name = value;
                        }
                    });
                }
                Err(e) => {
                    signals.msg.set(Some(e.to_string()));
                    signals.msg_is_error.set(true);
                }
            }
            signals.in_flight.set(false);
        });
    }
}

/// `onchange` handler for the avatar file picker.
fn profile_avatar_upload_handler(
    server_url: String,
    current_user: Signal<Option<Option<UserSummary>>>,
    bust: Signal<u32>,
    signals: ProfileSignals,
) -> impl FnMut(Event<FormData>) + 'static {
    use_file_upload(
        signals.uploading,
        signals.upload_error,
        move |_| {
            clear_profile_status(signals);
            None
        },
        move |filename, mime, bytes| {
            let url = server_url.clone();
            async move { data::upload_avatar(&url, filename, mime, bytes).await }
        },
        move |()| {
            // `Signal` is `Copy` and shares its state, so a local mutable
            // copy bumps the same counter from this `Fn` closure.
            let mut bust = bust;
            bust += 1;
            report_profile_saved(signals, "Profile picture saved.");
            refresh_current_user(current_user);
        },
    )
}

/// The confirmed avatar removal; the dialog closes once the server answers.
fn profile_avatar_remove_handler(
    server_url: String,
    current_user: Signal<Option<Option<UserSummary>>>,
    bust: Signal<u32>,
    mut signals: ProfileSignals,
) -> EventHandler<()> {
    EventHandler::new(move |()| {
        let url = server_url.clone();
        let mut bust = bust;
        signals.uploading.set(true);
        clear_profile_status(signals);
        spawn(async move {
            match data::delete_avatar(&url).await {
                Ok(()) => {
                    signals.upload_error.set(None);
                    bust += 1;
                    report_profile_saved(signals, "Profile picture removed.");
                    refresh_current_user(current_user);
                }
                Err(e) => signals
                    .upload_error
                    .set(Some(format!("Remove failed: {e}"))),
            }
            signals.uploading.set(false);
            signals.confirm_remove.set(false);
        });
    })
}

/// Read-only display values for `profile_avatar_section`, grouped so the
/// function stays under clippy's `too_many_arguments` cap.
struct ProfileAvatarView<'a> {
    user_id: i64,
    display: &'a str,
    has_avatar: bool,
    bust: u32,
    uploading: bool,
    upload_error: Option<&'a str>,
}

/// The avatar identity + change/remove controls and their status line. Split
/// out of `ProfileCard` so the handler wiring above and this markup each
/// stay readable on their own — mirrors `kindle_email_form`'s split in
/// `account.rs`.
fn profile_avatar_section(
    view: ProfileAvatarView<'_>,
    on_pick_avatar: impl FnMut(Event<FormData>) + 'static,
    mut confirm_remove: Signal<bool>,
) -> Element {
    let ProfileAvatarView {
        user_id,
        display,
        has_avatar,
        bust,
        uploading,
        upload_error,
    } = view;
    rsx! {
        div { class: "profile-identity",
            div { class: "profile-avatar",
                UserAvatar {
                    user_id,
                    name: display.to_string(),
                    has_avatar,
                    class: "profile-initials",
                    bust,
                }
            }
            div { class: "profile-avatar-actions",
                div { class: "profile-avatar-buttons",
                    // The file input is the only element that can open the
                    // picker; inside its label it stays in the tab order
                    // (visually hidden) and the label shows its focus.
                    label { class: "btn sm profile-avatar-pick",
                        input {
                            r#type: "file",
                            id: "avatar-file",
                            class: "profile-avatar-input",
                            "data-testid": "avatar-file-input",
                            accept: "image/jpeg,image/png,image/webp,image/gif",
                            disabled: uploading,
                            onchange: on_pick_avatar,
                        }
                        "Change picture"
                    }
                    if has_avatar {
                        button {
                            r#type: "button",
                            class: "btn ghost sm",
                            "data-testid": "avatar-remove",
                            disabled: uploading,
                            onclick: move |_| confirm_remove.set(true),
                            "Remove picture"
                        }
                    }
                }
                p { class: "subtitle", "JPEG, PNG, WebP or GIF, up to 10\u{a0}MB." }
            }
        }

        {live_status("avatar-status", upload_error, true)}
    }
}

/// The display-name form: input, save action, and the helper hint. Mirrors
/// `kindle_email_form`'s split in `account.rs`.
fn profile_name_form(
    mut name_input: Signal<String>,
    mut msg: Signal<Option<String>>,
    in_flight: bool,
    changed: bool,
    display: &str,
    on_save: impl FnMut(Event<FormData>) + 'static,
) -> Element {
    rsx! {
        form {
            id: "profile-form",
            class: "settings-form",
            onsubmit: on_save,
            div { class: "settings-field",
                label { r#for: "display-name", "Display name" }
                input {
                    r#type: "text",
                    id: "display-name",
                    name: "display_name",
                    "data-testid": "display-name-input",
                    autocomplete: "nickname",
                    maxlength: "64",
                    placeholder: "{display}",
                    value: "{name_input}",
                    oninput: move |e| {
                        name_input.set(e.value());
                        msg.set(None);
                    },
                }
            }
            p { class: "subtitle",
                "Shown on your journals, ratings and shelves. Leave it empty to use your username."
            }
            div { class: "settings-actions",
                button {
                    r#type: "submit",
                    class: "btn primary",
                    disabled: in_flight || !changed,
                    "aria-busy": "{in_flight}",
                    "data-testid": "display-name-save",
                    BusyLabel { busy: in_flight, label: "Save display name", busy_label: "Saving\u{2026}" }
                }
            }
        }
    }
}

/// Display name + profile picture for the signed-in user.
///
/// A successful write re-fetches `/api/auth/me` into the app-wide
/// `CurrentUser` context (user menu, journal bylines and the "You" tab repaint
/// without a reload) and bumps the avatar cache-bust so the new image loads.
#[component]
pub(crate) fn ProfileCard() -> Element {
    let server_url = use_server_url();
    let current_user = crate::use_current_user().0;
    let bust = crate::use_avatar_cache_bust().0;

    let signals = ProfileSignals {
        name_input: use_signal(String::new),
        msg: use_signal(|| None::<String>),
        msg_is_error: use_signal(|| false),
        in_flight: use_signal(|| false),
        uploading: use_signal(|| false),
        upload_error: use_signal(|| None::<String>),
        confirm_remove: use_signal(|| false),
        seeded: use_signal(|| false),
    };
    use_profile_seed_hydration(current_user, signals);
    let changed = use_memo(move || {
        let saved = current_user().flatten().and_then(|u| u.display_name);
        display_name_changed(
            (signals.seeded)(),
            &(signals.name_input)(),
            saved.as_deref(),
        )
    });
    use_unsaved_guard("display-name", changed);

    let user = current_user().flatten();
    let on_save = profile_save_handler(server_url.clone(), current_user, signals);
    let on_pick_avatar =
        profile_avatar_upload_handler(server_url.clone(), current_user, bust, signals);
    let on_remove_avatar = profile_avatar_remove_handler(server_url, current_user, bust, signals);
    let mut confirm_remove = signals.confirm_remove;

    let has_avatar = user.as_ref().is_some_and(|u| u.has_avatar);
    let display = user
        .as_ref()
        .map(|u| u.display().to_string())
        .unwrap_or_default();

    rsx! {
        section { class: "card", "data-testid": "account-profile-card",
            h3 { "Profile" }
            p { class: "subtitle", "How you appear across the library." }

            {profile_avatar_section(
                ProfileAvatarView {
                    user_id: user.as_ref().map(|u| u.id).unwrap_or_default(),
                    display: &display,
                    has_avatar,
                    bust: bust(),
                    uploading: (signals.uploading)(),
                    upload_error: (signals.upload_error)().as_deref(),
                },
                on_pick_avatar,
                confirm_remove,
            )}

            {profile_name_form(signals.name_input, signals.msg, (signals.in_flight)(), changed(), &display, on_save)}

            {live_status("profile-status", (signals.msg)().as_deref(), (signals.msg_is_error)())}
        }
        if confirm_remove() {
            {confirm_dialog(
                Confirm {
                    testid: "avatar-remove-dialog",
                    title: "Remove your profile picture?",
                    body: "Other readers will see your initials instead.",
                    action: "Remove picture",
                    busy_label: "Removing\u{2026}",
                },
                (signals.uploading)(),
                EventHandler::new(move |()| confirm_remove.set(false)),
                on_remove_avatar,
            )}
        }
    }
}

// SSR render-smoke coverage. These need the `server` feature (`dioxus::ssr`).
#[cfg(all(test, feature = "server"))]
mod tests;
