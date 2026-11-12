//! A web reading state saved in the same second as a Kobo sync still reaches the device:
//! the delta's state watermark is the stamp of the state it delivered, not the sync's clock.

use omnibus_shared::{ProgressFormat, ProgressUpdate};

use super::*;

async fn save_web_position(pool: &SqlitePool, user: i64, uuid: &str, at: i64) {
    crate::progress::upsert_progress(
        pool,
        user,
        &ProgressUpdate {
            book_uuid: uuid.to_string(),
            format: ProgressFormat::Epub,
            epub_cfi: Some("epubcfi(/6/4!/4/2)".into()),
            audio_position_seconds: None,
            progress_percent: Some(40),
            kobo_location: None,
            client_updated_at: Some(at),
            book_file_id: None,
        },
    )
    .await
    .unwrap();
}

/// A device holding one synced book, and that book's uuid.
async fn device_holding_a_book(pool: &SqlitePool) -> (i64, i64, String) {
    let user = make_user(pool, "reader").await;
    let device = make_device(pool, user, "Clara").await;
    let uuid = seed_synced_ebook(pool, "dune.epub", "Dune", "Herbert").await;
    synced_shelf(pool, user, "Kobo", std::slice::from_ref(&uuid)).await;
    sync_once(pool, user, device).await;
    (user, device, uuid)
}

#[tokio::test]
async fn sync_delta_announces_a_position_dated_within_the_last_syncs_second() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (user, device, uuid) = device_holding_a_book(&pool).await;
    let now = server_now(&pool).await;
    save_web_position(&pool, user, &uuid, now - 10).await;
    sync_once(&pool, user, device).await;

    save_web_position(&pool, user, &uuid, now).await;
    let delta = sync_delta(&pool, user, device).await.unwrap();

    assert_eq!(delta.len(), 1, "got {:?}", delta.changes);
    assert!(matches!(&delta.changes[0], SyncChange::StateChanged(b) if b.uuid == uuid));
}

#[tokio::test]
async fn record_synced_leaves_a_state_written_after_the_page_was_read_owed() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let (user, device, uuid) = device_holding_a_book(&pool).await;
    let now = server_now(&pool).await;
    save_web_position(&pool, user, &uuid, now - 20).await;
    let delta = sync_delta(&pool, user, device).await.unwrap();
    let page_read = page_states(&pool, user, &delta.changes).await;

    save_web_position(&pool, user, &uuid, now - 10).await;
    record_synced(&pool, device, &delta.changes, &page_read)
        .await
        .unwrap();

    let next = sync_delta(&pool, user, device).await.unwrap();
    assert_eq!(next.len(), 1, "got {:?}", next.changes);
    assert!(matches!(&next.changes[0], SyncChange::StateChanged(b) if b.uuid == uuid));
}
