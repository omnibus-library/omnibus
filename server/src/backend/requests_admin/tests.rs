//! The admin book-request connection routes: the flag answering 404 to everyone before
//! any auth check, the admin gate behind it, and the settings round trip.

use axum::{body::to_bytes, http::StatusCode, Router};
use omnibus_shared::RequestsSettingsStatus;
use serde_json::{json, Value};
use tower::ServiceExt;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::{fixture_book_requests, request};

const SETTINGS: &str = "/api/admin/requests/settings";
const TEST_INDEXER: &str = "/api/admin/requests/settings/test-indexer";
const TEST_CLIENT: &str = "/api/admin/requests/settings/test-client";

fn settings_body() -> Value {
    json!({
        "prowlarr_url": "http://prowlarr:9696",
        "prowlarr_api_key": "indexer-key-abcdef",
        "download_client_kind": "qbittorrent",
        "download_client_url": "http://qbittorrent:8080",
        "download_client_username": "admin",
        "download_client_password": "hunter2-hunter2",
        "download_client_category": "books",
        "download_client_path_prefix": "/downloads",
        "download_path_prefix": "/mnt/completed",
    })
}

async fn admin_token(pool: &sqlx::SqlitePool) -> String {
    let admin = auth_test_support::create_admin(pool, "ada").await;
    auth_test_support::bearer_token(pool, admin.id).await
}

async fn body_text(res: axum::response::Response) -> String {
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

async fn status_of(app: Router, method: &str, uri: &str, token: Option<&str>) -> StatusCode {
    let body = (method != "GET").then(settings_body);
    app.oneshot(request(method, uri, token, body))
        .await
        .unwrap()
        .status()
}

mod flag_gate {
    use super::*;

    const ROUTES: [(&str, &str); 4] = [
        ("GET", SETTINGS),
        ("PUT", SETTINGS),
        ("POST", TEST_INDEXER),
        ("POST", TEST_CLIENT),
    ];

    #[tokio::test]
    async fn answers_404_to_admins_members_and_anonymous_callers_when_off() {
        let (app, _, pool) = fixture_book_requests(false).await;
        let admin = admin_token(&pool).await;
        let member = auth_test_support::create_user(&pool, "reader").await;
        let member = auth_test_support::bearer_token(&pool, member.id).await;

        for (method, uri) in ROUTES {
            for token in [Some(admin.as_str()), Some(member.as_str()), None] {
                let status = status_of(app.clone(), method, uri, token).await;
                assert_eq!(status, StatusCode::NOT_FOUND, "{method} {uri} {token:?}");
            }
        }
    }

    #[tokio::test]
    async fn answers_403_to_a_member_and_401_to_an_anonymous_caller_when_on() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let member = auth_test_support::create_user(&pool, "reader").await;
        let member = auth_test_support::bearer_token(&pool, member.id).await;

        for (method, uri) in ROUTES {
            let as_member = status_of(app.clone(), method, uri, Some(&member)).await;
            assert_eq!(as_member, StatusCode::FORBIDDEN, "{method} {uri}");
            let anonymous = status_of(app.clone(), method, uri, None).await;
            assert_eq!(anonymous, StatusCode::UNAUTHORIZED, "{method} {uri}");
        }
    }
}

mod put_requests_settings {
    use super::*;

    #[tokio::test]
    async fn saves_every_field_and_returns_both_secrets_masked_on_get() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let token = admin_token(&pool).await;

        let put = app
            .clone()
            .oneshot(request(
                "PUT",
                SETTINGS,
                Some(&token),
                Some(settings_body()),
            ))
            .await
            .unwrap();
        assert_eq!(put.status(), StatusCode::OK);
        let get = app
            .oneshot(request("GET", SETTINGS, Some(&token), None))
            .await
            .unwrap();
        assert_eq!(get.status(), StatusCode::OK);
        let text = body_text(get).await;

        assert!(!text.contains("indexer-key-abcdef"));
        assert!(!text.contains("hunter2-hunter2"));
        let status: RequestsSettingsStatus = serde_json::from_str(&text).unwrap();
        assert_eq!(status.prowlarr_url.as_deref(), Some("http://prowlarr:9696"));
        assert_eq!(
            status.prowlarr_api_key_masked.as_deref(),
            Some("inde\u{2026}cdef")
        );
        assert_eq!(
            status.download_client_password_masked.as_deref(),
            Some("hunt\u{2026}ter2")
        );
        assert_eq!(status.download_client_category, "books");
        assert_eq!(
            status.download_path_prefix.as_deref(),
            Some("/mnt/completed")
        );
    }

    #[tokio::test]
    async fn answers_422_and_writes_nothing_for_a_non_http_url() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let token = admin_token(&pool).await;
        let mut bad = settings_body();
        bad["download_client_url"] = json!("ftp://qbittorrent");

        let put = app
            .clone()
            .oneshot(request("PUT", SETTINGS, Some(&token), Some(bad)))
            .await
            .unwrap();
        assert_eq!(put.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let get = app
            .oneshot(request("GET", SETTINGS, Some(&token), None))
            .await
            .unwrap();

        let status: RequestsSettingsStatus = serde_json::from_str(&body_text(get).await).unwrap();
        assert_eq!(status.prowlarr_url, None);
    }
}

/// Save the connections with Prowlarr and the download client at `prowlarr` / `client`.
async fn save_connections(app: &Router, token: &str, prowlarr: &str, client: &str) {
    let mut body = settings_body();
    body["prowlarr_url"] = json!(prowlarr);
    body["download_client_url"] = json!(client);
    let res = app
        .clone()
        .oneshot(request("PUT", SETTINGS, Some(token), Some(body)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

async fn post(app: &Router, uri: &str, token: &str) -> (StatusCode, String) {
    let res = app
        .clone()
        .oneshot(request("POST", uri, Some(token), None))
        .await
        .unwrap();
    (res.status(), body_text(res).await)
}

mod post_test_indexer {
    use super::*;

    async fn prowlarr_answering(response: ResponseTemplate) -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/system/status"))
            .and(header("x-api-key", "indexer-key-abcdef"))
            .respond_with(response)
            .mount(&server)
            .await;
        server
    }

    #[tokio::test]
    async fn answers_200_when_prowlarr_accepts_the_saved_key() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let token = admin_token(&pool).await;
        let prowlarr =
            prowlarr_answering(ResponseTemplate::new(200).set_body_json(json!({}))).await;
        save_connections(&app, &token, &prowlarr.uri(), "http://qbittorrent:8080").await;

        let (status, _) = post(&app, TEST_INDEXER, &token).await;

        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn answers_502_with_a_plain_reason_that_leaves_out_the_key() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let token = admin_token(&pool).await;
        let prowlarr = prowlarr_answering(ResponseTemplate::new(401)).await;
        save_connections(&app, &token, &prowlarr.uri(), "http://qbittorrent:8080").await;

        let (status, body) = post(&app, TEST_INDEXER, &token).await;

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body, "the API key was rejected");
    }

    #[tokio::test]
    async fn answers_409_when_nothing_is_saved() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let token = admin_token(&pool).await;

        let (status, _) = post(&app, TEST_INDEXER, &token).await;

        assert_eq!(status, StatusCode::CONFLICT);
    }
}

mod post_test_client {
    use super::*;

    async fn qbittorrent_answering_login(body: &'static str) -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/v2/auth/login"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("set-cookie", "SID=abc123; path=/")
                    .set_body_string(body),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v2/app/version"))
            .respond_with(ResponseTemplate::new(200).set_body_string("v5.0.4"))
            .mount(&server)
            .await;
        server
    }

    #[tokio::test]
    async fn answers_200_when_the_client_accepts_the_saved_login() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let token = admin_token(&pool).await;
        let client = qbittorrent_answering_login("Ok.").await;
        save_connections(&app, &token, "http://prowlarr:9696", &client.uri()).await;

        let (status, _) = post(&app, TEST_CLIENT, &token).await;

        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn answers_502_with_a_plain_reason_that_leaves_out_the_password() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let token = admin_token(&pool).await;
        let client = qbittorrent_answering_login("Fails.").await;
        save_connections(&app, &token, "http://prowlarr:9696", &client.uri()).await;

        let (status, body) = post(&app, TEST_CLIENT, &token).await;

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body, "the login was rejected");
    }

    #[tokio::test]
    async fn answers_409_when_nothing_is_saved() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let token = admin_token(&pool).await;

        let (status, _) = post(&app, TEST_CLIENT, &token).await;

        assert_eq!(status, StatusCode::CONFLICT);
    }
}
