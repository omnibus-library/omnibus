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

async fn series_of(
    app: &axum::Router,
    token: &str,
    uuid: &str,
) -> serde_json::Map<String, serde_json::Value> {
    let res = app
        .clone()
        .oneshot(get(format!("/kobo/{token}/v1/library/{uuid}/metadata")))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    body_json(res).await[0].as_object().unwrap().clone()
}

#[tokio::test]
async fn library_metadata_carries_a_calibre_web_shaped_series_block() {
    let (app, pool, token, uid) = fixture().await;
    let indexed =
        seed_synced_ebook(&pool, "leviathan.epub", "Leviathan Wakes", "James Corey").await;
    let unindexed = seed_synced_ebook(&pool, "mort.epub", "Mort", "Terry Pratchett").await;
    let standalone = seed_synced_ebook(&pool, "dune.epub", "Dune", "Frank Herbert").await;
    for (uuid, series, index) in [
        (&indexed, "The Expanse", Some("2")),
        (&unindexed, "Discworld", None),
    ] {
        db::upsert_metadata_overrides(
            &pool,
            uuid,
            &MetadataOverrides {
                series: Some(series.into()),
                series_index: index.map(Into::into),
                ..Default::default()
            },
            false,
            uid,
        )
        .await
        .unwrap();
    }

    let book = series_of(&app, &token, &indexed).await;
    assert_eq!(
        book["Series"],
        json!({
            "Name": "The Expanse",
            "Number": 2.0,
            "NumberFloat": 2.0,
            "Id": "17a975b6-3a16-5b73-8aad-82cde885aedc",
        })
    );

    let series = series_of(&app, &token, &unindexed).await["Series"].clone();
    assert_eq!(series["Name"], "Discworld");
    assert!(series["Id"].is_string());
    assert!(series.get("Number").is_none() && series.get("NumberFloat").is_none());

    assert!(series_of(&app, &token, &standalone)
        .await
        .get("Series")
        .is_none());
}
