//! Direct-query coverage for effective tag and genre membership SQL.

use omnibus_shared::{MetadataOverrides, MetadataSource};
use sqlx::SqlitePool;

use crate::books::list_books;
use crate::metadata_overrides::upsert_metadata_overrides;
use crate::pool::init_db;
use crate::sync::replace_books;
use crate::test_support::{indexed, CoversTempDir};

macro_rules! replace_one_book {
    ($pool:expr) => {
        replace_books(
            $pool,
            "/lib",
            vec![indexed(
                "a.epub",
                Some("A"),
                &["Author"],
                &["Canonical Tag"],
                None,
                None,
            )],
        )
        .await
        .unwrap()
    };
}

async fn book_identity(pool: &SqlitePool) -> (String, i64) {
    let books = list_books(pool, "/lib").await.unwrap();
    (books[0].unique_identifier.clone().unwrap(), books[0].id)
}

async fn write_overrides(pool: &SqlitePool, uuid: &str, overrides: &MetadataOverrides) {
    let user_id = crate::auth::create_user(pool, "admin", "securepassword1")
        .await
        .unwrap()
        .id;
    upsert_metadata_overrides(pool, uuid, overrides, false, user_id)
        .await
        .unwrap();
}

async fn set_embedded_tags_first(pool: &SqlitePool) {
    crate::settings::set_metadata_precedence(
        pool,
        "/lib",
        &[
            MetadataSource::FolderStructure,
            MetadataSource::OmnibusOverrides,
            MetadataSource::OpfSidecar,
            MetadataSource::EmbeddedTags,
            MetadataSource::ProviderMatch,
        ],
    )
    .await
    .unwrap();
}

fn subjects(values: &[&str]) -> MetadataOverrides {
    MetadataOverrides {
        subjects: Some(values.iter().map(|value| (*value).to_string()).collect()),
        ..Default::default()
    }
}

fn genres(values: &[&str]) -> MetadataOverrides {
    MetadataOverrides {
        genres: Some(values.iter().map(|value| (*value).to_string()).collect()),
        ..Default::default()
    }
}

#[tokio::test]
async fn effective_tags_returns_the_canonical_link_when_the_book_has_no_subjects_override() {
    // Given.
    let _covers = CoversTempDir::new("effective_tags_canonical");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_one_book!(&pool);
    let (_, book_id) = book_identity(&pool).await;
    let tag_id = sqlx::query_scalar("SELECT id FROM tags WHERE name = 'Canonical Tag'")
        .fetch_one(&pool)
        .await
        .unwrap();

    // When.
    let rows = sqlx::query_as::<_, (i64, i64)>(concat!(
        "SELECT book_id, tag_id FROM (",
        effective_tags_sql!(),
        ") ORDER BY book_id, tag_id"
    ))
    .fetch_all(&pool)
    .await
    .unwrap();

    // Then.
    assert_eq!(rows, vec![(book_id, tag_id)]);
}

#[tokio::test]
async fn effective_tags_replaces_the_canonical_links_when_a_subjects_override_is_present() {
    // Given.
    let _covers = CoversTempDir::new("effective_tags_replace");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_one_book!(&pool);
    let (uuid, book_id) = book_identity(&pool).await;
    write_overrides(&pool, &uuid, &subjects(&["Override Tag"])).await;
    let tag_id = sqlx::query_scalar("SELECT id FROM tags WHERE name = 'Override Tag'")
        .fetch_one(&pool)
        .await
        .unwrap();

    // When.
    let rows = sqlx::query_as::<_, (i64, i64)>(concat!(
        "SELECT book_id, tag_id FROM (",
        effective_tags_sql!(),
        ") ORDER BY book_id, tag_id"
    ))
    .fetch_all(&pool)
    .await
    .unwrap();

    // Then.
    assert_eq!(rows, vec![(book_id, tag_id)]);
}

#[tokio::test]
async fn effective_tags_returns_nothing_when_a_subjects_override_is_an_empty_array() {
    // Given.
    let _covers = CoversTempDir::new("effective_tags_empty");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_one_book!(&pool);
    let (uuid, _) = book_identity(&pool).await;
    write_overrides(&pool, &uuid, &subjects(&[])).await;

    // When.
    let rows = sqlx::query_as::<_, (i64, i64)>(concat!(
        "SELECT book_id, tag_id FROM (",
        effective_tags_sql!(),
        ")"
    ))
    .fetch_all(&pool)
    .await
    .unwrap();

    // Then.
    assert!(rows.is_empty());
}

#[tokio::test]
async fn effective_tags_ignores_an_override_on_an_embedded_tags_first_root() {
    // Given.
    let _covers = CoversTempDir::new("effective_tags_precedence");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_one_book!(&pool);
    let (uuid, book_id) = book_identity(&pool).await;
    write_overrides(&pool, &uuid, &subjects(&["Override Tag"])).await;
    set_embedded_tags_first(&pool).await;
    let tag_id = sqlx::query_scalar("SELECT id FROM tags WHERE name = 'Canonical Tag'")
        .fetch_one(&pool)
        .await
        .unwrap();

    // When.
    let rows = sqlx::query_as::<_, (i64, i64)>(concat!(
        "SELECT book_id, tag_id FROM (",
        effective_tags_sql!(),
        ") ORDER BY book_id, tag_id"
    ))
    .fetch_all(&pool)
    .await
    .unwrap();

    // Then.
    assert_eq!(rows, vec![(book_id, tag_id)]);
}

#[tokio::test]
async fn effective_tags_tolerates_a_corrupt_overrides_blob() {
    // Given.
    let _covers = CoversTempDir::new("effective_tags_corrupt");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_one_book!(&pool);
    let (uuid, book_id) = book_identity(&pool).await;
    sqlx::query("INSERT INTO metadata_overrides (book_uuid, overrides) VALUES (?, ?)")
        .bind(uuid)
        .bind("{ not valid json")
        .execute(&pool)
        .await
        .unwrap();
    let tag_id = sqlx::query_scalar("SELECT id FROM tags WHERE name = 'Canonical Tag'")
        .fetch_one(&pool)
        .await
        .unwrap();

    // When.
    let rows = sqlx::query_as::<_, (i64, i64)>(concat!(
        "SELECT book_id, tag_id FROM (",
        effective_tags_sql!(),
        ") ORDER BY book_id, tag_id"
    ))
    .fetch_all(&pool)
    .await
    .unwrap();

    // Then.
    assert_eq!(rows, vec![(book_id, tag_id)]);
}

#[tokio::test]
async fn effective_tags_resolves_an_override_subject_to_its_tags_row_case_insensitively() {
    // Given.
    let _covers = CoversTempDir::new("effective_tags_case");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_one_book!(&pool);
    let (uuid, book_id) = book_identity(&pool).await;
    write_overrides(&pool, &uuid, &subjects(&["canonical tag"])).await;
    let tag_id = sqlx::query_scalar("SELECT id FROM tags WHERE name = 'Canonical Tag'")
        .fetch_one(&pool)
        .await
        .unwrap();

    // When.
    let rows = sqlx::query_as::<_, (i64, i64)>(concat!(
        "SELECT book_id, tag_id FROM (",
        effective_tags_sql!(),
        ") ORDER BY book_id, tag_id"
    ))
    .fetch_all(&pool)
    .await
    .unwrap();

    // Then.
    assert_eq!(rows, vec![(book_id, tag_id)]);
}

#[tokio::test]
async fn effective_genres_returns_override_genres_resolved_to_a_genres_row() {
    // Given.
    let _covers = CoversTempDir::new("effective_genres_override");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_one_book!(&pool);
    let (uuid, book_id) = book_identity(&pool).await;
    write_overrides(&pool, &uuid, &genres(&["Horror"])).await;
    let genre_id = sqlx::query_scalar("SELECT id FROM genres WHERE name = 'Horror'")
        .fetch_one(&pool)
        .await
        .unwrap();

    // When.
    let rows = sqlx::query_as::<_, (i64, i64)>(concat!(
        "SELECT book_id, genre_id FROM (",
        effective_genres_sql!(),
        ") ORDER BY book_id, genre_id"
    ))
    .fetch_all(&pool)
    .await
    .unwrap();

    // Then.
    assert_eq!(rows, vec![(book_id, genre_id)]);
}

#[tokio::test]
async fn effective_genres_returns_nothing_for_a_book_with_no_genres_override() {
    // Given.
    let _covers = CoversTempDir::new("effective_genres_missing");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_one_book!(&pool);

    // When.
    let rows = sqlx::query_as::<_, (i64, i64)>(concat!(
        "SELECT book_id, genre_id FROM (",
        effective_genres_sql!(),
        ")"
    ))
    .fetch_all(&pool)
    .await
    .unwrap();

    // Then.
    assert!(rows.is_empty());
}

#[tokio::test]
async fn effective_genres_ignores_an_override_on_an_embedded_tags_first_root() {
    // Given.
    let _covers = CoversTempDir::new("effective_genres_precedence");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_one_book!(&pool);
    let (uuid, _) = book_identity(&pool).await;
    write_overrides(&pool, &uuid, &genres(&["Horror"])).await;
    set_embedded_tags_first(&pool).await;

    // When.
    let rows = sqlx::query_as::<_, (i64, i64)>(concat!(
        "SELECT book_id, genre_id FROM (",
        effective_genres_sql!(),
        ")"
    ))
    .fetch_all(&pool)
    .await
    .unwrap();

    // Then.
    assert!(rows.is_empty());
}

#[tokio::test]
async fn effective_tags_keeps_the_canonical_links_when_the_subjects_override_is_json_null() {
    // Given: a blob no Rust writer produces (serde skips a `None`), but one a
    // hand edit or a foreign client could — `null` deserializes to `None`,
    // so the read path treats it as no override at all.
    let _covers = CoversTempDir::new("effective_tags_json_null");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_one_book!(&pool);
    let (uuid, book_id) = book_identity(&pool).await;
    sqlx::query("INSERT INTO metadata_overrides (book_uuid, overrides) VALUES (?, ?)")
        .bind(uuid)
        .bind(r#"{"subjects": null}"#)
        .execute(&pool)
        .await
        .unwrap();
    let tag_id = sqlx::query_scalar("SELECT id FROM tags WHERE name = 'Canonical Tag'")
        .fetch_one(&pool)
        .await
        .unwrap();

    // When.
    let rows = sqlx::query_as::<_, (i64, i64)>(concat!(
        "SELECT book_id, tag_id FROM (",
        effective_tags_sql!(),
        ") ORDER BY book_id, tag_id"
    ))
    .fetch_all(&pool)
    .await
    .unwrap();

    // Then.
    assert_eq!(rows, vec![(book_id, tag_id)]);
}

#[tokio::test]
async fn effective_genres_returns_nothing_when_the_genres_override_is_json_null() {
    // Given.
    let _covers = CoversTempDir::new("effective_genres_json_null");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_one_book!(&pool);
    let (uuid, _) = book_identity(&pool).await;
    sqlx::query("INSERT INTO metadata_overrides (book_uuid, overrides) VALUES (?, ?)")
        .bind(uuid)
        .bind(r#"{"genres": null}"#)
        .execute(&pool)
        .await
        .unwrap();

    // When.
    let rows = sqlx::query_as::<_, (i64, i64)>(concat!(
        "SELECT book_id, genre_id FROM (",
        effective_genres_sql!(),
        ")"
    ))
    .fetch_all(&pool)
    .await
    .unwrap();

    // Then.
    assert!(rows.is_empty());
}
