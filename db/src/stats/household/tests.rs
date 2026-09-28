//! `household_readers`: list ordering/exclusion, the avatar flag, and DB
//! failure propagation. `may_view_stats` and `stats_for_viewer`: every gate
//! branch, both viewer reads, the calendar case, and DB-failure variants.
//! `session_log_for_viewer` and `recent_progress_for_viewer`: the same gate
//! applied to the session log and the in-progress list.

use omnibus_shared::{HouseholdReader, StatsRange};

use super::{
    household_readers, may_view_stats, recent_progress_for_viewer, session_log_for_viewer,
    stats_for_viewer, ViewerStatsError,
};
use crate::auth::{set_display_name, set_share_stats, upsert_user_avatar};
use crate::init_db;
use crate::stats::tests::{reading_session, seed_user_with_id};
use crate::test_support::{seed_epub_position, seed_synced_ebook, seed_user, solid_color_png};

async fn reading_session_at_offset(
    pool: &sqlx::SqlitePool,
    user: i64,
    uuid: &str,
    started_at: i64,
    secs: i64,
    utc_offset_minutes: Option<i64>,
) {
    sqlx::query(
        "INSERT INTO reading_sessions
             (user_id, book_uuid, started_at, ended_at, seconds_read, utc_offset_minutes)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(user)
    .bind(uuid)
    .bind(started_at)
    .bind(started_at + secs)
    .bind(secs)
    .bind(utc_offset_minutes)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn household_readers_lists_the_caller_first_then_sharers_by_name_and_excludes_non_sharers() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let caller = seed_user(&pool, "caller").await;
    seed_user(&pool, "alice").await;
    let zed = seed_user(&pool, "zed").await;
    set_display_name(&pool, zed, Some("Bob")).await.unwrap();
    let dave = seed_user(&pool, "dave").await;
    set_share_stats(&pool, dave, false).await.unwrap();

    let readers = household_readers(&pool, caller).await.unwrap();

    let names: Vec<&str> = readers.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["caller", "alice", "Bob"]);
    assert!(readers[0].is_you);
    assert!(readers[1..].iter().all(|r| !r.is_you));
}

#[tokio::test]
async fn household_readers_lists_the_caller_first_even_with_the_callers_own_sharing_off() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let caller = seed_user(&pool, "caller").await;
    set_share_stats(&pool, caller, false).await.unwrap();
    seed_user(&pool, "alice").await;

    let readers = household_readers(&pool, caller).await.unwrap();

    assert!(readers[0].is_you);
    assert_eq!(readers[0].id, caller);
}

#[tokio::test]
async fn household_readers_has_avatar_true_only_for_a_reader_with_an_avatar_row() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let caller = seed_user(&pool, "caller").await;
    let alice = seed_user(&pool, "alice").await;
    upsert_user_avatar(&pool, alice, "image/png", &solid_color_png(1, 2, 3, 4, 4))
        .await
        .unwrap();

    let readers = household_readers(&pool, caller).await.unwrap();

    let alice_entry = readers.iter().find(|r| r.name == "alice").unwrap();
    assert!(alice_entry.has_avatar);
    let caller_entry: &HouseholdReader = readers.iter().find(|r| r.is_you).unwrap();
    assert!(!caller_entry.has_avatar);
}

#[tokio::test]
async fn household_readers_propagates_db_error_when_pool_is_closed() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;

    let err = household_readers(&pool, 1).await.unwrap_err();
    assert!(matches!(err, crate::stats::StatsError::Sqlx(_)));
}

#[tokio::test]
async fn may_view_stats_is_true_for_the_viewers_own_id_even_with_their_own_sharing_off() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user(&pool, "viewer").await;
    set_share_stats(&pool, viewer, false).await.unwrap();

    assert!(may_view_stats(&pool, viewer, viewer).await.unwrap());
}

#[tokio::test]
async fn may_view_stats_is_true_for_a_sharing_reader() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user(&pool, "viewer").await;
    let target = seed_user(&pool, "target").await;

    assert!(may_view_stats(&pool, viewer, target).await.unwrap());
}

#[tokio::test]
async fn may_view_stats_is_false_for_a_non_sharing_reader() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user(&pool, "viewer").await;
    let target = seed_user(&pool, "target").await;
    set_share_stats(&pool, target, false).await.unwrap();

    assert!(!may_view_stats(&pool, viewer, target).await.unwrap());
}

#[tokio::test]
async fn may_view_stats_is_false_for_a_missing_reader() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user(&pool, "viewer").await;

    assert!(!may_view_stats(&pool, viewer, 424_242).await.unwrap());
}

#[tokio::test]
async fn may_view_stats_errs_when_the_pool_is_closed_for_a_different_target() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;

    assert!(may_view_stats(&pool, 1, 2).await.is_err());
}

#[tokio::test]
async fn stats_for_viewer_with_no_target_or_the_viewers_own_id_reads_their_own_summary() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user_with_id(&pool, 9950, "viewer").await;
    set_share_stats(&pool, viewer, false).await.unwrap();
    reading_session(&pool, viewer, "uuid-1", 1_700_000_000, 600).await;

    let none = stats_for_viewer(&pool, viewer, None, StatsRange::AllTime, None)
        .await
        .unwrap();
    let own = stats_for_viewer(&pool, viewer, Some(viewer), StatsRange::AllTime, None)
        .await
        .unwrap();

    assert_eq!(none.reading_seconds, 600);
    assert_eq!(own.reading_seconds, 600);
}

#[tokio::test]
async fn stats_for_viewer_reads_a_sharing_targets_summary_regardless_of_the_viewers_own_sharing() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user_with_id(&pool, 9951, "viewer").await;
    set_share_stats(&pool, viewer, false).await.unwrap();
    let target = seed_user_with_id(&pool, 9952, "target").await;
    reading_session(&pool, target, "uuid-1", 1_700_000_000, 900).await;

    let summary = stats_for_viewer(&pool, viewer, Some(target), StatsRange::AllTime, None)
        .await
        .unwrap();

    assert_eq!(summary.reading_seconds, 900);
    assert_eq!(summary.sessions, 1);
}

#[tokio::test]
async fn stats_for_viewer_refuses_a_non_sharing_or_missing_target_with_the_same_message() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user_with_id(&pool, 9953, "viewer").await;
    let non_sharer = seed_user_with_id(&pool, 9954, "non-sharer").await;
    set_share_stats(&pool, non_sharer, false).await.unwrap();

    let err_a = stats_for_viewer(&pool, viewer, Some(non_sharer), StatsRange::AllTime, None)
        .await
        .unwrap_err();
    let err_b = stats_for_viewer(&pool, viewer, Some(424_242), StatsRange::AllTime, None)
        .await
        .unwrap_err();

    assert_eq!(err_a.to_string(), "this reader isn't sharing their stats");
    assert_eq!(err_b.to_string(), "this reader isn't sharing their stats");
}

#[tokio::test]
async fn stats_for_viewer_refuses_a_target_who_turns_sharing_off_even_through_a_warm_cache() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user_with_id(&pool, 9955, "viewer").await;
    let target = seed_user_with_id(&pool, 9956, "target").await;
    reading_session(&pool, target, "uuid-1", 1_700_000_000, 300).await;

    stats_for_viewer(&pool, viewer, Some(target), StatsRange::AllTime, None)
        .await
        .unwrap();
    set_share_stats(&pool, target, false).await.unwrap();

    let err = stats_for_viewer(&pool, viewer, Some(target), StatsRange::AllTime, None)
        .await
        .unwrap_err();
    assert!(matches!(err, ViewerStatsError::NotSharing));
}

#[tokio::test]
async fn stats_for_viewer_cuts_the_day_on_the_viewers_own_calendar_not_the_targets() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user_with_id(&pool, 9957, "viewer").await;
    reading_session_at_offset(&pool, viewer, "uuid-viewer", 1_650_000_000, 60, Some(600)).await;
    let target = seed_user_with_id(&pool, 9958, "target").await;
    // 2023-11-14 22:13:20 UTC — the target's own calendar would call this the 14th.
    reading_session_at_offset(&pool, target, "uuid-target", 1_700_000_000, 900, Some(-300)).await;

    let summary = stats_for_viewer(&pool, viewer, Some(target), StatsRange::AllTime, None)
        .await
        .unwrap();

    assert_eq!(summary.heatmap[0].day, "2023-11-15");
}

#[tokio::test]
async fn stats_for_viewer_surfaces_stats_error_when_the_pool_is_closed_on_the_own_path() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;

    let err = stats_for_viewer(&pool, 1, None, StatsRange::AllTime, None)
        .await
        .unwrap_err();
    assert!(matches!(err, ViewerStatsError::Stats(_)));
}

#[tokio::test]
async fn stats_for_viewer_surfaces_auth_error_when_the_pool_is_closed_on_the_other_reader_path() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;

    let err = stats_for_viewer(&pool, 1, Some(2), StatsRange::AllTime, None)
        .await
        .unwrap_err();
    assert!(matches!(err, ViewerStatsError::Auth(_)));
}

#[tokio::test]
async fn session_log_for_viewer_reads_a_sharing_targets_sittings_and_none_of_the_viewers() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user(&pool, "viewer").await;
    reading_session(&pool, viewer, "uuid-viewer", 1_700_000_000, 300).await;
    let target = seed_user(&pool, "target").await;
    reading_session(&pool, target, "uuid-target", 1_700_000_100, 400).await;

    let page = session_log_for_viewer(&pool, viewer, Some(target), None, None, 25)
        .await
        .unwrap();

    assert_eq!(page.entries.len(), 1);
    assert_eq!(page.entries[0].book_uuid, "uuid-target");
}

#[tokio::test]
async fn session_log_for_viewer_refuses_a_non_sharing_target() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user(&pool, "viewer").await;
    let target = seed_user(&pool, "target").await;
    set_share_stats(&pool, target, false).await.unwrap();

    let err = session_log_for_viewer(&pool, viewer, Some(target), None, None, 25)
        .await
        .unwrap_err();

    assert!(matches!(err, ViewerStatsError::NotSharing));
}

#[tokio::test]
async fn session_log_for_viewer_with_no_target_or_the_viewers_own_id_reads_their_own_sittings() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user(&pool, "viewer").await;
    set_share_stats(&pool, viewer, false).await.unwrap();
    reading_session(&pool, viewer, "uuid-1", 1_700_000_000, 300).await;

    let none = session_log_for_viewer(&pool, viewer, None, None, None, 25)
        .await
        .unwrap();
    let own = session_log_for_viewer(&pool, viewer, Some(viewer), None, None, 25)
        .await
        .unwrap();

    assert_eq!(none.entries.len(), 1);
    assert_eq!(own.entries.len(), 1);
}

#[tokio::test]
async fn session_log_for_viewer_surfaces_stats_error_when_the_pool_is_closed_on_the_own_path() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;

    let err = session_log_for_viewer(&pool, 1, None, None, None, 25)
        .await
        .unwrap_err();
    assert!(matches!(err, ViewerStatsError::Stats(_)));
}

#[tokio::test]
async fn session_log_for_viewer_surfaces_auth_error_when_the_pool_is_closed_on_the_other_reader_path(
) {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;

    let err = session_log_for_viewer(&pool, 1, Some(2), None, None, 25)
        .await
        .unwrap_err();
    assert!(matches!(err, ViewerStatsError::Auth(_)));
}

/// A real book row plus a seeded position, since `resume_points` skips any
/// progress row whose book doesn't resolve.
async fn seed_progress_book(pool: &sqlx::SqlitePool, user: i64, filename: &str) -> String {
    let uuid = seed_synced_ebook(pool, filename, filename, "Author").await;
    seed_epub_position(pool, user, &uuid).await;
    uuid
}

#[tokio::test]
async fn recent_progress_for_viewer_reads_a_sharing_targets_points_and_none_of_the_viewers() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user(&pool, "viewer").await;
    seed_progress_book(&pool, viewer, "viewer.epub").await;
    let target = seed_user(&pool, "target").await;
    let target_uuid = seed_progress_book(&pool, target, "target.epub").await;

    let points = recent_progress_for_viewer(&pool, viewer, Some(target), 20)
        .await
        .unwrap();

    assert_eq!(points.len(), 1);
    assert_eq!(points[0].record.book_uuid, target_uuid);
}

#[tokio::test]
async fn recent_progress_for_viewer_refuses_a_non_sharing_or_missing_target_with_the_same_message()
{
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user(&pool, "viewer").await;
    let non_sharer = seed_user(&pool, "non-sharer").await;
    set_share_stats(&pool, non_sharer, false).await.unwrap();

    let err_a = recent_progress_for_viewer(&pool, viewer, Some(non_sharer), 20)
        .await
        .unwrap_err();
    let err_b = recent_progress_for_viewer(&pool, viewer, Some(424_242), 20)
        .await
        .unwrap_err();

    assert_eq!(err_a.to_string(), "this reader isn't sharing their stats");
    assert_eq!(err_b.to_string(), "this reader isn't sharing their stats");
}

#[tokio::test]
async fn recent_progress_for_viewer_with_no_target_or_the_viewers_own_id_reads_their_own_points() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let viewer = seed_user(&pool, "viewer").await;
    set_share_stats(&pool, viewer, false).await.unwrap();
    seed_progress_book(&pool, viewer, "own.epub").await;

    let none = recent_progress_for_viewer(&pool, viewer, None, 20)
        .await
        .unwrap();
    let own = recent_progress_for_viewer(&pool, viewer, Some(viewer), 20)
        .await
        .unwrap();

    assert_eq!(none.len(), 1);
    assert_eq!(own.len(), 1);
}

#[tokio::test]
async fn recent_progress_for_viewer_surfaces_progress_error_when_the_pool_is_closed_on_the_own_path(
) {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;

    let err = recent_progress_for_viewer(&pool, 1, None, 20)
        .await
        .unwrap_err();
    assert!(matches!(err, ViewerStatsError::Progress(_)));
}

#[tokio::test]
async fn recent_progress_for_viewer_surfaces_auth_error_when_the_pool_is_closed_on_the_other_reader_path(
) {
    let pool = init_db("sqlite::memory:").await.unwrap();
    pool.close().await;

    let err = recent_progress_for_viewer(&pool, 1, Some(2), 20)
        .await
        .unwrap_err();
    assert!(matches!(err, ViewerStatsError::Auth(_)));
}
