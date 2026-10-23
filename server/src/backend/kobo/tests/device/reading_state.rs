//! Reading state against the real routers: AC4's "a newer web position
//! reaches the device" half, and `StateArbitration`'s green half.

use omnibus_db::test_support::seed_synced_ebook;
use omnibus_mock_kobo::device::Device;
use omnibus_mock_kobo::downloads::DownloadPolicy;
use omnibus_mock_kobo::reading::{Bookmark, Percent, ReadStatus};
use omnibus_mock_kobo::session::sync_now;

use super::*;

#[tokio::test]
async fn sync_now_adopts_a_newer_web_position_over_the_devices_own() {
    let omnibus = spawn_omnibus().await;
    let uuid = seed_synced_ebook(&omnibus.pool, "dune.epub", "Dune", "Frank Herbert").await;
    opt_in(&omnibus.pool, omnibus.user_id, std::slice::from_ref(&uuid)).await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();
    device.library.get_mut(&uuid).unwrap().reading.bookmark = Some(Bookmark {
        percent: Percent::new(30),
        location: None,
        modified: 1_000_000_000,
    });

    pin_state_clocks(
        &omnibus.pool,
        omnibus.user_id,
        &uuid,
        1_700_000_000,
        1_700_000_000,
    )
    .await;
    // Both clocks are second-granular, so the device's next sync must see the
    // web write as newer than its own last sync.
    sqlx::query("UPDATE kobo_books_sync SET synced_at = 1")
        .execute(&omnibus.pool)
        .await
        .unwrap();

    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::None)
        .await
        .unwrap();

    let reading = &device.library[&uuid].reading;
    assert_eq!(reading.status, ReadStatus::Reading);
    let bookmark = reading.bookmark.as_ref().unwrap();
    assert_eq!(bookmark.percent, Percent::new(58));
    assert_eq!(bookmark.location.as_ref().unwrap().value, "kobo.2.1");
    assert_eq!(bookmark.modified, 1_700_000_000);
}
