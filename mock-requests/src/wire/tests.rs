//! The wiring against a stub Omnibus that records what it is sent.

use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use omnibus_shared::RequestsSettingsUpdate;
use serde_json::{json, Value};

use super::*;

const MOCK: &str = "http://127.0.0.1:7777";

/// What the stub answers.
struct Config {
    login: u16,
    redirect_login: bool,
    settings: u16,
    saved: Value,
    put: u16,
    test_indexer: (u16, &'static str),
    test_client: (u16, &'static str),
}

struct Stub {
    config: Config,
    calls: Mutex<Vec<String>>,
    bearers: Mutex<Vec<(String, Option<String>)>>,
    put_body: Mutex<Option<Value>>,
}

fn nothing_saved() -> Value {
    json!({
        "prowlarr_url": null,
        "prowlarr_api_key_masked": null,
        "prowlarr_api_key_source": "none",
        "download_client_kind": "qbittorrent",
        "download_client_url": null,
        "download_client_username": null,
        "download_client_password_masked": null,
        "download_client_category": "",
        "download_client_path_prefix": null,
        "download_path_prefix": null,
    })
}

fn saved_with(prowlarr: Option<&str>, client: Option<&str>) -> Value {
    let mut saved = nothing_saved();
    saved["prowlarr_url"] = json!(prowlarr);
    saved["download_client_url"] = json!(client);
    saved
}

async fn handle(
    State(stub): State<Arc<Stub>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let route = format!("{method} {}", uri.path());
    stub.calls.lock().unwrap().push(route.clone());
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    stub.bearers
        .lock()
        .unwrap()
        .push((route.clone(), bearer.map(str::to_string)));
    let c = &stub.config;
    let status = |code: u16| StatusCode::from_u16(code).unwrap();
    match route.as_str() {
        "POST /api/auth/login" if c.redirect_login => (
            StatusCode::TEMPORARY_REDIRECT,
            [(header::LOCATION, "/elsewhere")],
        )
            .into_response(),
        "POST /api/auth/login" => (status(c.login), Json(json!({"token": "tok"}))).into_response(),
        "POST /api/auth/logout" => StatusCode::OK.into_response(),
        "GET /api/admin/requests/settings" => {
            (status(c.settings), Json(c.saved.clone())).into_response()
        }
        "PUT /api/admin/requests/settings" => {
            *stub.put_body.lock().unwrap() = serde_json::from_slice(&body).ok();
            (status(c.put), "a field is too long").into_response()
        }
        "POST /api/admin/requests/settings/test-indexer" => {
            (status(c.test_indexer.0), c.test_indexer.1).into_response()
        }
        "POST /api/admin/requests/settings/test-client" => {
            (status(c.test_client.0), c.test_client.1).into_response()
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

fn config() -> Config {
    Config {
        login: 200,
        redirect_login: false,
        settings: 200,
        saved: nothing_saved(),
        put: 200,
        test_indexer: (200, ""),
        test_client: (200, ""),
    }
}

async fn spawn_stub(config: Config) -> (String, Arc<Stub>) {
    let stub = Arc::new(Stub {
        config,
        calls: Mutex::default(),
        bearers: Mutex::default(),
        put_body: Mutex::default(),
    });
    let app = Router::new().fallback(handle).with_state(stub.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    tokio::spawn(async move { axum::serve(listener, app).await });
    (origin, stub)
}

async fn run(server: &str, kind: DownloadClientKind) -> Result<(), WireError> {
    wire(
        server,
        Some("admin:s3cret:with-colon"),
        MOCK,
        kind,
        Path::new("/dl"),
    )
    .await
}

fn calls(stub: &Stub) -> Vec<String> {
    stub.calls.lock().unwrap().clone()
}

#[tokio::test]
async fn wire_logs_in_saves_the_mock_tests_both_connections_and_logs_out() {
    let (origin, stub) = spawn_stub(config()).await;

    run(&origin, DownloadClientKind::Transmission)
        .await
        .unwrap();

    assert_eq!(
        calls(&stub),
        [
            "POST /api/auth/login",
            "GET /api/admin/requests/settings",
            "PUT /api/admin/requests/settings",
            "POST /api/admin/requests/settings/test-indexer",
            "POST /api/admin/requests/settings/test-client",
            "POST /api/auth/logout",
        ]
    );
    let bearers = stub.bearers.lock().unwrap();
    assert!(
        bearers
            .iter()
            .skip(1)
            .all(|(_, b)| b.as_deref() == Some("Bearer tok")),
        "{bearers:?}"
    );
}

#[tokio::test]
async fn wire_saves_every_field_the_mock_answers_to() {
    let (origin, stub) = spawn_stub(config()).await;

    run(&origin, DownloadClientKind::Sabnzbd).await.unwrap();

    let body = stub.put_body.lock().unwrap().clone().unwrap();
    let saved: RequestsSettingsUpdate = serde_json::from_value(body).unwrap();
    assert_eq!(saved.prowlarr_url, MOCK);
    assert_eq!(saved.prowlarr_api_key.as_deref(), Some("mock-requests"));
    assert_eq!(saved.download_client_kind, DownloadClientKind::Sabnzbd);
    assert_eq!(saved.download_client_url, MOCK);
    assert_eq!(saved.download_client_username, "mock");
    assert_eq!(saved.download_client_password.as_deref(), Some("mock"));
    assert_eq!(saved.download_client_category, "");
    assert_eq!(saved.download_client_path_prefix, "/dl");
    assert_eq!(saved.download_path_prefix, "/dl");
}

#[tokio::test]
async fn wire_replaces_connections_already_on_this_machine() {
    let mut cfg = config();
    cfg.saved = saved_with(Some("http://localhost:9696"), Some("http://127.0.0.1:8080"));
    let (origin, stub) = spawn_stub(cfg).await;

    run(&origin, DownloadClientKind::Qbittorrent).await.unwrap();

    assert!(calls(&stub).contains(&"PUT /api/admin/requests/settings".to_string()));
}

#[tokio::test]
async fn wire_refuses_to_overwrite_a_saved_address_that_is_not_on_this_machine() {
    let cases = [
        (
            saved_with(Some("http://prowlarr.lan:9696"), None),
            "Prowlarr",
        ),
        (
            saved_with(None, Some("https://qbit.example.com")),
            "download client",
        ),
    ];
    for (saved, who) in cases {
        let mut cfg = config();
        cfg.saved = saved;
        let (origin, stub) = spawn_stub(cfg).await;

        let err = run(&origin, DownloadClientKind::Qbittorrent)
            .await
            .unwrap_err();

        assert!(
            matches!(&err, WireError::InUse(w) if w.contains(who)),
            "{err:?}"
        );
        assert!(!calls(&stub).iter().any(|c| c.starts_with("PUT")), "{who}");
        assert_eq!(calls(&stub).last().unwrap(), "POST /api/auth/logout");
    }
}

#[tokio::test]
async fn wire_says_requests_are_off_when_the_settings_answer_404() {
    let mut cfg = config();
    cfg.settings = 404;
    let (origin, _) = spawn_stub(cfg).await;

    let err = run(&origin, DownloadClientKind::Qbittorrent)
        .await
        .unwrap_err();

    assert!(matches!(err, WireError::RequestsOff), "{err:?}");
    assert!(err.to_string().contains("OMNIBUS_BOOK_REQUESTS=1"));
}

#[tokio::test]
async fn wire_sends_nothing_when_it_cannot_be_set_up() {
    let (origin, stub) = spawn_stub(config()).await;
    let mock = MOCK;
    let kind = DownloadClientKind::Qbittorrent;
    let downloads = Path::new("/dl");

    let remote = wire("http://192.0.2.1:3000", Some("a:b"), mock, kind, downloads).await;
    let missing = wire(&origin, None, mock, kind, downloads).await;
    let empty = wire(&origin, Some(""), mock, kind, downloads).await;
    let malformed = wire(&origin, Some("nocolon"), mock, kind, downloads).await;
    let nameless = wire(&origin, Some(":pw"), mock, kind, downloads).await;

    for result in [remote, missing, empty, malformed, nameless] {
        assert!(matches!(result, Err(WireError::Setup(_))), "{result:?}");
    }
    assert!(calls(&stub).is_empty());
}

#[tokio::test]
async fn wire_names_the_step_that_a_server_refused() {
    type Tweak = fn(&mut Config);
    let steps: [(Tweak, &str); 4] = [
        (|c| c.login = 401, "login"),
        (|c| c.put = 422, "save"),
        (
            |c| c.test_indexer = (502, "the API key was rejected"),
            "test-indexer",
        ),
        (
            |c| c.test_client = (502, "could not connect"),
            "test-client",
        ),
    ];
    for (tweak, step) in steps {
        let mut cfg = config();
        tweak(&mut cfg);
        let (origin, _) = spawn_stub(cfg).await;

        let err = run(&origin, DownloadClientKind::Qbittorrent)
            .await
            .unwrap_err();

        let shown = err.to_string();
        assert!(
            matches!(&err, WireError::Server { step: s, .. } if s.contains(step)),
            "{shown}"
        );
        assert!(!shown.contains("127.0.0.1"), "{shown}");
    }
}

#[tokio::test]
async fn wire_puts_the_servers_reason_in_the_error() {
    let mut cfg = config();
    cfg.test_client = (502, "could not connect (connection refused or failed)");
    let (origin, _) = spawn_stub(cfg).await;

    let err = run(&origin, DownloadClientKind::Qbittorrent)
        .await
        .unwrap_err();

    assert!(err
        .to_string()
        .contains("could not connect (connection refused or failed)"));
}

#[tokio::test]
async fn wire_follows_no_redirect_so_the_password_goes_nowhere_else() {
    let mut cfg = config();
    cfg.redirect_login = true;
    let (origin, stub) = spawn_stub(cfg).await;

    let err = run(&origin, DownloadClientKind::Qbittorrent)
        .await
        .unwrap_err();

    assert!(
        matches!(err, WireError::Server { step: "login", .. }),
        "{err:?}"
    );
    assert_eq!(calls(&stub), ["POST /api/auth/login"]);
}

#[test]
fn local_origin_reads_the_port_the_dev_server_published() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("port"), "3010\n").unwrap();

    assert_eq!(local_origin(dir.path()).unwrap(), "http://127.0.0.1:3010");
}

#[test]
fn local_origin_asks_for_dev_up_when_no_port_was_published() {
    let dir = tempfile::tempdir().unwrap();

    let err = local_origin(dir.path()).unwrap_err();

    assert!(
        matches!(&err, WireError::Setup(m) if m.contains("just dev-up")),
        "{err:?}"
    );
}
