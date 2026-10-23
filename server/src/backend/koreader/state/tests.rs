//! Contract tests for `GET`/`PUT /koreader/v1/books/{uuid}/state`: what a KOReader write
//! leaves for the web and iOS readers, and who wins when two devices disagree.

use axum::{http::StatusCode, response::Response};
use omnibus_db as db;
use omnibus_shared::{
    BookProgress, DeviceKind, ProgressFormat, ProgressRecord, ProgressUpdate, ReadStatus,
};
use omnibus_shared::{ReadStatusRecord, SetReadStatus};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::{body_json, get_with_bearer, request};
use crate::backend::{rest_router, AppState};

use super::super::test_support::fixture;

const MISSING: &str = "99999999-9999-9999-9999-999999999999";

fn state_uri(uuid: &str) -> String {
    format!("/koreader/v1/books/{uuid}/state")
}

fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

async fn put(app: &axum::Router, token: &str, uuid: &str, body: Value) -> Response {
    app.clone()
        .oneshot(request("PUT", &state_uri(uuid), Some(token), Some(body)))
        .await
        .unwrap()
}

async fn get(app: &axum::Router, token: &str, uuid: &str) -> Response {
    app.clone()
        .oneshot(get_with_bearer(&state_uri(uuid), token))
        .await
        .unwrap()
}

/// What the web and iOS readers see for `uuid`: the epub position and the read status.
async fn web_view(
    pool: &SqlitePool,
    uid: i64,
    uuid: &str,
) -> (Option<ProgressRecord>, Option<ReadStatusRecord>) {
    let rest = rest_router(AppState::new(pool.clone()));
    let owner = auth_test_support::bearer_token(pool, uid).await;
    let progress = rest
        .clone()
        .oneshot(get_with_bearer(&format!("/api/progress/{uuid}"), &owner))
        .await
        .unwrap();
    let progress: Option<BookProgress> = body_json(progress).await;
    let status = rest
        .oneshot(get_with_bearer(&format!("/api/read-status/{uuid}"), &owner))
        .await
        .unwrap();
    let epub = progress.and_then(|p| {
        p.records
            .into_iter()
            .find(|r| r.format == ProgressFormat::Epub)
    });
    (epub, body_json(status).await)
}

/// A position the web reader stored: a percent at an event time.
async fn web_position(pool: &SqlitePool, uid: i64, uuid: &str, percent: i64, at: i64) {
    let update = ProgressUpdate {
        book_uuid: uuid.to_owned(),
        format: ProgressFormat::Epub,
        epub_cfi: None,
        audio_position_seconds: None,
        progress_percent: Some(percent),
        kobo_location: None,
        book_file_id: None,
        client_updated_at: Some(at),
    };
    db::progress::upsert_progress(pool, uid, &update)
        .await
        .unwrap();
}

/// A status the web stored, dated `at`.
async fn web_status(pool: &SqlitePool, uid: i64, uuid: &str, status: ReadStatus, at: i64) {
    let update = SetReadStatus {
        book_uuid: uuid.to_owned(),
        status,
    };
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    db::read_status::set_read_status_at_tx(&mut tx, uid, &update, at)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

async fn seeded() -> (axum::Router, SqlitePool, String, i64, String) {
    let (app, pool, token, uid) = fixture().await;
    let uuid = db::test_support::seed_synced_ebook(&pool, "alpha.epub", "Alpha", "Ada").await;
    (app, pool, token, uid, uuid)
}

mod put {
    use super::*;

    #[tokio::test]
    async fn put_state_lands_on_the_web_as_a_percent_only_position() {
        let (app, pool, token, uid, uuid) = seeded().await;
        let at = now() - 10;

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "percent": 42, "status": "reading", "event_at": at }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let (epub, status) = web_view(&pool, uid, &uuid).await;
        let epub = epub.unwrap();
        assert_eq!(epub.progress_percent, Some(42));
        assert_eq!(epub.epub_cfi, None);
        assert_eq!(epub.client_updated_at, at);
        assert_eq!(status.unwrap().status, ReadStatus::Reading);
    }

    #[tokio::test]
    async fn put_state_answers_with_the_state_it_stored() {
        let (app, _pool, token, _uid, uuid) = seeded().await;
        let at = now() - 10;

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "percent": 42, "status": "reading", "event_at": at }),
        )
        .await;

        assert_eq!(
            body_json::<Value>(res).await,
            json!({
                "position": { "percent": 42, "event_at": at },
                "status": { "status": "reading", "event_at": at },
            })
        );
    }

    #[tokio::test]
    async fn put_state_rejects_an_event_older_than_the_stored_position_as_stale() {
        let (app, pool, token, uid, uuid) = seeded().await;
        let (t1, t2) = (now() - 200, now() - 100);
        web_position(&pool, uid, &uuid, 60, t2).await;

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "percent": 30, "event_at": t1 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert_eq!(
            body_json::<Value>(res).await["position"],
            json!({ "percent": 60, "event_at": t2 })
        );
        let epub = web_view(&pool, uid, &uuid).await.0.unwrap();
        assert_eq!(
            (epub.progress_percent, epub.client_updated_at),
            (Some(60), t2)
        );
    }

    #[tokio::test]
    async fn put_state_with_complete_marks_the_book_finished() {
        let (app, pool, token, uid, uuid) = seeded().await;

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "percent": 100, "status": "complete", "event_at": now() - 5 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let status = web_view(&pool, uid, &uuid).await.1.unwrap();
        assert_eq!(status.status, ReadStatus::Finished);
        assert_eq!(status.finished_at, Some(status.updated_at));
    }

    #[tokio::test]
    async fn put_state_keeps_a_newer_web_status() {
        let (app, pool, token, uid, uuid) = seeded().await;
        let (t1, t2) = (now() - 200, now() - 100);
        web_status(&pool, uid, &uuid, ReadStatus::Finished, t2).await;

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "percent": 55, "status": "reading", "event_at": t1 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let (epub, status) = web_view(&pool, uid, &uuid).await;
        assert_eq!(epub.unwrap().progress_percent, Some(55));
        let status = status.unwrap();
        assert_eq!(
            (status.status, status.updated_at),
            (ReadStatus::Finished, t2)
        );
    }

    #[tokio::test]
    async fn put_state_does_not_sync_an_abandoned_status() {
        let (app, pool, token, uid, uuid) = seeded().await;
        web_status(&pool, uid, &uuid, ReadStatus::Unread, now() - 100).await;

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "percent": 30, "status": "abandoned", "event_at": now() - 5 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let (epub, status) = web_view(&pool, uid, &uuid).await;
        assert_eq!(epub.unwrap().progress_percent, Some(30));
        assert_eq!(status.unwrap().status, ReadStatus::Unread);
    }

    #[tokio::test]
    async fn put_state_does_not_sync_an_unknown_status() {
        let (app, pool, token, uid, uuid) = seeded().await;
        web_status(&pool, uid, &uuid, ReadStatus::Unread, now() - 100).await;

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "percent": 30, "status": "lost", "event_at": now() - 5 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let (epub, status) = web_view(&pool, uid, &uuid).await;
        assert_eq!(epub.unwrap().progress_percent, Some(30));
        assert_eq!(status.unwrap().status, ReadStatus::Unread);
    }

    #[tokio::test]
    async fn put_state_clamps_a_future_event_time_to_server_now() {
        let (app, pool, token, uid, uuid) = seeded().await;
        let before = now();

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "percent": 10, "status": "complete", "event_at": before + 3_600 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let (epub, status) = web_view(&pool, uid, &uuid).await;
        let stored = epub.unwrap().client_updated_at;
        assert!((before..=now()).contains(&stored), "position at {stored}");
        let stored = status.unwrap().updated_at;
        assert!((before..=now()).contains(&stored), "status at {stored}");
    }

    #[tokio::test]
    async fn put_state_with_a_percent_only_keeps_a_newer_web_status() {
        let (app, pool, token, uid, uuid) = seeded().await;
        let (t2, t3) = (now() - 200, now() - 100);
        web_status(&pool, uid, &uuid, ReadStatus::Finished, t2).await;

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "percent": 55, "event_at": t3 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let (epub, status) = web_view(&pool, uid, &uuid).await;
        assert_eq!(epub.unwrap().progress_percent, Some(55));
        let status = status.unwrap();
        assert_eq!(
            (status.status, status.updated_at),
            (ReadStatus::Finished, t2)
        );
    }

    #[tokio::test]
    async fn put_state_with_a_status_only_keeps_the_stored_position() {
        let (app, pool, token, uid, uuid) = seeded().await;
        let (t2, t3) = (now() - 200, now() - 100);
        web_position(&pool, uid, &uuid, 70, t2).await;

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "status": "complete", "event_at": t3 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let (epub, status) = web_view(&pool, uid, &uuid).await;
        let epub = epub.unwrap();
        assert_eq!(
            (epub.progress_percent, epub.client_updated_at),
            (Some(70), t2)
        );
        assert_eq!(status.unwrap().status, ReadStatus::Finished);
    }

    #[tokio::test]
    async fn put_state_answers_a_losing_status_with_the_stored_one() {
        let (app, pool, token, uid, uuid) = seeded().await;
        let (t1, t2) = (now() - 200, now() - 100);
        web_status(&pool, uid, &uuid, ReadStatus::Finished, t2).await;

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "status": "reading", "event_at": t1 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            body_json::<Value>(res).await["status"],
            json!({ "status": "complete", "event_at": t2 })
        );
    }

    #[tokio::test]
    async fn put_state_rejects_a_body_with_neither_percent_nor_status() {
        let (app, _pool, token, _uid, uuid) = seeded().await;

        let res = put(&app, &token, &uuid, json!({ "event_at": now() })).await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn put_state_rolls_the_status_back_when_the_position_write_fails() {
        let (app, pool, token, uid, uuid) = seeded().await;
        sqlx::query("DROP TABLE reading_progress")
            .execute(&pool)
            .await
            .unwrap();

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "percent": 5, "status": "complete", "event_at": now() - 5 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let stored = db::read_status::get_read_status(&pool, uid, &uuid)
            .await
            .unwrap();
        assert_eq!(stored, None);
    }

    #[tokio::test]
    async fn put_state_answers_500_when_the_status_write_fails() {
        let (app, pool, token, _uid, uuid) = seeded().await;
        sqlx::query("DROP TABLE book_read_status")
            .execute(&pool)
            .await
            .unwrap();

        let res = put(
            &app,
            &token,
            &uuid,
            json!({ "percent": 5, "status": "reading", "event_at": now() - 5 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn put_state_drops_the_cached_stats_summary_when_it_writes_a_status() {
        let pool = db::init_db("sqlite::memory:").await.unwrap();
        // An id no sibling test uses: the stats cache is process-wide, keyed on it.
        let user: i64 = sqlx::query_scalar(
            "INSERT INTO users (id, username, password_hash) VALUES (9932, 'ko-stats', '!x')
             RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let device = db::kobo_devices::create_device(&pool, user, "KOReader", DeviceKind::Koreader)
            .await
            .unwrap();
        let app = crate::backend::koreader::koreader_router(AppState::new(pool.clone()));
        let uuid = db::test_support::seed_synced_ebook(&pool, "alpha.epub", "Alpha", "Ada").await;
        let range = omnibus_shared::StatsRange::AllTime;
        let before = db::stats::user_stats(&pool, user, range, None)
            .await
            .unwrap();
        assert!(before.finished_books.is_empty());

        let res = put(
            &app,
            &device.token,
            &uuid,
            json!({ "percent": 100, "status": "complete", "event_at": now() - 5 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let after = db::stats::user_stats(&pool, user, range, None)
            .await
            .unwrap();
        assert_eq!(after.finished_books.len(), 1);
    }

    #[tokio::test]
    async fn put_state_rejects_a_percent_outside_0_to_100() {
        let (app, _pool, token, _uid, uuid) = seeded().await;

        for percent in [101, -1] {
            let res = put(
                &app,
                &token,
                &uuid,
                json!({ "percent": percent, "event_at": now() }),
            )
            .await;
            assert_eq!(res.status(), StatusCode::BAD_REQUEST, "percent {percent}");
        }
    }

    #[tokio::test]
    async fn put_state_rejects_a_negative_event_time() {
        let (app, _pool, token, _uid, uuid) = seeded().await;

        let res = put(&app, &token, &uuid, json!({ "percent": 5, "event_at": -1 })).await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn put_state_answers_400_for_a_uuid_over_the_length_cap() {
        let (app, _pool, token, _uid, _uuid) = seeded().await;
        let long = "a".repeat(omnibus_shared::BOOK_UUID_MAX_LEN + 1);

        let res = put(&app, &token, &long, json!({ "percent": 5, "event_at": 1 })).await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn put_state_answers_404_for_an_unknown_uuid() {
        let (app, pool, token, uid, _uuid) = seeded().await;

        let res = put(
            &app,
            &token,
            MISSING,
            json!({ "percent": 5, "status": "reading", "event_at": now() - 5 }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        assert_eq!(web_view(&pool, uid, MISSING).await.1, None);
    }
}

mod get {
    use super::*;

    #[tokio::test]
    async fn get_state_returns_the_web_position_and_finished_as_complete() {
        let (app, pool, token, uid, uuid) = seeded().await;
        let (t, t_status) = (now() - 300, now() - 50);
        web_position(&pool, uid, &uuid, 70, t).await;
        web_status(&pool, uid, &uuid, ReadStatus::Finished, t_status).await;

        let res = get(&app, &token, &uuid).await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            body_json::<Value>(res).await,
            json!({
                "position": { "percent": 70, "event_at": t },
                "status": { "status": "complete", "event_at": t_status },
            })
        );
    }

    #[tokio::test]
    async fn get_state_returns_nulls_for_an_untouched_book() {
        let (app, _pool, token, _uid, uuid) = seeded().await;

        let res = get(&app, &token, &uuid).await;

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            body_json::<Value>(res).await,
            json!({ "position": null, "status": null })
        );
    }

    #[tokio::test]
    async fn get_state_reads_an_unread_status_as_null() {
        let (app, pool, token, uid, uuid) = seeded().await;
        web_status(&pool, uid, &uuid, ReadStatus::Unread, now() - 5).await;

        let res = get(&app, &token, &uuid).await;

        assert_eq!(body_json::<Value>(res).await["status"], Value::Null);
    }

    #[tokio::test]
    async fn get_state_answers_500_when_the_read_fails() {
        let (app, pool, token, _uid, uuid) = seeded().await;
        sqlx::query("DROP TABLE book_read_status")
            .execute(&pool)
            .await
            .unwrap();

        let res = get(&app, &token, &uuid).await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn get_state_answers_404_for_an_unknown_uuid() {
        let (app, _pool, token, _uid, _uuid) = seeded().await;

        let res = get(&app, &token, MISSING).await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn get_state_answers_400_for_a_uuid_over_the_length_cap() {
        let (app, _pool, token, _uid, _uuid) = seeded().await;
        let long = "a".repeat(omnibus_shared::BOOK_UUID_MAX_LEN + 1);

        let res = get(&app, &token, &long).await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }
}
