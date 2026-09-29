//! `check_session_batch_cap` and the server-only helpers behind the progress
//! server functions: the batch insert, and a sharing reader's recent-progress
//! read (its own figures, a sharer's, and the share gate's message).

use super::{
    check_session_batch_cap, reader_recent_progress, record_sessions_batch, SESSION_BATCH_CAP,
};
use omnibus_shared::{ProgressFormat, SessionReport};

#[tokio::test]
async fn reader_recent_progress_returns_a_sharing_targets_points() {
    let pool = omnibus_db::init_db("sqlite::memory:").await.unwrap();
    let viewer = omnibus_db::test_support::seed_user(&pool, "viewer").await;
    let target = omnibus_db::test_support::seed_user(&pool, "target").await;
    let uuid =
        omnibus_db::test_support::seed_synced_ebook(&pool, "target.epub", "Target", "A").await;
    omnibus_db::test_support::seed_epub_position(&pool, target, &uuid).await;

    let points = reader_recent_progress(&pool, viewer, 20, Some(target))
        .await
        .unwrap();

    assert_eq!(points.len(), 1);
    assert_eq!(points[0].record.book_uuid, uuid);
}

#[tokio::test]
async fn reader_recent_progress_message_for_a_non_sharer_carries_the_contract_string_even_for_an_admin_caller(
) {
    let pool = omnibus_db::init_db("sqlite::memory:").await.unwrap();
    let admin = omnibus_db::auth::create_user(&pool, "admin", "correct-horse-battery-staple")
        .await
        .unwrap()
        .id;
    let non_sharer = omnibus_db::test_support::seed_user(&pool, "non-sharer").await;
    omnibus_db::auth::set_share_stats(&pool, non_sharer, false)
        .await
        .unwrap();

    let err = reader_recent_progress(&pool, admin, 20, Some(non_sharer))
        .await
        .unwrap_err();

    assert!(err
        .to_string()
        .contains("this reader isn't sharing their stats"));
}

#[tokio::test]
async fn reader_recent_progress_with_no_user_id_reads_the_callers_own_points() {
    let pool = omnibus_db::init_db("sqlite::memory:").await.unwrap();
    let viewer = omnibus_db::test_support::seed_user(&pool, "viewer").await;
    let uuid = omnibus_db::test_support::seed_synced_ebook(&pool, "own.epub", "Own", "A").await;
    omnibus_db::test_support::seed_epub_position(&pool, viewer, &uuid).await;

    let points = reader_recent_progress(&pool, viewer, 20, None)
        .await
        .unwrap();

    assert_eq!(points.len(), 1);
}

fn dummy_report() -> SessionReport {
    report("uuid", ProgressFormat::Epub)
}

fn report(book_uuid: &str, format: ProgressFormat) -> SessionReport {
    SessionReport {
        book_uuid: book_uuid.into(),
        format,
        started_at: 0,
        ended_at: 1,
        progress_units: 1,
        device_id: None,
        client_id: None,
        utc_offset_minutes: None,
        time_zone: None,
    }
}

#[tokio::test]
async fn record_sessions_batch_skips_unknown_uuid_and_counts_only_inserted_rows() {
    let pool = omnibus_db::init_db("sqlite::memory:").await.unwrap();
    omnibus_db::test_support::seed_minimal_books(&pool, 2).await;
    let user_id: i64 = sqlx::query_scalar(
        "INSERT INTO users (username, password_hash) VALUES ('alice', 'x') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let reports = vec![
        report("uuid-1", ProgressFormat::Epub),
        report("no-such-book", ProgressFormat::Epub),
        report("uuid-2", ProgressFormat::Audio),
    ];
    let inserted = record_sessions_batch(&pool, user_id, &reports)
        .await
        .unwrap();
    assert_eq!(inserted, 2, "unknown uuid must be skipped, not counted");

    let reading: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM reading_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    let listening: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM listening_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!((reading, listening), (1, 1));
}

#[test]
fn check_session_batch_cap_accepts_batch_at_cap() {
    // Boundary: exactly at the cap must be accepted so a client packing
    // batches to the documented maximum isn't rejected off-by-one.
    let reports = vec![dummy_report(); SESSION_BATCH_CAP];
    assert!(check_session_batch_cap(&reports).is_ok());
}

#[test]
fn check_session_batch_cap_rejects_batch_over_cap() {
    // Mirrors the mobile REST path's 422 rejection in
    // `server::backend::progress::post_sessions` — the web RPC path
    // must not permit an unbounded per-record write loop.
    let reports = vec![dummy_report(); SESSION_BATCH_CAP + 1];
    let err = check_session_batch_cap(&reports).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains(&SESSION_BATCH_CAP.to_string()),
        "error message should name the cap: {msg}"
    );
    assert!(
        msg.contains(&(SESSION_BATCH_CAP + 1).to_string()),
        "error message should name the batch length: {msg}"
    );
}
