//! The sections of server administration (`/admin`), each its own page in the
//! sidebar. Pure, so the routing decisions are unit-tested apart from any
//! render.
// The mobile shell has no sidebar or `/admin`; it reads only the page title.
#![cfg_attr(feature = "mobile", allow(dead_code))]

use crate::Route;

/// A section of `/admin`, grouped in the sidebar as Library and Server.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AdminSection {
    Sources,
    Maintenance,
    Metadata,
    Cleanup,
    People,
    Integrations,
    Health,
    Logs,
}

impl AdminSection {
    /// Sidebar order: the first four are Library, the last four Server.
    pub(crate) const ALL: [AdminSection; 8] = [
        AdminSection::Sources,
        AdminSection::Maintenance,
        AdminSection::Metadata,
        AdminSection::Cleanup,
        AdminSection::People,
        AdminSection::Integrations,
        AdminSection::Health,
        AdminSection::Logs,
    ];

    /// The `?section=` slug — the deep-link identity and active-item key.
    pub(crate) fn slug(self) -> &'static str {
        match self {
            AdminSection::Sources => "sources",
            AdminSection::Maintenance => "maintenance",
            AdminSection::Metadata => "metadata",
            AdminSection::Cleanup => "cleanup",
            AdminSection::People => "people",
            AdminSection::Integrations => "integrations",
            AdminSection::Health => "health",
            AdminSection::Logs => "logs",
        }
    }

    /// The sidebar label and section heading.
    pub(crate) fn label(self) -> &'static str {
        match self {
            AdminSection::Sources => "Sources",
            AdminSection::Maintenance => "Maintenance",
            AdminSection::Metadata => "Metadata",
            AdminSection::Cleanup => "Cleanup",
            AdminSection::People => "People",
            AdminSection::Integrations => "Integrations",
            AdminSection::Health => "Health",
            AdminSection::Logs => "Logs",
        }
    }

    /// The sidebar group this section sits under.
    pub(crate) fn group(self) -> &'static str {
        match self {
            AdminSection::Sources
            | AdminSection::Maintenance
            | AdminSection::Metadata
            | AdminSection::Cleanup => "Library",
            AdminSection::People
            | AdminSection::Integrations
            | AdminSection::Health
            | AdminSection::Logs => "Server",
        }
    }

    /// The route that opens this section.
    pub(crate) fn route(self) -> Route {
        Route::Admin {
            section: Some(self.slug().to_string()),
        }
    }

    /// Where copy sends an admin for this section. The native shell has no
    /// `/admin`; its admin cards sit on its own Settings screen.
    pub(crate) fn place(self) -> String {
        if cfg!(feature = "mobile") {
            "Settings".to_string()
        } else {
            format!("Administration \u{203a} {}", self.label())
        }
    }

    /// Resolve a `?section=` slug; anything unrecognised opens Sources.
    pub(crate) fn parse(raw: Option<&str>) -> AdminSection {
        AdminSection::ALL
            .into_iter()
            .find(|section| Some(section.slug()) == raw)
            .unwrap_or(AdminSection::Sources)
    }
}

/// The browser-tab subtitle for `/admin?section=<section>`.
pub(crate) fn admin_page_title(section: Option<&str>) -> String {
    format!("{} · Administration", AdminSection::parse(section).label())
}

#[cfg(test)]
mod tests;
