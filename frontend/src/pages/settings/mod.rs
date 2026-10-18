//! Personal settings (`/settings`), a sidebar of the five sections every
//! reader owns (Profile, Preferences, Goals, Devices, Sign-in & security),
//! picked by `?section=`. Server configuration lives under `/admin`
//! ([`crate::pages::admin`]), which reuses this module's shell and the admin
//! cards declared here. An older `?section=` slug redirects to its new home.
//! The mobile shell has no sidebar and renders its library/admin cards flat.

// Web/server only: the API-token management card calls the web-only
// `data::*_api_token` wrappers (no mobile surface).
#[cfg(not(feature = "mobile"))]
mod api_tokens;
// Web/server only: the hosted-/mcp admin toggle calls the web-only
// `data::mcp_status`/`set_mcp_enabled` wrappers (no mobile surface).
#[cfg(not(feature = "mobile"))]
pub(crate) mod mcp;
// Web/server only: the Background Tasks dashboard calls the web-only
// `data::get_background_tasks` (no mobile RPC route yet).
#[cfg(not(feature = "mobile"))]
pub(crate) mod background_tasks;
// Web/server only: the Library cleanup section calls the web-only
// `data::get_cleanup_counts`/`run_cleanup_detection` (no mobile surface).
#[cfg(not(feature = "mobile"))]
pub(crate) mod cleanup;
// Web/server only: the format-conversion card calls the web-only
// `data::get_ebook_convert`/`save_ebook_convert` (no mobile RPC route yet).
#[cfg(not(feature = "mobile"))]
pub(crate) mod ebook_convert;
pub(crate) mod library;
// Web/server only: Preferences composes the web-only account cards.
#[cfg(not(feature = "mobile"))]
mod preferences;
// Only compiled on web/server: its body calls the web-only
// `data::get_metadata_precedence`/`save_metadata_precedence` (no mobile RPC
// route yet).
#[cfg(not(feature = "mobile"))]
pub(crate) mod metadata_precedence;
pub(crate) mod secret_key_field;
pub(crate) mod sections;
#[cfg(not(feature = "mobile"))]
pub(crate) mod shell;
pub(crate) mod smtp;
// Web/server only: the admin Users surface calls the web-only `data::users`
// REST wrappers (no mobile admin surface).
#[cfg(not(feature = "mobile"))]
pub(crate) mod users;

use dioxus::prelude::*;

#[cfg(not(feature = "mobile"))]
pub(crate) use api_tokens::use_instance_origin;
#[cfg(feature = "mobile")]
use library::{LibraryLocationSection, MaintenancePanel};
#[cfg(feature = "mobile")]
use secret_key_field::{SecretKeyField, SecretKeyKind};
#[cfg(not(feature = "mobile"))]
use sections::{legacy_settings_target, SettingsSection};
#[cfg(feature = "mobile")]
use smtp::SmtpConfigField;

/// The `/settings` page. Web/server render the sectioned sidebar; the native
/// shell renders the flat mobile form (`section` is web-only navigation state).
#[cfg(not(feature = "mobile"))]
#[component]
pub fn SettingsPage(section: Option<String>) -> Element {
    use crate::components::{Loading, LoadingKind};

    let nav = dioxus_router::use_navigator();
    let legacy = section.as_deref().and_then(legacy_settings_target);
    use_effect(use_reactive!(|legacy| {
        if let Some(target) = legacy {
            nav.replace(crate::routes::link_target(target.route()));
        }
    }));
    let is_admin = crate::use_admin_access()() == crate::Access::Allowed;

    if legacy.is_some() {
        return rsx! {
            Loading {
                kind: LoadingKind::Page,
                testid: "settings-redirecting",
                label: "Opening settings",
            }
        };
    }
    let active = SettingsSection::parse(section.as_deref());
    rsx! {
        shell::SettingsShell {
            title: "Settings",
            testid: "settings-layout",
            nav_label: "Settings sections",
            back_to: Some(crate::Route::Settings { section: None }),
            back_keeps: active == SettingsSection::parse(None),
            has_section: section.is_some(),
            nav: rsx! { PersonalNav { active, is_admin } },
            shell::SectionHeader { title: active.label() }
            {section_content(active)}
        }
    }
}

/// Mobile settings: the library form plus the admin maintenance, key and SMTP
/// cards, laid out flat. There is no sidebar, and the metadata-precedence card
/// and the log viewer stay web-only.
#[cfg(feature = "mobile")]
#[component]
pub fn SettingsPage(section: Option<String>) -> Element {
    let _ = section;
    let is_admin = crate::use_is_admin();
    rsx! {
        div { class: "settings-page",
            LibraryLocationSection {}
            if is_admin() {
                MaintenancePanel {}
                SecretKeyField { kind: SecretKeyKind::Hardcover }
                SecretKeyField { kind: SecretKeyKind::GoogleBooks }
                SmtpConfigField {}
            }
        }
    }
}

/// The five personal sections, plus a way into Administration for admins.
#[cfg(not(feature = "mobile"))]
#[component]
fn PersonalNav(active: SettingsSection, is_admin: bool) -> Element {
    use crate::Route;
    use shell::{NavGroup, NavItem};

    rsx! {
        NavGroup {
            for section in SettingsSection::ALL {
                NavItem {
                    key: "{section.slug()}",
                    to: section.route(),
                    label: section.label(),
                    testid: format!("settings-nav-{}", section.slug()),
                    active: section == active,
                }
            }
        }
        if is_admin {
            NavGroup { divided: true,
                NavItem {
                    to: Route::Admin { section: None },
                    label: "Administration",
                    testid: "settings-nav-admin".to_string(),
                    active: false,
                }
            }
        }
    }
}

/// The cards of a personal section, reusing the existing account controls.
#[cfg(not(feature = "mobile"))]
fn section_content(section: SettingsSection) -> Element {
    use super::account;

    match section {
        SettingsSection::Profile => rsx! { account::profile::ProfileCard {} },
        SettingsSection::Preferences => rsx! { preferences::PreferencesSection {} },
        SettingsSection::Goals => rsx! { account::goals::ReadingGoalsCard {} },
        SettingsSection::Devices => rsx! {
            account::kindle::KindleEmailCard {}
            account::kobo::KoboDevicesCard {}
        },
        SettingsSection::Security => rsx! {
            account::ChangePasswordCard {}
            account::sessions::SessionsCard {}
            api_tokens::ApiTokensSection {}
        },
    }
}

#[cfg(all(test, feature = "server", not(feature = "mobile")))]
mod tests;
