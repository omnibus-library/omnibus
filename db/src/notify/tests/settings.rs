//! `ConnectionSettings::from_input`: every check on an ntfy input, and the secret merge
//! over saved settings; then the masked status and the redacting `Debug`.

use omnibus_shared::{
    ConnectionSettingsInput, ConnectionSettingsStatus, NtfyAuth, NtfySettingsInput,
};

use super::super::test_support::{basic_input, ntfy_input, ntfy_of, stored, token_input};
use super::*;

const URL: &str = "https://ntfy.example.com";

fn from_input(
    input: NtfySettingsInput,
    saved: Option<&ConnectionSettings>,
) -> Result<ConnectionSettings, NotifyError> {
    ConnectionSettings::from_input(&ConnectionSettingsInput::Ntfy(input), saved)
}

fn rejection(input: NtfySettingsInput, saved: Option<&ConnectionSettings>) -> String {
    match from_input(input, saved) {
        Err(NotifyError::Validation(message)) => message,
        other => panic!("expected a validation error, got {other:?}"),
    }
}

fn credentials(settings: &ConnectionSettings) -> &NtfyCredentials {
    &ntfy_of(settings).auth
}

mod checks {
    use super::*;

    #[test]
    fn from_input_normalises_the_url_and_trims_the_topic_and_tags() {
        let input = NtfySettingsInput {
            server_url: " https://NTFY.example.com/ ".to_string(),
            topic: " books_2-go ".to_string(),
            priority: 5,
            tags: vec![" books ".to_string(), "warning".to_string()],
            include_details: false,
            ..ntfy_input(URL)
        };

        let settings = from_input(input, None).unwrap();

        let ntfy = ntfy_of(&settings);
        assert_eq!(ntfy.server_url, "https://ntfy.example.com");
        assert_eq!(ntfy.topic, "books_2-go");
        assert_eq!(ntfy.priority, 5);
        assert_eq!(ntfy.tags, ["books", "warning"]);
        assert!(!ntfy.include_details);
        assert_eq!(ntfy.auth, NtfyCredentials::None);
    }

    #[test]
    fn from_input_keeps_a_sub_path_server_url() {
        let settings = from_input(ntfy_input("http://127.0.0.1:9999/ntfy/"), None).unwrap();

        assert_eq!(ntfy_of(&settings).server_url, "http://127.0.0.1:9999/ntfy");
    }

    #[test]
    fn from_input_rejects_a_server_url_that_is_not_absolute_http() {
        for url in ["ntfy.example.com", "ftp://ntfy.example.com", "https://"] {
            let message = rejection(ntfy_input(url), None);
            assert!(message.starts_with("server url"), "{url}: {message}");
        }
    }

    #[test]
    fn from_input_rejects_a_server_url_with_a_login_query_or_fragment() {
        for url in [
            "https://me:pw@ntfy.example.com",
            "https://ntfy.example.com/?auth=x",
            "https://ntfy.example.com/#top",
        ] {
            let message = rejection(ntfy_input(url), None);
            assert!(
                message.starts_with("server url must not"),
                "{url}: {message}"
            );
        }
    }

    #[test]
    fn from_input_rejects_a_topic_outside_ntfys_rule() {
        for topic in ["", "has space", "dots.are.out", &"a".repeat(65), "émoji"] {
            let input = NtfySettingsInput {
                topic: topic.to_string(),
                ..ntfy_input(URL)
            };
            let message = rejection(input, None);
            assert!(message.starts_with("topic must be"), "{topic:?}: {message}");
        }
    }

    #[test]
    fn from_input_accepts_a_topic_of_64_characters() {
        let input = NtfySettingsInput {
            topic: "a".repeat(64),
            ..ntfy_input(URL)
        };

        assert!(from_input(input, None).is_ok());
    }

    #[test]
    fn from_input_rejects_a_priority_outside_1_to_5() {
        for priority in [0, 6] {
            let input = NtfySettingsInput {
                priority,
                ..ntfy_input(URL)
            };
            assert_eq!(rejection(input, None), "priority must be from 1 to 5");
        }
    }

    #[test]
    fn from_input_rejects_a_blank_tag_a_comma_and_too_many_tags() {
        let with_tags = |tags: Vec<String>| NtfySettingsInput {
            tags,
            ..ntfy_input(URL)
        };

        assert_eq!(
            rejection(with_tags(vec![" ".into()]), None),
            "a tag can't be blank"
        );
        assert!(rejection(with_tags(vec!["a,b".into()]), None).contains("comma"));
        assert!(rejection(with_tags(vec!["t".repeat(65)]), None).contains("at most 64"));
        assert!(rejection(with_tags(vec!["t".into(); 11]), None).contains("at most 10 tags"));
    }

    #[test]
    fn from_input_rejects_token_auth_without_a_token() {
        for token in [None, Some(""), Some("   ")] {
            assert_eq!(
                rejection(token_input(URL, token), None),
                "a token is required when auth is token"
            );
        }
    }

    #[test]
    fn from_input_rejects_basic_auth_without_a_username_or_password() {
        assert_eq!(
            rejection(basic_input(URL, None, Some("pw")), None),
            "a username is required when auth is basic"
        );
        assert_eq!(
            rejection(basic_input(URL, Some("  "), Some("pw")), None),
            "a username is required when auth is basic"
        );
        assert_eq!(
            rejection(basic_input(URL, Some("ada"), None), None),
            "a password is required when auth is basic"
        );
    }

    #[test]
    fn from_input_rejects_a_username_holding_a_colon() {
        let message = rejection(basic_input(URL, Some("a:b"), Some("pw")), None);

        assert!(message.contains("colon"), "{message}");
    }

    #[test]
    fn from_input_rejects_an_oversized_or_multi_line_secret_without_echoing_it() {
        let long = "k".repeat(1025);
        let message = rejection(token_input(URL, Some(&long)), None);
        assert_eq!(message, "the token can be at most 1024 bytes");

        let message = rejection(basic_input(URL, Some("ada"), Some("pass\nword")), None);
        assert_eq!(message, "the password can't contain control characters");
    }
}

mod secret_merge {
    use super::*;

    fn saved_token() -> ConnectionSettings {
        stored(token_input(URL, Some("tk_saved")))
    }

    fn saved_basic() -> ConnectionSettings {
        stored(basic_input(URL, Some("ada"), Some("saved-pw")))
    }

    #[test]
    fn from_input_keeps_the_saved_token_when_the_token_is_left_out() {
        let saved = saved_token();

        let merged = from_input(token_input(URL, None), Some(&saved)).unwrap();

        assert_eq!(credentials(&merged), credentials(&saved));
    }

    #[test]
    fn from_input_replaces_the_saved_token_with_a_new_one() {
        let saved = saved_token();

        let merged = from_input(token_input(URL, Some("tk_new")), Some(&saved)).unwrap();

        assert_eq!(
            credentials(&merged),
            &NtfyCredentials::Token {
                token: Secret::new("tk_new")
            }
        );
    }

    #[test]
    fn from_input_refuses_a_token_cleared_with_an_empty_string() {
        let saved = saved_token();

        let message = rejection(token_input(URL, Some("")), Some(&saved));

        assert_eq!(message, "a token is required when auth is token");
    }

    #[test]
    fn from_input_keeps_the_saved_password_when_the_password_is_left_out() {
        let saved = saved_basic();

        let merged = from_input(basic_input(URL, Some("grace"), None), Some(&saved)).unwrap();

        assert_eq!(
            credentials(&merged),
            &NtfyCredentials::Basic {
                username: "grace".to_string(),
                password: Secret::new("saved-pw"),
            }
        );
    }

    #[test]
    fn from_input_refuses_a_password_cleared_with_an_empty_string() {
        let saved = saved_basic();

        let message = rejection(basic_input(URL, Some("ada"), Some("")), Some(&saved));

        assert_eq!(message, "a password is required when auth is basic");
    }

    #[test]
    fn from_input_drops_every_saved_secret_when_auth_becomes_none() {
        let saved = saved_token();
        let input = NtfySettingsInput {
            token: Some("tk_ignored".to_string()),
            password: Some("ignored".to_string()),
            ..ntfy_input(URL)
        };

        let merged = from_input(input, Some(&saved)).unwrap();

        assert_eq!(credentials(&merged), &NtfyCredentials::None);
    }

    #[test]
    fn from_input_never_turns_a_saved_token_into_a_password() {
        let saved = saved_token();

        let message = rejection(basic_input(URL, Some("ada"), None), Some(&saved));

        assert_eq!(message, "a password is required when auth is basic");
    }

    #[test]
    fn from_input_drops_the_saved_password_and_username_when_auth_becomes_token() {
        let saved = saved_basic();

        let message = rejection(token_input(URL, None), Some(&saved));
        let merged = from_input(token_input(URL, Some("tk_new")), Some(&saved)).unwrap();

        assert_eq!(message, "a token is required when auth is token");
        assert_eq!(
            credentials(&merged),
            &NtfyCredentials::Token {
                token: Secret::new("tk_new")
            }
        );
    }
}

mod status {
    use super::*;

    fn status_of(settings: &ConnectionSettings) -> omnibus_shared::NtfySettingsStatus {
        let ConnectionSettingsStatus::Ntfy(status) = settings.status();
        status
    }

    #[test]
    fn status_says_a_token_is_set_without_carrying_it() {
        let settings = stored(token_input(URL, Some("tk_secret")));

        let status = status_of(&settings);

        assert_eq!(status.auth, NtfyAuth::Token);
        assert!(status.token_set);
        assert!(!status.password_set);
        assert_eq!(status.username, None);
        assert!(!serde_json::to_string(&status)
            .unwrap()
            .contains("tk_secret"));
    }

    #[test]
    fn status_names_the_username_and_says_a_password_is_set() {
        let settings = stored(basic_input(URL, Some("ada"), Some("pw-secret")));

        let status = status_of(&settings);

        assert_eq!(status.auth, NtfyAuth::Basic);
        assert_eq!(status.username.as_deref(), Some("ada"));
        assert!(status.password_set);
        assert!(!status.token_set);
        assert!(!serde_json::to_string(&status)
            .unwrap()
            .contains("pw-secret"));
    }

    #[test]
    fn status_sets_neither_flag_without_a_sign_in() {
        let status = status_of(&stored(ntfy_input(URL)));

        assert_eq!(status.auth, NtfyAuth::None);
        assert!(!status.token_set && !status.password_set);
        assert_eq!(status.server_url, URL);
        assert_eq!(status.topic, "omnibus");
    }

    #[test]
    fn kind_names_the_provider() {
        assert_eq!(stored(ntfy_input(URL)).kind(), "ntfy");
    }

    #[test]
    fn settings_debug_never_prints_a_secret() {
        let token = stored(token_input(URL, Some("tk_secret")));
        let basic = stored(basic_input(URL, Some("ada"), Some("pw-secret")));

        let printed = format!("{token:?} {basic:?}");

        assert!(!printed.contains("tk_secret"));
        assert!(!printed.contains("pw-secret"));
        assert!(printed.contains("<redacted>"));
    }

    #[test]
    fn secret_serialises_as_the_plain_value_for_storage() {
        let secret = Secret::new("tk_secret");

        assert_eq!(serde_json::to_string(&secret).unwrap(), "\"tk_secret\"");
        assert_eq!(secret.expose(), "tk_secret");
    }
}
