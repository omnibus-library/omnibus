//! An unreadable `metadata_overrides.overrides` blob degrades to "no override"
//! in every taxonomy arm rather than failing it — and so never takes the
//! whole palette down — plus the genres arm's metadata-precedence gate.

use omnibus_shared::{Contributor, MetadataOverrides};
use sqlx::SqlitePool;

use super::super::*;
use crate::books::list_books;
use crate::metadata_overrides::upsert_metadata_overrides;
use crate::pool::init_db;
use crate::sync::replace_books;
use crate::test_support::{indexed, CoversTempDir};

/// One book by "Canonical Author" in "Canonical Saga", carrying an override
/// that renames both and adds a genre; returns its uuid.
async fn seed_overridden_book(pool: &SqlitePool) -> String {
    let user_id = crate::auth::create_user(pool, "admin", "securepassword1")
        .await
        .unwrap()
        .id;
    replace_books(
        pool,
        "/lib",
        vec![indexed(
            "a.epub",
            Some("Canonical Title"),
            &["Canonical Author"],
            &["Canonical Tag"],
            Some(("Canonical Saga", "1")),
            None,
        )],
    )
    .await
    .unwrap();
    let uuid = list_books(pool, "/lib").await.unwrap()[0]
        .unique_identifier
        .clone()
        .unwrap();
    let overrides = MetadataOverrides {
        creators: Some(vec![Contributor {
            name: "Override Author".into(),
            ..Default::default()
        }]),
        series: Some("Override Saga".into()),
        genres: Some(vec!["Override Genre".into()]),
        ..Default::default()
    };
    upsert_metadata_overrides(pool, &uuid, &overrides, false, user_id)
        .await
        .unwrap();
    uuid
}

async fn corrupt(pool: &SqlitePool) {
    sqlx::query("UPDATE metadata_overrides SET overrides = '{not json'")
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn search_authors_returns_the_canonical_author_past_a_corrupt_blob() {
    let _covers = CoversTempDir::new("palette_corrupt_authors");
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_overridden_book(&pool).await;
    corrupt(&pool).await;

    let hits = search_authors(&pool, "/lib", "%Author%", 5).await.unwrap();
    let names: Vec<_> = hits.iter().map(|h| h.name.as_str()).collect();
    assert_eq!(names, ["Canonical Author"]);
    assert_eq!(hits[0].lead_book_title.as_deref(), Some("Canonical Title"));
    assert_eq!(count_authors(&pool, "/lib", "%Author%").await.unwrap(), 1);
}

#[tokio::test]
async fn search_series_returns_the_canonical_series_past_a_corrupt_blob() {
    let _covers = CoversTempDir::new("palette_corrupt_series");
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_overridden_book(&pool).await;
    corrupt(&pool).await;

    let hits = search_series(&pool, "/lib", "%Canonical%", 5)
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].name, "Canonical Saga");
    assert_eq!(hits[0].book_count, 1);
    assert_eq!(hits[0].author_display.as_deref(), Some("Canonical Author"));
    assert_eq!(count_series(&pool, "/lib", "%Canonical%").await.unwrap(), 1);
}

#[tokio::test]
async fn search_genres_skips_a_corrupt_blob_rather_than_failing() {
    let _covers = CoversTempDir::new("palette_corrupt_genres");
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_overridden_book(&pool).await;
    corrupt(&pool).await;

    assert!(search_genres(&pool, "/lib", "%Genre%", 5)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(count_genres(&pool, "/lib", "%Genre%").await.unwrap(), 0);
}

#[tokio::test]
async fn search_palette_answers_with_a_corrupt_blob_present() {
    let _covers = CoversTempDir::new("palette_corrupt_whole");
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_overridden_book(&pool).await;
    corrupt(&pool).await;

    let results = search_palette(&pool, "/lib", "Canonical")
        .await
        .expect("one unreadable blob must not fail the palette");
    assert_eq!(results.authors[0].name, "Canonical Author");
    assert_eq!(results.series[0].name, "Canonical Saga");
    assert_eq!(results.tags[0].name, "Canonical Tag");
}

#[tokio::test]
async fn search_genres_ignores_override_genres_on_an_embedded_tags_first_root() {
    let _covers = CoversTempDir::new("palette_genres_precedence");
    let pool = init_db("sqlite::memory:").await.unwrap();
    seed_overridden_book(&pool).await;
    sqlx::query(
        "UPDATE scan_roots SET metadata_precedence = '[\"omnibus_overrides\",\"embedded_tags\"]'",
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(search_genres(&pool, "/lib", "%Genre%", 5)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(count_genres(&pool, "/lib", "%Genre%").await.unwrap(), 0);
}
