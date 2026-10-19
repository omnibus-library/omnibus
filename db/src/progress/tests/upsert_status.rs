//! The read status a position gives its book: `reading` when the reader has
//! none, nothing when they set one, and the migration that backfills it.

use omnibus_shared::{ReadStatus, SetReadStatus};
use sqlx::SqlitePool;

use crate::init_db;
use crate::read_status::{get_read_status, set_read_status};
use crate::test_support::{forget_read_status, seed_epub_position};

use super::super::*;
use super::{audio_update, seed, seed_user};

const POSITION_MARKS_READING: &str =
    include_str!("../../../migrations/0103_position_marks_reading.sql");

/// The stored status for `(user, uuid)`, `None` when there is no row.
async fn status_of(pool: &SqlitePool, user: i64, uuid: &str) -> Option<ReadStatus> {
    get_read_status(pool, user, uuid)
        .await
        .unwrap()
        .map(|r| r.status)
}

#[tokio::test]
async fn upsert_progress_marks_an_audiobook_with_no_status_reading() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "alice").await;
    let (_, uuid) = seed(&pool, "/lib", "Heard").await;

    upsert_progress(&pool, user, &audio_update(&uuid, 58.0, None, 1_000))
        .await
        .unwrap();

    let status = get_read_status(&pool, user, &uuid).await.unwrap().unwrap();
    assert_eq!(status.status, ReadStatus::Reading);
    assert_eq!(
        status.updated_at, 1_000,
        "dated by the position, not receipt"
    );
}

#[tokio::test]
async fn upsert_progress_dates_the_status_by_the_surviving_position_when_a_write_loses() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "alice").await;
    let (_, uuid) = seed(&pool, "/lib", "Heard").await;
    upsert_progress(&pool, user, &audio_update(&uuid, 900.0, None, 5_000))
        .await
        .unwrap();
    // A merge undo can leave a position with no status of its own.
    forget_read_status(&pool, user, &uuid).await;

    upsert_progress(&pool, user, &audio_update(&uuid, 60.0, None, 1_000))
        .await
        .unwrap();

    let status = get_read_status(&pool, user, &uuid).await.unwrap().unwrap();
    assert_eq!(status.status, ReadStatus::Reading);
    assert_eq!(status.updated_at, 5_000, "the stale write's clock lost");
}

#[tokio::test]
async fn upsert_progress_keeps_a_status_the_reader_set() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "alice").await;
    for (title, status) in [
        ("Shelved", ReadStatus::Unread),
        ("Done", ReadStatus::Finished),
    ] {
        let (_, uuid) = seed(&pool, "/lib", title).await;
        let set = SetReadStatus {
            book_uuid: uuid.clone(),
            status,
        };
        let before = set_read_status(&pool, user, &set).await.unwrap();

        upsert_progress(&pool, user, &audio_update(&uuid, 58.0, None, 1_000))
            .await
            .unwrap();

        let after = get_read_status(&pool, user, &uuid).await.unwrap().unwrap();
        assert_eq!(after.status, status, "{title}");
        assert_eq!(after.finished_at, before.finished_at, "{title}");
    }
}

#[tokio::test]
async fn upsert_progress_marks_only_the_writing_reader() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let alice = seed_user(&pool, "alice").await;
    let bob = seed_user(&pool, "bob").await;
    let (_, uuid) = seed(&pool, "/lib", "Heard").await;

    upsert_progress(&pool, alice, &audio_update(&uuid, 58.0, None, 1_000))
        .await
        .unwrap();

    assert_eq!(status_of(&pool, bob, &uuid).await, None);
}

#[tokio::test]
async fn position_marks_reading_migration_backfills_reading_at_the_latest_position_time() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "alice").await;
    let (_, heard) = seed(&pool, "/lib", "Heard").await;
    let (_, done) = seed(&pool, "/lib", "Done").await;
    let (_, gone) = seed(&pool, "/lib", "Gone").await;
    upsert_progress(&pool, user, &audio_update(&heard, 58.0, None, 1_000))
        .await
        .unwrap();
    seed_epub_position(&pool, user, &heard).await;
    upsert_progress(&pool, user, &audio_update(&done, 58.0, None, 1_000))
        .await
        .unwrap();
    upsert_progress(&pool, user, &audio_update(&gone, 58.0, None, 1_000))
        .await
        .unwrap();
    let set = SetReadStatus {
        book_uuid: done.clone(),
        status: ReadStatus::Finished,
    };
    set_read_status(&pool, user, &set).await.unwrap();
    forget_read_status(&pool, user, &heard).await;
    forget_read_status(&pool, user, &gone).await;
    sqlx::query("UPDATE reading_progress SET client_updated_at = 2000 WHERE format = 'epub'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE reading_progress SET book_uuid = 'no-such-book' WHERE book_uuid = ?")
        .bind(&gone)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::raw_sql(POSITION_MARKS_READING)
        .execute(&pool)
        .await
        .unwrap();

    let backfilled = get_read_status(&pool, user, &heard).await.unwrap().unwrap();
    assert_eq!(backfilled.status, ReadStatus::Reading);
    assert_eq!(backfilled.updated_at, 2_000);
    assert_eq!(
        status_of(&pool, user, &done).await,
        Some(ReadStatus::Finished)
    );
    let strays: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM book_read_status WHERE book_uuid = 'no-such-book'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(strays, 0);
}
