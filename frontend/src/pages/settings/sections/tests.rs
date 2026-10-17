use super::*;

#[test]
fn settings_section_parse_round_trips_every_slug() {
    for section in SettingsSection::ALL {
        assert_eq!(SettingsSection::parse(Some(section.slug())), section);
    }
}

#[test]
fn settings_section_parse_opens_profile_when_the_slug_is_absent_or_unknown() {
    assert_eq!(SettingsSection::parse(None), SettingsSection::Profile);
    assert_eq!(
        SettingsSection::parse(Some("nope")),
        SettingsSection::Profile
    );
}

#[test]
fn legacy_settings_target_sends_each_old_slug_to_its_new_home() {
    use crate::pages::admin::sections::{AdminSection as A, HealthTab as T};
    use SettingsSection as S;
    let cases = [
        ("account", SettingsTarget::Personal(S::Profile)),
        ("kindle", SettingsTarget::Personal(S::Devices)),
        ("kobo", SettingsTarget::Personal(S::Devices)),
        ("api-tokens", SettingsTarget::Personal(S::Security)),
        ("library", SettingsTarget::Admin(A::Sources, None)),
        ("metadata", SettingsTarget::Admin(A::Metadata, None)),
        ("email", SettingsTarget::Admin(A::Integrations, None)),
        ("cleanup", SettingsTarget::Admin(A::Cleanup, None)),
        ("users", SettingsTarget::Admin(A::People, None)),
        (
            "health",
            SettingsTarget::Admin(A::Health, Some(T::Overview)),
        ),
        (
            "background-tasks",
            SettingsTarget::Admin(A::Health, Some(T::Activity)),
        ),
        ("logs", SettingsTarget::Admin(A::Health, Some(T::Logs))),
    ];
    for (slug, target) in cases {
        assert_eq!(legacy_settings_target(slug), Some(target), "{slug}");
    }
}

#[test]
fn legacy_settings_target_leaves_current_and_unknown_slugs_alone() {
    for slug in [
        "profile",
        "preferences",
        "goals",
        "devices",
        "security",
        "nope",
    ] {
        assert_eq!(legacy_settings_target(slug), None, "{slug}");
    }
}

#[test]
fn settings_page_title_names_the_open_section() {
    assert_eq!(
        settings_page_title(Some("security")),
        "Sign-in & security · Settings"
    );
    assert_eq!(settings_page_title(None), "Profile · Settings");
}

fn labels(entries: Vec<&SettingsEntry>) -> Vec<&'static str> {
    entries.into_iter().map(|entry| entry.label).collect()
}

#[test]
fn matching_settings_finds_a_setting_by_keyword() {
    assert_eq!(labels(matching_settings("dark", false)), ["Theme"]);
}

#[test]
fn matching_settings_ignores_case() {
    assert_eq!(
        labels(matching_settings("KINDLE", false)),
        ["Send to Kindle"]
    );
}

#[test]
fn matching_settings_offers_server_settings_to_admins_only() {
    assert_eq!(
        labels(matching_settings("smtp", true)),
        ["Email delivery (SMTP)"]
    );
    assert!(matching_settings("smtp", false).is_empty());
}

#[test]
fn matching_settings_returns_nothing_for_a_blank_query() {
    assert!(matching_settings("", true).is_empty());
    assert!(matching_settings("   ", true).is_empty());
}

#[test]
fn matching_settings_returns_at_most_five_entries() {
    assert_eq!(matching_settings("e", true).len(), 5);
}
