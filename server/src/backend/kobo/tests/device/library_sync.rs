//! The handshake and library sync as the device runs them: which books land
//! in its library, and what it shows for each before any download.

use omnibus_db::test_support::seed_synced_ebook;
use omnibus_mock_kobo::{device::Device, session::sync_now, wire::Series};
use omnibus_shared::{Contributor, MetadataOverrides};

use super::*;

async fn set_overrides(omnibus: &Omnibus, uuid: &str, overrides: MetadataOverrides) {
    db::upsert_metadata_overrides(&omnibus.pool, uuid, &overrides, false, omnibus.user_id)
        .await
        .unwrap();
}

#[tokio::test]
async fn sync_now_completes_handshake_against_real_routers() {
    let omnibus = spawn_omnibus().await;

    let result = sync_now(&mut Device::new("HW-1"), &omnibus.endpoint).await;

    assert!(result.is_ok(), "{result:?}");
}

#[tokio::test]
async fn sync_now_delivers_only_opted_in_shelf_books() {
    let omnibus = spawn_omnibus().await;
    let synced = seed_synced_ebook(&omnibus.pool, "dune.epub", "Dune", "Frank Herbert").await;
    seed_synced_ebook(&omnibus.pool, "emma.epub", "Emma", "Jane Austen").await;
    opt_in(
        &omnibus.pool,
        omnibus.user_id,
        std::slice::from_ref(&synced),
    )
    .await;
    let mut device = Device::new("HW-1");

    sync_now(&mut device, &omnibus.endpoint).await.unwrap();

    let titles: Vec<(&str, &str)> = device
        .library
        .iter()
        .map(|(id, book)| (id.as_str(), book.title.as_str()))
        .collect();
    assert_eq!(titles, [(synced.as_str(), "Dune")]);
}

#[tokio::test]
async fn sync_now_archives_books_after_shelf_opt_out() {
    let omnibus = spawn_omnibus().await;
    let uuid = seed_synced_ebook(&omnibus.pool, "dune.epub", "Dune", "Frank Herbert").await;
    let shelf = opt_in(&omnibus.pool, omnibus.user_id, std::slice::from_ref(&uuid)).await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &omnibus.endpoint).await.unwrap();
    let opt_out = omnibus_shared::UpdateShelfRequest {
        sync_to_kobo: Some(false),
        ..Default::default()
    };
    db::shelves::update_shelf(&omnibus.pool, shelf, &opt_out)
        .await
        .unwrap();

    sync_now(&mut device, &omnibus.endpoint).await.unwrap();

    let book = &device.library[&uuid];
    assert_eq!((book.title.as_str(), book.archived), ("Dune", true));
}

#[tokio::test]
async fn sync_now_delivers_description_before_download() {
    let omnibus = spawn_omnibus().await;
    let uuid = seed_synced_ebook(&omnibus.pool, "dune.epub", "Dune", "Frank Herbert").await;
    let description = MetadataOverrides {
        description: Some("Arrakis, desert planet.".into()),
        ..Default::default()
    };
    set_overrides(&omnibus, &uuid, description).await;
    opt_in(&omnibus.pool, omnibus.user_id, std::slice::from_ref(&uuid)).await;
    let mut device = Device::new("HW-1");

    sync_now(&mut device, &omnibus.endpoint).await.unwrap();

    assert_eq!(device.library[&uuid].description, "Arrakis, desert planet.");
}

#[tokio::test]
async fn sync_now_delivers_every_author_in_order_before_download() {
    let omnibus = spawn_omnibus().await;
    let uuid = seed_synced_ebook(&omnibus.pool, "omens.epub", "Good Omens", "Somebody").await;
    let creators = ["Terry Pratchett", "Neil Gaiman"].map(|name| Contributor {
        name: name.into(),
        ..Default::default()
    });
    let authors = MetadataOverrides {
        creators: Some(creators.to_vec()),
        ..Default::default()
    };
    set_overrides(&omnibus, &uuid, authors).await;
    opt_in(&omnibus.pool, omnibus.user_id, std::slice::from_ref(&uuid)).await;
    let mut device = Device::new("HW-1");

    sync_now(&mut device, &omnibus.endpoint).await.unwrap();

    assert_eq!(
        device.library[&uuid].authors,
        ["Terry Pratchett", "Neil Gaiman"]
    );
}

#[tokio::test]
async fn sync_now_delivers_series_before_download() {
    let omnibus = spawn_omnibus().await;
    let uuid = seed_synced_ebook(&omnibus.pool, "leviathan.epub", "Leviathan Wakes", "Corey").await;
    let series = MetadataOverrides {
        series: Some("The Expanse".into()),
        series_index: Some("2".into()),
        ..Default::default()
    };
    set_overrides(&omnibus, &uuid, series).await;
    opt_in(&omnibus.pool, omnibus.user_id, std::slice::from_ref(&uuid)).await;
    let mut device = Device::new("HW-1");

    sync_now(&mut device, &omnibus.endpoint).await.unwrap();

    let expected = Series {
        name: "The Expanse".into(),
        number: Some(2.0),
        id: "17a975b6-3a16-5b73-8aad-82cde885aedc".into(),
    };
    assert_eq!(device.library[&uuid].series, Some(expected));
}

#[tokio::test]
async fn sync_now_refreshes_metadata_without_redownload_when_book_changes() {
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
    device.library.get_mut(&uuid).unwrap().downloaded = true;
    let description = MetadataOverrides {
        description: Some("Arrakis, desert planet.".into()),
        ..Default::default()
    };
    set_overrides(&omnibus, &uuid, description).await;

    sync_now(&mut device, &omnibus.endpoint).await.unwrap();

    let book = &device.library[&uuid];
    assert_eq!(
        (book.description.as_str(), book.downloaded),
        ("Arrakis, desert planet.", true)
    );
}
