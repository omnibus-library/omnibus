//! Offline journal creates, edits, deletes, the temp-to-server remap, and the HTML fallback.

use omnibus_shared::CreateJournalEntry;

use super::*;

fn create_journal(uuid: &str) -> CreateJournalEntry {
    CreateJournalEntry {
        client_id: None,
        book_uuid: uuid.to_string(),
        body_md: "Loved this chapter".into(),
        progress: Some(42),
        status: omnibus_shared::JournalStatus::Published,
    }
}

#[tokio::test]
async fn queue_create_journal_synthesizes_temp_record_and_caches_it() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    cache::put_json(
        &cache::keys::me(),
        &omnibus_shared::UserSummary {
            id: 8,
            username: "marcus".into(),
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

    let created = queue_create_journal(&create_journal("outbox-book-6"))
        .await
        .expect("queued");
    assert!(created.id < 0, "offline creates carry negative temp ids");
    assert_eq!(created.author_name, "marcus");
    assert_eq!(created.body_html, "<p>Loved this chapter</p>");

    let cached: Vec<omnibus_shared::JournalEntry> =
        cache::get_json(&cache::keys::journals("outbox-book-6"))
            .await
            .expect("cached list");
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].id, created.id);

    let st = store::store().expect("store");
    let ops = st.ops_list().await;
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0].kind, "CreateJournal");
    clear_ops().await;
}

#[tokio::test]
async fn deleting_a_temp_journal_entry_cancels_its_create_and_edits() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    let created = queue_create_journal(&create_journal("outbox-book-7"))
        .await
        .expect("queued");

    let update = omnibus_shared::UpdateJournalEntry {
        body_md: "Edited thoughts".into(),
        progress: Some(55),
        status: Some(omnibus_shared::JournalStatus::Draft),
    };
    let patched = queue_update_journal(created.id, &update)
        .await
        .expect("patched");
    assert_eq!(patched.body_md, "Edited thoughts");
    assert_eq!(patched.progress, Some(55));
    assert_eq!(patched.status, omnibus_shared::JournalStatus::Draft);

    assert!(queue_delete_journal(created.id).await);

    // Everything referencing the temp id vanished — no server op needed.
    let st = store::store().expect("store");
    assert_eq!(st.ops_count().await, 0);
    let cached: Vec<omnibus_shared::JournalEntry> =
        cache::get_json(&cache::keys::journals("outbox-book-7"))
            .await
            .unwrap_or_default();
    assert!(cached.is_empty());
}

#[tokio::test]
async fn journal_remapped_replaces_the_temp_record_with_the_server_copy() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    let temp = omnibus_shared::JournalEntry {
        id: -21,
        book_uuid: "outbox-book-8".into(),
        author_id: 8,
        author_name: "marcus".into(),
        author_has_avatar: false,
        body_md: "draft".into(),
        body_html: "<p>draft</p>".into(),
        progress: None,
        status: omnibus_shared::JournalStatus::Published,
        created_at: 1,
        updated_at: 1,
        created_at_iso: None,
        updated_at_iso: None,
        client_id: None,
    };
    apply::journal_created(&temp).await;

    let real = omnibus_shared::JournalEntry {
        id: 801,
        ..temp.clone()
    };
    apply::journal_remapped(-21, &real).await;

    let cached: Vec<omnibus_shared::JournalEntry> =
        cache::get_json(&cache::keys::journals("outbox-book-8"))
            .await
            .expect("cached list");
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].id, 801);
}

#[test]
fn fallback_html_escapes_and_paragraphs() {
    let html = fallback_html("Loved <this> & that\n\nSecond\nline");
    assert_eq!(
        html,
        "<p>Loved &lt;this&gt; &amp; that</p><p>Second<br>line</p>"
    );
}
