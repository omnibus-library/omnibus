//! The `*_for_paths` arms, which accept a slice of library paths (the
//! single-path helpers just forward `&[library_path]`): each seeds three
//! libraries, scopes the call to a two-path subset, and asserts the third
//! library's rows are excluded.

use super::super::*;
use crate::pool::init_db;
use crate::sync::replace_books;
use crate::test_support::{indexed, CoversTempDir};

// Each `*_for_paths` arm accepts a slice of library paths (the single-path
// helpers above just forward `&[library_path]`); these seed three distinct
// libraries and scope each call to a two-path subset, asserting the third
// library's rows are excluded.
#[tokio::test]
async fn search_palette_for_paths_scopes_to_given_library_paths() {
    let _covers = CoversTempDir::new("for_paths_palette");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib-a",
        vec![indexed(
            "a.epub",
            Some("Shared Alpha"),
            &["Author"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-b",
        vec![indexed(
            "b.epub",
            Some("Shared Beta"),
            &["Author"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-c",
        vec![indexed(
            "c.epub",
            Some("Shared Gamma"),
            &["Author"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();

    let results = search_palette_for_paths(&pool, &["/lib-a", "/lib-b"], "Shared")
        .await
        .unwrap();
    let titles: Vec<&str> = results.books.iter().map(|b| b.title.as_str()).collect();
    assert!(titles.contains(&"Shared Alpha"));
    assert!(titles.contains(&"Shared Beta"));
    assert!(
        !titles.contains(&"Shared Gamma"),
        "book from the unlisted /lib-c must not appear, got {titles:?}"
    );
}

#[tokio::test]
async fn search_authors_for_paths_scopes_to_given_library_paths() {
    let _covers = CoversTempDir::new("for_paths_authors");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib-a",
        vec![indexed(
            "a.epub",
            Some("A"),
            &["Match Author"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-b",
        vec![indexed(
            "b.epub",
            Some("B"),
            &["Match Author"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-c",
        vec![indexed(
            "c.epub",
            Some("C"),
            &["Match Author"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();

    let hits = search_authors_for_paths(&pool, &["/lib-a", "/lib-b"], "%match%", LIMIT)
        .await
        .unwrap();
    assert_eq!(hits.len(), 1, "one author, aggregated across the two paths");
    assert_eq!(
        hits[0].book_count, 2,
        "count should include /lib-a and /lib-b but not /lib-c"
    );
}

#[tokio::test]
async fn count_authors_for_paths_counts_across_given_library_paths() {
    let _covers = CoversTempDir::new("for_paths_count_authors");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib-a",
        vec![indexed(
            "a.epub",
            Some("A"),
            &["Match One"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-b",
        vec![indexed(
            "b.epub",
            Some("B"),
            &["Match Two"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-c",
        vec![indexed(
            "c.epub",
            Some("C"),
            &["Match Three"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();

    let total = count_authors_for_paths(&pool, &["/lib-a", "/lib-b"], "%match%")
        .await
        .unwrap();
    assert_eq!(total, 2, "should count /lib-a and /lib-b but not /lib-c");
}

#[tokio::test]
async fn search_books_for_paths_scopes_to_given_library_paths() {
    let _covers = CoversTempDir::new("for_paths_books");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib-a",
        vec![indexed(
            "a.epub",
            Some("Quest Alpha"),
            &["Author"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-b",
        vec![indexed(
            "b.epub",
            Some("Quest Beta"),
            &["Author"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-c",
        vec![indexed(
            "c.epub",
            Some("Quest Gamma"),
            &["Author"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();

    let (hits, total) = search_books_for_paths(&pool, &["/lib-a", "/lib-b"], "quest", LIMIT)
        .await
        .unwrap();
    assert_eq!(total, 2, "match total scoped to /lib-a and /lib-b");
    let titles: Vec<&str> = hits.iter().map(|b| b.title.as_str()).collect();
    assert!(titles.contains(&"Quest Alpha"));
    assert!(titles.contains(&"Quest Beta"));
    assert!(!titles.contains(&"Quest Gamma"));
}

#[tokio::test]
async fn search_series_for_paths_scopes_to_given_library_paths() {
    let _covers = CoversTempDir::new("for_paths_series");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib-a",
        vec![indexed(
            "a.epub",
            Some("A"),
            &["Author"],
            &[],
            Some(("Match Series", "1")),
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-b",
        vec![indexed(
            "b.epub",
            Some("B"),
            &["Author"],
            &[],
            Some(("Match Series", "2")),
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-c",
        vec![indexed(
            "c.epub",
            Some("C"),
            &["Author"],
            &[],
            Some(("Match Series", "3")),
            None,
        )],
    )
    .await
    .unwrap();

    let hits = search_series_for_paths(&pool, &["/lib-a", "/lib-b"], "%match%", LIMIT)
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(
        hits[0].book_count, 2,
        "count should include /lib-a and /lib-b but not /lib-c"
    );
}

#[tokio::test]
async fn count_series_for_paths_counts_across_given_library_paths() {
    let _covers = CoversTempDir::new("for_paths_count_series");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib-a",
        vec![indexed(
            "a.epub",
            Some("A"),
            &["X"],
            &[],
            Some(("Match Alpha", "1")),
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-b",
        vec![indexed(
            "b.epub",
            Some("B"),
            &["X"],
            &[],
            Some(("Match Beta", "1")),
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-c",
        vec![indexed(
            "c.epub",
            Some("C"),
            &["X"],
            &[],
            Some(("Match Gamma", "1")),
            None,
        )],
    )
    .await
    .unwrap();

    let total = count_series_for_paths(&pool, &["/lib-a", "/lib-b"], "%match%")
        .await
        .unwrap();
    assert_eq!(total, 2, "should count /lib-a and /lib-b but not /lib-c");
}

#[tokio::test]
async fn search_tags_for_paths_scopes_to_given_library_paths() {
    let _covers = CoversTempDir::new("for_paths_tags");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib-a",
        vec![indexed(
            "a.epub",
            Some("A"),
            &["Author"],
            &["Match Tag"],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-b",
        vec![indexed(
            "b.epub",
            Some("B"),
            &["Author"],
            &["Match Tag"],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-c",
        vec![indexed(
            "c.epub",
            Some("C"),
            &["Author"],
            &["Match Tag"],
            None,
            None,
        )],
    )
    .await
    .unwrap();

    let hits = search_tags_for_paths(&pool, &["/lib-a", "/lib-b"], "%match%", LIMIT)
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(
        hits[0].book_count, 2,
        "count should include /lib-a and /lib-b but not /lib-c"
    );
}

#[tokio::test]
async fn count_tags_for_paths_counts_across_given_library_paths() {
    let _covers = CoversTempDir::new("for_paths_count_tags");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib-a",
        vec![indexed(
            "a.epub",
            Some("A"),
            &["X"],
            &["Match One"],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-b",
        vec![indexed(
            "b.epub",
            Some("B"),
            &["X"],
            &["Match Two"],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    replace_books(
        &pool,
        "/lib-c",
        vec![indexed(
            "c.epub",
            Some("C"),
            &["X"],
            &["Match Three"],
            None,
            None,
        )],
    )
    .await
    .unwrap();

    let total = count_tags_for_paths(&pool, &["/lib-a", "/lib-b"], "%match%")
        .await
        .unwrap();
    assert_eq!(total, 2, "should count /lib-a and /lib-b but not /lib-c");
}

#[tokio::test]
async fn search_palette_authors_match_a_name_typed_without_its_diacritics() {
    let _covers = CoversTempDir::new("palette_authors_folded");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![indexed(
            "a.epub",
            Some("Fortunata y Jacinta"),
            &["Benito Pérez Galdós"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();

    let results = search_palette(&pool, "/lib", "Perez Galdos").await.unwrap();
    assert_eq!(
        results.authors.first().map(|a| a.name.as_str()),
        Some("Benito Pérez Galdós"),
        "a reader who omits the accents must still reach the author"
    );
    assert_eq!(
        results.author_total, 1,
        "the total must agree with the row it counted"
    );
}

#[tokio::test]
async fn search_palette_authors_still_match_an_accented_name_when_name_norm_is_null() {
    let _covers = CoversTempDir::new("palette_authors_null_norm");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![indexed(
            "a.epub",
            Some("Fortunata y Jacinta"),
            &["Benito Pérez Galdós"],
            &[],
            None,
            None,
        )],
    )
    .await
    .unwrap();
    sqlx::query("UPDATE authors SET name_norm = NULL")
        .execute(&pool)
        .await
        .unwrap();

    // Typed with its accents: the folded pattern would miss the raw name, so
    // only the raw-pattern fallback can answer this — the pre-fold behaviour.
    let results = search_palette(&pool, "/lib", "Pérez").await.unwrap();
    assert_eq!(
        results.authors.first().map(|a| a.name.as_str()),
        Some("Benito Pérez Galdós"),
        "a row the backfill has not reached yet matches on its raw name"
    );
    assert_eq!(results.author_total, 1, "the count takes the same fallback");
}

#[tokio::test]
async fn search_palette_series_still_matches_an_accented_name_typed_with_its_accents() {
    let _covers = CoversTempDir::new("palette_series_accented");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![indexed(
            "a.epub",
            Some("First"),
            &["Author"],
            &[],
            Some(("Éclair", "1")),
            None,
        )],
    )
    .await
    .unwrap();

    // The LIKE pattern is built once in `palette::search_palette_for_paths`
    // and shared by every arm, so folding it there would break the four arms
    // that still match raw names.
    let results = search_palette(&pool, "/lib", "Éclair").await.unwrap();
    assert_eq!(
        results.series.first().map(|s| s.name.as_str()),
        Some("Éclair")
    );
}
