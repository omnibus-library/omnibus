//! Reading state against the real routers: AC4's device↔server halves, and
//! the green halves of `StateArbitration` and `StatePutResult`.

use omnibus_db::test_support::seed_synced_ebook;
use omnibus_mock_kobo::device::Device;
use omnibus_mock_kobo::downloads::DownloadPolicy;
use omnibus_mock_kobo::kepub::Kepub;
use omnibus_mock_kobo::reading::{Bookmark, Percent, ReadStatus};
use omnibus_mock_kobo::session::{attempt_state, sync_now, StateSent};
use omnibus_shared::{ProgressFormat, ProgressUpdate};

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

#[tokio::test]
async fn attempt_state_sends_the_device_position_to_the_server() {
    let omnibus = spawn_omnibus().await;
    let uuid = "72e1c9f0-0000-4000-8000-000000000101";
    seed_downloadable_book(&omnibus.pool, uuid, "The Golden Fixture", "Ada Lovelace").await;
    opt_in(&omnibus.pool, omnibus.user_id, &[uuid.to_owned()]).await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::All)
        .await
        .unwrap();
    device
        .read(uuid, Percent::new(42).unwrap(), None, 1_700_000_000)
        .unwrap();

    let attempt = attempt_state(&mut device, &omnibus.endpoint, uuid, StateSent::Read).await;

    assert!(attempt.outcome.is_ok(), "{:?}", attempt.outcome);
    let states = db::kobo::reading_state_for(&omnibus.pool, omnibus.user_id, &[uuid.to_owned()])
        .await
        .unwrap();
    let state = &states[uuid];
    assert_eq!(state.percent, Some(42));
    assert_eq!(state.status, omnibus_shared::ReadStatus::Reading);
}

#[tokio::test]
async fn attempt_state_loses_to_a_newer_web_position_when_the_device_write_is_older() {
    let omnibus = spawn_omnibus().await;
    let uuid = "72e1c9f0-0000-4000-8000-000000000102";
    seed_downloadable_book(&omnibus.pool, uuid, "The Golden Fixture", "Ada Lovelace").await;
    opt_in(&omnibus.pool, omnibus.user_id, &[uuid.to_owned()]).await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::All)
        .await
        .unwrap();
    // A web write with no client clock is stamped server-now, which beats
    // any device write backdated to 1_000_000_000 below.
    db::progress::upsert_progress(
        &omnibus.pool,
        omnibus.user_id,
        &ProgressUpdate {
            book_uuid: uuid.to_owned(),
            format: ProgressFormat::Epub,
            epub_cfi: None,
            audio_position_seconds: None,
            progress_percent: Some(77),
            kobo_location: None,
            book_file_id: None,
            client_updated_at: None,
        },
    )
    .await
    .unwrap();

    device
        .read(uuid, Percent::new(30).unwrap(), None, 1_000_000_000)
        .unwrap();
    attempt_state(&mut device, &omnibus.endpoint, uuid, StateSent::Read)
        .await
        .outcome
        .unwrap();

    let states = db::kobo::reading_state_for(&omnibus.pool, omnibus.user_id, &[uuid.to_owned()])
        .await
        .unwrap();
    assert_eq!(states[uuid].percent, Some(77));
}

#[tokio::test]
async fn attempt_state_lands_a_reader_bookmark_on_its_kobospan_and_derived_cfi() {
    let omnibus = spawn_omnibus().await;
    let (uuid, _guard) = seed_reader_book(&omnibus.pool).await;
    opt_in(&omnibus.pool, omnibus.user_id, std::slice::from_ref(&uuid)).await;
    let mut device = Device::new("HW-1");
    device.storage = Some(db::test_support::make_test_dir("reader_device_storage"));
    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::All)
        .await
        .unwrap();
    let file = device
        .book_file(&uuid)
        .expect("the sync downloaded the reader fixture");
    let kepub = Kepub::open(&file).unwrap();
    // ch1's 4th block (kobo.4.1, span index 3): the page a reader opens
    // after turning two pages past the book's start (Task 3's own
    // `paginate` tests land on the same span at 24x3).
    let (percent, location) = kepub.bookmark(0, 3);
    device
        .read(&uuid, percent, Some(location), 1_700_000_000)
        .unwrap();

    attempt_state(&mut device, &omnibus.endpoint, &uuid, StateSent::Read)
        .await
        .outcome
        .unwrap();

    let record =
        db::progress::get_progress(&omnibus.pool, omnibus.user_id, &uuid, ProgressFormat::Epub)
            .await
            .unwrap()
            .unwrap();
    assert_eq!(record.progress_percent, Some(18));
    let stored_location = record.kobo_location.unwrap();
    assert!(stored_location.contains("ch1.xhtml"), "{stored_location}");
    assert!(stored_location.contains("kobo.4.1"), "{stored_location}");
    // kobo.4.1 is <body>'s 4th child (h1, p, p, p) → CFI step 8; its sole
    // text node is the first (only) text cluster, landing at offset 0 —
    // worked out by hand from `test_data/kepub/reader.epub`'s ch1.xhtml.
    assert_eq!(record.epub_cfi.as_deref(), Some("epubcfi(/6/2!/4/8/1:0)"));
}

#[tokio::test]
async fn attempt_state_marks_the_book_finished_on_the_server() {
    let omnibus = spawn_omnibus().await;
    let uuid = "72e1c9f0-0000-4000-8000-000000000103";
    seed_downloadable_book(&omnibus.pool, uuid, "The Golden Fixture", "Ada Lovelace").await;
    opt_in(&omnibus.pool, omnibus.user_id, &[uuid.to_owned()]).await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &omnibus.endpoint, &DownloadPolicy::All)
        .await
        .unwrap();
    device.finish(uuid, 1_700_000_000).unwrap();

    attempt_state(&mut device, &omnibus.endpoint, uuid, StateSent::Finish)
        .await
        .outcome
        .unwrap();

    let states = db::kobo::reading_state_for(&omnibus.pool, omnibus.user_id, &[uuid.to_owned()])
        .await
        .unwrap();
    assert_eq!(states[uuid].status, omnibus_shared::ReadStatus::Finished);
}
