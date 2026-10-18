//! Tests for the Administration sections: slugs, order, titles and where copy
//! sends an admin.

use super::*;

#[test]
fn admin_section_parse_round_trips_every_slug() {
    for section in AdminSection::ALL {
        assert_eq!(AdminSection::parse(Some(section.slug())), section);
    }
}

#[test]
fn admin_section_parse_opens_sources_when_the_slug_is_absent_or_unknown() {
    assert_eq!(AdminSection::parse(None), AdminSection::Sources);
    assert_eq!(AdminSection::parse(Some("users")), AdminSection::Sources);
}

#[test]
fn admin_section_all_puts_maintenance_right_after_sources() {
    assert_eq!(
        AdminSection::ALL.map(AdminSection::slug),
        [
            "sources",
            "maintenance",
            "metadata",
            "cleanup",
            "people",
            "integrations",
            "health",
            "logs"
        ]
    );
}

#[test]
fn admin_page_title_names_the_open_section() {
    assert_eq!(admin_page_title(Some("logs")), "Logs · Administration");
    assert_eq!(admin_page_title(None), "Sources · Administration");
}

#[cfg(not(feature = "mobile"))]
#[test]
fn admin_section_place_names_the_administration_section_on_the_web() {
    assert_eq!(
        AdminSection::Integrations.place(),
        "Administration \u{203a} Integrations"
    );
}
