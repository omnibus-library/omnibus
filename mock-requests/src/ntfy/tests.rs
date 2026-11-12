//! Contract tests: the server's own ntfy rendering and sending against the fake, one publish
//! at a time and through the outbox that drains queued notifications.

use omnibus_db::notify::{self, DeliverError, Drained, Event};
use omnibus_db::pool::init_db;
use omnibus_db::requests::prowlarr::ProwlarrRelease;
use omnibus_db::requests::rank::Ranked;
use omnibus_db::requests::store::{self, SearchOutcome};
use omnibus_db::set_public_url;
use omnibus_db::test_support::seed_user;
use omnibus_shared::{
    NotificationConnectionInput, NotificationEvent, NotificationLastDelivery, NtfyAuth,
    ReleaseProtocol, RequestKind,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;

use crate::test_support::{
    control, ntfy_input, ntfy_record, ntfy_settings, send_sample, spawn, Running, PUBLIC_URL,
    SAYS_SERVER_ERROR, SAYS_SIGN_IN_REFUSED, SAYS_TOPIC_FORBIDDEN,
};

use super::*;

const BOOK_UUID: &str = "11111111-1111-4111-8111-111111111111";

/// `POST` `body` to the fake at `path`, signed in with the fake's token.
async fn post(mock: &Running, path: &str, body: &str) -> reqwest::Response {
    reqwest::Client::new()
        .post(format!("{}{path}", mock.origin))
        .bearer_auth(NTFY_TOKEN)
        .body(body.to_string())
        .send()
        .await
        .unwrap()
}

/// `POST` `body` to the fake's `/ntfy` with `authorization` as the header, if any.
async fn post_as(mock: &Running, authorization: Option<&str>, body: &str) -> reqwest::Response {
    let mut request = reqwest::Client::new()
        .post(format!("{}/ntfy", mock.origin))
        .body(body.to_string());
    if let Some(value) = authorization {
        request = request.header("authorization", value);
    }
    request.send().await.unwrap()
}

/// The first publish the fake kept.
async fn first(mock: &Running) -> Value {
    ntfy_record(mock).await["messages"][0].clone()
}

#[tokio::test]
async fn publish_records_every_field_the_servers_render_sent() {
    let mock = spawn().await;
    let settings = ntfy_settings(&mock, NtfyAuth::Token, NTFY_TOKEN);
    let outgoing = notify::render(&settings, &Event::sample(), Some(PUBLIC_URL));
    let sent: Value = serde_json::from_str(&outgoing.body).unwrap();

    notify::deliver(&notify::http_client().unwrap(), outgoing)
        .await
        .unwrap();

    let got = first(&mock).await;
    for field in ["topic", "title", "message", "priority", "tags", "click"] {
        assert!(!sent[field].is_null(), "render sent no {field}");
        assert_eq!(got[field], sent[field], "{field}");
    }
    assert_eq!(
        (got["status"].clone(), got["error"].clone()),
        (json!(200), Value::Null)
    );
    assert_eq!(
        got["auth"],
        json!({"scheme": "bearer", "matched": true, "header": format!("Bearer {NTFY_TOKEN}")})
    );
}

#[tokio::test]
async fn publish_answers_ntfys_message_json_with_the_id_it_recorded() {
    let mock = spawn().await;

    let reply = post(&mock, "/ntfy", r#"{"topic": "omnibus", "message": "hi"}"#).await;

    assert_eq!(reply.status(), 200);
    let echo: Value = reply.json().await.unwrap();
    assert_eq!(echo["id"], first(&mock).await["id"]);
    assert_eq!(
        (&echo["event"], &echo["topic"], &echo["message"]),
        (&json!("message"), &json!("omnibus"), &json!("hi"))
    );
    assert!(echo.get("title").is_none(), "{echo}");
}

#[tokio::test]
async fn publish_accepts_the_address_with_a_trailing_slash() {
    let mock = spawn().await;

    let reply = post(&mock, "/ntfy/", r#"{"topic": "omnibus"}"#).await;

    assert_eq!(reply.status(), 200);
}

#[tokio::test]
async fn publish_accepts_the_fake_clients_login_over_basic_auth() {
    let mock = spawn().await;

    send_sample(&ntfy_settings(&mock, NtfyAuth::Basic, CLIENT_PASSWORD))
        .await
        .unwrap();

    let auth = first(&mock).await["auth"].clone();
    assert_eq!(
        (&auth["scheme"], &auth["matched"]),
        (&json!("basic"), &json!(true))
    );
}

#[tokio::test]
async fn publish_refuses_a_wrong_sign_in_with_a_401_the_server_does_not_retry() {
    for (auth, secret, scheme) in [
        (NtfyAuth::Token, "tk_wrong", "bearer"),
        (NtfyAuth::Basic, "wrong", "basic"),
    ] {
        let mock = spawn().await;

        let err = send_sample(&ntfy_settings(&mock, auth, secret))
            .await
            .unwrap_err();

        assert_eq!(
            err,
            DeliverError::Permanent {
                message: SAYS_SIGN_IN_REFUSED.to_string()
            },
            "{scheme}"
        );
        let got = first(&mock).await;
        assert_eq!(got["status"], 401, "{scheme}");
        assert_eq!(got["error"], "unauthorized", "{scheme}");
        assert_eq!(got["auth"]["scheme"], scheme);
        assert_eq!(got["auth"]["matched"], false, "{scheme}");
        assert_eq!(
            got["topic"], "omnibus",
            "{scheme}: the refusal keeps what was sent"
        );
    }
}

#[tokio::test]
async fn publish_answers_ntfys_own_401_and_403_bodies_for_a_wrong_or_missing_sign_in() {
    let unauthorized = json!({"code": 40101, "http": 401, "error": "unauthorized"});
    let forbidden = json!({"code": 40301, "http": 403, "error": "forbidden"});
    // `mock:wrong`, the fake clients' username with the wrong password.
    let wrong_basic = "Basic bW9jazp3cm9uZw==";
    let cases = [
        (Some("Bearer tk_wrong"), 401, &unauthorized),
        (Some(wrong_basic), 401, &unauthorized),
        (Some("Digest x"), 401, &unauthorized),
        (None, 403, &forbidden),
    ];
    for (authorization, status, body) in cases {
        let mock = spawn().await;

        let reply = post_as(&mock, authorization, r#"{"topic": "omnibus"}"#).await;

        assert_eq!(reply.status(), status, "{authorization:?}");
        assert_eq!(
            &reply.json::<Value>().await.unwrap(),
            body,
            "{authorization:?}"
        );
    }
}

#[tokio::test]
async fn publish_refuses_a_publish_with_no_sign_in_with_a_403_the_server_does_not_retry() {
    let mock = spawn().await;

    let err = send_sample(&ntfy_settings(&mock, NtfyAuth::None, ""))
        .await
        .unwrap_err();

    assert_eq!(
        err,
        DeliverError::Permanent {
            message: SAYS_TOPIC_FORBIDDEN.to_string()
        }
    );
    let got = first(&mock).await;
    assert_eq!(
        (&got["status"], &got["error"]),
        (&json!(403), &json!("forbidden"))
    );
    assert_eq!(
        got["auth"],
        json!({"scheme": "none", "matched": false, "header": null})
    );
}

#[tokio::test]
async fn publish_answers_400_in_ntfys_shape_for_a_body_that_is_not_publish_json() {
    let mock = spawn().await;

    let reply = post(&mock, "/ntfy", "title=hello").await;

    assert_eq!(reply.status(), 400);
    let body: Value = reply.json().await.unwrap();
    assert_eq!((&body["code"], &body["http"]), (&json!(40017), &json!(400)));
    assert!(body["error"].as_str().unwrap().contains("JSON"), "{body}");
    let got = first(&mock).await;
    assert_eq!((&got["status"], &got["topic"]), (&json!(400), &Value::Null));
}

#[tokio::test]
async fn publish_answers_400_for_a_missing_or_invalid_topic() {
    let long = "a".repeat(65);
    for body in [
        json!({"message": "no topic"}),
        json!({"topic": "two words"}),
        json!({"topic": long}),
    ] {
        let mock = spawn().await;

        let reply = post(&mock, "/ntfy", &body.to_string()).await;

        assert_eq!(reply.status(), 400, "{body}");
        let refusal: Value = reply.json().await.unwrap();
        assert_eq!(refusal["code"], 40009, "{body}");
    }
}

#[tokio::test]
async fn publish_records_the_readable_fields_of_a_body_it_refuses() {
    let cases = [
        (
            json!({"topic": "omnibus", "title": "Hi", "priority": 300}),
            40007,
            json!({"topic": "omnibus", "title": "Hi", "priority": 300}),
        ),
        (
            json!({"topic": "omnibus", "title": 5, "tags": ["books"]}),
            40017,
            json!({"topic": "omnibus", "title": null, "tags": ["books"]}),
        ),
    ];
    for (body, code, readable) in cases {
        let mock = spawn().await;

        let reply = post(&mock, "/ntfy", &body.to_string()).await;

        assert_eq!(reply.status(), 400, "{body}");
        let refusal: Value = reply.json().await.unwrap();
        assert_eq!(refusal["code"], code, "{body}");
        let got = first(&mock).await;
        for (field, value) in readable.as_object().unwrap() {
            assert_eq!(&got[field], value, "{body}: {field}");
        }
    }
}

fn published(id: String) -> Published {
    Published {
        id,
        at: 0,
        status: 200,
        error: None,
        auth: Auth {
            scheme: Scheme::None,
            matched: false,
            header: None,
        },
        topic: None,
        title: None,
        message: None,
        priority: None,
        tags: None,
        click: None,
    }
}

#[test]
fn record_keeps_only_the_newest_publishes_past_the_bound() {
    let mut inbox = Inbox::default();

    for _ in 0..MAX_RECORDED + 5 {
        let id = inbox.next_id();
        inbox.record(published(id));
    }

    assert_eq!(inbox.received().len(), MAX_RECORDED);
    assert_eq!(inbox.received()[0].id, "mock00000006");
}

/// An enabled connection to `mock`'s fake, sent the request event.
fn connection(mock: &Running) -> NotificationConnectionInput {
    NotificationConnectionInput {
        name: "Mock ntfy".to_string(),
        enabled: true,
        events: vec![NotificationEvent::RequestNeedsChooser],
        settings: ntfy_input(mock, NtfyAuth::Token, NTFY_TOKEN),
    }
}

/// One version on offer, as the search ranks it.
fn version() -> Ranked {
    Ranked {
        release: ProwlarrRelease {
            guid: "mock-1".to_string(),
            title: "Dune Frank Herbert EPUB".to_string(),
            size_bytes: Some(1),
            seeders: Some(1),
            protocol: Some(ReleaseProtocol::Torrent),
            info_url: None,
            indexer: Some("Mock".to_string()),
            link: "magnet:?xt=urn:btih:00".to_string(),
            categories: vec![7020],
            files: Some(1),
        },
        format: Some("EPUB".to_string()),
        score: 1.0,
        best_match: true,
        rejected: false,
        cause: None,
    }
}

/// An in-memory database with an ntfy connection to `mock`'s fake, and a reader's request
/// whose search reached "Choose a version", which queued one notification for it. Returns
/// the pool and the connection's id.
async fn queued(mock: &Running) -> (SqlitePool, i64) {
    let pool = init_db("sqlite::memory:").await.unwrap();
    set_public_url(&pool, Some(PUBLIC_URL)).await.unwrap();
    let saved = notify::create_connection(&pool, &connection(mock))
        .await
        .unwrap();
    let reader = seed_user(&pool, "reader").await;
    let started = store::start(&pool, reader, BOOK_UUID, RequestKind::Ebook, 10)
        .await
        .unwrap();
    let found = SearchOutcome::Found(vec![version()]);
    store::finish_search(&pool, started.request.id, found)
        .await
        .unwrap();
    assert_eq!(outbox(&pool).await.len(), 1);
    (pool, saved.id)
}

/// Every outbox row's state, attempts and last error, oldest first.
async fn outbox(pool: &SqlitePool) -> Vec<(String, i64, Option<String>)> {
    sqlx::query_as("SELECT state, attempts, last_error FROM notification_deliveries ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

async fn drain(pool: &SqlitePool) -> Drained {
    notify::drain_due(pool, &notify::http_client().unwrap())
        .await
        .unwrap()
}

/// How connection `id`'s last finished notification went, as the connection list shows it.
async fn last_delivery(pool: &SqlitePool, id: i64) -> Option<NotificationLastDelivery> {
    let connections = notify::list_connections(pool).await.unwrap();
    let connection = connections.into_iter().find(|c| c.id == id).unwrap();
    connection.last_delivery
}

#[tokio::test]
async fn drain_due_delivers_a_queued_notification_to_the_fake() {
    let mock = spawn().await;
    let (pool, id) = queued(&mock).await;

    let drained = drain(&pool).await;

    assert_eq!(drained.delivered, 1);
    let got = first(&mock).await;
    assert_eq!(got["status"], 200);
    assert_eq!(got["title"], "A request needs a version picked");
    assert_eq!(
        got["click"],
        format!("{PUBLIC_URL}/requests?book={BOOK_UUID}")
    );
    assert!(last_delivery(&pool, id).await.unwrap().ok);
}

#[tokio::test]
async fn drain_due_keeps_a_notification_queued_with_its_error_after_a_forced_500() {
    let mock = spawn().await;
    control(&mock, "/_mock/ntfy", json!({"fail": "server_error"})).await;
    let (pool, id) = queued(&mock).await;

    let drained = drain(&pool).await;

    assert_eq!(drained.retrying, 1);
    let rows = outbox(&pool).await;
    let (state, attempts, error) = &rows[0];
    assert_eq!((state.as_str(), *attempts), ("queued", 1));
    assert_eq!(error.as_deref(), Some(SAYS_SERVER_ERROR));
    assert_eq!(first(&mock).await["status"], 500);
    assert!(last_delivery(&pool, id).await.is_none());
}

#[tokio::test]
async fn drain_due_fails_a_notification_the_fake_refuses_with_a_401_and_shows_why() {
    let mock = spawn().await;
    control(
        &mock,
        "/_mock/ntfy",
        json!({"fail": "unauthorized", "times": 1}),
    )
    .await;
    let (pool, id) = queued(&mock).await;

    let drained = drain(&pool).await;

    assert_eq!(drained.failed, 1);
    let last = last_delivery(&pool, id).await.unwrap();
    assert!(!last.ok);
    assert_eq!(last.error.as_deref(), Some(SAYS_SIGN_IN_REFUSED));
}

#[tokio::test]
async fn set_connection_enabled_drops_a_pending_retry_before_it_is_ever_sent() {
    let mock = spawn().await;
    control(
        &mock,
        "/_mock/ntfy",
        json!({"fail": "server_error", "times": 1}),
    )
    .await;
    let (pool, id) = queued(&mock).await;
    drain(&pool).await;
    assert_eq!(outbox(&pool).await.len(), 1, "the 500 left a retry queued");

    notify::set_connection_enabled(&pool, id, false)
        .await
        .unwrap();

    assert!(outbox(&pool).await.is_empty());
    assert_eq!(drain(&pool).await, Drained::default());
    assert!(last_delivery(&pool, id).await.is_none());
    let messages = ntfy_record(&mock).await["messages"].clone();
    assert_eq!(messages.as_array().unwrap().len(), 1, "{messages}");
}
