//! Tests for the bibliographic fields a Kobo sync row carries beyond the
//! title: every author in position order and the series, overrides applied.

use super::*;
use crate::test_support::{indexed, seed_indexed_ebook};

#[tokio::test]
async fn book_for_sync_carries_every_author_in_position_order() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let uuid = seed_indexed_ebook(
        &pool,
        indexed(
            "omens.epub",
            Some("Good Omens"),
            &["Terry Pratchett", "Neil Gaiman"],
            &[],
            None,
            None,
        ),
    )
    .await;

    let row = book_for_sync(&pool, &uuid).await.unwrap().unwrap();

    assert_eq!(row.authors, vec!["Terry Pratchett", "Neil Gaiman"]);
}

async fn override_series(
    pool: &SqlitePool,
    uuid: &str,
    user: i64,
    series: &str,
    index: Option<&str>,
) {
    upsert_metadata_overrides(
        pool,
        uuid,
        &MetadataOverrides {
            series: Some(series.into()),
            series_index: index.map(Into::into),
            ..Default::default()
        },
        false,
        user,
    )
    .await
    .unwrap();
}

#[test]
fn kobo_series_new_derives_a_stable_id_from_the_normalized_name() {
    let id = KoboSeries::new("The Expanse".into(), None).id;

    assert_eq!(id, "17a975b6-3a16-5b73-8aad-82cde885aedc");
    assert_eq!(KoboSeries::new("the  EXPANSE".into(), Some(3.0)).id, id);
    assert_ne!(KoboSeries::new("Expanse".into(), None).id, id);
}

#[test]
fn kobo_series_new_id_ignores_the_cross_format_match_key() {
    let plain = KoboSeries::new("Mistborn Era 1".into(), None).id;

    assert_ne!(KoboSeries::new("Mistborn: Era 1".into(), None).id, plain);
    assert_ne!(KoboSeries::new("Mistbörn Era 1".into(), None).id, plain);
}

#[tokio::test]
async fn book_for_sync_carries_the_series_the_web_shows_with_its_index() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let uuid = seed_indexed_ebook(
        &pool,
        indexed(
            "leviathan.epub",
            Some("Leviathan Wakes"),
            &["James S. A. Corey"],
            &[],
            Some(("The Expanse", "2")),
            None,
        ),
    )
    .await;
    let aardvark: i64 = sqlx::query_scalar(
        "INSERT INTO series (name, sort) VALUES ('Aardvark Omnibus', 'Aardvark Omnibus') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO books_series_link (book, series) SELECT id, ? FROM books WHERE uuid = ?",
    )
    .bind(aardvark)
    .bind(&uuid)
    .execute(&pool)
    .await
    .unwrap();

    let series = book_for_sync(&pool, &uuid)
        .await
        .unwrap()
        .unwrap()
        .series
        .unwrap();

    assert_eq!(series.name, "Aardvark Omnibus");
    assert_eq!(series.index, Some(2.0));
}

#[tokio::test]
async fn book_for_sync_has_no_series_for_a_book_in_none() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let uuid = seed_indexed_ebook(
        &pool,
        indexed("standalone.epub", Some("A Book"), &["An Author"], &[], None, None),
    )
    .await;

    let row = book_for_sync(&pool, &uuid).await.unwrap().unwrap();

    assert_eq!(row.series, None);
}

#[tokio::test]
async fn book_for_sync_applies_a_series_override_and_drops_a_cleared_series() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = make_user(&pool, "editor").await;
    let uuid = seed_indexed_ebook(
        &pool,
        indexed(
            "leviathan.epub",
            Some("Leviathan Wakes"),
            &["James S. A. Corey"],
            &[],
            Some(("The Expanse", "2")),
            None,
        ),
    )
    .await;

    override_series(&pool, &uuid, user, "Renamed Saga", Some("4.5")).await;
    let series = book_for_sync(&pool, &uuid)
        .await
        .unwrap()
        .unwrap()
        .series
        .unwrap();
    assert_eq!(series.name, "Renamed Saga");
    assert_eq!(series.index, Some(4.5));
    assert_eq!(series.id, KoboSeries::new("Renamed Saga".into(), None).id);

    override_series(&pool, &uuid, user, "", None).await;
    let row = book_for_sync(&pool, &uuid).await.unwrap().unwrap();
    assert_eq!(row.series, None);
}

#[tokio::test]
async fn book_for_sync_keeps_the_stored_series_index_when_only_the_series_name_is_overridden() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = make_user(&pool, "editor").await;
    let uuid = seed_indexed_ebook(
        &pool,
        indexed("leviathan.epub", Some("A Book"), &["An Author"], &[], None, None),
    )
    .await;
    sqlx::query("UPDATE books SET series_index = 2 WHERE uuid = ?")
        .bind(&uuid)
        .execute(&pool)
        .await
        .unwrap();

    override_series(&pool, &uuid, user, "The Expanse", None).await;
    // The override saved the link too; drop it so the name comes from the override alone.
    sqlx::query("DELETE FROM books_series_link WHERE book = (SELECT id FROM books WHERE uuid = ?)")
        .bind(&uuid)
        .execute(&pool)
        .await
        .unwrap();
    let series = book_for_sync(&pool, &uuid)
        .await
        .unwrap()
        .unwrap()
        .series
        .unwrap();

    assert_eq!(series.name, "The Expanse");
    assert_eq!(series.index, Some(2.0));
}
