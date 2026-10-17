//! Server administration (`/admin`) — the settings shell over the sections an
//! administrator owns: Library (Sources, Metadata, Cleanup) and Server
//! (People, Integrations, Health & activity). Gated on `use_admin_access`, so
//! an unresolved reader sees loading and a non-admin a refusal; the
//! `AdminUser` extractor on every config RPC remains the real boundary.

pub(crate) mod sections;

#[cfg(not(feature = "mobile"))]
pub use page::AdminPage;

#[cfg(not(feature = "mobile"))]
mod page {
    use dioxus::prelude::*;
    use dioxus_router::Link;

    use super::sections::{AdminSection, HealthTab};
    use crate::components::{Loading, LoadingKind};
    use crate::pages::settings::shell::{NavGroup, NavItem, SectionHeader, SettingsShell};
    use crate::pages::settings::{
        background_tasks, cleanup, ebook_convert, library, mcp, metadata_precedence,
        secret_key_field, smtp, users,
    };
    use crate::{Access, Route};

    /// The `/admin` page: `section` picks the sidebar section and `tab` the
    /// Health & activity tab.
    #[component]
    pub fn AdminPage(section: Option<String>, tab: Option<String>) -> Element {
        let access = crate::use_admin_access();
        let active = AdminSection::parse(section.as_deref());
        let tab = HealthTab::parse(tab.as_deref());
        rsx! {
            SettingsShell {
                title: "Administration",
                testid: "admin-layout",
                nav_label: "Administration sections",
                back_to: Route::Admin { section: None, tab: None },
                has_section: section.is_some(),
                nav: rsx! { AdminNav { active } },
                match access() {
                    Access::Allowed => rsx! {
                        SectionHeader { title: active.label(), description: section_description(active) }
                        {section_content(active, tab)}
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
                    to: Route::Admin { section: Some(section.slug().to_string()), tab: None },
                    label: section.label(),
                    testid: format!("admin-nav-{}", section.slug()),
                    active: section == active,
                }
            }
        };
        rsx! {
            NavGroup { label: "Library",
                {item(AdminSection::Sources)}
                {item(AdminSection::Metadata)}
                {item(AdminSection::Cleanup)}
            }
            NavGroup { label: "Server",
                {item(AdminSection::People)}
                {item(AdminSection::Integrations)}
                {item(AdminSection::Health)}
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

    /// The line under an admin section's heading.
    fn section_description(section: AdminSection) -> &'static str {
        match section {
            AdminSection::Sources => "Where the library lives on disk, and how often it's rescanned.",
            AdminSection::Metadata => "Which source wins when book details disagree.",
            AdminSection::Cleanup => "Review suggested fixes for duplicate and misspelled entries.",
            AdminSection::People => "Who can sign in, and what each reader may do.",
            AdminSection::Integrations => {
                "Outside services: email delivery, metadata providers, Calibre and the MCP endpoint."
            }
            AdminSection::Health => "Server status, background work, maintenance jobs and logs.",
        }
    }

    /// The cards of an admin section; Health renders its tab bar first.
    fn section_content(section: AdminSection, tab: HealthTab) -> Element {
        use secret_key_field::{SecretKeyField, SecretKeyKind};

        match section {
            AdminSection::Sources => rsx! { library::LibraryLocationSection {} },
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
            AdminSection::Health => rsx! {
                HealthTabs { active: tab }
                {health_tab_content(tab)}
            },
        }
    }

    /// The Health & activity tab bar; each tab is a link so it deep-links.
    #[component]
    fn HealthTabs(active: HealthTab) -> Element {
        rsx! {
            nav { class: "settings-tabs", "aria-label": "Health & activity views",
                for tab in HealthTab::ALL {
                    Link {
                        key: "{tab.slug()}",
                        to: crate::routes::link_target(Route::Admin {
                            section: Some(AdminSection::Health.slug().to_string()),
                            tab: Some(tab.slug().to_string()),
                        }),
                        class: if tab == active { "settings-tab active" } else { "settings-tab" },
                        "data-testid": "health-tab-{tab.slug()}",
                        "aria-current": if tab == active { "page" } else { "false" },
                        "{tab.label()}"
                    }
                }
            }
        }
    }

    fn health_tab_content(tab: HealthTab) -> Element {
        match tab {
            HealthTab::Overview => rsx! { crate::pages::HealthOverview {} },
            HealthTab::Activity => rsx! { background_tasks::BackgroundTasksSection {} },
            HealthTab::Maintenance => rsx! { library::MaintenancePanel {} },
            HealthTab::Logs => rsx! { crate::pages::LogsPage {} },
        }
    }
}

#[cfg(all(test, not(feature = "mobile")))]
mod tests;
