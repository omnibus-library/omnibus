//! Offline highlight creates, deletes, and the temp-to-server remap.

use omnibus_shared::{CreateHighlight, HighlightColor};

use super::*;

#[tokio::test]
async fn queue_create_highlight_synthesizes_temp_record_and_caches_it() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    let input = CreateHighlight {
        client_id: None,
        book_uuid: "outbox-book-1".into(),
        epub_cfi_range: "epubcfi(/6/4!/4/2,/1:0,/1:5)".into(),
        color: HighlightColor::Green,
        text: Some("a passage".into()),
    };
    let created = queue_create_highlight(&input).await.expect("queued");
    assert!(created.id < 0, "offline creates carry negative temp ids");
    assert_eq!(created.book_uuid, "outbox-book-1");

    // Optimistically visible in the cached list.
    let cached: Vec<omnibus_shared::Highlight> =
        cache::get_json(&cache::keys::highlights("outbox-book-1"))
            .await
            .expect("cached list");
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].id, created.id);

    // And queued for drain.
    let st = store::store().expect("store");
    let ops = st.ops_list().await;
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0].kind, "CreateHighlight");
    clear_ops().await;
}

#[tokio::test]
async fn deleting_a_temp_highlight_cancels_its_create_and_edits() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    let input = CreateHighlight {
        client_id: None,
        book_uuid: "outbox-book-2".into(),
        epub_cfi_range: "epubcfi(/6/4!/4/2,/1:0,/1:5)".into(),
        color: HighlightColor::Amber,
        text: None,
    };
    let created = queue_create_highlight(&input).await.expect("queued");
    assert!(queue_update_highlight_color(created.id, HighlightColor::Rose).await);
    assert!(queue_delete_highlight(created.id).await);

    // Everything referencing the temp id vanished — no server op needed.
    let st = store::store().expect("store");
    assert_eq!(st.ops_count().await, 0);
    let cached: Vec<omnibus_shared::Highlight> =
        cache::get_json(&cache::keys::highlights("outbox-book-2"))
            .await
            .unwrap_or_default();
    assert!(cached.is_empty());
}

#[tokio::test]
async fn highlight_remapped_replaces_the_temp_record_with_the_server_copy() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    let temp = omnibus_shared::Highlight {
        id: -13,
        book_uuid: "outbox-book-9".into(),
        epub_cfi_range: Some("epubcfi(/6/4!/4/2,/1:0,/1:5)".into()),
        color: HighlightColor::Blue,
        note: None,
        text: None,
        created_at: 1,
        created_at_iso: None,
        spine_index: None,
        chapter_title: None,
        percent_through_book: None,
        client_id: None,
    };
    apply::highlight_created(&temp).await;

    let real = omnibus_shared::Highlight {
        id: 901,
        ..temp.clone()
    };
    apply::highlight_remapped(-13, &real).await;

    let cached: Vec<omnibus_shared::Highlight> =
        cache::get_json(&cache::keys::highlights("outbox-book-9"))
            .await
            .expect("cached list");
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].id, 901);
}
