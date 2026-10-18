//! Server administration (`/admin`) — the settings shell over the sections an
//! administrator owns: Library (Sources, Maintenance, Metadata, Cleanup) and
//! Server (People, Integrations, Health, Logs), each its own page. Gated on
//! `use_admin_access`, so an unresolved reader sees loading and a non-admin a
//! refusal; the `AdminUser` extractor on every config RPC remains the real
//! boundary.

pub(crate) mod sections;

#[cfg(not(feature = "mobile"))]
pub use page::AdminPage;

#[cfg(not(feature = "mobile"))]
mod page {
    use dioxus::prelude::*;
    use dioxus_router::Link;

    use super::sections::AdminSection;
    use crate::components::{Loading, LoadingKind};
    use crate::pages::settings::shell::{NavGroup, NavItem, SectionHeader, SettingsShell};
    use crate::pages::settings::{
        background_tasks, cleanup, ebook_convert, library, mcp, metadata_precedence,
        secret_key_field, smtp, users,
    };
    use crate::{Access, Route};

    /// The `/admin` page: `section` picks the sidebar section.
    #[component]
    pub fn AdminPage(section: Option<String>) -> Element {
        let access = crate::use_admin_access();
        let active = AdminSection::parse(section.as_deref());
        rsx! {
            SettingsShell {
                title: "Administration",
                testid: "admin-layout",
                nav_label: "Administration sections",
                back_to: Route::Admin { section: None },
                has_section: section.is_some(),
                nav: rsx! { AdminNav { active } },
                match access() {
                    Access::Allowed => rsx! {
                        SectionHeader { title: active.label() }
                        {section_content(active)}
                    },
                    Access::Unknown => rsx! {
                        Loading {
                            kind: LoadingKind::Section,
                            testid: "admin-loading",
                            label: "Checking your access\u{2026}",
                        }
                    },
                    Access::Denied => rsx! {
                        div { class: "admin-forbidden", "data-testid": "admin-forbidden",
                            p { "Administration is only open to server administrators." }
                            Link { to: crate::routes::link_target(Route::Settings { section: None }),
                                "Go to your settings"
                            }
                        }
                    },
                }
            }
        }
    }

    /// Library and Server groups, plus the way back to personal settings.
    #[component]
    fn AdminNav(active: AdminSection) -> Element {
        let item = move |section: AdminSection| {
            rsx! {
                NavItem {
                    key: "{section.slug()}",
                    to: Route::Admin { section: Some(section.slug().to_string()) },
                    label: section.label(),
                    testid: format!("admin-nav-{}", section.slug()),
                    active: section == active,
                }
            }
        };
        let (library, server) = AdminSection::ALL.split_at(4);
        rsx! {
            NavGroup { label: "Library",
                for section in library.iter().copied() { {item(section)} }
            }
            NavGroup { label: "Server",
                for section in server.iter().copied() { {item(section)} }
            }
            NavGroup {
                NavItem {
                    to: Route::Settings { section: None },
                    label: "Your settings",
                    testid: "admin-nav-settings".to_string(),
                    active: false,
                }
            }
        }
    }

    /// The cards of an admin section.
    fn section_content(section: AdminSection) -> Element {
        use secret_key_field::{SecretKeyField, SecretKeyKind};

        match section {
            AdminSection::Sources => rsx! { library::LibraryLocationSection {} },
            AdminSection::Maintenance => rsx! {
                library::MaintenancePanel {}
                background_tasks::BackgroundTasksSection {}
            },
            AdminSection::Metadata => rsx! { metadata_precedence::MetadataPrecedenceField {} },
            AdminSection::Cleanup => rsx! { cleanup::CleanupSection {} },
            AdminSection::People => rsx! { users::UsersSection {} },
            AdminSection::Integrations => rsx! {
                smtp::SmtpConfigField {}
                SecretKeyField { kind: SecretKeyKind::Hardcover }
                SecretKeyField { kind: SecretKeyKind::GoogleBooks }
                ebook_convert::EbookConvertField {}
                mcp::McpToggleCard {}
            },
            AdminSection::Health => rsx! { crate::pages::HealthOverview {} },
            AdminSection::Logs => rsx! { crate::pages::LogsPage {} },
        }
    }
}

#[cfg(all(test, not(feature = "mobile")))]
mod tests;
