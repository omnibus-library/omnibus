//! Server-only helpers behind the stats server functions: the readers list,
//! the share gate's message, a sharer's success path, admin no-bypass, and a
//! DB failure genericized to `internal server error`.

use dioxus::prelude::ServerFnError;
use omnibus_db::stats::ViewerStatsError;
use omnibus_shared::StatsRange;

use super::{household_readers, map_viewer_error, reader_session_log, reader_stats};

#[test]
fn map_viewer_error_carries_a_404_and_the_contract_message_for_a_refusal() {
    let err = map_viewer_error("stats", ViewerStatsError::NotSharing);
    assert!(matches!(
        err,
        ServerFnError::ServerError { code: 404, message, .. }
            if message == "this reader isn't sharing their stats"
    ));
}

async fn pool_with_user(name: &str) -> (sqlx::SqlitePool, i64) {
    let pool = omnibus_db::init_db("sqlite::memory:").await.unwrap();
    let id = omnibus_db::test_support::seed_user(&pool, name).await;
    (pool, id)
}

#[tokio::test]
async fn household_readers_returns_the_caller_first_and_excludes_a_non_sharer() {
    let (pool, caller) = pool_with_user("caller").await;
    omnibus_db::test_support::seed_user(&pool, "alice").await;
    let dave = omnibus_db::test_support::seed_user(&pool, "dave").await;
    omnibus_db::auth::set_share_stats(&pool, dave, false)
        .await
        .unwrap();

    let readers = household_readers(&pool, caller).await.unwrap();

    let names: Vec<&str> = readers.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["caller", "alice"]);
    assert!(readers[0].is_you);
}

async fn seed_reading_session(
    pool: &sqlx::SqlitePool,
    user: i64,
    uuid: &str,
    started_at: i64,
    secs: i64,
) {
    sqlx::query(
        "INSERT INTO reading_sessions (user_id, book_uuid, started_at, ended_at, seconds_read)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(user)
    .bind(uuid)
    .bind(started_at)
    .bind(started_at + secs)
    .bind(secs)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn reader_stats_returns_a_sharing_targets_figures() {
    let (pool, viewer) = pool_with_user("viewer").await;
    let target = omnibus_db::test_support::seed_user(&pool, "target").await;
    seed_reading_session(&pool, target, "uuid-1", 1_700_000_000, 600).await;

    let summary = reader_stats(&pool, viewer, StatsRange::AllTime, Some(105), Some(target))
        .await
        .unwrap();

    assert_eq!(summary.reading_seconds, 600);
}

#[tokio::test]
async fn reader_stats_message_for_a_non_sharer_carries_the_contract_string_even_for_an_admin_caller(
) {
    let (pool, admin) = pool_with_user("admin").await;
    let non_sharer = omnibus_db::test_support::seed_user(&pool, "non-sharer").await;
    omnibus_db::auth::set_share_stats(&pool, non_sharer, false)
        .await
        .unwrap();

    let err = reader_stats(
        &pool,
        admin,
        StatsRange::AllTime,
        Some(135),
        Some(non_sharer),
    )
    .await
    .unwrap_err();

    assert!(err
        .to_string()
        .contains("this reader isn't sharing their stats"));
}

#[tokio::test]
async fn reader_stats_genericizes_a_db_failure_rather_than_the_contract_string() {
    let (pool, viewer) = pool_with_user("viewer").await;
    let target = omnibus_db::test_support::seed_user(&pool, "target").await;
    pool.close().await;

    let err = reader_stats(&pool, viewer, StatsRange::AllTime, Some(165), Some(target))
        .await
        .unwrap_err();

    assert!(err.to_string().contains("internal server error"));
    assert!(!err.to_string().contains("sharing"));
}

#[tokio::test]
async fn reader_session_log_returns_a_sharing_targets_entries() {
    let (pool, viewer) = pool_with_user("viewer").await;
    let target = omnibus_db::test_support::seed_user(&pool, "target").await;
    seed_reading_session(&pool, target, "uuid-1", 1_700_000_000, 600).await;

    let page = reader_session_log(&pool, viewer, None, None, Some(target))
        .await
        .unwrap();

    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].book_uuid, "uuid-1");
}

#[tokio::test]
async fn reader_session_log_message_for_a_non_sharer_carries_the_contract_string() {
    let (pool, viewer) = pool_with_user("viewer").await;
    let non_sharer = omnibus_db::test_support::seed_user(&pool, "non-sharer").await;
    omnibus_db::auth::set_share_stats(&pool, non_sharer, false)
        .await
        .unwrap();

    let err = reader_session_log(&pool, viewer, None, None, Some(non_sharer))
        .await
        .unwrap_err();

    assert!(err
        .to_string()
        .contains("this reader isn't sharing their stats"));
}

#[tokio::test]
async fn reader_session_log_rejects_a_malformed_before_cursor() {
    let (pool, viewer) = pool_with_user("viewer").await;

    let err = reader_session_log(&pool, viewer, None, Some("nonsense"), None)
        .await
        .unwrap_err();

    assert!(err.to_string().contains("invalid before cursor"));
}
