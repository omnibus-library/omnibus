//! Tests for hiding a series from a reader's home page and for listing the
//! series a reader is partway through.

use omnibus_shared::{BookReading, EbookMetadata, MetadataOverrides, ReadStatus, SetReadStatus};

use super::*;
use crate::metadata_overrides::upsert_metadata_overrides;
use crate::read_status::{set_read_status_at_tx, start_unread_at_tx};
use crate::test_support::*;

fn book(uuid: &str) -> EbookMetadata {
    EbookMetadata {
        unique_identifier: Some(uuid.into()),
        ..Default::default()
    }
}

fn state(uuid: &str, status: ReadStatus, last_read_at: Option<i64>) -> BookReading {
    BookReading {
        book_uuid: uuid.into(),
        status,
        last_read_at,
        ..Default::default()
    }
}

fn next_uuid(books: &[EbookMetadata], reading: &[BookReading]) -> Option<String> {
    next_book(books, reading).and_then(|b| b.unique_identifier.clone())
}

/// Alpha, Beta (two books each), Gamma (1, 1.5 and 3: no 2), Solo (one book).
async fn seed_series_library(pool: &SqlitePool) {
    let book = |file: &str, title: &str, series: &str, index: &str| {
        indexed(
            file,
            Some(title),
            &["Ann"],
            &[],
            Some((series, index)),
            None,
        )
    };
    crate::sync::replace_books(
        pool,
        "/lib",
        vec![
            book("a1.epub", "Alpha One", "Alpha", "1"),
            book("a2.epub", "Alpha Two", "Alpha", "2"),
            book("b1.epub", "Beta One", "Beta", "1"),
            book("b2.epub", "Beta Two", "Beta", "2"),
            book("g1.epub", "Gamma One", "Gamma", "1"),
            book("g15.epub", "Gamma Novella", "Gamma", "1.5"),
            book("g3.epub", "Gamma Three", "Gamma", "3"),
            book("s1.epub", "Solo One", "Solo", "1"),
        ],
    )
    .await
    .unwrap();
}

async fn listed(pool: &SqlitePool, user: i64) -> Vec<SeriesInProgress> {
    in_progress(pool, user, &["/lib"]).await.unwrap()
}

fn names(rows: &[SeriesInProgress]) -> Vec<&str> {
    rows.iter().map(|r| r.series.name.as_str()).collect()
}

async fn hide_rows(pool: &SqlitePool) -> i64 {
    count_rows(pool, "SELECT COUNT(*) FROM series_hides").await
}

#[tokio::test]
async fn hide_marks_the_series_hidden_for_that_reader_only() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let other = seed_user(&pool, "other").await;
    let saga = series_id_by_name(&pool, "Saga").await;

    hide(&pool, reader, saga).await.unwrap();

    assert!(is_hidden(&pool, reader, saga).await.unwrap());
    assert!(!is_hidden(&pool, other, saga).await.unwrap());
}

#[tokio::test]
async fn hide_twice_succeeds_and_keeps_one_row() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let saga = series_id_by_name(&pool, "Saga").await;

    hide(&pool, reader, saga).await.unwrap();
    hide(&pool, reader, saga).await.unwrap();

    assert_eq!(hide_rows(&pool).await, 1);
}

#[tokio::test]
async fn unhide_clears_the_hide_and_succeeds_when_none_exists() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let saga = series_id_by_name(&pool, "Saga").await;
    hide(&pool, reader, saga).await.unwrap();

    unhide(&pool, reader, saga).await.unwrap();
    unhide(&pool, reader, saga).await.unwrap();

    assert!(!is_hidden(&pool, reader, saga).await.unwrap());
}

#[tokio::test]
async fn hide_and_unhide_report_an_unknown_series_and_write_nothing() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;

    assert!(matches!(
        hide(&pool, reader, 9_999).await,
        Err(SeriesProgressError::SeriesNotFound)
    ));
    assert!(matches!(
        unhide(&pool, reader, 9_999).await,
        Err(SeriesProgressError::SeriesNotFound)
    ));
    assert_eq!(hide_rows(&pool).await, 0);
}

#[tokio::test]
async fn deleting_a_series_or_a_user_drops_their_hides() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let leaver = seed_user(&pool, "leaver").await;
    let saga = series_id_by_name(&pool, "Saga").await;
    let pioneers = series_id_by_name(&pool, "Pioneers").await;
    hide(&pool, reader, saga).await.unwrap();
    hide(&pool, leaver, pioneers).await.unwrap();

    sqlx::query("DELETE FROM books_series_link WHERE series = ?")
        .bind(saga)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM series WHERE id = ?")
        .bind(saga)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(leaver)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(hide_rows(&pool).await, 0);
}

#[tokio::test]
async fn hide_propagates_db_error_when_pool_is_closed() {
    let (pool, _guard) = seed_discovery_fixture().await;
    pool.close().await;

    assert!(matches!(
        hide(&pool, 1, 1).await,
        Err(SeriesProgressError::Db(_))
    ));
}

#[test]
fn next_book_picks_the_reading_book_read_last() {
    let books = [book("a"), book("b"), book("c")];
    let reading = [
        state("a", ReadStatus::Reading, Some(20)),
        state("b", ReadStatus::Reading, Some(10)),
    ];

    assert_eq!(next_uuid(&books, &reading).as_deref(), Some("a"));
}

#[test]
fn next_book_prefers_the_later_book_when_reading_times_tie() {
    let books = [book("a"), book("b")];
    let reading = [
        state("a", ReadStatus::Reading, Some(10)),
        state("b", ReadStatus::Reading, Some(10)),
    ];

    assert_eq!(next_uuid(&books, &reading).as_deref(), Some("b"));
}

#[test]
fn next_book_starts_the_first_unread_book_when_nothing_is_being_read() {
    let books = [book("a"), book("b"), book("c")];
    let reading = [state("a", ReadStatus::Finished, Some(10))];

    assert_eq!(next_uuid(&books, &reading).as_deref(), Some("b"));
}

#[test]
fn next_book_counts_a_book_marked_unread_as_unread() {
    let books = [book("a"), book("b")];
    let reading = [
        state("a", ReadStatus::Finished, Some(10)),
        state("b", ReadStatus::Unread, None),
    ];

    assert_eq!(next_uuid(&books, &reading).as_deref(), Some("b"));
}

#[test]
fn next_book_returns_nothing_once_every_book_is_finished() {
    let books = [book("a")];
    let reading = [state("a", ReadStatus::Finished, Some(10))];

    assert_eq!(next_uuid(&books, &reading), None);
}

#[tokio::test]
async fn in_progress_lists_a_series_with_a_book_being_read_and_the_book_to_open_next() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let one = uuid_by_title(&pool, "Saga: Book One").await;
    let two = uuid_by_title(&pool, "Saga: Book Two").await;
    place_position(&pool, reader, &one, 100, 500).await;
    mark_status(&pool, reader, &one, ReadStatus::Finished).await;
    place_position(&pool, reader, &two, 40, 1_000).await;

    let rows = listed(&pool, reader).await;

    assert_eq!(names(&rows), ["Saga"]);
    assert_eq!(rows[0].next_book_uuid, two);
    assert_eq!(rows[0].last_read_at, Some(1_000));
    assert_eq!(rows[0].series.books.len(), 2);
    assert_eq!(rows[0].series.reading.len(), 2);
    assert!(!rows[0].series.hidden_from_home);
}

#[tokio::test]
async fn in_progress_offers_the_next_unread_book_in_reading_order_past_a_fraction_and_a_gap() {
    let pool = crate::pool::init_db("sqlite::memory:").await.unwrap();
    seed_series_library(&pool).await;
    let reader = seed_user(&pool, "reader").await;
    let one = uuid_by_title(&pool, "Gamma One").await;
    let novella = uuid_by_title(&pool, "Gamma Novella").await;
    let three = uuid_by_title(&pool, "Gamma Three").await;
    mark_status(&pool, reader, &one, ReadStatus::Finished).await;
    assert_eq!(listed(&pool, reader).await[0].next_book_uuid, novella);

    mark_status(&pool, reader, &novella, ReadStatus::Finished).await;
    assert_eq!(listed(&pool, reader).await[0].next_book_uuid, three);
}

#[tokio::test]
async fn in_progress_leaves_out_a_series_of_one_book_or_with_every_book_finished() {
    let pool = crate::pool::init_db("sqlite::memory:").await.unwrap();
    seed_series_library(&pool).await;
    let reader = seed_user(&pool, "reader").await;
    mark_status(
        &pool,
        reader,
        &uuid_by_title(&pool, "Solo One").await,
        ReadStatus::Reading,
    )
    .await;
    for title in ["Alpha One", "Alpha Two"] {
        mark_status(
            &pool,
            reader,
            &uuid_by_title(&pool, title).await,
            ReadStatus::Finished,
        )
        .await;
    }

    assert!(listed(&pool, reader).await.is_empty());
}

#[tokio::test]
async fn in_progress_leaves_out_a_series_whose_only_marks_are_unread() {
    let pool = crate::pool::init_db("sqlite::memory:").await.unwrap();
    seed_series_library(&pool).await;
    let reader = seed_user(&pool, "reader").await;
    let beta = uuid_by_title(&pool, "Beta One").await;
    place_position(&pool, reader, &beta, 30, 1_000).await;
    mark_status(&pool, reader, &beta, ReadStatus::Unread).await;

    assert!(listed(&pool, reader).await.is_empty());
}

#[tokio::test]
async fn in_progress_leaves_out_a_hidden_series_for_the_reader_who_hid_it_only() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let other = seed_user(&pool, "other").await;
    let one = uuid_by_title(&pool, "Saga: Book One").await;
    for user in [reader, other] {
        mark_status(&pool, user, &one, ReadStatus::Finished).await;
    }
    hide(&pool, reader, series_id_by_name(&pool, "Saga").await)
        .await
        .unwrap();

    assert!(listed(&pool, reader).await.is_empty());
    assert_eq!(names(&listed(&pool, other).await), ["Saga"]);
}

#[tokio::test]
async fn in_progress_orders_by_latest_read_then_series_name() {
    let pool = crate::pool::init_db("sqlite::memory:").await.unwrap();
    seed_series_library(&pool).await;
    let reader = seed_user(&pool, "reader").await;
    for (title, at) in [
        ("Gamma One", 3_000),
        ("Beta One", 1_000),
        ("Alpha One", 1_000),
    ] {
        place_position(&pool, reader, &uuid_by_title(&pool, title).await, 10, at).await;
    }

    let rows = listed(&pool, reader).await;

    assert_eq!(names(&rows), ["Gamma", "Alpha", "Beta"]);
}

#[tokio::test]
async fn in_progress_propagates_db_error_when_pool_is_closed() {
    let (pool, _guard) = seed_discovery_fixture().await;
    pool.close().await;

    assert!(matches!(
        in_progress(&pool, 1, &["/lib"]).await,
        Err(SeriesProgressError::Browse(_))
    ));
}

/// Hides Saga for each of `users`; returns its id.
async fn hide_saga_for(pool: &SqlitePool, users: &[i64]) -> i64 {
    let saga = series_id_by_name(pool, "Saga").await;
    for user in users {
        hide(pool, *user, saga).await.unwrap();
    }
    saga
}

async fn saga_book(pool: &SqlitePool) -> String {
    uuid_by_title(pool, "Saga: Book One").await
}

#[tokio::test]
async fn first_position_on_a_book_brings_its_series_back_for_that_reader_only() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let other = seed_user(&pool, "other").await;
    let saga = hide_saga_for(&pool, &[reader, other]).await;

    place_position(&pool, reader, &saga_book(&pool).await, 10, 1_000).await;

    assert!(!is_hidden(&pool, reader, saga).await.unwrap());
    assert!(is_hidden(&pool, other, saga).await.unwrap());
}

#[tokio::test]
async fn first_position_brings_back_the_series_a_book_is_moved_into_by_an_override() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let solo = uuid_by_title(&pool, "Standalone").await;
    let overrides = MetadataOverrides {
        series: Some("Pioneers".into()),
        series_index: Some("2".into()),
        ..Default::default()
    };
    upsert_metadata_overrides(&pool, &solo, &overrides, false, reader)
        .await
        .unwrap();
    let pioneers = series_id_by_name(&pool, "Pioneers").await;
    hide(&pool, reader, pioneers).await.unwrap();

    place_position(&pool, reader, &solo, 10, 1_000).await;

    assert!(!is_hidden(&pool, reader, pioneers).await.unwrap());
}

#[tokio::test]
async fn marking_reading_brings_the_series_back_from_unread_or_no_status() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let one = saga_book(&pool).await;
    let two = uuid_by_title(&pool, "Saga: Book Two").await;
    let saga = hide_saga_for(&pool, &[reader]).await;

    mark_status(&pool, reader, &one, ReadStatus::Reading).await;
    assert!(!is_hidden(&pool, reader, saga).await.unwrap(), "no status");

    hide(&pool, reader, saga).await.unwrap();
    mark_status(&pool, reader, &two, ReadStatus::Unread).await;
    assert!(
        is_hidden(&pool, reader, saga).await.unwrap(),
        "unread is not a start"
    );
    mark_status(&pool, reader, &two, ReadStatus::Reading).await;
    assert!(
        !is_hidden(&pool, reader, saga).await.unwrap(),
        "from unread"
    );
}

#[tokio::test]
async fn a_newer_device_status_of_reading_brings_the_series_back() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let one = saga_book(&pool).await;
    mark_status(&pool, reader, &one, ReadStatus::Unread).await;
    let saga = hide_saga_for(&pool, &[reader]).await;
    let mut tx = pool.begin().await.unwrap();

    let reading = SetReadStatus {
        book_uuid: one,
        status: ReadStatus::Reading,
    };
    set_read_status_at_tx(&mut tx, reader, &reading, i64::MAX / 2)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    assert!(!is_hidden(&pool, reader, saga).await.unwrap());
}

#[tokio::test]
async fn a_stale_device_status_leaves_the_series_hidden() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let one = saga_book(&pool).await;
    mark_status(&pool, reader, &one, ReadStatus::Unread).await;
    let saga = hide_saga_for(&pool, &[reader]).await;
    let mut tx = pool.begin().await.unwrap();

    let reading = SetReadStatus {
        book_uuid: one,
        status: ReadStatus::Reading,
    };
    // Older than the unread mark just written, so the write loses.
    set_read_status_at_tx(&mut tx, reader, &reading, 1_000)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    assert!(is_hidden(&pool, reader, saga).await.unwrap());
}

#[tokio::test]
async fn a_koreader_position_on_an_unread_book_brings_the_series_back() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let one = saga_book(&pool).await;
    mark_status(&pool, reader, &one, ReadStatus::Unread).await;
    let saga = hide_saga_for(&pool, &[reader]).await;
    let mut tx = pool.begin().await.unwrap();

    start_unread_at_tx(&mut tx, reader, &one, i64::MAX / 2)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    assert!(!is_hidden(&pool, reader, saga).await.unwrap());
}

#[tokio::test]
async fn continuing_or_finishing_a_book_leaves_the_series_hidden() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let one = saga_book(&pool).await;
    let two = uuid_by_title(&pool, "Saga: Book Two").await;
    place_position(&pool, reader, &one, 10, 1_000).await;
    let saga = hide_saga_for(&pool, &[reader]).await;

    place_position(&pool, reader, &one, 20, 2_000).await;
    mark_status(&pool, reader, &one, ReadStatus::Reading).await;
    mark_status(&pool, reader, &one, ReadStatus::Finished).await;
    // A reread is not a new book.
    mark_status(&pool, reader, &one, ReadStatus::Reading).await;
    // Finishing a book never started is not a start either.
    mark_status(&pool, reader, &two, ReadStatus::Finished).await;

    assert!(is_hidden(&pool, reader, saga).await.unwrap());
}

#[tokio::test]
async fn a_rolled_back_start_leaves_the_series_hidden() {
    let (pool, _guard) = seed_discovery_fixture().await;
    let reader = seed_user(&pool, "reader").await;
    let saga = hide_saga_for(&pool, &[reader]).await;
    let mut tx = pool.begin().await.unwrap();

    let reading = SetReadStatus {
        book_uuid: saga_book(&pool).await,
        status: ReadStatus::Reading,
    };
    crate::read_status::set_read_status_tx(&mut tx, reader, &reading)
        .await
        .unwrap();
    tx.rollback().await.unwrap();

    assert!(is_hidden(&pool, reader, saga).await.unwrap());
}
