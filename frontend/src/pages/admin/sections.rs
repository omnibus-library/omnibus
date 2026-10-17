//! The sections of server administration (`/admin`) and the tabs of its
//! Health & activity section. Pure, so the routing decisions are unit-tested
//! apart from any render.
// The mobile shell has no sidebar or `/admin`; it reads only the page title.
#![cfg_attr(feature = "mobile", allow(dead_code))]

/// A section of `/admin`, grouped in the sidebar as Library and Server.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AdminSection {
    Sources,
    Metadata,
    Cleanup,
    People,
    Integrations,
    Health,
}

impl AdminSection {
    /// Sidebar order.
    pub(crate) const ALL: [AdminSection; 6] = [
        AdminSection::Sources,
        AdminSection::Metadata,
        AdminSection::Cleanup,
        AdminSection::People,
        AdminSection::Integrations,
        AdminSection::Health,
    ];

    /// The `?section=` slug — the deep-link identity and active-item key.
    pub(crate) fn slug(self) -> &'static str {
        match self {
            AdminSection::Sources => "sources",
            AdminSection::Metadata => "metadata",
            AdminSection::Cleanup => "cleanup",
            AdminSection::People => "people",
            AdminSection::Integrations => "integrations",
            AdminSection::Health => "health",
        }
    }

    /// The sidebar label and section heading.
    pub(crate) fn label(self) -> &'static str {
        match self {
            AdminSection::Sources => "Sources",
            AdminSection::Metadata => "Metadata",
            AdminSection::Cleanup => "Cleanup",
            AdminSection::People => "People",
            AdminSection::Integrations => "Integrations",
            AdminSection::Health => "Health & activity",
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

/// A tab of the Health & activity section.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HealthTab {
    Overview,
    Activity,
    Maintenance,
    Logs,
}

impl HealthTab {
    /// Tab-bar order.
    pub(crate) const ALL: [HealthTab; 4] = [
        HealthTab::Overview,
        HealthTab::Activity,
        HealthTab::Maintenance,
        HealthTab::Logs,
    ];

    /// The `?tab=` slug.
    pub(crate) fn slug(self) -> &'static str {
        match self {
            HealthTab::Overview => "overview",
            HealthTab::Activity => "activity",
            HealthTab::Maintenance => "maintenance",
            HealthTab::Logs => "logs",
        }
    }

    /// The tab label.
    pub(crate) fn label(self) -> &'static str {
        match self {
            HealthTab::Overview => "Overview",
            HealthTab::Activity => "Activity",
            HealthTab::Maintenance => "Maintenance",
            HealthTab::Logs => "Logs",
        }
    }

    /// Resolve a `?tab=` slug; anything unrecognised opens Overview.
    pub(crate) fn parse(raw: Option<&str>) -> HealthTab {
        HealthTab::ALL
            .into_iter()
            .find(|tab| Some(tab.slug()) == raw)
            .unwrap_or(HealthTab::Overview)
    }
}

/// The browser-tab subtitle for `/admin?section=<section>&tab=<tab>`: the
/// section's label, or a Health tab's own label once it's past Overview.
pub(crate) fn admin_page_title(section: Option<&str>, tab: Option<&str>) -> String {
    let section = AdminSection::parse(section);
    let label = match (section, HealthTab::parse(tab)) {
        (AdminSection::Health, tab) if tab != HealthTab::Overview => tab.label(),
        _ => section.label(),
    };
    format!("{label} · Administration")
}

#[cfg(test)]
mod tests;
