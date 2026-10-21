//! Tests for the per-reader browse overlays: per-author and per-series
//! finished/reading counts and latest read time, and per-book status,
//! percent and time.

use omnibus_shared::{
    EbookMetadata, MetadataOverrides, ProgressFormat, ProgressUpdate, ReadStatus, SetReadStatus,
};
use sqlx::SqlitePool;

use super::*;
use crate::metadata_overrides::upsert_metadata_overrides;
use crate::progress::upsert_progress;
use crate::read_status::set_read_status;
use crate::test_support::*;

async fn uuid_by_title(pool: &SqlitePool, title: &str) -> String {
    sqlx::query_scalar("SELECT uuid FROM books WHERE title = ?")
        .bind(title)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn mark(pool: &SqlitePool, user: i64, uuid: &str, status: ReadStatus) {
    set_read_status(
        pool,
        user,
        &SetReadStatus {
            book_uuid: uuid.to_string(),
            status,
        },
    )
    .await
    .unwrap();
}

async fn place(pool: &SqlitePool, user: i64, uuid: &str, percent: i64, at: i64) {
    upsert_progress(
        pool,
        user,
        &ProgressUpdate {
            book_uuid: uuid.to_string(),
            format: ProgressFormat::Epub,
            epub_cfi: Some("epubcfi(/6/4!/4/2/1:0)".into()),
            audio_position_seconds: None,
            progress_percent: Some(percent),
            kobo_location: None,
            book_file_id: None,
            client_updated_at: Some(at),
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn author_reading_counts_finished_and_reading_per_author() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    let one = uuid_by_title(&pool, "Saga: Book One").await;
    let two = uuid_by_title(&pool, "Saga: Book Two").await;
    mark(&pool, user, &one, ReadStatus::Finished).await;
    place(&pool, user, &two, 40, 1_000).await;

    let rows = author_reading(&pool, user, &["/lib"]).await.unwrap();

    let ada = author_id_by_name(&pool, "Ada Lovelace").await;
    let grace = author_id_by_name(&pool, "Grace Hopper").await;
    let by_id = |id| rows.iter().find(|r| r.author_id == id).unwrap();
    assert_eq!((by_id(ada).finished, by_id(ada).reading), (1, 1));
    // Grace co-wrote only Book One, so the position on Book Two isn't hers.
    assert_eq!((by_id(grace).finished, by_id(grace).reading), (1, 0));
    assert!(by_id(ada).last_read_at.is_some());
    let wirth = author_id_by_name(&pool, "Niklaus Wirth").await;
    assert!(
        rows.iter().all(|r| r.author_id != wirth),
        "untouched author is absent"
    );
}

#[tokio::test]
async fn author_reading_is_scoped_to_the_asking_reader() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let other = seed_user(&pool, "other").await;
    let one = uuid_by_title(&pool, "Saga: Book One").await;
    let two = uuid_by_title(&pool, "Saga: Book Two").await;
    mark(&pool, other, &one, ReadStatus::Finished).await;
    place(&pool, other, &two, 40, 1_000).await;

    assert!(author_reading(&pool, reader, &["/lib"])
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn author_reading_leaves_unread_marks_out_of_the_latest_time() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    let other = uuid_by_title(&pool, "Other Story").await;
    mark(&pool, user, &other, ReadStatus::Unread).await;

    let rows = author_reading(&pool, user, &["/lib"]).await.unwrap();

    let wirth = author_id_by_name(&pool, "Niklaus Wirth").await;
    let row = rows.iter().find(|r| r.author_id == wirth).unwrap();
    assert_eq!((row.finished, row.reading, row.last_read_at), (0, 0, None));
}

#[tokio::test]
async fn author_reading_propagates_db_error_when_pool_is_closed() {
    let (pool, _guard) = seed_discovery_fixture().await;
    pool.close().await;
    assert!(matches!(
        author_reading(&pool, 1, &["/lib"]).await,
        Err(BrowseError::Db(_))
    ));
}

#[tokio::test]
async fn book_reading_reports_status_percent_and_time_for_touched_books() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    let one = uuid_by_title(&pool, "Saga: Book One").await;
    let two = uuid_by_title(&pool, "Saga: Book Two").await;
    let solo = uuid_by_title(&pool, "Standalone").await;
    mark(&pool, user, &one, ReadStatus::Finished).await;
    place(&pool, user, &two, 42, 1_000).await;

    let rows = book_reading(&pool, user, &[one.clone(), two.clone(), solo])
        .await
        .unwrap();

    assert_eq!(rows.len(), 2, "the untouched book is left out");
    let by_uuid = |u: &str| rows.iter().find(|r| r.book_uuid == u).unwrap();
    assert_eq!(by_uuid(&one).status, ReadStatus::Finished);
    assert!(by_uuid(&one).last_read_at.is_some());
    // No stored status, but a position: reading, as on the Continue rail.
    assert_eq!(by_uuid(&two).status, ReadStatus::Reading);
    assert_eq!(by_uuid(&two).percent, Some(42));
    assert_eq!(by_uuid(&two).format, Some(ProgressFormat::Epub));
    assert_eq!(by_uuid(&two).last_read_at, Some(1_000));
}

#[tokio::test]
async fn book_reading_returns_nothing_for_no_books() {
    let (pool, _guard) = seed_discovery_fixture().await;
    assert!(book_reading(&pool, 1, &[]).await.unwrap().is_empty());
}

#[tokio::test]
async fn book_reading_propagates_db_error_when_pool_is_closed() {
    let (pool, _guard) = seed_discovery_fixture().await;
    pool.close().await;
    assert!(matches!(
        book_reading(&pool, 1, &["x".to_string()]).await,
        Err(BrowseError::Db(_))
    ));
}

/// Seeds a measured audiobook with a listening position 900 s into its
/// 3600 s, returning its uuid.
async fn listened_audiobook(pool: &SqlitePool, user: i64) -> String {
    let uuid = seed_synced_audiobook(pool, "Lovelace/Notes", "Notes Aloud", "Ada Lovelace").await;
    upsert_progress(
        pool,
        user,
        &ProgressUpdate {
            book_uuid: uuid.clone(),
            format: ProgressFormat::Audio,
            epub_cfi: None,
            audio_position_seconds: Some(900.0),
            progress_percent: None,
            kobo_location: None,
            book_file_id: None,
            client_updated_at: Some(1_000),
        },
    )
    .await
    .unwrap();
    uuid
}

#[tokio::test]
async fn book_reading_derives_an_audio_percent_from_the_measured_duration() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    let uuid = listened_audiobook(&pool, user).await;

    let rows = book_reading(&pool, user, std::slice::from_ref(&uuid))
        .await
        .unwrap();

    let file = crate::hls::resolve_audiobook(&pool, &uuid)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(rows[0].format, Some(ProgressFormat::Audio));
    assert_eq!(rows[0].percent, Some(25));
    assert_eq!(rows[0].book_file_id, Some(file.book_file_id));
}

#[tokio::test]
async fn book_reading_resumes_audio_in_a_live_file_when_the_stored_one_is_gone() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    let uuid = listened_audiobook(&pool, user).await;
    // A reindex replaces `book_files` rows, leaving the position on a dead id.
    sqlx::query("UPDATE reading_progress SET book_file_id = 9999 WHERE book_uuid = ?")
        .bind(&uuid)
        .execute(&pool)
        .await
        .unwrap();

    let rows = book_reading(&pool, user, std::slice::from_ref(&uuid))
        .await
        .unwrap();

    let file = crate::hls::resolve_audiobook(&pool, &uuid)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(rows[0].book_file_id, Some(file.book_file_id));
}

#[tokio::test]
async fn book_reading_is_scoped_to_the_asking_reader() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let other = seed_user(&pool, "other").await;
    let one = uuid_by_title(&pool, "Saga: Book One").await;
    let two = uuid_by_title(&pool, "Saga: Book Two").await;
    mark(&pool, other, &one, ReadStatus::Finished).await;
    place(&pool, other, &two, 40, 1_000).await;

    let rows = book_reading(&pool, reader, &[one, two]).await.unwrap();

    assert!(rows.is_empty(), "another reader's state must not leak");
}

#[tokio::test]
async fn author_reading_counts_only_books_in_the_configured_libraries() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    let one = uuid_by_title(&pool, "Saga: Book One").await;
    mark(&pool, user, &one, ReadStatus::Finished).await;

    assert!(author_reading(&pool, user, &["/elsewhere"])
        .await
        .unwrap()
        .is_empty());
    assert!(author_reading(&pool, user, &[]).await.unwrap().is_empty());
}

#[tokio::test]
async fn author_reading_takes_a_books_position_time_over_its_status_time() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    let two = uuid_by_title(&pool, "Saga: Book Two").await;
    place(&pool, user, &two, 40, 1_000).await;
    // Stamped with server time now: newer, but not when the reading happened.
    mark(&pool, user, &two, ReadStatus::Reading).await;

    let rows = author_reading(&pool, user, &["/lib"]).await.unwrap();

    let ada = author_id_by_name(&pool, "Ada Lovelace").await;
    let row = rows.iter().find(|r| r.author_id == ada).unwrap();
    assert_eq!(row.last_read_at, Some(1_000));
}

#[tokio::test]
async fn author_reading_falls_back_to_the_status_time_without_a_position() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    let one = uuid_by_title(&pool, "Saga: Book One").await;
    mark(&pool, user, &one, ReadStatus::Finished).await;
    let marked: i64 = sqlx::query_scalar("SELECT updated_at FROM book_read_status")
        .fetch_one(&pool)
        .await
        .unwrap();

    let rows = author_reading(&pool, user, &["/lib"]).await.unwrap();

    let grace = author_id_by_name(&pool, "Grace Hopper").await;
    let row = rows.iter().find(|r| r.author_id == grace).unwrap();
    assert_eq!(row.last_read_at, Some(marked));
}

#[tokio::test]
async fn book_reading_drops_the_read_time_of_a_book_marked_unread() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    let two = uuid_by_title(&pool, "Saga: Book Two").await;
    place(&pool, user, &two, 40, 1_000).await;
    mark(&pool, user, &two, ReadStatus::Unread).await;

    let rows = book_reading(&pool, user, &[two]).await.unwrap();

    assert_eq!(rows[0].status, ReadStatus::Unread);
    assert_eq!(rows[0].last_read_at, None, "agrees with author_reading");
}

#[tokio::test]
async fn book_reading_takes_the_newest_position_across_formats() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    // Audio at client time 1000; an older EPUB position must not shadow it.
    let uuid = listened_audiobook(&pool, user).await;
    place(&pool, user, &uuid, 70, 500).await;

    let rows = book_reading(&pool, user, std::slice::from_ref(&uuid))
        .await
        .unwrap();
    assert_eq!(rows[0].format, Some(ProgressFormat::Audio));
    assert_eq!(rows[0].percent, Some(25));

    place(&pool, user, &uuid, 70, 2_000).await;
    let rows = book_reading(&pool, user, &[uuid]).await.unwrap();
    assert_eq!(rows[0].format, Some(ProgressFormat::Epub));
    assert_eq!(rows[0].percent, Some(70));
    assert_eq!(rows[0].last_read_at, Some(2_000));
}

#[tokio::test]
async fn series_reading_counts_finished_and_reading_per_series() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    let one = uuid_by_title(&pool, "Saga: Book One").await;
    let two = uuid_by_title(&pool, "Saga: Book Two").await;
    mark(&pool, user, &one, ReadStatus::Finished).await;
    place(&pool, user, &two, 40, 1_000).await;

    let rows = series_reading(&pool, user, &["/lib"]).await.unwrap();

    let saga = series_id_by_name(&pool, "Saga").await;
    let row = rows.iter().find(|r| r.series_id == saga).unwrap();
    assert_eq!((row.finished, row.reading), (1, 1));
    assert!(row.last_read_at.is_some());
    let pioneers = series_id_by_name(&pool, "Pioneers").await;
    assert!(
        rows.iter().all(|r| r.series_id != pioneers),
        "untouched series is absent"
    );
}

#[tokio::test]
async fn series_reading_is_scoped_to_the_asking_reader() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let other = seed_user(&pool, "other").await;
    let one = uuid_by_title(&pool, "Saga: Book One").await;
    mark(&pool, other, &one, ReadStatus::Finished).await;

    assert!(series_reading(&pool, reader, &["/lib"])
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn series_reading_counts_a_book_under_the_series_its_override_names() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let user = seed_user(&pool, "reader").await;
    let solo = uuid_by_title(&pool, "Standalone").await;
    let ov = MetadataOverrides {
        series: Some("Pioneers".into()),
        series_index: Some("2".into()),
        ..Default::default()
    };
    upsert_metadata_overrides(&pool, &solo, &ov, false, user)
        .await
        .unwrap();
    mark(&pool, user, &solo, ReadStatus::Finished).await;

    let rows = series_reading(&pool, user, &["/lib"]).await.unwrap();

    let pioneers = series_id_by_name(&pool, "Pioneers").await;
    let row = rows.iter().find(|r| r.series_id == pioneers).unwrap();
    assert_eq!((row.finished, row.reading), (1, 0));
}

#[tokio::test]
async fn series_reading_propagates_db_error_when_pool_is_closed() {
    let (pool, _guard) = seed_discovery_fixture().await;
    pool.close().await;
    assert!(matches!(
        series_reading(&pool, 1, &["/lib"]).await,
        Err(BrowseError::Db(_))
    ));
}

#[test]
fn book_uuids_keeps_the_books_that_carry_an_identifier() {
    let books = [
        EbookMetadata {
            unique_identifier: Some("a".into()),
            ..Default::default()
        },
        EbookMetadata::default(),
    ];
    assert_eq!(book_uuids(&books), vec!["a".to_string()]);
}
