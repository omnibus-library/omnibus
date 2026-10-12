//! Offline account writes applied to the cached summary.

use super::*;

#[tokio::test]
async fn kindle_email_changed_patches_the_cached_account_summary() {
    store::init_global_for_tests();
    let _guard = test_state_lock().lock().unwrap();
    clear_ops().await;

    cache::put_json(
        &cache::keys::me(),
        &omnibus_shared::UserSummary {
            id: 9,
            username: "reader".into(),
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

    assert!(queue_set_kindle_email(&Some("reader@kindle.com".into())).await);

    let me: omnibus_shared::UserSummary = cache::get_json(&cache::keys::me())
        .await
        .expect("cached me");
    assert_eq!(me.kindle_email.as_deref(), Some("reader@kindle.com"));
    clear_ops().await;
}
