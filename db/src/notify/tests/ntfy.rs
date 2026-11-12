//! `render` and `render_test` for ntfy: one test per option, the wording with details on and
//! off, the link, each sign-in mode's header, and the `Outgoing` it returns.

use omnibus_shared::{NtfySettingsInput, RequestKind};
use serde_json::Value;

use super::super::test_support::{basic_input, ntfy_input, stored, token_input};
use super::*;

const URL: &str = "https://ntfy.example.com";
const PUBLIC: &str = "https://books.example.com";

fn chooser(edit: impl FnOnce(&mut RequestNeedsChooser)) -> Event {
    let Event::RequestNeedsChooser(mut e) = Event::sample();
    edit(&mut e);
    Event::RequestNeedsChooser(e)
}

fn rendered(input: NtfySettingsInput, event: &Event, public_url: Option<&str>) -> Outgoing {
    render(&stored(input), event, public_url)
}

fn body(outgoing: &Outgoing) -> Value {
    serde_json::from_str(&outgoing.body).unwrap()
}

mod request {
    use super::*;

    #[test]
    fn render_posts_json_with_the_topic_to_the_server_url() {
        let outgoing = rendered(ntfy_input(URL), &Event::sample(), None);

        assert_eq!(outgoing.method, reqwest::Method::POST);
        assert_eq!(outgoing.url, URL);
        assert_eq!(outgoing.header("content-type"), Some("application/json"));
        assert_eq!(body(&outgoing)["topic"], "omnibus");
    }

    #[test]
    fn render_posts_to_exactly_a_sub_path_server_url() {
        let outgoing = rendered(
            ntfy_input("http://127.0.0.1:9999/ntfy/"),
            &Event::sample(),
            None,
        );

        assert_eq!(outgoing.url, "http://127.0.0.1:9999/ntfy");
    }

    #[test]
    fn render_sets_the_priority() {
        let input = NtfySettingsInput {
            priority: 5,
            ..ntfy_input(URL)
        };

        assert_eq!(
            body(&rendered(input, &Event::sample(), None))["priority"],
            5
        );
    }

    #[test]
    fn render_sends_the_tags_when_set() {
        let input = NtfySettingsInput {
            tags: vec!["books".into(), "bell".into()],
            ..ntfy_input(URL)
        };

        let sent = body(&rendered(input, &Event::sample(), None));

        assert_eq!(sent["tags"], serde_json::json!(["books", "bell"]));
    }

    #[test]
    fn render_leaves_tags_out_when_there_are_none() {
        let sent = body(&rendered(ntfy_input(URL), &Event::sample(), None));

        assert!(sent.get("tags").is_none());
    }

    #[test]
    fn render_sends_no_authorization_without_a_sign_in() {
        let outgoing = rendered(ntfy_input(URL), &Event::sample(), None);

        assert_eq!(outgoing.header("authorization"), None);
        assert!(outgoing.secrets.is_empty());
    }

    #[test]
    fn render_sends_the_token_as_a_bearer_token() {
        let outgoing = rendered(token_input(URL, Some("tk_abc")), &Event::sample(), None);

        assert_eq!(outgoing.header("authorization"), Some("Bearer tk_abc"));
        assert_eq!(outgoing.secrets, ["tk_abc"]);
    }

    #[test]
    fn render_sends_the_username_and_password_as_basic_auth() {
        let outgoing = rendered(
            basic_input(URL, Some("ada"), Some("pw")),
            &Event::sample(),
            None,
        );

        // base64("ada:pw")
        assert_eq!(outgoing.header("authorization"), Some("Basic YWRhOnB3"));
        assert_eq!(outgoing.secrets, ["pw", "YWRhOnB3"]);
    }

    #[test]
    fn outgoing_debug_shows_header_names_but_no_value() {
        let outgoing = rendered(token_input(URL, Some("tk_abc")), &Event::sample(), None);

        let printed = format!("{outgoing:?}");

        assert!(printed.contains("Authorization"));
        assert!(!printed.contains("tk_abc"));
    }
}

mod wording {
    use super::*;

    #[test]
    fn render_names_the_book_author_requester_and_versions_with_details_on() {
        let sent = body(&rendered(ntfy_input(URL), &Event::sample(), None));

        assert_eq!(sent["title"], "A request needs a version picked");
        assert_eq!(
            sent["message"],
            "Ada asked for the ebook of \u{201c}Dune\u{201d} by Frank Herbert. 4 versions to choose from."
        );
    }

    #[test]
    fn render_says_audiobook_and_one_version_and_leaves_out_a_missing_author() {
        let event = chooser(|e| {
            e.kind = RequestKind::Audiobook;
            e.versions = 1;
            e.author = None;
        });

        let sent = body(&rendered(ntfy_input(URL), &event, None));

        assert_eq!(
            sent["message"],
            "Ada asked for the audiobook of \u{201c}Dune\u{201d}. 1 version to choose from."
        );
    }

    #[test]
    fn render_names_neither_the_book_nor_the_requester_with_details_off() {
        let input = NtfySettingsInput {
            include_details: false,
            ..ntfy_input(URL)
        };

        let outgoing = rendered(input, &Event::sample(), Some(PUBLIC));

        for named in ["Dune", "Frank Herbert", "Ada"] {
            assert!(
                !outgoing.body.contains(named),
                "{named} in {}",
                outgoing.body
            );
        }
        let sent = body(&outgoing);
        assert_eq!(
            sent["message"],
            "A book request is waiting for someone to pick a version."
        );
        assert!(sent["click"].is_string());
    }

    #[test]
    fn render_keeps_a_title_in_any_script_intact() {
        let event = chooser(|e| e.title = "Les Misérables — 東京物語 📚".to_string());

        let sent = body(&rendered(ntfy_input(URL), &event, None));

        assert!(sent["message"]
            .as_str()
            .unwrap()
            .contains("Les Misérables — 東京物語 📚"));
    }

    #[test]
    fn render_test_says_it_is_a_test_with_the_connections_priority_and_tags() {
        let input = NtfySettingsInput {
            priority: 4,
            tags: vec!["bell".into()],
            ..ntfy_input(URL)
        };

        let outgoing = render_test(&stored(input), Some(PUBLIC));

        let sent = body(&outgoing);
        assert_eq!(sent["title"], "Test notification from Omnibus");
        assert_eq!(sent["priority"], 4);
        assert_eq!(sent["tags"], serde_json::json!(["bell"]));
        assert_eq!(sent["click"], PUBLIC);
    }

    #[test]
    fn render_test_leaves_the_link_out_without_a_public_url() {
        let sent = body(&render_test(&stored(ntfy_input(URL)), None));

        assert!(sent.get("click").is_none());
    }

    #[test]
    fn event_sample_is_the_request_event() {
        assert_eq!(
            Event::sample().name(),
            omnibus_shared::NotificationEvent::RequestNeedsChooser
        );
    }
}

mod link {
    use super::*;

    #[test]
    fn render_links_to_the_books_requests_under_the_public_url() {
        let sent = body(&rendered(ntfy_input(URL), &Event::sample(), Some(PUBLIC)));

        assert_eq!(
            sent["click"],
            "https://books.example.com/requests?book=00000000-0000-4000-8000-000000000000"
        );
    }

    #[test]
    fn render_keeps_a_public_urls_sub_path_and_encodes_the_uuid() {
        let event = chooser(|e| e.book_uuid = "a b/c?d".to_string());

        let sent = body(&rendered(
            ntfy_input(URL),
            &event,
            Some("https://example.org/omnibus"),
        ));

        assert_eq!(
            sent["click"],
            "https://example.org/omnibus/requests?book=a%20b%2Fc%3Fd"
        );
    }

    #[test]
    fn render_leaves_the_link_out_without_a_public_url() {
        let sent = body(&rendered(ntfy_input(URL), &Event::sample(), None));

        assert!(sent.get("click").is_none());
    }
}
