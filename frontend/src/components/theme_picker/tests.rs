use super::*;
use crate::components::atrium::init_theme;
use crate::test_support::render_in_vdom;

fn picker() -> Element {
    init_theme();
    rsx! { ThemePicker {} }
}

#[test]
fn theme_picker_offers_every_theme_by_its_testid() {
    let html = render_in_vdom(picker);
    for name in ["dark", "black", "light", "sepia"] {
        assert!(
            html.contains(&format!(r#"data-testid="theme-{name}""#)),
            "{name}: {html}"
        );
    }
}

#[test]
fn theme_picker_presses_only_the_current_theme() {
    let html = render_in_vdom(picker);
    assert_eq!(html.matches(r#"aria-pressed="true""#).count(), 1, "{html}");
    assert!(
        html.contains(r#"data-testid="theme-dark" aria-pressed="true""#),
        "{html}"
    );
}

#[test]
fn theme_picker_groups_its_buttons_under_one_name() {
    let html = render_in_vdom(picker);
    assert!(
        html.contains(r#"role="group" aria-label="Theme""#),
        "{html}"
    );
}
