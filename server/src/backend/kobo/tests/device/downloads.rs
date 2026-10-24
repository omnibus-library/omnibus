//! Downloads against the real routers: AC3's green half (an audiobook-only
//! book never reaches the library) and `DownloadFailure`'s green half (a
//! full download succeeds even with no `kepubify` on `PATH`).

use omnibus_db::test_support::{seed_synced_audiobook, seed_synced_ebook, EnvVarGuard};
use omnibus_mock_kobo::device::Device;
use omnibus_mock_kobo::downloads::DownloadPolicy;
use omnibus_mock_kobo::session::sync_now;

use super::*;

#[tokio::test]
async fn sync_now_never_delivers_an_audiobook_only_book() {
    let omnibus = spawn_omnibus().await;
    let epub_uuid = seed_synced_ebook(&omnibus.pool, "dune.epub", "Dune", "Frank Herbert").await;
    let audio_uuid = seed_synced_audiobook(&omnibus.pool, "saga", "The Saga", "Narrator").await;
    opt_in(
        &omnibus.pool,
        omnibus.user_id,
        &[epub_uuid.clone(), audio_uuid.clone()],
    )
    .await;
    let mut device = Device::new("HW-1");

    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::All)
        .await
        .unwrap();

    assert!(device.library.contains_key(&epub_uuid));
    assert!(!device.library.contains_key(&audio_uuid));
}

#[tokio::test]
async fn sync_now_downloads_every_synced_book_under_the_all_policy() {
    let _no_kepubify = EnvVarGuard::set("OMNIBUS_KEPUBIFY_PATH", Some("/no/such/kepubify"));
    let omnibus = spawn_omnibus().await;
    let uuid = "72e1c9f0-0000-4000-8000-000000000003";
    seed_downloadable_book(&omnibus.pool, uuid, "The Golden Fixture", "Ada Lovelace").await;
    opt_in(&omnibus.pool, omnibus.user_id, &[uuid.to_owned()]).await;
    let mut device = Device::new("HW-1");

    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::All)
        .await
        .unwrap();

    let book = &device.library[uuid];
    assert_eq!(
        (book.downloaded, book.download_problem.as_ref()),
        (true, None)
    );
}
