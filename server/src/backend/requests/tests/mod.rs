//! The reader request routes: the flag and permission gates, starting a request with its
//! caps, and who sees what when one is read.

use std::time::{Duration, Instant};

use axum::{http::StatusCode, Router};
use omnibus_db::requests::store;
use omnibus_db::test_support::EnvVarGuard;
use omnibus_shared::{BookRequest, RequestKind, RequestState, RequestsSettingsUpdate};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::{
    admin_token, body_json, body_text, fixture_book_requests, reader, request, seed_book_with_uuid,
    wait_for_request_state,
};

use super::*;

mod cancel;
mod choose;
mod retry;
mod swap;

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

/// A book in the library by `author`: its uuid.
async fn seed_book_by(pool: &SqlitePool, title: &str, author: &str) -> String {
    omnibus_db::create_fileless_book(
        pool,
        omnibus_db::FilelessBook {
            title: title.to_string(),
            authors: vec![author.to_string()],
            isbn: None,
            pubdate: None,
            description: None,
            cover: None,
        },
    )
    .await
    .unwrap()
}

/// A Prowlarr that answers every search for Dracula with one good ebook, behind the key `k`.
async fn prowlarr_with_dracula() -> MockServer {
    let server = MockServer::start().await;
    let release = json!([{
        "guid": "g1", "title": "Dracula - Bram Stoker EPUB", "size": 900000, "seeders": 12,
        "indexer": "Books", "downloadUrl": "http://prowlarr/1/download?apikey=secret",
        "categories": [{"id": 7020}],
    }]);
    Mock::given(method("GET"))
        .and(path("/api/v1/search"))
        .and(query_param("query", "Dracula Bram Stoker"))
        .respond_with(ResponseTemplate::new(200).set_body_json(release))
        .mount(&server)
        .await;
    server
}

async fn use_prowlarr(pool: &SqlitePool, url: &str) {
    let update = RequestsSettingsUpdate {
        prowlarr_url: url.to_string(),
        prowlarr_api_key: Some("k".to_string()),
        download_client_kind: Default::default(),
        download_client_url: String::new(),
        download_client_username: String::new(),
        download_client_password: None,
        download_client_category: String::new(),
        download_client_path_prefix: String::new(),
        download_path_prefix: String::new(),
    };
    omnibus_db::set_requests_settings(pool, &update)
        .await
        .unwrap();
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

    fn writes() -> [(&'static str, String, Option<Value>); 6] {
        [
            ("POST", start_uri("any"), Some(json!({"kind": "ebook"}))),
            ("POST", "/api/requests/1/retry".to_string(), None),
            ("POST", "/api/requests/1/swap".to_string(), None),
            ("POST", "/api/requests/1/cancel".to_string(), None),
            ("DELETE", "/api/requests/1/cancel".to_string(), None),
            (
                "POST",
                "/api/requests/1/choose".to_string(),
                Some(json!({"result_id": 1})),
            ),
        ]
    }

    fn reads() -> [(&'static str, String, Option<Value>); 2] {
        [
            ("GET", start_uri("any"), None),
            ("GET", "/api/requests/1".to_string(), None),
        ]
    }

    #[tokio::test]
    async fn answers_404_to_everyone_before_sign_in_when_the_flag_is_off() {
        let (app, _, pool) = fixture_book_requests(false).await;
        let admin = admin_token(&pool).await;

        for (method, uri, body) in writes().into_iter().chain(reads()) {
            for token in [None, Some(admin.as_str())] {
                let res = send(&app, method, &uri, token, body.clone()).await;
                assert_eq!(res.status(), StatusCode::NOT_FOUND, "{method} {uri}");
            }
        }
    }

    #[tokio::test]
    async fn answers_401_to_anonymous_on_every_route_when_on() {
        let (app, _, _) = fixture_book_requests(true).await;

        for (method, uri, body) in writes().into_iter().chain(reads()) {
            let res = send(&app, method, &uri, None, body).await;
            assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{uri}");
        }
    }

    #[tokio::test]
    async fn answers_403_to_a_reader_without_the_permission_on_the_writes() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, plain) = reader(&pool, "plain").await;

        for (method, uri, body) in writes() {
            let res = send(&app, method, &uri, Some(&plain), body).await;
            assert_eq!(res.status(), StatusCode::FORBIDDEN, "{uri}");
        }
    }

    #[tokio::test]
    async fn lets_a_reader_without_the_permission_read_a_book_s_requests_and_one_request() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, _) = requester(&pool, "ada").await;
        let (_, plain) = reader(&pool, "plain").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;

        let list = send(&app, "GET", &start_uri(&uuid), Some(&plain), None).await;
        let one = send(
            &app,
            "GET",
            &format!("/api/requests/{id}"),
            Some(&plain),
            None,
        )
        .await;

        assert_eq!(list.status(), StatusCode::OK);
        assert_eq!(one.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn lets_an_admin_and_a_granted_reader_start_a_request_when_on() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let admin = admin_token(&pool).await;
        let (_, granted) = requester(&pool, "granted").await;
        let uuid = seed_book(&pool, "Dracula").await;

        for token in [admin, granted] {
            let body = Some(json!({"kind": "ebook"}));
            let res = send(&app, "POST", &start_uri(&uuid), Some(&token), body).await;
            assert!(res.status().is_success());
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
        // With a Prowlarr to answer, the first start's search lands on `choose`, still live; without
        // one it parks the request as `stuck` and races the second start into a fresh row.
        let prowlarr = prowlarr_with_dracula().await;
        use_prowlarr(&pool, &prowlarr.uri()).await;
        let (_, token) = requester(&pool, "ada").await;
        let uuid = seed_book_by(&pool, "Dracula", "Bram Stoker").await;
        let first: BookRequest = body_json(start(&app, &uuid, &token, "ebook").await).await;
        wait_for_request_state(&pool, first.id, RequestState::Choose).await;

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
        let (ada, token) = requester(&pool, "ada").await;
        for n in 0..5 {
            let uuid = seed_book(&pool, &format!("Book {n}")).await;
            seed_request(&pool, ada, &uuid).await;
        }
        let sixth = seed_book(&pool, "Book 5").await;

        let res = start(&app, &sixth, &token, "ebook").await;

        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn answers_429_once_the_reader_has_recorded_ten_starts_in_ten_minutes() {
        let (app, state, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        for _ in 0..10 {
            state.request_starts().record(ada);
        }

        let res = start(&app, &uuid, &token, "ebook").await;

        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn charges_the_start_cap_only_for_a_request_it_creates() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let other = seed_book(&pool, "Carmilla").await;
        // Seeded straight into the table, so no search runs and ends it before the starts below.
        seed_request(&pool, ada, &uuid).await;
        for _ in 0..11 {
            let again = start(&app, &uuid, &token, "ebook").await;
            assert_eq!(again.status(), StatusCode::OK);
        }

        let second_book = start(&app, &other, &token, "ebook").await;

        assert_eq!(second_book.status(), StatusCode::CREATED);
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM book_requests")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 2);
    }

    #[tokio::test]
    async fn answers_500_when_the_database_fails() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        pool.close().await;

        let res = start(&app, &uuid, &token, "ebook").await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}

mod start_log {
    use super::*;

    #[test]
    fn has_no_room_after_ten_recorded_starts_until_the_window_passes() {
        let log = StartLog::default();
        let now = Instant::now();
        for _ in 0..10 {
            assert!(log.has_room_at(1, now));
            log.record_at(1, now);
        }

        assert!(!log.has_room_at(1, now + Duration::from_secs(599)));
        assert!(log.has_room_at(1, now + Duration::from_secs(600)));
    }

    #[test]
    fn counts_each_reader_apart() {
        let log = StartLog::default();
        let now = Instant::now();
        for _ in 0..10 {
            log.record_at(1, now);
        }

        assert!(log.has_room_at(2, now));
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
    async fn carries_the_progress_of_a_request_on_its_way_and_never_its_client_tag() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let (ada, token) = requester(&pool, "ada").await;
        let uuid = seed_book(&pool, "Dracula").await;
        let id = seed_request(&pool, ada, &uuid).await;
        sqlx::query(
            "UPDATE book_requests SET state = 'on_its_way', progress = 0.4,
             client_tag = 'omnibus-secret' WHERE id = ?",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

        let res = send(
            &app,
            "GET",
            &format!("/api/requests/{id}"),
            Some(&token),
            None,
        )
        .await;

        let text = body_text(res).await;
        let body: BookRequest = serde_json::from_str(&text).unwrap();
        assert_eq!(body.state, RequestState::OnItsWay);
        assert_eq!(body.progress, Some(0.4));
        assert!(!text.contains("omnibus-secret"));
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

mod search_after_start {
    use super::*;

    #[tokio::test]
    async fn offers_the_versions_found_without_ever_sending_a_link() {
        let (app, _, pool) = fixture_book_requests(true).await;
        let prowlarr = prowlarr_with_dracula().await;
        use_prowlarr(&pool, &prowlarr.uri()).await;
        let (_, token) = requester(&pool, "ada").await;
        let uuid = seed_book_by(&pool, "Dracula", "Bram Stoker").await;
        let started: BookRequest = body_json(
            send(
                &app,
                "POST",
                &start_uri(&uuid),
                Some(&token),
                Some(json!({"kind": "ebook"})),
            )
            .await,
        )
        .await;
        assert_eq!(started.state, RequestState::Looking);

        wait_for_request_state(&pool, started.id, RequestState::Choose).await;
        let res = send(
            &app,
            "GET",
            &format!("/api/requests/{}", started.id),
            Some(&token),
            None,
        )
        .await;

        let text = body_text(res).await;
        let found: BookRequest = serde_json::from_str(&text).unwrap();
        assert_eq!(found.versions.len(), 1);
        assert_eq!(found.versions[0].format.as_deref(), Some("EPUB"));
        assert!(found.versions[0].best_match);
        for leak in ["apikey", "secret", "download", "magnet"] {
            assert!(!text.contains(leak), "{leak} in {text}");
        }
    }

    #[tokio::test]
    async fn gets_stuck_and_tells_only_an_admin_why_when_prowlarr_is_not_set_up() {
        let _env = EnvVarGuard::set("OMNIBUS_PROWLARR_API_KEY", None);
        let (app, _, pool) = fixture_book_requests(true).await;
        let (_, token) = requester(&pool, "ada").await;
        let admin = admin_token(&pool).await;
        let uuid = seed_book_by(&pool, "Dracula", "Bram Stoker").await;
        let started: BookRequest = body_json(
            send(
                &app,
                "POST",
                &start_uri(&uuid),
                Some(&token),
                Some(json!({"kind": "ebook"})),
            )
            .await,
        )
        .await;
        wait_for_request_state(&pool, started.id, RequestState::Stuck).await;
        let uri = format!("/api/requests/{}", started.id);

        let as_reader: BookRequest =
            body_json(send(&app, "GET", &uri, Some(&token), None).await).await;
        let as_admin: BookRequest =
            body_json(send(&app, "GET", &uri, Some(&admin), None).await).await;

        assert_eq!(
            as_reader.stuck_reason,
            Some(omnibus_shared::StuckReason::SearchFailed)
        );
        assert_eq!(as_reader.stuck_detail, None);
        assert_eq!(as_admin.stuck_detail.as_deref(), Some("not set up yet"));
    }
}
