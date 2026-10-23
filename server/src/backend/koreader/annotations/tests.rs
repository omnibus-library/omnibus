//! Contract tests for `GET`/`POST /koreader/v1/books/{uuid}/annotations`: what a KOReader
//! highlight leaves for the web reader, what a web edit shows on the device, who wins when
//! the two disagree, and the colour map between the two vocabularies.

use axum::{http::StatusCode, response::Response, Router};
use omnibus_db as db;
use omnibus_shared::{CreateHighlight, HighlightColor, UpdateHighlightNote};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

use super::*;
use crate::auth::test_support as auth_test_support;
use crate::backend::test_support::{body_json, get_with_bearer, request};
use crate::backend::{rest_router, AppState};

use super::super::test_support::{fixture, seed_epub_book};

const MISSING: &str = "99999999-9999-9999-9999-999999999999";

const CHAPTER: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>First paragraph.</p><p>Second paragraph.</p></body></html>"#;

/// "Second" in the second paragraph, addressed by hand: `/4` is the body, `/4/4` its second child.
const SECOND_POS0: &str = "/body/DocFragment/body/p[2]/text().0";
const SECOND_POS1: &str = "/body/DocFragment/body/p[2]/text().6";
const SECOND_CFI: &str = "epubcfi(/6/2!/4/4,/1:0,/1:6)";

/// "paragraph." of the first paragraph through "Second" of the second.
const SPANNING_POS0: &str = "/body/DocFragment/body/p[1]/text().6";
const SPANNING_POS1: &str = "/body/DocFragment/body/p[2]/text().6";
const SPANNING_CFI: &str = "epubcfi(/6/2!/4,/2/1:6,/4/1:6)";

fn uri(uuid: &str) -> String {
    format!("/koreader/v1/books/{uuid}/annotations")
}

fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}

async fn get(app: &Router, token: &str, uuid: &str, since: i64) -> Response {
    app.clone()
        .oneshot(get_with_bearer(
            &format!("{}?since={since}", uri(uuid)),
            token,
        ))
        .await
        .unwrap()
}

async fn post(app: &Router, token: &str, uuid: &str, body: Value) -> Response {
    app.clone()
        .oneshot(request("POST", &uri(uuid), Some(token), Some(body)))
        .await
        .unwrap()
}

fn upsert(id: &str, pos0: &str, pos1: &str) -> Value {
    json!({
        "id": id, "pos0": pos0, "pos1": pos1, "text": "Second", "note": "lane note",
        "color": "orange", "created_at": now() - 3600, "updated_at": now() - 60,
    })
}

async fn seeded() -> (Router, SqlitePool, String, i64, String) {
    let (app, pool, token, uid) = fixture().await;
    let (uuid, _file) = seed_epub_book(&pool, &[("c1.xhtml", CHAPTER)]).await;
    (app, pool, token, uid, uuid)
}

/// A request as the web reader's owner, to the REST surface.
async fn web(
    pool: &SqlitePool,
    uid: i64,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> Response {
    let owner = auth_test_support::bearer_token(pool, uid).await;
    rest_router(AppState::new(pool.clone()))
        .oneshot(request(method, uri, Some(&owner), body))
        .await
        .unwrap()
}

async fn web_highlights(pool: &SqlitePool, uid: i64, uuid: &str) -> Vec<Value> {
    let res = web(
        pool,
        uid,
        "GET",
        &format!("/api/highlights/book/{uuid}"),
        None,
    )
    .await;
    body_json(res).await
}

async fn web_create(pool: &SqlitePool, uid: i64, uuid: &str, cfi: &str, id: Option<&str>) {
    db::annotations::create_highlight(
        pool,
        uid,
        &CreateHighlight {
            client_id: id.map(Into::into),
            book_uuid: uuid.into(),
            epub_cfi_range: cfi.into(),
            color: HighlightColor::Rose,
            text: Some("Second".into()),
        },
    )
    .await
    .unwrap();
}

async fn listed(app: &Router, token: &str, uuid: &str, since: i64) -> Value {
    let res = get(app, token, uuid, since).await;
    assert_eq!(res.status(), StatusCode::OK);
    body_json(res).await
}

mod colour_map {
    use super::*;

    #[test]
    fn omnibus_color_maps_every_koreader_colour_and_defaults_to_amber() {
        let cases = [
            (Some("yellow"), HighlightColor::Amber),
            (Some("orange"), HighlightColor::Amber),
            (Some("gray"), HighlightColor::Amber),
            (None, HighlightColor::Amber),
            (Some("#ff0000"), HighlightColor::Amber),
            (Some("red"), HighlightColor::Rose),
            (Some("green"), HighlightColor::Green),
            (Some("olive"), HighlightColor::Green),
            (Some("cyan"), HighlightColor::Blue),
            (Some("blue"), HighlightColor::Blue),
            (Some("purple"), HighlightColor::Violet),
        ];
        for (koreader, expected) in cases {
            assert_eq!(omnibus_color(koreader), expected, "{koreader:?}");
        }
    }

    #[test]
    fn koreader_color_names_each_omnibus_colour() {
        let cases = [
            (HighlightColor::Amber, "yellow"),
            (HighlightColor::Green, "green"),
            (HighlightColor::Blue, "blue"),
            (HighlightColor::Rose, "red"),
            (HighlightColor::Violet, "purple"),
        ];
        for (omnibus, expected) in cases {
            assert_eq!(koreader_color(omnibus), expected, "{omnibus:?}");
        }
    }
}

mod get {
    use super::*;

    #[tokio::test]
    async fn lists_a_web_highlight_with_its_xpointers() {
        let (app, pool, token, uid, uuid) = seeded().await;
        web_create(&pool, uid, &uuid, SECOND_CFI, None).await;

        let body = listed(&app, &token, &uuid, 0).await;

        let annotations = body["annotations"].as_array().unwrap();
        assert_eq!(annotations.len(), 1);
        let a = &annotations[0];
        assert_eq!(a["pos0"], SECOND_POS0);
        assert_eq!(a["pos1"], SECOND_POS1);
        assert_eq!(a["color"], "red");
        assert_eq!(a["text"], "Second");
        assert_eq!(a["id"].as_str().unwrap().len(), 32);
        assert!(body["cursor"].as_i64().unwrap() >= a["updated_at"].as_i64().unwrap());
    }

    #[tokio::test]
    async fn lists_a_range_across_two_paragraphs() {
        let (app, pool, token, uid, uuid) = seeded().await;
        web_create(&pool, uid, &uuid, SPANNING_CFI, Some("span")).await;

        let body = listed(&app, &token, &uuid, 0).await;

        assert_eq!(body["annotations"][0]["pos0"], SPANNING_POS0);
        assert_eq!(body["annotations"][0]["pos1"], SPANNING_POS1);
    }

    #[tokio::test]
    async fn lists_a_web_recolour_and_a_web_delete() {
        let (app, pool, token, uid, uuid) = seeded().await;
        web_create(&pool, uid, &uuid, SECOND_CFI, None).await;
        let id = listed(&app, &token, &uuid, 0).await["annotations"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        // Age the row so the cursor below sits between its creation and the web edits.
        let cursor = 2000;
        sqlx::query("UPDATE annotations SET updated_at = 1000")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            listed(&app, &token, &uuid, cursor).await["annotations"],
            json!([])
        );

        let res = web(
            &pool,
            uid,
            "PATCH",
            &format!("/api/highlights/{id}/color"),
            Some(json!({ "color": "violet" })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        let recoloured = listed(&app, &token, &uuid, cursor).await;
        let res = web(&pool, uid, "DELETE", &format!("/api/highlights/{id}"), None).await;
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        let deleted = listed(&app, &token, &uuid, cursor).await;

        assert_eq!(recoloured["annotations"][0]["color"], "purple");
        assert_eq!(deleted["annotations"], json!([]));
        assert_eq!(deleted["deleted"], json!([id]));
    }

    #[tokio::test]
    async fn leaves_out_a_highlight_whose_anchor_cannot_be_placed() {
        let (app, pool, token, uid, uuid) = seeded().await;
        web_create(&pool, uid, &uuid, "epubcfi(/6/2!/4/40,/1:0,/1:6)", None).await;

        let body = listed(&app, &token, &uuid, 0).await;

        assert_eq!(body["annotations"], json!([]));
    }

    #[tokio::test]
    async fn lists_nothing_for_a_book_without_an_epub() {
        let (app, pool, token, uid) = fixture().await;
        let cbz =
            db::test_support::seed_synced_ebook(&pool, "berserk.cbz", "Berserk", "Miura").await;
        web_create(&pool, uid, &cbz, SECOND_CFI, None).await;

        let body = listed(&app, &token, &cbz, 0).await;

        assert_eq!(body["annotations"], json!([]));
    }

    #[tokio::test]
    async fn answers_500_so_the_device_retries_when_the_epub_cannot_be_read() {
        let (app, pool, token, uid) = fixture().await;
        let uuid = db::test_support::seed_synced_ebook(&pool, "alpha.epub", "Alpha", "Ada").await;
        web_create(&pool, uid, &uuid, SECOND_CFI, None).await;

        let res = get(&app, &token, &uuid, 0).await;

        assert_eq!(res.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn answers_404_for_an_unknown_uuid() {
        let (app, _pool, token, _uid, _uuid) = seeded().await;

        let res = get(&app, &token, MISSING, 0).await;

        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn answers_400_for_a_negative_since_and_an_oversized_uuid() {
        let (app, _pool, token, _uid, uuid) = seeded().await;
        let long = "a".repeat(omnibus_shared::BOOK_UUID_MAX_LEN + 1);

        let negative = get(&app, &token, &uuid, -1).await;
        let oversized = get(&app, &token, &long, 0).await;

        assert_eq!(negative.status(), StatusCode::BAD_REQUEST);
        assert_eq!(oversized.status(), StatusCode::BAD_REQUEST);
    }
}

mod post {
    use super::*;

    fn outcomes(body: &Value) -> Vec<&str> {
        body["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["outcome"].as_str().unwrap())
            .collect()
    }

    #[tokio::test]
    async fn creates_a_highlight_the_web_lists_at_the_same_passage() {
        let (app, pool, token, uid, uuid) = seeded().await;
        let created_at = now() - 3600;
        let mut item = upsert("0123456789abcdef0123456789abcdef", SECOND_POS0, SECOND_POS1);
        item["created_at"] = json!(created_at);

        let res = post(&app, &token, &uuid, json!({ "upserts": [item] })).await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: Value = body_json(res).await;
        assert_eq!(outcomes(&body), ["applied"]);
        assert_eq!(body["results"][0]["id"], "0123456789abcdef0123456789abcdef");
        assert_eq!(body["results"][0]["annotation"]["color"], "yellow");
        let web = web_highlights(&pool, uid, &uuid).await;
        assert_eq!(web.len(), 1);
        assert_eq!(web[0]["epub_cfi_range"], SECOND_CFI);
        assert_eq!(web[0]["color"], "amber");
        assert_eq!(web[0]["note"], "lane note");
        assert_eq!(web[0]["text"], "Second");
        assert_eq!(web[0]["client_id"], "0123456789abcdef0123456789abcdef");
        assert_eq!(web[0]["created_at"], created_at);
    }

    #[tokio::test]
    async fn updates_the_web_with_a_newer_note_edit() {
        let (app, pool, token, uid, uuid) = seeded().await;
        post(
            &app,
            &token,
            &uuid,
            json!({ "upserts": [upsert("h1", SECOND_POS0, SECOND_POS1)] }),
        )
        .await;
        sqlx::query("UPDATE annotations SET updated_at = ?")
            .bind(now() - 500)
            .execute(&pool)
            .await
            .unwrap();
        let mut edit = upsert("h1", SECOND_POS0, SECOND_POS1);
        edit["note"] = json!("edited on the device");

        let res = post(&app, &token, &uuid, json!({ "upserts": [edit] })).await;

        let body: Value = body_json(res).await;
        assert_eq!(outcomes(&body), ["applied"]);
        let web = web_highlights(&pool, uid, &uuid).await;
        assert_eq!(web[0]["note"], "edited on the device");
    }

    #[tokio::test]
    async fn answers_stale_with_the_server_row_for_an_older_edit() {
        let (app, pool, token, uid, uuid) = seeded().await;
        web_create(&pool, uid, &uuid, SECOND_CFI, Some("h1")).await;
        let res = web(
            &pool,
            uid,
            "PATCH",
            "/api/highlights/h1/color",
            Some(json!({ "color": "violet" })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        let mut older = upsert("h1", SECOND_POS0, SECOND_POS1);
        older["updated_at"] = json!(now() - 1000);

        let res = post(&app, &token, &uuid, json!({ "upserts": [older] })).await;

        let body: Value = body_json(res).await;
        assert_eq!(outcomes(&body), ["stale"]);
        let server = &body["results"][0]["annotation"];
        assert_eq!(server["color"], "purple");
        assert_eq!(server["note"], Value::Null);
        assert_eq!(server["pos0"], SECOND_POS0);
        assert_eq!(server["pos1"], SECOND_POS1);
        assert_eq!(
            web_highlights(&pool, uid, &uuid).await[0]["color"],
            "violet"
        );
    }

    #[tokio::test]
    async fn deletes_so_the_web_no_longer_lists_it_and_ignores_an_unknown_id() {
        let (app, pool, token, uid, uuid) = seeded().await;
        web_create(&pool, uid, &uuid, SECOND_CFI, Some("gone")).await;
        web_create(&pool, uid, &uuid, SPANNING_CFI, Some("kept")).await;

        let res = post(
            &app,
            &token,
            &uuid,
            json!({ "deletes": ["gone", "never-existed"] }),
        )
        .await;

        assert_eq!(res.status(), StatusCode::OK);
        let web = web_highlights(&pool, uid, &uuid).await;
        let remaining: Vec<&str> = web
            .iter()
            .map(|h| h["client_id"].as_str().unwrap())
            .collect();
        assert_eq!(remaining, ["kept"]);
    }

    #[tokio::test]
    async fn answers_unplaceable_and_stores_nothing_for_anchors_it_cannot_prove() {
        let (app, pool, token, uid, uuid) = seeded().await;
        let unprovable = upsert("h1", SECOND_POS0, "/body/DocFragment/body/p[9]/text().1");
        let placeable = upsert("h2", SECOND_POS0, SECOND_POS1);

        let res = post(
            &app,
            &token,
            &uuid,
            json!({ "upserts": [unprovable, placeable] }),
        )
        .await;

        let body: Value = body_json(res).await;
        assert_eq!(outcomes(&body), ["unplaceable", "applied"]);
        assert_eq!(body["results"][0]["annotation"], Value::Null);
        let web = web_highlights(&pool, uid, &uuid).await;
        assert_eq!(web.len(), 1);
        assert_eq!(web[0]["client_id"], "h2");
    }

    #[tokio::test]
    async fn answers_unplaceable_for_every_upsert_to_a_book_without_an_epub() {
        let (app, pool, token, uid) = fixture().await;
        let cbz =
            db::test_support::seed_synced_ebook(&pool, "berserk.cbz", "Berserk", "Miura").await;

        let res = post(
            &app,
            &token,
            &cbz,
            json!({ "upserts": [upsert("h1", SECOND_POS0, SECOND_POS1)] }),
        )
        .await;

        let body: Value = body_json(res).await;
        assert_eq!(outcomes(&body), ["unplaceable"]);
        assert_eq!(web_highlights(&pool, uid, &cbz).await, Vec::<Value>::new());
    }

    #[tokio::test]
    async fn answers_deleted_for_an_id_the_web_deleted() {
        let (app, pool, token, uid, uuid) = seeded().await;
        web_create(&pool, uid, &uuid, SECOND_CFI, Some("h1")).await;
        let res = web(&pool, uid, "DELETE", "/api/highlights/h1", None).await;
        assert_eq!(res.status(), StatusCode::NO_CONTENT);

        let res = post(
            &app,
            &token,
            &uuid,
            json!({ "upserts": [upsert("h1", SECOND_POS0, SECOND_POS1)] }),
        )
        .await;

        let body: Value = body_json(res).await;
        assert_eq!(outcomes(&body), ["deleted"]);
        assert_eq!(web_highlights(&pool, uid, &uuid).await, Vec::<Value>::new());
    }

    #[tokio::test]
    async fn rejects_a_malformed_push_with_a_400_and_stores_nothing() {
        let (app, pool, token, uid, uuid) = seeded().await;
        let one = |mutate: &dyn Fn(&mut Value)| {
            let mut item = upsert("h1", SECOND_POS0, SECOND_POS1);
            mutate(&mut item);
            json!({ "upserts": [item] })
        };
        let over = |len: usize| "x".repeat(len);
        let cases = [
            ("empty id", one(&|i| i["id"] = json!(""))),
            (
                "id over the cap",
                one(&|i| i["id"] = json!(over(CreateHighlight::CLIENT_ID_MAX_LEN + 1))),
            ),
            (
                "pos0 over the cap",
                one(&|i| i["pos0"] = json!(over(CreateHighlight::EPUB_CFI_RANGE_MAX_LEN + 1))),
            ),
            (
                "pos1 over the cap",
                one(&|i| i["pos1"] = json!(over(CreateHighlight::EPUB_CFI_RANGE_MAX_LEN + 1))),
            ),
            (
                "text over the cap",
                one(&|i| i["text"] = json!(over(CreateHighlight::TEXT_MAX_LEN + 1))),
            ),
            (
                "note over the cap",
                one(&|i| i["note"] = json!(over(UpdateHighlightNote::NOTE_MAX_LEN + 1))),
            ),
            ("negative created_at", one(&|i| i["created_at"] = json!(-1))),
            ("negative updated_at", one(&|i| i["updated_at"] = json!(-1))),
            (
                "too many upserts",
                json!({ "upserts": vec![upsert("h1", SECOND_POS0, SECOND_POS1); MAX_BATCH + 1] }),
            ),
            (
                "too many deletes",
                json!({ "deletes": vec!["h1"; MAX_BATCH + 1] }),
            ),
            ("empty delete id", json!({ "deletes": [""] })),
        ];

        for (case, body) in cases {
            let res = post(&app, &token, &uuid, body).await;
            assert_eq!(res.status(), StatusCode::BAD_REQUEST, "{case}");
        }
        assert_eq!(web_highlights(&pool, uid, &uuid).await, Vec::<Value>::new());
    }

    #[tokio::test]
    async fn accepts_a_full_batch_at_the_cap() {
        let (app, _pool, token, _uid, uuid) = seeded().await;
        let upserts: Vec<Value> = (0..MAX_BATCH)
            .map(|i| upsert(&format!("h{i}"), SECOND_POS0, SECOND_POS1))
            .collect();

        let res = post(&app, &token, &uuid, json!({ "upserts": upserts })).await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: Value = body_json(res).await;
        assert_eq!(body["results"].as_array().unwrap().len(), MAX_BATCH);
    }

    #[tokio::test]
    async fn answers_404_for_an_unknown_uuid_and_400_for_an_oversized_one() {
        let (app, _pool, token, _uid, _uuid) = seeded().await;
        let long = "a".repeat(omnibus_shared::BOOK_UUID_MAX_LEN + 1);

        let missing = post(&app, &token, MISSING, json!({})).await;
        let oversized = post(&app, &token, &long, json!({})).await;

        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        assert_eq!(oversized.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn answers_a_client_error_for_a_body_that_is_not_json() {
        let (app, _pool, token, _uid, uuid) = seeded().await;
        let mut req = request("POST", &uri(&uuid), Some(&token), None);
        *req.body_mut() = axum::body::Body::from("not json");
        req.headers_mut()
            .insert("content-type", "application/json".parse().unwrap());

        let res = app.clone().oneshot(req).await.unwrap();

        assert!(res.status().is_client_error(), "{}", res.status());
    }
}
