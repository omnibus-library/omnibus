//! Account-switch regression tests for `note_user`: the wipe over
//! `USER_SCOPED_PREFIXES` must not also erase the fresh `"me"` row the
//! switch itself is keyed on, and must reach every per-reader row.

// Held across awaits to serialize against other offline test modules' use of
// the same process-global store; safe since each test owns its own thread + runtime.
#![allow(clippy::await_holding_lock)]

use omnibus_shared::UserSummary;

use crate::offline::cache;
use crate::offline::store;
use crate::offline::sync::test_state_lock;

use super::*;

fn user(id: i64, username: &str) -> UserSummary {
    UserSummary {
        id,
        username: username.into(),
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
    }
}

#[tokio::test]
async fn note_user_preserves_fresh_me_row_across_account_switch() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let st = store::store().expect("test store");

    let old_user = user(1, "note-user-switch-old");
    let new_user = user(2, "note-user-switch-new");
    let progress_key = cache::keys::progress("note-user-switch-book", "epub");

    // Baseline: "old_user" was previously signed in, with some replicated
    // data and a queued mutation of theirs still pending.
    st.meta_put("last_user", old_user.username.clone());
    cache::put_json(&cache::keys::me(), &old_user);
    cache::put_json(&progress_key, &12.0_f64);
    st.ops_append("test-switch-op", "{}".into(), None);

    // Mirror `get_me`'s real sequence: the network-first read caches the
    // fresh identity for the *new* user before `note_user` ever runs.
    cache::put_json(&cache::keys::me(), &new_user);
    note_user(&new_user).await;

    // AC1: the new user's "me" row survived the account-switch wipe — a
    // reader doesn't need a second network fetch to see it.
    let cached_me: Option<UserSummary> = cache::get_json(&cache::keys::me()).await;
    assert_eq!(cached_me, Some(new_user.clone()));

    // AC2: the old user's other replicated data and queued op are still
    // wiped exactly as before.
    let cached_progress: Option<f64> = cache::get_json(&progress_key).await;
    assert_eq!(cached_progress, None);
    assert!(st.ops_list().await.is_empty());

    // The switch is recorded against the new user.
    assert_eq!(
        st.meta_get("last_user").await.as_deref(),
        Some(new_user.username.as_str())
    );
}

#[tokio::test]
async fn note_user_wipes_a_cached_first_page_filtered_by_a_shelf_across_account_switch() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let st = store::store().expect("test store");

    let old_user = user(3, "note-user-first-page-old");
    let new_user = user(4, "note-user-first-page-new");
    let first_page_key = cache::keys::ebooks_first(
        "title",
        "asc",
        r#"[{"field":"shelf","mode":"include","values":["7"]}]"#,
        "",
    );
    st.meta_put("last_user", old_user.username.clone());
    cache::put_json(&first_page_key, &12.0_f64);

    cache::put_json(&cache::keys::me(), &new_user);
    note_user(&new_user).await;

    let cached: Option<f64> = cache::get_json(&first_page_key).await;
    assert_eq!(cached, None);
}

#[tokio::test]
async fn note_user_wipes_a_cached_review_and_its_private_notes_across_account_switch() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let st = store::store().expect("test store");

    let old_user = user(5, "note-user-review-old");
    let new_user = user(6, "note-user-review-new");
    let reviews_key = cache::keys::reviews("note-user-review-book");
    st.meta_put("last_user", old_user.username.clone());
    cache::put_json(&reviews_key, &"notes only the old reader may see");

    cache::put_json(&cache::keys::me(), &new_user);
    note_user(&new_user).await;

    let cached: Option<String> = cache::get_json(&reviews_key).await;
    assert_eq!(cached, None);
}

#[tokio::test]
async fn note_user_wipes_cached_author_and_series_reading_but_keeps_their_lists() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    let st = store::store().expect("test store");

    let old_user = user(7, "note-user-reading-old");
    let new_user = user(8, "note-user-reading-new");
    st.meta_put("last_user", old_user.username.clone());
    let per_reader = [
        cache::keys::author(41),
        cache::keys::author_reading(),
        cache::keys::series(42),
        cache::keys::series_reading(),
    ];
    for key in &per_reader {
        cache::put_json(key, &"the old reader's progress");
    }
    cache::put_json(&cache::keys::series_index(), &"every reader's list");

    cache::put_json(&cache::keys::me(), &new_user);
    note_user(&new_user).await;

    for key in &per_reader {
        let cached: Option<String> = cache::get_json(key).await;
        assert_eq!(cached, None, "{key} outlived the switch");
    }
    let list: Option<String> = cache::get_json(&cache::keys::series_index()).await;
    assert_eq!(list.as_deref(), Some("every reader's list"));
}
