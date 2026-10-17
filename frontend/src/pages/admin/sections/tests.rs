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
fn health_tab_parse_round_trips_every_slug() {
    for tab in HealthTab::ALL {
        assert_eq!(HealthTab::parse(Some(tab.slug())), tab);
    }
}

#[test]
fn health_tab_parse_opens_overview_when_the_slug_is_absent_or_unknown() {
    assert_eq!(HealthTab::parse(None), HealthTab::Overview);
    assert_eq!(HealthTab::parse(Some("errors")), HealthTab::Overview);
}

#[test]
fn admin_page_title_names_the_open_section() {
    assert_eq!(
        admin_page_title(Some("people"), None),
        "People · Administration"
    );
    assert_eq!(admin_page_title(None, None), "Sources · Administration");
}

#[test]
fn admin_page_title_names_the_health_tab_past_overview() {
    assert_eq!(
        admin_page_title(Some("health"), None),
        "Health & activity · Administration"
    );
    assert_eq!(
        admin_page_title(Some("health"), Some("logs")),
        "Logs · Administration"
    );
}

#[test]
fn admin_page_title_ignores_a_tab_outside_health() {
    assert_eq!(
        admin_page_title(Some("people"), Some("logs")),
        "People · Administration"
    );
}
