//! The ntfy connection wiring against a stub Omnibus that records what it is sent.

use omnibus_shared::{DownloadClientKind, NotificationConnectionInput};

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

#[tokio::test]
async fn wire_creates_the_ntfy_connection_when_none_is_saved() {
    let (origin, stub) = spawn_stub(config()).await;

    let wired = run(&origin, DownloadClientKind::Qbittorrent).await.unwrap();

    assert_eq!(
        wired,
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
async fn wire_updates_its_own_ntfy_connection_on_a_later_run() {
    let mut cfg = config();
    cfg.notifications.1 = vec![
        ntfy_connection(2, "Phone", "https://ntfy.sh"),
        ntfy_connection(3, CONNECTION_NAME, "http://127.0.0.1:5555/ntfy"),
    ];
    let (origin, stub) = spawn_stub(cfg).await;

    let wired = run(&origin, DownloadClientKind::Qbittorrent).await.unwrap();

    assert_eq!(
        wired,
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
}

#[tokio::test]
async fn wire_adds_its_own_beside_other_ntfy_connections() {
    let mut cfg = config();
    cfg.notifications.1 = vec![ntfy_connection(2, "Phone", "http://127.0.0.1:2586")];
    let (origin, stub) = spawn_stub(cfg).await;

    let wired = run(&origin, DownloadClientKind::Qbittorrent).await.unwrap();

    assert!(wired.created);
    assert_eq!(
        saves(&calls(&stub)),
        ["POST /api/admin/notifications/connections"]
    );
}

#[tokio::test]
async fn wire_refuses_a_connection_of_its_name_that_is_not_the_mocks() {
    for address in [
        "https://ntfy.sh",
        "http://ntfy.lan/ntfy",
        "http://127.0.0.1:2586",
    ] {
        let mut cfg = config();
        cfg.notifications.1 = vec![ntfy_connection(4, CONNECTION_NAME, address)];
        let (origin, stub) = spawn_stub(cfg).await;

        let err = run(&origin, DownloadClientKind::Qbittorrent)
            .await
            .unwrap_err();

        assert!(
            matches!(err, WireError::NotificationNameTaken(CONNECTION_NAME)),
            "{address}: {err:?}"
        );
        assert!(saves(&calls(&stub)).is_empty(), "{address}");
        assert_eq!(calls(&stub).last().unwrap(), "POST /api/auth/logout");
    }
}

#[tokio::test]
async fn wire_names_the_ntfy_step_that_a_server_refused() {
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
        let (origin, stub) = spawn_stub(cfg).await;

        let err = run(&origin, DownloadClientKind::Qbittorrent)
            .await
            .unwrap_err();

        assert!(
            matches!(&err, WireError::Server { step: s, detail } if *s == step && detail.contains(says)),
            "{err}"
        );
        assert_eq!(calls(&stub).last().unwrap(), "POST /api/auth/logout");
    }
}
