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
