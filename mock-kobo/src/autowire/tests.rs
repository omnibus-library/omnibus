//! Auto-wire: the device's name, the seed admin's credentials, the dev server's
//! port file, and the login-then-reuse-or-create flow against a stub Omnibus.

use std::path::Path;

use axum::http::StatusCode;
use serde_json::{json, Value};
use tempfile::TempDir;

use crate::test_support::{spawn_stub, Stub, STUB_TOKEN};

use super::*;

fn admin() -> SeedUser {
    SeedUser::parse(Some("admin:omnibus-dev")).unwrap()
}

fn stub_with_devices(devices: &[(&str, &str)]) -> Stub {
    Stub {
        devices: devices
            .iter()
            .map(|(name, token)| ((*name).to_owned(), (*token).to_owned()))
            .collect(),
        ..Stub::default()
    }
}

#[test]
fn device_name_is_mock_kobo_for_default_state_path() {
    assert_eq!(device_name(Path::new(DEFAULT_STATE_PATH)), "Mock Kobo");
}

#[test]
fn device_name_is_mock_kobo_for_default_path_spelled_with_dot_slash() {
    assert_eq!(
        device_name(Path::new("./.claude/runtime/mock-kobo.json")),
        "Mock Kobo"
    );
}

#[test]
fn device_name_is_mock_kobo_for_absolute_default_path() {
    assert_eq!(
        device_name(Path::new("/work/omnibus/.claude/runtime/mock-kobo.json")),
        "Mock Kobo"
    );
}

#[test]
fn device_name_appends_stem_for_other_state_file() {
    assert_eq!(device_name(Path::new("other.json")), "Mock Kobo (other)");
}

#[test]
fn device_name_appends_stem_for_state_file_in_another_directory() {
    assert_eq!(
        device_name(Path::new("elsewhere/second.json")),
        "Mock Kobo (second)"
    );
}

#[test]
fn device_name_appends_stem_when_default_file_name_is_elsewhere() {
    assert_eq!(
        device_name(Path::new("/tmp/mock-kobo.json")),
        "Mock Kobo (mock-kobo)"
    );
}

#[test]
fn device_name_uses_path_when_state_file_has_no_stem() {
    assert_eq!(device_name(Path::new("..")), "Mock Kobo (..)");
}

#[test]
fn is_local_url_accepts_localhost_and_loopback_addresses() {
    for url in [
        "http://localhost:3000",
        "https://localhost",
        "http://127.0.0.1:3000",
        "http://127.8.9.10:1",
        "http://[::1]:3000",
    ] {
        assert!(is_local_url(url), "{url}");
    }
}

#[test]
fn is_local_url_rejects_other_hosts() {
    for url in [
        "http://192.0.2.1:9",
        "http://0.0.0.0:3000",
        "https://omnibus.example",
        "http://localhost.example:3000",
        "http://127.0.0.1.example:3000",
        "http://[2001:db8::1]:3000",
        "not a url",
    ] {
        assert!(!is_local_url(url), "{url}");
    }
}

#[test]
fn seed_user_parse_splits_at_first_colon() {
    let seed = SeedUser::parse(Some("admin:pa:ss")).unwrap();

    assert_eq!(seed.username, "admin");
    assert_eq!(seed.password, "pa:ss");
}

#[test]
fn seed_user_parse_reports_no_seed_user_when_unset() {
    assert!(matches!(
        SeedUser::parse(None),
        Err(AutoWireError::NoSeedUser)
    ));
    assert!(matches!(
        SeedUser::parse(Some("")),
        Err(AutoWireError::NoSeedUser)
    ));
}

#[test]
fn seed_user_parse_reports_bad_seed_user_without_colon() {
    assert!(matches!(
        SeedUser::parse(Some("admin")),
        Err(AutoWireError::BadSeedUser)
    ));
}

#[test]
fn seed_user_parse_reports_bad_seed_user_with_empty_username() {
    assert!(matches!(
        SeedUser::parse(Some(":pw")),
        Err(AutoWireError::BadSeedUser)
    ));
}

#[tokio::test]
async fn dev_server_url_reads_port_from_runtime_dir() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("port"), "3456\n").unwrap();

    let url = dev_server_url(dir.path()).await;

    assert_eq!(url, Some("http://127.0.0.1:3456".to_owned()));
}

#[tokio::test]
async fn dev_server_url_is_none_when_port_file_missing() {
    let dir = TempDir::new().unwrap();

    assert_eq!(dev_server_url(dir.path()).await, None);
}

#[tokio::test]
async fn dev_server_url_is_none_when_port_file_is_not_a_port() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("port"), "abc").unwrap();

    assert_eq!(dev_server_url(dir.path()).await, None);
}

#[tokio::test]
async fn wire_reuses_device_with_matching_name() {
    let stub = spawn_stub(stub_with_devices(&[("Mock Kobo", "tok-a")])).await;

    let wired = wire(&stub.origin, &admin(), "Mock Kobo").await.unwrap();

    assert_eq!(wired.token, "tok-a");
    assert!(!stub
        .paths()
        .contains(&"/api/rpc/kobo/devices/create".to_owned()));
}

#[tokio::test]
async fn wire_creates_device_when_no_name_matches() {
    let stub = spawn_stub(stub_with_devices(&[("Mock Kobo", "tok-a")])).await;

    let wired = wire(&stub.origin, &admin(), "Mock Kobo (other)")
        .await
        .unwrap();

    assert_eq!(wired.token, STUB_TOKEN);
    let created = stub.requests_to("/api/rpc/kobo/devices/create");
    assert_eq!(created.len(), 1);
    let body: Value = serde_json::from_str(&created[0].body).unwrap();
    assert_eq!(body, json!({ "name": "Mock Kobo (other)" }));
}

#[tokio::test]
async fn wire_reports_reused_when_name_matches() {
    let stub = spawn_stub(stub_with_devices(&[("Mock Kobo", "tok-a")])).await;

    let wired = wire(&stub.origin, &admin(), "Mock Kobo").await.unwrap();

    assert!(wired.reused);
}

#[tokio::test]
async fn wire_reports_created_when_no_name_matches() {
    let stub = spawn_stub(stub_with_devices(&[("Mock Kobo", "tok-a")])).await;

    let wired = wire(&stub.origin, &admin(), "Mock Kobo (other)")
        .await
        .unwrap();

    assert!(!wired.reused);
}

#[tokio::test]
async fn wire_reuses_first_listed_device_when_names_repeat() {
    let stub = spawn_stub(stub_with_devices(&[
        ("Mock Kobo", "tok-a"),
        ("Mock Kobo", "tok-b"),
    ]))
    .await;

    let wired = wire(&stub.origin, &admin(), "Mock Kobo").await.unwrap();

    assert_eq!(wired.token, "tok-a");
}

#[tokio::test]
async fn wire_sends_login_bearer_to_device_routes() {
    let stub = spawn_stub(Stub::default()).await;

    wire(&stub.origin, &admin(), "Mock Kobo").await.unwrap();

    let list = stub.requests_to("/api/rpc/kobo/devices");
    let create = stub.requests_to("/api/rpc/kobo/devices/create");
    for request in list.iter().chain(&create) {
        assert_eq!(request.headers["authorization"], "Bearer stub-session");
    }
    assert_eq!((list.len(), create.len()), (1, 1));
    let list_body: Value = serde_json::from_str(&list[0].body).unwrap();
    assert_eq!(list_body, json!({}));
}

#[tokio::test]
async fn wire_logs_in_as_bearer_client_named_omnibus_mock_kobo() {
    let stub = spawn_stub(Stub::default()).await;

    wire(&stub.origin, &admin(), "Mock Kobo").await.unwrap();

    let logins = stub.requests_to("/api/auth/login");
    assert_eq!(logins.len(), 1);
    let body: Value = serde_json::from_str(&logins[0].body).unwrap();
    assert_eq!(
        body,
        json!({
            "username": "admin",
            "password": "omnibus-dev",
            "client_kind": "bearer",
            "device_name": "omnibus-mock-kobo",
        })
    );
}

#[tokio::test]
async fn wire_logs_out_after_wiring() {
    let stub = spawn_stub(Stub::default()).await;

    wire(&stub.origin, &admin(), "Mock Kobo").await.unwrap();

    let logouts = stub.requests_to("/api/auth/logout");
    assert_eq!(logouts.len(), 1);
    assert_eq!(logouts[0].headers["authorization"], "Bearer stub-session");
    assert_eq!(stub.paths().last().unwrap(), "/api/auth/logout");
}

#[tokio::test]
async fn wire_logs_out_when_listing_devices_fails() {
    let stub = spawn_stub(Stub {
        devices_status: StatusCode::INTERNAL_SERVER_ERROR,
        ..Stub::default()
    })
    .await;

    let error = wire(&stub.origin, &admin(), "Mock Kobo").await.unwrap_err();

    assert!(matches!(
        error,
        AutoWireError::Rejected {
            step: "POST /api/rpc/kobo/devices",
            status: 500
        }
    ));
    assert_eq!(stub.requests_to("/api/auth/logout").len(), 1);
}

#[tokio::test]
async fn wire_does_not_log_out_when_login_fails() {
    let stub = spawn_stub(Stub {
        login_status: StatusCode::UNAUTHORIZED,
        ..Stub::default()
    })
    .await;

    wire(&stub.origin, &admin(), "Mock Kobo").await.unwrap_err();

    assert!(stub.requests_to("/api/auth/logout").is_empty());
}

#[tokio::test]
async fn wire_reports_rejected_when_login_fails() {
    let stub = spawn_stub(Stub {
        login_status: StatusCode::UNAUTHORIZED,
        ..Stub::default()
    })
    .await;

    let error = wire(&stub.origin, &admin(), "Mock Kobo").await.unwrap_err();

    assert!(matches!(
        error,
        AutoWireError::Rejected {
            step: "POST /api/auth/login",
            status: 401
        }
    ));
    assert!(!format!("{error} {error:?}").contains("omnibus-dev"));
}

#[tokio::test]
async fn wire_does_not_follow_redirects_from_login() {
    let elsewhere = spawn_stub(Stub::default()).await;
    let stub = spawn_stub(Stub {
        login_redirects_to: Some(format!("{}/api/auth/login", elsewhere.origin)),
        ..Stub::default()
    })
    .await;

    let result = wire(&stub.origin, &admin(), "Mock Kobo").await;

    assert!(elsewhere.paths().is_empty(), "{:?}", elsewhere.paths());
    assert!(matches!(
        result,
        Err(AutoWireError::Rejected {
            step: "POST /api/auth/login",
            status: 307
        })
    ));
}

#[tokio::test]
async fn wire_reports_failed_when_server_unreachable() {
    // Port 1 is privileged, so a parallel stub's `bind("127.0.0.1:0")` is never handed it.
    let error = wire("http://127.0.0.1:1", &admin(), "Mock Kobo")
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        AutoWireError::Failed {
            step: "POST /api/auth/login",
            ..
        }
    ));
    assert!(!format!("{error} {error:?}").contains("omnibus-dev"));
}

#[tokio::test]
async fn wire_reports_failed_when_login_reply_has_no_token() {
    let stub = spawn_stub(Stub {
        login_token: None,
        ..Stub::default()
    })
    .await;

    let error = wire(&stub.origin, &admin(), "Mock Kobo").await.unwrap_err();

    let AutoWireError::Failed { step, detail } = error else {
        panic!("expected a failed login, got {error:?}");
    };
    assert_eq!(step, "POST /api/auth/login");
    assert_eq!(detail, "no token in the login reply");
}
