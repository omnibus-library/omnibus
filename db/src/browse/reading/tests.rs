//! Tests for the per-reader browse overlays: per-author finished/reading
//! counts and latest read time, and per-book status, percent and time.

use omnibus_shared::{ProgressFormat, ProgressUpdate, ReadStatus, SetReadStatus};
use sqlx::SqlitePool;

use super::*;
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
    mark(&pool, other, &one, ReadStatus::Finished).await;

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
