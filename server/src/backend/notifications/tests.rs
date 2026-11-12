//! The notification connection routes: the admin gate on every route, the CRUD round trip
//! with its 422s and 404s, secrets that never come back out, the test send against a local
//! ntfy stand-in, the events the flag offers, and the 500s of a closed pool.

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

mod create_connection {
    use super::*;

    #[tokio::test]
    async fn create_connection_answers_201_without_the_secret_it_saved() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let body = connection(
            "Phone",
            with_token("https://ntfy.example.com/", Some(TOKEN)),
        );

        let (status, text) = call(&app, &token, "POST", CONNECTIONS, Some(body)).await;

        assert_eq!(status, StatusCode::CREATED);
        assert!(!text.contains(TOKEN), "{text}");
        let created: NotificationConnection = serde_json::from_str(&text).unwrap();
        assert_eq!(created.name, "Phone");
        assert!(created.enabled);
        assert_eq!(status_of(&created).server_url, "https://ntfy.example.com");
        assert!(status_of(&created).token_set);
    }

    #[tokio::test]
    async fn create_connection_answers_422_with_the_reason_for_invalid_settings() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let body = connection("Phone", with_token("https://ntfy.example.com", None));

        let (status, text) = call(&app, &token, "POST", CONNECTIONS, Some(body)).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(text, "a token is required when auth is token");
    }

    #[tokio::test]
    async fn create_connection_answers_422_for_a_blank_name() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let body = connection("  ", ntfy("https://ntfy.example.com"));

        let (status, text) = call(&app, &token, "POST", CONNECTIONS, Some(body)).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(text.contains("name"), "{text}");
    }

    #[tokio::test]
    async fn create_connection_answers_422_for_an_unknown_provider() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let body = connection("Phone", json!({ "kind": "pigeon" }));

        let (status, _) = call(&app, &token, "POST", CONNECTIONS, Some(body)).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }
}

mod update_connection {
    use super::*;

    #[tokio::test]
    async fn update_connection_keeps_a_token_left_out_and_returns_none_of_it() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let server = ntfy_answering(ResponseTemplate::new(200)).await;
        let id = create(
            &app,
            &token,
            connection("Phone", with_token(&server.uri(), Some(TOKEN))),
        )
        .await
        .id;
        let uri = format!("{CONNECTIONS}/{id}");

        let (status, text) = call(
            &app,
            &token,
            "PUT",
            &uri,
            Some(connection("Renamed", with_token(&server.uri(), None))),
        )
        .await;
        let test = json!({ "id": id, "settings": with_token(&server.uri(), None) });
        let (sent, _) = call(&app, &token, "POST", TEST, Some(test)).await;

        assert_eq!(status, StatusCode::OK);
        assert!(!text.contains(TOKEN), "{text}");
        let updated: NotificationConnection = serde_json::from_str(&text).unwrap();
        assert_eq!(updated.name, "Renamed");
        assert!(status_of(&updated).token_set);
        assert_eq!(sent, StatusCode::NO_CONTENT);
        assert_eq!(authorizations(&server).await, [format!("Bearer {TOKEN}")]);
    }

    #[tokio::test]
    async fn update_connection_replaces_the_password_with_a_new_one() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let server = ntfy_answering(ResponseTemplate::new(200)).await;
        let id = create(
            &app,
            &token,
            connection("Phone", with_basic(&server.uri(), Some(PASSWORD))),
        )
        .await
        .id;

        let (status, _) = call(
            &app,
            &token,
            "PUT",
            &format!("{CONNECTIONS}/{id}"),
            Some(connection(
                "Phone",
                with_basic(&server.uri(), Some("new-pw")),
            )),
        )
        .await;
        let test = json!({ "id": id, "settings": with_basic(&server.uri(), None) });
        call(&app, &token, "POST", TEST, Some(test)).await;

        assert_eq!(status, StatusCode::OK);
        // base64("ada:new-pw")
        assert_eq!(authorizations(&server).await, ["Basic YWRhOm5ldy1wdw=="]);
    }

    #[tokio::test]
    async fn update_connection_answers_422_when_the_server_url_changes_without_the_token() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let saved = ntfy_answering(ResponseTemplate::new(200)).await;
        let elsewhere = ntfy_answering(ResponseTemplate::new(200)).await;
        let id = create(
            &app,
            &token,
            connection("Phone", with_token(&saved.uri(), Some(TOKEN))),
        )
        .await
        .id;

        let (status, text) = call(
            &app,
            &token,
            "PUT",
            &format!("{CONNECTIONS}/{id}"),
            Some(connection("Phone", with_token(&elsewhere.uri(), None))),
        )
        .await;
        let test = json!({ "id": id, "settings": with_token(&saved.uri(), None) });
        call(&app, &token, "POST", TEST, Some(test)).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(text, "enter the token again: the server URL changed");
        assert!(elsewhere.received_requests().await.unwrap().is_empty());
        // Nothing was saved: the token still goes to its own server.
        assert_eq!(authorizations(&saved).await, [format!("Bearer {TOKEN}")]);
    }

    #[tokio::test]
    async fn update_connection_answers_422_when_an_empty_token_clears_the_only_one() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = create(
            &app,
            &token,
            connection("Phone", with_token("http://127.0.0.1:9", Some(TOKEN))),
        )
        .await
        .id;

        let (status, text) = call(
            &app,
            &token,
            "PUT",
            &format!("{CONNECTIONS}/{id}"),
            Some(connection(
                "Phone",
                with_token("http://127.0.0.1:9", Some("")),
            )),
        )
        .await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(text, "a token is required when auth is token");
    }

    #[tokio::test]
    async fn update_connection_answers_404_for_an_unknown_id() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let (status, _) = call(
            &app,
            &token,
            "PUT",
            &format!("{CONNECTIONS}/42"),
            Some(connection("Phone", ntfy("http://127.0.0.1:9"))),
        )
        .await;

        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}

mod set_connection_enabled {
    use super::*;

    #[tokio::test]
    async fn set_connection_enabled_answers_200_with_the_whole_connection_and_no_secret() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let created = create(
            &app,
            &token,
            connection("Phone", with_token("http://127.0.0.1:9", Some(TOKEN))),
        )
        .await;
        let uri = format!("{CONNECTIONS}/{}", created.id);

        let (status, text) = call(
            &app,
            &token,
            "PATCH",
            &uri,
            Some(json!({ "enabled": false })),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert!(!text.contains(TOKEN), "{text}");
        let switched: NotificationConnection = serde_json::from_str(&text).unwrap();
        assert!(!switched.enabled);
        assert_eq!(switched.name, created.name);
        assert_eq!(switched.events, created.events);
        assert_eq!(switched.settings, created.settings);
        assert!(status_of(&switched).token_set);
        assert_eq!(switched.last_delivery, None);
    }

    #[tokio::test]
    async fn set_connection_enabled_answers_404_for_an_unknown_id() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let (status, _) = call(
            &app,
            &token,
            "PATCH",
            &format!("{CONNECTIONS}/42"),
            Some(json!({ "enabled": true })),
        )
        .await;

        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn set_connection_enabled_answers_422_for_a_body_that_is_not_just_a_bool_enabled() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = create(
            &app,
            &token,
            connection("Phone", ntfy("http://127.0.0.1:9")),
        )
        .await
        .id;
        let uri = format!("{CONNECTIONS}/{id}");

        for body in [
            json!({}),
            json!({ "enabled": "yes" }),
            json!({ "enabled": true, "name": "x" }),
        ] {
            let (status, _) = call(&app, &token, "PATCH", &uri, Some(body.clone())).await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        }
        let (_, text) = call(&app, &token, "GET", CONNECTIONS, None).await;
        let listed: NotificationConnections = serde_json::from_str(&text).unwrap();
        assert!(listed.connections[0].enabled);
        assert_eq!(listed.connections[0].name, "Phone");
    }
}

mod delete_connection {
    use super::*;

    #[tokio::test]
    async fn delete_connection_answers_204_and_the_connection_is_gone() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let id = create(
            &app,
            &token,
            connection("Phone", ntfy("http://127.0.0.1:9")),
        )
        .await
        .id;

        let (status, _) = call(&app, &token, "DELETE", &format!("{CONNECTIONS}/{id}"), None).await;
        let (_, text) = call(&app, &token, "GET", CONNECTIONS, None).await;

        assert_eq!(status, StatusCode::NO_CONTENT);
        let listed: NotificationConnections = serde_json::from_str(&text).unwrap();
        assert!(listed.connections.is_empty());
    }

    #[tokio::test]
    async fn delete_connection_answers_404_for_an_unknown_id() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;

        let (status, _) = call(&app, &token, "DELETE", &format!("{CONNECTIONS}/42"), None).await;

        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}

mod post_test {
    use super::*;

    #[tokio::test]
    async fn post_test_answers_204_when_the_provider_accepts_an_unsaved_draft() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let server = ntfy_answering(ResponseTemplate::new(200)).await;
        let body = json!({ "settings": with_token(&server.uri(), Some(TOKEN)) });

        let (status, _) = call(&app, &token, "POST", TEST, Some(body)).await;

        assert_eq!(status, StatusCode::NO_CONTENT);
        let received = server.received_requests().await.unwrap();
        let sent: Value = serde_json::from_slice(&received[0].body).unwrap();
        assert_eq!(sent["title"], "Test notification from Omnibus");
        assert_eq!(authorizations(&server).await, [format!("Bearer {TOKEN}")]);
    }

    #[tokio::test]
    async fn post_test_answers_502_with_a_sentence_for_the_providers_refusal() {
        let cases = [
            (
                401,
                "ntfy refused the sign-in. Check the access token, or the username and password.",
            ),
            (
                500,
                "The ntfy server had a problem and couldn't take the message (HTTP 500).",
            ),
        ];
        for (code, sentence) in cases {
            let (app, _, pool) = fixture().await;
            let token = admin_token(&pool).await;
            let server =
                ntfy_answering(ResponseTemplate::new(code).set_body_string("disk full")).await;
            let body = json!({ "settings": ntfy(&server.uri()) });

            let (status, text) = call(&app, &token, "POST", TEST, Some(body)).await;

            assert_eq!(status, StatusCode::BAD_GATEWAY);
            assert_eq!(text, sentence);
        }
    }

    #[tokio::test]
    async fn post_test_answers_502_with_a_sentence_when_nothing_listens() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let body = json!({ "settings": ntfy(&omnibus_db::test_support::closed_port_url()) });

        let (status, text) = call(&app, &token, "POST", TEST, Some(body)).await;

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(
            text,
            "Couldn't connect to the ntfy server. Check the server URL and that the server is running."
        );
    }

    #[tokio::test]
    async fn post_test_answers_502_without_the_token_a_provider_echoes() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let server = MockServer::start().await;
        Mock::given(wiremock::matchers::method("POST"))
            .respond_with(|request: &Request| {
                let auth = request
                    .headers
                    .get("authorization")
                    .and_then(|v| v.to_str().ok());
                ResponseTemplate::new(403)
                    .set_body_string(format!("refused {}", auth.unwrap_or_default()))
            })
            .mount(&server)
            .await;
        let body = json!({ "settings": with_token(&server.uri(), Some(TOKEN)) });

        let (status, text) = call(&app, &token, "POST", TEST, Some(body)).await;

        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert!(!text.contains(TOKEN), "{text}");
        assert_eq!(
            text,
            "ntfy didn't let this sign-in post to the topic. Check that the token or account can write to it."
        );
    }

    #[tokio::test]
    async fn post_test_answers_422_and_sends_nothing_when_a_saved_secret_would_go_elsewhere() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let saved = ntfy_answering(ResponseTemplate::new(200)).await;
        let elsewhere = ntfy_answering(ResponseTemplate::new(200)).await;
        let token_id = create(
            &app,
            &token,
            connection("Token", with_token(&saved.uri(), Some(TOKEN))),
        )
        .await
        .id;
        let basic_id = create(
            &app,
            &token,
            connection("Basic", with_basic(&saved.uri(), Some(PASSWORD))),
        )
        .await
        .id;

        let tests = [
            (
                json!({ "id": token_id, "settings": with_token(&elsewhere.uri(), None) }),
                "enter the token again: the server URL changed",
            ),
            (
                json!({ "id": basic_id, "settings": with_basic(&elsewhere.uri(), None) }),
                "enter the password again: the server URL or username changed",
            ),
        ];
        for (body, expected) in tests {
            let (status, text) = call(&app, &token, "POST", TEST, Some(body)).await;

            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(text, expected);
        }
        assert!(elsewhere.received_requests().await.unwrap().is_empty());
        assert!(saved.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn post_test_answers_404_for_an_unknown_saved_connection() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let body = json!({ "id": 42, "settings": ntfy("http://127.0.0.1:9") });

        let (status, _) = call(&app, &token, "POST", TEST, Some(body)).await;

        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn post_test_answers_422_for_an_unsaved_draft_missing_its_token() {
        let (app, _, pool) = fixture().await;
        let token = admin_token(&pool).await;
        let body = json!({ "settings": with_token("http://127.0.0.1:9", None) });

        let (status, text) = call(&app, &token, "POST", TEST, Some(body)).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(text, "a token is required when auth is token");
    }
}

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
