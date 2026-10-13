//! Offline bookmark creates, deletes, and the temp-to-server remap.

use omnibus_shared::CreateBookmark;

use super::*;

fn create_bookmark(uuid: &str) -> CreateBookmark {
    CreateBookmark {
        client_id: None,
        book_uuid: uuid.to_string(),
        position: "epubcfi(/6/4!/4/2/1:0)".into(),
        title: Some("Chapter 1".into()),
    }
}

#[tokio::test]
async fn queue_create_bookmark_synthesizes_temp_record_and_caches_it() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    let created = queue_create_bookmark(&create_bookmark("outbox-book-3"))
        .await
        .expect("queued");
    assert!(created.id < 0, "offline creates carry negative temp ids");
    assert_eq!(created.book_uuid, "outbox-book-3");

    let cached: Vec<omnibus_shared::Bookmark> =
        cache::get_json(&cache::keys::bookmarks("outbox-book-3"))
            .await
            .expect("cached list");
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].id, created.id);

    let st = store::store().expect("store");
    let ops = st.ops_list().await;
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0].kind, "CreateBookmark");
    clear_ops().await;
}

#[tokio::test]
async fn deleting_a_temp_bookmark_cancels_its_create_and_edits() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    let created = queue_create_bookmark(&create_bookmark("outbox-book-4"))
        .await
        .expect("queued");
    assert!(queue_update_bookmark(created.id, Some("Renamed".into())).await);

    // The rename actually patched the cached record before the cancel wipes it.
    let renamed: Vec<omnibus_shared::Bookmark> =
        cache::get_json(&cache::keys::bookmarks("outbox-book-4"))
            .await
            .expect("cached list");
    assert_eq!(renamed[0].title.as_deref(), Some("Renamed"));

    assert!(queue_delete_bookmark(created.id).await);

    // Everything referencing the temp id vanished — no server op needed.
    let st = store::store().expect("store");
    assert_eq!(st.ops_count().await, 0);
    let cached: Vec<omnibus_shared::Bookmark> =
        cache::get_json(&cache::keys::bookmarks("outbox-book-4"))
            .await
            .unwrap_or_default();
    assert!(cached.is_empty());
}

#[tokio::test]
async fn bookmark_remapped_replaces_the_temp_record_with_the_server_copy() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    let temp = omnibus_shared::Bookmark {
        id: -11,
        book_uuid: "outbox-book-5".into(),
        position: "epubcfi(/6/4!/4/2/1:0)".into(),
        title: None,
        created_at: 1,
        created_at_iso: None,
        spine_index: None,
        chapter_title: None,
        percent_through_book: None,
        client_id: None,
    };
    apply::bookmark_created(&temp).await;

    let real = omnibus_shared::Bookmark {
        id: 501,
        book_uuid: "outbox-book-5".into(),
        position: "epubcfi(/6/4!/4/2/1:0)".into(),
        title: Some("Server title".into()),
        created_at: 2,
        created_at_iso: None,
        spine_index: None,
        chapter_title: None,
        percent_through_book: None,
        client_id: None,
    };
    apply::bookmark_remapped(-11, &real).await;

    let cached: Vec<omnibus_shared::Bookmark> =
        cache::get_json(&cache::keys::bookmarks("outbox-book-5"))
            .await
            .expect("cached list");
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].id, 501);
    assert_eq!(cached[0].title.as_deref(), Some("Server title"));
}
