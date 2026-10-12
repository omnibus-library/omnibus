//! Include/exclude filter clauses on the keyset page: values OR within a
//! clause, clauses AND together, an exclude keeps books with no value, names
//! match case-insensitively, and the set agrees with the smart-rule engine.

use std::collections::BTreeSet;

use omnibus_shared::FilterField::{Author, Format, Genre, Series, Tag};
use omnibus_shared::FilterMode::{Exclude, Include};
use omnibus_shared::{
    FilterClause, MatchMode, MetadataOverrides, RuleField, RuleOp, ShelfRule, SortDir, SortKey,
    ViewFilters,
};
use sqlx::SqlitePool;

use super::super::*;
use super::{insert_book_with_formats, insert_physical_copy, sorted_titles, titles};
use crate::pool::init_db;
use crate::sync::replace_books;
use crate::test_support::{indexed, seed_user, set_overrides_by_title, CoversTempDir};

/// Seven visible books under `/lib`:
/// - Saga One/Two/Three: Ada Lovelace, series Saga, EPUB, tag `sci-fi`
///   (One also `classic` and genre Fantasy).
/// - Other Story: Niklaus Wirth, series Pioneers, EPUB, tag `essay`, genre Mystery.
/// - Audio Tale: Grace Hopper, M4B, no tags, no series.
/// - Bare: PDF with no author, tag, series or genre.
/// - Shelf Copy: no files, one physical copy, no metadata at all.
async fn seed_filter_library() -> (SqlitePool, CoversTempDir) {
    let covers = CoversTempDir::new("page_clauses");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![
            indexed(
                "saga1.epub",
                Some("Saga One"),
                &["Ada Lovelace"],
                &["sci-fi", "classic"],
                Some(("Saga", "1")),
                None,
            ),
            indexed(
                "saga2.epub",
                Some("Saga Two"),
                &["Ada Lovelace"],
                &["sci-fi"],
                Some(("Saga", "2")),
                None,
            ),
            indexed(
                "saga3.epub",
                Some("Saga Three"),
                &["Ada Lovelace"],
                &["sci-fi"],
                Some(("Saga", "3")),
                None,
            ),
            indexed(
                "other.epub",
                Some("Other Story"),
                &["Niklaus Wirth"],
                &["essay"],
                Some(("Pioneers", "1")),
                None,
            ),
            indexed(
                "audio.m4b",
                Some("Audio Tale"),
                &["Grace Hopper"],
                &[],
                None,
                None,
            ),
            indexed("bare.pdf", Some("Bare"), &[], &[], None, None),
        ],
    )
    .await
    .unwrap();
    let lib = lib_id(&pool).await;
    let shelf_copy = insert_book_with_formats(&pool, lib, "Shelf Copy", &[]).await;
    insert_physical_copy(&pool, shelf_copy).await;

    let editor = seed_user(&pool, "editor").await;
    set_overrides_by_title(&pool, "Saga One", &genres_override(&["Fantasy"]), editor).await;
    set_overrides_by_title(&pool, "Other Story", &genres_override(&["Mystery"]), editor).await;
    (pool, covers)
}

async fn first_page(pool: &SqlitePool, filters: &ViewFilters) -> BookPage {
    list_books_page(
        pool,
        &["/lib"],
        SortKey::Title,
        SortDir::Asc,
        filters,
        Viewer::default(),
        &[],
        None,
        50,
    )
    .await
    .unwrap()
}

/// Titles of the first page under `clauses`, sorted for set comparison.
async fn titles_matching(pool: &SqlitePool, clauses: Vec<FilterClause>) -> Vec<String> {
    let filters = ViewFilters { clauses };
    sorted_titles(&first_page(pool, &filters).await)
}

async fn lib_id(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM scan_roots WHERE path = '/lib'")
        .fetch_one(pool)
        .await
        .unwrap()
}

fn subjects_override(subjects: &[&str]) -> MetadataOverrides {
    MetadataOverrides {
        subjects: Some(subjects.iter().map(|s| (*s).to_string()).collect()),
        ..Default::default()
    }
}

fn genres_override(genres: &[&str]) -> MetadataOverrides {
    MetadataOverrides {
        genres: Some(genres.iter().map(|g| (*g).to_string()).collect()),
        ..Default::default()
    }
}

/// What the first page and its count report under one clause.
struct PageMatch {
    titles: Vec<String>,
    uuids: BTreeSet<String>,
    count: i64,
}

async fn page_match(pool: &SqlitePool, clause: FilterClause) -> PageMatch {
    let filters = ViewFilters {
        clauses: vec![clause],
    };
    let page = first_page(pool, &filters).await;
    let count = count_books_page(pool, &["/lib"], &filters, Viewer::default(), &[])
        .await
        .unwrap();
    PageMatch {
        titles: sorted_titles(&page),
        uuids: page
            .books
            .iter()
            .filter_map(|b| b.unique_identifier.clone())
            .collect(),
        count,
    }
}

/// The uuids and match count the smart-rule engine reports for one rule.
async fn rule_uuids_and_matched(pool: &SqlitePool, rule: ShelfRule) -> (BTreeSet<String>, i64) {
    let preview = crate::preview_rule(pool, 0, MatchMode::Any, &[rule])
        .await
        .unwrap();
    let uuids = preview
        .sample
        .iter()
        .filter_map(|b| b.unique_identifier.clone())
        .collect();
    (uuids, preview.matched)
}

fn rule(field: RuleField, op: RuleOp, value: &str) -> ShelfRule {
    ShelfRule {
        field,
        op,
        value: value.into(),
    }
}

#[tokio::test]
async fn list_books_page_include_tag_keeps_books_with_any_listed_value() {
    let (pool, _covers) = seed_filter_library().await;

    let found = titles_matching(
        &pool,
        vec![FilterClause::new(Tag, Include, &["classic", "essay"])],
    )
    .await;

    assert_eq!(found, ["Other Story", "Saga One"]);
}

#[tokio::test]
async fn list_books_page_exclude_tag_keeps_only_books_without_a_listed_value() {
    let (pool, _covers) = seed_filter_library().await;

    let found = titles_matching(
        &pool,
        vec![FilterClause::new(Tag, Exclude, &["classic", "essay"])],
    )
    .await;

    assert_eq!(
        found,
        ["Audio Tale", "Bare", "Saga Three", "Saga Two", "Shelf Copy"]
    );
}

#[tokio::test]
async fn list_books_page_include_genre_keeps_books_with_any_listed_value() {
    let (pool, _covers) = seed_filter_library().await;

    let found = titles_matching(
        &pool,
        vec![FilterClause::new(Genre, Include, &["Fantasy", "Mystery"])],
    )
    .await;

    assert_eq!(found, ["Other Story", "Saga One"]);
}

#[tokio::test]
async fn list_books_page_exclude_genre_keeps_only_books_without_a_listed_value() {
    let (pool, _covers) = seed_filter_library().await;

    let found = titles_matching(&pool, vec![FilterClause::new(Genre, Exclude, &["Fantasy"])]).await;

    assert_eq!(
        found,
        [
            "Audio Tale",
            "Bare",
            "Other Story",
            "Saga Three",
            "Saga Two",
            "Shelf Copy"
        ]
    );
}

#[tokio::test]
async fn list_books_page_include_author_keeps_books_with_any_listed_value() {
    let (pool, _covers) = seed_filter_library().await;

    let found = titles_matching(
        &pool,
        vec![FilterClause::new(
            Author,
            Include,
            &["Grace Hopper", "Niklaus Wirth"],
        )],
    )
    .await;

    assert_eq!(found, ["Audio Tale", "Other Story"]);
}

#[tokio::test]
async fn list_books_page_exclude_author_keeps_only_books_without_a_listed_value() {
    let (pool, _covers) = seed_filter_library().await;

    let found = titles_matching(
        &pool,
        vec![FilterClause::new(
            Author,
            Exclude,
            &["Ada Lovelace", "Grace Hopper"],
        )],
    )
    .await;

    assert_eq!(found, ["Bare", "Other Story", "Shelf Copy"]);
}

#[tokio::test]
async fn list_books_page_include_series_keeps_books_with_any_listed_value() {
    let (pool, _covers) = seed_filter_library().await;

    let found = titles_matching(
        &pool,
        vec![FilterClause::new(Series, Include, &["Pioneers", "Saga"])],
    )
    .await;

    assert_eq!(found, ["Other Story", "Saga One", "Saga Three", "Saga Two"]);
}

#[tokio::test]
async fn list_books_page_exclude_series_keeps_only_books_without_a_listed_value() {
    let (pool, _covers) = seed_filter_library().await;

    let found = titles_matching(&pool, vec![FilterClause::new(Series, Exclude, &["Saga"])]).await;

    assert_eq!(found, ["Audio Tale", "Bare", "Other Story", "Shelf Copy"]);
}

#[tokio::test]
async fn list_books_page_include_format_keeps_books_with_any_listed_value() {
    let (pool, _covers) = seed_filter_library().await;

    let found = titles_matching(
        &pool,
        vec![FilterClause::new(Format, Include, &["m4b", "pdf"])],
    )
    .await;

    assert_eq!(found, ["Audio Tale", "Bare"]);
}

#[tokio::test]
async fn list_books_page_exclude_format_keeps_only_books_without_a_listed_value() {
    let (pool, _covers) = seed_filter_library().await;

    let found = titles_matching(
        &pool,
        vec![FilterClause::new(Format, Exclude, &["epub", "m4b"])],
    )
    .await;

    assert_eq!(found, ["Bare", "Shelf Copy"]);
}

#[tokio::test]
async fn list_books_page_intersects_clauses_across_fields() {
    let (pool, _covers) = seed_filter_library().await;

    let found = titles_matching(
        &pool,
        vec![
            FilterClause::new(Author, Include, &["Ada Lovelace"]),
            FilterClause::new(Tag, Exclude, &["classic"]),
        ],
    )
    .await;

    assert_eq!(found, ["Saga Three", "Saga Two"]);
}

#[tokio::test]
async fn list_books_page_matches_clause_values_case_insensitively() {
    let (pool, _covers) = seed_filter_library().await;

    let by_format =
        titles_matching(&pool, vec![FilterClause::new(Format, Include, &["epub"])]).await;
    let by_tag = titles_matching(&pool, vec![FilterClause::new(Tag, Include, &["SCI-FI"])]).await;

    assert_eq!(
        by_format,
        ["Other Story", "Saga One", "Saga Three", "Saga Two"]
    );
    assert_eq!(by_tag, ["Saga One", "Saga Three", "Saga Two"]);
}

#[tokio::test]
async fn list_books_page_include_tag_matches_the_smart_rule_on_that_tag() {
    let (pool, _covers) = seed_filter_library().await;
    let editor = seed_user(&pool, "tagger").await;
    set_overrides_by_title(&pool, "Audio Tale", &subjects_override(&["sci-fi"]), editor).await;
    set_overrides_by_title(&pool, "Saga Two", &subjects_override(&["classic"]), editor).await;

    let from_page = page_match(&pool, FilterClause::new(Tag, Include, &["sci-fi"])).await;
    let from_rule = rule_uuids_and_matched(&pool, rule(RuleField::Tag, RuleOp::Is, "sci-fi")).await;

    assert_eq!(from_page.titles, ["Audio Tale", "Saga One", "Saga Three"]);
    assert_eq!((from_page.uuids, from_page.count), from_rule);
}

#[tokio::test]
async fn list_books_page_include_genre_matches_the_smart_rule_on_that_genre() {
    let (pool, _covers) = seed_filter_library().await;

    let from_page = page_match(&pool, FilterClause::new(Genre, Include, &["Fantasy"])).await;
    let from_rule =
        rule_uuids_and_matched(&pool, rule(RuleField::Genre, RuleOp::Is, "Fantasy")).await;

    assert_eq!(from_page.titles, ["Saga One"]);
    assert_eq!((from_page.uuids, from_page.count), from_rule);
}

#[tokio::test]
async fn list_books_page_exclude_genre_matches_the_is_not_smart_rule() {
    let (pool, _covers) = seed_filter_library().await;

    let from_page = page_match(&pool, FilterClause::new(Genre, Exclude, &["Fantasy"])).await;
    let from_rule =
        rule_uuids_and_matched(&pool, rule(RuleField::Genre, RuleOp::IsNot, "Fantasy")).await;

    assert_eq!(from_page.count, 6);
    assert_eq!((from_page.uuids, from_page.count), from_rule);
}

#[tokio::test]
async fn list_books_page_keeps_the_filter_past_the_first_page() {
    let (pool, _covers) = seed_filter_library().await;
    let filters = ViewFilters {
        clauses: vec![FilterClause::new(Tag, Exclude, &["essay"])],
    };

    let mut walked = Vec::new();
    let mut cursor: Option<PageCursor> = None;
    loop {
        let page = list_books_page(
            &pool,
            &["/lib"],
            SortKey::Title,
            SortDir::Asc,
            &filters,
            Viewer::default(),
            &[],
            cursor.as_ref(),
            2,
        )
        .await
        .unwrap();
        walked.extend(titles(&page));
        match page.next {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }

    walked.sort();
    assert_eq!(
        walked,
        [
            "Audio Tale",
            "Bare",
            "Saga One",
            "Saga Three",
            "Saga Two",
            "Shelf Copy"
        ]
    );
}

#[tokio::test]
async fn count_books_page_counts_only_books_matching_the_clauses() {
    let (pool, _covers) = seed_filter_library().await;
    let filters = ViewFilters {
        clauses: vec![FilterClause::new(Tag, Exclude, &["sci-fi"])],
    };

    let count = count_books_page(&pool, &["/lib"], &filters, Viewer::default(), &[])
        .await
        .unwrap();

    assert_eq!(count, 4, "Audio Tale, Bare, Other Story and Shelf Copy");
}

#[tokio::test]
async fn list_books_page_stacked_stacks_only_members_matching_the_filter() {
    let (pool, _covers) = seed_filter_library().await;
    let filters = ViewFilters {
        clauses: vec![FilterClause::new(Tag, Exclude, &["classic"])],
    };

    let page = list_books_page_stacked(
        &pool,
        &["/lib"],
        SortKey::Title,
        SortDir::Asc,
        &filters,
        Viewer::default(),
        &[],
        None,
        50,
        Projection::Full,
    )
    .await
    .unwrap();

    assert_eq!(page.stacks.len(), 1);
    assert_eq!(page.stacks[0].name, "Saga");
    assert_eq!(
        page.stacks[0]
            .members
            .iter()
            .filter_map(|m| m.title.as_deref())
            .collect::<Vec<_>>(),
        ["Saga Two", "Saga Three"]
    );
    let on_page: Vec<_> = page
        .books
        .iter()
        .filter_map(|b| b.title.as_deref())
        .collect();
    assert!(!on_page.contains(&"Saga One"));
}
