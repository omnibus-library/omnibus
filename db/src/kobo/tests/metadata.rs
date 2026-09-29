//! Tests for the bibliographic fields a Kobo sync row carries beyond the
//! title: every author in position order, overrides applied.

use super::*;
use crate::test_support::{indexed, uuid_by_scan_key};

#[tokio::test]
async fn book_for_sync_carries_every_author_in_position_order() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    crate::sync::sync_books(
        &pool,
        "/ebooks",
        crate::sync::SyncPlan {
            new_books: vec![indexed(
                "omens.epub",
                Some("Good Omens"),
                &["Terry Pratchett", "Neil Gaiman"],
                &[],
                None,
                None,
            )],
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let uuid = uuid_by_scan_key(&pool, &crate::helpers::scan_key_for("omens.epub")).await;

    let row = book_for_sync(&pool, &uuid).await.unwrap().unwrap();

    assert_eq!(row.authors, vec!["Terry Pratchett", "Neil Gaiman"]);
}

#[tokio::test]
async fn sync_books_replaces_every_author_with_a_creators_override() {
    let pool = init_db("sqlite::memory:").await.unwrap();
    let user = make_user(&pool, "reader").await;
    let uuid = seed_synced_ebook(&pool, "omens.epub", "Good Omens", "Somebody Else").await;
    synced_manual_shelf(&pool, user, "Kobo", std::slice::from_ref(&uuid)).await;
    let creators = ["Terry Pratchett", "Neil Gaiman"].map(|name| Contributor {
        name: name.into(),
        ..Default::default()
    });
    upsert_metadata_overrides(
        &pool,
        &uuid,
        &MetadataOverrides {
            creators: Some(creators.to_vec()),
            ..Default::default()
        },
        false,
        user,
    )
    .await
    .unwrap();

    let rows = sync_books(&pool, user).await.unwrap();

    assert_eq!(rows[0].authors, vec!["Terry Pratchett", "Neil Gaiman"]);
}
