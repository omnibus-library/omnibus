//! Tests for hiding a series from a reader's home page.

use super::*;
use crate::test_support::*;

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
