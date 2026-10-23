//! `decode`'s table, then `sync_now`'s cover pass against a stub.

use serde_json::{json, Value};
use tempfile::TempDir;

use crate::device::Device;
use crate::session::sync_now;
use crate::test_support::{
    book_metadata, new_entitlement, spawn_stub, stub_control, Stub, JPEG_BYTES, PNG_BYTES,
    STUB_TOKEN, WEBP_BYTES,
};

use super::*;

/// A `ChangedProductMetadata` block for `id`/`title`, with its own `CoverImageId`.
fn metadata_with_cover(id: &str, title: &str, cover_image_id: &str) -> Value {
    let mut metadata = book_metadata(id, title);
    metadata["CoverImageId"] = json!(cover_image_id);
    metadata
}

#[test]
fn decode_reads_a_jpeg_served_as_image_jpeg() {
    assert_eq!(decode(Some("image/jpeg"), JPEG_BYTES), Cover::Jpeg);
}

#[test]
fn decode_reads_a_png_served_as_image_png() {
    assert_eq!(decode(Some("image/png"), PNG_BYTES), Cover::Png);
}

#[test]
fn decode_marks_a_webp_undecodable() {
    assert_eq!(decode(Some("image/webp"), WEBP_BYTES), Cover::Undecodable);
}

#[test]
fn decode_marks_a_png_served_as_image_jpeg_undecodable() {
    assert_eq!(decode(Some("image/jpeg"), PNG_BYTES), Cover::Undecodable);
}

#[tokio::test]
async fn sync_now_fetches_each_cover_at_three_sizes_through_the_quality_template() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        cover: Some(("image/jpeg", JPEG_BYTES)),
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");

    sync_now(&mut device, &stub.endpoint).await.unwrap();

    let cover_paths: Vec<String> = stub
        .paths()
        .into_iter()
        .filter(|p| p.contains("/v1/books/"))
        .collect();
    assert_eq!(
        cover_paths,
        [
            format!("/kobo/{STUB_TOKEN}/v1/books/book-1/thumbnail/149/223/90/false/image.jpg"),
            format!("/kobo/{STUB_TOKEN}/v1/books/book-1/thumbnail/400/600/90/false/image.jpg"),
            format!("/kobo/{STUB_TOKEN}/v1/books/book-1/thumbnail/1072/1448/90/false/image.jpg"),
        ]
    );
    assert_eq!(device.library["book-1"].cover, Some(Cover::Jpeg));
}

#[tokio::test]
async fn sync_now_keeps_the_cached_cover_when_the_cover_image_id_is_unchanged() {
    let mut entitlement = new_entitlement("book-1", "Dune");
    entitlement["NewEntitlement"]["BookMetadata"]["CoverImageId"] = json!("cover-v1");
    let stub_a = spawn_stub(Stub {
        sync_pages: vec![json!([entitlement])],
        cover: Some(("image/jpeg", JPEG_BYTES)),
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &stub_a.endpoint).await.unwrap();
    assert_eq!(device.library["book-1"].cover, Some(Cover::Jpeg));

    let changed = json!([{
        "ChangedProductMetadata": { "BookMetadata": metadata_with_cover("book-1", "Dune", "cover-v1") }
    }]);
    let stub_b = spawn_stub(Stub {
        sync_pages: vec![changed],
        cover: Some(("image/png", PNG_BYTES)),
        ..Stub::default()
    })
    .await;

    sync_now(&mut device, &stub_b.endpoint).await.unwrap();

    assert!(
        stub_b.paths().iter().all(|p| !p.contains("/v1/books/")),
        "an unchanged CoverImageId must not be refetched"
    );
    assert_eq!(device.library["book-1"].cover, Some(Cover::Jpeg));
}

#[tokio::test]
async fn sync_now_caches_a_webp_cover_as_undecodable() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        cover: Some(("image/webp", WEBP_BYTES)),
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");

    sync_now(&mut device, &stub.endpoint).await.unwrap();

    assert_eq!(device.library["book-1"].cover, Some(Cover::Undecodable));
    assert_eq!(
        device.covers.get("book-1@149x223"),
        Some(&Cover::Undecodable)
    );
}

#[tokio::test]
async fn sync_now_asks_again_next_sync_for_a_cover_that_answered_404() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        ..Stub::default()
    })
    .await;
    let mut device = Device::new("HW-1");
    sync_now(&mut device, &stub.endpoint).await.unwrap();
    assert_eq!(device.library["book-1"].cover, None);
    assert!(device.covers.is_empty());

    sync_now(&mut device, &stub.endpoint).await.unwrap();

    let cover_requests = stub
        .paths()
        .into_iter()
        .filter(|p| p.contains("/v1/books/"))
        .count();
    assert_eq!(cover_requests, 6, "both syncs must ask for all three sizes");
}

#[tokio::test]
async fn reset_makes_the_next_sync_fetch_every_cover_again() {
    let stub = spawn_stub(Stub {
        sync_pages: vec![json!([new_entitlement("book-1", "Dune")])],
        cover: Some(("image/jpeg", JPEG_BYTES)),
        ..Stub::default()
    })
    .await;
    let dir = TempDir::new().unwrap();
    let control = stub_control(&stub, dir.path().join("kobo.json"));
    control.sync().await.unwrap();
    assert_eq!(control.view().library["book-1"].cover, Some(Cover::Jpeg));

    control.reset().await.unwrap();
    control.sync().await.unwrap();

    let cover_requests = stub
        .paths()
        .into_iter()
        .filter(|p| p.contains("/v1/books/"))
        .count();
    assert_eq!(cover_requests, 6, "reset must wipe the cover cache too");
}
