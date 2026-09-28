//! `GET /api/users`, and `user_id` on `GET /api/stats` / `GET
//! /api/stats/sessions` (AC1–AC4). No handler-specific 500 test for
//! `/api/users`: it only reads `users` / `user_avatars`, which the auth
//! extractor reads first, so a handler-only DB failure is unreachable over
//! HTTP — the db-layer closed-pool test covers that propagation.

use axum::{body::to_bytes, http::StatusCode};
use omnibus_shared::HouseholdReader;
use tower::ServiceExt;

use super::{now_secs, seed_reading_session, seed_reading_session_at_offset};
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::*;

const NOT_SHARING_BODY: &str = "this reader isn't sharing their stats";

async fn body_text(res: axum::response::Response) -> String {
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[tokio::test]
async fn api_get_users_requires_auth() {
    let (app, _state, _pool) = fixture().await;
    let res = app.oneshot(get_anon("/api/users")).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn api_get_users_lists_the_caller_first_then_sharers_by_name() {
    let (app, _state, pool) = fixture().await;
    let caller = auth_test_support::create_user(&pool, "caller").await;
    let token = auth_test_support::bearer_token(&pool, caller.id).await;
    auth_test_support::create_user(&pool, "alice").await;
    let dave = auth_test_support::create_user(&pool, "dave").await;
    omnibus_db::auth::set_share_stats(&pool, dave.id, false)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer("/api/users", &token))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();

    // The first element's raw keys, decoded independently of the typed
    // struct, pin the wire shape for iOS/MCP.
    let raw: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
    let mut keys: Vec<&str> = raw[0]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    assert_eq!(keys, vec!["has_avatar", "id", "is_you", "name"]);

    let readers: Vec<HouseholdReader> = serde_json::from_slice(&bytes).unwrap();
    let names: Vec<&str> = readers.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["caller", "alice"]);
    assert!(readers[0].is_you);
}

#[tokio::test]
async fn api_get_users_lists_the_caller_first_even_with_the_callers_own_sharing_off() {
    let (app, _state, pool) = fixture().await;
    let caller = auth_test_support::create_user(&pool, "caller").await;
    let token = auth_test_support::bearer_token(&pool, caller.id).await;
    omnibus_db::auth::set_share_stats(&pool, caller.id, false)
        .await
        .unwrap();
    auth_test_support::create_user(&pool, "alice").await;

    let res = app
        .oneshot(get_with_bearer("/api/users", &token))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let readers: Vec<HouseholdReader> = serde_json::from_slice(&bytes).unwrap();
    assert!(readers[0].is_you);
    assert_eq!(readers[0].id, caller.id);
}

#[tokio::test]
async fn api_get_stats_with_user_id_reads_a_sharing_targets_summary_on_the_viewers_calendar() {
    let (app, _state, pool) = fixture().await;
    let viewer = auth_test_support::create_user(&pool, "viewer").await;
    let token = auth_test_support::bearer_token(&pool, viewer.id).await;
    let target = auth_test_support::create_user(&pool, "target").await;
    // 2023-11-14 22:13:20 UTC, filed under the target's own -300 offset.
    seed_reading_session_at_offset(&pool, target.id, "uuid-1", 1_700_000_000, 900, Some(-300))
        .await;

    let res = app
        .oneshot(get_with_bearer(
            &format!(
                "/api/stats?user_id={}&range=all_time&utc_offset_minutes=585",
                target.id
            ),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let summary: omnibus_shared::StatsSummary = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(summary.reading_seconds, 900);
    assert_eq!(summary.heatmap[0].day, "2023-11-15");
}

#[tokio::test]
async fn api_get_stats_with_user_id_404s_alike_for_a_non_sharer_and_a_missing_reader() {
    let (app, _state, pool) = fixture().await;
    let viewer = auth_test_support::create_user(&pool, "viewer").await;
    let token = auth_test_support::bearer_token(&pool, viewer.id).await;
    let non_sharer = auth_test_support::create_user(&pool, "non-sharer").await;
    omnibus_db::auth::set_share_stats(&pool, non_sharer.id, false)
        .await
        .unwrap();

    let non_sharer_res = app
        .clone()
        .oneshot(get_with_bearer(
            &format!("/api/stats?user_id={}", non_sharer.id),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(non_sharer_res.status(), StatusCode::NOT_FOUND);
    assert_eq!(body_text(non_sharer_res).await, NOT_SHARING_BODY);

    let missing_res = app
        .oneshot(get_with_bearer("/api/stats?user_id=424242", &token))
        .await
        .unwrap();
    assert_eq!(missing_res.status(), StatusCode::NOT_FOUND);
    assert_eq!(body_text(missing_res).await, NOT_SHARING_BODY);
}

#[tokio::test]
async fn api_get_stats_with_user_id_404s_a_non_sharer_for_an_admin_viewer_too() {
    let (app, _state, pool) = fixture().await;
    let admin = auth_test_support::create_admin(&pool, "admin").await;
    let token = auth_test_support::bearer_token(&pool, admin.id).await;
    let non_sharer = auth_test_support::create_user(&pool, "non-sharer").await;
    omnibus_db::auth::set_share_stats(&pool, non_sharer.id, false)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/stats?user_id={}", non_sharer.id),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(body_text(res).await, NOT_SHARING_BODY);
}

#[tokio::test]
async fn api_get_stats_with_own_user_id_reads_own_figures_even_with_sharing_off() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "solo").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    omnibus_db::auth::set_share_stats(&pool, user.id, false)
        .await
        .unwrap();
    seed_reading_session_at_offset(&pool, user.id, "uuid-1", now_secs(), 450, None).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!(
                "/api/stats?user_id={}&range=all_time&utc_offset_minutes=615",
                user.id
            ),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let summary: omnibus_shared::StatsSummary = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(summary.reading_seconds, 450);
}

#[tokio::test]
async fn api_get_stats_with_user_id_404s_once_the_target_turns_sharing_off_even_through_a_warm_cache(
) {
    let (app, _state, pool) = fixture().await;
    let viewer = auth_test_support::create_user(&pool, "viewer").await;
    let token = auth_test_support::bearer_token(&pool, viewer.id).await;
    let target = auth_test_support::create_user(&pool, "target").await;
    seed_reading_session_at_offset(&pool, target.id, "uuid-1", now_secs(), 300, None).await;

    let warm_res = app
        .clone()
        .oneshot(get_with_bearer(
            &format!(
                "/api/stats?user_id={}&range=all_time&utc_offset_minutes=645",
                target.id
            ),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(warm_res.status(), StatusCode::OK);

    omnibus_db::auth::set_share_stats(&pool, target.id, false)
        .await
        .unwrap();

    let res = app
        .oneshot(get_with_bearer(
            &format!(
                "/api/stats?user_id={}&range=all_time&utc_offset_minutes=645",
                target.id
            ),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(body_text(res).await, NOT_SHARING_BODY);
}

#[tokio::test]
async fn api_get_stats_rejects_a_malformed_user_id() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "viewer").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;

    let res = app
        .oneshot(get_with_bearer("/api/stats?user_id=abc", &token))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

/// Mirrors `summary.rs`'s DROP TABLE pattern: a DB failure reading a sharing
/// target must still surface as a 500, never fold into the 404 the gate uses.
#[tokio::test]
async fn api_get_stats_with_user_id_returns_500_when_the_target_read_fails() {
    let (app, _state, pool) = fixture().await;
    let viewer = auth_test_support::create_user(&pool, "viewer").await;
    let token = auth_test_support::bearer_token(&pool, viewer.id).await;
    let target = auth_test_support::create_user(&pool, "target").await;

    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *conn)
        .await
        .unwrap();
    sqlx::query("DROP TABLE reading_sessions")
        .execute(&mut *conn)
        .await
        .unwrap();
    drop(conn);

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/stats?user_id={}&range=year", target.id),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn api_get_session_log_with_user_id_reads_a_sharing_targets_sittings() {
    let (app, _state, pool) = fixture().await;
    let viewer = auth_test_support::create_user(&pool, "viewer").await;
    let token = auth_test_support::bearer_token(&pool, viewer.id).await;
    let target = auth_test_support::create_user(&pool, "target").await;
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    seed_reading_session(&pool, target.id, &uuid, now_secs() - 1000, 600).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/stats/sessions?user_id={}", target.id),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let page: omnibus_shared::SessionLogPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].book_uuid, uuid);
}

#[tokio::test]
async fn api_get_session_log_with_user_id_404s_alike_for_a_non_sharer_and_a_missing_reader() {
    let (app, _state, pool) = fixture().await;
    let viewer = auth_test_support::create_user(&pool, "viewer").await;
    let token = auth_test_support::bearer_token(&pool, viewer.id).await;
    let non_sharer = auth_test_support::create_user(&pool, "non-sharer").await;
    omnibus_db::auth::set_share_stats(&pool, non_sharer.id, false)
        .await
        .unwrap();

    let non_sharer_res = app
        .clone()
        .oneshot(get_with_bearer(
            &format!("/api/stats/sessions?user_id={}", non_sharer.id),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(non_sharer_res.status(), StatusCode::NOT_FOUND);
    assert_eq!(body_text(non_sharer_res).await, NOT_SHARING_BODY);

    let missing_res = app
        .oneshot(get_with_bearer(
            "/api/stats/sessions?user_id=424242",
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(missing_res.status(), StatusCode::NOT_FOUND);
    assert_eq!(body_text(missing_res).await, NOT_SHARING_BODY);
}

#[tokio::test]
async fn api_get_session_log_with_own_user_id_reads_own_sittings_even_with_sharing_off() {
    let (app, _state, pool) = fixture().await;
    let user = auth_test_support::create_user(&pool, "solo").await;
    let token = auth_test_support::bearer_token(&pool, user.id).await;
    omnibus_db::auth::set_share_stats(&pool, user.id, false)
        .await
        .unwrap();
    let (_, uuid) = seed_book_with_uuid(&pool, "/lib", "Book A").await;
    seed_reading_session(&pool, user.id, &uuid, now_secs() - 1000, 450).await;

    let res = app
        .oneshot(get_with_bearer(
            &format!("/api/stats/sessions?user_id={}", user.id),
            &token,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let page: omnibus_shared::SessionLogPage = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(page.entries.len(), 1);
}
