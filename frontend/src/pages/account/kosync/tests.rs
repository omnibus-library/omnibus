//! Tests for the KOReader progress-sync card: the server URL it shows, the replace confirm,
//! and what SSR paints before the status answers and once a password is revealed.

use super::*;

#[test]
fn kosync_url_joins_the_origin_and_the_kosync_path() {
    assert_eq!(
        kosync_url("https://omni.example.com"),
        "https://omni.example.com/kosync"
    );
}

#[test]
fn kosync_url_has_no_trailing_slash_even_when_the_origin_does() {
    assert_eq!(
        kosync_url("http://localhost:3000/"),
        "http://localhost:3000/kosync"
    );
}

#[test]
fn generate_label_asks_for_a_new_password_once_one_exists() {
    assert_eq!(generate_label(false), "Generate password");
    assert_eq!(generate_label(true), "Generate a new password");
}

#[test]
fn replace_confirm_says_the_old_password_stops_working() {
    let (title, body) = replace_confirm_text();
    assert!(title.contains("new password"), "{title}");
    assert!(body.contains("stops working"), "{body}");
}

#[test]
fn generate_asks_first_unless_the_reader_is_known_to_have_no_password() {
    assert!(!generate_needs_confirm(Some(false)));
    assert!(generate_needs_confirm(Some(true)));
    assert!(generate_needs_confirm(None));
}

#[test]
fn generate_is_disabled_only_while_the_status_loads_or_a_request_runs() {
    assert!(generate_disabled(None, false, false));
    assert!(!generate_disabled(None, true, false));
    assert!(!generate_disabled(Some(false), false, false));
    assert!(generate_disabled(Some(false), false, true));
}

#[test]
fn generate_outcome_reports_success_as_a_message_and_failure_as_an_error() {
    assert_eq!(
        generate_outcome(Ok(())),
        (
            "Password generated. Copy it now: it is shown once.".to_string(),
            false
        )
    );
    assert_eq!(
        generate_outcome(Err("boom".to_string())),
        ("boom".to_string(), true)
    );
}

#[cfg(feature = "server")]
mod render_tests {
    use omnibus_shared::KosyncPassword;

    use super::*;
    use crate::test_support::render_in_vdom;

    fn card() -> Element {
        rsx! { KosyncCard {} }
    }

    fn revealed() -> Element {
        render_revealed(
            "https://omni.example.com",
            &KosyncPassword {
                username: "ada".to_string(),
                password: "abcde-fghjk-mnpqr-stuvw".to_string(),
            },
        )
    }

    /// The status has not answered at first paint, so the card says it is checking
    /// instead of claiming sync is off (rules 07 and 12).
    #[test]
    fn kosync_card_paints_a_loader_not_off_before_the_status_answers() {
        let html = render_in_vdom(card);

        assert!(html.contains("data-testid=\"kosync-loading\""), "{html}");
        assert!(!html.contains("data-testid=\"kosync-status\""), "{html}");
        assert!(!html.contains(">Off<"), "{html}");
    }

    #[test]
    fn kosync_card_disables_generate_until_the_status_answers() {
        let html = render_in_vdom(card);

        let before_testid = html
            .split("data-testid=\"kosync-generate\"")
            .next()
            .unwrap();
        let button_tag = before_testid.rsplit("<button").next().unwrap();
        assert!(button_tag.contains("disabled=true"), "{html}");
    }

    fn failed_status() -> Element {
        render_status(None, true)
    }

    #[test]
    fn render_status_says_the_status_is_unavailable_when_the_read_failed() {
        let html = render_in_vdom(failed_status);

        assert!(html.contains("data-testid=\"kosync-status\""), "{html}");
        assert!(html.contains("Status unavailable"), "{html}");
        assert!(!html.contains("kosync-loading"), "{html}");
    }

    #[test]
    fn render_revealed_shows_the_server_url_username_and_password_each_copyable() {
        let html = render_in_vdom(revealed);

        for expected in [
            "https://omni.example.com/kosync",
            "ada",
            "abcde-fghjk-mnpqr-stuvw",
            "data-testid=\"kosync-url-copy\"",
            "data-testid=\"kosync-username-copy\"",
            "data-testid=\"kosync-password-copy\"",
            "Shown once",
        ] {
            assert!(html.contains(expected), "missing {expected}: {html}");
        }
    }
}
