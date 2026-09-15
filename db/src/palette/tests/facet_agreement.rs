//! The count on a clicked facet row and the count on the page it opens must
//! come from one rule. They are computed by different queries — the tags arm
//! counts effective members, the books arm filters on effective membership —
//! so nothing but a test keeps them from drifting apart again.

use super::super::*;
use crate::books::search_books_with_total;
use crate::pool::init_db;
use crate::sync::replace_books;
use crate::test_support::{indexed, CoversTempDir};

#[tokio::test]
async fn palette_tag_row_count_equals_the_search_total_for_its_facet_query() {
    let _covers = CoversTempDir::new("facet_agreement");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![
            indexed("a.epub", Some("A"), &["X"], &["Dark"], None, None),
            indexed("b.epub", Some("B"), &["Y"], &["Dark"], None, None),
            // The near-miss that used to inflate the page: a longer tag the
            // facet's name is a prefix of.
            indexed("c.epub", Some("C"), &["Z"], &["Dark academia"], None, None),
        ],
    )
    .await
    .unwrap();

    let row = search_palette(&pool, "/lib", "Dark")
        .await
        .unwrap()
        .tags
        .into_iter()
        .find(|t| t.name == "Dark")
        .expect("the clicked row");

    let page = search_palette(&pool, "/lib", "tag:Dark").await.unwrap();
    assert_eq!(
        page.book_total, row.book_count,
        "the page must report the number the row promised"
    );

    let (_, rest_total) = search_books_with_total(&pool, "/lib", "tag:Dark")
        .await
        .unwrap();
    assert_eq!(
        u32::try_from(rest_total).unwrap(),
        row.book_count,
        "the REST surface must answer the same question as the palette"
    );
    assert_eq!(row.book_count, 2, "only the two books carrying the tag");
}

/// The palette's books arm has its own facet SQL (`faceted_books_sql`), so the
/// two #2533 boundaries are pinned here as well as on the REST path: a facet
/// is the whole tag name, not a prefix of a longer one and not two adjacent
/// tags that spell it when joined.
#[tokio::test]
async fn search_palette_tag_facet_returns_only_books_carrying_that_exact_tag() {
    let _covers = CoversTempDir::new("palette_facet_boundaries");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![
            indexed("a.epub", Some("A"), &["W"], &["Dark"], None, None),
            indexed("b.epub", Some("B"), &["X"], &["Dark academia"], None, None),
            indexed(
                "c.epub",
                Some("C"),
                &["Y"],
                &["Science", "Fiction"],
                None,
                None,
            ),
            indexed(
                "d.epub",
                Some("D"),
                &["Z"],
                &["Science Fiction"],
                None,
                None,
            ),
        ],
    )
    .await
    .unwrap();

    let titles = |books: &[omnibus_shared::PaletteBookHit]| -> Vec<String> {
        books.iter().map(|b| b.title.clone()).collect()
    };

    let prefix = search_palette(&pool, "/lib", "tag:Dark").await.unwrap();
    assert_eq!(titles(&prefix.books), vec!["A".to_string()]);
    assert_eq!(prefix.book_total, 1);

    let joined = search_palette(&pool, "/lib", "tag:\"Science Fiction\"")
        .await
        .unwrap();
    assert_eq!(titles(&joined.books), vec!["D".to_string()]);
    assert_eq!(joined.book_total, 1);
}

/// A tag added in the app is membership for the palette's books arm too, and
/// a facet mixed with free text still ranks through FTS while filtering
/// relationally.
#[tokio::test]
async fn search_palette_tag_facet_finds_an_override_tag_alone_and_with_free_text() {
    let _covers = CoversTempDir::new("palette_facet_override_mixed");
    let pool = init_db("sqlite::memory:").await.unwrap();
    replace_books(
        &pool,
        "/lib",
        vec![
            indexed("a.epub", Some("Alpha Quest"), &["X"], &[], None, None),
            indexed("b.epub", Some("Beta Quest"), &["Y"], &[], None, None),
        ],
    )
    .await
    .unwrap();
    let user_id = crate::auth::create_user(&pool, "admin", "securepassword1")
        .await
        .unwrap()
        .id;
    let uuid = crate::books::list_books(&pool, "/lib")
        .await
        .unwrap()
        .iter()
        .find(|b| b.title.as_deref() == Some("Alpha Quest"))
        .and_then(|b| b.unique_identifier.clone())
        .expect("seeded book");
    crate::metadata_overrides::upsert_metadata_overrides(
        &pool,
        &uuid,
        &omnibus_shared::MetadataOverrides {
            subjects: Some(vec!["Exandria".to_string()]),
            ..Default::default()
        },
        false,
        user_id,
    )
    .await
    .unwrap();

    let alone = search_palette(&pool, "/lib", "tag:Exandria").await.unwrap();
    assert_eq!(alone.books.len(), 1);
    assert_eq!(alone.books[0].title, "Alpha Quest");
    assert_eq!(alone.book_total, 1);

    let mixed = search_palette(&pool, "/lib", "tag:Exandria quest")
        .await
        .unwrap();
    assert_eq!(
        mixed.books.len(),
        1,
        "free text matches both, the facet keeps one"
    );
    assert_eq!(mixed.books[0].title, "Alpha Quest");
    assert_eq!(mixed.book_total, 1);

    let none = search_palette(&pool, "/lib", "tag:Exandria beta")
        .await
        .unwrap();
    assert!(
        none.books.is_empty(),
        "the facet and the free text name different books"
    );
    assert_eq!(none.book_total, 0);
}
