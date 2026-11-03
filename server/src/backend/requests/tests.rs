//! The reader request routes: the flag and permission gates, starting a request with its
//! caps, and who sees what when one is read.

use std::time::{Duration, Instant};

use axum::{http::StatusCode, Router};
use omnibus_db::requests::store;
use omnibus_shared::{BookRequest, RequestKind};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::{
    admin_token, body_json, body_text, fixture_book_requests, reader, request, seed_book_with_uuid,
};

use super::*;

/// A reader allowed to request: id and bearer token.
async fn requester(pool: &SqlitePool, name: &str) -> (i64, String) {
    let (id, token) = reader(pool, name).await;
    auth_test_support::set_request_flags(pool, id, false, true).await;
    (id, token)
}

/// A book in the library: its uuid.
async fn seed_book(pool: &SqlitePool, title: &str) -> String {
    seed_book_with_uuid(pool, "/lib", title).await.1
}

/// A live request in the table, without starting a search.
async fn seed_request(pool: &SqlitePool, user: i64, book_uuid: &str) -> i64 {
    store::start(pool, user, book_uuid, RequestKind::Ebook, 5)
        .await
        .unwrap()
        .request
        .id
}

async fn send(
    app: &Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> axum::response::Response {
    app.clone()
        .oneshot(request(method, uri, token, body))
        .await
        .unwrap()
}

fn start_uri(uuid: &str) -> String {
    format!("/api/books/{uuid}/requests")
}

mod flag_and_permission_gate {
    use super::*;

    fn routes() -> [(&'static str, String, Option<Value>); 3] {
        [
            ("POST", start_uri("any"), Some(json!({"kind": "ebook"}))),
            ("GET", start_uri("any"), None),
            ("GET", "/api/requests/1".to_string(), None),
        ]
    }

    #[tokio::test]
    async fn answers_404_to_everyone_before_sign_in_when_the_flag_is_off() {
        let (app, _, pool) = fixture_book_requests(false).await;
        let admin = admin_token(&pool).await;

        for (method, uri, body) in routes() {
            for token in [None, Some(admin.as_str())] {
                let res = send(&app, method, &uri, token, body.clone()).await;
                assert_eq!(res.status(), StatusCode::NOT_FOUND, "{method} {uri}");
            }
        }
    }

    #[tokio::test]
    async fn answers_401_to_anonymous_and_403_to_a_reader_without_the_permission() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, plain) = reader(&pool, "plain").await;

        for (method, uri, body) in routes() {
            let anonymous = send(&app, method, &uri, None, body.clone()).await;
            assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED, "{uri}");
            let plain = send(&app, method, &uri, Some(&plain), body).await;
            assert_eq!(plain.status(), StatusCode::FORBIDDEN, "{uri}");
        }
    }

    #[tokio::test]
    async fn lets_an_admin_and_a_granted_reader_through_when_on() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let admin = admin_token(&pool).await;
        let (_, granted) = requester(&pool, "granted").await;

        for token in [admin, granted] {
            let res = send(&app, "GET", &start_uri("any"), Some(&token), None).await;
            assert_eq!(res.status(), StatusCode::OK);
        }
    }
}

mod post_start_request {
    use super::*;

    async fn start(app: &Router, uuid: &str, token: &str, kind: &str) -> axum::response::Response {
        send(
            app,
            "POST",
            &start_uri(uuid),
            Some(token),
            Some(json!({"kind": kind})),
        )
        .await
    }

    #[tokio::test]
    async fn records_a_looking_ebook_request_for_the_caller_with_201() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;

        let res = start(&app, &uuid, &token, "ebook").await;

        assert_eq!(res.status(), StatusCode::CREATED);
        let body: BookRequest = body_json(res).await;
        assert_eq!(body.user_id, ada);
        assert_eq!(body.book_uuid, uuid);
        assert_eq!(body.kind, RequestKind::Ebook);
        assert_eq!(body.state, omnibus_shared::RequestState::Looking);
        assert!(body.versions.is_empty());
    }

    #[tokio::test]
    async fn stores_the_canonical_uuid_when_given_a_merged_one() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        let (id, uuid) = seed_book_with_uuid(&pool, "/lib", "Dracula").await;
        sqlx::query(
            "INSERT INTO merged_uuids (uuid, book_id, format, library_path)
             VALUES ('old-uuid', ?, 'epub', '/lib')",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

        let res = start(&app, "old-uuid", &token, "ebook").await;

        let body: BookRequest = body_json(res).await;
        assert_eq!(body.book_uuid, uuid);
    }

    #[tokio::test]
    async fn returns_the_live_request_with_200_and_adds_no_row_on_a_second_start() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let first: BookRequest = body_json(start(&app, &uuid, &token, "ebook").await).await;

        let again = start(&app, &uuid, &token, "ebook").await;

        assert_eq!(again.status(), StatusCode::OK);
        let again: BookRequest = body_json(again).await;
        assert_eq!(again.id, first.id);
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM book_requests")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[tokio::test]
    async fn answers_400_for_an_audiobook_and_writes_nothing() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;

        let res = start(&app, &uuid, &token, "audiobook").await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM book_requests")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[tokio::test]
    async fn answers_404_for_an_unknown_book() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;

        let res = start(&app, "no-such-book", &token, "ebook").await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn answers_429_to_the_sixth_live_request_of_one_reader() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        for n in 0..5 {
            let uuid = seed_book(&pool, &format!("Book {n}")).await;
            let res = start(&app, &uuid, &token, "ebook").await;
            assert_eq!(res.status(), StatusCode::CREATED);
        }
        let sixth = seed_book(&pool, "Book 5").await;

        let res = start(&app, &sixth, &token, "ebook").await;

        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn answers_429_to_the_eleventh_start_in_ten_minutes() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        for _ in 0..10 {
            let res = start(&app, &uuid, &token, "ebook").await;
            assert!(res.status().is_success());
        }

        let res = start(&app, &uuid, &token, "ebook").await;

        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
    }
}

mod start_log {
    use super::*;

    #[test]
    fn admits_ten_starts_then_refuses_until_the_window_passes() {
        let log = StartLog::default();
        let now = Instant::now();
        for _ in 0..10 {
            assert!(log.allow_at(1, now));
        }

        assert!(!log.allow_at(1, now + Duration::from_secs(599)));
        assert!(log.allow_at(1, now + Duration::from_secs(600)));
    }

    #[test]
    fn counts_each_reader_apart() {
        let log = StartLog::default();
        let now = Instant::now();
        for _ in 0..10 {
            log.allow_at(1, now);
        }

        assert!(log.allow_at(2, now));
    }
}

mod get_request {
    use super::*;

    async fn stick(pool: &SqlitePool, id: i64) {
        sqlx::query(
            "UPDATE book_requests SET state = 'stuck', stuck_reason = 'search_failed',
             stuck_detail = 'could not connect (connection refused or failed)' WHERE id = ?",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn shows_another_readers_request_but_hides_the_stuck_detail_from_a_reader() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let (_, grace) = requester(&pool, "grace").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        stick(&pool, id).await;

        let res = send(
            &app,
            "GET",
            &format!("/api/requests/{id}"),
            Some(&grace),
            None,
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let text = body_text(res).await;
        let body: BookRequest = serde_json::from_str(&text).unwrap();
        assert_eq!(body.user_id, ada);
        assert_eq!(
            body.stuck_reason,
            Some(omnibus_shared::StuckReason::SearchFailed)
        );
        assert_eq!(body.stuck_detail, None);
        assert!(!text.contains("connection refused"));
    }

    #[tokio::test]
    async fn shows_the_stuck_detail_to_an_admin() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let admin = admin_token(&pool).await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        stick(&pool, id).await;

        let res = send(
            &app,
            "GET",
            &format!("/api/requests/{id}"),
            Some(&admin),
            None,
        )
        .await;

        let body: BookRequest = body_json(res).await;
        assert_eq!(
            body.stuck_detail.as_deref(),
            Some("could not connect (connection refused or failed)")
        );
    }

    #[tokio::test]
    async fn answers_404_for_an_unknown_request() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;

        let res = send(&app, "GET", "/api/requests/999", Some(&token), None).await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }
}

mod get_book_requests {
    use super::*;

    #[tokio::test]
    async fn lists_every_readers_requests_for_the_book_newest_first() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, ada_token) = requester(&pool, "ada").await;
        let (grace, _) = requester(&pool, "grace").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let other = seed_book(&pool, "Carmilla").await;
        let first = seed_request(&pool, ada, &uuid).await;
        let second = seed_request(&pool, grace, &uuid).await;
        seed_request(&pool, ada, &other).await;

        let res = send(&app, "GET", &start_uri(&uuid), Some(&ada_token), None).await;

        let ids: Vec<i64> = body_json::<Vec<BookRequest>>(res)
            .await
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, [second, first]);
    }
}
