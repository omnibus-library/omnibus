//! The ntfy connection wiring against a stub Omnibus that records what it is sent.

use omnibus_shared::{DownloadClientKind, NotificationConnectionInput};
use serde_json::{json, Value};

use crate::wire::test_support::{
    body_of, calls, config, ntfy_connection, run, spawn_stub, Config, CREATED_ID, MOCK,
};

use super::*;

/// The calls that saved or replaced a notification connection.
fn saves(calls: &[String]) -> Vec<&String> {
    calls
        .iter()
        .filter(|c| {
            c.starts_with("POST /api/admin/notifications/connections")
                || c.starts_with("PUT /api/admin/notifications")
        })
        .collect()
}

/// Wire the stub answering as `cfg` says, which must keep the request wiring; returns how
/// the ntfy half went.
async fn wire_ntfy(cfg: Config) -> (Result<NtfyWired, WireError>, Vec<String>) {
    let (origin, stub) = spawn_stub(cfg).await;
    let wired = run(&origin, DownloadClientKind::Qbittorrent).await.unwrap();
    (wired.ntfy, calls(&stub))
}

/// [`ntfy_connection`] signing in by `auth`, with `token_set` saying whether a token is saved.
fn signed_in(id: i64, server_url: &str, auth: &str, token_set: bool) -> Value {
    let mut connection = ntfy_connection(id, CONNECTION_NAME, server_url);
    connection["settings"]["auth"] = json!(auth);
    connection["settings"]["token_set"] = json!(token_set);
    connection["settings"]["username"] = json!((auth == "basic").then_some("mock"));
    connection["settings"]["password_set"] = json!(auth == "basic");
    connection
}

#[tokio::test]
async fn wire_creates_the_ntfy_connection_when_none_is_saved() {
    let (origin, stub) = spawn_stub(config()).await;

    let wired = run(&origin, DownloadClientKind::Qbittorrent).await.unwrap();

    assert_eq!(
        wired.ntfy.unwrap(),
        NtfyWired {
            id: CREATED_ID,
            created: true
        }
    );
    let body = body_of(&stub, "POST /api/admin/notifications/connections");
    let saved: NotificationConnectionInput = serde_json::from_value(body).unwrap();
    assert_eq!(saved.name, CONNECTION_NAME);
    assert!(saved.enabled);
    assert_eq!(saved.events, [NotificationEvent::RequestNeedsChooser]);
    let ConnectionSettingsInput::Ntfy(ntfy) = &saved.settings;
    assert_eq!(ntfy.server_url, format!("{MOCK}/ntfy"));
    assert_eq!(ntfy.topic, TOPIC);
    assert_eq!(ntfy.auth, NtfyAuth::Token);
    assert_eq!(ntfy.token.as_deref(), Some(NTFY_TOKEN));
    assert_eq!(ntfy.tags, ["books"]);
    assert_eq!(ntfy.priority, 4);
}

#[tokio::test]
async fn wire_has_the_server_test_the_connection_it_saved() {
    let (origin, stub) = spawn_stub(config()).await;

    run(&origin, DownloadClientKind::Qbittorrent).await.unwrap();

    let body = body_of(&stub, "POST /api/admin/notifications/test");
    let test: NotificationTest = serde_json::from_value(body).unwrap();
    assert_eq!(test.id, Some(CREATED_ID));
    assert_eq!(test.settings, input_for(MOCK).settings);
}

#[tokio::test]
async fn wire_updates_its_own_ntfy_connection_on_a_later_run_sending_the_token_again() {
    let mut cfg = config();
    cfg.notifications.1 = vec![
        ntfy_connection(2, "Phone", "https://ntfy.sh"),
        ntfy_connection(3, CONNECTION_NAME, "http://127.0.0.1:5555/ntfy/"),
    ];
    let (origin, stub) = spawn_stub(cfg).await;

    let wired = run(&origin, DownloadClientKind::Qbittorrent).await.unwrap();

    assert_eq!(
        wired.ntfy.unwrap(),
        NtfyWired {
            id: 3,
            created: false
        }
    );
    assert_eq!(
        saves(&calls(&stub)),
        ["PUT /api/admin/notifications/connections/3"]
    );
    let body = body_of(&stub, "PUT /api/admin/notifications/connections/3");
    let saved: NotificationConnectionInput = serde_json::from_value(body).unwrap();
    assert_eq!(saved, input_for(MOCK));
    // The server keeps a saved token only for the address it was saved for, and the mock's
    // port changes every run.
    let ConnectionSettingsInput::Ntfy(ntfy) = &saved.settings;
    assert_eq!(ntfy.token.as_deref(), Some(NTFY_TOKEN));
}

#[tokio::test]
async fn wire_adds_its_own_beside_other_ntfy_connections() {
    let mut cfg = config();
    cfg.notifications.1 = vec![ntfy_connection(2, "Phone", "http://127.0.0.1:2586")];

    let (ntfy, calls) = wire_ntfy(cfg).await;

    assert!(ntfy.unwrap().created);
    assert_eq!(saves(&calls), ["POST /api/admin/notifications/connections"]);
}

#[tokio::test]
async fn wire_leaves_a_connection_of_its_name_that_is_not_the_mocks_and_keeps_the_requests() {
    let cases = [
        (signed_in(4, "https://ntfy.sh", "token", true), "remote"),
        (signed_in(4, "http://ntfy.lan/ntfy", "token", true), "lan"),
        (
            signed_in(4, "http://127.0.0.1:2586", "token", true),
            "other path",
        ),
        (
            signed_in(4, "http://127.0.0.1:5555/ntfy", "basic", false),
            "basic",
        ),
        (
            signed_in(4, "http://127.0.0.1:5555/ntfy", "none", false),
            "no sign-in",
        ),
        (
            signed_in(4, "http://127.0.0.1:5555/ntfy", "token", false),
            "no token",
        ),
    ];
    for (connection, case) in cases {
        let mut cfg = config();
        cfg.notifications.1 = vec![connection];

        let (ntfy, calls) = wire_ntfy(cfg).await;

        assert!(
            matches!(ntfy, Err(WireError::NotificationNameTaken(CONNECTION_NAME))),
            "{case}: {ntfy:?}"
        );
        assert!(saves(&calls).is_empty(), "{case}");
        assert!(calls.contains(&"PUT /api/admin/requests/settings".to_string()));
        assert_eq!(calls.last().unwrap(), "POST /api/auth/logout");
    }
}

#[tokio::test]
async fn wire_refuses_to_pick_between_two_connections_that_look_like_the_mocks() {
    let mut cfg = config();
    cfg.notifications.1 = vec![
        signed_in(3, "http://127.0.0.1:5555/ntfy", "token", true),
        signed_in(4, "http://127.0.0.1:6666/ntfy", "token", true),
    ];

    let (ntfy, calls) = wire_ntfy(cfg).await;

    assert!(
        matches!(
            ntfy,
            Err(WireError::NotificationNameRepeated(CONNECTION_NAME))
        ),
        "{ntfy:?}"
    );
    assert!(saves(&calls).is_empty());
}

#[tokio::test]
async fn wire_updates_its_own_beside_a_same_named_one_that_is_not_the_mocks() {
    let mut cfg = config();
    cfg.notifications.1 = vec![
        signed_in(3, "https://ntfy.sh", "token", true),
        signed_in(4, "http://127.0.0.1:5555/ntfy", "token", true),
    ];

    let (ntfy, calls) = wire_ntfy(cfg).await;

    assert_eq!(ntfy.unwrap().id, 4);
    assert_eq!(
        saves(&calls),
        ["PUT /api/admin/notifications/connections/4"]
    );
}

#[tokio::test]
async fn wire_reports_the_ntfy_step_a_server_refused_without_failing_the_requests() {
    type Tweak = fn(&mut Config);
    let steps: [(Tweak, &str, &str); 3] = [
        (
            |c| c.notifications.0 = 404,
            "read notification connections",
            "404",
        ),
        (|c| c.ntfy_save = 422, "save the ntfy connection", "422"),
        (
            |c| {
                c.ntfy_test = (
                    502,
                    "the server answered 401 Unauthorized: {\"code\":40101}",
                )
            },
            "test-ntfy",
            "the server answered 401 Unauthorized",
        ),
    ];
    for (tweak, step, says) in steps {
        let mut cfg = config();
        tweak(&mut cfg);

        let (ntfy, calls) = wire_ntfy(cfg).await;

        assert!(
            matches!(&ntfy, Err(WireError::Server { step: s, detail }) if *s == step && detail.contains(says)),
            "{ntfy:?}"
        );
        assert_eq!(calls.last().unwrap(), "POST /api/auth/logout");
    }
}
