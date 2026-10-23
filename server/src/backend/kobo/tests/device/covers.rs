//! Cover caching and decoding against the real routers: AC1's green half (a
//! changed cover shows up after one sync) and `CoverDecode`'s green half (a
//! PNG decodes).

use omnibus_db::test_support::seed_synced_ebook;
use omnibus_mock_kobo::covers::Cover;
use omnibus_mock_kobo::device::Device;
use omnibus_mock_kobo::session::sync_now;

use super::*;

#[tokio::test]
async fn sync_now_shows_the_new_cover_after_one_sync_when_the_cover_changes() {
    let _covers_dir = crate::backend::test_support::CoversDirGuard::new("mock_kobo_covers");
    let omnibus = spawn_omnibus().await;
    let uuid = seed_synced_ebook(&omnibus.pool, "dune.epub", "Dune", "Frank Herbert").await;
    // `last_modified` is second-granular, so pin it below any real write.
    sqlx::query("UPDATE books SET last_modified = 1 WHERE uuid = ?")
        .bind(&uuid)
        .execute(&omnibus.pool)
        .await
        .unwrap();
    opt_in(&omnibus.pool, omnibus.user_id, std::slice::from_ref(&uuid)).await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &omnibus.endpoint).await.unwrap();
    assert_eq!(device.library[&uuid].cover, None);
    let before_id = device.library[&uuid].cover_image_id.clone();

    seed_override_cover(&omnibus.pool, &uuid, omnibus.user_id).await;

    let report = sync_now(&mut device, &omnibus.endpoint).await.unwrap();

    let book = &device.library[&uuid];
    assert_ne!(
        book.cover_image_id, before_id,
        "an overridden cover must bump the cover id, or the device never refetches"
    );
    assert_eq!(book.cover, Some(Cover::Png));
    let thumbnail_200s = report
        .requests
        .iter()
        .filter(|r| r.path.contains("/v1/books/") && r.status == 200)
        .count();
    assert_eq!(thumbnail_200s, 3);
}
