//! `search_books`: tag and genre facets resolved through effective membership
//! rather than the FTS `tags` column, which joins names into one string and so
//! cannot answer an exact-membership question. Covers the boundary cases that
//! join hid, the facet-only query shape, and the override-sourced tag.

use crate::metadata_overrides::upsert_metadata_overrides;
use crate::pool::init_db;
use crate::sync::replace_books;
use crate::test_support::{indexed, CoversTempDir};

use super::super::*;

/// Titles of the hits for `q`, in the order the search returned them.
async fn hit_titles(pool: &sqlx::SqlitePool, q: &str) -> Vec<String> {
    search_books(pool, "/lib", q)
        .await
        .unwrap()
        .iter()
        .filter_map(|b| b.title.clone())
        .collect()
}

/// Replace the subject list on the book titled `title` through the override
/// door, which is how a reader adds a tag in the app.
async fn set_subjects(pool: &sqlx::SqlitePool, title: &str, subjects: &[&str], user_id: i64) {
    let books = crate::books::list_books(pool, "/lib").await.unwrap();
    let uuid = books
        .iter()
        .find(|b| b.title.as_deref() == Some(title))
        .and_then(|b| b.unique_identifier.clone())
        .expect("seeded book");
    upsert_metadata_overrides(
        pool,
        &uuid,
        &omnibus_shared::MetadataOverrides {
            subjects: Some(subjects.iter().map(|s| (*s).to_string()).collect()),
            ..Default::default()
        },
        false,
        user_id,
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn search_books_tag_facet_excludes_a_book_whose_only_tag_is_a_longer_name() {
    let _covers = CoversTempDir::new("facet_prefix");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![
            indexed("a.epub", Some("A"), &["X"], &["Dark"], None, None),
            indexed("b.epub", Some("B"), &["Y"], &["Dark academia"], None, None),
        ],
    )
    .await
    .unwrap();

    assert_eq!(
        hit_titles(&pool, "tag:Dark").await,
        vec!["A".to_string()],
        "a facet names one tag exactly, so a longer tag containing it must not match"
    );
}

#[tokio::test]
async fn search_books_tag_facet_excludes_a_book_whose_two_tags_concatenate_to_the_facet_name() {
    let _covers = CoversTempDir::new("facet_concat");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![
            indexed(
                "c.epub",
                Some("C"),
                &["X"],
                &["Science", "Fiction"],
                None,
                None,
            ),
            indexed(
                "d.epub",
                Some("D"),
                &["Y"],
                &["Science Fiction"],
                None,
                None,
            ),
        ],
    )
    .await
    .unwrap();

    assert_eq!(
        hit_titles(&pool, "tag:\"Science Fiction\"").await,
        vec!["D".to_string()],
        "two adjacent tags are not the one tag their names spell when joined"
    );
}

#[tokio::test]
async fn search_books_returns_rows_and_a_correct_total_for_a_facet_only_query() {
    let _covers = CoversTempDir::new("facet_only");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![
            indexed("a.epub", Some("A"), &["X"], &["Dark"], None, None),
            indexed("b.epub", Some("B"), &["Y"], &["history"], None, None),
        ],
    )
    .await
    .unwrap();

    // No free-text term at all, so there is no FTS expression to MATCH on.
    let (hits, total) = search_books_with_total(&pool, "/lib", "tag:Dark")
        .await
        .expect("a facet-only query must not reach an empty MATCH");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title.as_deref(), Some("A"));
    assert_eq!(total, 1);
}

#[tokio::test]
async fn search_books_tag_facet_finds_a_book_whose_tag_came_from_an_override() {
    let _covers = CoversTempDir::new("facet_override_tag");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![indexed("a.epub", Some("A"), &["X"], &[], None, None)],
    )
    .await
    .unwrap();
    let user_id = crate::auth::create_user(&pool, "admin", "securepassword1")
        .await
        .unwrap()
        .id;
    set_subjects(&pool, "A", &["Exandria"], user_id).await;

    assert_eq!(
        hit_titles(&pool, "tag:Exandria").await,
        vec!["A".to_string()],
        "a tag added in the app is membership, so its facet must return the book"
    );
}

#[tokio::test]
async fn search_books_tag_facet_drops_a_book_after_its_override_tag_is_removed() {
    let _covers = CoversTempDir::new("facet_override_cleared");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![indexed("a.epub", Some("A"), &["X"], &[], None, None)],
    )
    .await
    .unwrap();
    let user_id = crate::auth::create_user(&pool, "admin", "securepassword1")
        .await
        .unwrap()
        .id;
    set_subjects(&pool, "A", &["Exandria"], user_id).await;
    set_subjects(&pool, "A", &[], user_id).await;

    assert!(
        hit_titles(&pool, "tag:Exandria").await.is_empty(),
        "clearing the override clears the membership it created"
    );
}

#[tokio::test]
async fn search_books_free_text_does_not_match_a_tag_name() {
    let _covers = CoversTempDir::new("facet_free_text_scope");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![indexed("a.epub", Some("A"), &["X"], &["Dark"], None, None)],
    )
    .await
    .unwrap();

    assert!(
        hit_titles(&pool, "Dark").await.is_empty(),
        "free text stays scoped to {{title authors series}}"
    );
}

#[tokio::test]
async fn search_books_two_tag_facets_require_both_memberships() {
    let _covers = CoversTempDir::new("facet_two_tags");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![
            indexed(
                "a.epub",
                Some("A"),
                &["X"],
                &["Dark", "history"],
                None,
                None,
            ),
            indexed("b.epub", Some("B"), &["Y"], &["Dark"], None, None),
        ],
    )
    .await
    .unwrap();

    assert_eq!(
        hit_titles(&pool, "tag:Dark tag:history").await,
        vec!["A".to_string()],
        "facets AND together, so carrying one of the two is not a match"
    );
}

/// The public count runs its own SQL with its own facet-only branch and bind
/// order, so it has to be pinned against the hit list separately: for a
/// facet-only query, a mixed query, and the near-miss both must exclude.
#[tokio::test]
async fn count_search_books_agrees_with_the_hit_total_for_facet_queries() {
    let _covers = CoversTempDir::new("facet_count_agreement");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![
            indexed("a.epub", Some("Alpha"), &["X"], &["Dark"], None, None),
            indexed("b.epub", Some("Beta"), &["Y"], &["Dark"], None, None),
            indexed(
                "c.epub",
                Some("Gamma"),
                &["Z"],
                &["Dark academia"],
                None,
                None,
            ),
        ],
    )
    .await
    .unwrap();

    for (query, expected) in [("tag:Dark", 2), ("tag:Dark alpha", 1), ("tag:Nope", 0)] {
        let count = count_search_books(&pool, "/lib", query).await.unwrap();
        let (_, total) = search_books_with_total(&pool, "/lib", query).await.unwrap();
        assert_eq!(count, expected, "count for {query:?}");
        assert_eq!(count, total, "count and hit total disagree for {query:?}");
    }
}
