//! The notification connection routes: the shared fixtures, the admin gate on every route,
//! the list and the events the flag offers, and the 500s of a closed pool. The CRUD round
//! trip lives in `connections`, the test send in `post_test`.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json, Router,
};
use omnibus_shared::{
    ConnectionSettingsStatus, NotificationConnection, NotificationConnectionEnabled,
    NotificationConnectionInput, NotificationConnections, NotificationEvent, NotificationTest,
};
use serde_json::{json, Value};
use tower::ServiceExt;
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

use crate::auth::{test_support as auth_test_support, AdminUser, AuthUser};
use crate::backend::test_support::{
    admin_token, body_json, body_text, fixture, fixture_book_requests, reader_token, request,
};

const CONNECTIONS: &str = "/api/admin/notifications/connections";
const TEST: &str = "/api/admin/notifications/test";
const TOKEN: &str = "tk_SECRET_TOKEN_123";
const PASSWORD: &str = "pw-SECRET-456";

fn ntfy(server_url: &str) -> Value {
    json!({
        "kind": "ntfy",
        "server_url": server_url,
        "topic": "omnibus",
        "auth": "none",
    })
}

fn with_token(server_url: &str, token: Option<&str>) -> Value {
    let mut settings = ntfy(server_url);
    settings["auth"] = json!("token");
    if let Some(token) = token {
        settings["token"] = json!(token);
    }
    settings
}

fn with_basic(server_url: &str, password: Option<&str>) -> Value {
    let mut settings = ntfy(server_url);
    settings["auth"] = json!("basic");
    settings["username"] = json!("ada");
    if let Some(password) = password {
        settings["password"] = json!(password);
    }
    settings
}

fn connection(name: &str, settings: Value) -> Value {
    json!({ "name": name, "events": ["request_needs_chooser"], "settings": settings })
}

/// Send `method uri` as the admin with `body`, returning the status and the body text.
async fn call(
    app: &Router,
    token: &str,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, String) {
    let response = app
        .clone()
        .oneshot(request(method, uri, Some(token), body))
        .await
        .unwrap();
    (response.status(), body_text(response).await)
}

/// Create a connection as the admin and return it.
async fn create(app: &Router, token: &str, body: Value) -> NotificationConnection {
    let (status, text) = call(app, token, "POST", CONNECTIONS, Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{text}");
    serde_json::from_str(&text).unwrap()
}

fn status_of(connection: &NotificationConnection) -> &omnibus_shared::NtfySettingsStatus {
    let ConnectionSettingsStatus::Ntfy(status) = &connection.settings;
    status
}

/// A local ntfy stand-in answering every publish with `response`.
async fn ntfy_answering(response: ResponseTemplate) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(wiremock::matchers::method("POST"))
        .respond_with(response)
        .mount(&server)
        .await;
    server
}

/// The `Authorization` header of every publish `server` received.
async fn authorizations(server: &MockServer) -> Vec<String> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|r| {
            r.headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .to_string()
        })
        .collect()
}

mod gate {
    use super::*;

    const ROUTES: [(&str, &str); 6] = [
        ("GET", CONNECTIONS),
        ("POST", CONNECTIONS),
        ("PUT", "/api/admin/notifications/connections/1"),
        ("PATCH", "/api/admin/notifications/connections/1"),
        ("DELETE", "/api/admin/notifications/connections/1"),
        ("POST", TEST),
    ];

    fn body_for(method: &str, uri: &str) -> Option<Value> {
        match (method, uri) {
            ("GET" | "DELETE", _) => None,
            ("PATCH", _) => Some(json!({ "enabled": false })),
            (_, TEST) => Some(json!({ "settings": ntfy("http://127.0.0.1:9") })),
            _ => Some(connection("Phone", ntfy("http://127.0.0.1:9"))),
        }
    }

    #[tokio::test]
    async fn every_route_answers_403_to_a_reader_and_401_to_an_anonymous_caller() {
        let (app, _, pool) = fixture().await;
        let reader = reader_token(&pool).await;

        for (method, uri) in ROUTES {
            let as_reader = app
                .clone()
                .oneshot(request(method, uri, Some(&reader), body_for(method, uri)))
                .await
                .unwrap();
            assert_eq!(as_reader.status(), StatusCode::FORBIDDEN, "{method} {uri}");
            let anonymous = app
                .clone()
                .oneshot(request(method, uri, None, body_for(method, uri)))
                .await
                .unwrap();
            assert_eq!(
                anonymous.status(),
                StatusCode::UNAUTHORIZED,
                "{method} {uri}"
            );
        }
    }
}

mod list_connections {
    use super::*;

    #[tokio::test]
    async fn list_connections_offers_no_events_while_book_requests_are_off() {
        let (app, _, pool) = fixture_book_requests(false).await;
        let token = admin_token(&pool).await;

        let response = app
            .oneshot(request("GET", CONNECTIONS, Some(&token), None))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let listed: NotificationConnections = body_json(response).await;
        assert!(listed.connections.is_empty());
        assert!(listed.available_events.is_empty());
    }

    #[tokio::test]
    async fn list_connections_offers_the_request_event_while_book_requests_are_on() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let token = admin_token(&pool).await;
        create(
            &app,
            &token,
            connection("Phone", ntfy("http://127.0.0.1:9")),
        )
        .await;

        let (status, text) = call(&app, &token, "GET", CONNECTIONS, None).await;

        assert_eq!(status, StatusCode::OK);
        let listed: NotificationConnections = serde_json::from_str(&text).unwrap();
        assert_eq!(
            listed.available_events,
            [NotificationEvent::RequestNeedsChooser]
        );
        assert_eq!(listed.connections.len(), 1);
        assert_eq!(listed.connections[0].last_delivery, None);
    }

    #[tokio::test]
    async fn list_connections_shows_whether_secrets_are_set_but_never_their_values() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        create(
            &app,
            &token,
            connection("Token", with_token("http://127.0.0.1:9", Some(TOKEN))),
        )
        .await;
        create(
            &app,
            &token,
            connection("Basic", with_basic("http://127.0.0.1:9", Some(PASSWORD))),
        )
        .await;

        let (_, text) = call(&app, &token, "GET", CONNECTIONS, None).await;

        assert!(!text.contains(TOKEN) && !text.contains(PASSWORD), "{text}");
        let listed: NotificationConnections = serde_json::from_str(&text).unwrap();
        let basic = status_of(&listed.connections[0]);
        assert!(basic.password_set && !basic.token_set);
        assert_eq!(basic.username.as_deref(), Some("ada"));
        let token_status = status_of(&listed.connections[1]);
        assert!(token_status.token_set && !token_status.password_set);
    }
}

mod connections;
mod post_test;

mod db_errors {
    use super::*;

    fn admin() -> AdminUser {
        AdminUser(AuthUser {
            is_admin: true,
            ..auth_test_support::fake_auth_user(1, 1)
        })
    }

    fn input() -> NotificationConnectionInput {
        serde_json::from_value(connection("Phone", ntfy("http://127.0.0.1:9"))).unwrap()
    }

    #[tokio::test]
    async fn every_route_answers_500_when_the_pool_is_closed() {
        let (_, state, pool) = fixture().await;
        pool.close().await;
        let test: NotificationTest =
            serde_json::from_value(json!({ "id": 1, "settings": ntfy("http://127.0.0.1:9") }))
                .unwrap();

        let statuses = [
            super::super::list_connections(admin(), State(state.clone()))
                .await
                .status(),
            super::super::create_connection(admin(), State(state.clone()), Json(input()))
                .await
                .status(),
            super::super::update_connection(admin(), State(state.clone()), Path(1), Json(input()))
                .await
                .status(),
            super::super::set_connection_enabled(
                admin(),
                State(state.clone()),
                Path(1),
                Json(NotificationConnectionEnabled { enabled: false }),
            )
            .await
            .status(),
            super::super::delete_connection(admin(), State(state.clone()), Path(1))
                .await
                .status(),
            super::super::post_test(admin(), State(state), Json(test))
                .await
                .status(),
        ];

        assert_eq!(statuses, [StatusCode::INTERNAL_SERVER_ERROR; 6]);
    }
}
