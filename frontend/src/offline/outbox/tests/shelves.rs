//! Offline shelf writes patching the cached list, detail, and member pages.

use super::*;

#[tokio::test]
async fn queue_create_shelf_uses_cached_identity_for_owner_fields() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    cache::put_json(
        &cache::keys::me(),
        &omnibus_shared::UserSummary {
            id: 7,
            username: "elena".into(),
            is_admin: false,
            can_upload: true,
            can_edit: true,
            can_download: true,
            kindle_email: None,
            display_name: None,
            has_avatar: false,
            hidden_formats: Vec::new(),
            book_detail_scroll_stops: false,
            stack_series: false,
            share_stats: true,
        },
    );
    let req = omnibus_shared::CreateShelfRequest {
        kind: omnibus_shared::ShelfKind::Manual,
        name: "Cozy".into(),
        description: None,
        visibility: omnibus_shared::Visibility::Private,
        match_mode: None,
        rules: vec![],
        book_uuids: vec!["u1".into(), "u2".into()],
    };
    let shelf = queue_create_shelf(&req).await.expect("queued");
    assert!(shelf.id < 0);
    assert_eq!(shelf.owner_username, "elena");
    assert_eq!(shelf.book_count, 2);

    let listed: Vec<omnibus_shared::ShelfSummary> = cache::get_json(&cache::keys::shelves())
        .await
        .expect("shelves cached");
    assert!(listed.iter().any(|s| s.id == shelf.id && s.name == "Cozy"));
    clear_ops().await;
}

fn test_shelf(id: i64, name: &str, book_count: i64) -> omnibus_shared::Shelf {
    omnibus_shared::Shelf {
        id,
        owner_user_id: 1,
        owner_username: "elena".into(),
        owner_has_avatar: false,
        kind: omnibus_shared::ShelfKind::Manual,
        name: name.to_string(),
        description: None,
        visibility: omnibus_shared::Visibility::Private,
        accent: None,
        match_mode: None,
        rules: vec![],
        book_count,
        sync_to_kobo: false,
    }
}

fn test_shelf_summary(id: i64, name: &str, book_count: i64) -> omnibus_shared::ShelfSummary {
    omnibus_shared::ShelfSummary {
        id,
        owner_user_id: 1,
        owner_username: "elena".into(),
        owner_has_avatar: false,
        kind: omnibus_shared::ShelfKind::Manual,
        name: name.to_string(),
        visibility: omnibus_shared::Visibility::Private,
        accent: None,
        book_count,
        cover_uuids: Vec::new(),
    }
}

#[tokio::test]
async fn shelf_update_patches_the_cached_detail_and_list_entry() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    cache::put_json(
        &cache::keys::shelves(),
        &vec![test_shelf_summary(20, "Old", 0)],
    );
    cache::put_json(&cache::keys::shelf(20), &test_shelf(20, "Old", 0));

    let req = omnibus_shared::UpdateShelfRequest {
        name: Some("New".into()),
        description: Some("A cozy pile".into()),
        visibility: Some(omnibus_shared::Visibility::Public),
        match_mode: None,
        rules: None,
        sync_to_kobo: None,
    };
    let patched = queue_update_shelf(20, &req).await.expect("queued");
    assert_eq!(patched.name, "New");
    assert_eq!(patched.description.as_deref(), Some("A cozy pile"));
    assert_eq!(patched.visibility, omnibus_shared::Visibility::Public);

    let detail: omnibus_shared::Shelf = cache::get_json(&cache::keys::shelf(20))
        .await
        .expect("cached detail");
    assert_eq!(detail.name, "New");

    let list: Vec<omnibus_shared::ShelfSummary> = cache::get_json(&cache::keys::shelves())
        .await
        .expect("cached list");
    assert_eq!(list[0].name, "New");
    assert_eq!(list[0].visibility, omnibus_shared::Visibility::Public);
    clear_ops().await;
}

#[tokio::test]
async fn shelf_delete_removes_the_list_detail_and_page_rows() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    cache::put_json(
        &cache::keys::shelves(),
        &vec![test_shelf_summary(30, "Gone Soon", 1)],
    );
    cache::put_json(&cache::keys::shelf(30), &test_shelf(30, "Gone Soon", 1));
    cache::put_json(
        &cache::keys::shelf_page(30, "title", "asc", ""),
        &omnibus_shared::ShelfPage { books: vec![] },
    );

    assert!(queue_delete_shelf(30).await);

    let list: Vec<omnibus_shared::ShelfSummary> = cache::get_json(&cache::keys::shelves())
        .await
        .expect("cached list");
    assert!(list.is_empty());
    let detail: Option<omnibus_shared::Shelf> = cache::get_json(&cache::keys::shelf(30)).await;
    assert!(detail.is_none());
    let st = store::store().expect("store");
    assert!(st.kv_prefix("shelf_page:30:").await.is_empty());
    clear_ops().await;
}

#[tokio::test]
async fn shelf_books_added_appends_matching_replica_books_and_bumps_counts() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    cache::put_json(
        &cache::keys::shelves(),
        &vec![test_shelf_summary(40, "Reading", 0)],
    );
    cache::put_json(&cache::keys::shelf(40), &test_shelf(40, "Reading", 0));
    cache::put_json(
        &cache::keys::ebooks_all(),
        &vec![omnibus_shared::EbookMetadata {
            id: 1,
            unique_identifier: Some("uuid-a".into()),
            ..Default::default()
        }],
    );
    cache::put_json(
        &cache::keys::shelf_page(40, "title", "asc", ""),
        &omnibus_shared::ShelfPage { books: vec![] },
    );

    assert!(queue_add_shelf_books(40, &["uuid-a".to_string()]).await);

    let list: Vec<omnibus_shared::ShelfSummary> = cache::get_json(&cache::keys::shelves())
        .await
        .expect("cached list");
    assert_eq!(list[0].book_count, 1);
    let detail: omnibus_shared::Shelf = cache::get_json(&cache::keys::shelf(40))
        .await
        .expect("cached detail");
    assert_eq!(detail.book_count, 1);
    let page: omnibus_shared::ShelfPage =
        cache::get_json(&cache::keys::shelf_page(40, "title", "asc", ""))
            .await
            .expect("cached page");
    assert_eq!(page.books.len(), 1);
    assert_eq!(page.books[0].unique_identifier.as_deref(), Some("uuid-a"));
    clear_ops().await;
}

#[tokio::test]
async fn shelf_book_removed_drops_the_book_from_cached_pages_and_decrements_count() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    cache::put_json(
        &cache::keys::shelves(),
        &vec![test_shelf_summary(50, "Reading", 1)],
    );
    cache::put_json(&cache::keys::shelf(50), &test_shelf(50, "Reading", 1));
    cache::put_json(
        &cache::keys::shelf_page(50, "title", "asc", ""),
        &omnibus_shared::ShelfPage {
            books: vec![omnibus_shared::EbookMetadata {
                id: 1,
                unique_identifier: Some("uuid-a".into()),
                ..Default::default()
            }],
        },
    );

    assert!(queue_remove_shelf_book(50, "uuid-a").await);

    let list: Vec<omnibus_shared::ShelfSummary> = cache::get_json(&cache::keys::shelves())
        .await
        .expect("cached list");
    assert_eq!(list[0].book_count, 0);
    let detail: omnibus_shared::Shelf = cache::get_json(&cache::keys::shelf(50))
        .await
        .expect("cached detail");
    assert_eq!(detail.book_count, 0);
    let page: omnibus_shared::ShelfPage =
        cache::get_json(&cache::keys::shelf_page(50, "title", "asc", ""))
            .await
            .expect("cached page");
    assert!(page.books.is_empty());
    clear_ops().await;
}

#[tokio::test]
async fn shelf_remapped_moves_the_detail_and_page_rows_to_the_real_id() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    cache::put_json(
        &cache::keys::shelves(),
        &vec![test_shelf_summary(-9, "Cozy", 1)],
    );
    cache::put_json(&cache::keys::shelf(-9), &test_shelf(-9, "Cozy", 1));
    cache::put_json(
        &cache::keys::shelf_page(-9, "title", "asc", ""),
        &omnibus_shared::ShelfPage { books: vec![] },
    );

    let real = test_shelf(600, "Cozy", 1);
    apply::shelf_remapped(-9, &real).await;

    let list: Vec<omnibus_shared::ShelfSummary> = cache::get_json(&cache::keys::shelves())
        .await
        .expect("cached list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, 600);

    let old_detail: Option<omnibus_shared::Shelf> = cache::get_json(&cache::keys::shelf(-9)).await;
    assert!(old_detail.is_none());
    let new_detail: omnibus_shared::Shelf = cache::get_json(&cache::keys::shelf(600))
        .await
        .expect("cached detail");
    assert_eq!(new_detail.id, 600);

    let st = store::store().expect("store");
    assert!(st.kv_prefix("shelf_page:-9:").await.is_empty());
    let renamed = st.kv_prefix("shelf_page:600:").await;
    assert_eq!(renamed.len(), 1);
    clear_ops().await;
}
