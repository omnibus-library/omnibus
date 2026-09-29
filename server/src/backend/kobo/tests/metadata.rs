//! The bibliographic half of `BookMetadata` on the wire: every author in
//! `Contributors` and `ContributorRoles`.

use axum::http::StatusCode;
use omnibus_db::{self as db, test_support::seed_synced_ebook};
use omnibus_shared::{Contributor, MetadataOverrides};
use serde_json::json;
use tower::ServiceExt;

use super::{body_json, fixture, get};

#[tokio::test]
async fn library_metadata_lists_every_author_in_both_contributor_fields() {
    let (app, pool, token, uid) = fixture().await;
    let uuid = seed_synced_ebook(&pool, "omens.epub", "Good Omens", "Somebody Else").await;
    let creators = ["Terry Pratchett", "Neil Gaiman"].map(|name| Contributor {
        name: name.into(),
        ..Default::default()
    });
    db::upsert_metadata_overrides(
        &pool,
        &uuid,
        &MetadataOverrides {
            creators: Some(creators.to_vec()),
            ..Default::default()
        },
        false,
        uid,
    )
    .await
    .unwrap();

    let res = app
        .oneshot(get(format!("/kobo/{token}/v1/library/{uuid}/metadata")))
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let book = &body_json(res).await[0];
    assert_eq!(
        book["Contributors"],
        json!(["Terry Pratchett", "Neil Gaiman"])
    );
    assert_eq!(
        book["ContributorRoles"],
        json!([
            {"Name": "Terry Pratchett", "Role": "Author"},
            {"Name": "Neil Gaiman", "Role": "Author"},
        ])
    );
}
