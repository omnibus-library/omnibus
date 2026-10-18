use super::*;

#[test]
fn role_label_maps_admin_to_owner() {
    assert_eq!(role_label(true), "Owner");
    assert_eq!(role_label(false), "Reader");
}

#[test]
fn identity_subline_joins_username_and_role() {
    assert_eq!(identity_subline("elena", true), "elena \u{00b7} Owner");
    assert_eq!(identity_subline("bob", false), "bob \u{00b7} Reader");
}

#[test]
fn theme_order_matches_css_attrs() {
    let attrs: Vec<&str> = THEME_ORDER.iter().map(|(_, k)| k.as_attr()).collect();
    assert_eq!(attrs, ["dark", "black", "light", "sepia"]);
}

#[cfg(all(feature = "server", not(feature = "mobile")))]
mod live_status_line {
    use super::*;
    use crate::test_support::render;

    #[test]
    fn live_status_mounts_empty_before_any_message() {
        let html = render(live_status("s", None, false));
        assert_eq!(
            html,
            r#"<p role="status" class="settings-status" data-testid="s"></p>"#
        );
    }

    #[test]
    fn live_status_marks_a_failure_as_an_error() {
        let html = render(live_status("s", Some("Nope."), true));
        assert!(html.contains(r#"class="settings-status error""#), "{html}");
        assert!(html.contains("Nope."), "{html}");
    }
}

#[cfg(all(feature = "server", not(feature = "mobile")))]
mod change_password_card {
    use super::*;
    use crate::test_support::render_in_vdom;

    #[test]
    fn change_password_card_makes_change_password_the_primary_footer_action() {
        let html = render_in_vdom(|| rsx! { ChangePasswordCard {} });
        let footer = html
            .find(r#"class="settings-actions""#)
            .expect("a footer row");
        let submit = html
            .find(r#"data-testid="change-password-submit""#)
            .expect("submit");
        assert!(footer < submit, "{html}");
        assert!(
            html[footer..submit].contains(r#"class="btn primary""#),
            "{html}"
        );
    }
}
