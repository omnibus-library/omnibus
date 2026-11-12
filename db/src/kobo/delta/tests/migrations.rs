//! Replays of the migrations that touch `kobo_books_sync` against a device that already
//! holds books: each must re-announce exactly what it means to and nothing else.

use omnibus_shared::{ReadStatus, SetReadStatus};

use super::*;

/// Migration `0100`'s resend, read from the migration itself so the two cannot drift.
const KOBO_RESEND: &str = include_str!("../../../../migrations/0100_kobo_resend_metadata.sql");

/// Migration `0120`'s watermark shift, read from the migration itself like [`KOBO_RESEND`].
const STATE_WATERMARK_SHIFT: &str =
    include_str!("../../../../migrations/0120_kobo_state_watermark_shift.sql");

/// Migration `0103`'s backfill, read from the migration itself like [`KOBO_RESEND`].
const POSITION_MARKS_READING: &str =
    include_str!("../../../../migrations/0103_position_marks_reading.sql");

#[tokio::test]
async fn resend_migration_marks_every_held_book_changed_exactly_once() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = make_user(&pool, "reader").await;
    let device = make_device(&pool, user, "Clara").await;
    let dune = seed_synced_ebook(&pool, "dune.epub", "Dune", "Herbert").await;
    let emma = seed_synced_ebook(&pool, "emma.epub", "Emma", "Austen").await;
    synced_shelf(&pool, user, "Kobo", &[dune.clone(), emma.clone()]).await;
    sqlx::query("UPDATE books SET last_modified = NULL WHERE uuid = ?")
        .bind(&emma)
        .execute(&pool)
        .await
        .unwrap();
    sync_once(&pool, user, device).await;
    assert!(sync_delta(&pool, user, device).await.unwrap().is_empty());

    sqlx::raw_sql(KOBO_RESEND).execute(&pool).await.unwrap();

    let delta = sync_once(&pool, user, device).await;
    let mut changed: Vec<String> = delta
        .changes
        .iter()
        .map(|change| match change {
            SyncChange::Changed(book) => book.uuid.clone(),
            other => panic!("expected Changed, got {other:?}"),
        })
        .collect();
    changed.sort();
    let mut expected = vec![dune, emma];
    expected.sort();
    assert_eq!(changed, expected);
    assert!(sync_delta(&pool, user, device).await.unwrap().is_empty());
}

#[tokio::test]
async fn position_marks_reading_migration_reannounces_a_backfilled_book_to_a_device_holding_it() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = make_user(&pool, "reader").await;
    let other = make_user(&pool, "household").await;
    let device = make_device(&pool, user, "Clara").await;
    let dune = seed_synced_ebook(&pool, "dune.epub", "Dune", "Herbert").await;
    let emma = seed_synced_ebook(&pool, "emma.epub", "Emma", "Austen").await;
    let gatsby = seed_synced_ebook(&pool, "gatsby.epub", "Gatsby", "Fitzgerald").await;
    let held = [dune.clone(), emma.clone(), gatsby.clone()];
    synced_shelf(&pool, user, "Kobo", &held).await;
    // Only `dune` is the reader's and statusless: `emma` kept the status its
    // position gave it, and `gatsby` was read by someone else, though the reader
    // has a state of their own on it, so its watermark is not 0 either.
    for (reader, uuid) in [(user, &dune), (user, &emma), (other, &gatsby)] {
        place_position(&pool, reader, uuid, 40, 1_000).await;
    }
    forget_read_status(&pool, user, &dune).await;
    forget_read_status(&pool, other, &gatsby).await;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let reading = SetReadStatus {
        book_uuid: gatsby.clone(),
        status: ReadStatus::Reading,
    };
    crate::read_status::set_read_status_at_tx(&mut tx, user, &reading, 2_000)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    sync_once(&pool, user, device).await;
    assert!(sync_delta(&pool, user, device).await.unwrap().is_empty());

    sqlx::raw_sql(POSITION_MARKS_READING)
        .execute(&pool)
        .await
        .unwrap();

    let zeroed: Vec<String> = sqlx::query_scalar(
        "SELECT book_uuid FROM kobo_books_sync WHERE device_id = ? AND synced_at = 0
          ORDER BY book_uuid",
    )
    .bind(device)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(zeroed, vec![dune.clone()]);
    let delta = sync_once(&pool, user, device).await;
    assert_eq!(delta.len(), 1);
    assert!(matches!(&delta.changes[0], SyncChange::StateChanged(b) if b.uuid == dune));
    assert!(sync_delta(&pool, user, device).await.unwrap().is_empty());
}

#[tokio::test]
async fn state_watermark_migration_reannounces_a_state_stuck_at_the_old_clock_watermark() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = make_user(&pool, "reader").await;
    let device = make_device(&pool, user, "Clara").await;
    let stuck = seed_synced_ebook(&pool, "dune.epub", "Dune", "Herbert").await;
    let older = seed_synced_ebook(&pool, "emma.epub", "Emma", "Austen").await;
    synced_shelf(&pool, user, "Kobo", &[stuck.clone(), older.clone()]).await;
    sync_once(&pool, user, device).await;
    // What the clock-time watermark left: the device synced after both states were saved, and
    // `stuck`'s state shares the second of that sync, so it was never announced.
    let at = server_now(&pool).await - 10;
    place_position(&pool, user, &stuck, 40, at).await;
    place_position(&pool, user, &older, 40, at - 50).await;
    sqlx::query("UPDATE kobo_books_sync SET synced_at = ? WHERE device_id = ?")
        .bind(at)
        .bind(device)
        .execute(&pool)
        .await
        .unwrap();
    assert!(sync_delta(&pool, user, device).await.unwrap().is_empty());
    let held_before: Vec<(String, i64, bool)> = sqlx::query_as(
        "SELECT book_uuid, last_modified_seen, resend FROM kobo_books_sync ORDER BY book_uuid",
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    sqlx::raw_sql(STATE_WATERMARK_SHIFT)
        .execute(&pool)
        .await
        .unwrap();

    let delta = sync_delta(&pool, user, device).await.unwrap();
    assert_eq!(delta.len(), 1, "got {:?}", delta.changes);
    assert!(matches!(&delta.changes[0], SyncChange::StateChanged(b) if b.uuid == stuck));
    // No book is sent again, and the announced state settles once recorded.
    let held_after: Vec<(String, i64, bool)> = sqlx::query_as(
        "SELECT book_uuid, last_modified_seen, resend FROM kobo_books_sync ORDER BY book_uuid",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(held_after, held_before);
    sync_once(&pool, user, device).await;
    assert!(sync_delta(&pool, user, device).await.unwrap().is_empty());
}
