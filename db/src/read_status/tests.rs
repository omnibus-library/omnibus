//! Unit tests for the `read_status` module: `set_read_status` round-trip and
//! overwrite, `finished_at` lifecycle (set on finish, preserved on re-affirm,
//! cleared on downgrade), per-user isolation, `BookNotFound`, `get_read_status`
//! empty-state, and merged-uuid canonical resolution.

use omnibus_shared::{EbookMetadata, ReadStatus, SetReadStatus};

use super::*;
use crate::{init_db, replace_books};

async fn seed(pool: &SqlitePool, library: &str, title: &str) -> (i64, String) {
    replace_books(
        pool,
        library,
        vec![crate::ebook::IndexedBook {
            metadata: EbookMetadata {
                filename: format!("{title}.epub").to_lowercase(),
                title: Some(title.to_string()),
                ..Default::default()
            },
            cover: None,
            mtime_epoch: 0,
            size_bytes: 0,
            word_count: None,
        }],
    )
    .await
    .expect("seed book");
    let books = crate::list_books(pool, library).await.unwrap();
    let book = books
        .into_iter()
        .find(|b| b.title.as_deref() == Some(title))
        .unwrap();
    (book.id, book.unique_identifier.clone().unwrap())
}

async fn seed_user(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "INSERT INTO users (username, password_hash, is_admin, can_upload, can_edit, can_download)
         VALUES (?, '!x', 0, 0, 0, 1) RETURNING id",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_merged_uuid(pool: &SqlitePool, uuid: &str, book_id: i64, format: &str) {
    sqlx::query(
        "INSERT OR REPLACE INTO merged_uuids (uuid, book_id, format, library_path)
         VALUES (?, ?, ?, ?)",
    )
    .bind(uuid)
    .bind(book_id)
    .bind(format)
    .bind("/lib")
    .execute(pool)
    .await
    .expect("seed merged uuid");
}

fn set(uuid: &str, status: ReadStatus) -> SetReadStatus {
    SetReadStatus {
        book_uuid: uuid.to_string(),
        status,
    }
}

#[tokio::test]
async fn set_read_status_round_trips_the_status() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;

    let rec = set_read_status(&pool, user, &set(&uuid, ReadStatus::Reading))
        .await
        .unwrap();
    assert_eq!(rec.status, ReadStatus::Reading);
    assert_eq!(rec.book_uuid, uuid);
    assert!(rec.finished_at.is_none());

    let got = get_read_status(&pool, user, &uuid).await.unwrap().unwrap();
    assert_eq!(got.status, ReadStatus::Reading);
}

#[tokio::test]
async fn set_read_status_overwrites_existing_status() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;

    set_read_status(&pool, user, &set(&uuid, ReadStatus::Reading))
        .await
        .unwrap();
    let rec = set_read_status(&pool, user, &set(&uuid, ReadStatus::Finished))
        .await
        .unwrap();
    assert_eq!(rec.status, ReadStatus::Finished);

    // Only one row exists for the pair — the second write updated in place.
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM book_read_status WHERE user_id = ? AND book_uuid = ?",
    )
    .bind(user)
    .bind(&uuid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn finishing_stamps_finished_at() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;

    let rec = set_read_status(&pool, user, &set(&uuid, ReadStatus::Finished))
        .await
        .unwrap();
    assert!(rec.finished_at.is_some());
}

#[tokio::test]
async fn re_affirming_finished_preserves_original_finished_at() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;

    let first = set_read_status(&pool, user, &set(&uuid, ReadStatus::Finished))
        .await
        .unwrap();
    // Backdate the stored completion so a re-affirm would visibly change it if
    // the COALESCE branch were wrong.
    sqlx::query(
        "UPDATE book_read_status SET finished_at = 100 WHERE user_id = ? AND book_uuid = ?",
    )
    .bind(user)
    .bind(&uuid)
    .execute(&pool)
    .await
    .unwrap();
    let again = set_read_status(&pool, user, &set(&uuid, ReadStatus::Finished))
        .await
        .unwrap();
    assert_eq!(again.finished_at, Some(100));
    let _ = first;
}

#[tokio::test]
async fn downgrading_from_finished_clears_finished_at() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;

    set_read_status(&pool, user, &set(&uuid, ReadStatus::Finished))
        .await
        .unwrap();
    let rec = set_read_status(&pool, user, &set(&uuid, ReadStatus::Unread))
        .await
        .unwrap();
    assert_eq!(rec.status, ReadStatus::Unread);
    assert!(rec.finished_at.is_none());
}

#[tokio::test]
async fn read_status_is_isolated_per_user() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let a = seed_user(&pool, "alice").await;
    let b = seed_user(&pool, "bob").await;

    set_read_status(&pool, a, &set(&uuid, ReadStatus::Finished))
        .await
        .unwrap();
    assert!(get_read_status(&pool, b, &uuid).await.unwrap().is_none());
}

#[tokio::test]
async fn set_read_status_returns_book_not_found_for_unknown_uuid() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let err = set_read_status(&pool, user, &set("nope", ReadStatus::Reading))
        .await
        .unwrap_err();
    assert!(matches!(err, ReadStatusError::BookNotFound));
}

#[tokio::test]
async fn get_read_status_returns_none_when_unset() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;
    assert!(get_read_status(&pool, user, &uuid).await.unwrap().is_none());
}

#[tokio::test]
async fn get_read_status_returns_none_for_unknown_uuid() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    assert!(get_read_status(&pool, user, "nope")
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn set_read_status_resolves_merged_uuid_to_surviving_book() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (book_id, canonical) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;
    seed_merged_uuid(&pool, "legacy-uuid", book_id, "epub").await;

    let rec = set_read_status(&pool, user, &set("legacy-uuid", ReadStatus::Finished))
        .await
        .unwrap();
    // Stored + returned under the surviving book's canonical uuid.
    assert_eq!(rec.book_uuid, canonical);
    let got = get_read_status(&pool, user, &canonical)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(got.status, ReadStatus::Finished);
}

/// Regression test for the BEGIN IMMEDIATE stale-snapshot 517 fix (#1862).
#[tokio::test]
async fn set_read_status_succeeds_for_many_concurrent_writers_on_one_pool() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let (_, shared_uuid) = seed(&pool, "/lib", "Shared Book").await;
    let mut solo_uuids = Vec::new();
    for i in 0..4 {
        let (_, uuid) = seed(&pool, "/lib", &format!("Solo Status Book {i}")).await;
        solo_uuids.push(uuid);
    }

    for _round in 0..5 {
        let mut handles = Vec::new();
        for book_uuid in std::iter::once(shared_uuid.clone()).chain(solo_uuids.iter().cloned()) {
            let pool = pool.clone();
            handles.push(tokio::spawn(async move {
                set_read_status(&pool, user, &set(&book_uuid, ReadStatus::Reading)).await
            }));
        }
        for handle in handles {
            handle
                .await
                .expect("writer task panicked")
                .expect("concurrent set_read_status must not surface a database error");
        }
    }
}

#[tokio::test]
async fn set_read_status_drops_the_cached_stats_summary() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    // An id no sibling test uses: the stats cache is process-wide, keyed on it.
    let user: i64 = sqlx::query_scalar(
        "INSERT INTO users (id, username, password_hash) VALUES (9931, 'status-cache', '!x')
         RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Harbour Lights").await;
    set_read_status(&pool, user, &set(&uuid, ReadStatus::Finished))
        .await
        .unwrap();
    let range = omnibus_shared::StatsRange::AllTime;
    let before = crate::stats::user_stats(&pool, user, range, None)
        .await
        .unwrap();
    assert_eq!(before.finished_books.len(), 1);

    set_read_status(&pool, user, &set(&uuid, ReadStatus::Reading))
        .await
        .unwrap();
    let after = crate::stats::user_stats(&pool, user, range, None)
        .await
        .unwrap();
    assert!(
        after.finished_books.is_empty(),
        "got {:?}",
        after.finished_books
    );
}

/// Run [`set_read_status_at_tx`] in its own committed transaction.
async fn set_at(
    pool: &SqlitePool,
    user: i64,
    uuid: &str,
    status: ReadStatus,
    event_at: i64,
) -> ReadStatusRecord {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let record = set_read_status_at_tx(&mut tx, user, &set(uuid, status), event_at)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    record
}

#[tokio::test]
async fn set_read_status_at_tx_stamps_the_event_time() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;

    let reading = set_at(&pool, user, &uuid, ReadStatus::Reading, 1_000).await;
    assert_eq!((reading.updated_at, reading.finished_at), (1_000, None));

    let finished = set_at(&pool, user, &uuid, ReadStatus::Finished, 2_000).await;
    assert_eq!(finished.status, ReadStatus::Finished);
    assert_eq!(
        (finished.updated_at, finished.finished_at),
        (2_000, Some(2_000))
    );
}

#[tokio::test]
async fn set_read_status_at_tx_keeps_a_newer_stored_status() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;
    set_at(&pool, user, &uuid, ReadStatus::Finished, 2_000).await;

    let survivor = set_at(&pool, user, &uuid, ReadStatus::Reading, 1_000).await;

    assert_eq!(survivor.status, ReadStatus::Finished);
    assert_eq!(survivor.updated_at, 2_000);
    assert_eq!(survivor.finished_at, Some(2_000));
}

#[tokio::test]
async fn set_read_status_at_tx_lets_an_equal_event_time_win() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;
    set_at(&pool, user, &uuid, ReadStatus::Reading, 1_000).await;

    let survivor = set_at(&pool, user, &uuid, ReadStatus::Finished, 1_000).await;

    assert_eq!(survivor.status, ReadStatus::Finished);
}

#[tokio::test]
async fn set_read_status_at_tx_clamps_a_future_event_time_to_now() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;
    let before: i64 = sqlx::query_scalar("SELECT CAST(strftime('%s','now') AS INTEGER)")
        .fetch_one(&pool)
        .await
        .unwrap();

    let record = set_at(&pool, user, &uuid, ReadStatus::Finished, before + 3_600).await;

    assert!(record.updated_at <= before + 5, "got {}", record.updated_at);
    assert_eq!(record.finished_at, Some(record.updated_at));
}

#[tokio::test]
async fn set_read_status_at_tx_returns_book_not_found_for_unknown_uuid() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = seed_user(&pool, "reader").await;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();

    let err = set_read_status_at_tx(&mut tx, user, &set("nope", ReadStatus::Reading), 1_000)
        .await
        .unwrap_err();

    assert!(matches!(err, ReadStatusError::BookNotFound));
}

#[tokio::test]
async fn set_read_status_at_tx_beats_the_reading_status_a_position_started() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;
    // A position at t2 starts the book: the server, not the reader, chose `reading`.
    let position = omnibus_shared::ProgressUpdate {
        book_uuid: uuid.clone(),
        format: omnibus_shared::ProgressFormat::Epub,
        epub_cfi: None,
        audio_position_seconds: None,
        progress_percent: Some(60),
        kobo_location: None,
        book_file_id: None,
        client_updated_at: Some(2_000),
    };
    crate::progress::upsert_progress(&pool, user, &position)
        .await
        .unwrap();

    let survivor = set_at(&pool, user, &uuid, ReadStatus::Finished, 1_000).await;

    assert_eq!(survivor.status, ReadStatus::Finished);
    assert_eq!(survivor.finished_at, Some(1_000));
}

#[tokio::test]
async fn set_read_status_at_tx_keeps_a_newer_explicit_reading_over_an_older_finished() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;
    set_at(&pool, user, &uuid, ReadStatus::Reading, 2_000).await;

    let survivor = set_at(&pool, user, &uuid, ReadStatus::Finished, 1_000).await;

    assert_eq!(
        (survivor.status, survivor.updated_at),
        (ReadStatus::Reading, 2_000)
    );
}

#[tokio::test]
async fn set_read_status_tx_makes_an_auto_started_status_explicit() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;
    let position = omnibus_shared::ProgressUpdate {
        book_uuid: uuid.clone(),
        format: omnibus_shared::ProgressFormat::Epub,
        epub_cfi: None,
        audio_position_seconds: None,
        progress_percent: Some(60),
        kobo_location: None,
        book_file_id: None,
        client_updated_at: Some(2_000),
    };
    crate::progress::upsert_progress(&pool, user, &position)
        .await
        .unwrap();
    // The reader picks `reading` themselves; from here an older device Finished must lose.
    set_read_status(&pool, user, &set(&uuid, ReadStatus::Reading))
        .await
        .unwrap();
    let stamped = get_read_status(&pool, user, &uuid).await.unwrap().unwrap();

    let survivor = set_at(&pool, user, &uuid, ReadStatus::Finished, 1_000).await;

    assert_eq!(survivor.status, ReadStatus::Reading);
    assert_eq!(survivor.updated_at, stamped.updated_at);
}

#[tokio::test]
async fn set_read_status_at_tx_returns_sqlx_when_the_table_is_gone() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (_, uuid) = seed(&pool, "/lib", "Dune").await;
    let user = seed_user(&pool, "reader").await;
    sqlx::query("DROP TABLE book_read_status")
        .execute(&pool)
        .await
        .unwrap();
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();

    let err = set_read_status_at_tx(&mut tx, user, &set(&uuid, ReadStatus::Reading), 1_000)
        .await
        .unwrap_err();

    assert!(matches!(err, ReadStatusError::Sqlx(_)));
}
