//! Shelf writes against cached pages keyed by a filter.

use super::*;

const HORROR_FILTER: &str = r#"[{"field":"tag","mode":"include","values":["horror"]}]"#;

fn shelf_member(uuid: &str) -> omnibus_shared::EbookMetadata {
    omnibus_shared::EbookMetadata {
        id: 1,
        unique_identifier: Some(uuid.into()),
        ..Default::default()
    }
}

#[tokio::test]
async fn shelf_books_added_drops_filtered_shelf_page_variants() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let unfiltered = cache::keys::shelf_page(41, "title", "asc", "");
    let filtered = cache::keys::shelf_page(41, "title", "asc", HORROR_FILTER);
    cache::put_json(&cache::keys::ebooks_all(), &vec![shelf_member("uuid-a")]);
    cache::put_json(&unfiltered, &omnibus_shared::ShelfPage { books: vec![] });
    cache::put_json(&filtered, &omnibus_shared::ShelfPage { books: vec![] });

    apply::shelf_books_added(41, &["uuid-a".to_string()]).await;

    let patched: omnibus_shared::ShelfPage =
        cache::get_json(&unfiltered).await.expect("unfiltered page");
    assert_eq!(patched.books.len(), 1);
    let dropped: Option<omnibus_shared::ShelfPage> = cache::get_json(&filtered).await;
    assert!(dropped.is_none(), "an add can't be shown under a filter");
}

#[tokio::test]
async fn shelf_books_added_drops_filtered_variants_when_the_replica_lacks_the_books() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let filtered = cache::keys::shelf_page(42, "title", "asc", HORROR_FILTER);
    cache::put_json(
        &cache::keys::ebooks_all(),
        &Vec::<omnibus_shared::EbookMetadata>::new(),
    );
    cache::put_json(&filtered, &omnibus_shared::ShelfPage { books: vec![] });

    apply::shelf_books_added(42, &["uuid-unknown".to_string()]).await;

    let dropped: Option<omnibus_shared::ShelfPage> = cache::get_json(&filtered).await;
    assert!(
        dropped.is_none(),
        "a stale filtered page must not outlive the add"
    );
}

#[tokio::test]
async fn shelf_book_removed_patches_filtered_shelf_page_variants_too() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let filtered = cache::keys::shelf_page(51, "title", "asc", HORROR_FILTER);
    cache::put_json(
        &filtered,
        &omnibus_shared::ShelfPage {
            books: vec![shelf_member("uuid-a"), shelf_member("uuid-b")],
        },
    );

    apply::shelf_book_removed(51, "uuid-a").await;

    let page: omnibus_shared::ShelfPage = cache::get_json(&filtered).await.expect("filtered page");
    let uuids: Vec<_> = page
        .books
        .iter()
        .filter_map(|b| b.unique_identifier.as_deref())
        .collect();
    assert_eq!(uuids, vec!["uuid-b"]);
}

const FORMAT_FILTER: &str = r#"[{"field":"format","mode":"include","values":["epub"]}]"#;

fn shelf_filter(shelf_id: i64) -> String {
    format!(r#"[{{"field":"shelf","mode":"include","values":["{shelf_id}"]}}]"#)
}

struct FilteredPages {
    first_page_by_shelf: String,
    shelf_page_by_other_shelf: String,
    first_page_by_format: String,
}

async fn is_cached(key: &str) -> bool {
    cache::get_json::<u8>(key).await.is_some()
}

async fn seed_filtered_pages(shelf_id: i64) -> FilteredPages {
    let pages = FilteredPages {
        first_page_by_shelf: cache::keys::ebooks_first("title", "asc", &shelf_filter(shelf_id), ""),
        shelf_page_by_other_shelf: cache::keys::shelf_page(
            shelf_id + 1000,
            "title",
            "asc",
            &shelf_filter(shelf_id + 1000),
        ),
        first_page_by_format: cache::keys::ebooks_first("title", "asc", FORMAT_FILTER, ""),
    };
    for key in [
        &pages.first_page_by_shelf,
        &pages.shelf_page_by_other_shelf,
        &pages.first_page_by_format,
    ] {
        cache::put_json(key, &1_u8);
    }
    pages
}

async fn assert_only_shelf_filtered_pages_dropped(pages: &FilteredPages) {
    assert!(!is_cached(&pages.first_page_by_shelf).await);
    assert!(!is_cached(&pages.shelf_page_by_other_shelf).await);
    assert!(is_cached(&pages.first_page_by_format).await);
}

#[tokio::test]
async fn shelf_books_added_drops_pages_filtered_by_any_shelf() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let pages = seed_filtered_pages(60).await;

    apply::shelf_books_added(60, &["uuid-a".to_string()]).await;

    assert_only_shelf_filtered_pages_dropped(&pages).await;
}

#[tokio::test]
async fn shelf_book_removed_drops_pages_filtered_by_any_shelf() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let pages = seed_filtered_pages(61).await;

    apply::shelf_book_removed(61, "uuid-a").await;

    assert_only_shelf_filtered_pages_dropped(&pages).await;
}

#[tokio::test]
async fn shelf_deleted_drops_pages_filtered_by_any_shelf() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let pages = seed_filtered_pages(62).await;

    apply::shelf_deleted(62).await;

    assert_only_shelf_filtered_pages_dropped(&pages).await;
}
