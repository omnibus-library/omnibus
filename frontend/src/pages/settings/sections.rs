//! The personal settings sections a reader picks from in `/settings`, and how
//! older `?section=` links (from before server administration moved to
//! `/admin`) find their new home. Pure, so routing decisions are unit-tested
//! apart from any render.

use crate::pages::admin::sections::{AdminSection, HealthTab};

/// A section of the personal `/settings` page. Every reader sees all five.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SettingsSection {
    Profile,
    Preferences,
    Goals,
    Devices,
    Security,
}

impl SettingsSection {
    /// Sidebar order.
    pub(crate) const ALL: [SettingsSection; 5] = [
        SettingsSection::Profile,
        SettingsSection::Preferences,
        SettingsSection::Goals,
        SettingsSection::Devices,
        SettingsSection::Security,
    ];

    /// The `?section=` slug — the deep-link identity and active-item key.
    pub(crate) fn slug(self) -> &'static str {
        match self {
            SettingsSection::Profile => "profile",
            SettingsSection::Preferences => "preferences",
            SettingsSection::Goals => "goals",
            SettingsSection::Devices => "devices",
            SettingsSection::Security => "security",
        }
    }

    /// The sidebar label and section heading.
    pub(crate) fn label(self) -> &'static str {
        match self {
            SettingsSection::Profile => "Profile",
            SettingsSection::Preferences => "Preferences",
            SettingsSection::Goals => "Goals",
            SettingsSection::Devices => "Devices",
            SettingsSection::Security => "Sign-in & security",
        }
    }

    /// Resolve a `?section=` slug; anything unrecognised opens Profile.
    pub(crate) fn parse(raw: Option<&str>) -> SettingsSection {
        SettingsSection::ALL
            .into_iter()
            .find(|section| Some(section.slug()) == raw)
            .unwrap_or(SettingsSection::Profile)
    }
}

/// The browser-tab subtitle for `/settings?section=<raw>`.
pub(crate) fn settings_page_title(raw: Option<&str>) -> String {
    format!("{} · Settings", SettingsSection::parse(raw).label())
}

/// Where a settings link lands: a personal section, or an admin section (with
/// a Health & activity tab when it names one).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SettingsTarget {
    Personal(SettingsSection),
    Admin(AdminSection, Option<HealthTab>),
}

/// The new home of a `?section=` slug that predates the `/admin` split, or
/// `None` when the slug is current (or unknown) and needs no redirect.
pub(crate) fn legacy_settings_target(slug: &str) -> Option<SettingsTarget> {
    use SettingsTarget::{Admin, Personal};
    let target = match slug {
        "account" => Personal(SettingsSection::Profile),
        "kindle" | "kobo" => Personal(SettingsSection::Devices),
        "api-tokens" => Personal(SettingsSection::Security),
        "library" => Admin(AdminSection::Sources, None),
        "metadata" => Admin(AdminSection::Metadata, None),
        "email" => Admin(AdminSection::Integrations, None),
        "cleanup" => Admin(AdminSection::Cleanup, None),
        "users" => Admin(AdminSection::People, None),
        "health" => Admin(AdminSection::Health, Some(HealthTab::Overview)),
        "background-tasks" => Admin(AdminSection::Health, Some(HealthTab::Activity)),
        "logs" => Admin(AdminSection::Health, Some(HealthTab::Logs)),
        _ => return None,
    };
    Some(target)
}

impl SettingsTarget {
    /// Whether only an administrator can open this target.
    pub(crate) fn requires_admin(self) -> bool {
        matches!(self, SettingsTarget::Admin(..))
    }
}

/// One searchable setting: what the palette shows, the words that find it,
/// and where it opens.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct SettingsEntry {
    pub label: &'static str,
    pub keywords: &'static [&'static str],
    pub target: SettingsTarget,
}

const fn personal(
    label: &'static str,
    keywords: &'static [&'static str],
    section: SettingsSection,
) -> SettingsEntry {
    SettingsEntry {
        label,
        keywords,
        target: SettingsTarget::Personal(section),
    }
}

const fn admin(
    label: &'static str,
    keywords: &'static [&'static str],
    section: AdminSection,
    tab: Option<HealthTab>,
) -> SettingsEntry {
    SettingsEntry {
        label,
        keywords,
        target: SettingsTarget::Admin(section, tab),
    }
}

/// Every searchable setting, in the order results list them.
const SETTINGS_INDEX: &[SettingsEntry] = &[
    personal(
        "Display name & picture",
        &["profile", "avatar", "photo", "name"],
        SettingsSection::Profile,
    ),
    personal(
        "Theme",
        &["dark mode", "light mode", "sepia", "black", "appearance"],
        SettingsSection::Preferences,
    ),
    personal(
        "Stack series",
        &["series", "group volumes"],
        SettingsSection::Preferences,
    ),
    personal(
        "Hidden formats",
        &["hide formats", "audiobooks", "epub", "pdf", "m4b", "mp3"],
        SettingsSection::Preferences,
    ),
    personal(
        "Book page scroll stops",
        &["scroll", "book details", "layout"],
        SettingsSection::Preferences,
    ),
    personal(
        "Share stats with household",
        &["privacy", "household", "sharing"],
        SettingsSection::Preferences,
    ),
    personal(
        "Reading goals",
        &[
            "goal",
            "target",
            "pages a day",
            "minutes a day",
            "books this year",
        ],
        SettingsSection::Goals,
    ),
    personal(
        "Send to Kindle",
        &["kindle", "email address"],
        SettingsSection::Devices,
    ),
    personal(
        "Kobo devices",
        &["kobo", "sync", "e-reader"],
        SettingsSection::Devices,
    ),
    personal(
        "Password",
        &["change password", "sign in"],
        SettingsSection::Security,
    ),
    personal(
        "Sessions",
        &["signed in", "sign out", "revoke"],
        SettingsSection::Security,
    ),
    personal(
        "API tokens",
        &["token", "bearer", "mcp"],
        SettingsSection::Security,
    ),
    admin(
        "Library folders",
        &[
            "library path",
            "ebook folder",
            "audiobook folder",
            "rescan",
            "scan interval",
        ],
        AdminSection::Sources,
        None,
    ),
    admin(
        "Metadata order",
        &["precedence", "provider", "metadata"],
        AdminSection::Metadata,
        None,
    ),
    admin(
        "Library cleanup",
        &["duplicates", "merge", "authors"],
        AdminSection::Cleanup,
        None,
    ),
    admin(
        "Users",
        &["accounts", "people", "registration", "permissions"],
        AdminSection::People,
        None,
    ),
    admin(
        "Email delivery (SMTP)",
        &["smtp", "mail server"],
        AdminSection::Integrations,
        None,
    ),
    admin(
        "Hardcover",
        &["api key", "suggestions"],
        AdminSection::Integrations,
        None,
    ),
    admin(
        "Google Books",
        &["api key", "metadata lookup"],
        AdminSection::Integrations,
        None,
    ),
    admin(
        "Calibre conversion",
        &["calibre", "ebook-convert", "convert"],
        AdminSection::Integrations,
        None,
    ),
    admin(
        "Hosted MCP endpoint",
        &["mcp"],
        AdminSection::Integrations,
        None,
    ),
    admin(
        "Server health",
        &["health", "status", "errors", "worker queue", "storage"],
        AdminSection::Health,
        Some(HealthTab::Overview),
    ),
    admin(
        "Background tasks",
        &["tasks", "history", "activity"],
        AdminSection::Health,
        Some(HealthTab::Activity),
    ),
    admin(
        "Maintenance",
        &[
            "scan library",
            "refetch author pictures",
            "extract chapters",
            "bake overrides",
        ],
        AdminSection::Health,
        Some(HealthTab::Maintenance),
    ),
    admin(
        "Server logs",
        &["logs"],
        AdminSection::Health,
        Some(HealthTab::Logs),
    ),
];

/// Most results the palette shows for settings, so they never bury the books.
const MAX_SETTINGS_MATCHES: usize = 5;

/// Settings whose label or keywords contain `query` (case-insensitive),
/// skipping server settings unless `is_admin`. A blank query matches nothing.
pub(crate) fn matching_settings(query: &str, is_admin: bool) -> Vec<&'static SettingsEntry> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }
    SETTINGS_INDEX
        .iter()
        .filter(|entry| is_admin || !entry.target.requires_admin())
        .filter(|entry| {
            entry.label.to_lowercase().contains(&query)
                || entry
                    .keywords
                    .iter()
                    .any(|keyword| keyword.contains(&query))
        })
        .take(MAX_SETTINGS_MATCHES)
        .collect()
}

#[cfg(test)]
mod tests;
